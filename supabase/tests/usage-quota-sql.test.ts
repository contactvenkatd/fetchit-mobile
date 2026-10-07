import assert from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

const user = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';

async function setup() {
  const db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;`);
  await db.exec(await Deno.readTextFile(new URL('../migrations/20261007000000_usage_quotas.sql', import.meta.url)));
  await db.query('insert into auth.users values ($1), ($2)', [user, other]);
  return db;
}

const consume = (db: PGlite, limit: number, bucket = 'ai', id = user) =>
  db.query<{ allowed: boolean; used: number; unit_limit: number; period: string; resets_at: Date }>(
    'select * from quota_consume($1, $2, $3)', [id, bucket, limit]).then(r => r.rows[0]);

Deno.test('quota_consume is a hard stop: denied calls never increment', async () => {
  const db = await setup();
  try {
    for (let i = 1; i <= 3; i++) assert.deepEqual([(await consume(db, 3)).allowed, (await db.query<{ u: number }>(
      'select units_used as u from usage_quotas').then(r => r.rows[0].u))], [true, i]);
    for (let i = 0; i < 5; i++) {
      const denied = await consume(db, 3);
      assert.equal(denied.allowed, false);
      assert.equal(denied.used, 3);
    }
    const now = new Date();
    const period = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
    const row = await consume(db, 3);
    assert.equal(row.period, period);
    assert.equal(new Date(row.resets_at).toISOString(),
      new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)).toISOString());
  } finally { await db.close(); }
});

Deno.test('concurrent consumes cannot overspend the limit', async () => {
  const db = await setup();
  try {
    const results = await Promise.all(Array.from({ length: 25 }, () => consume(db, 7, 'zinc')));
    assert.equal(results.filter(r => r.allowed).length, 7);
    const { rows } = await db.query<{ u: number }>("select units_used as u from usage_quotas where bucket='zinc'");
    assert.equal(rows[0].u, 7);
  } finally { await db.close(); }
});

Deno.test('buckets are independent and a plan change keeps the counter', async () => {
  const db = await setup();
  try {
    for (let i = 0; i < 2; i++) await consume(db, 2); // Free-sized limit, now exhausted
    assert.equal((await consume(db, 2)).allowed, false);
    assert.equal((await consume(db, 5, 'zinc')).used, 1); // separate cost center
    const upgraded = await consume(db, 4); // e.g. Plus = 2x
    assert.deepEqual([upgraded.allowed, upgraded.used], [true, 3]);
    const downgraded = await consume(db, 2); // back to Free mid-month: no reset
    assert.deepEqual([downgraded.allowed, downgraded.used], [false, 3]);
  } finally { await db.close(); }
});

Deno.test('quota_status is read-only and reports zero before first use', async () => {
  const db = await setup();
  try {
    const status = (id = user) => db.query<{ used: number }>('select * from quota_status($1, $2)', [id, 'ai'])
      .then(r => r.rows[0].used);
    assert.equal(await status(), 0);
    await consume(db, 10);
    assert.equal(await status(), 1);
    assert.equal(await status(), 1);
    assert.equal((await db.query('select * from usage_quotas')).rows.length, 1);
  } finally { await db.close(); }
});

Deno.test('rejects invalid input', async () => {
  const db = await setup();
  try {
    await assert.rejects(() => consume(db, 5, 'other'));
    await assert.rejects(() => consume(db, -1));
    await assert.rejects(() => db.query('select * from quota_consume($1, $2, $3, $4)', [user, 'ai', 5, 0]));
  } finally { await db.close(); }
});

Deno.test('clients can read only their own rows and cannot write or call the RPCs', async () => {
  const db = await setup();
  try {
    await consume(db, 5);
    await consume(db, 5, 'ai', other);
    await db.query('insert into plan_entitlements values ($1, $2, $3)', [user, 'Max', 'stripe']);
    await db.exec(`set role authenticated; select set_config('request.jwt.claim.sub', '${user}', false);`);
    const rows = (await db.query<{ user_id: string }>('select user_id from usage_quotas')).rows;
    assert.deepEqual(rows.map(r => r.user_id), [user]);
    await assert.rejects(() => db.query('update usage_quotas set units_used = 0'));
    await assert.rejects(() => db.query("insert into usage_quotas(user_id, bucket, period_key) values ($1, 'ai', '2000-01')", [user]));
    await assert.rejects(() => db.query('delete from usage_quotas'));
    await assert.rejects(() => db.query('select * from plan_entitlements'));
    await assert.rejects(() => db.query("insert into plan_entitlements values ($1, 'Max', 'forged')", [user]));
    await assert.rejects(() => consume(db, 1000));
    await assert.rejects(() => db.query("select * from quota_status($1, 'ai')", [user]));
    await db.exec('reset role; set role service_role;');
    assert.equal((await consume(db, 5)).used, 2);
  } finally { await db.close(); }
});
