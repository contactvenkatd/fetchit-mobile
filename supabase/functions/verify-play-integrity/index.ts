// Supabase Edge Function: verify-play-integrity
// ===========================================================================
// PASTE-INTO-DASHBOARD FILE #3 of 3 (attestation functions).
//
// Verifies a Google Play Integrity Standard-API token produced by the Android
// AppAttestModule.kt (requestIntegrityToken). The Standard token is decoded
// server-side by Google's Play Integrity API, so we:
//   1. Validate + single-use the challenge row (as in verify-app-attest).
//   2. Mint a Google OAuth access token from a service account (RS256 JWT).
//   3. POST the token to playintegrity.googleapis.com …:decodeIntegrityToken.
//   4. Require: requestDetails.requestHash === the challenge we issued,
//      appIntegrity.appRecognitionVerdict === "PLAY_RECOGNIZED", and
//      deviceIntegrity.deviceRecognitionVerdict includes "MEETS_DEVICE_INTEGRITY".
//   5. Record the verdict on the caller's `attested_devices` row.
//
// FAIL POLICY:
//   • DB errors, missing Google config, or a failed Google decode call →
//     FAIL OPEN ({ verified: true }) — infrastructure problems must not block
//     legitimate users (mirrors the DB-error policy).
//   • A token that decodes but fails the verdict/requestHash checks →
//     FAIL CLOSED ({ verified: false }).
//
// Secrets to set (Project Settings → Edge Functions → Secrets):
//   GOOGLE_SERVICE_ACCOUNT_JSON  full JSON of a service account with the
//                                "Play Integrity API" enabled on its project.
//   ANDROID_PACKAGE_NAME         e.g. "com.anonymous.fetchitmobile"
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "npm:@supabase/supabase-js@^2";

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
const ok = () => json({ verified: true });
const closed = (reason: string) => json({ verified: false, reason });

// ---- base64url + PEM helpers ----------------------------------------------
function b64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function pemToBytes(pem: string): Uint8Array {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Sign a Google service-account JWT (RS256) and exchange it for an access token.
async function getGoogleAccessToken(sa: {
  client_email: string;
  private_key: string;
}): Promise<string | null> {
  try {
    const now = Math.floor(Date.now() / 1000);
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/playintegrity",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    };
    const enc = new TextEncoder();
    const unsigned =
      b64url(enc.encode(JSON.stringify(header))) +
      "." +
      b64url(enc.encode(JSON.stringify(claims)));

    const key = await crypto.subtle.importKey(
      "pkcs8",
      pemToBytes(sa.private_key),
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = new Uint8Array(
      await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(unsigned)),
    );
    const jwt = unsigned + "." + b64url(sig);

    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { access_token?: string };
    return data.access_token ?? null;
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  let userId: string | null = null;
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await admin.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }
  } catch {
    /* anonymous is allowed */
  }

  let body: { challengeId?: string; token?: string; requestHash?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return closed("bad_body");
  }
  if (!body.token) return closed("missing_token");

  // --- Validate + consume the challenge (DB errors fail OPEN). ---
  let expectedHash: string | null = null;
  if (body.challengeId) {
    try {
      const { data: row, error } = await admin
        .from("attestation_challenges")
        .select("id, challenge, consumed, expires_at")
        .eq("id", body.challengeId)
        .maybeSingle();
      if (error) return ok();
      if (!row) return closed("no_challenge");
      if (row.consumed) return closed("challenge_used");
      if (new Date(row.expires_at).getTime() < Date.now()) return closed("challenge_expired");
      expectedHash = row.challenge as string;
      await admin.from("attestation_challenges").update({ consumed: true }).eq("id", row.id);
    } catch {
      return ok();
    }
  }

  // The requestHash the device used must equal the challenge we issued.
  if (expectedHash && body.requestHash && body.requestHash !== expectedHash) {
    return closed("request_hash_mismatch");
  }

  // --- Google config. Missing config → FAIL OPEN (rollout-friendly). ---
  const packageName = Deno.env.get("ANDROID_PACKAGE_NAME") ?? "";
  const saRaw = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON") ?? "";
  if (!packageName || !saRaw) return ok();

  let sa: { client_email: string; private_key: string };
  try {
    sa = JSON.parse(saRaw);
  } catch {
    return ok(); // malformed config → fail open
  }

  const accessToken = await getGoogleAccessToken(sa);
  if (!accessToken) return ok(); // couldn't reach Google / bad creds → fail open

  // --- Decode the integrity token via Google. ---
  let payload: {
    requestDetails?: { requestHash?: string; requestPackageName?: string };
    appIntegrity?: { appRecognitionVerdict?: string; packageName?: string };
    deviceIntegrity?: { deviceRecognitionVerdict?: string[] };
  };
  try {
    const res = await fetch(
      `https://playintegrity.googleapis.com/v1/${encodeURIComponent(packageName)}:decodeIntegrityToken`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ integrity_token: body.token }),
      },
    );
    if (!res.ok) return ok(); // Google decode call failed → infra → fail open
    const decoded = (await res.json()) as { tokenPayloadExternal?: typeof payload };
    if (!decoded.tokenPayloadExternal) return closed("no_payload");
    payload = decoded.tokenPayloadExternal;
  } catch {
    return ok(); // network error → fail open
  }

  // --- Evaluate the verdict (token decoded → real signal → FAIL CLOSED). ---
  const rd = payload.requestDetails ?? {};
  if (rd.requestPackageName && rd.requestPackageName !== packageName) {
    return closed("package_mismatch");
  }
  if (expectedHash && rd.requestHash && rd.requestHash !== expectedHash) {
    return closed("request_hash_mismatch");
  }
  if (payload.appIntegrity?.appRecognitionVerdict !== "PLAY_RECOGNIZED") {
    return closed("app_not_recognized");
  }
  const deviceVerdicts = payload.deviceIntegrity?.deviceRecognitionVerdict ?? [];
  if (!deviceVerdicts.includes("MEETS_DEVICE_INTEGRITY")) {
    return closed("device_integrity_failed");
  }

  // --- Record the verdict (DB failure → fail OPEN). One row per user via a
  //     synthetic key_id so re-checks upsert rather than pile up. ---
  try {
    await admin.from("attested_devices").upsert(
      {
        user_id: userId,
        platform: "android",
        key_id: userId ?? crypto.randomUUID(),
        last_verdict: payload as unknown as Record<string, unknown>,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "platform,key_id" },
    );
  } catch {
    /* fail open on write */
  }

  return ok();
});
