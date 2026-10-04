import { verifyListingPrice } from '../_shared/listing-price.ts';
import { readOrderStatus } from '../_shared/order-status.ts';
import { paymentStripe, stripeIsLive } from '../_shared/stripe-backend.ts';
import { createCheckoutQuote, approvesQuote } from '../_shared/checkout-pricing.ts';
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ZINC_ORDERS_URL = "https://api.zinc.com/orders";

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

interface PlaceOrderRequest {
  action?: "quote" | "place";
  approval?: unknown;
  productUrl: string;
  variants?: { label: string; value: string }[];
  quantity: number;
  displayedPriceCents: number;
  itemSubtotalCents: number;
  unitPriceCents: number;
  listingProof: string;
  currency: "USD";
  productName: string;
  productImage: string | null;
  retailer: string;
  idempotencyKey: string;
}

interface ZincOrderResponse {
  id?: unknown;
  status?: unknown;
  connect?: { simulated?: unknown };
  error?: { code?: unknown; message?: unknown };
  code?: unknown;
  message?: unknown;
  detail?: unknown;
}

function isPlaceOrderRequest(value: unknown): value is PlaceOrderRequest {
  if (!value || typeof value !== "object") return false;
  const body = value as Record<string, unknown>;
  try {
    const url = new URL(String(body.productUrl));
    if (url.protocol !== "https:") return false;
  } catch {
    return false;
  }

  return (
    (body.action === undefined || body.action === "quote" || body.action === "place") &&
    (body.variants === undefined || (Array.isArray(body.variants) && body.variants.length <= 2 &&
      body.variants.every(v => v && typeof v === 'object' && ['Size', 'Color'].includes(v.label) &&
        typeof v.value === 'string' && v.value.trim().length > 0 && v.value.length <= 200) &&
      new Set(body.variants.map(v => v.label)).size === body.variants.length)) &&
    typeof body.productUrl === "string" &&
    body.productUrl.length <= 4000 &&
    Number.isInteger(body.quantity) &&
    (body.quantity as number) >= 1 &&
    (body.quantity as number) <= 100 &&
    Number.isSafeInteger(body.displayedPriceCents) &&
    (body.displayedPriceCents as number) > 0 &&
    body.currency === "USD" &&
    Number.isSafeInteger(body.unitPriceCents) && (body.unitPriceCents as number) > 0 &&
    typeof body.listingProof === "string" && body.listingProof.length <= 6000 &&
    Number.isSafeInteger(body.itemSubtotalCents) && (body.itemSubtotalCents as number) > 0 &&
    Number.isSafeInteger((body.itemSubtotalCents as number) + 100) &&
    typeof body.productName === "string" &&
    body.productName.trim().length > 0 &&
    body.productName.length <= 1000 &&
    (body.productImage === null || typeof body.productImage === "string") &&
    typeof body.retailer === "string" &&
    body.retailer.trim().length > 0 &&
    typeof body.idempotencyKey === "string" &&
    /^[0-9a-f-]{36}$/i.test(body.idempotencyKey)
  );
}

function splitName(fullName: string): { firstName: string; lastName: string } | null {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return null;
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function countryCode(country: unknown): string | null {
  if (typeof country !== "string") return null;
  const value = country.trim();
  if (/^[a-z]{2}$/i.test(value)) return value.toUpperCase();
  if (["united states", "united states of america", "usa"].includes(value.toLowerCase())) {
    return "US";
  }
  return null;
}

function zincError(raw: ZincOrderResponse, status: number) {
  const code =
    typeof raw.error?.code === "string"
      ? raw.error.code
      : typeof raw.code === "string"
        ? raw.code
        : "zinc_order_failed";
  const message =
    typeof raw.error?.message === "string"
      ? raw.error.message
      : typeof raw.message === "string"
        ? raw.message
        : typeof raw.detail === "string"
          ? raw.detail
          : `Zinc returned HTTP ${status}.`;
  return { code, message };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") {
    return failure("method_not_allowed", "Only POST requests are supported.", 405);
  }

  const authorization = req.headers.get("Authorization");
  if (!authorization) {
    return failure("unauthorized", "You must be signed in to place an order.", 401);
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return failure("invalid_json", "The request body must be valid JSON.", 400);
  }
  const statusRequest = body && typeof body === 'object' && (body as Record<string, unknown>).action === 'status'
    ? body as { action: 'status'; orderId?: unknown } : null;
  if (statusRequest && (typeof statusRequest.orderId !== 'string' || !/^[a-f0-9-]{36}$/i.test(statusRequest.orderId))) {
    return failure('invalid_order', 'The order reference is invalid.', 400);
  }
  if (!statusRequest && !isPlaceOrderRequest(body)) {
    return failure("invalid_order", "The order details are invalid or incomplete.", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const zincApiKey = Deno.env.get("ZINC_API_KEY")?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !zincApiKey) {
    return failure("service_not_configured", "Order placement is not configured.", 503);
  }
  const production = new URL(supabaseUrl).hostname === 'fpphpncruohjlppqhfep.supabase.co';
  if (production && !zincApiKey.startsWith('zn_live_')) {
    return failure('zinc_environment_mismatch', 'Checkout is unavailable because the retailer integration is not configured for live purchases. Contact support.', 503);
  }
  if (!statusRequest && (!/^zn_(live|test)_/.test(zincApiKey) ||
      zincApiKey.startsWith('zn_live_') !== stripeIsLive())) {
    return failure('payment_environment_mismatch', 'Retailer and payment test/live modes must match. No order was submitted.', 503);
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: authData, error: authError } = await supabase.auth.getUser();
  const user = authData.user;
  if (authError || !user) {
    return failure("unauthorized", "Your session is invalid or expired.", 401);
  }

  if (statusRequest) {
    const { data: ownedOrder, error: lookupError } = await supabase.from('orders')
      .select('id,zinc_order_id').eq('id', statusRequest.orderId).eq('user_id', user.id).maybeSingle();
    if (lookupError || !ownedOrder) return failure('order_not_found', 'The order could not be found.', 404);
    try {
      return json({ status: await readOrderStatus(ownedOrder.zinc_order_id, zincApiKey) });
    } catch {
      return failure('order_status_unavailable', 'The latest order or payment status could not be verified. Do not submit another purchase.', 502);
    }
  }
  // Validation above establishes this only after excluding the status action.
  const orderBody = body as PlaceOrderRequest;

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();
  if (profileError) {
    return failure("profile_lookup_failed", "Your checkout profile could not be loaded.", 500);
  }
  if (!profile) {
    return failure("missing_profile", "Add a shipping address and payment method first.", 409);
  }

  const name = splitName(String(profile.full_name ?? ""));
  const country = countryCode(profile.country);
  const phone = String(profile.phone_number ?? user.phone ?? "").trim();
  const paymentMethod = String(profile.stripe_payment_method_id ?? "").trim();
  const customer = String(profile.stripe_customer_id ?? "").trim();
  const addressLine1 = String(profile.address_line1 ?? "").trim();
  const city = String(profile.city ?? "").trim();
  const postalCode = String(profile.zip ?? "").trim();

  if (!paymentMethod || !customer) {
    return failure("missing_payment_method", "Add a saved payment method before buying.", 409);
  }
  if (!name || !addressLine1 || !city || !postalCode || !country ||
      (country === "US" && !String(profile.state ?? "").trim())) {
    return failure(
      "incomplete_shipping_address",
      "Complete your name and shipping address before buying.",
      409,
    );
  }
  if (!phone) {
    return failure(
      "missing_phone_number",
      "A verified phone number is required by the retailer for delivery.",
      409,
    );
  }

  const listing = await verifyListingPrice(orderBody.listingProof, orderBody.productUrl,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')?.trim() ?? '');
  const itemSubtotalCents = listing ? listing.unitPriceCents * orderBody.quantity : NaN;
  if (!listing || orderBody.unitPriceCents !== listing.unitPriceCents ||
      !Number.isSafeInteger(itemSubtotalCents) || orderBody.itemSubtotalCents !== itemSubtotalCents) {
    return failure('invalid_order', 'The product price or currency could not be verified. Search again before approving checkout.', 409);
  }
  if (listing.amazon) {
    if (orderBody.quantity < (listing.amazon.minimumQuantity ?? 1)) {
      return failure('invalid_order', 'The Amazon offer requires a larger quantity. Search again with the intended quantity.', 409);
    }
    if (country !== 'US' || !/^\d{5}(?:-\d{4})?$/.test(postalCode)) {
      return failure('incomplete_shipping_address', 'Amazon US checkout requires your complete US shipping address and valid ZIP code.', 409);
    }
    const requested = orderBody.variants ?? [];
    if (JSON.stringify(requested) !== JSON.stringify(listing.amazon.variants)) {
      return failure('invalid_order', 'The Amazon variant changed. Search for the selected variant again before approving checkout.', 409);
    }
  }
  if (new URL(orderBody.productUrl).hostname === 'www.amazon.com' && !listing.amazon) {
    return failure('invalid_order', 'Search Amazon US again to verify its offer, currency and selected variant.', 409);
  }
  const quote = await createCheckoutQuote({
    userId: user.id, productUrl: orderBody.productUrl, quantity: orderBody.quantity, variants: orderBody.variants,
    retailerBudgetCents: orderBody.displayedPriceCents,
    itemSubtotalCents, currency: orderBody.currency,
    profile: { customer, paymentMethod, firstName: name.firstName, lastName: name.lastName,
      addressLine1, addressLine2: String(profile.address_line2 ?? '').trim(), city,
      state: String(profile.state ?? '').trim(), postalCode, country, phone },
  });
  if (!quote) return failure('checkout_pricing_unavailable',
    'The checkout estimate cannot be verified. No order was submitted.', 503);
  if (orderBody.action === 'quote') return json({ quote });
  if (!approvesQuote(orderBody.approval, quote)) return failure('checkout_approval_required',
    'The checkout estimate or details changed. Review and approve the updated estimate before placing your order.', 409);

  // Validate references against the backend's Stripe account before Zinc can
  // submit an order. Stale test cards require fresh live card collection.
  try {
    const stripe = paymentStripe();
    const storedCustomer = await stripe.customers.retrieve(customer);
    const storedMethod = await stripe.paymentMethods.retrieve(paymentMethod);
    const methodCustomer = typeof storedMethod.customer === 'string'
      ? storedMethod.customer : storedMethod.customer?.id;
    if (storedCustomer.deleted || storedCustomer.livemode !== stripeIsLive() ||
      storedMethod.livemode !== stripeIsLive() || methodCustomer !== customer ||
      storedCustomer.metadata.supabase_uid !== user.id ||
      user.user_metadata.stripe_customer_id !== customer) {
      return failure('payment_environment_mismatch', 'Save a new card in Cards & Address before buying.', 409);
    }
  } catch (error) {
    if ((error as { code?: string }).code === 'resource_missing') {
      return failure('payment_environment_mismatch', 'Save a new card in Cards & Address before buying.', 409);
    }
    return failure('payment_verification_unavailable', 'Payment verification is unavailable. Try again later.', 503);
  }

  const zincRequest = {
    products: [{ url: orderBody.productUrl, quantity: orderBody.quantity,
      ...(listing.amazon ? { condition_in: ['New'] } : {}),
      ...(orderBody.variants?.length ? { variant: orderBody.variants } : {}) }],
    shipping_address: {
      first_name: name.firstName,
      last_name: name.lastName,
      address_line1: addressLine1,
      address_line2: String(profile.address_line2 ?? "").trim() || null,
      city,
      state: String(profile.state ?? "").trim() || null,
      postal_code: postalCode,
      phone_number: phone,
      country,
    },
    // Retailer costs only. Zinc and processing fees are additional, as approved.
    max_price: quote.retailerBudgetCents,
    metadata: { fetchit_item_subtotal_cents: quote.itemSubtotalCents,
      fetchit_margin_cents: quote.fetchitMarginCents, zinc_fee_cents: quote.zincFeeCents,
      checkout_fee_revision: quote.revision,
      ...(listing.amazon ? { amazon_asin: listing.amazon.asin,
        amazon_quoted_seller_id: listing.amazon.sellerId, amazon_quoted_seller_name: listing.amazon.sellerName,
        amazon_seller_pinning: 'not_supported_by_v2_contract' } : {}) },
    idempotency_key: orderBody.idempotencyKey,
    payment: {
      mode: "connect",
      payment_method: paymentMethod,
      customer,
      margin: { type: "flat", value: quote.fetchitMarginCents },
    },
  };

  // Stripe reference verification can outlast the approval window. Recheck
  // immediately before the first potentially financial upstream request.
  if (!approvesQuote(orderBody.approval, quote)) return failure('checkout_approval_required',
    'This estimate expired. Review and approve a fresh estimate before placing your order.', 409);

  let zincResponse: Response;
  let zincOrder: ZincOrderResponse;
  try {
    zincResponse = await fetch(ZINC_ORDERS_URL, {
      method: "POST",
      redirect: 'error',
      signal: AbortSignal.timeout(20000),
      headers: {
        Authorization: `Bearer ${zincApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(zincRequest),
    });
    zincOrder = (await zincResponse.json()) as ZincOrderResponse;
  } catch {
    return failure(
      "zinc_unreachable",
      "The retailer could not be reached. Your order was not confirmed.",
      502,
    );
  }

  if (!zincResponse.ok) {
    if (zincResponse.status >= 500 || zincResponse.status === 408) {
      return failure('zinc_unreachable', 'The retailer outcome is unconfirmed. Check order history before submitting another purchase.', 502);
    }
    const upstream = zincError(zincOrder, zincResponse.status);
    const status = zincResponse.status === 402 ? 402 : zincResponse.status < 500 ? 409 : 502;
    return failure(upstream.code, upstream.message, status);
  }
  const simulated = production && zincOrder.connect?.simulated === true;
  if (typeof zincOrder.id !== "string" || (!simulated && typeof zincOrder.status !== "string")) {
    return failure("malformed_zinc_response", "Zinc accepted an order but returned no order ID.", 502);
  }


  const orderPriceDollars = orderBody.displayedPriceCents / 100;
  const { data: savedOrder, error: insertError } = await supabase
    .from("orders")
    .insert({
      user_id: user.id,
      product_name: orderBody.productName.trim(),
      order_price: orderPriceDollars,
      service_fee: quote.fetchitMarginCents / 100,
      product_image: orderBody.productImage,
      retailer: orderBody.retailer.trim(),
      category: null,
      zinc_order_id: zincOrder.id,
      status: simulated ? 'configuration_failed' : zincOrder.status,
    })
    .select("id")
    .single();

  if (simulated) {
    // Preserve the accepted ID even when local persistence fails. Do not report
    // a successful purchase or invite a retry after an upstream acceptance.
    console.error(JSON.stringify({ code: 'zinc_simulation_detected', zincOrderId: zincOrder.id,
      recorded: !insertError }));
    return json({ error: {
      code: 'place_order_failed', reason: 'zinc_simulation_detected',
      message: 'The retailer returned a simulated order. Contact support before submitting another purchase.',
    }, investigation: { zincOrderId: zincOrder.id, orderId: savedOrder?.id ?? null,
      recorded: !insertError }, retryAllowed: false }, 503);
  }

  if (insertError) {
    console.error(JSON.stringify({ code: 'order_record_failed', zincOrderId: zincOrder.id }));
    return json(
      {
        success: true,
        order: {
          id: null,
          zincOrderId: zincOrder.id,
          status: zincOrder.status,
          totalCents: orderBody.displayedPriceCents,
          recorded: false,
        },
        warning: "Your order was submitted, but it may take a moment to appear in history.",
      },
      201,
    );
  }

  return json(
    {
      success: true,
      order: {
        id: savedOrder.id,
        zincOrderId: zincOrder.id,
        status: zincOrder.status,
        totalCents: orderBody.displayedPriceCents,
        recorded: true,
      },
    },
    201,
  );
});
