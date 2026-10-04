const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, mount, mountHistory, load, profile, localOrderId, zincId } = require('./harness.cjs');

async function searchListing(currency = 'USD') {
  // Generic checkout fixture, independent of the current retailer search scope.
  const url = 'https://zinc.com/shop/products/test-success';
  const listing = load('supabase/functions/_shared/listing-price.ts');
  return { url, currency, price: 1000,
    listingProof: await listing.signListingPrice(url, 1000, currency, 'mock-signing-key') };
}

async function verifySearchToCheckout(upstream, key = 'zn_test_fixture') {
  const result = await searchListing();
  assert.equal(result.currency, 'USD'); assert.ok(result.listingProof);
  const app = backend({ key, upstream });
  const ui = mount(app.api, 'test-success', { productUrl: result.url, currency: result.currency,
    listingProof: result.listingProof, priceCents: String(result.price), quantity: '2', size: 'Large', color: 'Black' });
  try {
    await ui.start(); assert.match(ui.container.textContent, /Service fee: USD 3.70/);
    assert.equal(ui.button('Place Order').disabled, true);
    await ui.setBudget('25.00'); await ui.click('Approve estimate');
    await ui.act(async () => { const button = ui.button('Place Order'); button.click(); button.click(); }); await ui.flush();
    const deadline = Date.now() + 15000;
    while (app.calls.inserts.length === 0 && Date.now() < deadline) await ui.flush();
    assert.equal(app.calls.submissions.length, 1); assert.equal(app.calls.inserts.length, 1);
    const sent = app.calls.submissions[0];
    assert.equal(sent.max_price, 2500); assert.equal(sent.payment.margin.value, 270);
    assert.equal(sent.payment.customer, profile.stripe_customer_id);
    assert.equal(sent.payment.payment_method, profile.stripe_payment_method_id);
    assert.equal(sent.products[0].quantity, 2);
    assert.deepEqual(sent.products[0].variant, [{ label: 'Size', value: 'Large' }, { label: 'Color', value: 'Black' }]);
    assert.deepEqual(sent.shipping_address, { first_name: 'Sandbox', last_name: 'Agent',
      address_line1: profile.address_line1, address_line2: profile.address_line2, city: profile.city,
      state: profile.state, postal_code: profile.zip, country: profile.country, phone_number: profile.phone_number });
    assert.equal(sent.metadata.fetchit_item_subtotal_cents, 2000);
    assert.equal(sent.metadata.zinc_fee_cents, 100);
    // Reload client modules/storage: no second POST is possible after acceptance.
    await ui.close();
    const recovery = mount(app.reloadApi());
    try { await recovery.start(); assert.match(recovery.container.textContent, /Zinc order/); assert.equal(app.calls.submissions.length, 1); }
    finally { await recovery.close(); }
    return { orderId: app.calls.inserts[0].zinc_order_id, request: sent, app };
  } finally { if (ui.container.isConnected) await ui.close(); }
}

if (process.env.RUN_BUILD14_TARGETED_ZINC_SANDBOX === '1') {
  test('REAL Zinc sandbox with mocked search/auth/DB/Stripe: USD proof → quantity/variants/address → restart → history tracking and delivery', async () => {
    const { sandboxKey, sandboxFetch } = require('./providers.cjs');
    const key = await sandboxKey(); const upstream = sandboxFetch(key);
    const { orderId, app } = await verifySearchToCheckout(upstream, key);
    const response = await upstream(`https://api.zinc.com/orders/${orderId}`);
    assert.equal(response.ok, true); const order = await response.json();
    assert.equal(order.id, orderId); assert.equal(order.connect.simulated, true);
    assert.equal(order.connect.zinc_fee, 100);
    // Read the backend's inserted row through the actual client DB mapper.
    // Only the database transport is mocked, not the order-history data shape.
    const dataModule = load('src/lib/data.ts', { '@/lib/supabase': { supabase: {
      from: table => { assert.equal(table, 'orders'); return { select: () => ({
        order: async () => ({ data: app.calls.inserts.map(row => ({ ...row, id: localOrderId })), error: null }),
      }) }; },
    } } });
    let poll;
    const history = mountHistory(app.reloadApi(), [], { dataModule,
      setTimeout: fn => { poll = fn; return 1; }, clearTimeout: () => {},
    });
    try {
      await history.start();
      const deadline = Date.now() + 45000;
      while (!/Retailer status: delivered/.test(history.container.textContent) && Date.now() < deadline) {
        await history.act(async () => { await new Promise(resolve => setTimeout(resolve, 1000)); });
        if (poll) { await history.act(async () => { await poll(); }); await history.flush(); }
      }
      assert.match(history.container.textContent, /Retailer status: delivered/);
      assert.match(history.container.textContent, /Payment status: simulated/);
      assert.match(history.container.textContent, /Tracking: .*delivered/);
      assert.match(history.container.textContent, /Sandbox simulation; no real shipment or charge confirmed/);
      assert.match(history.container.textContent, /Service fee: \$3.70/);
      assert.doesNotMatch(history.container.textContent, /Captured:|Actual captured amount/);
      assert.equal(app.calls.submissions.length, 1);
    } finally { await history.close(); }
    console.log('One new real Zinc test simulation; no live financial operations or new Stripe tests. Search price, auth, database and Stripe references mocked.');
  });
  test('REAL Zinc sandbox acceptance with injected lost response stays locked across restart', async () => {
    const { sandboxKey, sandboxFetch } = require('./providers.cjs');
    const key = await sandboxKey(); const upstream = sandboxFetch(key);
    let acceptedId;
    const app = backend({ key, upstream: async (url, options) => {
      const response = await upstream(url, options);
      if (options?.method === 'POST') {
        assert.equal(response.ok, true);
        acceptedId = (await response.json()).id;
        throw new DOMException('Test-injected lost response after real sandbox acceptance', 'TimeoutError');
      }
      return response;
    } });
    const checkout = mount(app.api);
    try {
      await checkout.start(); await checkout.click('Approve estimate'); await checkout.click('Place Order');
      const deadline = Date.now() + 15000;
      while (!acceptedId && Date.now() < deadline) await checkout.flush();
      assert.ok(acceptedId); await checkout.flush();
      assert.equal(app.calls.inserts.length, 0);
      assert.doesNotMatch(checkout.container.textContent, /Order submitted/);
      assert.equal(app.calls.submissions.length, 1);
    } finally { await checkout.close(); }
    const recovery = mount(app.reloadApi());
    try {
      await recovery.start();
      assert.match(recovery.container.textContent, /unconfirmed|uncertain|reconcil|support/i);
      assert.ok(!recovery.button('Place Order') || recovery.button('Place Order').disabled);
      assert.equal(app.calls.submissions.length, 1);
      const readback = await upstream(`https://api.zinc.com/orders/${acceptedId}`);
      assert.equal(readback.ok, true); assert.equal((await readback.json()).connect.simulated, true);
    } finally { await recovery.close(); }
  });
} else {
  test('MOCK listing/providers, REAL proof signing/checkout/backend: explicit USD listing proceeds with correct consent and fee', async () => {
    await verifySearchToCheckout();
  });
  test('MOCK listing: unresolved currency cannot mint price evidence or approve checkout', async () => {
    const result = await searchListing(null);
    assert.equal(result.currency, null); assert.equal(result.listingProof, null);
    const app = backend(); const ui = mount(app.api, 'test-success', { currency: '', listingProof: '' });
    try {
      await ui.start(); assert.match(ui.container.textContent, /currency.*unconfirmed|confirmed USD/i);
      assert.equal(ui.button('Approve estimate'), undefined);
      assert.ok(!ui.button('Place Order') || ui.button('Place Order').disabled); assert.equal(app.calls.submissions.length, 0);
    } finally { await ui.close(); }
  });
  test('MOCK provider: history refreshes in place and clears stale delivery/payment on status read failure', async () => {
    let phase = 'pending'; let poll;
    const app = backend({ upstream: async (_, options) => {
      if (options?.method === 'POST') return Response.json({ id: zincId, status: 'pending', connect: { simulated: true } });
      if (phase === 'unavailable') return Response.json({}, { status: 503 });
      return Response.json({ id: zincId, status: phase === 'failed' ? 'order_failed' : 'order_placed',
        job_result: phase === 'failed' ? { error_type: 'product_out_of_stock' } : null,
        tracking_numbers: [{ carrier: 'ups', tracking_number: '1ZFIXTURE', status: phase }], connect: { simulated: true } });
    } });
    const checkout = mount(app.api); await checkout.start(); await checkout.click('Approve estimate'); await checkout.click('Place Order'); await checkout.close();
    const history = mountHistory(app.reloadApi(), [{ id: localOrderId, zincOrderId: zincId, status: 'completed', orderPrice: 10, serviceFee: 2.35 }], {
      setTimeout: (fn, milliseconds) => { assert.equal(milliseconds, 30000); poll = fn; return 1; }, clearTimeout: () => {},
    });
    try {
      await history.start();
      for (phase of ['in_transit', 'delivered', 'failed', 'unavailable']) {
        await history.act(async () => { await poll(); }); await history.flush();
        if (phase === 'unavailable') {
          assert.match(history.container.textContent, /Status unconfirmed/);
          assert.match(history.container.textContent, /Provider status unavailable/);
          assert.doesNotMatch(history.container.textContent, /Retailer status: delivered|Payment status: simulated|Completed/);
        } else {
          assert.match(history.container.textContent, new RegExp(`Retailer status: ${phase}`));
          assert.match(history.container.textContent, /Payment status: simulated/);
          if (phase === 'failed') assert.match(history.container.textContent, /product_out_of_stock/);
        }
      }
      assert.equal(app.calls.submissions.length, 1);
    } finally { await history.close(); }
  });
}
