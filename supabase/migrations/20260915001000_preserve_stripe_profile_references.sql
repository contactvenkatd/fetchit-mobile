begin;
create table if not exists public.stripe_profile_reference_history (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  stripe_customer_id text,
  stripe_payment_method_id text,
  archived_at timestamptz not null default now()
);
alter table public.stripe_profile_reference_history enable row level security;
revoke all on public.stripe_profile_reference_history from anon, authenticated;
create or replace function public.archive_stripe_profile_references()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (old.stripe_customer_id is distinct from new.stripe_customer_id or
      old.stripe_payment_method_id is distinct from new.stripe_payment_method_id)
     and (old.stripe_customer_id is not null or old.stripe_payment_method_id is not null) then
    insert into public.stripe_profile_reference_history(user_id, stripe_customer_id, stripe_payment_method_id)
    values(old.user_id, old.stripe_customer_id, old.stripe_payment_method_id);
  end if;
  return new;
end;
$$;
revoke all on function public.archive_stripe_profile_references() from public, anon, authenticated;
drop trigger if exists archive_stripe_profile_references on public.profiles;
create trigger archive_stripe_profile_references before update of stripe_customer_id, stripe_payment_method_id
on public.profiles for each row execute function public.archive_stripe_profile_references();
commit;
