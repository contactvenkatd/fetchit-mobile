const test = require('node:test');
const assert = require('node:assert/strict');
const { load, backend, mount, mountHistory, localOrderId, profile } = require('./harness.cjs');
const intent = { productQuery: 'Lodge cast iron skillet', quantity: 2, size: '12 inch', color: null, priceCeiling: null, retailerPreference: null };
function search(fetcher, key = 'zn_test_fixture') {
  let handler;
  const signing = load('supabase/functions/_shared/listing-price.ts');
  load('supabase/functions/search-products/index.ts', {}, {
    Response, Request, URL, fetch: fetcher, signListingPrice: signing.signListingPrice,
    Deno: { env: { get: name => ({ ZINC_API_KEY: key, SUPABASE_SERVICE_ROLE_KEY: 'mock-signing-key' })[name] }, serve: fn => { handler = fn; } },
  }, true);
  return async (input = intent) => {
    const response = await handler(new Request('https://isolated.invalid/search-products', { method: 'POST', body: JSON.stringify(input) }));
    assert.equal(response.status, 200); return (await response.json()).results;
  };
}
const asin = 'B0CB75WJZP';
const details = { status: 'completed', retailer: 'amazon', asin, title: 'Amazon fixture', price: 17500,
  buyapi_hint: true, variant_specifics: [{ dimension: 'Size', value: '12 inch' }] };
const offer = { asin, price: 17500, currency: 'USD', available: true, condition: 'New', international: false,
  seller: { id: 'SELLERFIXTURE', name: 'Fixture seller' } };
const provider = (mutate = x => x) => async url => {
  if (url.pathname === '/products/search') return Response.json({ status: 'completed', results: [{ product_id: asin, title: details.title, price: 1 }] });
  if (url.pathname.endsWith('/offers')) return Response.json({ status: 'completed', retailer: 'amazon', asin, offers: [mutate({ ...offer })] });
  return Response.json(details);
};

if (process.env.RUN_REAL_CURRENCY_SEARCH === '1') {
  test('REAL unmetered Amazon search + details + explicit USD offer currency → actual UI/backend → same retailer URL accepted → history simulated delivery', async () => {
    const { sandboxKey, sandboxFetch } = require('./providers.cjs');
    const key = await sandboxKey();
    const results = await search(async url => {
      assert.equal(url.origin, 'https://api.zinc.com');
      assert.ok(/^\/products(?:\/search|\/[A-Z0-9]{10}(?:\/offers)?)$/.test(url.pathname));
      return fetch(url, { headers: { Authorization: `Bearer ${key}` }, redirect: 'error', signal: AbortSignal.timeout(25000) });
    }, key)();
    const result = results.find(row => row.currency === 'USD' && row.listingProof);
    assert.ok(result, 'An actual currency-bearing search result must reach checkout');
    assert.equal(result.retailer, 'amazon'); assert.ok(result.amazon.asin); assert.ok(result.amazon.sellerId);
    Object.assign(profile, { full_name: 'Saved Recipient Example', address_line1: '4827 Cedar Hollow Lane', address_line2: 'Apartment 9B', city: 'Austin', state: 'TX', zip: '78704-1234', country: 'US', phone_number: '5125550147' });
    let injectFailure = false;
    const realUpstream = sandboxFetch(key, [result.url]);
    const upstream = async (url, options) => {
      const response = await realUpstream(url, options);
      if (!injectFailure || options?.method === 'POST') return response;
      const body = await response.json();
      return Response.json({ ...body, status: 'order_failed', job_result: { error: 'product_out_of_stock' } });
    };
    const app = backend({ key, upstream });
    const checkout = mount(app.api, 'test-success', { productUrl: result.url, title: result.title, retailer: result.retailer,
      priceCents: String(result.price), currency: result.currency, listingProof: result.listingProof, quantity: '2', size: intent.size, color: '' });
    try {
      await checkout.start();
      const margin = 200 + Math.round(result.price * 2 * 0.035);
      assert.match(checkout.container.textContent, new RegExp(`Service fee: USD ${((margin + 100) / 100).toFixed(2)}`));
      assert.equal((checkout.container.textContent.match(/Service fee:/g) || []).length, 1);
      assert.equal(checkout.button('Place Order').disabled, true);
      await checkout.setBudget(String((result.price * 2 + 5000) / 100));
      await checkout.click('Approve estimate');
      await checkout.act(async () => { checkout.button('Place Order').click(); checkout.button('Place Order').click(); });
      const deadline = Date.now() + 20000;
      while (!app.calls.inserts.length && Date.now() < deadline) await checkout.flush();
      assert.equal(app.calls.submissions.length, 1); assert.equal(app.calls.inserts.length, 1);
      const sent = app.calls.submissions[0];
      assert.equal(sent.products[0].url, result.url); assert.equal(sent.products[0].quantity, 2);
      assert.deepEqual(sent.products[0].condition_in, ['New']);
      assert.deepEqual(sent.products[0].variant, [{ label: 'Size', value: intent.size }]);
      assert.equal(sent.metadata.amazon_asin, result.amazon.asin);
      assert.equal(sent.metadata.amazon_quoted_seller_id, result.amazon.sellerId);
      assert.equal(sent.payment.mode, 'connect');
      assert.deepEqual(sent.payment.margin, { type: 'flat', value: margin });
      assert.equal(sent.payment.customer, profile.stripe_customer_id);
      assert.equal(sent.payment.payment_method, profile.stripe_payment_method_id);
      assert.equal(sent.metadata.fetchit_item_subtotal_cents, result.price * 2);
      assert.equal(sent.metadata.fetchit_margin_cents, margin);
      assert.equal(sent.metadata.zinc_fee_cents, 100);
      assert.deepEqual(sent.shipping_address, { first_name: 'Saved', last_name: 'Recipient Example', address_line1: profile.address_line1,
        address_line2: profile.address_line2, city: profile.city, state: profile.state, postal_code: profile.zip,
        country: profile.country, phone_number: profile.phone_number });
    } finally { await checkout.close(); }
    const recovery = mount(app.reloadApi());
    try { await recovery.start(); assert.equal(app.calls.submissions.length, 1); assert.match(recovery.container.textContent, /Order submitted/); }
    finally { await recovery.close(); }
    const dataModule = load('src/lib/data.ts', { '@/lib/supabase': { supabase: { from: () => ({ select: () => ({
      order: async () => ({ data: app.calls.inserts.map(row => ({ ...row, id: localOrderId })), error: null }),
    }) }) } } });
    let poll;
    const history = mountHistory(app.reloadApi(), [], { dataModule, setTimeout: fn => { poll = fn; return 1; }, clearTimeout() {} });
    try {
      await history.start(); const deadline = Date.now() + 45000;
      while (!/Retailer status: delivered/.test(history.container.textContent) && Date.now() < deadline) {
        await history.act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
        if (poll) { await history.act(async () => { await poll(); }); await history.flush(); }
      }
      assert.match(history.container.textContent, /Retailer status: delivered/);
      assert.match(history.container.textContent, /Tracking: .*delivered/);
      assert.match(history.container.textContent, /Payment status: simulated/);
      assert.doesNotMatch(history.container.textContent, /Captured:/);
      assert.equal(app.calls.submissions.length, 1);
      injectFailure = true;
      await history.act(async () => { await poll(); }); await history.flush();
      assert.match(history.container.textContent, /Retailer status: failed/);
      assert.doesNotMatch(history.container.textContent, /Retailer status: delivered|Captured:|Payment status: (paid|succeeded)|Completed/);
      assert.equal(app.calls.submissions.length, 1);
      console.log(JSON.stringify({ asin: result.amazon.asin, currency: result.currency, unitPriceCents: result.price, quantity: 2, variant: intent.size, marginCents: 200 + Math.round(result.price * 2 * .035), serviceFeeCents: 300 + Math.round(result.price * 2 * .035), submissions: app.calls.submissions.length, savedAddressFieldsMatched: true, simulatedDelivery: true, injectedFailureOverridesOverallDelivery: true, mocks: ['native UI primitives', 'authentication', 'database', 'Stripe customer/payment-method reads', 'post-delivery failure response'] }));
    } finally { await history.close(); }
  });
} else {
  test('Amazon offer explicit USD cents overrides unverified search price and retains ASIN/seller/variant', async () => {
    const results = await search(provider())();
    assert.equal(results.length, 1); const row = results[0];
    assert.equal(row.currency, 'USD'); assert.equal(row.price, 17500); assert.equal(row.productId, asin);
    assert.equal(row.url, `https://www.amazon.com/dp/${asin}`); assert.ok(row.listingProof);
    const payload = JSON.parse(row.listingProof).payload;
    assert.equal(payload.amazon.sellerId, offer.seller.id); assert.deepEqual(payload.amazon.variants, [{ label: 'Size', value: '12 inch' }]);
  });
  for (const change of [{ currency: null }, { currency: 'CAD' }, { currency_code: 'EUR' }, { available: false }, { condition: 'Used - Good' }, { international: true }, { prime_only: true }, { expired_product_id: true }, { minimum_quantity: 3 }, { asin: 'B000000000' }]) {
    test(`Amazon unverified/unavailable/wrong offer stays blocked: ${JSON.stringify(change)}`, async () => {
      assert.equal((await search(provider(row => ({ ...row, ...change })))()).length, 0);
    });
  }
  test('Requested Amazon variant must match actual details; other retailers are not relabeled', async () => {
    assert.equal((await search(provider())({ ...intent, size: 'Unsupported size' })).length, 0);
    let handler; load('supabase/functions/search-products/index.ts', {}, {
      Response, Request, URL, signListingPrice: () => null,
      Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
      fetch: () => { throw new Error('No other retailer requests'); },
    }, true);
    const response = await handler(new Request('https://isolated.invalid/search', { method: 'POST', body: JSON.stringify({ ...intent, retailerPreference: 'etsy' }) }));
    assert.equal(response.status, 409);
  });
  test('Amazon server enforces signed variant and New condition; retains seller as quote metadata', async () => {
    const result = (await search(provider())())[0];
    const app = backend(); const ui = mount(app.api, 'test-success', { productUrl: result.url,
      priceCents: String(result.price), currency: result.currency, listingProof: result.listingProof, size: '12 inch' });
    try {
      await ui.start(); await ui.click('Approve estimate'); await ui.click('Place Order');
      const sent = app.calls.submissions[0]; assert.ok(sent);
      assert.deepEqual(sent.products[0].condition_in, ['New']);
      assert.deepEqual(sent.products[0].variant, [{ label: 'Size', value: '12 inch' }]);
      assert.equal(sent.metadata.amazon_quoted_seller_id, offer.seller.id);
      assert.equal(sent.metadata.amazon_asin, asin);
      assert.equal(sent.payment.margin.value, 813); // 200 + round(17500 * .035).
    } finally { await ui.close(); }
    const mismatch = backend(); const changed = mount(mismatch.api, 'test-success', {
      productUrl: result.url, priceCents: String(result.price), currency: 'USD', listingProof: result.listingProof, size: '10 inch' });
    try { await changed.start(); assert.equal(mismatch.calls.submissions.length, 0); assert.ok(!changed.button('Approve estimate')); }
    finally { await changed.close(); }
  });
  test('Amazon minimum offer quantity survives signed proof and rejects a reduced client quantity', async () => {
    const result = (await search(provider(row => ({ ...row, minimum_quantity: 2 })))())[0];
    const app = backend(); const ui = mount(app.api, 'test-success', { productUrl: result.url,
      priceCents: String(result.price), currency: 'USD', listingProof: result.listingProof, size: '12 inch', quantity: '1' });
    try { await ui.start(); assert.equal(app.calls.submissions.length, 0); assert.ok(!ui.button('Approve estimate')); }
    finally { await ui.close(); }
  });
  for (const change of [{ country: 'CA' }, { zip: 'invalid' }]) {
    test(`Amazon server rejects non-US/incomplete address before order: ${JSON.stringify(change)}`, async () => {
      const saved = { ...profile }; Object.assign(profile, change);
      const result = (await search(provider())())[0]; const app = backend();
      const ui = mount(app.api, 'test-success', { productUrl: result.url, priceCents: String(result.price),
        currency: 'USD', listingProof: result.listingProof, size: '12 inch' });
      try { await ui.start(); assert.equal(app.calls.submissions.length, 0); assert.ok(!ui.button('Approve estimate')); }
      finally { await ui.close(); Object.assign(profile, saved); }
    });
  }
}
