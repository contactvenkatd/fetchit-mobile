// Supabase Edge Function: create-setup-intent
// ---------------------------------------------------------------------------
// Runs server-side (Deno) where the Stripe SECRET key is safe. Saves a card for
// future off-session charges WITHOUT charging now (used by the Delivery &
// Payment onboarding step and the Cards & Address "update card" flow). It:
//   1. Authenticates the caller from their Supabase JWT.
//   2. Reuses (or creates + persists) that user's Stripe customer — the SAME
//      stripe_customer_id used by create-subscription, so there's one customer.
//   3. Creates a SetupIntent for that customer and returns its client secret so
//      the browser can confirm the card with Stripe Elements (confirmCardSetup).
//
// Deploy:   supabase functions deploy create-setup-intent
// Secret: STRIPE_SECRET_KEY in Supabase Edge Function secrets only.
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Mode follows backend secret storage; production requires live credentials.

import Stripe from "npm:stripe@17.7.0";
import { PaymentConfigurationError, paymentStripe, resolveCustomer } from "../_shared/stripe-backend.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

Deno.serve(async (req) => {
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

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated." }, 401);
    }
    const user = userData.user;

    // ----- Reuse or create the Stripe customer (shared with subscriptions) ----
    const customerId = await resolveCustomer(admin, stripe, user, true);

    // ----- Create the SetupIntent (off-session future charges) -----
    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      usage: "off_session",
      metadata: { supabase_uid: user.id },
    });

    return json({ clientSecret: setupIntent.client_secret, customerId });
  } catch (err) {
    const message = err instanceof PaymentConfigurationError ? err.message : "Setup failed.";
    return json({ error: message }, 500);
  }
});
