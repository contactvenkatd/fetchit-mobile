// Test-only network boundary. Never reads production environment variable names.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const keyPath = path.join(os.tmpdir(), 'fetchit-checkout-zinc-sandbox-key');
async function sandboxKey() {
  let key = process.env.CHECKOUT_ZINC_TEST_KEY;
  if (!key && fs.existsSync(keyPath)) key = fs.readFileSync(keyPath, 'utf8').trim();
  if (!key) {
    const response = await fetch('https://api.zinc.com/sandbox/keys', {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'FetchIt isolated automated checkout' }),
    });
    if (!response.ok) throw new Error(`Sandbox mint HTTP ${response.status}; no automatic retry`);
    key = (await response.json()).api_key;
    assert.match(key || '', /^zn_test_/);
    fs.writeFileSync(keyPath, key, { mode: 0o600, flag: 'wx' });
  }
  assert.match(key, /^zn_test_/, 'Only Zinc test keys are allowed');
  return key;
}
function sandboxFetch(key, verifiedSearchUrls = []) {
  assert.match(key, /^zn_test_/);
  for (const url of verifiedSearchUrls) assert.match(url, /^https:\/\/www\.(?:etsy\.com\/listing\/\d+\/|amazon\.com\/dp\/[A-Z0-9]{10}$)/);
  return async (url, options = {}) => {
    const target = new URL(url);
    assert.equal(target.origin, 'https://api.zinc.com');
    assert.match(target.pathname, /^\/orders(?:\/[a-f0-9-]{36})?$/i);
    assert.equal(target.search, '');
    if (options.method === 'POST') {
      const body = JSON.parse(options.body);
      assert.ok(body.products.every(x => /^https:\/\/zinc.com\/shop\/products\/test-[a-z-]+$/.test(x.url) || verifiedSearchUrls.includes(x.url)));
      assert.equal(body.payment?.mode, 'connect');
      assert.equal(body.payment.margin.type, 'flat');
      assert.ok(Number.isSafeInteger(body.payment.margin.value) && body.payment.margin.value >= 200);
      assert.ok(body.payment.margin.value <= 10000, 'Sandbox fee limit');
      assert.ok(body.idempotency_key);
    } else assert.ok(!options.method || options.method === 'GET');
    return fetch(url, { ...options, headers: { ...options.headers, Authorization: `Bearer ${key}` },
      redirect: 'error', signal: AbortSignal.timeout(10000) });
  };
}
async function stripeComponents(key) {
  assert.match(key, /^sk_test_/, 'Only explicit Stripe test secrets are allowed');
  const runId = crypto.randomUUID();
  let stage = 'authorization';
  const request = async (suffix, fields, idempotency) => {
    assert.match(suffix, /^payment_intents(?:\/pi_[a-zA-Z0-9]+(?:\/capture|\/cancel)?)?$/);
    const response = await fetch(`https://api.stripe.com/v1/${suffix}`, {
      method: fields ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded',
        ...(idempotency ? { 'Idempotency-Key': idempotency } : {}) },
      body: fields ? new URLSearchParams(fields) : undefined,
    });
    const data = await response.json();
    if (data.object === 'payment_intent') assert.equal(data.livemode, false);
    return { response, data };
  };
  const fields = { amount: '1100', currency: 'usd', capture_method: 'manual', confirm: 'true',
    payment_method: 'pm_card_visa', 'payment_method_types[]': 'card', 'metadata[checkout_test_run]': runId };
  let intent;
  try {
    const first = await request('payment_intents', fields, `${runId}-authorize`);
    assert.equal(first.response.ok, true); intent = first.data;
    assert.equal(intent.status, 'requires_capture'); assert.equal(intent.amount_received, 0);
    assert.equal(intent.amount_capturable, 1100);
    stage = 'idempotent authorization';
    const duplicate = await request('payment_intents', fields, `${runId}-authorize`);
    assert.equal(duplicate.data.id, intent.id);
    assert.equal(duplicate.response.ok, true);
    stage = 'excessive capture rejection';
    const excessive = await request(`payment_intents/${intent.id}/capture`, { amount_to_capture: '1101' }, `${runId}-excessive`);
    assert.equal(excessive.response.ok, false);
    const held = await request(`payment_intents/${intent.id}`);
    assert.equal(held.response.ok, true);
    assert.equal(held.data.status, 'requires_capture');
    assert.equal(held.data.amount_received, 0);
    assert.equal(held.data.amount_capturable, 1100);
    stage = 'lower capture';
    const partial = await request(`payment_intents/${intent.id}/capture`, { amount_to_capture: '950' }, `${runId}-capture`);
    assert.equal(partial.response.ok, true); assert.equal(partial.data.amount_received, 950);
    assert.equal(partial.data.amount_capturable, 0); assert.equal(partial.data.status, 'succeeded');
    stage = 'captured amount retrieval';
    const captured = await request(`payment_intents/${intent.id}`);
    assert.equal(captured.response.ok, true);
    assert.equal(captured.data.amount_received, 950);
    assert.equal(captured.data.amount_capturable, 0);
    stage = 'card decline';
    const declined = await request('payment_intents', { ...fields, payment_method: 'pm_card_chargeDeclined' }, `${runId}-decline`);
    assert.equal(declined.response.ok, false); assert.equal(declined.data.error?.code, 'card_declined');
    return { outcome: 'passed', scope: 'Stripe test component only; not Zinc Connect', runId,
      livemode: false, authorizedCents: 1100, rejectedCaptureCents: 1101,
      actualCapturedCents: captured.data.amount_received,
      remainingCapturableCents: captured.data.amount_capturable,
      idempotencyVerified: true, declineVerified: true };
  } catch (error) {
    error.stage = stage;
    throw error;
  } finally {
    if (intent) {
      const current = await request(`payment_intents/${intent.id}`);
      if (current.data.status === 'requires_capture') await request(`payment_intents/${intent.id}/cancel`, {}, `${runId}-cleanup`);
    }
  }
}
module.exports = { sandboxKey, sandboxFetch, stripeComponents };
