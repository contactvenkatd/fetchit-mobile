-- Additive: per-user usage quotas for the paid upstreams (xAI/Grok = 'ai',
-- Zinc search/details/offers = 'zinc'). Paste into the SQL editor or run via
-- `supabase db push`. Touches no existing table, policy, or function.
--
-- * usage_quotas — one row per (user, bucket, UTC calendar month). Users can
--   read their own rows; only the service role (edge functions) writes them.
-- * plan_entitlements — server-only cache of the plan VERIFIED against Stripe
--   (and family_members). user_metadata.plan is client-writable, so it is never
--   used to size a quota.
-- * quota_consume / quota_status — service-role-only RPCs. quota_consume takes
--   a per-key advisory lock, so concurrent requests and retries can never push
--   units_used past the limit. Counters are keyed by period, not plan, so a
--   mid-month upgrade/downgrade changes the limit but never resets usage.
begin;

create table if not exists public.usage_quotas (
  user_id      uuid        not null references auth.users (id) on delete cascade,
  bucket       text        not null check (bucket in ('ai', 'zinc')),
  period_key   text        not null check (period_key ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  units_used   integer     not null default 0 check (units_used >= 0),
  last_used_at timestamptz not null default now(),
  primary key (user_id, bucket, period_key)
);

alter table public.usage_quotas enable row level security;
revoke all on public.usage_quotas from anon, authenticated;
grant select on public.usage_quotas to authenticated;

drop policy if exists "Users can read their own usage quotas" on public.usage_quotas;
create policy "Users can read their own usage quotas"
  on public.usage_quotas
  for select
  to authenticated
  using ((select auth.uid()) = user_id);

create table if not exists public.plan_entitlements (
  user_id     uuid        primary key references auth.users (id) on delete cascade,
  plan        text        not null check (plan in ('Free', 'Plus', 'Pro', 'Max')),
  source      text        not null,
  verified_at timestamptz not null default now()
);

alter table public.plan_entitlements enable row level security;
revoke all on public.plan_entitlements from anon, authenticated;

-- Atomically spends p_units from the caller's current-period allowance. A call
-- that would exceed p_limit is rejected WITHOUT incrementing (hard stop: the
-- limit never raises itself and a denied retry costs nothing).
create or replace function public.quota_consume(
  p_user_id uuid,
  p_bucket  text,
  p_limit   integer,
  p_units   integer default 1
) returns table (allowed boolean, used integer, unit_limit integer, period text, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_reset  timestamptz := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
  v_used   integer;
begin
  if p_user_id is null then raise exception 'A user is required'; end if;
  if p_bucket is null or p_bucket not in ('ai', 'zinc') then raise exception 'Invalid quota bucket'; end if;
  if p_limit is null or p_limit < 0 then raise exception 'Invalid quota limit'; end if;
  if p_units is null or p_units < 1 then raise exception 'Invalid quota units'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('usage_quota:' || p_user_id::text || ':' || p_bucket || ':' || v_period, 0));

  insert into public.usage_quotas (user_id, bucket, period_key, units_used, last_used_at)
  values (p_user_id, p_bucket, v_period, 0, now())
  on conflict on constraint usage_quotas_pkey do nothing;

  select q.units_used into v_used
  from public.usage_quotas q
  where q.user_id = p_user_id and q.bucket = p_bucket and q.period_key = v_period
  for update;

  if v_used + p_units > p_limit then
    return query select false, v_used, p_limit, v_period, v_reset;
    return;
  end if;

  update public.usage_quotas q
  set units_used = v_used + p_units, last_used_at = now()
  where q.user_id = p_user_id and q.bucket = p_bucket and q.period_key = v_period;

  return query select true, v_used + p_units, p_limit, v_period, v_reset;
end;
$$;

-- Read-only: current-period usage without incrementing (0 when no row yet).
create or replace function public.quota_status(
  p_user_id uuid,
  p_bucket  text
) returns table (used integer, period text, resets_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  select
    coalesce((select q.units_used from public.usage_quotas q
              where q.user_id = p_user_id and q.bucket = p_bucket
                and q.period_key = to_char(now() at time zone 'utc', 'YYYY-MM')), 0),
    to_char(now() at time zone 'utc', 'YYYY-MM'),
    (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
$$;

revoke all on function public.quota_consume(uuid, text, integer, integer) from public, anon, authenticated;
revoke all on function public.quota_status(uuid, text) from public, anon, authenticated;
grant execute on function public.quota_consume(uuid, text, integer, integer) to service_role;
grant execute on function public.quota_status(uuid, text) to service_role;

commit;
