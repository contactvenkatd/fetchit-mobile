// Supabase Edge Function: create-subscription
// ---------------------------------------------------------------------------
// Runs server-side (Deno) where the Stripe SECRET key is safe. The frontend
// calls this via `supabase.functions.invoke("create-subscription", ...)`. It:
//   1. Authenticates the caller from their Supabase JWT.
//   2. Reuses (or creates + persists) that user's Stripe customer so returning
//      users never get a duplicate customer.
//   3. Creates an incomplete subscription for the chosen plan/billing period.
//   4. Returns the PaymentIntent client secret for client confirmation.
//
// Deploy:   supabase functions deploy create-subscription
// Secret: STRIPE_SECRET_KEY in Supabase Edge Function secrets only.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Mode follows backend secret storage; production requires live credentials.

import Stripe from "npm:stripe@17.7.0";
import { PaymentConfigurationError, paymentStripe, resolveCustomer } from "../_shared/stripe-backend.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

// Pricing in cents + interval — must match src/stripeClient.js PLAN_PRICING.
// A "year" interval amount is the full annual total; Plus is flat ($4.99,
// always billed monthly — same on either toggle, no annual commitment).
type Period = { amount: number; interval: "month" | "year" };
const PLAN_PRICING: Record<string, { monthly: Period; annual: Period }> = {
  Plus: {
    monthly: { amount: 499, interval: "month" },
    annual: { amount: 499, interval: "month" },
  },
  Pro: {
    monthly: { amount: 1999, interval: "month" },
    annual: { amount: 21588, interval: "year" },
  },
  Max: {
    monthly: { amount: 9999, interval: "month" },
    annual: { amount: 107988, interval: "year" },
  },
};

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "http://localhost:3000",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

// The Subscriptions API's inline price_data needs an existing Product ID
// (`product`), not an inline `product_data` object. Reuse one product per plan
// (keyed by metadata) so repeated checkouts don't pile up duplicate products;
// create it the first time. The price (amount/interval) still rides on
// price_data, so we never need pre-created Price IDs.
async function ensureProduct(stripe: Stripe, plan: string): Promise<string> {
  try {
    const found = await stripe.products.search({
      query: `active:'true' AND metadata['fetchit_plan']:'${plan}'`,
      limit: 1,
    });
    if (found.data[0]) return found.data[0].id;
  } catch (_) {
    // Search index can lag for brand-new objects; fall through and create.
  }
  const product = await stripe.products.create({
    name: `FetchIt ${plan}`,
    metadata: { fetchit_plan: plan },
  });
  return product.id;
}

Deno.serve(async (req) => {
  // CORS preflight.
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") return json({ error: "Only POST is supported." }, 405);

  try {
    const stripe = paymentStripe();

    // ----- Authenticate the caller from their JWT -----
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);

    // Service-role client: reads the *live* user row (current metadata, not the
    // possibly-stale token claims) and can write metadata back via admin.
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated." }, 401);
    }
    const user = userData.user;

    // ----- Per-IP rate limit (60 requests / hour) -----
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { data: okIp } = await admin.rpc("rl_check", { p_bucket: `ip:${ip}`, p_limit: 60, p_window_seconds: 3600 });
    if (okIp === false) return json({ error: "Too many requests. Try again later." }, 429);

    // ----- Validate the requested plan -----
    const { plan, billing } = await req.json().catch(() => ({}));
    const pricing = PLAN_PRICING[plan as string];
    if (!pricing) return json({ error: "Unknown plan." }, 400);
    const period = billing === "annual" ? pricing.annual : pricing.monthly;
    const unitAmount = period.amount;
    const interval = period.interval;

    // ----- Reuse or create the Stripe customer -----
    const customerId = await resolveCustomer(admin, stripe, user, true);

    // ----- Create the subscription (incomplete → confirmed by the browser) -----
    // Inline price_data avoids pre-created Price IDs, but subscription price_data
    // requires an existing Product ID (not product_data) — so resolve one first.
    const productId = await ensureProduct(stripe, plan as string);
    const subscription = await stripe.subscriptions.create({
      customer: customerId,
      items: [
        {
          price_data: {
            currency: "usd",
            product: productId,
            unit_amount: unitAmount,
            recurring: { interval },
          },
        },
      ],
      payment_behavior: "default_incomplete",
      payment_settings: { save_default_payment_method: "on_subscription" },
      expand: ["latest_invoice.payment_intent"],
      metadata: { supabase_uid: user.id, plan, billing: interval },
    });

    const invoice = subscription.latest_invoice as Stripe.Invoice;
    const paymentIntent = invoice.payment_intent as Stripe.PaymentIntent;

    if (!paymentIntent?.client_secret) throw new Error("Missing payment confirmation details");
    return json({
      subscriptionId: subscription.id,
      clientSecret: paymentIntent.client_secret,
      customerId,
    });
  } catch (err) {
    const message = err instanceof PaymentConfigurationError ? err.message : "Subscription failed.";
    return json({ error: message }, 500);
  }
});
