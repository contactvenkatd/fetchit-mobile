// Per-user monthly quotas for the paid upstreams. 'ai' = one xAI/Grok call
// (parse-shopping-intent); 'zinc' = one product search (search-products, which
// fans out to Zinc search + details + offers). Counters live in
// public.usage_quotas and are spent atomically by the quota_consume RPC.
//
// Limits = per-bucket Free baseline (env, tunable without a code change) ×
// plan multiplier. The plan is VERIFIED here against Stripe (and the family
// owner's Stripe plan for max_family members) — user_metadata.plan is
// client-writable and is never used to size a quota.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { paymentStripe, stripeIsLive } from './stripe-backend.ts';
import { subscriptionState } from './stripe-subscription-state.mjs';

export type QuotaBucket = 'ai' | 'zinc';
export type QuotaPlan = 'Free' | 'Plus' | 'Pro' | 'Max';

export const PLAN_MULTIPLIER: Record<QuotaPlan, number> = { Free: 1, Plus: 2, Pro: 5, Max: 25 };

// Proposed starting baselines (Free tier, per UTC calendar month) used only
// when the env var is unset or invalid. Override with the
// QUOTA_AI_FREE_UNITS / QUOTA_ZINC_FREE_UNITS edge-function secrets.
const DEFAULT_FREE_UNITS: Record<QuotaBucket, number> = { ai: 50, zinc: 10 };
const BASELINE_ENV: Record<QuotaBucket, string> = { ai: 'QUOTA_AI_FREE_UNITS', zinc: 'QUOTA_ZINC_FREE_UNITS' };
const MAX_BASELINE = 1_000_000;
// How long a Stripe-verified plan is reused before re-checking Stripe.
const DEFAULT_PLAN_CACHE_SECONDS = 300;
// A denied call re-verifies a cached plan older than this, so an upgrade
// takes effect right away instead of after the cache expires.
const DENIED_RECHECK_SECONDS = 60;

export interface QuotaSnapshot {
  bucket: QuotaBucket;
  plan: QuotaPlan;
  used: number;
  limit: number;
  remaining: number;
  periodKey: string;
  resetsAt: string;
}

export type QuotaDecision =
  | { allowed: true; snapshot: QuotaSnapshot | null }
  | { allowed: false; reason: 'exceeded'; snapshot: QuotaSnapshot }
  | { allowed: false; reason: 'unavailable' };

export function freeBaseline(bucket: QuotaBucket): number {
  const raw = Deno.env.get(BASELINE_ENV[bucket])?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= MAX_BASELINE) return parsed;
  if (raw) console.warn(`usage-quota: ignoring invalid ${BASELINE_ENV[bucket]}`);
  return DEFAULT_FREE_UNITS[bucket];
}

export function quotaLimit(bucket: QuotaBucket, plan: QuotaPlan): number {
  return freeBaseline(bucket) * PLAN_MULTIPLIER[plan];
}

function planCacheSeconds(): number {
  const parsed = Number(Deno.env.get('QUOTA_PLAN_CACHE_SECONDS')?.trim());
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 86_400 ? parsed : DEFAULT_PLAN_CACHE_SECONDS;
}

export function serviceClient(): SupabaseClient | null {
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim();
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** The caller's user from their bearer token, or null when absent/invalid. */
export async function authenticateRequest(req: Request): Promise<User | null> {
  const authorization = req.headers.get('Authorization');
  const url = Deno.env.get('SUPABASE_URL')?.trim();
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')?.trim();
  if (!authorization?.startsWith('Bearer ') || !url || !anonKey) return null;
  const supabase = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.auth.getUser();
  return error || !data.user ? null : data.user;
}

// The paid plan Stripe reports for this user, mirroring the stripe-webhook
// reconciliation: only customers whose Stripe-side supabase_uid is this user
// count, so a forged user_metadata.stripe_customer_id cannot borrow a plan.
async function stripePlan(user: User): Promise<QuotaPlan> {
  const stripe = paymentStripe();
  const live = stripeIsLive();
  const mode = live ? 'live' : 'test';
  const candidates = [...new Set([
    user.app_metadata?.stripe_customers?.[mode],
    user.user_metadata?.stripe_customer_id,
  ].filter((id): id is string => typeof id === 'string' && id.startsWith('cus_')))];

  let best: QuotaPlan = 'Free';
  for (const customerId of candidates) {
    let customer;
    try {
      customer = await stripe.customers.retrieve(customerId);
    } catch (error) {
      if ((error as { code?: string }).code === 'resource_missing') continue;
      throw error;
    }
    if (customer.deleted || customer.livemode !== live || customer.metadata.supabase_uid !== user.id) continue;
    const subscriptions = [];
    for await (const sub of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
      if (sub.livemode === live) subscriptions.push(sub);
    }
    const state = subscriptionState(subscriptions);
    const plan = state?.plan as QuotaPlan | undefined;
    if (plan && PLAN_MULTIPLIER[plan] > PLAN_MULTIPLIER[best]) best = plan;
  }
  return best;
}

// Family members inherit Max only while their owner's own Stripe plan is Max
// and the family hasn't passed its disband date.
async function familyPlan(admin: SupabaseClient, userId: string): Promise<QuotaPlan> {
  const { data, error } = await admin.from('family_members')
    .select('owner_id, pending_disband_at').eq('member_id', userId);
  if (error) throw new Error('Family lookup failed');
  for (const row of data ?? []) {
    if (!row.owner_id || row.owner_id === userId) continue;
    if (row.pending_disband_at && Date.parse(row.pending_disband_at) <= Date.now()) continue;
    const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(row.owner_id);
    if (ownerError || !owner.user) continue;
    if (await stripePlan(owner.user) === 'Max') return 'Max';
  }
  return 'Free';
}

/**
 * The user's verified plan, from the server-only plan_entitlements cache when
 * fresh enough, else re-verified against Stripe. If Stripe is unreachable the
 * last verified plan is reused (or Free when there is none) — never a
 * client-supplied value.
 */
export async function resolveVerifiedPlan(
  admin: SupabaseClient, user: User, maxAgeSeconds = planCacheSeconds(),
): Promise<{ plan: QuotaPlan; verifiedAt: number }> {
  const { data: cached } = await admin.from('plan_entitlements')
    .select('plan, verified_at').eq('user_id', user.id).maybeSingle();
  const cachedAt = cached ? Date.parse(cached.verified_at) : NaN;
  if (cached && Number.isFinite(cachedAt) && Date.now() - cachedAt <= maxAgeSeconds * 1000 &&
      cached.plan in PLAN_MULTIPLIER) {
    return { plan: cached.plan as QuotaPlan, verifiedAt: cachedAt };
  }

  try {
    let plan = await stripePlan(user);
    let source = 'stripe';
    if (plan !== 'Max') {
      const family = await familyPlan(admin, user.id);
      if (family === 'Max') { plan = family; source = 'family'; }
    }
    const verifiedAt = Date.now();
    await admin.from('plan_entitlements').upsert({
      user_id: user.id, plan, source, verified_at: new Date(verifiedAt).toISOString(),
    });
    return { plan, verifiedAt };
  } catch {
    // Never log raw Stripe errors or customer data.
    console.warn('usage-quota: plan verification unavailable; using last verified plan');
    const fallback = cached && cached.plan in PLAN_MULTIPLIER ? cached.plan as QuotaPlan : 'Free';
    return { plan: fallback, verifiedAt: Number.isFinite(cachedAt) ? cachedAt : 0 };
  }
}

type ConsumeRow = { allowed: boolean; used: number; unit_limit: number; period: string; resets_at: string };

async function consume(admin: SupabaseClient, userId: string, bucket: QuotaBucket, limit: number): Promise<ConsumeRow> {
  const { data, error } = await admin.rpc('quota_consume', {
    p_user_id: userId, p_bucket: bucket, p_limit: limit, p_units: 1,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row.allowed !== 'boolean') throw new Error('quota_consume failed');
  return row as ConsumeRow;
}

function snapshot(bucket: QuotaBucket, plan: QuotaPlan, row: { used: number; period: string; resets_at: string }, limit: number): QuotaSnapshot {
  return {
    bucket, plan, used: row.used, limit,
    remaining: Math.max(0, limit - row.used),
    periodKey: row.period,
    resetsAt: new Date(row.resets_at).toISOString(),
  };
}

/**
 * Spend one unit of `bucket` for `user` before calling the paid upstream.
 * Fail policy when the quota system itself breaks: 'ai' fails OPEN (chat keeps
 * working), 'zinc' fails CLOSED (protects spend).
 */
export async function consumeQuota(user: User, bucket: QuotaBucket): Promise<QuotaDecision> {
  const failOpen = bucket === 'ai';
  const admin = serviceClient();
  if (!admin) {
    console.error(`usage-quota: service client unavailable (${bucket})`);
    return failOpen ? { allowed: true, snapshot: null } : { allowed: false, reason: 'unavailable' };
  }
  try {
    let { plan, verifiedAt } = await resolveVerifiedPlan(admin, user);
    let limit = quotaLimit(bucket, plan);
    let row = await consume(admin, user.id, bucket, limit);

    // Hard stop, but give a just-upgraded user their new limit immediately.
    if (!row.allowed && Date.now() - verifiedAt > DENIED_RECHECK_SECONDS * 1000) {
      const fresh = await resolveVerifiedPlan(admin, user, 0);
      const freshLimit = quotaLimit(bucket, fresh.plan);
      if (freshLimit > limit) {
        plan = fresh.plan; limit = freshLimit;
        row = await consume(admin, user.id, bucket, limit);
      }
    }

    const result = snapshot(bucket, plan, row, limit);
    return row.allowed ? { allowed: true, snapshot: result } : { allowed: false, reason: 'exceeded', snapshot: result };
  } catch {
    console.error(`usage-quota: quota check failed (${bucket})`);
    return failOpen ? { allowed: true, snapshot: null } : { allowed: false, reason: 'unavailable' };
  }
}

/** Read-only usage for every bucket (no increment). Throws if unavailable. */
export async function quotaStatus(user: User): Promise<{ plan: QuotaPlan; buckets: Record<QuotaBucket, QuotaSnapshot> }> {
  const admin = serviceClient();
  if (!admin) throw new Error('Quota service unavailable');
  const { plan } = await resolveVerifiedPlan(admin, user);
  const read = async (bucket: QuotaBucket) => {
    const { data, error } = await admin.rpc('quota_status', { p_user_id: user.id, p_bucket: bucket });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw new Error('quota_status failed');
    return snapshot(bucket, plan, row, quotaLimit(bucket, plan));
  };
  const [ai, zinc] = await Promise.all([read('ai'), read('zinc')]);
  return { plan, buckets: { ai, zinc } };
}

const BUCKET_NOUN: Record<QuotaBucket, string> = { ai: 'AI messages', zinc: 'product searches' };

/** Standard 429 body for a quota-exceeded response. */
export function quotaExceededBody(s: QuotaSnapshot) {
  const resetDate = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(s.resetsAt));
  return {
    error: {
      code: 'quota_exceeded',
      message: `You've used all ${s.limit} ${BUCKET_NOUN[s.bucket]} included with your ${s.plan} plan this month. ` +
        `Your allowance resets on ${resetDate}. Upgrade your plan for more.`,
      bucket: s.bucket,
      plan: s.plan,
      used: s.used,
      limit: s.limit,
      resetsAt: s.resetsAt,
    },
  };
}
