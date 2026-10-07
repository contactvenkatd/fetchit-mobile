const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

const root = path.join(__dirname, '..');

// Same isolated loader as tests/usage-quota.test.js.
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

// In-memory balance_topup_events with the PostgREST builder subset used.
function store(rows = []) {
  const db = { rows, failReads: false, failInsert: false };
  db.client = {
    from() {
      const filters = []; let desc = false; let max = Infinity; let head = false;
      const run = () => {
        if (db.failReads) return { data: null, error: { message: 'down' }, count: null };
        let out = db.rows.filter(r => filters.every(f => f(r)));
        out = out.sort((a, b) => (desc ? -1 : 1) * (Date.parse(a.checked_at) - Date.parse(b.checked_at))).slice(0, max);
        return { data: head ? null : out, error: null, count: out.length };
      };
      const q = {
        select: (_cols, opts) => { head = Boolean(opts?.head); return q; },
        eq: (k, v) => { filters.push(r => r[k] === v); return q; },
        gt: (k, v) => { filters.push(r => Date.parse(r[k]) > Date.parse(v)); return q; },
        gte: (k, v) => { filters.push(r => Date.parse(r[k]) >= Date.parse(v)); return q; },
        order: (_k, o) => { desc = o?.ascending === false; return q; },
        limit: n => { max = n; return q; },
        maybeSingle: async () => { const r = run(); return { ...r, data: r.data?.[0] ?? null }; },
        then: resolve => resolve(run()),
        insert: async row => {
          if (db.failInsert) return { error: { message: 'down' } };
          db.rows.push({ ...row, id: db.rows.length + 1, checked_at: new Date().toISOString() });
          return { error: null };
        },
      };
      return q;
    },
  };
  return db;
}

const SECRET = 's'.repeat(40);
const ago = ms => new Date(Date.now() - ms).toISOString();
const HOUR = 3_600_000;

function monitor({ db = store(), wallet = { balance: 2000, spendable_balance: 2000 }, walletStatus = 200,
  env = {}, resendStatus = 200 } = {}) {
  const sent = [];
  let serve;
  load('supabase/functions/zinc-balance-monitor/index.ts', {
    Response, Request, URL, AbortSignal, TextEncoder, Intl,
    createClient: () => db.client,
    fetch: async (url, init) => {
      if (String(url) === 'https://api.zinc.com/wallet/me') {
        assert.equal(init.headers.Authorization, 'Bearer zn_live_fixture');
        return new Response(JSON.stringify(wallet), { status: walletStatus });
      }
      if (String(url) === 'https://api.resend.com/emails') {
        sent.push(JSON.parse(init.body));
        return new Response('{}', { status: resendStatus });
      }
      throw new Error(`unexpected request ${url}`);
    },
    Deno: { env: { get: name => ({ BALANCE_MONITOR_SECRET: SECRET, SUPABASE_URL: 'https://x.supabase.co',
      SUPABASE_SERVICE_ROLE_KEY: 'srv', ZINC_API_KEY: 'zn_live_fixture', RESEND_API_KEY: 're_fixture',
      ZINC_ALERT_EMAIL: 'ops@example.com', ...env })[name] }, serve: fn => { serve = fn; } },
  });
  const run = (secret = SECRET) => serve(new Request('https://isolated.invalid/zinc-balance-monitor',
    { method: 'POST', headers: secret ? { 'x-monitor-secret': secret } : {}, body: '{}' }));
  return { run, sent, db };
}

test('rejects callers without the monitor secret and never reads Zinc', async () => {
  const m = monitor();
  for (const secret of [null, 'wrong', SECRET + 'x']) assert.equal((await m.run(secret)).status, 401);
  assert.equal(m.db.rows.length, 0);
  const unconfigured = monitor({ env: { BALANCE_MONITOR_SECRET: 'short' } });
  assert.equal((await unconfigured.run('short')).status, 503);
});

test('a healthy balance logs a check and sends nothing', async () => {
  const m = monitor();
  const response = await m.run();
  assert.equal(response.status, 200);
  assert.equal(m.sent.length, 0);
  const [row] = m.db.rows;
  assert.deepEqual([row.provider, row.key_mode, row.spendable_cents, row.threshold_cents, row.below_threshold, row.alert_sent],
    ['zinc', 'live', 2000, 1000, false, false]);
});

test('spendable below $10 emails the configured address via Resend and logs it', async () => {
  const m = monitor({ wallet: { balance: 1200, spendable_balance: 950 } });
  await m.run();
  assert.equal(m.sent.length, 1);
  assert.equal(m.sent[0].to, 'ops@example.com');
  assert.match(m.sent[0].subject, /Zinc wallet low — \$9\.50 spendable/);
  assert.match(m.sent[0].html, /Wallet/);
  const [row] = m.db.rows;
  assert.deepEqual([row.below_threshold, row.alert_sent, row.alert_reason, row.alert_error], [true, true, 'low_balance', null]);
});

test('while it stays low, alerts repeat at most every ZINC_ALERT_REPEAT_HOURS', async () => {
  const low = { provider: 'zinc', below_threshold: true };
  const recent = store([{ ...low, alert_sent: true, checked_at: ago(2 * HOUR) }, { ...low, alert_sent: false, checked_at: ago(HOUR) }]);
  const suppressed = monitor({ db: recent, wallet: { balance: 500, spendable_balance: 500 } });
  await suppressed.run();
  assert.equal(suppressed.sent.length, 0);
  const latest = recent.rows.at(-1);
  assert.deepEqual([latest.below_threshold, latest.alert_sent, latest.alert_reason], [true, false, null]);

  const stale = store([{ ...low, alert_sent: true, checked_at: ago(7 * HOUR) }]);
  const repeated = monitor({ db: stale, wallet: { balance: 500, spendable_balance: 500 } });
  await repeated.run();
  assert.equal(repeated.sent.length, 1);
});

test('a recovery since the last alert re-arms an immediate alert on the next drop', async () => {
  const db = store([
    { provider: 'zinc', below_threshold: true, alert_sent: true, checked_at: ago(2 * HOUR) },
    { provider: 'zinc', below_threshold: false, alert_sent: false, checked_at: ago(HOUR) },
  ]);
  const m = monitor({ db, wallet: { balance: 300, spendable_balance: 300 } });
  await m.run();
  assert.equal(m.sent.length, 1);
});

test('a failed balance read alerts and is logged with the error; a test key is flagged', async () => {
  const m = monitor({ walletStatus: 401 });
  await m.run();
  assert.equal(m.sent.length, 1);
  assert.match(m.sent[0].subject, /check failed/);
  const [row] = m.db.rows;
  assert.deepEqual([row.read_error, row.spendable_cents, row.below_threshold, row.alert_reason], ['http_401', null, null, 'read_failed']);

  const malformed = monitor({ wallet: { balance: '12.00' } });
  await malformed.run();
  assert.equal(malformed.db.rows[0].read_error, 'malformed_response');
});

test('alert delivery problems are recorded, not retried', async () => {
  const noRecipient = monitor({ wallet: { balance: 1, spendable_balance: 1 }, env: { ZINC_ALERT_EMAIL: undefined } });
  await noRecipient.run();
  assert.deepEqual([noRecipient.sent.length, noRecipient.db.rows[0].alert_sent, noRecipient.db.rows[0].alert_error],
    [0, false, 'recipient_not_configured']);
  const resendDown = monitor({ wallet: { balance: 1, spendable_balance: 1 }, resendStatus: 500 });
  await resendDown.run();
  assert.equal(resendDown.sent.length, 1);
  assert.deepEqual([resendDown.db.rows[0].alert_sent, resendDown.db.rows[0].alert_error], [false, 'resend_http_500']);
});

test('the threshold is tunable; an unreadable history errs toward alerting; a failed log write is a 500', async () => {
  const tuned = monitor({ wallet: { balance: 4000, spendable_balance: 4000 }, env: { ZINC_ALERT_THRESHOLD_CENTS: '5000' } });
  await tuned.run();
  assert.deepEqual([tuned.sent.length, tuned.db.rows[0].threshold_cents], [1, 5000]);

  const db = store(); db.failReads = true;
  const blind = monitor({ db, wallet: { balance: 1, spendable_balance: 1 } });
  await blind.run();
  assert.equal(blind.sent.length, 1);

  const unlogged = store(); unlogged.failInsert = true;
  assert.equal((await monitor({ db: unlogged }).run()).status, 500);
});

// --- ops-status --------------------------------------------------------------

function ops({ user, db = store() }) {
  let serve;
  load('supabase/functions/ops-status/index.ts', {
    Response, Request, URL,
    authenticateRequest: async () => user,
    serviceClient: () => db.client,
    Deno: { env: { get: () => undefined }, serve: fn => { serve = fn; } },
  });
  return () => serve(new Request('https://isolated.invalid/ops-status', { method: 'GET' }));
}

test('ops-status is admin-only via server-written app_metadata', async () => {
  assert.equal((await ops({ user: null })()).status, 401);
  assert.equal((await ops({ user: { id: 'u', app_metadata: {}, user_metadata: { fetchit_admin: true } } })()).status, 403);
});

test('ops-status reports the latest balance and days since the last alert', async () => {
  const db = store([
    { provider: 'zinc', spendable_cents: 700, balance_cents: 700, threshold_cents: 1000, below_threshold: true,
      alert_sent: true, alert_reason: 'low_balance', key_mode: 'live', checked_at: ago(3 * 24 * HOUR) },
    { provider: 'zinc', spendable_cents: 5000, balance_cents: 5000, threshold_cents: 1000, below_threshold: false,
      alert_sent: false, key_mode: 'live', read_error: null, checked_at: ago(5 * 60_000) },
  ]);
  const response = await ops({ user: { id: 'a', app_metadata: { fetchit_admin: true } }, db })();
  assert.equal(response.status, 200);
  const { zinc } = await response.json();
  assert.deepEqual([zinc.spendableCents, zinc.belowThreshold, zinc.monitorStale, zinc.daysSinceLastAlert,
    zinc.lastAlertReason, zinc.alertsLast30Days, zinc.checksLast24Hours], [5000, false, false, 3, 'low_balance', 1, 1]);

  const empty = await (await ops({ user: { id: 'a', app_metadata: { fetchit_admin: true } } })()).json();
  assert.deepEqual([empty.zinc.monitorStale, empty.zinc.daysSinceLastAlert, empty.zinc.lastCheckedAt], [true, null, null]);
});
