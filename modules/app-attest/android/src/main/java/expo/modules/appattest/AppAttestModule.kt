package expo.modules.appattest

import com.google.android.play.core.integrity.IntegrityManagerFactory
import com.google.android.play.core.integrity.StandardIntegrityManager.PrepareIntegrityTokenRequest
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityToken
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenProvider
import com.google.android.play.core.integrity.StandardIntegrityManager.StandardIntegrityTokenRequest
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Play Integrity (Standard API), wrapped as an Expo native module. Shares the
// JS module name "AppAttest" with the iOS implementation so
// `requireNativeModule('AppAttest')` resolves on either platform; only the
// Android-relevant method (requestIntegrityToken) is implemented here.
//
// Standard API is a two-step flow:
//   1. prepareIntegrityToken(cloudProjectNumber) — warms up a token provider.
//      Done once and cached; it's the slow call.
//   2. provider.request(requestHash)             — fast, per-request. Returns
//      the signed integrity token (JWE) that the server decodes with Google.
class AppAttestModule : Module() {
  // Cached provider from prepareIntegrityToken — the expensive warm-up call.
  private var tokenProvider: StandardIntegrityTokenProvider? = null

  override fun definition() = ModuleDefinition {
    Name("AppAttest")

    AsyncFunction("requestIntegrityToken") { requestHash: String, promise: Promise ->
      val context = appContext.reactContext?.applicationContext
        ?: run {
          promise.reject(CodedException("ERR_NO_CONTEXT", "No Android context available.", null))
          return@AsyncFunction
        }

      val cloudProjectNumber = readCloudProjectNumber(context)
      if (cloudProjectNumber <= 0L) {
        promise.reject(
          CodedException(
            "ERR_NO_PROJECT_NUMBER",
            "Missing meta-data ai.compreo.fetchit.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER.",
            null,
          ),
        )
        return@AsyncFunction
      }

      val cached = tokenProvider
      if (cached != null) {
        requestToken(cached, requestHash, promise)
        return@AsyncFunction
      }

      try {
        val manager = IntegrityManagerFactory.createStandard(context)
        manager
          .prepareIntegrityToken(
            PrepareIntegrityTokenRequest.builder()
              .setCloudProjectNumber(cloudProjectNumber)
              .build(),
          )
          .addOnSuccessListener { provider ->
            tokenProvider = provider
            requestToken(provider, requestHash, promise)
          }
          .addOnFailureListener { e ->
            promise.reject(CodedException("ERR_PREPARE", e.message ?: "prepareIntegrityToken failed", e))
          }
      } catch (e: Exception) {
        promise.reject(CodedException("ERR_INTEGRITY", e.message ?: "Play Integrity error", e))
      }
    }
  }

  private fun requestToken(
    provider: StandardIntegrityTokenProvider,
    requestHash: String,
    promise: Promise,
  ) {
    try {
      provider
        .request(
          StandardIntegrityTokenRequest.builder()
            .setRequestHash(requestHash)
            .build(),
        )
        .addOnSuccessListener { token: StandardIntegrityToken ->
          promise.resolve(token.token())
        }
        .addOnFailureListener { e ->
          promise.reject(CodedException("ERR_REQUEST", e.message ?: "integrity token request failed", e))
        }
    } catch (e: Exception) {
      promise.reject(CodedException("ERR_REQUEST", e.message ?: "integrity token request failed", e))
    }
  }

  // The Google Cloud project number linked to Play Integrity. Read from an
  // <application> <meta-data> tag so it survives `expo prebuild` (see
  // plugins/withPlayIntegrity.js) and isn't hard-coded in Kotlin.
  private fun readCloudProjectNumber(context: android.content.Context): Long {
    return try {
      val ai = context.packageManager.getApplicationInfo(
        context.packageName,
        android.content.pm.PackageManager.GET_META_DATA,
      )
      val meta = ai.metaData ?: return 0L
      when (val v = meta.get("ai.compreo.fetchit.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER")) {
        is Long -> v
        is Int -> v.toLong()
        is String -> v.toLongOrNull() ?: 0L
        else -> 0L
      }
    } catch (_: Exception) {
      0L
    }
  }
}
