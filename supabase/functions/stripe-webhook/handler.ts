import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';
import { SUBSCRIPTION_EVENTS, subscriptionState } from '../_shared/stripe-subscription-state.mjs';

const reply = (status: number, body: Record<string, unknown>) =>
  Response.json(body, { status });

// No JWT: Stripe authenticates with the endpoint-specific signing secret.
export async function handleWebhook(req: Request): Promise<Response> {
  if (req.method !== 'POST') return reply(405, { error: 'method_not_allowed' });
  const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const signingSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!key || !signingSecret || !url || !serviceKey) return reply(503, { error: 'webhook_not_configured' });
  const live = key.startsWith('sk_live_');
  if (!live && !key.startsWith('sk_test_')) return reply(503, { error: 'invalid_key_mode' });
  if (new URL(url).hostname === 'fpphpncruohjlppqhfep.supabase.co' && !live) {
    return reply(503, { error: 'production_requires_live_key' });
  }
  const signature = req.headers.get('stripe-signature');
  if (!signature) return reply(400, { error: 'missing_signature' });
  const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  let event: Stripe.Event;
  try {
    const raw = await req.text();
    event = await stripe.webhooks.constructEventAsync(raw, signature, signingSecret,
      undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return reply(400, { error: 'invalid_signature' });
  }
  if (event.livemode !== live || event.account) return reply(400, { error: 'wrong_environment_or_account_scope' });
  if (!SUBSCRIPTION_EVENTS.has(event.type)) return reply(200, { received: true, ignored: true });

  try {
    const object = event.data.object as Stripe.Subscription | Stripe.Invoice;
    const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
    if (!customerId) return reply(400, { error: 'missing_customer' });
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) return reply(200, { received: true, ignored: true });
    if (customer.livemode !== live) return reply(400, { error: 'customer_mode_mismatch' });
    const userId = customer.metadata.supabase_uid;
    if (!userId) return reply(200, { received: true, ignored: true });

    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await admin.auth.admin.getUserById(userId);
    if (error || !data.user) throw new Error('User lookup failed');
    if (data.user.user_metadata.stripe_customer_id !== customerId) {
      return reply(200, { received: true, ignored: true });
    }
    // Re-read current state, including other subscriptions after a plan change.
    // Event delivery order is not guaranteed. SQL applies snapshots atomically.
    const snapshotStarted = new Date().toISOString();
    const subscriptions: Stripe.Subscription[] = [];
    for await (const sub of stripe.subscriptions.list({ customer: customerId, status: 'all', limit: 100 })) {
      if (sub.livemode !== live) throw new Error('Subscription mode mismatch');
      subscriptions.push(sub);
    }
    const state = subscriptionState(subscriptions);
    const { error: applyError } = await admin.rpc('apply_stripe_subscription_snapshot', {
      p_event_id: event.id, p_livemode: live, p_user_id: userId,
      p_customer_id: customerId, p_snapshot_started: snapshotStarted,
      p_state: state,
    });
    if (applyError) throw new Error('Snapshot persistence failed');
    return reply(200, { received: true });
  } catch {
    // Never log raw Stripe errors, request bodies, credentials, or customer data.
    // Non-2xx delivery is retried by Stripe; failed work is not marked complete.
    return reply(500, { error: 'reconciliation_failed' });
  }
}
