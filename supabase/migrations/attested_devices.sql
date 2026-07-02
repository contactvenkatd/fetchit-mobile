-- Attested devices — one row per device that has passed App Attest (iOS) or
-- Play Integrity (Android) verification, owned by the user it attested for.
-- Run once in the Supabase SQL editor (paste this whole file).
--
-- Writes happen ONLY from the verify-app-attest / verify-play-integrity edge
-- functions using the service role (which bypasses RLS). RLS below is
-- defense-in-depth so that if a client ever queries this table directly with
-- its anon/authenticated JWT, it can only ever see or touch its OWN devices.
--
-- `user_id` is nullable: a device can be attested during signup before the
-- account's session exists (it's associated with the user on the next
-- authenticated attestation). Rows with a null user_id are visible only to the
-- service role.

create table if not exists public.attested_devices (
  id           uuid        primary key default gen_random_uuid(),
  user_id      uuid        references auth.users(id) on delete cascade,
  platform     text        not null check (platform in ('ios', 'android')),
  key_id       text,                          -- iOS App Attest key id (null on Android)
  public_key   text,                          -- base64 SPKI of the attested EC public key (iOS)
  receipt      text,                          -- base64 App Attest receipt, if captured (iOS)
  sign_count   bigint      not null default 0, -- authoritative counter (from assertion authData)
  last_verdict jsonb,                          -- last Play Integrity verdict / attest metadata
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (platform, key_id)
);

create index if not exists attested_devices_user_idx on public.attested_devices(user_id);

alter table public.attested_devices enable row level security;

-- Owner-only read. (Edge functions write with the service role, which is exempt
-- from RLS, so no insert/update policy is needed for them.)
drop policy if exists "attested_devices_select_own" on public.attested_devices;
create policy "attested_devices_select_own" on public.attested_devices
  for select using (auth.uid() = user_id);

-- Owner-only mutations for any direct client writes (belt-and-suspenders; the
-- app doesn't write here directly today).
drop policy if exists "attested_devices_modify_own" on public.attested_devices;
create policy "attested_devices_modify_own" on public.attested_devices
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
