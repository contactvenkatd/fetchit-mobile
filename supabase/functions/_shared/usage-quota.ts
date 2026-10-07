// Per-user monthly DOLLAR budgets for the paid upstreams, metered at actual
// cost: 'ai' = xAI/Grok (parse-shopping-intent), 'zinc' = Zinc data calls
// (search-products). Spend lives in public.usage_quotas.cents_used (exact
// numeric cents) and moves only through the quota_consume RPC.
//
// Flow per paid request: checkQuota() before the upstream call (rejects when
// the budget is used up), then chargeQuota() with the call's ACTUAL cost once
// it is known. A request that passes the check is charged in full even if it
// overshoots the remaining budget — overshoot is bounded by one request
// (≤16¢ for a search, ~1¢ for a chat call).
//
// The plan sizing the budget is VERIFIED against Stripe (and the family
// owner's Stripe plan for max_family members) — user_metadata.plan is
// client-writable and is never used.
import { createClient, type SupabaseClient, type User } from 'npm:@supabase/supabase-js@2';
import { paymentStripe, stripeIsLive } from './stripe-backend.ts';
import { subscriptionState } from './stripe-subscription-state.mjs';

export type QuotaBucket = 'ai' | 'zinc';
export type QuotaPlan = 'Free' | 'Plus' | 'Pro' | 'Max';

const PLANS: QuotaPlan[] = ['Free', 'Plus', 'Pro', 'Max'];
const PLAN_RANK: Record<QuotaPlan, number> = { Free: 0, Plus: 1, Pro: 2, Max: 3 };

// Monthly budget per bucket, in cents. COGS = price × (1 − margin), split
// 50/50 between Zinc and Grok:
//   Plus  $4.99 × 0.90  = $4.491    → 224.55¢ each
//   Pro  $19.99 × 0.875 = $17.49125 → 874.5625¢ each
//   Max  $99.99 × 0.80  = $79.992   → 3999.6¢ each
//   Free: capped loss-leader of $1.00/user/month → 50¢ each.
// Fallbacks only: override with QUOTA_<AI|ZINC>_<FREE|PLUS|PRO|MAX>_CENTS.
export const DEFAULT_BUDGET_CENTS: Record<QuotaPlan, Record<QuotaBucket, number>> = {
  Free: { ai: 50, zinc: 50 },
  Plus: { ai: 224.55, zinc: 224.55 },
  Pro: { ai: 874.5625, zinc: 874.5625 },
  Max: { ai: 3999.6, zinc: 3999.6 },
};
const MAX_BUDGET_CENTS = 100_000_000;

// Cost arithmetic is done in integer micro-cents (1e-6 ¢) so it is exact, then
// sent to Postgres numeric as a decimal string.
const MICROCENTS_PER_CENT = 1_000_000;
export const ZINC_CALL_MICROCENTS = 1 * MICROCENTS_PER_CENT; // $0.01 per successful data call

// grok-4.3 per-token rates in micro-cents: $1.25/M input = 125 µ¢/token,
// $0.20/M cached input = 20, $2.50/M output = 250. Prompts of ≥200k tokens
// bill every token at double rates.
const GROK_RATES = { input: 125, cached: 20, output: 250, longContextTokens: 200_000 };
// Charged when an OK response has no usage block: the measured worst case
// (~4,150 input + ~2,000 output tokens ≈ 1.019¢).
export const GROK_FALLBACK_MICROCENTS = 4_150 * GROK_RATES.input + 2_000 * GROK_RATES.output;

// How long a Stripe-verified plan is reused before re-checking Stripe.
const DEFAULT_PLAN_CACHE_SECONDS = 300;
// A denied check re-verifies a cached plan older than this, so an upgrade
// takes effect right away instead of after the cache expires.
const DENIED_RECHECK_SECONDS = 60;

export interface QuotaSnapshot {
  bucket: QuotaBucket;
  plan: QuotaPlan;
  usedCents: number;
  limitCents: number;
  remainingCents: number;
  periodKey: string;
  resetsAt: string;
}

export type QuotaDecision =
  | { allowed: true; snapshot: QuotaSnapshot | null }
  | { allowed: false; reason: 'exceeded'; snapshot: QuotaSnapshot }
  | { allowed: false; reason: 'unavailable' };

export function budgetCents(bucket: QuotaBucket, plan: QuotaPlan): number {
  const name = `QUOTA_${bucket.toUpperCase()}_${plan.toUpperCase()}_CENTS`;
  const raw = Deno.env.get(name)?.trim();
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed >= 0 && parsed <= MAX_BUDGET_CENTS) return parsed;
  if (raw) console.warn(`usage-quota: ignoring invalid ${name}`);
  return DEFAULT_BUDGET_CENTS[plan][bucket];
}

/** Integer micro-cents → exact decimal cents string for Postgres numeric. */
export function microcentsToCents(micro: number): string {
  const value = Math.max(0, Math.round(micro));
  return `${Math.floor(value / MICROCENTS_PER_CENT)}.${String(value % MICROCENTS_PER_CENT).padStart(6, '0')}`;
}

type GrokUsage = {
  prompt_tokens?: unknown;
  completion_tokens?: unknown;
  total_tokens?: unknown;
  prompt_tokens_details?: { cached_tokens?: unknown } | null;
  completion_tokens_details?: { reasoning_tokens?: unknown } | null;
};

const count = (value: unknown) =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

/**
 * Actual cost of one grok-4.3 chat completion from its `usage` block, in
 * micro-cents. cached_tokens is a subset of prompt_tokens (xAI prompt-caching
 * docs). Reasoning tokens bill at the output rate; xAI's docs don't say
 * whether completion_tokens already includes them, so billed output is
 * total_tokens − prompt_tokens, which is right either way and never counts
 * reasoning twice. Returns null when usage is missing or malformed.
 */
export function grokCostMicrocents(usage: GrokUsage | null | undefined): number | null {
  const prompt = count(usage?.prompt_tokens);
  const completion = count(usage?.completion_tokens);
  if (prompt === null || completion === null) return null;
  const cached = Math.min(count(usage?.prompt_tokens_details?.cached_tokens) ?? 0, prompt);
  const reasoning = count(usage?.completion_tokens_details?.reasoning_tokens) ?? 0;
  const total = count(usage?.total_tokens);
  const output = total !== null && total >= prompt + completion
    ? total - prompt
    : completion + reasoning;
  const multiplier = prompt >= GROK_RATES.longContextTokens ? 2 : 1;
  return multiplier *
    ((prompt - cached) * GROK_RATES.input + cached * GROK_RATES.cached + output * GROK_RATES.output);
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
    if (plan && PLANS.includes(plan) && PLAN_RANK[plan] > PLAN_RANK[best]) best = plan;
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
  const cachedPlan = cached && PLANS.includes(cached.plan) ? cached.plan as QuotaPlan : null;
  if (cachedPlan && Number.isFinite(cachedAt) && Date.now() - cachedAt <= maxAgeSeconds * 1000) {
    return { plan: cachedPlan, verifiedAt: cachedAt };
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
    return { plan: cachedPlan ?? 'Free', verifiedAt: Number.isFinite(cachedAt) ? cachedAt : 0 };
  }
}

type ConsumeRow = {
  allowed: boolean; cents_used: number | string; limit_cents: number | string;
  remaining_cents: number | string; period: string; resets_at: string;
};

async function consume(
  admin: SupabaseClient, userId: string, bucket: QuotaBucket, limitCents: number,
  costMicrocents: number, enforce: boolean,
): Promise<ConsumeRow> {
  const { data, error } = await admin.rpc('quota_consume', {
    p_user_id: userId, p_bucket: bucket, p_limit_cents: limitCents,
    p_cost_cents: microcentsToCents(costMicrocents), p_enforce: enforce,
  });
  const row = Array.isArray(data) ? data[0] : data;
  if (error || !row || typeof row.allowed !== 'boolean') throw new Error('quota_consume failed');
  return row as ConsumeRow;
}

function snapshot(
  bucket: QuotaBucket, plan: QuotaPlan,
  row: { cents_used: number | string; period: string; resets_at: string }, limitCents: number,
): QuotaSnapshot {
  const usedCents = Number(row.cents_used);
  return {
    bucket, plan, usedCents, limitCents,
    remainingCents: Math.max(0, limitCents - usedCents),
    periodKey: row.period,
    resetsAt: new Date(row.resets_at).toISOString(),
  };
}

/**
 * Pre-flight before a paid upstream call: allowed only while budget remains.
 * Fail policy when the quota system itself breaks: 'ai' fails OPEN (chat keeps
 * working), 'zinc' fails CLOSED (protects spend).
 */
export async function checkQuota(user: User, bucket: QuotaBucket): Promise<QuotaDecision> {
  const failOpen = bucket === 'ai';
  const admin = serviceClient();
  if (!admin) {
    console.error(`usage-quota: service client unavailable (${bucket})`);
    return failOpen ? { allowed: true, snapshot: null } : { allowed: false, reason: 'unavailable' };
  }
  try {
    let { plan, verifiedAt } = await resolveVerifiedPlan(admin, user);
    let limit = budgetCents(bucket, plan);
    let row = await consume(admin, user.id, bucket, limit, 0, true);

    // Hard stop, but give a just-upgraded user their new budget immediately.
    if (!row.allowed && Date.now() - verifiedAt > DENIED_RECHECK_SECONDS * 1000) {
      const fresh = await resolveVerifiedPlan(admin, user, 0);
      const freshLimit = budgetCents(bucket, fresh.plan);
      if (freshLimit > limit) {
        plan = fresh.plan; limit = freshLimit;
        row = await consume(admin, user.id, bucket, limit, 0, true);
      }
    }

    const result = snapshot(bucket, plan, row, limit);
    return row.allowed ? { allowed: true, snapshot: result } : { allowed: false, reason: 'exceeded', snapshot: result };
  } catch {
    console.error(`usage-quota: quota check failed (${bucket})`);
    return failOpen ? { allowed: true, snapshot: null } : { allowed: false, reason: 'unavailable' };
  }
}

/**
 * Debit the ACTUAL cost of upstream calls that already happened. Always
 * recorded (the money is spent) even if it overshoots the budget; the next
 * checkQuota then rejects. Never throws — a failed debit is logged and the
 * already-paid-for response is still returned to the user.
 */
export async function chargeQuota(
  user: User, bucket: QuotaBucket, costMicrocents: number, check: QuotaDecision,
): Promise<void> {
  if (!(costMicrocents > 0)) return;
  const admin = serviceClient();
  if (!admin) {
    console.error(`usage-quota: could not record ${bucket} spend (service client unavailable)`);
    return;
  }
  try {
    const limit = check.allowed && check.snapshot ? check.snapshot.limitCents : 0;
    await consume(admin, user.id, bucket, limit, costMicrocents, false);
  } catch {
    console.error(`usage-quota: could not record ${bucket} spend`);
  }
}

/** Read-only spend for every bucket (no debit). Throws if unavailable. */
export async function quotaStatus(user: User): Promise<{ plan: QuotaPlan; buckets: Record<QuotaBucket, QuotaSnapshot> }> {
  const admin = serviceClient();
  if (!admin) throw new Error('Quota service unavailable');
  const { plan } = await resolveVerifiedPlan(admin, user);
  const read = async (bucket: QuotaBucket) => {
    const limit = budgetCents(bucket, plan);
    const { data, error } = await admin.rpc('quota_status', {
      p_user_id: user.id, p_bucket: bucket, p_limit_cents: limit,
    });
    const row = Array.isArray(data) ? data[0] : data;
    if (error || !row) throw new Error('quota_status failed');
    return snapshot(bucket, plan, row, limit);
  };
  const [ai, zinc] = await Promise.all([read('ai'), read('zinc')]);
  return { plan, buckets: { ai, zinc } };
}

const BUCKET_NOUN: Record<QuotaBucket, string> = { ai: 'AI chat', zinc: 'product search' };

export const formatUsd = (cents: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.floor(cents) / 100);

/** Standard 429 body for a budget-exceeded response. */
export function quotaExceededBody(s: QuotaSnapshot) {
  const resetDate = new Intl.DateTimeFormat('en-US', {
    month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  }).format(new Date(s.resetsAt));
  return {
    error: {
      code: 'quota_exceeded',
      message: `You've used this month's ${formatUsd(s.limitCents)} ${BUCKET_NOUN[s.bucket]} budget on your ` +
        `${s.plan} plan. It resets on ${resetDate}. Upgrade your plan for a bigger budget.`,
      bucket: s.bucket,
      plan: s.plan,
      usedCents: s.usedCents,
      limitCents: s.limitCents,
      resetsAt: s.resetsAt,
    },
  };
}
