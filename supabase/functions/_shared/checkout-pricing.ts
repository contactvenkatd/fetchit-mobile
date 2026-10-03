export interface VerifiedConnectPricing {
  // This adapter may only be supplied after verifying account-specific fees,
  // currency, rounding, retailer-cost enforcement and authorization/capture bounds.
  revision: string;
  currency: 'USD';
  maximumCustomerCharge: (retailerBudgetCents: number) => number;
}

export function verifiedConnectPricing(): VerifiedConnectPricing | null {
  // No production adapter: the public example is not a verified fee algorithm.
  return null;
}

export function connectPricingSupported(): boolean {
  return verifiedConnectPricing() !== null;
}

export interface CheckoutQuote {
  id: string;
  maximumCents: number;
  retailerBudgetCents: number;
  currency: 'USD';
  expiresAt: number;
}

export interface CheckoutContext {
  userId: string;
  productUrl: string;
  quantity: number;
  retailerBudgetCents: number;
  // Server-loaded address/payment references. Only their digest is returned.
  profile: Record<string, unknown>;
}

export async function createCheckoutQuote(
  context: CheckoutContext,
  pricing = verifiedConnectPricing(),
  now = Date.now(),
): Promise<CheckoutQuote | null> {
  if (!pricing || !pricing.revision || pricing.currency !== 'USD' ||
      !Number.isSafeInteger(context.retailerBudgetCents) || context.retailerBudgetCents <= 0 ||
      !Number.isInteger(context.quantity) || context.quantity < 1 || context.quantity > 100) return null;
  const maximumCents = pricing.maximumCustomerCharge(context.retailerBudgetCents);
  if (!Number.isSafeInteger(maximumCents) || maximumCents < context.retailerBudgetCents) return null;
  // A deterministic five-minute window permits recomputation without storing
  // customer data or trusting a client-supplied quote/fee configuration.
  const expiresAt = (Math.floor(now / 300000) + 1) * 300000;
  const encoded = new TextEncoder().encode(JSON.stringify([
    context.userId, context.productUrl, context.quantity, context.retailerBudgetCents,
    Object.keys(context.profile).sort().map(key => [key, context.profile[key]]),
    pricing.revision, pricing.currency, maximumCents, expiresAt,
  ]));
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  return { id, maximumCents, retailerBudgetCents: context.retailerBudgetCents,
    currency: pricing.currency, expiresAt };
}

export function approvesQuote(approval: unknown, quote: CheckoutQuote, now = Date.now()): boolean {
  if (!approval || typeof approval !== 'object' || now >= quote.expiresAt) return false;
  const value = approval as Record<string, unknown>;
  return value.quoteId === quote.id && value.maximumCents === quote.maximumCents &&
    value.currency === quote.currency;
}
