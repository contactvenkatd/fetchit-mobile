// Hidden-input launcher only. Never print credentials or raw provider errors.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stripeComponents } = require('./providers.cjs');
function report(value) {
  const result = { ...value, completedAt: new Date().toISOString(), completeCheckoutVerified: false };
  fs.writeFileSync(path.join(os.tmpdir(), 'fetchit-checkout-stripe-test-result.json'),
    JSON.stringify(result, null, 2), { mode: 0o600 });
  console.log(JSON.stringify(result, null, 2));
}
(async () => {
  let key = fs.readFileSync(0, 'utf8').trim();
  if (!/^sk_test_[A-Za-z0-9]+$/.test(key)) {
    console.log('Invalid test key; no Stripe requests sent.');
    process.exitCode = 1;
    return;
  }
  try {
    report(await stripeComponents(key));
  } catch (error) {
    report({ outcome: 'failed', scope: 'Stripe test component only',
      code: error.code || error.cause?.code || error.name,
      stage: error.stage, providerCode: error.providerCode,
      location: error.stack?.split('\n').find(line => line.includes('providers.cjs:'))?.trim() });
    process.exitCode = 1;
  } finally { key = null; }
})();
