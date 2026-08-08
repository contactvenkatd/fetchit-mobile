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
  productUrl: string;
  quantity: number;
  displayedPriceCents: number;
  productName: string;
  productImage: string | null;
  retailer: string;
  idempotencyKey: string;
}

interface ZincOrderResponse {
  id?: unknown;
  status?: unknown;
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
    typeof body.productUrl === "string" &&
    body.productUrl.length <= 4000 &&
    Number.isInteger(body.quantity) &&
    (body.quantity as number) >= 1 &&
    (body.quantity as number) <= 100 &&
    Number.isInteger(body.displayedPriceCents) &&
    (body.displayedPriceCents as number) > 0 &&
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
  if (!isPlaceOrderRequest(body)) {
    return failure("invalid_order", "The order details are invalid or incomplete.", 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim();
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")?.trim();
  const zincApiKey = Deno.env.get("ZINC_API_KEY")?.trim();
  if (!supabaseUrl || !supabaseAnonKey || !zincApiKey) {
    return failure("service_not_configured", "Order placement is not configured.", 503);
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
  if (!name || !addressLine1 || !city || !postalCode || !country) {
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

  const zincRequest = {
    products: [{ url: body.productUrl, quantity: body.quantity }],
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
    max_price: body.displayedPriceCents,
    idempotency_key: body.idempotencyKey,
    payment: {
      mode: "connect",
      payment_method: paymentMethod,
      customer,
      margin: { type: "flat", value: 0 },
    },
  };

  let zincResponse: Response;
  let zincOrder: ZincOrderResponse;
  try {
    zincResponse = await fetch(ZINC_ORDERS_URL, {
      method: "POST",
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
    const upstream = zincError(zincOrder, zincResponse.status);
    const status = zincResponse.status === 402 ? 402 : zincResponse.status < 500 ? 409 : 502;
    return failure(upstream.code, upstream.message, status);
  }
  if (typeof zincOrder.id !== "string" || typeof zincOrder.status !== "string") {
    return failure("malformed_zinc_response", "Zinc accepted an order but returned no order ID.", 502);
  }

  const orderPriceDollars = body.displayedPriceCents / 100;
  const { data: savedOrder, error: insertError } = await supabase
    .from("orders")
    .insert({
      product_name: body.productName.trim(),
      order_price: orderPriceDollars,
      service_fee: 0,
      product_image: body.productImage,
      retailer: body.retailer.trim(),
      category: null,
      zinc_order_id: zincOrder.id,
      status: zincOrder.status,
    })
    .select("id")
    .single();

  if (insertError) {
    console.error("Order accepted by Zinc but local record failed:", insertError.message);
    return json(
      {
        success: true,
        order: {
          id: null,
          zincOrderId: zincOrder.id,
          status: zincOrder.status,
          totalCents: body.displayedPriceCents,
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
        totalCents: body.displayedPriceCents,
        recorded: true,
      },
    },
    201,
  );
});
