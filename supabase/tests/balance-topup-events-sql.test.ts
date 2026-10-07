import assert from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

async function setup() {
  const db = new PGlite();
  // As in Supabase, service_role bypasses RLS (but not triggers).
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls;');
  await db.exec(await Deno.readTextFile(new URL('../migrations/20261009000000_balance_topup_events.sql', import.meta.url)));
  return db;
}

const insert = (db: PGlite, row: Record<string, unknown>) => {
  const keys = Object.keys(row);
  return db.query(`insert into balance_topup_events (${keys.join(', ')}) values (${keys.map((_, i) => `$${i + 1}`).join(', ')})`,
    Object.values(row));
};
const ok = { provider: 'zinc', key_mode: 'live', balance_cents: 900, spendable_cents: 800, threshold_cents: 1000,
  below_threshold: true, alert_sent: true, alert_reason: 'low_balance' };

Deno.test('the service role can insert and read checks but never change or remove them', async () => {
  const db = await setup();
  try {
    await db.exec('set role service_role');
    await insert(db, ok);
    await insert(db, { provider: 'zinc', threshold_cents: 1000, read_error: 'http_500', alert_sent: true, alert_reason: 'read_failed' });
    assert.equal((await db.query('select * from balance_topup_events')).rows.length, 2);
    await assert.rejects(() => db.query('update balance_topup_events set alert_sent = false'));
    await assert.rejects(() => db.query('delete from balance_topup_events'));
    await assert.rejects(() => db.query('truncate balance_topup_events'));
    await db.exec('reset role'); // even the table owner is blocked by the triggers
    await assert.rejects(() => db.query('update balance_topup_events set alert_sent = false'));
    await assert.rejects(() => db.query('delete from balance_topup_events'));
    await assert.rejects(() => db.query('truncate balance_topup_events'));
    assert.equal((await db.query('select * from balance_topup_events where alert_sent')).rows.length, 2);
  } finally { await db.close(); }
});

Deno.test('clients have no access', async () => {
  const db = await setup();
  try {
    await insert(db, ok);
    for (const role of ['anon', 'authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(() => db.query('select * from balance_topup_events'));
      await assert.rejects(() => insert(db, ok));
      await db.exec('reset role');
    }
  } finally { await db.close(); }
});

Deno.test('rows must carry either a balance read or a read error', async () => {
  const db = await setup();
  try {
    await assert.rejects(() => insert(db, { provider: 'zinc', threshold_cents: 1000 }));
    await assert.rejects(() => insert(db, { ...ok, provider: 'stripe' }));
    await assert.rejects(() => insert(db, { ...ok, alert_reason: 'other' }));
  } finally { await db.close(); }
});
