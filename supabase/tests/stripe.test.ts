import assert from 'node:assert/strict';
import Stripe from 'npm:stripe@17.7.0';
import { handleWebhook } from '../functions/stripe-webhook/handler.ts';
import { paymentStripe, resolveCustomer } from '../functions/_shared/stripe-backend.ts';

function testEnvironment() {
  Deno.env.set('STRIPE_SECRET_KEY', 'sk_test_offline_fixture');
  Deno.env.set('STRIPE_WEBHOOK_SECRET', 'offline-signing-fixture');
  Deno.env.set('SUPABASE_URL', 'https://staging.example.invalid');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'offline-service-fixture');
}
const stripe = new Stripe('sk_test_offline_fixture');
async function signed(payload: string, timestamp?: number) {
  return stripe.webhooks.generateTestHeaderStringAsync({ payload, secret: 'offline-signing-fixture', timestamp });
}
function request(body: string, signature?: string) {
  return new Request('https://example.invalid/stripe-webhook', {
    method: 'POST', body, headers: signature ? { 'stripe-signature': signature } : {},
  });
}
Deno.test('webhook verifies raw signature, timestamp, mode and own-account scope without network', async () => {
  testEnvironment();
  const body = JSON.stringify({ id: 'evt_test', type: 'unhandled.fixture', livemode: false, data: { object: {} } });
  assert.equal((await handleWebhook(request(body, await signed(body)))).status, 200);
  assert.equal((await handleWebhook(request(body))).status, 400);
  assert.equal((await handleWebhook(request(body + ' ', await signed(body)))).status, 400);
  assert.equal((await handleWebhook(request(body, await signed(body, 100)))).status, 400);
  for (const extra of [{ livemode: true }, { account: 'acct_connected_fixture' }]) {
    const other = JSON.stringify({ ...JSON.parse(body), ...extra });
    assert.equal((await handleWebhook(request(other, await signed(other)))).status, 400);
  }
  Deno.env.delete('STRIPE_WEBHOOK_SECRET');
  assert.equal((await handleWebhook(request(body, await signed(body)))).status, 503);
});
Deno.test('production refuses a test secret before attempting a Stripe request', () => {
  testEnvironment();
  Deno.env.set('SUPABASE_URL', 'https://fpphpncruohjlppqhfep.supabase.co');
  assert.throws(() => paymentStripe(), /live backend key/);
});

Deno.test('customer transition preserves historical IDs and uses idempotent creation only for missing objects', async () => {
  testEnvironment();
  const user = { id: 'user-fixture', email: 'test@example.invalid', user_metadata: { stripe_customer_id: 'cus_previous' }, app_metadata: {} };
  let created = 0;
  let saved: any;
  const api: any = { customers: {
    retrieve: async () => { throw { code: 'resource_missing' }; },
    create: async (_data: unknown, options: any) => {
      assert.match(options.idempotencyKey, /fetchit-customer-test-user-fixture/);
      created++; return { id: 'cus_new', livemode: false, metadata: { supabase_uid: user.id } };
    },
  } };
  const admin: any = { auth: { admin: { updateUserById: async (_id: string, data: unknown) => { saved = data; return {}; } } } };
  assert.equal(await resolveCustomer(admin, api, user as any, true), 'cus_new');
  assert.deepEqual(saved.app_metadata.stripe_customer_history, ['cus_previous']);
  assert.equal(saved.app_metadata.stripe_customers.test, 'cus_new');
  api.customers.retrieve = async () => { throw { code: 'api_connection_error' }; };
  await assert.rejects(() => resolveCustomer(admin, api, user as any, true));
  assert.equal(created, 1);
  api.customers.retrieve = async () => ({ id: 'cus_other', livemode: false, metadata: { supabase_uid: 'other-user' } });
  await assert.rejects(() => resolveCustomer(admin, api, user as any, true));
  assert.equal(created, 1);
  api.customers.retrieve = async () => { throw { code: 'resource_missing' }; };
  await assert.rejects(() => resolveCustomer(admin, api, user as any, false));
  assert.equal(created, 1);
});
