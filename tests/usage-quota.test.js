const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const policy = import('../supabase/functions/_shared/stripe-subscription-state.mjs');

// Same isolated loader as tests/checkout-e2e/harness.cjs: strip imports and
// inject every dependency as a global.
function load(file, globals = {}) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const body = ast.statements.filter(x => !ts.isImportDeclaration(x)).map(x => x.getFullText(ast)).join('\n');
  const context = { exports: {}, console: { warn() {}, error() {} }, Date, ...globals };
  vm.runInNewContext(ts.transpileModule(body, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS,
  } }).outputText, context, { filename: file });
  return context.exports;
}
// Objects created in the vm realm: compare fields, not prototypes.
const plain = value => JSON.parse(JSON.stringify(value));

const quotaModuleExports = load('supabase/functions/_shared/usage-quota.ts', { Intl, Deno: { env: { get: () => undefined } } });
const resetsAt = '2026-11-01T00:00:00.000Z';
const exceeded = bucket => ({ allowed: false, reason: 'exceeded',
  snapshot: { bucket, plan: 'Free', usedCents: 50, limitCents: 50, remainingCents: 0, periodKey: '2026-10', resetsAt } });
const intent = { productQuery: 'skillet', quantity: 1, size: null, color: null, priceCeiling: null, retailerPreference: null };

function handler(file, { user = { id: 'u1' }, decision = { allowed: true, snapshot: null }, fetcher, env = {} } = {}) {
  const calls = { fetch: 0, checked: [], charged: [] };
  let serve;
  load(file, {
    Response, Request, URL, AbortSignal, signListingPrice: async () => 'proof',
    authenticateRequest: async () => user,
    checkQuota: async (_user, bucket) => { calls.checked.push(bucket); return decision; },
    chargeQuota: async (_user, bucket, micro) => { calls.charged.push([bucket, micro]); },
    quotaExceededBody: s => ({ error: { code: 'quota_exceeded', bucket: s.bucket, limitCents: s.limitCents, resetsAt: s.resetsAt } }),
    ZINC_CALL_MICROCENTS: quotaModuleExports.ZINC_CALL_MICROCENTS,
    GROK_FALLBACK_MICROCENTS: quotaModuleExports.GROK_FALLBACK_MICROCENTS,
    grokCostMicrocents: quotaModuleExports.grokCostMicrocents,
    fetch: async (...args) => {
      calls.fetch++;
      if (!fetcher) throw new Error('paid upstream must not be called');
      return fetcher(...args);
    },
    Deno: { env: { get: name => ({ ZINC_API_KEY: 'zn_test_fixture', XAI_API_KEY: 'xai-fixture', ...env })[name] },
      serve: fn => { serve = fn; } },
  });
  const call = body => serve(new Request('https://isolated.invalid/fn', { method: 'POST', body: JSON.stringify(body) }));
  return { call, calls };
}

for (const [file, body, bucket] of [
  ['supabase/functions/search-products/index.ts', intent, 'zinc'],
  ['supabase/functions/parse-shopping-intent/index.ts', { message: 'find a skillet' }, 'ai'],
]) {
  test(`${bucket}: unauthenticated callers are rejected before any paid call`, async () => {
    const { call, calls } = handler(file, { user: null });
    assert.equal((await call(body)).status, 401);
    assert.deepEqual([calls.fetch, calls.checked.length, calls.charged.length], [0, 0, 0]);
  });
  test(`${bucket}: a spent budget returns 429 with the reset date before any paid call`, async () => {
    const { call, calls } = handler(file, { decision: exceeded(bucket) });
    const response = await call(body);
    assert.equal(response.status, 429);
    assert.deepEqual((await response.json()).error, { code: 'quota_exceeded', bucket, limitCents: 50, resetsAt });
    assert.deepEqual([calls.fetch, calls.checked, calls.charged.length], [0, [bucket], 0]);
  });
  test(`${bucket}: invalid requests are not checked or charged`, async () => {
    const { call, calls } = handler(file);
    assert.equal((await call({})).status, 400);
    assert.deepEqual([calls.checked.length, calls.charged.length], [0, 0]);
  });
}

test('zinc: an unavailable quota system fails closed with 503', async () => {
  const { call, calls } = handler('supabase/functions/search-products/index.ts',
    { decision: { allowed: false, reason: 'unavailable' } });
  const response = await call(intent);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'quota_unavailable');
  assert.equal(calls.fetch, 0);
});

// --- search-products: actual Zinc call counting -----------------------------

const asins = ['B000000001', 'B000000002', 'B000000003'];
function zinc({ results = asins, variantSwap = false, failDetailsFor = null, searchStatus = 'completed' } = {}) {
  return async url => {
    const p = url.pathname;
    if (p === '/products/search') {
      return Response.json({ status: searchStatus, results: results.map(id => ({ product_id: id, title: id })) });
    }
    const asin = p.split('/')[2];
    if (failDetailsFor === asin) return new Response('{}', { status: 500 });
    if (p.endsWith('/offers')) {
      return Response.json({ status: 'completed', retailer: 'amazon', asin, offers: [{ asin, price: 1000, currency: 'USD',
        available: true, condition: 'New', seller: { id: 'S1', name: 'Seller' } }] });
    }
    const child = 'C' + asin.slice(1);
    const variant = [{ dimension: 'Size', value: 'L' }];
    return Response.json({ status: 'completed', retailer: 'amazon', asin, title: asin, buyapi_hint: true,
      variant_specifics: variantSwap && !asin.startsWith('C') ? [{ dimension: 'Size', value: 'S' }] : variant,
      all_variants: [{ product_id: child, variant_specifics: variant }] });
  };
}
const cents = micro => micro / 1_000_000;

for (const [label, options, body, expected] of [
  ['3 results, no variant: 1 search + 3 × (details + offers)', {}, intent, 7],
  ['variant swap adds a second details call per result', { variantSwap: true }, { ...intent, size: 'L' }, 1 + 3 * 3],
  ['a failed (non-2xx) details call is not billed and skips offers', { failDetailsFor: asins[1] }, intent, 1 + 2 * 2],
  ['zero results: only the search call', { results: [] }, intent, 1],
]) {
  test(`zinc: charges actual calls — ${label}`, async () => {
    const { call, calls } = handler('supabase/functions/search-products/index.ts', { fetcher: zinc(options) });
    assert.equal((await call(body)).status, 200);
    assert.deepEqual(calls.charged.map(([b, m]) => [b, cents(m)]), [['zinc', expected]]);
    assert.equal(calls.fetch, expected + (options.failDetailsFor ? 1 : 0));
  });
}

test('zinc: error paths still charge the calls that were made', async () => {
  const { call, calls } = handler('supabase/functions/search-products/index.ts', { fetcher: zinc({ searchStatus: 'pending' }) });
  assert.equal((await call(intent)).status, 502);
  assert.deepEqual(calls.charged.map(([b, m]) => [b, cents(m)]), [['zinc', 1]]);
});

// --- parse-shopping-intent: actual token cost --------------------------------

function grok(status, payload) {
  return async () => new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
}

test('ai: debits the real cost from usage tokens after the call', async () => {
  const usage = { prompt_tokens: 1000, completion_tokens: 100, total_tokens: 1600,
    prompt_tokens_details: { cached_tokens: 200 }, completion_tokens_details: { reasoning_tokens: 500 } };
  const { call, calls } = handler('supabase/functions/parse-shopping-intent/index.ts',
    { fetcher: grok(200, { choices: [{ message: { content: 'Hi there' } }], usage }) });
  const response = await call({ message: 'hello' });
  assert.equal(response.status, 200);
  // 800 × 125 + 200 × 20 + (1600 − 1000) × 250 = 254,000 µ¢ = 0.254¢
  assert.deepEqual(calls.charged, [['ai', 254_000]]);
});

test('ai: OK without usage charges the worst-case estimate; an error without usage charges nothing', async () => {
  const ok = handler('supabase/functions/parse-shopping-intent/index.ts',
    { fetcher: grok(200, { choices: [{ message: { content: 'Hi' } }] }) });
  await ok.call({ message: 'hello' });
  assert.deepEqual(ok.calls.charged, [['ai', 1_018_750]]);
  const failed = handler('supabase/functions/parse-shopping-intent/index.ts',
    { fetcher: grok(500, { error: { message: 'down' } }) });
  assert.equal((await failed.call({ message: 'hello' })).status, 502);
  assert.deepEqual(failed.calls.charged, [['ai', 0]]);
});

// --- _shared/usage-quota.ts --------------------------------------------------

test('grok cost: total − prompt bills reasoning once either way; long context doubles', () => {
  const { grokCostMicrocents } = quotaModuleExports;
  // Reasoning reported outside completion_tokens (total = prompt + completion + reasoning).
  assert.equal(grokCostMicrocents({ prompt_tokens: 4150, completion_tokens: 1500, total_tokens: 6150,
    completion_tokens_details: { reasoning_tokens: 500 } }), 4150 * 125 + 2000 * 250);
  // Reasoning already inside completion_tokens (total = prompt + completion).
  assert.equal(grokCostMicrocents({ prompt_tokens: 4150, completion_tokens: 2000, total_tokens: 6150,
    completion_tokens_details: { reasoning_tokens: 500 } }), 4150 * 125 + 2000 * 250);
  // No total_tokens: fall back to completion + reasoning.
  assert.equal(grokCostMicrocents({ prompt_tokens: 10, completion_tokens: 5,
    completion_tokens_details: { reasoning_tokens: 5 } }), 10 * 125 + 10 * 250);
  assert.equal(grokCostMicrocents({ prompt_tokens: 200_000, completion_tokens: 0, total_tokens: 200_000 }), 2 * 200_000 * 125);
  assert.equal(grokCostMicrocents(undefined), null);
  assert.equal(grokCostMicrocents({ prompt_tokens: -1, completion_tokens: 3 }), null);
});

test('micro-cents serialize to exact decimal cents', () => {
  const { microcentsToCents } = quotaModuleExports;
  assert.equal(microcentsToCents(254_000), '0.254000');
  assert.equal(microcentsToCents(16_000_000), '16.000000');
  assert.equal(microcentsToCents(1_018_750), '1.018750');
  assert.equal(microcentsToCents(0), '0.000000');
});

function adminMock({ cached = null, rpcFails = false, family = [], users = {} } = {}) {
  const state = { used: { ai: 0, zinc: 0 }, upserts: [], consumes: [] };
  const admin = {
    from(table) {
      const q = {
        select: () => q, eq: () => q,
        maybeSingle: async () => ({ data: table === 'plan_entitlements' ? cached : null, error: null }),
        upsert: async row => { state.upserts.push(row); cached = row; return { error: null }; },
        then: (resolve) => resolve({ data: table === 'family_members' ? family : [], error: null }),
      };
      return q;
    },
    async rpc(name, args) {
      if (rpcFails) return { data: null, error: { message: 'down' } };
      const prior = state.used[args.p_bucket];
      const limit = Number(args.p_limit_cents);
      const row = (allowed, total) => ({ data: [{ allowed, cents_used: total, limit_cents: limit,
        remaining_cents: Math.max(limit - total, 0), period: '2026-10', resets_at: resetsAt }], error: null });
      if (name === 'quota_status') return row(true, prior);
      state.consumes.push({ limit, cost: args.p_cost_cents, enforce: args.p_enforce });
      const cost = Number(args.p_cost_cents);
      const fits = prior < limit && prior + cost <= limit;
      if (args.p_enforce && !fits) return row(false, prior);
      state.used[args.p_bucket] = prior + cost;
      return row(fits, prior + cost);
    },
    auth: { admin: { getUserById: async id => ({ data: { user: users[id] ?? null }, error: null }) } },
  };
  return { admin, state };
}

const sub = plan => ({ id: `sub_${plan}`, created: 1, status: 'active', livemode: false, metadata: { plan },
  current_period_end: 2000000000, cancel_at_period_end: false, items: { data: [{ price: { recurring: { interval: 'month' } } }] } });

async function quotaModule({ admin = adminMock().admin, env = {}, customers = {}, subs = {}, stripeDown = false } = {}) {
  const { subscriptionState } = await policy;
  const stripeCalls = { list: 0 };
  return { stripeCalls, mod: load('supabase/functions/_shared/usage-quota.ts', {
    Intl, subscriptionState, stripeIsLive: () => false,
    createClient: () => admin,
    paymentStripe: () => {
      if (stripeDown) throw new Error('stripe unavailable');
      return {
        customers: { retrieve: async id => { if (!customers[id]) throw Object.assign(new Error(), { code: 'resource_missing' }); return customers[id]; } },
        subscriptions: { list: ({ customer }) => { stripeCalls.list++; return subs[customer] ?? []; } },
      };
    },
    Deno: { env: { get: name => ({ SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'srv', ...env })[name] } },
  }) };
}

const owned = (id, uid = 'u1') => ({ id, livemode: false, deleted: false, metadata: { supabase_uid: uid } });
const user = (extra = {}) => ({ id: 'u1', app_metadata: {}, user_metadata: {}, ...extra });

test('per-plan cent budgets: margin-derived defaults, explicit env overrides, invalid env ignored', async () => {
  const { mod } = await quotaModule({ env: { QUOTA_AI_PRO_CENTS: '900.5', QUOTA_ZINC_MAX_CENTS: 'lots' } });
  assert.deepEqual(['Free', 'Plus', 'Pro', 'Max'].map(p => mod.budgetCents('ai', p)), [50, 224.55, 900.5, 3999.6]);
  assert.deepEqual(['Free', 'Plus', 'Pro', 'Max'].map(p => mod.budgetCents('zinc', p)), [50, 224.55, 874.5625, 3999.6]);
});

test('a client-written user_metadata.plan never raises the budget', async () => {
  const { admin, state } = adminMock();
  const { mod } = await quotaModule({ admin,
    customers: { cus_other: owned('cus_other', 'someone-else') }, subs: { cus_other: [sub('Max')] } });
  const decision = await mod.checkQuota(user({ user_metadata: { plan: 'Max', stripe_customer_id: 'cus_other' } }), 'zinc');
  assert.deepEqual([decision.snapshot.plan, decision.snapshot.limitCents], ['Free', 50]);
  assert.equal(state.upserts[0].plan, 'Free');
});

test('a verified Stripe subscription sets the budget and is cached', async () => {
  const { admin, state } = adminMock();
  const { mod, stripeCalls } = await quotaModule({ admin,
    customers: { cus_1: owned('cus_1') }, subs: { cus_1: [sub('Pro')] } });
  const pro = user({ app_metadata: { stripe_customers: { test: 'cus_1' } }, user_metadata: { plan: 'Free' } });
  assert.equal((await mod.checkQuota(pro, 'ai')).snapshot.limitCents, 874.5625);
  await mod.checkQuota(pro, 'ai');
  assert.equal(stripeCalls.list, 1);
  assert.deepEqual(state.upserts.map(r => [r.plan, r.source]), [['Pro', 'stripe']]);
});

test('family members inherit Max only from an owner whose own Stripe plan is Max', async () => {
  const owner = { id: 'owner', app_metadata: { stripe_customers: { test: 'cus_owner' } }, user_metadata: {} };
  for (const [ownerPlan, expected] of [['Max', 'Max'], ['Pro', 'Free']]) {
    const { admin } = adminMock({ family: [{ owner_id: 'owner', pending_disband_at: null }], users: { owner } });
    const { mod } = await quotaModule({ admin,
      customers: { cus_owner: owned('cus_owner', 'owner') }, subs: { cus_owner: [sub(ownerPlan)] } });
    assert.equal((await mod.checkQuota(user({ user_metadata: { plan: 'max_family' } }), 'ai')).snapshot.plan, expected);
  }
});

test('check → charge actual cost → overshoot is recorded, then the next check refuses', async () => {
  const { admin, state } = adminMock();
  const { mod } = await quotaModule({ admin, env: { QUOTA_ZINC_FREE_CENTS: '20' } });
  const u = user();
  const first = await mod.checkQuota(u, 'zinc');
  assert.equal(first.allowed, true);
  await mod.chargeQuota(u, 'zinc', 16_000_000, first); // a full 16-call search
  const second = await mod.checkQuota(u, 'zinc');
  assert.equal(second.allowed, true); // 4¢ left
  await mod.chargeQuota(u, 'zinc', 11_000_000, second); // real cost overshoots by 7¢
  const third = await mod.checkQuota(u, 'zinc');
  assert.deepEqual([third.allowed, third.reason, third.snapshot.usedCents, third.snapshot.remainingCents],
    [false, 'exceeded', 27, 0]);
  assert.deepEqual(plain(state.consumes.filter(c => !c.enforce).map(c => c.cost)), ['16.000000', '11.000000']);
});

test('a denied check re-verifies a stale plan so an upgrade applies immediately', async () => {
  const { admin } = adminMock({ cached: { plan: 'Free', verified_at: new Date(Date.now() - 120_000).toISOString() } });
  const { mod } = await quotaModule({ admin, env: { QUOTA_PLAN_CACHE_SECONDS: '600' },
    customers: { cus_1: owned('cus_1') }, subs: { cus_1: [sub('Plus')] } });
  const u = user({ app_metadata: { stripe_customers: { test: 'cus_1' } } });
  await mod.chargeQuota(u, 'zinc', 50_000_000, await mod.checkQuota(u, 'zinc')); // Free budget spent
  const upgraded = await mod.checkQuota(u, 'zinc');
  assert.deepEqual([upgraded.allowed, upgraded.snapshot.plan, upgraded.snapshot.limitCents], [true, 'Plus', 224.55]);
});

test('Stripe outage falls back to the last verified plan, never metadata', async () => {
  const { admin } = adminMock({ cached: { plan: 'Pro', verified_at: '2000-01-01T00:00:00Z' } });
  const { mod } = await quotaModule({ admin, stripeDown: true });
  assert.equal((await mod.checkQuota(user({ user_metadata: { plan: 'Max' } }), 'ai')).snapshot.plan, 'Pro');
});

test('quota system failure: AI fails open, Zinc fails closed; a failed debit never throws', async () => {
  const broken = await quotaModule({ admin: adminMock({ rpcFails: true }).admin });
  assert.deepEqual(plain(await broken.mod.checkQuota(user(), 'ai')), { allowed: true, snapshot: null });
  assert.deepEqual(plain(await broken.mod.checkQuota(user(), 'zinc')), { allowed: false, reason: 'unavailable' });
  await broken.mod.chargeQuota(user(), 'ai', 254_000, { allowed: true, snapshot: null });
  const unconfigured = await quotaModule({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  assert.equal((await unconfigured.mod.checkQuota(user(), 'ai')).allowed, true);
  assert.equal((await unconfigured.mod.checkQuota(user(), 'zinc')).allowed, false);
});

test('quotaStatus reads both buckets without debiting; the 429 body names dollars and the reset date', async () => {
  const { admin, state } = adminMock();
  const { mod } = await quotaModule({ admin });
  const status = await mod.quotaStatus(user());
  assert.deepEqual([status.buckets.ai.remainingCents, status.buckets.zinc.limitCents], [50, 50]);
  assert.equal(state.consumes.length, 0);
  const body = mod.quotaExceededBody({ ...exceeded('ai').snapshot, plan: 'Plus', limitCents: 224.55 });
  assert.equal(body.error.code, 'quota_exceeded');
  assert.match(body.error.message, /\$2\.24 AI chat budget/);
  assert.match(body.error.message, /November 1, 2026/);
});
