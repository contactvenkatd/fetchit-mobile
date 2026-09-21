const test = require('node:test');
const assert = require('node:assert/strict');
const { createSetupSession, validateSetupResponse } = require('../src/lib/setup-session.mjs');
const { validateSetupClient, verifiedSetupResponse } = require('../supabase/functions/_shared/setup-contract.mjs');
const key = 'pk_test_fixture';
const intent = { id: 'seti_fixture', client_secret: 'seti_fixture_secret_complete', livemode: false };

test('same exact client secret is verified and forwarded without truncation', async () => {
  const publicStripe = { setupIntents: { retrieve: async (id, params) => {
    assert.equal(id, intent.id); assert.equal(params.client_secret, intent.client_secret); return intent;
  } } };
  const response = await verifiedSetupResponse(publicStripe, intent, 'cus_fixture', key);
  assert.equal(validateSetupResponse(response, key).clientSecret, intent.client_secret);
  for (const change of [
    { clientSecret: 'seti_fixture' }, { clientSecret: 'seti_other_secret_complete' },
    { clientSecret: intent.client_secret + ' ' }, { livemode: true },
    { publishableKey: 'pk_test_other' }, { stripeAccountId: 'acct_other' }, { keyPairVerified: false },
  ]) assert.throws(() => validateSetupResponse({ ...response, ...change }, key));
});

test('backend rejects mode and Connect mismatches and failed public-key readback', async () => {
  assert.equal(validateSetupClient({}, true), null); // existing web contract
  assert.equal(validateSetupClient({ publishableKey: key, stripeAccountId: null }, false), key);
  for (const body of [{ publishableKey: key }, { publishableKey: 'sk_live_private' },
    { publishableKey: 'pk_live_fixture', stripeAccountId: 'acct_connected' }]) {
    assert.throws(() => validateSetupClient(body, true));
  }
  await assert.rejects(verifiedSetupResponse({ setupIntents: { retrieve: async () => { throw Error('resource_missing'); } } }, intent, 'cus_fixture', key));
  await assert.rejects(verifiedSetupResponse({ setupIntents: { retrieve: async () => ({ ...intent, livemode: true }) } }, intent, 'cus_fixture', key));
});

test('duplicate taps are synchronous, account/environment reset rejects stale work', async () => {
  const session = createSetupSession();
  const first = session.begin();
  assert.equal(session.begin(), null);
  const pending = Promise.resolve().then(() => session.current(first));
  session.reset();
  assert.equal(session.begin(), null); // native work must settle before another save
  assert.equal(await pending, false);
  session.finish(first);
  const second = session.begin();
  session.finish(first);
  assert.equal(session.current(second), true);
  session.finish(second);
  assert.ok(session.begin());
});

test('failure releases lock and retry requests a fresh intent', async () => {
  const session = createSetupSession();
  let calls = 0;
  async function attempt() {
    const ticket = session.begin();
    if (!ticket) return;
    try { calls++; throw Error('resource_missing'); }
    finally { session.finish(ticket); }
  }
  await assert.rejects(attempt());
  await assert.rejects(attempt());
  assert.equal(calls, 2);
});

// Evaluate the real runtime module with native dependencies replaced. This
// exercises initialization ordering and production help visibility offline.
function runtimeFixture(environment, initialize) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const ts = require('typescript');
  const source = fs.readFileSync(require.resolve('../src/lib/payment-runtime.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exports = {};
  const publicKey = environment === 'production' ? 'pk_live_fixture' : key;
  vm.runInNewContext(code, { exports, __DEV__: false, require(name) {
    if (name === './stripe') return { STRIPE_PUBLISHABLE_KEY: publicKey };
    if (name === '@stripe/stripe-react-native') return { initStripe: initialize };
    if (name === 'expo-constants') return { __esModule: true, default: {
      expoConfig: { version: '1.0.0', extra: { paymentEnvironment: {
        appEnvironment: environment, supabaseUrl: 'https://fixture.invalid',
      } } }, platform: { ios: { buildNumber: '42' } },
    } };
    throw Error('Unexpected dependency');
  } });
  return exports;
}

test('native initialization is awaited, coalesced, platform scoped and retryable', async () => {
  let resolve;
  let calls = 0;
  const runtime = runtimeFixture('production', (params) => {
    calls++;
    assert.equal(params.publishableKey, 'pk_live_fixture');
    assert.equal(params.stripeAccountId, undefined);
    return new Promise(r => { resolve = r; });
  });
  const first = runtime.ensureStripeReady();
  assert.equal(runtime.ensureStripeReady(), first);
  let ready = false;
  first.then(() => { ready = true; });
  await Promise.resolve();
  assert.equal(ready, false);
  resolve();
  await first;
  assert.equal(ready, true);
  assert.equal(calls, 1);
  let attempts = 0;
  const retry = runtimeFixture('production', async () => {
    if (++attempts === 1) throw Error('native failure');
  });
  await assert.rejects(retry.ensureStripeReady());
  await retry.ensureStripeReady();
  assert.equal(attempts, 2);
});

test('production hides test instructions and diagnostics use the native build number', () => {
  const prod = runtimeFixture('production', async () => {});
  assert.equal(prod.SHOW_TEST_CARD_HELP, false);
  assert.equal(runtimeFixture('development', async () => {}).SHOW_TEST_CARD_HELP, true);
  assert.match(prod.paymentDiagnostics(), /1\.0\.0 \(42\)/);
  assert.match(prod.paymentDiagnostics(), /Stripe: live/);
  assert.doesNotMatch(prod.paymentDiagnostics(), /pk_live_fixture|secret_/);
});
