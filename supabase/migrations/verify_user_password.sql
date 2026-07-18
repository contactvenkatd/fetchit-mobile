-- verify_user_password(email, password) — return the matching user's id only
-- when the supplied password matches the bcrypt hash managed by Supabase Auth.
-- Run once in the Supabase SQL editor (paste this whole file).
--
-- Used only by the attestation-gated `auth-gateway` change_password action.
-- SECURITY DEFINER is required to read auth.users; execute is explicitly
-- restricted to service_role so clients cannot use this as a password oracle.

create extension if not exists pgcrypto with schema extensions;

create or replace function public.verify_user_password(
  p_email text,
  p_password text
)
returns uuid
language sql
security definer
set search_path = ''
as $$
  select id
  from auth.users
  where lower(email) = lower(p_email)
    and encrypted_password is not null
    and encrypted_password <> ''
    and encrypted_password = extensions.crypt(p_password, encrypted_password)
  limit 1;
$$;

revoke all on function public.verify_user_password(text, text)
  from public, anon, authenticated;
grant execute on function public.verify_user_password(text, text)
  to service_role;
