const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function load(path, context) {
  const source = fs.readFileSync(path, 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText;
  vm.createContext(context);
  vm.runInContext(code, context);
  return context;
}

function service(invoke) {
  const context = { exports: {}, require: () => ({ supabase: { functions: { invoke } } }) };
  return load('src/services/orderService.ts', context).exports;
}

function screen(placeOrder, pricingReady = true, approved = true) {
  const { PlaceOrderError } = service(async () => ({}));
  const source = ts.createSourceFile('checkout.tsx', fs.readFileSync('src/app/(app)/checkout-confirmation.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === 'confirmPurchase') handler = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler);
  const calls = { requests: [], orders: [], errors: [], unknown: [] };
  const context = {
    validProduct: true, hasAddress: true, hasCard: true, pricing: { canSubmit: pricingReady },
    submitting: false, submissionLocked: { current: false },
    quote: pricingReady ? { id: "a".repeat(64), maximumCents: 1100, currency: "USD", expiresAt: Date.now() + 100000 } : null,
    approvedQuoteId: approved ? "a".repeat(64) : null, retailerBudgetCents: 1000,
    hasApprovedMaximum: load("src/services/checkoutPricing.ts", { exports: {} }).exports.hasApprovedMaximum,
    setApprovedQuoteId(value) { context.approvedQuoteId = value; },
    setQuoteResult() { context.quote = null; }, setQuoteRefresh() {},
    productUrl: 'https://retailer.example/item', quantity: 1, totalCents: 1000,
    title: 'Fixture', image: null, retailer: 'Fixture', idempotencyKey: '00000000-0000-4000-8000-000000000000',
    PlaceOrderError,
    // Do not update `submitting`: reproduce two taps before React re-renders.
    setSubmitting() {}, setError: x => calls.errors.push(x),
    setPlacedOrder: x => calls.orders.push(x), setWarning() {},
    setOutcomeUnknown: x => calls.unknown.push(x),
    placeOrder: async input => { calls.requests.push(input); return placeOrder(input, PlaceOrderError); },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  return { run: context.confirmPurchase, calls };
}

const accepted = { id: null, zincOrderId: 'zinc_fixture', status: 'pending', totalCents: 1000, recorded: false };

test('two taps before render and a tap after acceptance submit only once, even if local persistence failed', async () => {
  let resolve;
  const response = new Promise(r => { resolve = r; });
  const client = screen(() => response);
  const first = client.run();
  await client.run();
  assert.equal(client.calls.requests.length, 1);
  resolve({ order: accepted, warning: 'Recording unavailable' });
  await first;
  await client.run();
  assert.equal(client.calls.requests.length, 1);
  assert.equal(client.calls.orders[0].recorded, false);
});

for (const code of ['place_order_failed', 'malformed_response', 'zinc_unreachable', 'malformed_zinc_response']) {
  test(`${code}: an uncertain outcome prevents another submission and does not claim no charge`, async () => {
    const client = screen(async (_, ErrorType) => { throw new ErrorType(code, 'PRIVATE'); });
    await client.run();
    await client.run();
    assert.equal(client.calls.requests.length, 1);
    assert.equal(client.calls.unknown[0], true);
    assert.match(client.calls.errors.at(-1), /Check order history.*before submitting/);
    assert.doesNotMatch(client.calls.errors.join(' '), /PRIVATE|not charged|please try again/i);
  });
}

test('a proven pre-submission rejection permits an explicit retry with the same idempotency key', async () => {
  let attempts = 0;
  const client = screen(async (_, ErrorType) => {
    if (!attempts++) throw new ErrorType('missing_payment_method', 'Save a card first.');
    return { order: accepted };
  });
  await client.run();
  assert.equal(client.calls.requests.length, 1); // no automatic retry
  await client.run();
  assert.equal(client.calls.requests.length, 2);
  assert.equal(client.calls.requests[0].idempotencyKey, client.calls.requests[1].idempotencyKey);
});

test('service preserves accepted-but-unrecorded confirmation and pending status', async () => {
  const api = service(async () => ({ data: { success: true, order: accepted, warning: 'Recording unavailable' }, error: null }));
  const result = await api.placeOrder({});
  assert.equal(result.order, accepted);
  assert.equal(result.order.status, 'pending');
  assert.equal(result.warning, 'Recording unavailable');
});

test('transport failure and malformed success are uncertain, not proof the purchase failed', async () => {
  for (const response of [{ error: new Error('PRIVATE') }, { data: { success: true } }]) {
    const api = service(async () => response);
    await assert.rejects(api.placeOrder({}), error => {
      assert.equal(error.outcomeUnknown, true);
      assert.match(error.userMessage, /before submitting/);
      assert.doesNotMatch(error.userMessage, /PRIVATE|try again/);
      return true;
    });
  }
});

function backend({ persistFails = false, zincStatus = 201, zincKey = "zn_live_fixture", simulated = false, production = false, pricingSupported = true, expireWhileVerifying = false } = {}) {
  let handler;
  let issuedQuote;
  const calls = { zinc: 0, inserts: 0, stripeWrites: 0 };
  const profile = {
    full_name: 'Fixture User', country: 'US', phone_number: 'fixture',
    stripe_payment_method_id: 'pm_fixture', stripe_customer_id: 'cus_fixture',
    address_line1: 'fixture', city: 'fixture', zip: 'fixture',
  };
  const client = {
    auth: { getUser: async () => ({ data: { user: { id: 'user_fixture', user_metadata: { stripe_customer_id: 'cus_fixture' } } } }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) };
      assert.equal(table, 'orders');
      return { insert(row) {
        calls.inserts++;
        assert.equal(row.status, simulated && production ? 'configuration_failed' : 'pending');
        assert.equal(row.zinc_order_id, 'zinc_fixture');
        return { select: () => ({ single: async () => persistFails
          ? { error: { message: 'fixture persistence failure' } }
          : { data: { id: 'order_fixture' } } }) };
      } };
    },
  };
  const source = ts.createSourceFile('backend.ts', fs.readFileSync('supabase/functions/place-order/index.ts', 'utf8'), ts.ScriptTarget.Latest, true);
  const text = source.statements.filter(x => !ts.isImportDeclaration(x)).map(x => x.getFullText(source)).join('\n');
  const context = {
    Response, URL, AbortSignal, console: { error() {} },
    Deno: { env: { get: name => name === 'ZINC_API_KEY' ? zincKey : name === 'SUPABASE_URL' ? (production ? 'https://fpphpncruohjlppqhfep.supabase.co' : 'https://fixture.example') : 'fixture' }, serve: fn => { handler = fn; } },
    connectPricingSupported: () => pricingSupported,
    createCheckoutQuote: async () => { issuedQuote = pricingSupported ? { id: 'a'.repeat(64), maximumCents: 1100, retailerBudgetCents: 1000, currency: 'USD', expiresAt: Date.now() + 100000 } : null; return issuedQuote; },
    approvesQuote: load('supabase/functions/_shared/checkout-pricing.ts', { exports: {} }).exports.approvesQuote,
    createClient: () => client, stripeIsLive: () => true,
    paymentStripe: () => ({
      customers: { retrieve: async () => { if (expireWhileVerifying) issuedQuote.expiresAt = 0; return { livemode: true, metadata: { supabase_uid: 'user_fixture' } }; } },
      paymentMethods: { retrieve: async () => ({ livemode: true, customer: 'cus_fixture' }) },
      paymentIntents: { create: () => { calls.stripeWrites++; throw new Error('Unexpected payment'); } },
    }),
    fetch: async (url, options) => {
      calls.zinc++;
      assert.equal(url, 'https://api.zinc.com/orders');
      assert.equal(JSON.parse(options.body).max_price, 1000); // Never charge the approved 1100 as goods.
      assert.equal(JSON.parse(options.body).payment.margin.value, 0);
      assert.equal(JSON.parse(options.body).idempotency_key, '00000000-0000-4000-8000-000000000000');
      return Response.json(zincStatus === 201 ? { id: 'zinc_fixture', status: 'pending', connect: { simulated } } : { error: { code: 'fixture_rejected', message: 'Rejected' } }, { status: zincStatus });
    },
  };
  vm.createContext(context);
  vm.runInContext(ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  const run = (overrides = {}) => handler(new Request('https://fixture.example', { method: 'POST', headers: { Authorization: 'Bearer fixture' }, body: JSON.stringify({
    productUrl: 'https://retailer.example/item', quantity: 1, displayedPriceCents: 1000,
    productName: 'Fixture', productImage: null, retailer: 'Fixture', idempotencyKey: '00000000-0000-4000-8000-000000000000',
    approval: { quoteId: 'a'.repeat(64), maximumCents: 1100, currency: 'USD' }, ...overrides,
  }) }));
  return { run, calls };
}

test('actual backend: Zinc acceptance followed by database failure stays submitted and never retries Zinc or charges Stripe', async () => {
  const api = backend({ persistFails: true });
  const response = await api.run();
  const body = await response.json();
  assert.equal(response.status, 201);
  assert.equal(body.success, true);
  assert.equal(body.order.recorded, false);
  assert.equal(body.order.id, null);
  assert.equal(body.order.status, 'pending');
  assert.deepEqual(api.calls, { zinc: 1, inserts: 1, stripeWrites: 0 });
});

test('actual backend: Zinc rejection never creates an order row or starts a separate payment', async () => {
  const api = backend({ zincStatus: 402 });
  const response = await api.run();
  assert.equal(response.status, 402);
  assert.equal((await response.json()).error.code, 'fixture_rejected');
  assert.deepEqual(api.calls, { zinc: 1, inserts: 0, stripeWrites: 0 });
});

for (const zincKey of ['zn_test_fixture', 'unrecognized_fixture']) {
  test(`production rejects ${zincKey} before Zinc submission`, async () => {
    const api = backend({ production: true, zincKey });
    const response = await api.run();
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, 'zinc_environment_mismatch');
    assert.deepEqual(api.calls, { zinc: 0, inserts: 0, stripeWrites: 0 });
  });
}
for (const persistFails of [false, true]) {
  test(`unexpected simulation preserves ID and prevents another tap; persistence failure=${persistFails}`, async () => {
    const api = backend({ production: true, simulated: true, persistFails });
    let result;
    const svc = service(async () => { const response = await api.run(); result = await response.json(); return { error: { context: { json: async () => result } } }; });
    const client = screen(input => svc.placeOrder(input));
    await client.run(); await client.run();
    assert.equal(result.error.reason, 'zinc_simulation_detected');
    assert.equal(result.investigation.zincOrderId, 'zinc_fixture');
    assert.equal(result.investigation.recorded, !persistFails);
    assert.equal(result.retryAllowed, false);
    assert.equal(client.calls.requests.length, 1);
    assert.equal(client.calls.unknown[0], true);
    assert.deepEqual(api.calls, { zinc: 1, inserts: 1, stripeWrites: 0 });
  });
}


test('unknown complete customer price prevents any frontend submission, including duplicate taps', async () => {
  const client = screen(() => { throw new Error('Must not submit'); }, false);
  await client.run(); await client.run();
  assert.equal(client.calls.requests.length, 0);
});

test('production pricing gate protects existing clients before Zinc, database inserts or charges', async () => {
  const api = backend({ production: true, pricingSupported: false });
  const response = await api.run();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'checkout_pricing_unavailable');
  assert.deepEqual(api.calls, { zinc: 0, inserts: 0, stripeWrites: 0 });
});

test('pricing preserves unknown fees and validates quantity, currency and safe integer arithmetic', () => {
  const pricing = load('src/services/checkoutPricing.ts', { exports: {} }).exports;
  const value = pricing.reviewCheckoutPrice(537, 3, 'USD');
  assert.equal(value.itemSubtotalCents, 1611);
  assert.equal(pricing.formatKnownPrice(value.itemSubtotalCents, value.currency), 'USD 16.11');
  for (const field of ['shippingCents','taxCents','zincFeeCents','paymentFeeCents','approvedMaximumCents']) assert.equal(value[field], null);
  assert.equal(value.fetchitMarginCents, 0);
  assert.equal(value.canSubmit, false);
  for (const quantity of [0, -1, 1.5, 101, NaN]) assert.equal(pricing.reviewCheckoutPrice(537, quantity, 'USD').itemSubtotalCents, null);
  for (const cents of [0, -1, 1.5, NaN, Number.MAX_SAFE_INTEGER]) assert.equal(pricing.reviewCheckoutPrice(cents, 2, 'USD').itemSubtotalCents, null);
  assert.equal(pricing.reviewCheckoutPrice(537, 1, '').currency, null);
  assert.match(pricing.formatKnownPrice(537, null), /currency unconfirmed/);
  assert.equal(pricing.formatKnownPrice(537, 'JPY'), '537 minor units · JPY');
  assert.equal(load('supabase/functions/_shared/checkout-pricing.ts', { exports: {} }).exports.connectPricingSupported(), false);
});


test('a displayed maximum without explicit approval cannot submit', async () => {
  const client = screen(() => { throw new Error('Must not submit'); }, true, false);
  await client.run(); await client.run();
  assert.equal(client.calls.requests.length, 0);
});

test('quote-only request cannot submit Zinc or write an order/payment', async () => {
  const api = backend();
  const response = await api.run({ action: 'quote', approval: undefined });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).quote.maximumCents, 1100);
  assert.deepEqual(api.calls, { zinc: 0, inserts: 0, stripeWrites: 0 });
});

for (const approval of [undefined, {}, { quoteId: 'a'.repeat(64), maximumCents: 1000, currency: 'USD' }, { quoteId: 'a'.repeat(64), maximumCents: 1200, currency: 'USD' }, { quoteId: 'b'.repeat(64), maximumCents: 1100, currency: 'USD' }, { quoteId: 'a'.repeat(64), maximumCents: 1100, currency: 'EUR' }]) {
  test(`server rejects missing, changed or forged approval: ${JSON.stringify(approval)}`, async () => {
    const api = backend();
    const response = await api.run({ approval });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error.code, 'checkout_approval_required');
    assert.deepEqual(api.calls, { zinc: 0, inserts: 0, stripeWrites: 0 });
  });
}

test('real quote logic binds context, fee revision and validity; unknown pricing never produces a maximum', async () => {
  const module = load('supabase/functions/_shared/checkout-pricing.ts', { exports: {}, TextEncoder, crypto: require('node:crypto').webcrypto }).exports;
  const context = { userId: 'user_fixture', productUrl: 'https://retailer.example/item', quantity: 1, retailerBudgetCents: 1000, profile: { payment: 'pm_fixture', address: 'fixture' } };
  // Deliberately fictional adapter used only to exercise approval enforcement.
  // No public example fee schedule is installed as a production adapter.
  const policy = { revision: 'test-only', currency: 'USD', maximumCustomerCharge: budget => budget + 100 };
  assert.equal(await module.createCheckoutQuote(context), null);
  assert.equal(module.connectPricingSupported(), false);
  const now = 600000;
  const quote = await module.createCheckoutQuote(context, policy, now);
  const approval = { quoteId: quote.id, maximumCents: quote.maximumCents, currency: quote.currency };
  assert.equal(module.approvesQuote(approval, quote, now), true);
  assert.equal(module.approvesQuote(approval, quote, quote.expiresAt), false);
  for (const changed of [{ userId: 'another' }, { quantity: 2 }, { productUrl: 'https://retailer.example/other' }, { retailerBudgetCents: 1001 }, { profile: { payment: 'pm_other', address: 'fixture' } }, { profile: { payment: 'pm_fixture', address: 'changed' } }]) {
    const next = await module.createCheckoutQuote({ ...context, ...changed }, policy, now);
    assert.equal(module.approvesQuote(approval, next, now), false);
  }
  const revised = await module.createCheckoutQuote(context, { ...policy, revision: 'changed-fee-policy' }, now);
  assert.equal(module.approvesQuote(approval, revised, now), false);
  const expired = await module.createCheckoutQuote(context, policy, quote.expiresAt);
  assert.equal(module.approvesQuote(approval, expired, quote.expiresAt), false);
  for (const amount of [999, 1000.5, Number.MAX_SAFE_INTEGER + 1, NaN]) {
    assert.equal(await module.createCheckoutQuote(context, { ...policy, maximumCustomerCharge: () => amount }, now), null);
  }
});

test('approval copy separates the ceiling from actual charge; budget parsing does not round hidden fractions', () => {
  const api = load('src/services/checkoutPricing.ts', { exports: {} }).exports;
  assert.equal(api.maximumApprovalText(1234), 'Authorize up to $12.34, including shipping, taxes, and fees. Your final charge may be lower.');
  assert.equal(api.parseRetailerBudget('12.34'), 1234);
  assert.equal(api.formatUsdCents(Number.MAX_SAFE_INTEGER), '90071992547409.91');
  assert.equal(api.formatUsdCents(1), '0.01');
  for (const value of ['12.345', '-1', 'NaN', '', '0', '9007199254740992']) assert.equal(api.parseRetailerBudget(value), null);
  assert.equal(api.hasApprovedMaximum({ id: 'fixture', maximumCents: 1234, currency: 'USD', expiresAt: 100 }, 'fixture', 100), false);
});


for (const code of ['checkout_approval_required', 'max_price_exceeded']) {
  test(`${code}: a changed/insufficient ceiling clears consent and does not automatically resubmit`, async () => {
    const client = screen(async (_, ErrorType) => { throw new ErrorType(code, 'Review the maximum.'); });
    await client.run(); await client.run();
    assert.equal(client.calls.requests.length, 1);
    assert.equal(client.calls.unknown[0], false);
  });
}

test('client rejects malformed, expired, wrong-currency and wrong-budget server quotes', async () => {
  const valid = { id: 'a'.repeat(64), maximumCents: 1100, retailerBudgetCents: 1000, currency: 'USD', expiresAt: Date.now() + 100000 };
  const input = { displayedPriceCents: 1000 };
  for (const change of [{ id: 'invalid' }, { maximumCents: 999 }, { maximumCents: 1100.5 }, { currency: 'EUR' }, { retailerBudgetCents: 900 }, { expiresAt: Date.now() - 1 }]) {
    const api = service(async () => ({ data: { quote: { ...valid, ...change } } }));
    await assert.rejects(api.getCheckoutQuote(input), error => error.code === 'checkout_pricing_unavailable');
  }
  let sent;
  const api = service(async (_name, args) => { sent = args; return { data: { quote: valid } }; });
  assert.equal(await api.getCheckoutQuote(input), valid);
  assert.equal(sent.body.action, 'quote');
  assert.equal(sent.body.approval, undefined);
});


test('approval expiring during Stripe reference reads stops before Zinc or any write', async () => {
  const api = backend({ expireWhileVerifying: true });
  const response = await api.run();
  assert.equal(response.status, 409);
  assert.equal((await response.json()).error.code, 'checkout_approval_required');
  assert.deepEqual(api.calls, { zinc: 0, inserts: 0, stripeWrites: 0 });
});
