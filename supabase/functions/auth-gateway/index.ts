// Supabase Edge Function: auth-gateway
// ===========================================================================
// PASTE-INTO-DASHBOARD FILE #4 (attestation functions) — the NATIVE auth path.
//
// The project keeps Supabase's project-wide CAPTCHA ON, which fully protects the
// WEB app (GoTrue + Turnstile, unchanged). Native RN can't render Turnstile, so
// it can't call the captcha-gated GoTrue endpoints (signUp / signInWithOtp /
// resend). This function is the native replacement: it is gated by App Attest /
// Play Integrity instead of Turnstile, and mints the email one-time code
// server-side via the ADMIN API (captcha-exempt), emailing it directly.
//
// The two paths are mutually exclusive by construction:
//   • WEB    → GoTrue + Turnstile (this function is never called), and
//   • NATIVE → this gateway + attestation (no Turnstile).
// A request here with no attestation is REJECTED (fail-closed).
//
// Actions (body.action):
//   • "signup" { email, password, attestation }
//       → reject if the email already exists; else admin.createUser (unconfirmed)
//         + email a magic-link OTP. Client verifies with verifyOtp(type:"email").
//   • "login"  { email, attestation }         (passwordless)
//       → require the email to exist; email a magic-link OTP.
//   • "resend" { email, attestation }
//       → re-email a magic-link OTP for the current flow.
//
// Native login is PASSWORDLESS: signup still stores a password (for web login),
// but there is no captcha-free way to verify a password server-side, so native
// login is email OTP + device attestation.
//
// Secrets (Project Settings → Edge Functions → Secrets):
//   RESEND_API_KEY   Resend key for sending the OTP email (same as send-email).
// Requires the SQL helpers email_exists.sql + rate_limits.sql to be installed,
// and the attestation-challenge / verify-app-attest / verify-play-integrity
// functions to be deployed. (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are
// injected automatically.)

import { createClient } from "npm:@supabase/supabase-js@^2";

const RESEND_API_URL = "https://api.resend.com/emails";
const FROM = "FetchIt 🐕 <onboarding@resend.dev>";

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

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Branded OTP email (self-contained; does not touch the send-email function).
function otpEmailHtml(code: string): string {
  return `
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation"
         style="background:#FFFDF7;padding:32px 0;font-family:'Nunito',Arial,sans-serif;">
    <tr><td align="center">
      <table width="480" cellpadding="0" cellspacing="0" role="presentation"
             style="background:#FFFFFF;border-radius:24px;overflow:hidden;
                    box-shadow:0 20px 50px rgba(26,26,26,0.12);">
        <tr><td style="background:#1A1A1A;padding:24px 32px;">
          <span style="display:inline-block;background:#FFD700;border-radius:14px;
                       padding:8px 12px;font-size:22px;line-height:1;">🐕</span>
          <span style="color:#FFFFFF;font-weight:800;font-size:22px;
                       vertical-align:middle;margin-left:10px;">FetchIt</span>
        </td></tr>
        <tr><td style="padding:36px 32px 8px;">
          <h1 style="margin:0 0 12px;color:#1A1A1A;font-size:26px;font-weight:800;">
            Your verification code</h1>
          <p style="margin:0 0 20px;color:#555;font-size:16px;line-height:1.6;">
            Enter this code to continue. It expires shortly and can be used once.</p>
          <div style="font-size:34px;font-weight:800;letter-spacing:10px;
                      color:#1A1A1A;background:#FFFDF7;border:1px solid #F0ECDF;
                      border-radius:14px;padding:18px 12px;text-align:center;">
            ${code}</div>
          <p style="margin:20px 0 0;color:#999;font-size:13px;">
            Didn't request this? You can safely ignore this email.</p>
        </td></tr>
      </table>
    </td></tr>
  </table>`;
}

async function sendOtpEmail(email: string, code: string): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) throw new Error("Email is not configured (RESEND_API_KEY missing).");
  const res = await fetch(RESEND_API_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: FROM,
      to: email,
      subject: "Your FetchIt verification code 🐕",
      html: otpEmailHtml(code),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body?.message || body?.error || `Resend error ${res.status}`);
  }
}

// Mint a single-use email OTP (magic-link type → verifyOtp type "email") for an
// EXISTING user and email it. Used by signup (after createUser), login, resend.
async function mintAndEmailOtp(
  admin: ReturnType<typeof createClient>,
  email: string,
): Promise<void> {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw error;
  const otp = (data?.properties as { email_otp?: string } | undefined)?.email_otp;
  if (!otp) throw new Error("Could not generate a verification code.");
  await sendOtpEmail(email, otp);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = (await req.json().catch(() => ({}))) as {
      action?: string;
      email?: string;
      password?: string;
      platform?: string;
      attestation?: Record<string, unknown> | null;
    };

    const action = body.action;
    const email = (body.email ?? "").trim().toLowerCase();
    if (!action || !["signup", "login", "resend", "verify_otp"].includes(action)) {
      return json({ error: "Unknown action." }, 400);
    }
    if (!EMAIL_RE.test(email)) return json({ error: "Please enter a valid email." }, 400);

    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // ---- Rate limit (defense-in-depth; attestation is the primary gate). ----
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    const [{ data: okIp, error: ipRateError }, { data: okEmail, error: emailRateError }] = await Promise.all([
      admin.rpc("rl_check", { p_bucket: `authgw:ip:${ip}`, p_limit: 30, p_window_seconds: 3600 }),
      admin.rpc("rl_check", { p_bucket: `authgw:email:${email}`, p_limit: 6, p_window_seconds: 3600 }),
    ]);
    if (ipRateError || emailRateError) {
      return json({ error: "Security service unavailable.", code: "rate_limit_unavailable" }, 503);
    }
    if (okIp !== true || okEmail !== true) {
      return json({ error: "Too many requests. Please try again later.", code: "rate_limited" }, 429);
    }

    // ---- FAIL-CLOSED: a native request MUST carry a valid attestation. ----
    if (!body.attestation) {
      return json({ error: "Device verification is required.", code: "no_attestation" }, 403);
    }
    if (body.platform !== "ios" && body.platform !== "android") {
      return json({ error: "Device verification is required.", code: "bad_platform" }, 403);
    }
    if (body.attestation.action !== action || body.attestation.email !== email ||
        body.attestation.platform !== body.platform) {
      return json({ error: "Attestation request did not match.", code: "request_binding_mismatch" }, 403);
    }
    const verifyFn = body.platform === "android" ? "verify-play-integrity" : "verify-app-attest";
    const { data: v, error: ve } = await admin.functions.invoke(verifyFn, { body: body.attestation });
    if (ve || v?.verified !== true) {
      return json({ error: "This device could not be verified.", code: v?.reason ?? "attestation_failed" }, 403);
    }

    if (action === "verify_otp") {
      const token = typeof (body as { token?: unknown }).token === "string"
        ? (body as { token: string }).token : "";
      if (!/^\d{8}$/.test(token)) return json({ error: "Invalid verification code." }, 400);
      const { data, error } = await admin.auth.verifyOtp({ email, token, type: "email" });
      if (error || !data.session) return json({ error: "That code is incorrect or expired." }, 400);
      return json({ ok: true, session: data.session });
    }

    // ---- Perform the auth action (all captcha-exempt admin-API calls). ----
    if (action === "signup") {
      const { data: exists } = await admin.rpc("email_exists", { p_email: email });
      if (exists === true) {
        return json(
          { error: "An account already exists with this email. Please sign in.", code: "already_registered" },
          400,
        );
      }
      const password = body.password ?? "";
      if (password.length < 8) {
        return json({ error: "Password must be at least 8 characters.", code: "weak_password" }, 400);
      }
      const { error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: false,
      });
      if (createErr) {
        // Race: created between the check and here → treat as already registered.
        return json(
          { error: "An account already exists with this email. Please sign in.", code: "already_registered" },
          400,
        );
      }
      await mintAndEmailOtp(admin, email);
      return json({ ok: true });
    }

    // login / resend → require an existing account, then email a fresh OTP.
    const { data: exists } = await admin.rpc("email_exists", { p_email: email });
    if (exists !== true) {
      return json(
        { error: "No account found for this email. Create one first.", code: "no_account" },
        404,
      );
    }
    await mintAndEmailOtp(admin, email);
    return json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Auth failed.";
    return json({ error: message }, 500);
  }
});
