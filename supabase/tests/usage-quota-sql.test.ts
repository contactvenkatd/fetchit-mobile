import assert from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const MIGRATIONS = ['20261007000000_usage_quotas.sql', '20261008000000_usage_quotas_cents.sql'];

async function setup(beforeCents?: (db: PGlite) => Promise<void>) {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;
    insert into auth.users values ('${user}'), ('${other}');`);
  await db.exec(await Deno.readTextFile(new URL('../migrations/' + MIGRATIONS[0], import.meta.url)));
  await beforeCents?.(db);
  await db.exec(await Deno.readTextFile(new URL('../migrations/' + MIGRATIONS[1], import.meta.url)));
  return db;
}

type Row = { allowed: boolean; cents_used: string; limit_cents: string; remaining_cents: string; period: string; resets_at: Date };
const consume = (db: PGlite, limit: string, cost: string, enforce = true, bucket = 'ai', id = user) =>
  db.query<Row>('select * from quota_consume($1, $2, $3, $4, $5)', [id, bucket, limit, cost, enforce])
    .then(r => r.rows[0]);
const used = (db: PGlite, bucket = 'ai') =>
  db.query<{ c: string }>('select cents_used::text as c from usage_quotas where bucket = $1', [bucket])
    .then(r => r.rows[0]?.c);

Deno.test('fractional-cent costs accumulate exactly (no float rounding)', async () => {
  const db = await setup();
  try {
    for (let i = 0; i < 1000; i++) await consume(db, '224.55', '0.275000', false);
    assert.equal(await used(db), '275.000000');
    const row = await consume(db, '224.55', '0.000125', false);
    assert.equal(row.cents_used, '275.000125');
  } finally { await db.close(); }
});

Deno.test('enforced consume checks BEFORE adding: a call that would exceed is rejected and adds nothing', async () => {
  const db = await setup();
  try {
    assert.equal((await consume(db, '100', '90')).allowed, true);
    const over = await consume(db, '100', '11'); // 90 + 11 > 100
    assert.deepEqual([over.allowed, over.cents_used, over.remaining_cents], [false, '90.000000', '10.000000']);
    assert.equal((await consume(db, '100', '10')).allowed, true); // exactly reaches the limit
    const spent = await consume(db, '100', '0'); // pre-flight with nothing left
    assert.deepEqual([spent.allowed, spent.remaining_cents], [false, '0.000000']);
    assert.equal(await used(db), '100.000000');
  } finally { await db.close(); }
});

Deno.test('post-call debits always record real spend and report overshoot', async () => {
  const db = await setup();
  try {
    await consume(db, '50', '45', false, 'zinc');
    assert.equal((await consume(db, '50', '0', true, 'zinc')).allowed, true); // pre-flight: 5¢ left
    const debit = await consume(db, '50', '16', false, 'zinc'); // a full 16-call search
    assert.deepEqual([debit.allowed, debit.cents_used, debit.remaining_cents], [false, '61.000000', '0']);
    assert.equal((await consume(db, '50', '0', true, 'zinc')).allowed, false); // next search refused
  } finally { await db.close(); }
});

Deno.test('concurrent enforced consumes cannot overspend', async () => {
  const db = await setup();
  try {
    const results = await Promise.all(Array.from({ length: 25 }, () => consume(db, '7', '1', true, 'zinc')));
    assert.equal(results.filter(r => r.allowed).length, 7);
    assert.equal(await used(db, 'zinc'), '7.000000');
  } finally { await db.close(); }
});

Deno.test('buckets are independent and a plan change keeps spend; the period resets on the 1st (UTC)', async () => {
  const db = await setup();
  try {
    await consume(db, '50', '50', false);
    assert.equal((await consume(db, '50', '0')).allowed, false);
    assert.equal((await consume(db, '50', '0', true, 'zinc')).allowed, true);
    assert.equal((await consume(db, '224.55', '0')).allowed, true); // upgraded mid-month
    assert.equal((await consume(db, '50', '0')).allowed, false); // downgraded: no reset
    const now = new Date();
    const row = await consume(db, '50', '0', true, 'zinc');
    assert.equal(row.period, `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`);
    assert.equal(new Date(row.resets_at).toISOString(),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString());
  } finally { await db.close(); }
});

Deno.test('quota_status is read-only and reports used / limit / remaining', async () => {
  const db = await setup();
  try {
    const status = () => db.query<{ cents_used: string; limit_cents: string; remaining_cents: string }>(
      'select * from quota_status($1, $2, $3)', [user, 'ai', '874.5625']).then(r => r.rows[0]);
    const before = await status();
    assert.deepEqual([before.cents_used, before.limit_cents, before.remaining_cents], ['0', '874.5625', '874.5625']);
    await consume(db, '874.5625', '1.019000', false);
    const after = await status();
    assert.deepEqual([after.cents_used, after.remaining_cents], ['1.019000', '873.543500']);
    assert.equal((await status()).cents_used, '1.019000');
  } finally { await db.close(); }
});

Deno.test('existing unit counts convert to cents at the measured typical cost', async () => {
  const db = await setup(async db => {
    await db.query("insert into usage_quotas(user_id, bucket, period_key, units_used) values ($1,'ai','2026-10',10), ($1,'zinc','2026-10',3)", [user]);
  });
  try {
    const rows = (await db.query<{ bucket: string; c: string }>('select bucket, cents_used::text as c from usage_quotas order by bucket')).rows;
    assert.deepEqual(rows.map(r => [r.bucket, r.c]), [['ai', '2.750000'], ['zinc', '33.000000']]);
    const cols = (await db.query("select 1 from information_schema.columns where table_name='usage_quotas' and column_name='units_used'")).rows;
    assert.equal(cols.length, 0);
  } finally { await db.close(); }
});

Deno.test('rejects invalid input', async () => {
  const db = await setup();
  try {
    await assert.rejects(() => consume(db, '50', '1', true, 'other'));
    await assert.rejects(() => consume(db, '-1', '1'));
    await assert.rejects(() => consume(db, '50', '-1'));
  } finally { await db.close(); }
});

Deno.test('clients can read only their own rows and cannot write or call the RPCs', async () => {
  const db = await setup();
  try {
    await consume(db, '50', '5', false);
    await consume(db, '50', '5', false, 'ai', other);
    await db.query('insert into plan_entitlements values ($1, $2, $3)', [user, 'Max', 'stripe']);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
    const rows = (await db.query<{ user_id: string }>('select user_id from usage_quotas')).rows;
    assert.deepEqual(rows.map(r => r.user_id), [user]);
    await assert.rejects(() => db.query('update usage_quotas set cents_used = 0'));
    await assert.rejects(() => db.query("insert into usage_quotas(user_id, bucket, period_key) values ($1, 'ai', '2000-01')", [user]));
    await assert.rejects(() => db.query('delete from usage_quotas'));
    await assert.rejects(() => db.query('select * from plan_entitlements'));
    await assert.rejects(() => consume(db, '100000', '0'));
    await assert.rejects(() => db.query("select * from quota_status($1, 'ai', 50)", [user]));
    await db.exec('reset role; set role service_role;');
    assert.equal((await consume(db, '50', '1', false)).cents_used, '6.000000');
  } finally { await db.close(); }
});
