const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');

const read = (path) => fs.readFileSync(path, 'utf8');
const policyPromise = import('../supabase/functions/_shared/app-attest-policy.mjs');
const recoveryPromise = import('../src/lib/recovery-policy.ts');

test('Google authentication bypass remains disabled', () => {
  for (const screen of ['src/app/login.tsx', 'src/app/signup.tsx']) {
    const source = read(screen);
    assert.match(source, /<GoogleButton onPress=\{handleGoogle\} loading=\{false\} disabled \/>/);
  }
  const gateway = read('supabase/functions/auth-gateway/index.ts');
  assert.match(gateway, /if \(!body\.attestation\)/);
  assert.doesNotMatch(gateway, /provider\s*[:=]\s*["']google["']/);
});

test('stale App Attest key recovery permits only one retry', async () => {
  const { canAttemptRecovery } = await recoveryPromise;
  assert.equal(canAttemptRecovery(0), true);
  assert.equal(canAttemptRecovery(1), false);
  assert.equal(canAttemptRecovery(2), false);
  assert.match(read('src/attestation.ts'), /canAttemptRecovery\(recoveryAttempts\)/);
});

test('missing server-device recovery permits only one re-registration', async () => {
  const { canAttemptRecovery } = await recoveryPromise;
  let registrations = 0;
  for (let attempts = 0; canAttemptRecovery(attempts); attempts++) registrations++;
  assert.equal(registrations, 1);
  const source = read('src/lib/nativeAuth.ts');
  assert.match(source, /code === 'device_not_registered' && canAttemptRecovery\(recoveryAttempts\)/);
});

test('wrong AAGUID environment is rejected', async () => {
  const { validateRegistrationIdentity } = await policyPromise;
  const hash = new Uint8Array([1, 2, 3]);
  assert.equal(validateRegistrationIdentity({
    aaguid: 'appattestdevelop', environment: 'production',
    rpIdHash: hash, expectedRpIdHash: hash, keyId: 'key', expectedKeyId: 'key',
  }), 'bad_aaguid');
});

test('wrong RP ID and key ID are rejected', async () => {
  const { validateRegistrationIdentity } = await policyPromise;
  const base = {
    aaguid: 'appattestdevelop', environment: 'development',
    rpIdHash: new Uint8Array([1]), expectedRpIdHash: new Uint8Array([1]),
    keyId: 'key', expectedKeyId: 'key',
  };
  assert.equal(validateRegistrationIdentity({ ...base, rpIdHash: new Uint8Array([2]) }), 'bad_rp_id');
  assert.equal(validateRegistrationIdentity({ ...base, keyId: 'attacker-key' }), 'key_id_mismatch');
});

test('nonce mismatch is rejected', async () => {
  const { validateNonce } = await policyPromise;
  assert.equal(validateNonce(new Uint8Array([1, 2]), new Uint8Array([1, 3])), 'nonce_mismatch');
});

test('invalid certificate chain is rejected', async () => {
  const { validateCertificateChain } = await policyPromise;
  assert.equal(validateCertificateChain(true, true, false, true), 'bad_chain');
  assert.equal(validateCertificateChain(false, true, true, true), 'bad_chain');
});

test('missing Apple configuration fails closed', async () => {
  const { REQUIRED_APP_ID, validateAppleConfiguration } = await policyPromise;
  assert.equal(validateAppleConfiguration(undefined, 'production'), 'invalid_apple_app_id_config');
  assert.equal(validateAppleConfiguration(REQUIRED_APP_ID, undefined), 'invalid_apple_attest_env_config');
});

test('assertion counter replay is rejected', async () => {
  const { validateAssertionCounter } = await policyPromise;
  assert.equal(validateAssertionCounter(7, 7), 'counter_not_increasing');
  assert.equal(validateAssertionCounter(7, 6), 'counter_not_increasing');
  assert.equal(validateAssertionCounter(7, 8), null);
});

test('altered canonical request is rejected', async () => {
  const { canonicalRequest } = await policyPromise;
  const valid = canonicalRequest('login', 'challenge-1', 'user@example.com', 'ios');
  assert.notEqual(valid, canonicalRequest('signup', 'challenge-1', 'user@example.com', 'ios'));
  assert.notEqual(valid, canonicalRequest('login', 'challenge-2', 'user@example.com', 'ios'));
  assert.notEqual(valid, canonicalRequest('login', 'challenge-1', 'attacker@example.com', 'ios'));
  assert.notEqual(valid, canonicalRequest('login', 'challenge-1', 'user@example.com', 'android'));
});

test('entitlements, atomic transitions, and client mutation policy stay hardened', () => {
  const load = (profile) => {
    process.env.EAS_BUILD_PROFILE = profile;
    delete require.cache[require.resolve('../app.config.js')];
    return require('../app.config.js')({ config: require('../app.json').expo }).expo.ios;
  };
  assert.equal(load('development').entitlements['com.apple.developer.devicecheck.appattest-environment'], 'development');
  assert.equal(load('production').entitlements['com.apple.developer.devicecheck.appattest-environment'], 'production');
  const migration = read('supabase/migrations/20260716000000_app_attest_hardening.sql');
  assert.match(migration, /consume_attestation_challenge/);
  assert.match(migration, /advance_attestation_counter/);
  assert.match(migration, /revoke insert, update, delete, truncate on public\.attested_devices from anon, authenticated/);
});
