# TestFlight replacement for rejected build 6

Updated September 21, 2026.

Apple received build 1.0.0 (6), but processing and import FAILED with error
90683: NSCameraUsageDescription was missing. The actual altool log ended with
“No errors uploading archive” despite BUILD-STATUS: FAILED, IMPORT-STATUS:
FAILED, and IS-ON-APP-STORE-CONNECT: false. Transfer success was not import success.

## Camera purpose and native configuration

The app uses Stripe CardForm for saving payment cards. It does not implement
product photography or another direct camera feature. The linked Stripe native
payment SDK includes its optional payment-card scanner (STPCardScanner, using
AVCapture). Expo app.json now declares the corresponding purpose:

> Allow camera access to scan a payment card and fill in its details.

app.config.js preserves this Info.plist entry through its cloned configuration
and continues selecting production App Attest for production builds. An isolated
production Expo prebuild generated the expected Info.plist entry and production
App Attest entitlement without overwriting the workspace's native project.

## Replacement release and submission

EAS allocated the next unused build number, **1.0.0 (7)**:
https://expo.dev/accounts/durick17/projects/fetchit-mobile/builds/7e8eeeb7-b8e9-4a60-b79f-5aad079aec3a

config/testflight-release.json selects that exact build. scripts/submit-testflight.py
validates the downloaded IPA's bundle, version, build number, and camera purpose
before uploading. The old scripts/submit-testflight-build-6.py command delegates
to the replacement release; it cannot resend the rejected build 6.

The uploader uses Apple's supported app-specific-password authentication with
altool. Input remains hidden, surrounding whitespace is trimmed, and no fixed
password length/case/grouping is assumed. Passwords are never saved and are
excluded from download/EAS environments and command arguments. Console output
is redacted. No API-key generation or public review operation is performed.

The installed altool help was checked. Status requests include --delivery-id,
--platform ios, --bundle-short-version-string 1.0.0, --apple-id, --bundle-version,
and --wait. Processing/import failure overrides a zero process exit code. Unknown
or pending status is not reported as successful import. A credential-free receipt
in .expo/testflight-delivery.json lets a rerun check the same delivery without
uploading again.

## Verified artifact and current status

EAS finished build 7 at 05:27:55 UTC on September 21, 2026. The downloaded IPA
was inspected independently: native version 1.0.0 (7), exact camera description,
production App Attest on the signed executable and embedded Expo configuration,
exact approved live Stripe public key, production Supabase project
fpphpncruohjlppqhfep, Card setup v2 in the JS bundle, and EXUpdatesEnabled false.
The same IPA also passes the uploader's artifact validation.

Subsequent authenticated Apple verification on September 21 reports build 7
processingState VALID, uploaded at 05:37:43 UTC (App Store Connect build ID
fe3a77af-d589-4a31-bdb6-efb564ed8dea). It was uploaded outside this workspace's
credential session. Do not upload it again. This confirms Apple import, not the
installed build on the affected phone or testing-group assignment.
No backend deployment was needed for this camera/submission change. No public
App Store review was submitted.

## Private Terminal step

The app-specific password used for build 6 was not retained. No reusable upload
password was found in this process or the standard submission Keychain entries.
The cached Apple session supports read-only build checks but is not an altool
upload password. This is a missing credential, not a request for permission.

Historical upload instructions (build 7 is now imported; do not rerun to upload):

```sh
cd /Users/neilduddukuri/Downloads/fetchit-mobile-main
python3 scripts/submit-testflight.py
```

Enter the same working Apple app-specific password at the hidden Terminal prompt.
If it is no longer available, generate a new one at https://account.apple.com/ →
Sign-In and Security → App-Specific Passwords for vduddukuri@gmail.com. Do not
paste credentials into chat. The script uploads and waits for Apple import, then
checks the delivery status. Check App Store Connect → FetchIt → TestFlight →
iOS Builds → 1.0.0 (7), assign the intended testing group if necessary, and install
through TestFlight on the phone.

The account has APP_MANAGER/CIPS roles. The earlier team API-key operation failed
403; it was not retried. Existing EAS signing credentials were reused.

## Checks

- 12 focused Python uploader regression tests pass, including the real 90683
  status shape, hidden input, output redaction, required status arguments, failure
  propagation, and status-only resume.
- 11 payment-environment/setup-session tests pass, including camera preservation
  across Expo profiles and production App Attest.
- TypeScript noEmit and git diff --check pass.
- The parser correctly classifies the previous actual Apple log as failed.

Stripe card saving remains unverified until it succeeds on the updated phone.

References: [Expo SDK 56](https://docs.expo.dev/versions/v56.0.0/),
[Apple app-specific passwords](https://support.apple.com/en-us/102654),
and the installed xcrun altool --help.
