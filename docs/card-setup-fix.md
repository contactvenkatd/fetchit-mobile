# Cards & Address SetupIntent investigation

Verified September 21, 2026. The original device failure is **not yet reproduced
or conclusively attributed**. Device enumeration was blocked by the workspace's
CoreDevice/CoreSimulator access restrictions, and the affected device's installed
version has not been supplied. Do not describe a test/live mismatch as proven.

## Evidence

- Downloaded the deployed `create-setup-intent` v16 ESZIP from production
  `fpphpncruohjlppqhfep` and inspected its embedded JavaScript. It authenticates
  the caller, resolves the user's mode-specific customer, creates a fresh
  off-session SetupIntent, and returns `setupIntent.client_secret` unchanged.
  `paymentStripe()` uses the backend secret and rejects test keys on production.
  Neither creation nor the Stripe constructor supplies a Connect account.
- The app calls `createSetupIntent()` for each attempt and passes
  `setup.clientSecret` directly to `confirmSetupIntent` (or the platform-pay
  equivalent). No SetupIntent ID/secret is hardcoded or persisted in these paths.
  The previous screen lacked synchronous duplicate-request exclusion and did
  not invalidate pending continuations when the account changed.
- Downloaded EAS production artifact **1.0.0 (4)**, build
  `27345f34-d729-4b1c-a3e8-45ee39843e5e`. Its actual embedded
  `EXConstants.bundle/app.config` selects production, the approved `pk_live_`
  public key, and `https://fpphpncruohjlppqhfep.supabase.co`.
  `Info.plist` confirms build 4; `Expo.plist` has `EXUpdatesEnabled=false`.
  Its JS accesses the manifest payment configuration. The earlier Git revision
  had a hardcoded test key against production, but that does not establish that
  the affected phone is running that revision. EAS Git metadata alone was not
  used to infer the artifact's configuration.
- A fresh, authenticated backend readiness GET proves live secret-key account
  **acct_1Th9uUQg8UTscDty**, live balance mode, and successful retrieval of an
  **existing live SetupIntent using the exact approved mobile public key**.
  This independently proves current account/mode/platform pairing. It does not
  identify the intent from the historical failure. An optional read-only
  comparison with the old mobile source's test public key failed to retrieve
  that **same live intent**, with Stripe code `resource_missing`. This proves
  the legacy configuration reproduces the failure class; it does not prove
  which configuration the affected phone runs. No webhook probe was sent.
- The deployed `save-card` v16 uses the same backend Stripe factory. It checks
  the payment method's live mode and customer attachment before updating the
  default. It was inspected and left unchanged.
- The installed Stripe SDK's `StripeProvider` starts initialization in an effect
  while immediately rendering children. Native iOS initialization sets both
  shared/default public keys and explicitly clears `stripeAccount` when omitted.
  There were no other app initializers. A readiness race was possible in code;
  it is not proven to have caused the reported failure.
- Test-card instructions were unconditional, including in production. Their
  presence in the screenshot does **not** prove an old/test build was installed.

## Implemented

- `PaymentProvider` awaits native `initStripe` before rendering card collection.
  A shared initialization promise uses the same configured key as setup creation,
  platform-account context, existing merchant ID, and app URL scheme. Failed
  initialization can be retried; initialization errors reveal no native details.
- New mobile setup requests send their public key and explicit platform context.
  The backend rejects mode/Connect mismatches and retrieves the **newly created
  exact intent** with that public key before returning its complete secret.
  Responses include intent ID, mode, context and pairing verification. The app
  refuses mismatched, malformed or truncated responses before confirmation.
  Existing web clients' empty request bodies remain supported.
- Cards & Address uses a synchronous shared lock for manual and Apple Pay saves,
  invalidates pending work on account/environment changes or screen teardown,
  resets card form/profile UI, and discards stale results after each async stage.
  Old native work retains its lock until settlement, including across remounts.
  Only a successful confirmation matching the requested intent ID is saved.
  All attempts release the lock in `finally`; each user retry obtains a fresh,
  verified SetupIntent. Secrets are never cached or logged.
- Production card forms use a generic placeholder and hide test-card guidance
  across Cards & Address and onboarding. Cards & Address displays safe native
  version/build, backend URL, key mode, platform context and bundle diagnostics.
  Apple Pay availability now respects the actual SDK capability result.
- Profile-save errors are reported instead of falsely showing success.

## Deployment and validation

Production deployments verified by reading function metadata and the uploaded
bundle back from the Management API:

| Function | Version | Status |
| --- | --- | --- |
| create-setup-intent | 17 | Deployed; gateway JWT still enabled |
| stripe-readiness | 14 | Deployed; added authenticated CLI-token access for diagnostics |
| save-card | 16 | Inspected, unchanged |

The readiness helper also provides an opt-in, read-only `compareLegacy=true`
comparison; it returns only success/resource-missing booleans, never intent
secrets or card details.

The readiness helper validates the CLI credential's access to this exact project
server-side and discards the privileged API-key response. It does not return
secrets. The existing secret-key/account pairing check passes after deployment.
Unauthenticated requests to both deployed handlers still return 401.
No customer/intent was created during the remote audit; no card was confirmed or
charged. No webhook configuration or App Attest files were changed.

Checks:

- 11 focused payment/runtime/config tests pass, including complete-secret
  forwarding, mismatched ID/mode/key/Connect rejection, pairing read failures,
  duplicate taps, stale continuations, retry, initialization ordering, production
  help visibility, native build diagnostics and App Attest profile preservation.
- TypeScript `tsc --noEmit`, Deno checks for both modified handlers, three existing
  offline backend Stripe tests, and production iOS export pass.
- Full Node suite: **25 pass, 1 fail, 1 skip**. The failure is the pre-existing
  `Google authentication bypass remains disabled` assertion against unchanged
  login/signup code. It was not weakened or fixed as part of this task.
- A real device card-save/3DS run remains unverified. Automated checks used
  fixtures; remote checks retrieved existing objects only.

## Mobile installation

Build 1.0.0 (6) was uploaded but rejected during Apple processing with error
90683 (missing camera usage description). Its unchanged IPA must not be reused.
The replacement is **1.0.0 (7)**:
https://expo.dev/accounts/durick17/projects/fetchit-mobile/builds/7e8eeeb7-b8e9-4a60-b79f-5aad079aec3a

See [TestFlight upload details](testflight-build-6-upload.md) for artifact checks,
current upload status, and the private Terminal submission command. OTA remains
disabled, so the replacement requires a TestFlight installation.

After Apple import and testing-group assignment, open TestFlight → FetchIt →
Install/Update and select **1.0.0 (7)**. Force-close and reopen FetchIt. In Cards &
Address confirm the footer shows Card setup v2, build 7, the production Supabase
URL, Stripe: live, and platform-account context. Confirm the test-card hint is
absent. Open a fresh card form and save a card. Do not initiate a purchase.

Record only displayed diagnostics, success/failure, and approximate failure time;
never share card fields, client secrets, or authentication tokens. Card saving is
not yet verified on the affected phone.

References consulted before implementation:
[Expo SDK 56](https://docs.expo.dev/versions/v56.0.0/),
[Expo SDK 56 Stripe](https://docs.expo.dev/versions/v56.0.0/sdk/stripe/),
[Stripe confirmSetupIntent](https://stripe.dev/stripe-react-native/api-reference/functions/confirmSetupIntent.html),
[Expo iOS submission](https://docs.expo.dev/submit/ios/).
