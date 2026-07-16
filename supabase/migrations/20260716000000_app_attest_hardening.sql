-- Atomic, fail-closed primitives. Only service_role may call these functions.
alter table public.attestation_challenges
  add column if not exists email_normalized text;

drop policy if exists "attested_devices_modify_own" on public.attested_devices;
revoke insert, update, delete, truncate on public.attested_devices from anon, authenticated;
revoke insert, update, delete, truncate on public.attestation_challenges from anon, authenticated;

create or replace function public.consume_attestation_challenge(
  p_id uuid, p_platform text, p_action text, p_email_normalized text
)
returns table(id uuid, challenge text, user_id uuid, platform text, action text, email_normalized text)
language sql
security definer
set search_path = ''
as $$
  update public.attestation_challenges c
     set consumed = true
   where c.id = p_id
     and c.consumed = false
     and c.expires_at > now()
     and c.platform = p_platform
     and c.action = p_action
     and c.email_normalized is not distinct from p_email_normalized
  returning c.id, c.challenge, c.user_id, c.platform, c.action, c.email_normalized;
$$;

create or replace function public.advance_attestation_counter(
  p_device_id uuid, p_previous bigint, p_next bigint
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attested_devices
     set sign_count = p_next, updated_at = now()
   where id = p_device_id and sign_count = p_previous and p_next > p_previous;
  return found;
end;
$$;

create table if not exists public.rate_limits (
  bucket text primary key,
  count integer not null,
  window_started_at timestamptz not null
);
alter table public.rate_limits enable row level security;
revoke all on public.rate_limits from public, anon, authenticated;

create or replace function public.rl_check(p_bucket text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare v_count integer;
begin
  if p_bucket is null or length(p_bucket) > 512 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'invalid rate limit arguments';
  end if;
  insert into public.rate_limits(bucket, count, window_started_at)
  values (p_bucket, 1, now())
  on conflict (bucket) do update set
    count = case when public.rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
                 then 1 else public.rate_limits.count + 1 end,
    window_started_at = case when public.rate_limits.window_started_at <= now() - make_interval(secs => p_window_seconds)
                             then now() else public.rate_limits.window_started_at end
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

revoke all on function public.consume_attestation_challenge(uuid,text,text,text) from public, anon, authenticated;
revoke all on function public.advance_attestation_counter(uuid,bigint,bigint) from public, anon, authenticated;
revoke all on function public.rl_check(text,integer,integer) from public, anon, authenticated;
grant execute on function public.consume_attestation_challenge(uuid,text,text,text) to service_role;
grant execute on function public.advance_attestation_counter(uuid,bigint,bigint) to service_role;
grant execute on function public.rl_check(text,integer,integer) to service_role;
