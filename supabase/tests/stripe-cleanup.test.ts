import assert from 'node:assert/strict';
import Stripe from 'npm:stripe@17.7.0';
import { cleanup } from '../functions/stripe-webhook-cleanup/handler.ts';
import { SUBSCRIPTION_EVENTS } from '../functions/_shared/stripe-subscription-state.mjs';
const original = 'we_1UFn7YQg8UTscDtyMlgwUZy0';
const additional = 'we_1UFnTvQg8UTscDtyzYEbRfnv';
Deno.test('cleanup requires admin and original-secret proof, and only disables fixed duplicate', async () => {
  const savedFetch = globalThis.fetch;
  const savedKey = Deno.env.get('STRIPE_SECRET_KEY');
  const savedSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  Deno.env.set('STRIPE_SECRET_KEY', 'sk_live_offline_fixture');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'offline_fixture');
  const mutations: string[] = [];
  let disabled = false;
  let adminAllowed = true;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (url.startsWith('https://api.supabase.com/')) return Response.json([], { status: adminAllowed ? 200 : 403 });
    if (url.endsWith('/stripe-webhook')) return Response.json({ received: true, ignored: true });
    if (url.endsWith('/account')) return Response.json({ id: 'acct_1Th9uUQg8UTscDty' });
    if (init?.method === 'POST') {
      mutations.push(url);
      assert.equal(url, `https://api.stripe.com/v1/webhook_endpoints/${additional}`);
      assert.equal(String(init.body), 'disabled=true');
      disabled = true;
    }
    const id = url.split('/').pop();
    return Response.json({ id, url: 'https://fpphpncruohjlppqhfep.supabase.co/functions/v1/stripe-webhook',
      api_version: '2025-02-24.acacia', application: null, livemode: true,
      enabled_events: [...SUBSCRIPTION_EVENTS], status: id === additional && disabled ? 'disabled' : 'enabled' });
  };
  try {
    const stripe = new Stripe('sk_test_offline_fixture');
    const payload = JSON.stringify({ id: 'evt_fixture', type: 'fetchit.webhook_cleanup', livemode: true,
      data: { object: { retain: original, disable: additional } } });
    const signature = await stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'offline_fixture' });
    const req = (sig = signature, auth = true) => new Request('https://example.invalid', { method: 'POST', body: payload,
      headers: { 'stripe-signature': sig, ...(auth ? { authorization: 'Bearer offline_admin' } : {}) } });
    assert.equal((await cleanup(req(signature, false))).status, 401);
    adminAllowed = false;
    assert.equal((await cleanup(req())).status, 403);
    adminAllowed = true;
    assert.equal((await cleanup(req('bad_signature'))).status, 400);
    assert.equal(mutations.length, 0);
    const response = await cleanup(req());
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { retained: original, disabled: additional, originalSecretVerified: true, secretsChanged: false });
    assert.equal(mutations.length, 1);
    assert.equal((await cleanup(req())).status, 200);
    assert.equal(mutations.length, 1); // Already-disabled retry is read-only.
  } finally {
    globalThis.fetch = savedFetch;
    for (const [name, value] of [['STRIPE_SECRET_KEY', savedKey], ['STRIPE_WEBHOOK_SECRET', savedSecret]]) {
      if (value === undefined) Deno.env.delete(name!); else Deno.env.set(name!, value);
    }
  }
});
