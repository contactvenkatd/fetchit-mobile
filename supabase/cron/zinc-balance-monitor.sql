-- Schedules the zinc-balance-monitor edge function every 15 minutes.
-- Paste into the Supabase SQL editor AFTER:
--   1. running migrations/20261009000000_balance_topup_events.sql,
--   2. deploying the zinc-balance-monitor function (Verify JWT OFF), and
--   3. setting its BALANCE_MONITOR_SECRET edge-function secret.
--
-- Kept out of migrations/ because it needs pg_cron + pg_net (Database →
-- Extensions) and two Vault secrets, which local/test databases don't have.

create extension if not exists pg_cron;
create extension if not exists pg_net;

-- Store the function URL and the shared secret in Vault (run once; replace
-- the placeholders — the secret must equal BALANCE_MONITOR_SECRET exactly):
--   select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/zinc-balance-monitor', 'zinc_monitor_url');
--   select vault.create_secret('<long random string>', 'zinc_monitor_secret');

-- cron.schedule with an existing job name replaces that job, so re-running
-- this is safe.
select cron.schedule(
  'zinc-balance-monitor',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := (select decrypted_secret from vault.decrypted_secrets where name = 'zinc_monitor_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-monitor-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'zinc_monitor_secret')
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);

-- Verify:  select jobid, schedule, active from cron.job where jobname = 'zinc-balance-monitor';
-- Runs:    select * from cron.job_run_details order by start_time desc limit 10;
-- Replies: select status_code, content from net._http_response order by created desc limit 10;
-- Remove:  select cron.unschedule('zinc-balance-monitor');
