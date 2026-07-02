-- email_exists(email) — does an account already exist for this address?
-- Run once in the Supabase SQL editor (paste this whole file).
--
-- Used by the `auth-gateway` edge function so native LOGIN never silently
-- creates an account (mirrors the web flow's signInWithOtp shouldCreateUser:
-- false) and native SIGNUP can report "already registered". SECURITY DEFINER so
-- it can read auth.users; execute is granted only to the service role (the edge
-- function), matching the rate_limits.sql pattern.

create or replace function public.email_exists(p_email text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  select exists (
    select 1 from auth.users where lower(email) = lower(p_email)
  );
$$;

revoke all on function public.email_exists(text) from public, anon, authenticated;
grant execute on function public.email_exists(text) to service_role;
