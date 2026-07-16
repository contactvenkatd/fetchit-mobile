// Supabase Edge Function: verify-app-attest
// ===========================================================================
// PASTE-INTO-DASHBOARD FILE #2 of 3 (attestation functions).
//
// Verifies Apple App Attest artifacts produced by DCAppAttestService on iOS.
// Handles BOTH steps of the handshake, chosen by which field is present:
//   • { attestation } → ONE-TIME registration. Full verification per Apple's
//     "Validating Apps That Connect to Your Server" doc: CBOR decode, x5c chain
//     to the Apple App Attest Root CA, nonce binding (SHA256(authData ||
//     SHA256(challenge)) matches the cert's 1.2.840.113635.100.8.2 extension),
//     key-id = SHA256(pubkey), rpId hash = SHA256(appId), counter 0, aaguid.
//     On success the device's public key is stored in `attested_devices`.
//   • { assertion, requestData, signCount } → PER-REQUEST. Verifies the ECDSA
//     signature over (authenticatorData || SHA256(requestData)) with the stored
//     public key, checks rpId hash, and requires a strictly increasing counter.
//
// FAIL POLICY: configuration, database, identity, replay, structural, and
// cryptographic failures all fail closed.
//
// Secrets to set in the dashboard (Project Settings → Edge Functions → Secrets):
//   APPLE_APP_ID      exactly "PV7JV2P9Q8.ai.compreo.fetchit"
//   APPLE_ATTEST_ENV  exactly "production" or "development"
// (SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically.)

import { createClient } from "npm:@supabase/supabase-js@^2";
import { decode as cborDecode } from "npm:cbor-x@^1.5";
import * as x509 from "npm:@peculiar/x509@^1.11";
import {
  canonicalRequest,
  expectedAaguid,
  validateAppleConfiguration,
  validateAssertionCounter,
  validateCertificateChain,
  validateNonce,
  validateRegistrationIdentity,
} from "../_shared/app-attest-policy.mjs";

x509.cryptoProvider.set(crypto as unknown as Crypto);

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

// ---- byte helpers ----------------------------------------------------------
function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function bytesToB64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
function concat(...arrays: Uint8Array[]): Uint8Array {
  const len = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len);
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}
async function sha256(bytes: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// DER-encoded ECDSA signature → raw r||s (64 bytes) for WebCrypto verify.
function derToRawEcdsa(der: Uint8Array): Uint8Array {
  // SEQUENCE { INTEGER r, INTEGER s }
  let i = 0;
  if (der[i++] !== 0x30) throw new Error("bad DER");
  if (der[i] & 0x80) i += 1 + (der[i] & 0x7f); else i += 1; // seq length
  const readInt = (): Uint8Array => {
    if (der[i++] !== 0x02) throw new Error("bad DER int");
    let len = der[i++];
    let val = der.slice(i, i + len);
    i += len;
    // strip leading zero, left-pad to 32
    while (val.length > 32 && val[0] === 0x00) val = val.slice(1);
    const out = new Uint8Array(32);
    out.set(val, 32 - val.length);
    return out;
  };
  const r = readInt();
  const s = readInt();
  return concat(r, s);
}

// The Apple App Attest Root CA, fetched once per cold start (avoids embedding a
// hand-transcribed PEM). Cached for the lifetime of the isolate.
let appleRootPromise: Promise<x509.X509Certificate | null> | null = null;
function appleRoot(): Promise<x509.X509Certificate | null> {
  if (!appleRootPromise) {
    appleRootPromise = (async () => {
      try {
        const res = await fetch(
          "https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem",
        );
        const pem = await res.text();
        return new x509.X509Certificate(pem);
      } catch {
        return null;
      }
    })();
  }
  return appleRootPromise;
}

// ---- authenticatorData layout ---------------------------------------------
// rpIdHash(32) | flags(1) | counter(4 BE) | [attestedCredentialData...]
//   attestedCredentialData = aaguid(16) | credIdLen(2 BE) | credId(credIdLen)
function parseAuthData(authData: Uint8Array) {
  const rpIdHash = authData.slice(0, 32);
  const counter =
    (authData[33] << 24) | (authData[34] << 16) | (authData[35] << 8) | authData[36];
  let aaguid: Uint8Array | null = null;
  let credId: Uint8Array | null = null;
  if (authData.length >= 55) {
    aaguid = authData.slice(37, 53);
    const credIdLen = (authData[53] << 8) | authData[54];
    credId = authData.slice(55, 55 + credIdLen);
  }
  return { rpIdHash, counter: counter >>> 0, aaguid, credId };
}

const APP_ID = Deno.env.get("APPLE_APP_ID");
const ATTEST_ENV = Deno.env.get("APPLE_ATTEST_ENV");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const configurationError = validateAppleConfiguration(APP_ID, ATTEST_ENV);
  if (configurationError) return closed(configurationError);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Optional caller identity — used to own the attested_devices row.
  let userId: string | null = null;
  try {
    const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (token) {
      const { data } = await admin.auth.getUser(token);
      userId = data?.user?.id ?? null;
    }
  } catch {
    /* anonymous device registration is allowed */
  }

  let body: {
    challengeId?: string;
    keyId?: string;
    attestation?: string;
    assertion?: string;
    requestData?: string;
    signCount?: number;
    action?: string;
    email?: string;
    platform?: string;
  };
  try {
    body = await req.json();
  } catch {
    return closed("bad_body");
  }
  if (!body.keyId) return closed("missing_key_id");
  if (body.platform !== "ios") return closed("wrong_platform");
  if (!body.challengeId || !body.action) return closed("missing_challenge_context");
  const email = body.action === "checkout" ? null : (body.email ?? "").trim().toLowerCase();

  // --- Validate + atomically consume the challenge. Every database,
  //     missing, expired, or replay condition fails closed. ---
  let challengeBytes: Uint8Array | null = null;
  if (body.challengeId) {
    try {
      const { data, error } = await admin.rpc("consume_attestation_challenge", {
        p_id: body.challengeId, p_platform: "ios", p_action: body.action,
        p_email_normalized: email,
      });
      if (error) return closed("challenge_database_error");
      const row = Array.isArray(data) ? data[0] : null;
      if (!row) return closed("challenge_invalid_or_used");
      challengeBytes = b64ToBytes(row.challenge as string);
    } catch {
      return closed("challenge_database_error");
    }
  }

  try {
    if (body.attestation) {
      return await verifyAttestation(admin, body, challengeBytes, userId);
    }
    if (body.assertion && body.requestData) {
      const canonical = canonicalRequest(body.action, body.challengeId, email, "ios");
      if (body.requestData !== canonical) return closed("request_binding_mismatch");
      return await verifyAssertion(admin, body);
    }
    return closed("nothing_to_verify");
  } catch (e) {
    // Any crypto/structural error → fail CLOSED.
    return closed(`error:${(e as Error).message}`);
  }
});

// ---------------------------------------------------------------------------
async function verifyAttestation(
  admin: ReturnType<typeof createClient>,
  body: { keyId?: string; attestation?: string },
  challengeBytes: Uint8Array | null,
  userId: string | null,
): Promise<Response> {
  if (!challengeBytes) return closed("no_challenge_for_attestation");

  const obj = cborDecode(b64ToBytes(body.attestation!)) as {
    fmt: string;
    attStmt: { x5c: Uint8Array[]; receipt?: Uint8Array };
    authData: Uint8Array;
  };
  if (obj.fmt !== "apple-appattest") return closed("bad_fmt");

  const x5c = obj.attStmt?.x5c;
  if (!Array.isArray(x5c) || x5c.length !== 2) return closed("bad_x5c");

  const leaf = new x509.X509Certificate(new Uint8Array(x5c[0]));
  const intermediate = new x509.X509Certificate(new Uint8Array(x5c[1]));
  const root = await appleRoot();
  if (!root) return closed("no_root_ca"); // couldn't fetch Apple root → fail closed

  // Chain: leaf <- intermediate <- pinned Apple root, including validity dates
  // and the root's self-signature.
  const now = new Date();
  const validNow = [leaf, intermediate, root].every((c) => c.notBefore <= now && c.notAfter >= now);
  const chainError = validateCertificateChain(
    validNow,
    await leaf.verify({ publicKey: intermediate.publicKey }),
    await intermediate.verify({ publicKey: root.publicKey }),
    await root.verify({ publicKey: root.publicKey }),
  );
  if (chainError) return closed(chainError);

  // nonce = SHA256(authData || SHA256(challenge)); must match the cert extension.
  const clientDataHash = await sha256(challengeBytes);
  const expectedNonce = await sha256(concat(obj.authData, clientDataHash));
  const ext = leaf.getExtension("1.2.840.113635.100.8.2");
  if (!ext) return closed("no_nonce_ext");
  const extBytes = new Uint8Array(ext.value);
  // The extension value is DER: SEQUENCE { [1] { OCTET STRING nonce(32) } }.
  // The 32-byte nonce is the trailing octet string.
  const extNonce = extBytes.slice(-32);
  const nonceError = validateNonce(extNonce, expectedNonce);
  if (nonceError) return closed(nonceError);

  // key id = base64(SHA256(uncompressed EC public key point)).
  const spki = new Uint8Array(leaf.publicKey.rawData);
  const pubPoint = spki.slice(-65); // P-256 uncompressed point (0x04 || X || Y)
  const computedKeyId = bytesToB64(await sha256(pubPoint));

  // authData checks.
  const { rpIdHash, counter, aaguid, credId } = parseAuthData(obj.authData);
  if (counter !== 0) return closed("counter_not_zero");
  if (credId && !timingSafeEqual(credId, await sha256(pubPoint))) {
    return closed("cred_id_mismatch");
  }
  if (!aaguid || !credId) return closed("missing_attested_credential_data");
  if (aaguid) {
    const gotAaguid = new TextDecoder("latin1").decode(aaguid);
    if (gotAaguid !== expectedAaguid(ATTEST_ENV)) return closed("bad_aaguid");
  }
  const expectRpId = await sha256(new TextEncoder().encode(APP_ID!));
  const identityError = validateRegistrationIdentity({
    aaguid: new TextDecoder("latin1").decode(aaguid),
    environment: ATTEST_ENV,
    rpIdHash,
    expectedRpIdHash: expectRpId,
    keyId: body.keyId,
    expectedKeyId: computedKeyId,
  });
  if (identityError) return closed(identityError);

  // Persist the device. Storage failure fails closed.
  try {
    const { error } = await admin.from("attested_devices").insert(
      {
        user_id: userId,
        platform: "ios",
        key_id: body.keyId,
        public_key: bytesToB64(spki),
        receipt: obj.attStmt.receipt ? bytesToB64(new Uint8Array(obj.attStmt.receipt)) : null,
        sign_count: 0,
        updated_at: new Date().toISOString(),
      },
    );
    if (error) return closed("device_storage_failed");
  } catch {
    return closed("device_storage_failed");
  }
  return ok();
}

// ---------------------------------------------------------------------------
async function verifyAssertion(
  admin: ReturnType<typeof createClient>,
  body: { keyId?: string; assertion?: string; requestData?: string },
): Promise<Response> {
  // Load the registered device. Database errors and absence both fail closed.
  let device: { public_key: string | null; sign_count: number | null; id: string } | null = null;
  try {
    const { data, error } = await admin
      .from("attested_devices")
      .select("id, public_key, sign_count")
      .eq("platform", "ios")
      .eq("key_id", body.keyId!)
      .maybeSingle();
    if (error) return closed("device_database_error");
    device = (data as typeof device) ?? null;
  } catch {
    return closed("device_database_error");
  }
  if (!device || !device.public_key) return closed("device_not_registered");

  const obj = cborDecode(b64ToBytes(body.assertion!)) as {
    signature: Uint8Array;
    authenticatorData: Uint8Array;
  };
  const authData = new Uint8Array(obj.authenticatorData);
  const signature = derToRawEcdsa(new Uint8Array(obj.signature));

  // WebCrypto ECDSA(SHA-256) hashes the message internally, so we pass the
  // message (authenticatorData || clientDataHash); its SHA-256 IS Apple's nonce.
  const clientDataHash = await sha256(new TextEncoder().encode(body.requestData!));
  const signedMessage = concat(authData, clientDataHash);

  const spki = b64ToBytes(device.public_key);
  const key = await crypto.subtle.importKey(
    "spki",
    spki,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["verify"],
  );
  const sigOk = await crypto.subtle.verify(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    signature,
    signedMessage,
  );
  if (!sigOk) return closed("bad_signature");

  const { rpIdHash, counter } = parseAuthData(authData);
  const expectRpId = await sha256(new TextEncoder().encode(APP_ID!));
  if (!timingSafeEqual(rpIdHash, expectRpId)) return closed("bad_rp_id");
  // Counter must strictly increase (replay / cloned-key protection).
  const prev = device.sign_count ?? 0;
  const counterError = validateAssertionCounter(prev, counter);
  if (counterError) return closed(counterError);

  // Atomically advance the stored counter. Database errors and races fail closed.
  try {
    const { data, error } = await admin.rpc("advance_attestation_counter", {
      p_device_id: device.id, p_previous: prev, p_next: counter,
    });
    if (error || data !== true) return closed("counter_race_or_database_error");
  } catch {
    return closed("counter_database_error");
  }
  return ok();
}
