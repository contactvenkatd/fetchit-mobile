const assert = require('node:assert/strict');
const test = require('node:test');

const enabled = process.env.ALLOW_DISPOSABLE_SUPABASE_STAGING === 'yes';

test('disposable staging challenge is bound to the requested context', { skip: !enabled }, async () => {
  const url = process.env.STAGING_SUPABASE_URL;
  const anonKey = process.env.STAGING_SUPABASE_ANON_KEY;
  const projectRef = process.env.STAGING_PROJECT_REF;
  assert.ok(url && anonKey && projectRef, 'staging URL, anon key, and project ref are required');
  const parsed = new URL(url);
  assert.equal(parsed.protocol, 'https:');
  assert.equal(parsed.hostname, `${projectRef}.supabase.co`);
  assert.notEqual(projectRef, process.env.PRODUCTION_PROJECT_REF, 'staging must not equal production');

  const response = await fetch(`${url}/functions/v1/attestation-challenge`, {
    method: 'POST',
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ platform: 'ios', action: 'login', email: 'app-attest-test@example.invalid' }),
  });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.match(body.id, /^[0-9a-f-]{36}$/i);
  assert.ok(Buffer.from(body.challenge, 'base64').length === 32);
});
