import ExpoModulesCore
import DeviceCheck
import CryptoKit
import Security

// Apple App Attest, wrapped as an Expo native module.
//
// Flow (mirrors Apple's DCAppAttestService docs):
//   1. generateKey()               → creates an App Attest key, stores its id in
//                                     the Keychain, returns the id.
//   2. attestKey(id, challenge)    → ONE-TIME registration. Hashes the server
//                                     challenge into the clientDataHash and
//                                     returns the base64 attestation object the
//                                     server verifies against Apple's root CA.
//   3. generateAssertion(id, data) → PER-REQUEST. Signs SHA256(requestData) and
//                                     returns a base64 assertion; also bumps a
//                                     local sign-counter mirror in the Keychain.
//
// DCError.featureUnsupported (simulators, or hardware without the Secure
// Enclave App Attest support) is surfaced as a stable "ERR_UNSUPPORTED" code so
// the JS layer can cleanly no-op instead of blocking the user.
public class AppAttestModule: Module {
  private let keychainService = "ai.compreo.fetchit.appattest"
  private let keyIdAccount = "attest_key_id"
  private let counterAccount = "attest_sign_count"

  public func definition() -> ModuleDefinition {
    Name("AppAttest")

    Function("isSupported") { () -> Bool in
      if #available(iOS 14.0, *) {
        return DCAppAttestService.shared.isSupported
      }
      return false
    }

    Function("getKeyId") { () -> String? in
      self.keychainRead(self.keyIdAccount)
    }

    Function("getSignCount") { () -> Int in
      Int(self.keychainRead(self.counterAccount) ?? "0") ?? 0
    }

    AsyncFunction("generateKey") { (promise: Promise) in
      guard #available(iOS 14.0, *), DCAppAttestService.shared.isSupported else {
        promise.reject("ERR_UNSUPPORTED", "App Attest is not supported on this device.")
        return
      }
      DCAppAttestService.shared.generateKey { keyId, error in
        if let error = error {
          self.rejectAttest(promise, error)
          return
        }
        guard let keyId = keyId else {
          promise.reject("ERR_NO_KEY", "App Attest did not return a key id.")
          return
        }
        self.keychainWrite(self.keyIdAccount, keyId)
        // A fresh key starts at counter 0 (the attestation carries counter 0).
        self.keychainWrite(self.counterAccount, "0")
        promise.resolve(keyId)
      }
    }

    AsyncFunction("attestKey") { (keyId: String, challenge: String, promise: Promise) in
      guard #available(iOS 14.0, *), DCAppAttestService.shared.isSupported else {
        promise.reject("ERR_UNSUPPORTED", "App Attest is not supported on this device.")
        return
      }
      // The server sends the challenge base64-encoded; App Attest wants the
      // SHA256 of the raw challenge bytes as the clientDataHash.
      guard let challengeData = Data(base64Encoded: challenge) else {
        promise.reject("ERR_BAD_CHALLENGE", "Challenge is not valid base64.")
        return
      }
      let clientDataHash = Data(SHA256.hash(data: challengeData))
      DCAppAttestService.shared.attestKey(keyId, clientDataHash: clientDataHash) { attestation, error in
        if let error = error {
          self.rejectAttest(promise, error)
          return
        }
        guard let attestation = attestation else {
          promise.reject("ERR_NO_ATTESTATION", "App Attest did not return an attestation.")
          return
        }
        promise.resolve(attestation.base64EncodedString())
      }
    }

    AsyncFunction("generateAssertion") { (keyId: String, requestData: String, promise: Promise) in
      guard #available(iOS 14.0, *), DCAppAttestService.shared.isSupported else {
        promise.reject("ERR_UNSUPPORTED", "App Attest is not supported on this device.")
        return
      }
      guard let data = requestData.data(using: .utf8) else {
        promise.reject("ERR_BAD_REQUEST", "requestData must be a UTF-8 string.")
        return
      }
      let clientDataHash = Data(SHA256.hash(data: data))
      DCAppAttestService.shared.generateAssertion(keyId, clientDataHash: clientDataHash) { assertion, error in
        if let error = error {
          self.rejectAttest(promise, error)
          return
        }
        guard let assertion = assertion else {
          promise.reject("ERR_NO_ASSERTION", "App Attest did not return an assertion.")
          return
        }
        // Persist a monotonic local mirror of the sign counter. The server
        // extracts the AUTHORITATIVE counter from the assertion's authenticator
        // data; this is only best-effort client bookkeeping / telemetry.
        let next = (Int(self.keychainRead(self.counterAccount) ?? "0") ?? 0) + 1
        self.keychainWrite(self.counterAccount, String(next))
        promise.resolve([
          "assertion": assertion.base64EncodedString(),
          "signCount": next,
        ])
      }
    }
  }

  // Map DCError.featureUnsupported → a stable code so JS can no-op on simulators
  // and unsupported hardware; everything else is a genuine attestation failure.
  private func rejectAttest(_ promise: Promise, _ error: Error) {
    let ns = error as NSError
    if ns.domain == DCError.errorDomain, ns.code == DCError.Code.featureUnsupported.rawValue {
      promise.reject("ERR_UNSUPPORTED", "App Attest feature unsupported (simulator or unavailable).")
    } else {
      promise.reject("ERR_ATTEST", error.localizedDescription)
    }
  }

  // MARK: - Keychain (generic password items, this-device-only)

  private func keychainWrite(_ account: String, _ value: String) {
    guard let data = value.data(using: .utf8) else { return }
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
    ]
    SecItemDelete(query as CFDictionary)
    var add = query
    add[kSecValueData as String] = data
    add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
    SecItemAdd(add as CFDictionary, nil)
  }

  private func keychainRead(_ account: String) -> String? {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: keychainService,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var out: AnyObject?
    let status = SecItemCopyMatching(query as CFDictionary, &out)
    guard status == errSecSuccess, let data = out as? Data else { return nil }
    return String(data: data, encoding: .utf8)
  }
}
