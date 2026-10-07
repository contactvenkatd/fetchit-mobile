-- Additive: append-only audit log of provider balance checks, written by the
-- zinc-balance-monitor edge function (pg_cron, every 15 minutes — schedule in
-- supabase/cron/zinc-balance-monitor.sql). One row per check: the balance
-- read (or the read error), whether it was under the threshold, and whether
-- an alert email fired. No top-ups: Zinc has no top-up API, and xAI's
-- auto top-up is configured in the xAI console, not driven from here.
--
-- Service-role only. Rows can be inserted and read, never changed: UPDATE,
-- DELETE and TRUNCATE are revoked and also blocked by triggers (the service
-- role bypasses RLS, not triggers).
begin;

create table if not exists public.balance_topup_events (
  id              bigint generated always as identity primary key,
  provider        text        not null check (provider in ('zinc', 'xai')),
  checked_at      timestamptz not null default now(),
  key_mode        text        check (key_mode in ('live', 'test')),
  balance_cents   bigint,
  spendable_cents bigint,
  threshold_cents bigint      not null check (threshold_cents >= 0),
  below_threshold boolean,
  read_error      text,
  alert_sent      boolean     not null default false,
  alert_reason    text        check (alert_reason in ('low_balance', 'read_failed')),
  alert_error     text,
  check (read_error is not null or (spendable_cents is not null and below_threshold is not null))
);

create index if not exists balance_topup_events_provider_checked_idx
  on public.balance_topup_events (provider, checked_at desc);
create index if not exists balance_topup_events_alerts_idx
  on public.balance_topup_events (provider, checked_at desc) where alert_sent;

alter table public.balance_topup_events enable row level security;
revoke all on public.balance_topup_events from public, anon, authenticated;
revoke update, delete, truncate on public.balance_topup_events from service_role;
grant select, insert on public.balance_topup_events to service_role;

create or replace function public.balance_topup_events_append_only()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'balance_topup_events is append-only';
end;
$$;

drop trigger if exists balance_topup_events_no_update_delete on public.balance_topup_events;
create trigger balance_topup_events_no_update_delete
  before update or delete on public.balance_topup_events
  for each row execute function public.balance_topup_events_append_only();

drop trigger if exists balance_topup_events_no_truncate on public.balance_topup_events;
create trigger balance_topup_events_no_truncate
  before truncate on public.balance_topup_events
  for each statement execute function public.balance_topup_events_append_only();

commit;
