import { supabase } from '@/lib/supabase';
import type { ShoppingIntent } from '@/services/grokService';

export interface ProductResult {
  title: string;
  /** Price in cents, matching Zinc's API. */
  price: number | null;
  image: string | null;
  retailer: string;
  /** Currently the orderable retailer URL returned by Zinc. */
  productId: string;
  url: string;
}

export class ZincServiceError extends Error {
  readonly userMessage =
    "I couldn't search for products right now. Please try again in a moment.";

  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ZincServiceError';
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
    throw new ZincServiceError('Zinc product search failed.', { cause: error });
  }
}
