const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, mount, mountHistory, zincId, localOrderId, load, profile, fixtureProof } = require('./harness.cjs');

test('MOCK: complete DOM checkout → real service/backend → simulated provider status', async () => {
  const app = backend(); const ui = mount(app.api);
  try {
    await ui.start();
    assert.match(ui.container.textContent, /Estimated total: USD 13.35 \+ shipping, taxes, and processing fees \(amounts unknown\)/);
    assert.match(ui.container.textContent, /Estimated total\. Final shipping, taxes, and processing fees may vary\./);
    assert.doesNotMatch(ui.container.textContent, /Authorize up to|spending ceiling|2\.9%|\$0\.30/);
    assert.equal(ui.button('Place Order').disabled, true);
    ui.button('Place Order').click(); assert.equal(app.calls.submissions.length, 0);
    await ui.click('Approve estimate');
    assert.equal(ui.button('Place Order').disabled, false);
    const button = ui.button('Place Order');
    await ui.act(async () => { button.click(); button.click(); }); await ui.flush();
    assert.equal(app.calls.submissions.length, 1);
    assert.equal(app.calls.submissions[0].max_price, 1000);
    const placement = app.calls.invocations.find(x => x.approval);
    const quoteCall = app.calls.invocations.find(x => x.action === 'quote');
    assert.equal(placement.productUrl, quoteCall.productUrl);
    assert.equal(placement.quantity, quoteCall.quantity);
    assert.equal(placement.approval.retailerBudgetCents, 1000);
    assert.match(ui.container.textContent, /Retailer status: delivered/);
    assert.match(ui.container.textContent, /Payment status: simulated/);
    assert.match(ui.container.textContent, /No real retailer purchase or card charge is confirmed/);
    assert.doesNotMatch(ui.container.textContent, /Actual captured amount/);
    assert.equal((await app.api.getCheckoutOrderStatus(localOrderId)).simulatedChargeCents, 950);
    assert.ok(app.calls.submissions[0].idempotency_key);
  } finally { await ui.close(); }
});

for (const scenario of ['timeout', 'unknown_response', 'server_error', 'already_exists', 'decline', 'over_budget']) {
  test(`MOCK DOM/backend: ${scenario} never automatically resubmits`, async () => {
    let requests = 0;
    const app = backend({ upstream: async (_, options) => {
      if (options?.method !== 'POST') return Response.json({ id: zincId, status: 'order_failed',
        job_result: { error_details: { code: 'max_price_exceeded' } }, connect: { simulated: true } });
      requests++;
      if (scenario === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
      if (scenario === 'unknown_response') return Response.json({ accepted: true }, { status: 201 });
      if (scenario === 'server_error') return Response.json({ code: 'unknown_provider_code', message: 'Uncertain' }, { status: 503 });
      if (scenario === 'already_exists') return Response.json({ code: 'already_exists', message: 'Already accepted' }, { status: 409 });
      if (scenario === 'decline') return Response.json({ code: 'card_declined', message: 'Test card declined' }, { status: 402 });
      return Response.json({ id: zincId, status: 'pending', connect: { simulated: true } }, { status: 201 });
    } });
    const ui = mount(app.api);
    try {
      await ui.start(); await ui.click('Approve estimate'); await ui.click('Place Order');
      assert.equal(requests, 1);
      if (scenario === 'decline') {
        assert.match(ui.container.textContent, /Test card declined/);
        assert.equal(app.calls.inserts.length, 0);
      } else if (scenario === 'over_budget') {
        assert.match(ui.container.textContent, /max_price_exceeded.*higher budget requires new approval/);
        assert.equal(ui.button('Place Order'), undefined);
      } else {
        assert.match(ui.container.textContent, /Check order history/);
        assert.equal(ui.button('Place Order')?.disabled ?? true, true);
        ui.button('Place Order')?.click(); await ui.flush(); assert.equal(requests, 1);
      }
    } finally { await ui.close(); }
  });
}

test('MOCK DOM: unavailable server estimate keeps placement disabled', async () => {
  const app = backend({ pricingAvailable: false }); const ui = mount(app.api);
  try { await ui.start(); assert.equal(ui.button('Estimate unavailable').disabled, true);
    assert.equal(app.calls.submissions.length, 0); assert.equal(app.calls.stripeReads, 0);
  } finally { await ui.close(); }
});

test('MOCK backend status: ownership filter rejects another order before upstream access', async () => {
  const app = backend({ owned: false });
  await assert.rejects(app.api.getCheckoutOrderStatus(localOrderId), e => e.code === 'order_not_found');
  assert.equal(app.calls.statuses, 0);
});

for (const variant of ['captured', 'hold', 'wrong_mode', 'wrong_account', 'unreachable', 'sandbox_without_connect']) {
  test(`MOCK status: ${variant} does not confuse authorization/simulation with captured funds`, async () => {
    const read = load('supabase/functions/_shared/order-status.ts', {
      './stripe-backend.ts': { stripeIsLive: () => false, paymentStripe: () => ({
        accounts: { retrieve: async () => ({ id: variant === 'wrong_account' ? 'acct_other' : 'acct_fixture' }) },
        paymentIntents: { retrieve: async () => { if (variant === 'unreachable') throw new Error('offline'); return {
          livemode: variant === 'wrong_mode', status: variant === 'hold' ? 'requires_capture' : 'succeeded',
          amount: 1100, amount_received: 950, currency: 'usd',
        }; } },
      }) },
    }, { AbortSignal, fetch: async () => Response.json({ id: zincId, status: 'order_placed',
      connect: variant === 'sandbox_without_connect' ? undefined : { payment_intent_id: 'pi_fixture', connected_account_id: 'acct_fixture' } }) }).readOrderStatus;
    const result = await read(zincId, variant === 'sandbox_without_connect' ? 'zn_test_fixture' : 'zn_live_fixture');
    if (variant === 'captured') { assert.equal(result.payment.actualChargeCents, 950); assert.equal(result.payment.source, 'stripe_test'); }
    else assert.equal(result.payment.actualChargeCents, null);
    if (variant === 'sandbox_without_connect') assert.equal(result.simulated, true);
  });
}

test('MOCK DOM: changing budget invalidates approval until the new estimate and budget is approved', async () => {
  const app = backend(); const ui = mount(app.api);
  try {
    await ui.start(); await ui.click('Approve estimate');
    assert.equal(ui.button('Place Order').disabled, false);
    await ui.setBudget('12.00');
    assert.match(ui.container.textContent, /Retailer budget: USD 12.00/);
    assert.equal(ui.button('Place Order').disabled, true);
    assert.equal(app.calls.submissions.length, 0);
    await ui.click('Approve estimate'); await ui.click('Place Order');
    assert.equal(app.calls.submissions[0].max_price, 1200);
    assert.equal(app.calls.invocations.find(x => x.approval).approval.retailerBudgetCents, 1200);
  } finally { await ui.close(); }
});

test('MOCK DOM/backend/Stripe: verified actual capture independent of estimate reaches the UI', async () => {
  const app = backend({ key: 'zn_live_fixture', production: true, capturedCents: 1950, upstream: async (_, options) => Response.json(options?.method === 'POST'
    ? { id: zincId, status: 'pending' } : { id: zincId, status: 'order_placed',
      connect: { payment_intent_id: 'pi_fixture', connected_account_id: 'acct_fixture', simulated: false } }) });
  const ui = mount(app.api);
  try {
    await ui.start(); await ui.click('Approve estimate'); await ui.click('Place Order');
    assert.match(ui.container.textContent, /Actual captured amount: USD 19.50/);
    assert.match(ui.container.textContent, /Payment status: succeeded/);
    assert.doesNotMatch(ui.container.textContent, /Sandbox simulation/);
    assert.equal(app.calls.submissions.length, 1);
  } finally { await ui.close(); }
});

for (const currency of ['EUR', '', 'JPY']) {
  test(`MOCK DOM: unconfirmed/non-USD currency ${currency} cannot obtain approval or submit`, async () => {
    const app = backend(); const ui = mount(app.api, 'test-success', { currency });
    try { await ui.start(); assert.equal(ui.button('Estimate unavailable').disabled, true);
      assert.equal(ui.button('Approve estimate'), undefined);
      assert.equal(app.calls.invocations.length, 0);
    } finally { await ui.close(); }
  });
}

test('MOCK production-shaped backend: old ceiling consent and non-USD requests cannot submit', async () => {
  const app = backend({ key: 'zn_live_fixture', production: true });
  const input = { productUrl: 'https://retailer.example/item', quantity: 1, itemSubtotalCents: 1000, unitPriceCents: 1000, listingProof: await fixtureProof('https://retailer.example/item'),
    currency: 'USD', displayedPriceCents: 1200, productName: 'Fixture', productImage: null,
    retailer: 'Fixture', idempotencyKey: require('node:crypto').randomUUID() };
  const quote = await app.api.getCheckoutQuote(input);
  assert.equal(quote.knownCostsCents, 1335); assert.equal(quote.paymentFeeCents, null);
  await assert.rejects(app.api.placeOrder({ ...input, approval: { quoteId: quote.id, maximumCents: 1300, currency: 'USD' } }), e => e.code === 'checkout_approval_required');
  await assert.rejects(app.api.placeOrder({ ...input, currency: 'EUR' }), e => e.code === 'invalid_order');
  assert.equal(app.calls.submissions.length, 0); assert.equal(app.calls.stripeReads, 0);
});

for (const outcome of ['accepted', 'timeout', 'malformed']) {
  test(`MOCK restart: ${outcome} recovers durable lock with freshly loaded client modules`, async () => {
    const app = backend({ upstream: async (_, options) => {
      if (options?.method !== 'POST') return Response.json({ id: zincId, status: 'order_placed', connect: { simulated: true } });
      if (outcome === 'timeout') throw new DOMException('Timed out', 'TimeoutError');
      if (outcome === 'malformed') return Response.json({ accepted: true });
      return Response.json({ id: zincId, status: 'pending', connect: { simulated: true } });
    } });
    let ui = mount(app.api);
    await ui.start(); await ui.click('Approve estimate'); await ui.click('Place Order'); await ui.close();
    ui = mount(app.reloadApi());
    try {
      await ui.start();
      assert.equal(ui.button('Approve estimate'), undefined);
      if (outcome === 'accepted') assert.match(ui.container.textContent, /Order submitted/);
      else assert.match(ui.container.textContent, /previous checkout is unresolved/);
      ui.button('Place Order')?.click(); await ui.flush();
      assert.equal(app.calls.submissions.length, 1);
    } finally { await ui.close(); }
  });
}

test('MOCK mapping: selected URL, quantity, full address, card and retailer budget reach Zinc once', async () => {
  const app = backend(); const ui = mount(app.api, 'test-success', { quantity: '3' });
  try {
    await ui.start(); await ui.setBudget('35.00'); await ui.click('Approve estimate'); await ui.click('Place Order');
    const sent = app.calls.submissions[0];
    assert.deepEqual(sent.products, [{ url: 'https://zinc.com/shop/products/test-success', quantity: 3 }]);
    assert.deepEqual(sent.shipping_address, { first_name: 'Sandbox', last_name: 'Agent',
      address_line1: profile.address_line1, address_line2: profile.address_line2, city: profile.city,
      state: profile.state, postal_code: profile.zip, phone_number: profile.phone_number, country: 'US' });
    assert.deepEqual(sent.payment, { mode: 'connect', payment_method: profile.stripe_payment_method_id,
      customer: profile.stripe_customer_id, margin: { type: 'flat', value: 305 } });
    assert.equal(sent.max_price, 3500);
    const consent = app.calls.invocations.find(x => x.approval);
    assert.equal(consent.currency, 'USD'); assert.equal(consent.itemSubtotalCents, 3000);
  } finally { await ui.close(); }
});

for (const status of ['in_transit', 'delivered', 'order_failed']) {
  test(`MOCK fulfillment: ${status} reaches checkout and order history after navigation`, async () => {
    const app = backend({ upstream: async (_, options) => Response.json(options?.method === 'POST'
      ? { id: zincId, status: 'pending', connect: { simulated: true } }
      : { id: zincId, status: status === 'order_failed' ? 'order_failed' : 'order_placed',
        job_result: status === 'order_failed' ? { error_details: { code: 'product_out_of_stock' } } : null,
        tracking_numbers: [{ carrier: 'ups', tracking_number: '1ZFIXTURE', status: status === 'order_failed' ? 'delivered' : status, estimated_delivery_date: '2026-10-08' }], connect: { simulated: true } }) });
    let ui = mount(app.api);
    await ui.start(); await ui.click('Approve estimate'); await ui.click('Place Order');
    assert.match(ui.container.textContent, new RegExp(`Retailer status: ${status === 'order_failed' ? 'failed' : status}`));
    if (status !== 'order_failed') assert.match(ui.container.textContent, /Tracking: ups 1ZFIXTURE/);
    await ui.close();
    ui = mountHistory(app.reloadApi(), [{ id: localOrderId, zincOrderId: zincId, status: 'pending', orderPrice: 10, serviceFee: 0 }]);
    try {
      await ui.start();
      assert.match(ui.container.textContent, new RegExp(`Retailer status: ${status === 'order_failed' ? 'failed' : status}`));
      assert.match(ui.container.textContent, /Payment status: simulated/);
      assert.doesNotMatch(ui.container.textContent, /Completed/);
      if (status === 'order_failed') assert.match(ui.container.textContent, /product_out_of_stock/);
    } finally { await ui.close(); }
  });
}

test('MOCK selected variants are disclosed, bound to consent and mapped to Zinc', async () => {
  const app = backend(); const ui = mount(app.api, 'test-success', { size: 'Large', color: 'Black' });
  try {
    await ui.start(); assert.match(ui.container.textContent, /Size: Large/); assert.match(ui.container.textContent, /Color: Black/);
    await ui.click('Approve estimate'); await ui.click('Place Order');
    assert.deepEqual(app.calls.submissions[0].products[0].variant,
      [{ label: 'Size', value: 'Large' }, { label: 'Color', value: 'Black' }]);
  } finally { await ui.close(); }
});

test('MOCK durable journal fails closed on persistence failure and preserves accepted order across reload', async () => {
  const values = new Map(); let writes = 0;
  const store = { getItemAsync: async k => values.get(k) ?? null,
    setItemAsync: async (k, v) => { writes++; if (writes === 1) throw new Error('offline store'); values.set(k, v); },
    deleteItemAsync: async k => { values.delete(k); } };
  const imports = { 'expo-secure-store': store, '@/lib/supabase': { supabase: { auth: {
    getUser: async () => ({ data: { user: { id: 'fixture-user' } } }),
  } } } };
  let journal = load('src/services/checkoutSubmission.ts', imports);
  await assert.rejects(journal.beginSubmission('first'));
  await journal.beginSubmission('second');
  journal = load('src/services/checkoutSubmission.ts', imports);
  assert.equal((await journal.getSavedSubmission()).idempotencyKey, 'second');
  await assert.rejects(journal.beginSubmission('third'));
  await assert.rejects(journal.startNewPurchase());
  await journal.releaseRejectedSubmission('other');
  await assert.rejects(journal.beginSubmission('fourth'));
  await journal.acceptSubmission('second', { id: localOrderId, zincOrderId: zincId, status: 'pending', totalCents: 1000, recorded: true });
  journal = load('src/services/checkoutSubmission.ts', imports);
  assert.equal((await journal.getSavedSubmission()).state, 'accepted');
  await assert.rejects(journal.beginSubmission('fifth'));
  await journal.startNewPurchase(); await journal.beginSubmission('explicit-new-purchase');
});

test('Legacy normalizer never infers cross-retailer USD and excludes unavailable results', async () => {
  const search = load('supabase/functions/search-products/index.ts', {}, {
    Response, Request, URL, signListingPrice: () => null,
    Deno: { env: { get: () => 'fixture' }, serve() {} },
  }, true);
  const rows = search.normalizeResults([
    { url: 'https://www.amazon.com/dp/fixture', title: 'Known USD', retailer: 'amazon', price: 1000, currency: 'USD' },
    { url: 'https://www.amazon.com/dp/unknown', title: 'Unknown', retailer: 'amazon', price: 1000 },
    { url: 'https://www.amazon.com/dp/unavailable', title: 'Unavailable', retailer: 'amazon', price: 1000, available: false },
  ], { retailerPreference: null, priceCeiling: null });
  assert.equal(rows.length, 2); assert.equal(rows[0].currency, 'USD'); assert.equal(rows[1].currency, null);
});


for (const [subtotal, fee] of [[1, 200], [14, 200], [15, 201], [99, 203], [100, 204], [101, 204], [1000, 235], [3000, 305], [10000, 550]]) {
  test(`REAL fee arithmetic: subtotal ${subtotal} produces margin ${fee} cents without compounding`, () => {
    const pricing = load('supabase/functions/_shared/checkout-pricing.ts');
    assert.equal(pricing.calculateServiceMargin(subtotal), fee);
    assert.equal(pricing.calculateServiceMargin(-1), null);
    assert.equal(pricing.calculateServiceMargin(1.5), null);
  });
}

test('REAL signed listing rejects fabricated price, currency, URL, signature and expired evidence', async () => {
  const listing = load('supabase/functions/_shared/listing-price.ts');
  const url = 'https://retailer.example/item';
  const proof = await listing.signListingPrice(url, 1000, 'USD', 'fixture-secret', 1000);
  assert.equal((await listing.verifyListingPrice(proof, url, 'fixture-secret', 1001)).unitPriceCents, 1000);
  for (const change of [{ unitPriceCents: 1 }, { currency: 'EUR' }, { url: 'https://other.invalid' }, { expiresAt: 9999999 }]) {
    const tampered = JSON.parse(proof); Object.assign(tampered.payload, change);
    assert.equal(await listing.verifyListingPrice(JSON.stringify(tampered), url, 'fixture-secret', 1001), null);
  }
  assert.equal(await listing.verifyListingPrice(proof, url, 'wrong-secret', 1001), null);
  assert.equal(await listing.verifyListingPrice(proof, url, 'fixture-secret', 1801000), null);
  assert.equal(await listing.signListingPrice(url, 1000, null, 'fixture-secret'), null);
});

test('MOCK UI/server: quantity fee uses subtotal once; only combined Service fee is displayed', async () => {
  const app = backend(); const ui = mount(app.api, 'test-success', { quantity: '3' });
  try {
    await ui.start();
    assert.match(ui.container.textContent, /Service fee: USD 4.05/);
    assert.equal((ui.container.textContent.match(/Service fee:/g) ?? []).length, 1);
    assert.doesNotMatch(ui.container.textContent, /FetchIt service fee|Zinc fee:/);
    assert.match(ui.container.textContent, /Estimated total: USD 34.05/);
    assert.equal(ui.button('Place Order').disabled, true);
    await ui.setBudget('40.00'); await ui.click('Approve estimate'); await ui.click('Place Order');
    assert.equal(app.calls.submissions[0].payment.margin.value, 305);
    assert.equal(app.calls.submissions[0].metadata.fetchit_margin_cents, 305);
    assert.equal(app.calls.submissions[0].metadata.zinc_fee_cents, 100);
    assert.equal(app.calls.inserts[0].service_fee, 3.05);
    assert.equal(app.calls.submissions[0].max_price, 4000);
  } finally { await ui.close(); }
});

test('MOCK server with REAL proof: tampered subtotal/unit price/quantity or consent cannot submit', async () => {
  const app = backend(); const url = 'https://retailer.example/item';
  const input = { productUrl: url, quantity: 1, itemSubtotalCents: 1000, unitPriceCents: 1000,
    listingProof: await fixtureProof(url), currency: 'USD', displayedPriceCents: 1500,
    productName: 'Fixture', productImage: null, retailer: 'Fixture', idempotencyKey: require('node:crypto').randomUUID() };
  const quote = await app.api.getCheckoutQuote(input);
  for (const change of [{ itemSubtotalCents: 1 }, { unitPriceCents: 1, itemSubtotalCents: 1 },
    { quantity: 2 }, { quantity: 2, itemSubtotalCents: 2000 }, { listingProof: '{}' }]) {
    await assert.rejects(app.api.placeOrder({ ...input, ...change, approval: { quoteId: quote.id, mode: 'estimate', acceptsVariableFees: true, retailerBudgetCents: 1500, currency: 'USD' } }));
  }
  assert.equal(app.calls.submissions.length, 0);
  const updated = await app.api.getCheckoutQuote({ ...input, quantity: 2, itemSubtotalCents: 2000 });
  assert.equal(updated.fetchitMarginCents, 270); assert.equal(updated.serviceFeeCents, 370);
  assert.notEqual(updated.id, quote.id);
});

test('MOCK server with REAL proof: client fee overrides cannot reduce Connect margin or double-count Zinc', async () => {
  const app = backend(); const url = 'https://retailer.example/item';
  const input = { productUrl: url, quantity: 1, itemSubtotalCents: 1000, unitPriceCents: 1000,
    listingProof: await fixtureProof(url), currency: 'USD', displayedPriceCents: 1500,
    productName: 'Fixture', productImage: null, retailer: 'Fixture', idempotencyKey: require('node:crypto').randomUUID() };
  const quote = await app.api.getCheckoutQuote(input);
  await app.api.placeOrder({ ...input, fetchitMarginCents: 0, serviceFeeCents: 0, zincFeeCents: 0,
    approval: { quoteId: quote.id, mode: 'estimate', acceptsVariableFees: true, retailerBudgetCents: 1500, currency: 'USD' } });
  assert.equal(app.calls.submissions[0].payment.margin.value, 235);
  assert.equal(app.calls.submissions[0].metadata.zinc_fee_cents, 100);
});

test('MOCK current live payment failure is never completed in order history', async () => {
  const app = backend({ key: 'zn_live_fixture', upstream: async (_, options) => Response.json(options?.method === 'POST'
    ? { id: zincId, status: 'pending' }
    : { id: zincId, status: 'order_failed', job_result: { error_type: 'payment_failed' },
      connect: { payment_intent_id: 'pi_fixture', connected_account_id: 'acct_fixture', state: 'failed' } }),
    stripe: { customers: { retrieve: async () => ({ livemode: true, metadata: { supabase_uid: require('./harness.cjs').userId } }) },
      paymentMethods: { retrieve: async () => ({ livemode: true, customer: profile.stripe_customer_id }) },
      accounts: { retrieve: async () => ({ id: 'acct_fixture' }) },
      paymentIntents: { retrieve: async () => ({ livemode: true, status: 'requires_payment_method', amount_received: 0, currency: 'usd' }) } } });
  let ui = mount(app.api);
  await ui.start(); await ui.click('Approve estimate'); await ui.click('Place Order'); await ui.close();
  ui = mountHistory(app.reloadApi(), [{ id: localOrderId, zincOrderId: zincId, status: 'completed', orderPrice: 10, serviceFee: 2.35 }]);
  try {
    await ui.start(); assert.match(ui.container.textContent, /Retailer status: failed/);
    assert.match(ui.container.textContent, /Payment status: requires_payment_method/);
    assert.doesNotMatch(ui.container.textContent, /Completed|Captured:/);
  } finally { await ui.close(); }
});

test('MOCK missing US state fails before retailer submission', async () => {
  const old = profile.state; profile.state = '';
  const app = backend(); const url = 'https://retailer.example/item';
  try {
    await assert.rejects(app.api.getCheckoutQuote({ productUrl: url, quantity: 1, unitPriceCents: 1000,
      itemSubtotalCents: 1000, listingProof: await fixtureProof(url), currency: 'USD', displayedPriceCents: 1500,
      productName: 'Fixture', productImage: null, retailer: 'Fixture', idempotencyKey: require('node:crypto').randomUUID() }),
      e => e.code === 'incomplete_shipping_address');
    assert.equal(app.calls.submissions.length, 0);
  } finally { profile.state = old; }
});

test('MOCK malformed recovery data and simultaneous claims fail closed', async () => {
  const values = new Map();
  const key = 'fetchit.checkout.pending.fixture-user';
  const imports = { 'expo-secure-store': { getItemAsync: async k => values.get(k) ?? null,
    setItemAsync: async (k, v) => values.set(k, v), deleteItemAsync: async k => values.delete(k) },
    '@/lib/supabase': { supabase: { auth: { getUser: async () => ({ data: { user: { id: 'fixture-user' } } }) } } } };
  const journal = load('src/services/checkoutSubmission.ts', imports);
  values.set(key, '{broken');
  await assert.rejects(journal.beginSubmission('first')); assert.equal(values.get(key), '{broken');
  values.delete(key);
  const attempts = await Promise.allSettled([journal.beginSubmission('first'), journal.beginSubmission('second')]);
  assert.equal(attempts.filter(x => x.status === 'fulfilled').length, 1);
  assert.equal((await journal.getSavedSubmission()).idempotencyKey, 'first');
});
