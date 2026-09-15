import Stripe from 'npm:stripe@17.7.0';
import { SUBSCRIPTION_EVENTS } from '../_shared/stripe-subscription-state.mjs';
const PROJECT = 'fpphpncruohjlppqhfep';
const ORIGINAL = 'we_1UFn7YQg8UTscDtyMlgwUZy0';
const ADDITIONAL = 'we_1UFnTvQg8UTscDtyzYEbRfnv';
const URL = `https://${PROJECT}.supabase.co/functions/v1/stripe-webhook`;
const reply = (status: number, error: string) => Response.json({ error }, { status });

export async function cleanup(req: Request) {
  if (req.method !== 'POST') return reply(405, 'method_not_allowed');
  const authorization = req.headers.get('authorization');
  if (!authorization?.startsWith('Bearer ')) return reply(401, 'admin_login_required');
  // Verify existing CLI login can access this project's privileged API keys.
  // Response values are discarded, never returned or logged.
  try {
    const access = await fetch(`https://api.supabase.com/v1/projects/${PROJECT}/api-keys`, {
      headers: { authorization }, redirect: 'error',
    });
    await access.body?.cancel();
    if (!access.ok) return reply(403, 'production_admin_access_required');
  } catch { return reply(503, 'admin_verification_unavailable'); }
  const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!key?.startsWith('sk_live_') || !secret) return reply(503, 'live_secrets_required');
  const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  const signature = req.headers.get('stripe-signature') || '';
  const body = await req.text();
  let event;
  try {
    event = await stripe.webhooks.constructEventAsync(body, signature, secret, 60, Stripe.createSubtleCryptoProvider());
  } catch { return reply(400, 'original_secret_verification_failed'); }
  const intent = event.data?.object as unknown as { retain?: string; disable?: string };
  if (String(event.type) !== 'fetchit.webhook_cleanup' || event.livemode !== true || event.account ||
      intent?.retain !== ORIGINAL || intent?.disable !== ADDITIONAL) return reply(400, 'invalid_cleanup_intent');
  const matches = (e: Stripe.WebhookEndpoint) => e.url === URL && e.livemode &&
    e.api_version === '2025-02-24.acacia' && e.application === null &&
    e.enabled_events.length === SUBSCRIPTION_EVENTS.size && e.enabled_events.every(x => SUBSCRIPTION_EVENTS.has(x));
  let disabled = false;
  try {
    if ((await stripe.accounts.retrieve()).id !== 'acct_1Th9uUQg8UTscDty') return reply(409, 'wrong_account');
    const original = await stripe.webhookEndpoints.retrieve(ORIGINAL);
    const additional = await stripe.webhookEndpoints.retrieve(ADDITIONAL);
    if (!matches(original) || original.status !== 'enabled' || !matches(additional)) return reply(409, 'endpoint_configuration_changed');
    // Confirm the candidate's proof against the actual handler before mutation.
    // Its unsupported type is ignored before billing/database reconciliation.
    const probe = await fetch(URL, { method: 'POST', headers: { 'content-type': 'application/json', 'stripe-signature': signature }, body, redirect: 'error' });
    const result = await probe.json();
    if (!probe.ok || result.received !== true || result.ignored !== true) return reply(409, 'deployed_handler_verification_failed');
    if (additional.status !== 'disabled') await stripe.webhookEndpoints.update(ADDITIONAL, { disabled: true });
    disabled = true;
    const retained = await stripe.webhookEndpoints.retrieve(ORIGINAL);
    const redundant = await stripe.webhookEndpoints.retrieve(ADDITIONAL);
    if (!matches(retained) || retained.status !== 'enabled' || redundant.status !== 'disabled') return reply(502, 'post_update_verification_failed');
    return Response.json({ retained: ORIGINAL, disabled: ADDITIONAL, originalSecretVerified: true, secretsChanged: false });
  } catch {
    return reply(502, disabled ? 'disable_applied_readback_failed' : 'cleanup_failed_check_endpoint_status');
  }
}
