-- Wishlist — saved products a user wants to buy later, added from chat.
-- Run once in the Supabase SQL editor (paste this whole file).
--
-- Client reads/writes directly (via the authenticated JWT), scoped to the
-- owning user through RLS below — unlike attested_devices, this table is
-- meant to be mutated straight from the app, not just service-role Edge
-- Functions.

create table if not exists public.wishlists (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users(id) on delete cascade,
  product_name  text,
  product_url   text,
  product_image text,
  retailer      text,
  price         numeric,
  notes         text,
  created_at    timestamptz not null default now()
);

create index if not exists wishlists_user_idx on public.wishlists(user_id);

alter table public.wishlists enable row level security;

drop policy if exists "wishlists_select_own" on public.wishlists;
create policy "wishlists_select_own" on public.wishlists
  for select using (auth.uid() = user_id);

drop policy if exists "wishlists_insert_own" on public.wishlists;
create policy "wishlists_insert_own" on public.wishlists
  for insert with check (auth.uid() = user_id);

drop policy if exists "wishlists_update_own" on public.wishlists;
create policy "wishlists_update_own" on public.wishlists
  for update using (auth.uid() = user_id);

drop policy if exists "wishlists_delete_own" on public.wishlists;
create policy "wishlists_delete_own" on public.wishlists
  for delete using (auth.uid() = user_id);
