const test = require('node:test');
const assert = require('node:assert/strict');
const { sandboxKey, sandboxFetch, stripeComponents } = require('./providers.cjs');
test('integration runners reject live keys before making any network request', async () => {
  const original = global.fetch;
  const previous = process.env.CHECKOUT_ZINC_TEST_KEY;
  let calls = 0; global.fetch = async () => { calls++; throw new Error('No network allowed'); };
  try {
    process.env.CHECKOUT_ZINC_TEST_KEY = 'zn_live_forbidden';
    await assert.rejects(sandboxKey());
    assert.throws(() => sandboxFetch('zn_live_forbidden'));
    await assert.rejects(stripeComponents('sk_live_forbidden'));
    assert.equal(calls, 0);
  } finally {
    global.fetch = original;
    if (previous === undefined) delete process.env.CHECKOUT_ZINC_TEST_KEY;
    else process.env.CHECKOUT_ZINC_TEST_KEY = previous;
  }
});
test('sandbox boundary rejects other endpoints, retailer URLs and redirects before network', async () => {
  const request = sandboxFetch('zn_test_fixture');
  for (const url of ['https://api.zinc.com/device/code', 'https://evil.invalid/orders', 'http://api.zinc.com/orders']) {
    await assert.rejects(request(url));
  }
  await assert.rejects(request('https://api.zinc.com/orders', { method: 'POST', body: JSON.stringify({
    products: [{ url: 'https://www.amazon.com/dp/real-product' }],
  }) }));
});
