// Supabase Edge Function: cancel-subscription
// ---------------------------------------------------------------------------
// Runs server-side (Deno) where the Stripe SECRET key is safe. Cancels the
// caller's active Stripe subscription(s) at period end — they keep access until
// the current period closes (no immediate cutoff, no refund). The client then
// downgrades the user's plan metadata to Free (see utils.js cancelSubscription).
//
// Deploy:   supabase functions deploy cancel-subscription
// Secret:   reuses STRIPE_SECRET_KEY (already set for create-subscription)
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)
//
// Mode follows backend secret storage; production requires live credentials.

import Stripe from "npm:stripe@17.7.0";
import { PaymentConfigurationError, paymentStripe, resolveCustomer } from "../_shared/stripe-backend.ts";
import { createClient } from "npm:@supabase/supabase-js@^2";

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

    // Body options:
    //   atPeriodEnd          — true (default): set cancel_at_period_end so the
    //                          user keeps access until the period ends (the
    //                          cancel-to-Free flow + downgrades). false: cancel
    //                          immediately (upgrade / billing switch).
    //   exceptSubscriptionId — a subscription to leave untouched (the brand-new
    //                          one created during a plan change).
    const { atPeriodEnd = true, exceptSubscriptionId = null } =
      (await req.json().catch(() => ({}))) as {
        atPeriodEnd?: boolean;
        exceptSubscriptionId?: string | null;
      };

    const customerId = await resolveCustomer(admin, stripe, user, false);
    // No Stripe customer → nothing to cancel; let the client proceed anyway.
    if (!customerId) return json({ ok: true, canceled: 0 });

    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 100,
    });
    const billing = new Set(["active", "trialing", "past_due", "unpaid"]);
    let canceled = 0;
    let periodEnd: number | null = null;
    for (const sub of subs.data) {
      if (!billing.has(sub.status)) continue;
      if (exceptSubscriptionId && sub.id === exceptSubscriptionId) continue; // keep the new one
      if (atPeriodEnd) {
        // Already scheduled → just surface its period end, don't re-update.
        if (sub.cancel_at_period_end) {
          periodEnd = sub.current_period_end ?? periodEnd;
          continue;
        }
        const updated = await stripe.subscriptions.update(sub.id, {
          cancel_at_period_end: true,
        });
        periodEnd = updated.current_period_end ?? periodEnd;
      } else {
        await stripe.subscriptions.cancel(sub.id); // immediate
      }
      canceled += 1;
    }

    return json({ ok: true, canceled, periodEnd });
  } catch (err) {
    const message = err instanceof PaymentConfigurationError ? err.message : "Cancellation failed.";
    return json({ error: message }, 500);
  }
});
