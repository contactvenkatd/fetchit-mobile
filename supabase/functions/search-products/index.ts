import { signListingPrice } from '../_shared/listing-price.ts';
import { authenticateRequest, chargeQuota, checkQuota, quotaExceededBody, ZINC_CALL_MICROCENTS } from '../_shared/usage-quota.ts';
const ZINC_SEARCH_URL = "https://api.zinc.com/search";
const ZINC_RETAILER_SEARCH_URL = "https://api.zinc.com/products/search";

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const failure = (code: string, message: string, status: number) =>
  json({ error: { code, message } }, status);

interface ShoppingIntent {
  productQuery: string;
  size: string | null;
  color: string | null;
  priceCeiling: number | null;
  quantity: number;
  retailerPreference: string | null;
}

export interface ProductResult {
  title: string;
  price: number | null;
  currency: string | null;
  listingProof?: string | null;
  image: string | null;
  retailer: string;
  productId: string;
  url: string;
}

interface ZincSearchResult {
  product_id?: unknown;
  url?: unknown;
  retailer?: unknown;
  title?: unknown;
  image?: unknown;
  price?: unknown;
  currency?: unknown;
  currency_code?: unknown;
  available?: unknown;
}

interface ZincSearchResponse {
  status?: unknown;
  query?: unknown;
  results?: unknown;
  error?: { message?: unknown };
  detail?: unknown;
}

function isShoppingIntent(value: unknown): value is ShoppingIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Record<string, unknown>;
  return (
    typeof intent.productQuery === "string" &&
    intent.productQuery.trim().length > 0 &&
    (intent.size === null || typeof intent.size === "string") &&
    (intent.color === null || typeof intent.color === "string") &&
    (intent.priceCeiling === null ||
      (typeof intent.priceCeiling === "number" &&
        Number.isFinite(intent.priceCeiling) &&
        intent.priceCeiling >= 0)) &&
    Number.isInteger(intent.quantity) &&
    (intent.quantity as number) >= 1 &&
    (intent.retailerPreference === null ||
      typeof intent.retailerPreference === "string")
  );
}

function buildSearchQuery(intent: ShoppingIntent): string {
  return [intent.productQuery.trim(), intent.size?.trim(), intent.color?.trim()]
    .filter((part): part is string => Boolean(part))
    .join(" ");
}

export function normalizeResults(raw: unknown, intent: ShoppingIntent): ProductResult[] {
  if (!Array.isArray(raw)) return [];

  const preferredRetailer = intent.retailerPreference?.trim().toLowerCase();
  const priceCeilingCents =
    intent.priceCeiling === null ? null : Math.round(intent.priceCeiling * 100);

  const results = raw.flatMap((value): ProductResult[] => {
    if (!value || typeof value !== "object") return [];
    const result = value as ZincSearchResult;
    if (
      typeof result.url !== "string" ||
      !result.url.trim() ||
      typeof result.retailer !== "string" ||
      !result.retailer.trim() ||
      typeof result.title !== "string" ||
      !result.title.trim()
    ) {
      return [];
    }

    if (result.available === false) return [];

    const price =
      typeof result.price === "number" && Number.isInteger(result.price)
        ? result.price
        : null;
    if (priceCeilingCents !== null && price !== null && price > priceCeilingCents) {
      return [];
    }

    const explicitCurrency = typeof result.currency === 'string' && /^[A-Z]{3}$/.test(result.currency.toUpperCase()) ? result.currency.toUpperCase() : null;
    // Zinc documents currency_code for Etsy product data. Preserve an explicit
    // provider code if supplied; this is not a retailer/domain-based USD guess.
    const currencyCode = typeof result.currency_code === 'string' && /^[A-Z]{3}$/.test(result.currency_code.toUpperCase()) ? result.currency_code.toUpperCase() : null;
    const currency = explicitCurrency && currencyCode && explicitCurrency !== currencyCode ? null : explicitCurrency ?? currencyCode;
    const url = result.url.trim();
    return [{
      title: result.title.trim(),
      price,
      currency,
      image:
        typeof result.image === "string" && result.image.trim()
          ? result.image.trim()
          : null,
      retailer: result.retailer.trim(),
      productId: url,
      url,
    }];
  });

  if (!preferredRetailer) return results.slice(0, 10);

  // Zinc's cross-retailer beta does not accept a retailer filter. Preserve its
  // ranking while moving an explicitly preferred retailer to the front.
  return results
    .map((result, index) => ({
      result,
      index,
      preferred: result.retailer.toLowerCase() === preferredRetailer ? 0 : 1,
    }))
    .sort((a, b) => a.preferred - b.preferred || a.index - b.index)
    .slice(0, 10)
    .map(({ result }) => result);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return failure("method_not_allowed", "Only POST requests are supported.", 405);
  }

  const user = await authenticateRequest(req);
  if (!user) {
    return failure("unauthorized", "Your session is invalid or expired.", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failure("invalid_json", "The request body must be valid JSON.", 400);
  }

  if (!isShoppingIntent(body)) {
    return failure("invalid_intent", "A valid shopping intent is required.", 400);
  }

  const apiKey = Deno.env.get("ZINC_API_KEY")?.trim();
  if (!apiKey) {
    return failure("service_not_configured", "Product search is not configured.", 503);
  }

  // Amazon US is the supported search scope. Other retailers are deferred;
  // never replace an Amazon query with an Etsy item or infer cross-search USD.
  const preferred = body.retailerPreference?.trim().toLowerCase();
  if (preferred && !['amazon', 'amazon us', 'amazon.com'].includes(preferred)) {
    return failure('unsupported_retailer', 'Search currently supports Amazon US only.', 409);
  }
  // Refuse before any paid Zinc request once this month's search budget is
  // spent. Fails CLOSED if the quota system itself is unavailable to protect
  // spend. The actual cost (successful calls × $0.01) is debited afterwards.
  const quota = await checkQuota(user, 'zinc');
  if (!quota.allowed) {
    return quota.reason === 'exceeded'
      ? json(quotaExceededBody(quota.snapshot), 429)
      : failure('quota_unavailable', 'Product search is temporarily unavailable. Please try again in a moment.', 503);
  }
  // Zinc bills each successful data call, so count them as they return.
  let billedZincCalls = 0;
  try {
    const read = async (path: string) => {
      const response = await fetch(new URL(path, 'https://api.zinc.com'), {
        headers: { Authorization: `Bearer ${apiKey}` }, redirect: 'error', signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error('amazon_data_unavailable');
      billedZincCalls += 1;
      return await response.json();
    };
    const searchUrl = new URL(ZINC_RETAILER_SEARCH_URL);
    searchUrl.searchParams.set('query', buildSearchQuery(body));
    searchUrl.searchParams.set('retailer', 'amazon');
    const raw = await read(searchUrl.pathname + searchUrl.search);
    if (raw.status !== 'completed' || !Array.isArray(raw.results)) {
      return failure('malformed_response', 'Amazon search data could not be verified.', 502);
    }
    const requested = [
      body.size?.trim() ? { label: 'Size', value: body.size.trim() } : null,
      body.color?.trim() ? { label: 'Color', value: body.color.trim() } : null,
    ].filter((v): v is { label: string; value: string } => v !== null);
    const matches = (specifics: unknown) => Array.isArray(specifics) && requested.every(wanted =>
      specifics.some(v => v?.dimension?.toLowerCase() === wanted.label.toLowerCase() &&
        typeof v.value === 'string' && v.value.trim().toLowerCase() === wanted.value.toLowerCase()));
    const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '';
    const results = await Promise.all(raw.results.slice(0, 5).map(async (row: Record<string, unknown>) => {
      try {
        if (typeof row.product_id !== 'string' || !/^[A-Z0-9]{10}$/.test(row.product_id) || row.available === false) return null;
        let asin = row.product_id;
        let details = await read(`/products/${asin}?retailer=amazon`);
        if (requested.length && !matches(details.variant_specifics)) {
          const child = details.all_variants?.find((v: { product_id?: string; variant_specifics?: unknown }) =>
            typeof v.product_id === 'string' && /^[A-Z0-9]{10}$/.test(v.product_id) && matches(v.variant_specifics));
          if (!child) return null;
          asin = child.product_id;
          details = await read(`/products/${asin}?retailer=amazon`);
        }
        if (details.status !== 'completed' || details.retailer !== 'amazon' ||
            (details.asin ?? details.product_id) !== asin || details.buyapi_hint === false ||
            details.digital || details.digital_subscription || details.gift_card || details.fresh ||
            details.pantry || details.customizable || (requested.length && !matches(details.variant_specifics))) return null;
        const offers = await read(`/products/${asin}/offers?retailer=amazon`);
        if (offers.status !== 'completed' || offers.retailer !== 'amazon' ||
            (offers.asin ?? offers.product_id) !== asin || offers.expired_product_id === true || !Array.isArray(offers.offers)) return null;
        // Official offers contract: integer cents, excluding shipping. Currency
        // must be explicit on the same ASIN offer; no domain-based USD inference.
        const offer = offers.offers.find((v: Record<string, any>) =>
          v.available === true && v.condition === 'New' && v.international !== true && v.prime_only !== true && v.expired_product_id !== true &&
          (!v.asin || v.asin === asin) && v.currency === 'USD' &&
          (!v.currency_code || v.currency_code === 'USD') && Number.isSafeInteger(v.price) && v.price > 0 &&
          typeof v.seller?.id === 'string' && v.seller.id && typeof v.seller.name === 'string');
        if (!offer || (offer.minimum_quantity != null && (!Number.isInteger(offer.minimum_quantity) || offer.minimum_quantity < 1 || offer.minimum_quantity > 100 || body.quantity < offer.minimum_quantity)) ||
            (body.priceCeiling !== null && offer.price > Math.round(body.priceCeiling * 100))) return null;
        const url = `https://www.amazon.com/dp/${asin}`;
        const amazon = { asin, sellerId: offer.seller.id, sellerName: offer.seller.name, condition: 'New' as const, variants: requested,
          minimumQuantity: offer.minimum_quantity ?? 1 };
        return {
          title: `${details.title ?? row.title} · New · Quoted seller: ${offer.seller.name}; seller may vary`,
          price: offer.price, currency: offer.currency, image: details.main_image ?? row.image ?? null,
          retailer: 'amazon', productId: asin, url, amazon,
          listingProof: await signListingPrice(url, offer.price, offer.currency, secret, Date.now(), amazon),
        };
      } catch { return null; }
    }));
    const unique = new Set<string>();
    return json({ results: results.filter(result => {
      if (!result || unique.has(result.productId)) return false;
      unique.add(result.productId); return true;
    }), scope: 'amazon-us' });
  } catch {
    return failure('product_search_failed', 'Amazon US search data is unavailable. No purchase was submitted.', 502);
  } finally {
    await chargeQuota(user, 'zinc', billedZincCalls * ZINC_CALL_MICROCENTS, quota);
  }
});
