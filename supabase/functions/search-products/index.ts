const ZINC_SEARCH_URL = "https://api.zinc.com/search";

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
  image: string | null;
  retailer: string;
  productId: string;
  url: string;
}

interface ZincSearchResult {
  url?: unknown;
  retailer?: unknown;
  title?: unknown;
  image?: unknown;
  price?: unknown;
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

function normalizeResults(raw: unknown, intent: ShoppingIntent): ProductResult[] {
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

    const price =
      typeof result.price === "number" && Number.isInteger(result.price)
        ? result.price
        : null;
    if (priceCeilingCents !== null && price !== null && price > priceCeilingCents) {
      return [];
    }

    const url = result.url.trim();
    return [{
      title: result.title.trim(),
      price,
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

  try {
    const searchUrl = new URL(ZINC_SEARCH_URL);
    searchUrl.searchParams.set("q", buildSearchQuery(body));

    const response = await fetch(searchUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const raw = (await response.json()) as ZincSearchResponse;

    if (!response.ok) {
      const upstreamMessage =
        typeof raw.error?.message === "string"
          ? raw.error.message
          : typeof raw.detail === "string"
            ? raw.detail
            : `Zinc returned HTTP ${response.status}.`;
      return failure("zinc_request_failed", upstreamMessage, 502);
    }
    if (!Array.isArray(raw.results)) {
      return failure("malformed_response", "Zinc returned a malformed search response.", 502);
    }

    return json({ results: normalizeResults(raw.results, body) });
  } catch {
    return failure("product_search_failed", "The product search request failed.", 502);
  }
});
