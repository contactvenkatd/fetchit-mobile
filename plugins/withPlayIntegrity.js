/**
 * Expo config plugin: inject the Play Integrity cloud project number into the
 * Android manifest as an <application> <meta-data> tag, so the native
 * AppAttestModule.kt can read it at runtime without hard-coding it in Kotlin.
 *
 * Continuous Native Generation regenerates `android/` on every prebuild, so a
 * hand edit to AndroidManifest.xml would be lost — this re-applies it each time.
 *
 * The value comes from `app.json` → `expo.extra.playIntegrityCloudProjectNumber`
 * (a string of digits). Set it to your Google Cloud project number, the one
 * linked to Play Integrity in the Play Console (Play Console → App integrity →
 * Play Integrity API → linked Cloud project). Until it's set, the native module
 * rejects with ERR_NO_PROJECT_NUMBER and `src/attestation.ts` treats Android
 * attestation as "skipped".
 */
const { withAndroidManifest, createRunOncePlugin } = require('expo/config-plugins');

const META_NAME = 'ai.compreo.fetchit.PLAY_INTEGRITY_CLOUD_PROJECT_NUMBER';

/** @param {import('expo/config').ExpoConfig} config */
const withPlayIntegrity = (config) =>
  withAndroidManifest(config, (cfg) => {
    const number = String(cfg.extra?.playIntegrityCloudProjectNumber ?? '').trim();

    const app = cfg.modResults.manifest.application?.[0];
    if (!app) return cfg;
    if (!Array.isArray(app['meta-data'])) app['meta-data'] = [];

    // Idempotent: replace any existing entry rather than appending a duplicate.
    app['meta-data'] = app['meta-data'].filter(
      (m) => m?.$?.['android:name'] !== META_NAME,
    );
    app['meta-data'].push({
      $: {
        'android:name': META_NAME,
        // meta-data string values must start with a non-digit or Android coerces
        // the type oddly; the native reader parses the string back to a Long.
        'android:value': number,
      },
    });

    return cfg;
  });

module.exports = createRunOncePlugin(withPlayIntegrity, 'fetchit-play-integrity', '1.0.0');
