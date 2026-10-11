-- Sanitized snapshots only. No address, credentials, payment references or raw
-- provider responses. Existing order ownership/RLS continues to apply.
alter table public.orders
  add column if not exists checkout_evidence jsonb,
  add column if not exists zinc_cost_evidence jsonb,
  add column if not exists zinc_error_code text,
  add column if not exists zinc_status_checked_at timestamptz;

comment on column public.orders.checkout_evidence is
  'Approved quote costs/budget and original signed offer facts; never a raw request';
comment on column public.orders.zinc_cost_evidence is
  'Allowlisted numeric Zinc retailer breakdown; absent shipping service remains unknown';
