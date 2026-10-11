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
test('sandbox net-margin diagnostics permit schema numeric nonnegative margins and reject invalid costs', async () => {
  const original=global.fetch;let calls=0;
  global.fetch=async()=>{calls++;return {ok:true};};
  const request=sandboxFetch('zn_test_fixture');
  const body={products:[{url:'https://zinc.com/shop/products/test-success'}],
    payment:{mode:'connect',margin:{type:'flat',value:0}},idempotency_key:'fixture'};
  try {
    for(const value of [0,44,68.5]) {
      body.payment.margin.value=value;
      await request('https://api.zinc.com/orders',{method:'POST',body:JSON.stringify(body)});
    }
    for(const value of [-1,Infinity,10001]) {
      body.payment.margin.value=value;
      await assert.rejects(request('https://api.zinc.com/orders',{method:'POST',body:JSON.stringify(body)}));
    }
    assert.equal(calls,3);
  } finally {global.fetch=original;}
});
