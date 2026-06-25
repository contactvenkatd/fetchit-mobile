/**
 * Expo config plugin: keep the native Google Sign-In setup reproducible across
 * every `expo prebuild`.
 *
 * This project uses Continuous Native Generation — `ios/` is git-ignored and
 * regenerated on each prebuild — so any hand edit to `ios/Podfile` or the
 * generated `Info.plist` is lost. Two things the Google Sign-In SDK needs are
 * re-applied here so they survive:
 *
 *   1. The reversed-client-ID URL scheme in `CFBundleURLTypes` — the callback
 *      scheme the native GoogleSignin sheet returns through. (The official
 *      `@react-native-google-signin/google-signin` config plugin also adds this
 *      from `app.json`'s `plugins`; this is an idempotent belt-and-suspenders so
 *      the scheme is present even if that entry or `ios.infoPlist` is removed.)
 *   2. `use_modular_headers!` in the Podfile — without it the GoogleSignIn /
 *      GTMSessionFetcher pods fail to build with "include of non-modular header
 *      inside framework module" errors. Nothing else re-adds this on prebuild,
 *      so it is the main reason this plugin exists.
 *
 * Keep the scheme in sync with `iosClientId` in src/app/_layout.tsx (the scheme
 * is the client ID's two dot-separated halves swapped: `com.googleusercontent.
 * apps.<id>`).
 */
const {
  withInfoPlist,
  withDangerousMod,
  createRunOncePlugin,
} = require('expo/config-plugins');
const fs = require('fs');
const path = require('path');

// Reversed iOS OAuth client ID (the URL scheme the native sheet calls back on).
const REVERSED_CLIENT_ID =
  'com.googleusercontent.apps.120830719857-cut021t8gjpeha2fbb58pa89fdaunt29';

const MODULAR_HEADERS_LINE = 'use_modular_headers!';

// 1. Ensure the reversed-client-ID URL scheme is in CFBundleURLTypes. Idempotent
//    — checks every existing entry's schemes first, so running alongside the
//    official plugin (or an `ios.infoPlist` entry) never produces a duplicate.
const withGoogleUrlScheme = (config) =>
  withInfoPlist(config, (cfg) => {
    const plist = cfg.modResults;
    if (!Array.isArray(plist.CFBundleURLTypes)) plist.CFBundleURLTypes = [];
    const present = plist.CFBundleURLTypes.some(
      (entry) =>
        Array.isArray(entry?.CFBundleURLSchemes) &&
        entry.CFBundleURLSchemes.includes(REVERSED_CLIENT_ID)
    );
    if (!present) {
      plist.CFBundleURLTypes.push({ CFBundleURLSchemes: [REVERSED_CLIENT_ID] });
    }
    return cfg;
  });

// 2. Ensure `use_modular_headers!` sits right after the `platform :ios,` line in
//    the freshly generated Podfile. Idempotent — no-op if already present.
const withModularHeaders = (config) =>
  withDangerousMod(config, [
    'ios',
    async (cfg) => {
      const podfilePath = path.join(
        cfg.modRequest.platformProjectRoot,
        'Podfile'
      );
      let contents = await fs.promises.readFile(podfilePath, 'utf8');
      if (!/^[ \t]*use_modular_headers!/m.test(contents)) {
        if (/^platform :ios.*$/m.test(contents)) {
          contents = contents.replace(
            /^(platform :ios.*)$/m,
            `$1\n${MODULAR_HEADERS_LINE}`
          );
        } else {
          // Template shape changed — fall back to prepending so the build still
          // gets modular headers rather than silently dropping them.
          contents = `${MODULAR_HEADERS_LINE}\n${contents}`;
        }
        await fs.promises.writeFile(podfilePath, contents, 'utf8');
      }
      return cfg;
    },
  ]);

/** @param {import('expo/config').ExpoConfig} config */
const withGoogleSignIn = (config) => {
  config = withGoogleUrlScheme(config);
  config = withModularHeaders(config);
  return config;
};

module.exports = createRunOncePlugin(
  withGoogleSignIn,
  'fetchit-google-signin',
  '1.0.0'
);
