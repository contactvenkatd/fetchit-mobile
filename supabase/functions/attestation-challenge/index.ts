// Supabase Edge Function: attestation-challenge
// ===========================================================================
// PASTE-INTO-DASHBOARD FILE #1 of 3 (attestation functions).
//
// Mints a short-lived, single-use challenge (nonce) for the device to attest
// against. Called first by src/attestation.ts on iOS and Android. Auth is
// OPTIONAL: if a Bearer JWT is present the challenge (and any device attested
// with it) is associated with that user; during signup there's no session yet,
// so the challenge is anonymous and the device is associated on the next
// authenticated attestation.
//
// Returns: { id, challenge }  — `challenge` is 32 random bytes, base64.
//
// FAIL-OPEN: if the DB insert fails we still return a challenge. The verify
// functions also fail open when they can't read it back, so a database outage
// degrades to "attestation effectively bypassed" rather than "all auth/checkout
// blocked".
//
// Deploy:  create a new function named `attestation-challenge` in the Supabase
//          dashboard and paste this file as its index.ts.
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

function base64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // 32 random bytes → the nonce the device signs / echoes back.
  const random = new Uint8Array(32);
  crypto.getRandomValues(random);
  const challenge = base64(random);

  let platform: string | null = null;
  let action: string | null = null;
  try {
    const body = (await req.json().catch(() => ({}))) as {
      platform?: string;
      action?: string;
    };
    platform = body.platform === "ios" || body.platform === "android"
      ? body.platform
      : null;
    action = typeof body.action === "string" ? body.action : null;
  } catch {
    /* body is optional */
  }

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional: associate the challenge with the caller if they're authenticated.
  let userId: string | null = null;
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await admin.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }
  } catch {
    /* anonymous challenge is fine */
  }

  // Persist the challenge so verify-* can confirm and single-use it. FAIL-OPEN:
  // if this insert errors we still return the challenge (see header note).
  try {
    const { data, error } = await admin
      .from("attestation_challenges")
      .insert({ user_id: userId, challenge, platform, action })
      .select("id")
      .single();

    if (!error && data?.id) {
      return json({ id: data.id, challenge });
    }
  } catch {
    /* fall through to the fail-open response */
  }

  // DB unavailable — return a synthetic id so the client flow proceeds; the
  // verify function will not find a row and will itself fail open.
  return json({ id: crypto.randomUUID(), challenge });
});
