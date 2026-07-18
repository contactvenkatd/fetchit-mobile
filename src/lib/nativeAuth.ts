// Native auth via the attestation gateway.
//
// Because this project keeps Supabase's project-wide CAPTCHA **on** (so the web
// app's Turnstile protection is untouched), the mobile app cannot call the
// captcha-gated GoTrue endpoints (signUp / signInWithOtp / resend /
// resetPasswordForEmail / signInWithPassword) directly — RN can't render
// Turnstile, so those return `captcha_failed`. Instead, native auth routes
// through the `auth-gateway` edge function, which is gated by App Attest / Play
// Integrity and performs the corresponding server-side operation.
//
// This makes web and native mutually exclusive by construction:
//   • web    → GoTrue + Turnstile (unchanged), and
//   • native → auth-gateway + attestation (here).
//
// Native login is **passwordless**: signup still sets a password (used for web
// login), but native login is email + attestation + one-time code. Password
// verification for an in-app password change is isolated in a service-role-only
// database function called by the gateway.
//
// OTP verification is also sent through the gateway so every native email-auth
// action has the same device-attestation and request-binding checks.
import { buildAttestation, markCurrentKeyUnregistered, type AttestAction } from '@/attestation';
import { supabase } from '@/lib/supabase';
import { canAttemptRecovery } from '@/lib/recovery-policy';

export type NativeAuthResult =
  | { ok: true; session?: { access_token: string; refresh_token: string } }
  | { ok: false; message: string; code?: string };

// Supabase FunctionsHttpError carries the Response on `.context`; the gateway
// puts a human message on `{ error }`. Dig it out, else stay generic.
async function readFnError(error: unknown, fallback: string): Promise<string> {
  const e = error as { message?: string; context?: { json?: () => Promise<unknown> } };
  let message = e?.message || fallback;
  try {
    const body = (await e?.context?.json?.()) as { error?: string } | undefined;
    if (body?.error) message = body.error;
  } catch {
    /* keep the generic message */
  }
  return message;
}

const DEVICE_UNVERIFIED =
  "We couldn't verify this device. App Attest requires a physical device — this won't work on a Simulator.";

async function invokeGateway(
  action:
    | 'signup'
    | 'login'
    | 'resend'
    | 'verify_otp'
    | 'forgot_password'
    | 'change_password',
  extra: Record<string, unknown>,
  attestAction: AttestAction,
  recoveryAttempts = 0,
): Promise<NativeAuthResult> {
  // Build (but don't verify) the attestation — the gateway verifies it.
  const email = typeof extra.email === 'string' ? extra.email.trim().toLowerCase() : '';
  const att = await buildAttestation(attestAction, email);
  if (att.status !== 'ok') {
    // 'skipped' (simulator / unsupported / server unreachable) and 'failed'
    // both mean we can't present a device proof → the gateway would reject.
    return { ok: false, message: DEVICE_UNVERIFIED, code: 'attestation_unavailable' };
  }

  const { data, error } = await supabase.functions.invoke('auth-gateway', {
    body: {
      action,
      ...extra,
      platform: att.payload.platform,
      attestation: att.payload.verify,
    },
  });

  if (error) {
    let code: string | undefined;
    try {
      const response = (error as { context?: Response }).context;
      code = (await response?.clone().json() as { code?: string } | undefined)?.code;
    } catch { /* retain generic error */ }
    if (code === 'device_not_registered' && canAttemptRecovery(recoveryAttempts)) {
      await markCurrentKeyUnregistered();
      return invokeGateway(action, extra, attestAction, recoveryAttempts + 1);
    }
    return { ok: false, message: await readFnError(error, 'Something went wrong. Please try again.'), code };
  }
  if (data?.error) {
    if (data.code === 'device_not_registered' && canAttemptRecovery(recoveryAttempts)) {
      await markCurrentKeyUnregistered();
      return invokeGateway(action, extra, attestAction, recoveryAttempts + 1);
    }
    return { ok: false, message: data.error as string, code: data.code as string | undefined };
  }

  // Server confirmed → persist the iOS "registered" flag (no-op otherwise).
  await att.onVerified();
  return { ok: true, session: data?.session };
}

/** Create the account (server-side, attestation-gated) and email the confirm code. */
export function gatewaySignup(email: string, password: string): Promise<NativeAuthResult> {
  return invokeGateway('signup', { email, password }, 'signup');
}

/** Email a login code to an existing account (passwordless + attestation-gated). */
export function gatewayLogin(email: string): Promise<NativeAuthResult> {
  return invokeGateway('login', { email }, 'login');
}

/** Re-send the current flow's one-time code (used by the OTP screen's resend). */
export function gatewayResend(email: string): Promise<NativeAuthResult> {
  return invokeGateway('resend', { email }, 'resend');
}

export async function gatewayVerifyOtp(email: string, token: string): Promise<NativeAuthResult> {
  return invokeGateway('verify_otp', { email, token }, 'verify_otp');
}

/** Generate and email a recovery link without revealing whether the account exists. */
export function gatewayForgotPassword(email: string): Promise<NativeAuthResult> {
  return invokeGateway('forgot_password', { email }, 'forgot_password');
}

/** Verify the current password and replace it, entirely behind the attested gateway. */
export function gatewayChangePassword(
  email: string,
  currentPassword: string,
  newPassword: string,
): Promise<NativeAuthResult> {
  return invokeGateway(
    'change_password',
    { email, current_password: currentPassword, new_password: newPassword },
    'change_password',
  );
}
