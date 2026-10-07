-- Switches usage_quotas from unit counting to dollar metering. Run AFTER
-- 20261007000000_usage_quotas.sql. Every paid call now debits its ACTUAL cost.
--
-- cents_used is numeric(14,6), not integer: a typical Grok call costs ~0.275¢,
-- which integer cents would round to 0 or 1. numeric is exact decimal (no
-- float rounding); 6 places of a cent is exact for every xAI per-token rate.
--
-- quota_consume(p_user_id, p_bucket, p_limit_cents, p_cost_cents, p_enforce):
--   p_enforce = true  (pre-flight, before a paid call): allowed only if budget
--     remains AND prior + cost <= limit; a rejected call adds nothing.
--   p_enforce = false (post-call debit of money already spent): always adds
--     the actual cost — spend is never dropped — and reports whether the total
--     is still within the limit.
begin;

alter table public.usage_quotas
  add column if not exists cents_used numeric(14, 6) not null default 0 check (cents_used >= 0);

-- One-time conversion of any unit counts recorded by the previous migration,
-- priced at the measured typical per-unit cost (AI 0.275¢, search 11¢).
do $$
begin
  if exists (select 1 from information_schema.columns
             where table_schema = 'public' and table_name = 'usage_quotas' and column_name = 'units_used') then
    update public.usage_quotas
    set cents_used = units_used * case bucket when 'ai' then 0.275 else 11 end
    where units_used > 0;
    alter table public.usage_quotas drop column units_used;
  end if;
end;
$$;

drop function if exists public.quota_consume(uuid, text, integer, integer);
drop function if exists public.quota_status(uuid, text);

create or replace function public.quota_consume(
  p_user_id     uuid,
  p_bucket      text,
  p_limit_cents numeric,
  p_cost_cents  numeric,
  p_enforce     boolean default true
) returns table (allowed boolean, cents_used numeric, limit_cents numeric, remaining_cents numeric,
                 period text, resets_at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_period text := to_char(now() at time zone 'utc', 'YYYY-MM');
  v_reset  timestamptz := (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc';
  v_prior  numeric;
  v_total  numeric;
  v_fits   boolean;
begin
  if p_user_id is null then raise exception 'A user is required'; end if;
  if p_bucket is null or p_bucket not in ('ai', 'zinc') then raise exception 'Invalid quota bucket'; end if;
  if p_limit_cents is null or p_limit_cents < 0 then raise exception 'Invalid quota limit'; end if;
  if p_cost_cents is null or p_cost_cents < 0 then raise exception 'Invalid quota cost'; end if;

  perform pg_advisory_xact_lock(
    hashtextextended('usage_quota:' || p_user_id::text || ':' || p_bucket || ':' || v_period, 0));

  insert into public.usage_quotas (user_id, bucket, period_key, last_used_at)
  values (p_user_id, p_bucket, v_period, now())
  on conflict on constraint usage_quotas_pkey do nothing;

  select q.cents_used into v_prior
  from public.usage_quotas q
  where q.user_id = p_user_id and q.bucket = p_bucket and q.period_key = v_period
  for update;

  -- Checked BEFORE adding: a call that would push the total over is rejected.
  v_fits := v_prior < p_limit_cents and v_prior + p_cost_cents <= p_limit_cents;

  if p_enforce and not v_fits then
    return query select false, v_prior, p_limit_cents, greatest(p_limit_cents - v_prior, 0), v_period, v_reset;
    return;
  end if;

  v_total := v_prior + p_cost_cents;
  if p_cost_cents > 0 then
    update public.usage_quotas q
    set cents_used = v_total, last_used_at = now()
    where q.user_id = p_user_id and q.bucket = p_bucket and q.period_key = v_period;
  end if;

  return query select v_fits, v_total, p_limit_cents, greatest(p_limit_cents - v_total, 0), v_period, v_reset;
end;
$$;

-- Read-only: current-period spend against the caller-supplied limit.
create or replace function public.quota_status(
  p_user_id     uuid,
  p_bucket      text,
  p_limit_cents numeric
) returns table (cents_used numeric, limit_cents numeric, remaining_cents numeric, period text, resets_at timestamptz)
language sql
stable
security definer
set search_path = ''
as $$
  with used as (
    select coalesce((select q.cents_used from public.usage_quotas q
                     where q.user_id = p_user_id and q.bucket = p_bucket
                       and q.period_key = to_char(now() at time zone 'utc', 'YYYY-MM')), 0) as cents
  )
  select used.cents, p_limit_cents, greatest(p_limit_cents - used.cents, 0),
    to_char(now() at time zone 'utc', 'YYYY-MM'),
    (date_trunc('month', now() at time zone 'utc') + interval '1 month') at time zone 'utc'
  from used;
$$;

revoke all on function public.quota_consume(uuid, text, numeric, numeric, boolean) from public, anon, authenticated;
revoke all on function public.quota_status(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.quota_consume(uuid, text, numeric, numeric, boolean) to service_role;
grant execute on function public.quota_status(uuid, text, numeric) to service_role;

commit;
