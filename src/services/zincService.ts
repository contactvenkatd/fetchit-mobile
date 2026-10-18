import { supabase } from '@/lib/supabase';
import { readQuotaError } from '@/services/quotaService';
import type { ShoppingIntent } from '@/services/grokService';

export interface ProductResult {
  title: string;
  /** Price in cents, matching Zinc's API. */
  price: number | null;
  /** Unknown unless explicitly supplied by the search response. */
  currency?: string | null;
  listingProof?: string | null;
  image: string | null;
  retailer: string;
  /** Currently the orderable retailer URL returned by Zinc. */
  productId: string;
  url: string;
  checkoutUnavailableReason?: string;
}

export class ZincServiceError extends Error {
  readonly userMessage: string;

  constructor(message: string, options?: ErrorOptions, userMessage = "I couldn't search for products right now. Please try again in a moment.") {
    super(message, options);
    this.name = 'ZincServiceError';
    this.userMessage = userMessage;
  }
}

function isProductResult(value: unknown): value is ProductResult {
  if (!value || typeof value !== 'object') return false;
  const result = value as Record<string, unknown>;
  return (
    typeof result.title === 'string' &&
    result.title.trim().length > 0 &&
    (result.price === null ||
      (typeof result.price === 'number' && Number.isInteger(result.price))) &&
    (result.image === null || typeof result.image === 'string') &&
    typeof result.retailer === 'string' &&
    result.retailer.trim().length > 0 &&
    typeof result.productId === 'string' &&
    result.productId.trim().length > 0 &&
    typeof result.url === 'string' &&
    result.url.trim().length > 0
  );
}

export async function searchProducts(intent: ShoppingIntent): Promise<ProductResult[]> {
  try {
    const { data, error } = await supabase.functions.invoke('search-products', {
      body: intent,
    });
    if (error) throw error;

    const results = (data as { results?: unknown } | null)?.results;
    if (!Array.isArray(results) || !results.every(isProductResult)) {
      throw new Error('Edge Function returned malformed product results.');
    }
    return results;
  } catch (error) {
    if (error instanceof ZincServiceError) throw error;
    const quotaError = await readQuotaError(error);
    if (quotaError) throw quotaError;
    const messages: Record<string, string> = {
      quota_unavailable: 'Product search is temporarily unavailable. Try again shortly or contact FetchIt support if this continues.',
      zinc_credit_required: 'Product search credits are unavailable. Contact FetchIt support.',
      zinc_authentication_failed: 'Product search needs attention from FetchIt support. Please contact support.',
      zinc_rate_limited: 'Product search is busy. Wait a minute, then try again.',
      unsupported_retailer: 'Search currently supports Amazon US. Please try an Amazon product search.',
      unauthorized: 'Your session has expired. Sign in again to search for products.',
      malformed_response: 'The provider returned unrecognized product data. Try again shortly or contact FetchIt support.',
    };
    let code: unknown;
    try { code = (await (error as { context?: Response })?.context?.clone().json())?.error?.code; } catch { /* use safe retry message */ }
    throw new ZincServiceError('Zinc product search failed.', { cause: error }, typeof code === 'string' ? messages[code] : undefined);
  }
}
