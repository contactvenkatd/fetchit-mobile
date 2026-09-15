const assert = require('node:assert/strict');
const test = require('node:test');
const resolve = require('../config/payment-environment');
const config = require('../app.config');
const base = require('../app.json').expo;
const eas = require('../eas.json');

test('production resolves the approved public key and production backend', () => {
  const result = resolve({ ...eas.build.production.env, EAS_BUILD_PROFILE: 'production' });
  assert.equal(result.stripePublishableKey, eas.build.production.env.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  assert.equal(result.supabaseUrl, 'https://fpphpncruohjlppqhfep.supabase.co');
});

test('development, preview, and test cannot reach production by default', () => {
  for (const APP_ENV of ['development', 'preview', 'test']) {
    const result = resolve({ APP_ENV });
    assert.ok(result.stripePublishableKey.startsWith('pk_test_'));
    assert.equal(result.supabaseUrl, 'http://127.0.0.1:54321');
    assert.throws(() => resolve({ APP_ENV, EXPO_PUBLIC_SUPABASE_URL: 'https://fpphpncruohjlppqhfep.supabase.co/' }));
    assert.throws(() => resolve({ APP_ENV, EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_fixture' }));
  }
  assert.equal(eas.build.preview.environment, 'preview');
});

test('rejects mode conflicts, wrong production keys, and privileged backend keys', () => {
  assert.throws(() => resolve({ APP_ENV: 'production', EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture' }));
  assert.throws(() => resolve({ APP_ENV: 'production', EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_live_wrong_account' }));
  assert.throws(() => resolve({ APP_ENV: 'production', NODE_ENV: 'test' }));
  assert.throws(() => resolve({ APP_ENV: 'production', EAS_BUILD_PROFILE: 'preview' }));
  assert.throws(() => resolve({ APP_ENV: 'production', EXPO_PUBLIC_SUPABASE_URL: 'https://staging.example.com' }));
  assert.throws(() => resolve({ EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_secret_fixture' }));
  const jwt = `header.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.signature`;
  assert.throws(() => resolve({ EXPO_PUBLIC_SUPABASE_ANON_KEY: jwt }));
});

test('staging accepts public test credentials and never serializes backend secrets', () => {
  const input = {
    APP_ENV: 'preview', EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY: 'pk_test_fixture',
    EXPO_PUBLIC_SUPABASE_URL: 'https://staging.example.com',
    EXPO_PUBLIC_SUPABASE_ANON_KEY: 'sb_publishable_fixture',
    STRIPE_SECRET_KEY: 'backend-only-sentinel', STRIPE_WEBHOOK_SECRET: 'webhook-only-sentinel',
  };
  const result = resolve(input);
  assert.equal(result.supabaseUrl, input.EXPO_PUBLIC_SUPABASE_URL);
  assert.equal(result.stripePublishableKey, input.EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY);
  assert.doesNotMatch(JSON.stringify(result), /sentinel/);
});

test('payment configuration preserves App Attest profile selection', () => {
  const old = { ...process.env };
  try {
    for (const profile of ['development', 'preview', 'production']) {
      process.env.EAS_BUILD_PROFILE = profile;
      process.env.APP_ENV = profile;
      const result = config({ config: base }).expo;
      const expected = profile === 'development' ? 'development' : 'production';
      assert.equal(result.ios.entitlements['com.apple.developer.devicecheck.appattest-environment'], expected);
      assert.equal(result.plugins.find(p => Array.isArray(p) && p[0] === './plugins/withAppAttest')[1].environment, expected);
    }
  } finally {
    for (const name of ['APP_ENV', 'EAS_BUILD_PROFILE']) {
      if (old[name] === undefined) delete process.env[name]; else process.env[name] = old[name];
    }
  }
});
