// Zinc Connect documents its standard $1 fee independently of wallet pricing.
// Account processing terms are not verified: unknown components stay null.
export const ESTIMATE_REVISION = 'usd-variable-fees-v1';
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
  fetchitMarginCents: 0;
  estimatedTotalCents: null;
  retailerBudgetCents: number;
  currency: 'USD';
  expiresAt: number;
}
export interface CheckoutContext {
  userId: string;
  productUrl: string;
  quantity: number;
  itemSubtotalCents: number;
  currency: 'USD';
  retailerBudgetCents: number;
  profile: Record<string, unknown>;
}
export async function createCheckoutQuote(
  context: CheckoutContext,
  now = Date.now(),
): Promise<CheckoutQuote | null> {
  if (context.currency !== 'USD' ||
      !Number.isSafeInteger(context.itemSubtotalCents) || context.itemSubtotalCents <= 0 ||
      !Number.isSafeInteger(context.itemSubtotalCents + 100) ||
      !Number.isSafeInteger(context.retailerBudgetCents) || context.retailerBudgetCents <= 0 ||
      !Number.isInteger(context.quantity) || context.quantity < 1 || context.quantity > 100) return null;
  const expiresAt = (Math.floor(now / 300000) + 1) * 300000;
  const terms = {
    mode: 'estimate' as const, revision: ESTIMATE_REVISION,
    itemSubtotalCents: context.itemSubtotalCents, knownCostsCents: context.itemSubtotalCents + 100,
    shippingCents: null, taxCents: null, zincFeeCents: 100 as const, paymentFeeCents: null,
    fetchitMarginCents: 0 as const, estimatedTotalCents: null,
    retailerBudgetCents: context.retailerBudgetCents, currency: 'USD' as const, expiresAt,
  };
  const encoded = new TextEncoder().encode(JSON.stringify([
    context.userId, context.productUrl, context.quantity,
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
