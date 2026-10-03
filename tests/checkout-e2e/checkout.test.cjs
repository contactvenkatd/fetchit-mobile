const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, mount, zincId, localOrderId, load } = require('./harness.cjs');

test('MOCK: complete DOM checkout → real service/backend → simulated provider status', async () => {
  const app = backend(); const ui = mount(app.api);
  try {
    await ui.start();
    assert.match(ui.container.textContent, /Estimated total: USD 11.00 \+ shipping, taxes, and processing fees \(amounts unknown\)/);
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
  const input = { productUrl: 'https://retailer.example/item', quantity: 1, itemSubtotalCents: 1000,
    currency: 'USD', displayedPriceCents: 1200, productName: 'Fixture', productImage: null,
    retailer: 'Fixture', idempotencyKey: require('node:crypto').randomUUID() };
  const quote = await app.api.getCheckoutQuote(input);
  assert.equal(quote.knownCostsCents, 1100); assert.equal(quote.paymentFeeCents, null);
  await assert.rejects(app.api.placeOrder({ ...input, approval: { quoteId: quote.id, maximumCents: 1300, currency: 'USD' } }), e => e.code === 'checkout_approval_required');
  await assert.rejects(app.api.placeOrder({ ...input, currency: 'EUR' }), e => e.code === 'invalid_order');
  assert.equal(app.calls.submissions.length, 0); assert.equal(app.calls.stripeReads, 0);
});
