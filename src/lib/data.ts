// Data helpers for the protected app screens — the mobile counterpart of the
// data slice of the web app's utils.js (orders, spend analytics, wishlist,
// auto-reorder). All queries hit the SAME Supabase project as the web app and
// rely on Row Level Security to scope rows to the signed-in user, so no explicit
// user_id filter is needed (RLS + the table's auth.uid() defaults handle it).
//
// Mapping mirrors the web exactly: snake_case columns → camelCase fields, with
// the same legacy fallbacks (e.g. orders.price → orderPrice for old rows).
import { supabase } from '@/lib/supabase';

// "$12.34" / "—" — matches the web pages' local `money` helper (NOT lib/stripe's
// `money`, which omits the leading $ and doesn't guard non-finite values).
export function money(n: number | null | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? `$${n.toFixed(2)}` : '—';
}

// Parse a number out of a numeric or "$12.34"-style string; null if not finite.
// Mirrors utils.js parsePrice.
function parsePrice(value: unknown): number | null {
  if (value == null) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const n = parseFloat(String(value).replace(/[^0-9.]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// ---------------------------------------------------------------------------
// Orders — Supabase "orders" table, scoped to the user via RLS.
// ---------------------------------------------------------------------------
export type Order = {
  id: string;
  productName: string | null;
  productImage: string | null;
  retailer: string | null;
  category: string | null;
  orderPrice: number | null;
  serviceFee: number | null;
  zincOrderId: string | null;
  status: string | null;
  createdAt: string | null;
};

type OrderRow = {
  id: string;
  product_name?: string | null;
  product_image?: string | null;
  retailer?: string | null;
  category?: string | null;
  order_price?: number | string | null;
  price?: number | string | null;
  service_fee?: number | string | null;
  zinc_order_id?: string | null;
  status?: string | null;
  created_at?: string | null;
};

const mapOrder = (row: OrderRow): Order => ({
  id: row.id,
  productName: row.product_name ?? null,
  productImage: row.product_image ?? null,
  retailer: row.retailer ?? null,
  category: row.category ?? null,
  // Fall back to the legacy text `price` column for rows saved before the
  // schema gained order_price (older installs).
  orderPrice:
    row.order_price != null ? Number(row.order_price) : parsePrice(row.price),
  serviceFee: row.service_fee != null ? Number(row.service_fee) : null,
  zincOrderId: row.zinc_order_id ?? null,
  status: row.status ?? null,
  createdAt: row.created_at ?? null,
});

export async function getOrders(): Promise<Order[]> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getOrders failed:', error.message);
    return [];
  }
  return (data ?? []).map(mapOrder);
}

// The user's current order streak (0 if none). Reads the profiles row.
export async function getOrderStreak(): Promise<number> {
  const { data, error } = await supabase.from('profiles').select('*').maybeSingle();
  if (error) {
    console.error('getOrderStreak failed:', error.message);
    return 0;
  }
  return data ? Number((data as { order_streak?: number }).order_streak) || 0 : 0;
}

// ---------------------------------------------------------------------------
// Spend analytics (Orders & Analytics page). All client-side over the orders
// list. "Spend" for an order = order_price only (the service fee is excluded).
// Periods are CALENDAR-based (local time): weekly = since this Monday, monthly =
// since the 1st, yearly = since Jan 1; lifetime = all time.
// ---------------------------------------------------------------------------
export type PeriodKey = 'lifetime' | 'yearly' | 'monthly' | 'weekly';

export const SPEND_PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'lifetime', label: 'Lifetime' },
  { key: 'yearly', label: 'Yearly' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'weekly', label: 'Weekly' },
];

function orderSpend(o: Order): number {
  return Number(o.orderPrice) || 0;
}

// Inclusive start-of-period timestamp (ms, local time). Lifetime → -Infinity.
function periodStart(periodKey: PeriodKey): number {
  const now = new Date();
  const y = now.getFullYear();
  switch (periodKey) {
    case 'weekly': {
      // Midnight at the start of the most recent Monday (Mon=0 … Sun=6).
      const start = new Date(y, now.getMonth(), now.getDate());
      const dow = (start.getDay() + 6) % 7;
      start.setDate(start.getDate() - dow);
      return start.getTime();
    }
    case 'monthly':
      return new Date(y, now.getMonth(), 1).getTime();
    case 'yearly':
      return new Date(y, 0, 1).getTime();
    case 'lifetime':
    default:
      return -Infinity;
  }
}

function withinPeriod(o: Order, periodKey: PeriodKey): boolean {
  if (periodKey === 'lifetime') return true;
  const t = new Date(o.createdAt ?? '').getTime();
  if (Number.isNaN(t)) return false;
  return t >= periodStart(periodKey);
}

// Total spend per period → { lifetime, yearly, monthly, weekly } (numbers).
export function spendSummary(orders: Order[]): Record<PeriodKey, number> {
  const out = {} as Record<PeriodKey, number>;
  for (const p of SPEND_PERIODS) {
    out[p.key] = (orders ?? []).reduce(
      (sum, o) => sum + (withinPeriod(o, p.key) ? orderSpend(o) : 0),
      0,
    );
  }
  return out;
}

// Category totals within a period, sorted high→low: [{ category, total }, …].
export function categoryBreakdown(
  orders: Order[],
  periodKey: PeriodKey,
): { category: string; total: number }[] {
  const period = SPEND_PERIODS.find((p) => p.key === periodKey) ?? SPEND_PERIODS[0];
  const totals = new Map<string, number>();
  for (const o of orders ?? []) {
    if (!withinPeriod(o, period.key)) continue;
    const cat = o.category || 'Uncategorized';
    totals.set(cat, (totals.get(cat) || 0) + orderSpend(o));
  }
  return [...totals.entries()]
    .map(([category, total]) => ({ category, total }))
    .sort((a, b) => b.total - a.total);
}

// ---------------------------------------------------------------------------
// Wishlist — Supabase "wishlists" table, scoped to the user via RLS.
// ---------------------------------------------------------------------------
export type WishlistItem = {
  id: string;
  productName: string | null;
  productUrl: string | null;
  productImage: string | null;
  retailer: string | null;
  price: number | null;
  notes: string;
  createdAt: string | null;
};

type WishlistRow = {
  id: string;
  product_name?: string | null;
  product_url?: string | null;
  product_image?: string | null;
  retailer?: string | null;
  price?: number | string | null;
  notes?: string | null;
  created_at?: string | null;
};

const mapWishlistItem = (row: WishlistRow): WishlistItem => ({
  id: row.id,
  productName: row.product_name ?? null,
  productUrl: row.product_url ?? null,
  productImage: row.product_image ?? null,
  retailer: row.retailer ?? null,
  price: row.price != null ? Number(row.price) : null,
  notes: row.notes || '',
  createdAt: row.created_at ?? null,
});

export async function getWishlist(): Promise<WishlistItem[]> {
  const { data, error } = await supabase
    .from('wishlists')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getWishlist failed:', error.message);
    return [];
  }
  return (data ?? []).map(mapWishlistItem);
}

export async function removeWishlistItem(id: string): Promise<void> {
  const { error } = await supabase.from('wishlists').delete().eq('id', id);
  if (error) console.error('removeWishlistItem failed:', error.message);
}

// ---------------------------------------------------------------------------
// Auto-reorder — Supabase "auto_reorders" table, scoped to the user via RLS.
// Recurring purchase schedules set from the chat; shown on /auto-reorder.
// ---------------------------------------------------------------------------

// The frequency options offered in the chat picker, in order. `key` is the
// stored value; `label` is the human label.
export const FREQUENCY_OPTIONS: { key: string; label: string }[] = [
  { key: 'weekly', label: 'Weekly' },
  { key: 'biweekly', label: 'Every 2 weeks' },
  { key: 'monthly', label: 'Monthly' },
  { key: 'every_2_months', label: 'Every 2 months' },
  { key: 'every_3_months', label: 'Every 3 months' },
];

// Human label for a stored frequency key.
export function frequencyLabel(key: string): string {
  const opt = FREQUENCY_OPTIONS.find((o) => o.key === key);
  return opt ? opt.label : key;
}

export type AutoReorder = {
  id: string;
  productName: string | null;
  productUrl: string | null;
  productImage: string | null;
  retailer: string | null;
  price: number | null;
  frequency: string;
  nextOrderDate: string | null;
  lastOrderedAt: string | null;
  active: boolean;
  createdAt: string | null;
};

type AutoReorderRow = {
  id: string;
  product_name?: string | null;
  product_url?: string | null;
  product_image?: string | null;
  retailer?: string | null;
  price?: number | string | null;
  frequency?: string | null;
  next_order_date?: string | null;
  last_ordered_at?: string | null;
  active?: boolean | null;
  created_at?: string | null;
};

const mapAutoReorder = (row: AutoReorderRow): AutoReorder => ({
  id: row.id,
  productName: row.product_name ?? null,
  productUrl: row.product_url ?? null,
  productImage: row.product_image ?? null,
  retailer: row.retailer ?? null,
  price: row.price != null ? Number(row.price) : null,
  frequency: row.frequency ?? '',
  nextOrderDate: row.next_order_date ?? null,
  lastOrderedAt: row.last_ordered_at ?? null,
  active: row.active !== false,
  createdAt: row.created_at ?? null,
});

export async function getAutoReorders(): Promise<AutoReorder[]> {
  const { data, error } = await supabase
    .from('auto_reorders')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) {
    console.error('getAutoReorders failed:', error.message);
    return [];
  }
  return (data ?? []).map(mapAutoReorder);
}

// Pause/resume an auto-reorder (toggle `active`).
export async function setAutoReorderActive(
  id: string,
  active: boolean,
): Promise<{ error: { message: string } | null }> {
  const { error } = await supabase
    .from('auto_reorders')
    .update({ active })
    .eq('id', id);
  if (error) {
    console.error('setAutoReorderActive failed:', error.message);
    return { error: { message: error.message } };
  }
  return { error: null };
}

export async function deleteAutoReorder(id: string): Promise<void> {
  const { error } = await supabase.from('auto_reorders').delete().eq('id', id);
  if (error) console.error('deleteAutoReorder failed:', error.message);
}
