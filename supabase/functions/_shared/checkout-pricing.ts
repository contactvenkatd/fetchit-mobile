// Zinc Connect documents its standard $1 fee independently of wallet pricing.
// Account processing terms are not verified: unknown components stay null.
export const ESTIMATE_REVISION = 'usd-service-fee-v2';
export interface CheckoutQuote {
  id: string;
  mode: 'estimate';
  revision: string;
  itemSubtotalCents: number;
  knownCostsCents: number;
  shippingCents: null;
  taxCents: null;
  zincFeeCents: 100;
  paymentFeeCents: null;
  fetchitMarginCents: number;
  serviceFeeCents: number;
  estimatedTotalCents: null;
  retailerBudgetCents: number;
  currency: 'USD';
  expiresAt: number;
}
export interface CheckoutContext {
  userId: string;
  productUrl: string;
  variants?: { label: string; value: string }[];
  quantity: number;
  itemSubtotalCents: number;
  currency: 'USD';
  retailerBudgetCents: number;
  profile: Record<string, unknown>;
}
export function calculateServiceMargin(itemSubtotalCents: number): number | null {
  if (!Number.isSafeInteger(itemSubtotalCents) || itemSubtotalCents <= 0) return null;
  // Positive integer cents: round(3.5%) = floor((subtotal * 35 + 500) / 1000).
  const value = 200n + (BigInt(itemSubtotalCents) * 35n + 500n) / 1000n;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}
export async function createCheckoutQuote(
  context: CheckoutContext,
  now = Date.now(),
): Promise<CheckoutQuote | null> {
  const margin = calculateServiceMargin(context.itemSubtotalCents);
  if (margin === null || !Number.isSafeInteger(context.itemSubtotalCents + margin + 100) || context.currency !== 'USD' ||
      !Number.isSafeInteger(context.itemSubtotalCents) || context.itemSubtotalCents <= 0 ||
      !Number.isSafeInteger(context.itemSubtotalCents + 100) ||
      !Number.isSafeInteger(context.retailerBudgetCents) || context.retailerBudgetCents <= 0 ||
      !Number.isInteger(context.quantity) || context.quantity < 1 || context.quantity > 100) return null;
  const expiresAt = (Math.floor(now / 300000) + 1) * 300000;
  const terms = {
    mode: 'estimate' as const, revision: ESTIMATE_REVISION,
    itemSubtotalCents: context.itemSubtotalCents, knownCostsCents: context.itemSubtotalCents + margin + 100,
    shippingCents: null, taxCents: null, zincFeeCents: 100 as const, paymentFeeCents: null,
    fetchitMarginCents: margin, serviceFeeCents: margin + 100, estimatedTotalCents: null,
    retailerBudgetCents: context.retailerBudgetCents, currency: 'USD' as const, expiresAt,
  };
  const encoded = new TextEncoder().encode(JSON.stringify([
    context.userId, context.productUrl, context.quantity, context.variants ?? [],
    Object.keys(context.profile).sort().map(key => [key, context.profile[key]]), terms,
  ]));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { id, ...terms };
}
export function approvesQuote(approval: unknown, quote: CheckoutQuote, now = Date.now()): boolean {
  if (!approval || typeof approval !== 'object' || now >= quote.expiresAt) return false;
  const value = approval as Record<string, unknown>;
  // Old maximum approvals cannot authorize variable-fee checkout.
  return value.quoteId === quote.id && value.mode === 'estimate' &&
    value.acceptsVariableFees === true && value.retailerBudgetCents === quote.retailerBudgetCents &&
    value.currency === quote.currency;
}
