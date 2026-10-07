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

const resetsAt = '2026-11-01T00:00:00.000Z';
const exceeded = { allowed: false, reason: 'exceeded',
  snapshot: { bucket: 'zinc', plan: 'Free', used: 10, limit: 10, remaining: 0, periodKey: '2026-10', resetsAt } };
const intent = { productQuery: 'skillet', quantity: 1, size: null, color: null, priceCeiling: null, retailerPreference: null };

function handler(file, { user = { id: 'u1' }, decision = { allowed: true, snapshot: null }, env = {} } = {}) {
  const calls = { fetch: 0, consumed: [] };
  let serve;
  load(file, {
    Response, Request, URL, AbortSignal, signListingPrice: () => null,
    authenticateRequest: async () => user,
    consumeQuota: async (_user, bucket) => { calls.consumed.push(bucket); return decision; },
    quotaExceededBody: s => ({ error: { code: 'quota_exceeded', bucket: s.bucket, limit: s.limit, resetsAt: s.resetsAt } }),
    fetch: async () => { calls.fetch++; throw new Error('paid upstream must not be called'); },
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
    assert.deepEqual([calls.fetch, calls.consumed.length], [0, 0]);
  });
  test(`${bucket}: exceeded quota returns 429 with the reset date and skips the upstream`, async () => {
    const { call, calls } = handler(file, { decision: { ...exceeded, snapshot: { ...exceeded.snapshot, bucket } } });
    const response = await call(body);
    assert.equal(response.status, 429);
    assert.deepEqual((await response.json()).error, { code: 'quota_exceeded', bucket, limit: 10, resetsAt });
    assert.deepEqual([calls.fetch, calls.consumed], [0, [bucket]]);
  });
  test(`${bucket}: invalid requests do not spend quota`, async () => {
    const { call, calls } = handler(file);
    assert.equal((await call({})).status, 400);
    assert.equal(calls.consumed.length, 0);
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

// --- _shared/usage-quota.ts --------------------------------------------------

function adminMock({ cached = null, rpcFails = false, family = [], users = {} } = {}) {
  const state = { used: { ai: 0, zinc: 0 }, upserts: [], consumeLimits: [] };
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
      const used = state.used[args.p_bucket];
      if (name === 'quota_status') return { data: [{ used, period: '2026-10', resets_at: resetsAt }], error: null };
      state.consumeLimits.push(args.p_limit);
      const allowed = used + args.p_units <= args.p_limit;
      if (allowed) state.used[args.p_bucket] += args.p_units;
      return { data: [{ allowed, used: state.used[args.p_bucket], unit_limit: args.p_limit, period: '2026-10', resets_at: resetsAt }], error: null };
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

test('limits scale 1x/2x/5x/25x from a tunable env baseline (invalid env → default)', async () => {
  const { mod } = await quotaModule({ env: { QUOTA_AI_FREE_UNITS: '40', QUOTA_ZINC_FREE_UNITS: 'nope' } });
  assert.deepEqual(['Free', 'Plus', 'Pro', 'Max'].map(p => mod.quotaLimit('ai', p)), [40, 80, 200, 1000]);
  assert.deepEqual(['Free', 'Plus', 'Pro', 'Max'].map(p => mod.quotaLimit('zinc', p)), [10, 20, 50, 250]);
});

test('a client-written user_metadata.plan never raises the limit', async () => {
  const { admin, state } = adminMock();
  const { mod } = await quotaModule({ admin, env: { QUOTA_ZINC_FREE_UNITS: '3' },
    customers: { cus_other: owned('cus_other', 'someone-else') }, subs: { cus_other: [sub('Max')] } });
  const forged = { id: 'u1', app_metadata: {}, user_metadata: { plan: 'Max', stripe_customer_id: 'cus_other' } };
  const decision = await mod.consumeQuota(forged, 'zinc');
  assert.equal(decision.snapshot.plan, 'Free');
  assert.equal(decision.snapshot.limit, 3);
  assert.equal(state.upserts[0].plan, 'Free');
});

test('a verified Stripe subscription sets the plan and is cached', async () => {
  const { admin, state } = adminMock();
  const { mod, stripeCalls } = await quotaModule({ admin, env: { QUOTA_AI_FREE_UNITS: '2' },
    customers: { cus_1: owned('cus_1') }, subs: { cus_1: [sub('Pro')] } });
  const user = { id: 'u1', app_metadata: { stripe_customers: { test: 'cus_1' } }, user_metadata: { plan: 'Free' } };
  assert.equal((await mod.consumeQuota(user, 'ai')).snapshot.limit, 10);
  await mod.consumeQuota(user, 'ai');
  assert.equal(stripeCalls.list, 1);
  assert.deepEqual(state.upserts.map(r => [r.plan, r.source]), [['Pro', 'stripe']]);
});

test('family members inherit Max only from an owner whose own Stripe plan is Max', async () => {
  const owner = { id: 'owner', app_metadata: { stripe_customers: { test: 'cus_owner' } }, user_metadata: {} };
  for (const [ownerPlan, expected] of [['Max', 'Max'], ['Pro', 'Free']]) {
    const { admin } = adminMock({ family: [{ owner_id: 'owner', pending_disband_at: null }], users: { owner } });
    const { mod } = await quotaModule({ admin,
      customers: { cus_owner: owned('cus_owner', 'owner') }, subs: { cus_owner: [sub(ownerPlan)] } });
    const member = { id: 'u1', app_metadata: {}, user_metadata: { plan: 'max_family' } };
    assert.equal((await mod.consumeQuota(member, 'ai')).snapshot.plan, expected);
  }
});

test('a denied call re-verifies a stale plan so an upgrade applies immediately', async () => {
  const { admin, state } = adminMock({ cached: { plan: 'Free', verified_at: new Date(Date.now() - 120_000).toISOString() } });
  const { mod } = await quotaModule({ admin, env: { QUOTA_ZINC_FREE_UNITS: '1', QUOTA_PLAN_CACHE_SECONDS: '600' },
    customers: { cus_1: owned('cus_1') }, subs: { cus_1: [sub('Plus')] } });
  const user = { id: 'u1', app_metadata: { stripe_customers: { test: 'cus_1' } }, user_metadata: {} };
  assert.equal((await mod.consumeQuota(user, 'zinc')).allowed, true); // cached Free, 1 of 1
  const upgraded = await mod.consumeQuota(user, 'zinc');
  assert.deepEqual([upgraded.allowed, upgraded.snapshot.plan, upgraded.snapshot.used], [true, 'Plus', 2]);
  assert.deepEqual(state.consumeLimits, [1, 1, 2]);
  const stop = await mod.consumeQuota(user, 'zinc');
  assert.deepEqual([stop.allowed, stop.reason, stop.snapshot.remaining], [false, 'exceeded', 0]);
});

test('Stripe outage falls back to the last verified plan, never metadata', async () => {
  const { admin } = adminMock({ cached: { plan: 'Pro', verified_at: '2000-01-01T00:00:00Z' } });
  const { mod } = await quotaModule({ admin, stripeDown: true });
  const user = { id: 'u1', app_metadata: {}, user_metadata: { plan: 'Max' } };
  assert.equal((await mod.consumeQuota(user, 'ai')).snapshot.plan, 'Pro');
});

test('quota system failure: AI fails open, Zinc fails closed', async () => {
  const user = { id: 'u1', app_metadata: {}, user_metadata: {} };
  const broken = await quotaModule({ admin: adminMock({ rpcFails: true }).admin });
  // Objects from the vm realm: compare fields, not prototypes.
  assert.deepEqual({ ...await broken.mod.consumeQuota(user, 'ai') }, { allowed: true, snapshot: null });
  assert.deepEqual({ ...await broken.mod.consumeQuota(user, 'zinc') }, { allowed: false, reason: 'unavailable' });
  const unconfigured = await quotaModule({ env: { SUPABASE_SERVICE_ROLE_KEY: undefined } });
  assert.equal((await unconfigured.mod.consumeQuota(user, 'ai')).allowed, true);
  assert.equal((await unconfigured.mod.consumeQuota(user, 'zinc')).allowed, false);
});

test('quotaStatus reads both buckets without spending, and the 429 body names the reset date', async () => {
  const { admin, state } = adminMock();
  const { mod } = await quotaModule({ admin });
  const status = await mod.quotaStatus({ id: 'u1', app_metadata: {}, user_metadata: {} });
  assert.deepEqual([status.buckets.ai.remaining, status.buckets.zinc.remaining], [50, 10]);
  assert.equal(state.consumeLimits.length, 0);
  const body = mod.quotaExceededBody(exceeded.snapshot);
  assert.equal(body.error.code, 'quota_exceeded');
  assert.match(body.error.message, /November 1, 2026/);
});
