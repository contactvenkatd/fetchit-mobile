// Read-only spend for the signed-in user: AI chat and product search dollars
// used / limit / remaining this period (in cents), plus the reset date.
// Never debits.
import { authenticateRequest, quotaStatus, type QuotaSnapshot } from '../_shared/usage-quota.ts';

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "GET" && req.method !== "POST") {
    return failure("method_not_allowed", "Only GET or POST requests are supported.", 405);
  }

  const user = await authenticateRequest(req);
  if (!user) {
    return failure("unauthorized", "Your session is invalid or expired.", 401);
  }

  try {
    const { plan, buckets } = await quotaStatus(user);
    const view = ({ usedCents, limitCents, remainingCents }: QuotaSnapshot) =>
      ({ usedCents, limitCents, remainingCents });
    return json({
      plan,
      periodKey: buckets.ai.periodKey,
      resetsAt: buckets.ai.resetsAt,
      ai: view(buckets.ai),
      zinc: view(buckets.zinc),
    });
  } catch {
    return failure("quota_unavailable", "Usage is temporarily unavailable.", 503);
  }
});
