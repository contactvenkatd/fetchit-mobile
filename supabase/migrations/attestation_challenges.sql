-- Attestation challenges — short-lived, single-use nonces handed to the device
-- by the attestation-challenge edge function and checked back by the
-- verify-app-attest / verify-play-integrity functions. Run once in the Supabase
-- SQL editor (paste this whole file).
--
-- Like attested_devices, all writes are done by the edge functions with the
-- service role (bypassing RLS); RLS here just ensures a client querying with its
-- own JWT can only see its own challenges. `user_id` is nullable because a
-- challenge can be minted during signup before a session exists.

create table if not exists public.attestation_challenges (
  id         uuid        primary key default gen_random_uuid(),
  user_id    uuid        references auth.users(id) on delete cascade,
  challenge  text        not null,             -- base64, 32 random bytes
  platform   text        check (platform in ('ios', 'android')),
  action     text,                             -- 'signup' | 'login' | 'checkout'
  consumed   boolean     not null default false,
  expires_at timestamptz not null default (now() + interval '5 minutes'),
  created_at timestamptz not null default now()
);

create index if not exists attestation_challenges_expires_idx
  on public.attestation_challenges(expires_at);

alter table public.attestation_challenges enable row level security;

-- Owner-only read; edge functions use the service role for all writes.
drop policy if exists "attestation_challenges_select_own" on public.attestation_challenges;
create policy "attestation_challenges_select_own" on public.attestation_challenges
  for select using (auth.uid() = user_id);

-- Optional housekeeping: drop expired challenges. Safe to call anytime; wire to
-- pg_cron if you want automatic cleanup (else expired rows are simply ignored
-- by the verify functions).
create or replace function public.purge_expired_attestation_challenges()
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.attestation_challenges where expires_at < now();
$$;

revoke all on function public.purge_expired_attestation_challenges() from public, anon, authenticated;
grant execute on function public.purge_expired_attestation_challenges() to service_role;
