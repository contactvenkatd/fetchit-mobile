export const REQUIRED_APP_ID = "PV7JV2P9Q8.ai.compreo.fetchit";
export const VALID_ATTEST_ENVIRONMENTS = new Set(["development", "production"]);

export function validateAppleConfiguration(appId, environment) {
  if (appId !== REQUIRED_APP_ID) return "invalid_apple_app_id_config";
  if (!VALID_ATTEST_ENVIRONMENTS.has(environment)) return "invalid_apple_attest_env_config";
  return null;
}

export function expectedAaguid(environment) {
  return environment === "development"
    ? "appattestdevelop"
    : "appattest\0\0\0\0\0\0\0";
}

export function canonicalRequest(action, challenge, email, platform = "ios") {
  return JSON.stringify({ action, challenge, email, platform });
}

export function equalBytes(left, right) {
  if (!(left instanceof Uint8Array) || !(right instanceof Uint8Array) || left.length !== right.length) {
    return false;
  }
  let difference = 0;
  for (let index = 0; index < left.length; index++) difference |= left[index] ^ right[index];
  return difference === 0;
}

export function validateRegistrationIdentity(input) {
  if (input.aaguid !== expectedAaguid(input.environment)) return "bad_aaguid";
  if (!equalBytes(input.rpIdHash, input.expectedRpIdHash)) return "bad_rp_id";
  if (input.keyId !== input.expectedKeyId) return "key_id_mismatch";
  return null;
}

export function validateNonce(actual, expected) {
  return equalBytes(actual, expected) ? null : "nonce_mismatch";
}

export function validateCertificateChain(validNow, leafSignedByIntermediate, intermediateSignedByRoot, rootSelfSigned) {
  return validNow && leafSignedByIntermediate && intermediateSignedByRoot && rootSelfSigned
    ? null
    : "bad_chain";
}

export function validateAssertionCounter(previous, next) {
  return Number.isSafeInteger(previous) && Number.isSafeInteger(next) && next > previous
    ? null
    : "counter_not_increasing";
}
