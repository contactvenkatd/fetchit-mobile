// Device attestation — the client half of App Attest (iOS) / Play Integrity
// (Android). RN-native (keyed off `Platform.OS`, a local Expo native module in
// `modules/app-attest`), NOT Capacitor.
//
// Two consumers:
//   • `attest(action)` — self-contained: runs the handshake AND calls the
//     verify-* edge function itself, returning { status, token }. Used by the
//     CHECKOUT gate (delivery.tsx), which verifies client-side.
//   • `buildAttestation(action)` — runs the handshake but does NOT verify; it
//     returns the raw payload for the AUTH GATEWAY to verify server-side
//     (see src/lib/nativeAuth.ts). This matters because a challenge is
//     single-use: whoever calls verify-* consumes it, so for the gateway flow
//     only the gateway may verify.
//
// Fail policy is unchanged: 'skipped' (web / unsupported / simulator / server
// unreachable) never blocks; 'failed' is a definitive attestation failure.
import { requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import type { AppAttestNativeModule } from '../modules/app-attest';
import { supabase } from '@/lib/supabase';
import { canAttemptRecovery } from '@/lib/recovery-policy';

const AppAttest = requireOptionalNativeModule<AppAttestNativeModule>('AppAttest');

export type AttestAction =
  | 'signup'
  | 'login'
  | 'resend'
  | 'verify_otp'
  | 'forgot_password'
  | 'change_password'
  | 'checkout';
export type AttestStatus = 'ok' | 'skipped' | 'failed';
export type AttestPlatform = 'ios' | 'android' | 'web';

export type AttestResult = {
  status: AttestStatus;
  platform: AttestPlatform;
  token: string | null;
};

/** The exact body a verify-* edge function expects for this attestation. */
export type AttestationPayload = {
  platform: 'ios' | 'android';
  verify: Record<string, unknown>;
};

export type BuildResult =
  | { status: 'skipped' | 'failed' }
  | {
      status: 'ok';
      payload: AttestationPayload;
      /** Call after the server confirms the token — persists the iOS "registered" flag. */
      onVerified: () => Promise<void>;
    };

const regFlagKey = (keyId: string) => `attest_registered_${keyId.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
const noop = async () => {};

type Challenge = { id: string; challenge: string };

async function fetchChallenge(action: AttestAction, email: string | null): Promise<Challenge | null> {
  try {
    const { data, error } = await supabase.functions.invoke('attestation-challenge', {
      body: { platform: Platform.OS, action, email },
    });
    console.log('[attest debug] challenge fn error:', JSON.stringify(error), 'data:', JSON.stringify(data));
    if (error || !data?.id || !data?.challenge) return null;
    return { id: data.id, challenge: data.challenge };
  } catch {
    return null;
  }
}

function isUnsupported(e: unknown): boolean {
  const code = (e as { code?: string })?.code ?? '';
  return (
    code === 'ERR_UNSUPPORTED' ||
    code === 'ERR_NO_PROJECT_NUMBER' ||
    code === 'ERR_NO_CONTEXT'
  );
}

// The shared handshake: fetch a challenge, call the native module, and produce
// the verify payload (plus, for a first-time iOS attestation, an `onVerified`
// that persists the local "registered" flag once the server confirms).
type Produced =
  | { status: 'skipped' | 'failed' }
  | {
      status: 'ok';
      platform: 'ios' | 'android';
      verify: Record<string, unknown>;
      token: string;
      onVerified: () => Promise<void>;
    };

async function produce(action: AttestAction, rawEmail: string | null = null, recoveryAttempts = 0): Promise<Produced> {
  const os = Platform.OS;
  if (os !== 'ios' && os !== 'android') return { status: 'failed' };
  if (!AppAttest) return { status: 'failed' };
  const email = action === 'checkout' ? null : (rawEmail ?? '').trim().toLowerCase();

  try {
    if (os === 'ios') {
      console.log('[attest debug] AppAttest.isSupported() =', AppAttest.isSupported());
      if (!AppAttest.isSupported()) return { status: 'failed' };
      const challenge = await fetchChallenge(action, email);
      console.log('[attest debug] challenge =', JSON.stringify(challenge));
      if (!challenge) return { status: 'failed' };

      let keyId = AppAttest.getKeyId();
      if (!keyId) keyId = await AppAttest.generateKey();
      console.log('attest_debug_keyid', JSON.stringify(keyId), typeof keyId);
      const registered = (await SecureStore.getItemAsync(regFlagKey(keyId))) === '1';

      if (!registered) {
        const attestation = await AppAttest.attestKey(keyId, challenge.challenge);
        const kid = keyId;
        return {
          status: 'ok',
          platform: 'ios',
          token: attestation,
          verify: { challengeId: challenge.id, platform: 'ios', keyId: kid, attestation, action, email },
          // Only mark registered once the SERVER confirms, so a rejected
          // registration doesn't strand later assertions with no device row.
          onVerified: async () => {
            await SecureStore.setItemAsync(regFlagKey(kid), '1');
          },
        };
      }

      const requestData = JSON.stringify({ action, challenge: challenge.id, email, platform: 'ios' });
      const { assertion, signCount } = await AppAttest.generateAssertion(keyId, requestData);
      return {
        status: 'ok',
        platform: 'ios',
        token: assertion,
        verify: {
          challengeId: challenge.id,
          platform: 'ios',
          keyId,
          assertion,
          requestData,
          signCount,
          action,
          email,
        },
        onVerified: noop,
      };
    }

    // Android — Play Integrity.
    const challenge = await fetchChallenge(action, email);
    if (!challenge) return { status: 'failed' };
    const token = await AppAttest.requestIntegrityToken(challenge.challenge);
    return {
      status: 'ok',
      platform: 'android',
      token,
      verify: {
        challengeId: challenge.id,
        platform: 'android',
        token,
        requestHash: challenge.challenge,
        action,
        email,
      },
      onVerified: noop,
    };
  } catch (e) {
    if (os === 'ios' && canAttemptRecovery(recoveryAttempts) && (e as { code?: string })?.code === 'ERR_ATTEST') {
      const staleKey = AppAttest.getKeyId();
      if (staleKey) await SecureStore.deleteItemAsync(regFlagKey(staleKey));
      AppAttest.resetKey();
      return produce(action, rawEmail, recoveryAttempts + 1);
    }
    console.log("attest_debug_caught", "message:", (e as Error)?.message, "code:", (e as { code?: string })?.code, "name:", (e as Error)?.name);
    if (isUnsupported(e)) return { status: 'skipped' };
    return { status: 'failed' };
  }
}

export async function markCurrentKeyUnregistered(): Promise<void> {
  const keyId = AppAttest?.getKeyId();
  if (keyId) await SecureStore.deleteItemAsync(regFlagKey(keyId));
}

async function callVerify(fn: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke(fn, { body });
    if (error) return false;
    return data?.verified === true;
  } catch {
    return false;
  }
}

/**
 * Self-verifying attestation for the CHECKOUT gate. Runs the handshake and calls
 * the verify-* function itself. Never throws.
 */
export async function attest(action: AttestAction): Promise<AttestResult> {
  const os = Platform.OS;
  const platform: AttestPlatform = os === 'ios' || os === 'android' ? os : 'web';

  const p = await produce(action);
  if (p.status !== 'ok') return { status: p.status, platform, token: null };

  const fn = p.platform === 'ios' ? 'verify-app-attest' : 'verify-play-integrity';
  const verified = await callVerify(fn, p.verify);
  if (!verified) return { status: 'failed', platform: p.platform, token: null };

  await p.onVerified();
  return { status: 'ok', platform: p.platform, token: p.token };
}

/**
 * Build an attestation payload for the AUTH GATEWAY to verify server-side. Does
 * NOT call verify-* (the gateway must, so the single-use challenge is consumed
 * exactly once). The caller invokes `onVerified()` after the gateway confirms.
 */
export async function buildAttestation(action: AttestAction, email: string): Promise<BuildResult> {
  const p = await produce(action, email);
  if (p.status !== 'ok') return { status: p.status };
  return {
    status: 'ok',
    payload: { platform: p.platform, verify: p.verify },
    onVerified: p.onVerified,
  };
}
