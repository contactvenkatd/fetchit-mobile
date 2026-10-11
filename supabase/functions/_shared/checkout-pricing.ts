// Zinc Connect documents its standard $1 fee independently of wallet pricing.
// Provider-determined processing is disclosed and separately consented to.
// Production processing terms are not verified: unknown components stay null.
export const ESTIMATE_REVISION = 'usd-shipping-review-v8';
export interface CheckoutQuote {
  id: string;
  mode: 'estimate';
  paymentContract: 'disclosed_variable_processing';
  canSubmit: boolean;
  revision: string;
  itemSubtotalCents: number;
  knownCostsCents: number;
  shippingCents: number | null;
  shippingScope: 'offer_estimate_not_destination_specific' | 'unknown';
  shippingOptions: { name: string; price: number | null }[];
  knownRetailerCostsCents: number;
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
  listingEvidence?: unknown;
}
// FetchIt share before processing. Zinc collects its separate $1 automatically.
export function calculateServiceMargin(itemSubtotalCents: number): number | null {
  if (!Number.isSafeInteger(itemSubtotalCents) || itemSubtotalCents <= 0) return null;
  // Round 3.5% once on the entire item subtotal, using integer arithmetic.
  const value = 100n + (BigInt(itemSubtotalCents) * 35n + 500n) / 1000n;
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}
// Only provider-signed offer evidence enters this helper. Offer methods are not
// destination quotes or seller/service selections. Quantity scaling is undocumented.
export function offerShipping(evidence: unknown, quantity: number) {
  const value = evidence as { shippingOptions?: { name: string; price: number | null }[] } | null;
  const options = Array.isArray(value?.shippingOptions) ? value.shippingOptions : [];
  const known = quantity === 1 && options.length > 0 && options.every(o =>
    Number.isSafeInteger(o.price) && o.price! >= 0);
  return { options, cents: known ? Math.min(...options.map(o => o.price!)) : null };
}
// Unknown components contribute no KNOWN amount, but remain null in the quote;
// this lower bound is never presented as the complete retailer/customer total.
export function knownRetailerCosts(subtotal: number, shipping: number | null, tax: number | null): number | null {
  if (![subtotal, shipping, tax].every(v => v === null || Number.isSafeInteger(v) && v >= 0)) return null;
  let sum = subtotal;
  if (shipping !== null) sum += shipping;
  if (tax !== null) sum += tax;
  return Number.isSafeInteger(sum) ? sum : null;
}
export async function createCheckoutQuote(
  context: CheckoutContext,
  now = Date.now(),
): Promise<CheckoutQuote | null> {
  const margin = calculateServiceMargin(context.itemSubtotalCents);
  const combinedFee = margin === null ? null : margin + 100;
  const shipping = offerShipping(context.listingEvidence, context.quantity);
  const retailerKnown = knownRetailerCosts(context.itemSubtotalCents, shipping.cents, null);
  if (retailerKnown === null || margin === null || combinedFee === null || !Number.isSafeInteger(retailerKnown + combinedFee) || !Number.isSafeInteger(context.retailerBudgetCents + combinedFee) || !Number.isSafeInteger(combinedFee) || !Number.isSafeInteger(context.itemSubtotalCents + combinedFee) || context.currency !== 'USD' ||
      !Number.isSafeInteger(context.itemSubtotalCents) || context.itemSubtotalCents <= 0 ||
      !Number.isSafeInteger(context.itemSubtotalCents + 100) ||
      !Number.isSafeInteger(context.retailerBudgetCents) || context.retailerBudgetCents < context.itemSubtotalCents ||
      !Number.isInteger(context.quantity) || context.quantity < 1 || context.quantity > 100) return null;
  const expiresAt = (Math.floor(now / 300000) + 1) * 300000;
  const terms = {
    mode: 'estimate' as const, paymentContract: 'disclosed_variable_processing' as const, canSubmit: context.retailerBudgetCents >= retailerKnown, revision: ESTIMATE_REVISION,
    itemSubtotalCents: context.itemSubtotalCents, knownCostsCents: retailerKnown + combinedFee, knownRetailerCostsCents: retailerKnown,
    shippingCents: shipping.cents, shippingOptions: shipping.options,
    shippingScope: shipping.cents === null ? 'unknown' as const : 'offer_estimate_not_destination_specific' as const, taxCents: null, zincFeeCents: 100 as const, paymentFeeCents: null,
    fetchitMarginCents: margin, serviceFeeCents: combinedFee, estimatedTotalCents: null,
    retailerBudgetCents: context.retailerBudgetCents, currency: 'USD' as const, expiresAt,
  };
  const encoded = new TextEncoder().encode(JSON.stringify([
    context.userId, context.productUrl, context.quantity, context.variants ?? [], context.listingEvidence ?? null,
    Object.keys(context.profile).sort().map(key => [key, context.profile[key]]), terms,
  ]));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { id, ...terms };
}
export function approvesQuote(approval: unknown, quote: CheckoutQuote, now = Date.now()): boolean {
  if (!approval || typeof approval !== 'object' || now >= quote.expiresAt) return false;
  const value = approval as Record<string, unknown>;
  // Budget and zero-headroom acknowledgment must accompany this exact quote.
  return value.quoteId === quote.id && value.mode === 'estimate' &&
    value.acceptsVariableFees === true && value.acceptsProcessingFee === true &&
    (quote.retailerBudgetCents !== quote.itemSubtotalCents || value.acknowledgesZeroHeadroom === true) &&
    value.retailerBudgetCents === quote.retailerBudgetCents &&
    value.currency === quote.currency;
}
