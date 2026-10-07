// Internal operations status for FetchIt admins: the Zinc wallet as last read
// by zinc-balance-monitor, and how often it has run low. Read-only; it reads
// the balance_topup_events log rather than calling Zinc.
//
// Admin = app_metadata.fetchit_admin === true. app_metadata is server-only
// (clients can't write it); grant it in the SQL editor:
//   update auth.users set raw_app_meta_data = raw_app_meta_data || '{"fetchit_admin": true}'
//   where email = '<admin email>';
import { authenticateRequest, serviceClient } from '../_shared/usage-quota.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": Deno.env.get("ALLOWED_ORIGIN") ?? "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const failure = (code: string, message: string, status: number) =>
  json({ error: { code, message } }, status);

const DAY_MS = 86_400_000;
// Three missed 15-minute runs.
const STALE_AFTER_MS = 45 * 60_000;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return failure("method_not_allowed", "Only GET or POST requests are supported.", 405);
  }

  const user = await authenticateRequest(req);
  if (!user) return failure("unauthorized", "Your session is invalid or expired.", 401);
  if (user.app_metadata?.fetchit_admin !== true) {
    return failure("forbidden", "Operations status is restricted to admins.", 403);
  }

  const admin = serviceClient();
  if (!admin) return failure("status_unavailable", "Operations status is unavailable.", 503);

  try {
    const events = () => admin.from("balance_topup_events");
    const since30d = new Date(Date.now() - 30 * DAY_MS).toISOString();
    const since24h = new Date(Date.now() - DAY_MS).toISOString();
    const [latest, lastAlert, alerts30d, checks24h, low24h] = await Promise.all([
      events().select("checked_at, key_mode, balance_cents, spendable_cents, threshold_cents, below_threshold, read_error")
        .eq("provider", "zinc").order("checked_at", { ascending: false }).limit(1).maybeSingle(),
      events().select("checked_at, alert_reason").eq("provider", "zinc").eq("alert_sent", true)
        .order("checked_at", { ascending: false }).limit(1).maybeSingle(),
      events().select("id", { count: "exact", head: true }).eq("provider", "zinc").eq("alert_sent", true)
        .gte("checked_at", since30d),
      events().select("id", { count: "exact", head: true }).eq("provider", "zinc").gte("checked_at", since24h),
      events().select("id", { count: "exact", head: true }).eq("provider", "zinc").eq("below_threshold", true)
        .gte("checked_at", since24h),
    ]);
    for (const result of [latest, lastAlert, alerts30d, checks24h, low24h]) {
      if (result.error) throw result.error;
    }

    const check = latest.data;
    const lastCheckedAt = check?.checked_at ?? null;
    const lastAlertAt = lastAlert.data?.checked_at ?? null;
    return json({
      zinc: {
        lastCheckedAt,
        monitorStale: !lastCheckedAt || Date.now() - Date.parse(lastCheckedAt) > STALE_AFTER_MS,
        keyMode: check?.key_mode ?? null,
        balanceCents: check?.balance_cents ?? null,
        spendableCents: check?.spendable_cents ?? null,
        thresholdCents: check?.threshold_cents ?? null,
        belowThreshold: check?.below_threshold ?? null,
        readError: check?.read_error ?? null,
        lastAlertAt,
        lastAlertReason: lastAlert.data?.alert_reason ?? null,
        daysSinceLastAlert: lastAlertAt ? Math.floor((Date.now() - Date.parse(lastAlertAt)) / DAY_MS) : null,
        alertsLast30Days: alerts30d.count ?? 0,
        checksLast24Hours: checks24h.count ?? 0,
        lowChecksLast24Hours: low24h.count ?? 0,
      },
    });
  } catch {
    return failure("status_unavailable", "Operations status is unavailable.", 503);
  }
});
