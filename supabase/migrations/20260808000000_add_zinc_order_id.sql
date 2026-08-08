alter table public.orders
  add column if not exists zinc_order_id text;

create index if not exists orders_zinc_order_id_idx
  on public.orders (zinc_order_id)
  where zinc_order_id is not null;
