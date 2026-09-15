import assert from 'node:assert/strict';
import { PGlite } from 'npm:@electric-sql/pglite@0.3.14';

Deno.test('webhook snapshots are atomic, replay-safe, ordered, and preserve references', async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users(id uuid primary key, raw_user_meta_data jsonb, updated_at timestamptz);
      create table public.profiles(user_id uuid primary key, stripe_customer_id text, stripe_payment_method_id text);`);
    for (const file of ['20260915000000_stripe_webhook_state.sql', '20260915001000_preserve_stripe_profile_references.sql']) {
      await db.exec(await Deno.readTextFile(new URL('../migrations/' + file, import.meta.url)));
    }
    const user = '11111111-1111-4111-8111-111111111111';
    await db.query('insert into auth.users values ($1, $2, now())', [user, { stripe_customer_id: 'cus_fixture', plan: 'Free', unrelated: 'keep' }]);
    await db.query('insert into profiles values ($1,$2,$3)', [user, 'cus_old', 'pm_old']);
    await db.query('update profiles set stripe_customer_id=$1, stripe_payment_method_id=$2 where user_id=$3', ['cus_fixture', 'pm_new', user]);
    const archived = await db.query('select stripe_customer_id, stripe_payment_method_id from stripe_profile_reference_history');
    assert.deepEqual(archived.rows, [{ stripe_customer_id: 'cus_old', stripe_payment_method_id: 'pm_old' }]);
    const apply = (id: string, time: string, plan: string, customer = 'cus_fixture') => db.query(
      'select apply_stripe_subscription_snapshot($1,false,$2,$3,$4,$5)',
      [id, user, customer, time, { plan, plan_billing: 'monthly', plan_cancels_at: null, stripe_subscription_status: 'active' }],
    );
    await apply('evt_new', '2026-09-15T00:02:00Z', 'Max');
    await apply('evt_new', '2026-09-15T00:03:00Z', 'Free'); // replay
    await apply('evt_old', '2026-09-15T00:01:00Z', 'Pro'); // stale snapshot
    let rows = (await db.query('select raw_user_meta_data as meta from auth.users')).rows as any[];
    assert.equal(rows[0].meta.plan, 'Max');
    assert.equal(rows[0].meta.unrelated, 'keep');
    await assert.rejects(() => apply('evt_wrong', '2026-09-15T00:04:00Z', 'Free', 'cus_other'));
    assert.equal((await db.query("select * from stripe_webhook_receipts where event_id='evt_wrong'")).rows.length, 0);
    await db.exec('set role authenticated');
    await assert.rejects(() => apply('evt_attacker', '2026-09-15T00:05:00Z', 'Max'));
    await db.exec('reset role');
    await apply('evt_final', '2026-09-15T00:06:00Z', 'Free');
    rows = (await db.query('select raw_user_meta_data as meta from auth.users')).rows as any[];
    assert.equal(rows[0].meta.plan, 'Free');
  } finally { await db.close(); }
});
