// Local Expo native module — the RN-native equivalent of a Capacitor plugin.
//
// Exposes ONE JS module name ("AppAttest") with a platform-specific native
// implementation behind it:
//   • iOS     → DCAppAttestService (Apple App Attest)         — AppAttestModule.swift
//   • Android → Play Integrity Standard API                    — AppAttestModule.kt
//
// The two platforms deliberately expose DIFFERENT methods (iOS has the
// generateKey/attestKey/generateAssertion handshake; Android has the single
// requestIntegrityToken call). `src/attestation.ts` branches on `Platform.OS`
// and only calls the methods that exist for the running platform.
//
// `requireOptionalNativeModule` returns `null` when the native module isn't
// linked (e.g. web, or before a dev build is made), so importers must
// null-check. Autolinking picks this module up automatically because it lives
// in `<project>/modules/*` with an `expo-module.config.json`.
import { requireOptionalNativeModule } from 'expo';

/** iOS: result of a per-request App Attest assertion. */
export type IosAssertion = {
  /** Base64 DER of the CBOR assertion object. */
  assertion: string;
  /** Best-effort local mirror of the sign counter (server is authoritative). */
  signCount: number;
};

/**
 * Native surface. iOS-only methods no-op / are absent on Android and vice
 * versa; call them behind a `Platform.OS` guard (see `src/attestation.ts`).
 */
export interface AppAttestNativeModule {
  // ---- iOS (Apple App Attest / DCAppAttestService) ----
  /** Is App Attest available? False on simulators and pre-A-series hardware. */
  isSupported(): boolean;
  /** The App Attest key id we previously generated (from Keychain), or null. */
  getKeyId(): string | null;
  /** Generate a new App Attest key, persist its id in the Keychain, return it. */
  generateKey(): Promise<string>;
  /** One-time registration: attest `keyId` against a base64 server `challenge`. */
  attestKey(keyId: string, challenge: string): Promise<string>;
  /** Per-request assertion over `requestData` (a UTF-8 string we hash on device). */
  generateAssertion(keyId: string, requestData: string): Promise<IosAssertion>;
  /** Local sign-counter mirror (best-effort bookkeeping; server is source of truth). */
  getSignCount(): number;

  // ---- Android (Play Integrity Standard API) ----
  /** Request a signed Play Integrity token bound to `requestHash` (<=500 chars). */
  requestIntegrityToken(requestHash: string): Promise<string>;
}

const AppAttest = requireOptionalNativeModule<AppAttestNativeModule>('AppAttest');

export default AppAttest;
