-- Additive: preserves existing users, payment references, and App Attest data.
begin;
create table if not exists public.stripe_webhook_receipts (
  event_id text primary key,
  livemode boolean not null,
  processed_at timestamptz not null default now()
);
create table if not exists public.stripe_customer_snapshots (
  customer_id text primary key,
  user_id uuid not null references auth.users(id),
  livemode boolean not null,
  snapshot_started timestamptz not null
);
alter table public.stripe_webhook_receipts enable row level security;
alter table public.stripe_customer_snapshots enable row level security;
revoke all on public.stripe_webhook_receipts, public.stripe_customer_snapshots from anon, authenticated;

create or replace function public.apply_stripe_subscription_snapshot(
  p_event_id text, p_livemode boolean, p_user_id uuid, p_customer_id text,
  p_snapshot_started timestamptz, p_state jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  current_metadata jsonb;
  previous_snapshot timestamptz;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_customer_id, 0));
  if exists (select 1 from public.stripe_webhook_receipts where event_id = p_event_id) then return; end if;
  select raw_user_meta_data into current_metadata from auth.users where id = p_user_id for update;
  if current_metadata->>'stripe_customer_id' is distinct from p_customer_id then
    raise exception 'Customer mapping changed';
  end if;
  select snapshot_started into previous_snapshot from public.stripe_customer_snapshots where customer_id = p_customer_id;
  if previous_snapshot is null or p_snapshot_started > previous_snapshot then
    if p_state is not null then
      if p_state->>'plan' not in ('Free', 'Plus', 'Pro', 'Max') then raise exception 'Invalid plan'; end if;
      -- Preserve family memberships and every unrelated metadata field.
      -- Existing family access is managed by the family backend, not Stripe.
      if coalesce(current_metadata->>'plan', '') <> 'max_family' then
        update auth.users set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) ||
          jsonb_build_object('plan', p_state->>'plan', 'plan_billing', p_state->>'plan_billing',
            'plan_cancels_at', p_state->'plan_cancels_at',
            'stripe_subscription_status', p_state->>'stripe_subscription_status'),
          updated_at = now()
        where id = p_user_id;
      end if;
    end if;
    insert into public.stripe_customer_snapshots values (p_customer_id, p_user_id, p_livemode, p_snapshot_started)
    on conflict (customer_id) do update set snapshot_started = excluded.snapshot_started;
  end if;
  insert into public.stripe_webhook_receipts(event_id, livemode) values (p_event_id, p_livemode);
end;
$$;
revoke all on function public.apply_stripe_subscription_snapshot(text, boolean, uuid, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.apply_stripe_subscription_snapshot(text, boolean, uuid, text, timestamptz, jsonb) to service_role;
commit;
