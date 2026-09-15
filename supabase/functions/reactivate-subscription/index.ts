// Supabase Edge Function: reactivate-subscription
// ---------------------------------------------------------------------------
// Runs server-side (Deno) where the Stripe SECRET key is safe. Undoes a
// scheduled cancellation, end to end:
//   1. Authenticates the caller from their Supabase JWT (Verify JWT ON).
//   2. Finds the caller's Stripe subscription(s) via their stored
//      `stripe_customer_id` (we persist the customer, not a bare sub id, in
//      user_metadata — the customer reliably resolves the active sub even if it
//      was replaced during a plan change).
//   3. Reactivates in Stripe by clearing `cancel_at_period_end`.
//   4. Restores the plan in metadata — clears `plan_cancels_at` so getPlan()
//      keeps returning the paid plan (the `plan` field still holds it, so this
//      puts the user back on their previous plan).
//   5. If the family was scheduled to disband (a Max owner with members whose
//      `pending_disband_at` is set), calls `family-manage` `unschedule` to
//      restore those members' access.
//
// Deploy:   supabase functions deploy reactivate-subscription   (Verify JWT ON)
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

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // ----- 1. Authenticate the caller from their JWT -----
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "Not authenticated." }, 401);

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
    const { data: userData, error: userErr } = await admin.auth.getUser(token);
    if (userErr || !userData?.user) {
      return json({ error: "Not authenticated." }, 401);
    }
    const user = userData.user;
    const meta = (user.user_metadata as Record<string, unknown>) ?? {};

    // ----- Per-IP rate limit (60 requests / hour) -----
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const { data: okIp } = await admin.rpc("rl_check", { p_bucket: `ip:${ip}`, p_limit: 60, p_window_seconds: 3600 });
    if (okIp === false) return json({ error: "Too many requests. Try again later." }, 429);

    // ----- 2 + 3. Reactivate the Stripe subscription(s) -----
    const customerId = await resolveCustomer(admin, stripe, user, false);
    let reactivated = 0;
    if (customerId) {
      const subs = await stripe.subscriptions.list({
        customer: customerId,
        status: "all",
        limit: 100,
      });
      for (const sub of subs.data) {
        if (!sub.cancel_at_period_end) continue;
        if (sub.status === "canceled") continue; // fully canceled → can't revive
        await stripe.subscriptions.update(sub.id, {
          cancel_at_period_end: false,
        });
        reactivated += 1;
      }
    }

    // ----- 4. Restore the plan in metadata (clear the scheduled cancellation) -----
    // The `plan` field still holds the paid plan, so clearing plan_cancels_at
    // puts the user back on their previous plan.
    await admin.auth.admin.updateUserById(user.id, {
      user_metadata: { ...meta, plan_cancels_at: null },
    });
    const plan = (meta.plan as string) ?? null;

    // ----- 5. Restore family members if a disband was scheduled -----
    let familyRestored = false;
    if (String(meta.plan ?? "").toLowerCase() === "max") {
      const { data: scheduled } = await admin
        .from("family_members")
        .select("id")
        .eq("owner_id", user.id)
        .not("pending_disband_at", "is", null)
        .limit(1);
      if (scheduled && scheduled.length > 0) {
        // Call family-manage `unschedule` (it re-auths the owner from this same
        // JWT and clears family_disband_at on every member). Best-effort — a
        // reactivated subscription shouldn't fail if this call hiccups.
        try {
          await fetch(`${SUPABASE_URL}/functions/v1/family-manage`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${token}`,
              apikey: SERVICE_ROLE_KEY,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ action: "unschedule" }),
          });
          familyRestored = true;
        } catch (_) {
          // ignore — Stripe + plan are already restored
        }
      }
    }

    return json({ ok: true, reactivated, plan, familyRestored });
  } catch (err) {
    const message = err instanceof PaymentConfigurationError ? err.message : "Reactivation failed.";
    return json({ error: message }, 500);
  }
});
