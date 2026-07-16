import { createClient } from "npm:@supabase/supabase-js@^2";

const headers = { "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
const ACTIONS = new Set(["signup", "login", "resend", "verify_otp", "checkout"]);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function requiredEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`missing_${name.toLowerCase()}`);
  return value;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const body = await req.json() as { platform?: string; action?: string; email?: string };
    if (!['ios', 'android'].includes(body.platform ?? '') || !ACTIONS.has(body.action ?? '')) {
      return json({ error: "invalid_request" }, 400);
    }
    const email = body.action === 'checkout' ? null : (body.email ?? '').trim().toLowerCase();
    if (email !== null && !EMAIL_RE.test(email)) return json({ error: "invalid_email" }, 400);
    const admin = createClient(requiredEnv("SUPABASE_URL"), requiredEnv("SUPABASE_SERVICE_ROLE_KEY"));
    let userId: string | null = null;
    const token = (req.headers.get("Authorization") ?? '').replace(/^Bearer\s+/i, '');
    if (token) {
      const { data, error } = await admin.auth.getUser(token);
      if (error) return json({ error: "invalid_authorization" }, 401);
      userId = data.user?.id ?? null;
    }
    const bytes = new Uint8Array(32); crypto.getRandomValues(bytes);
    const challenge = btoa(String.fromCharCode(...bytes));
    const { data, error } = await admin.from("attestation_challenges").insert({
      user_id: userId, challenge, platform: body.platform, action: body.action,
      email_normalized: email,
    }).select("id").single();
    if (error || !data?.id) return json({ error: "challenge_storage_failed" }, 503);
    return json({ id: data.id, challenge });
  } catch {
    return json({ error: "challenge_unavailable" }, 503);
  }
});
