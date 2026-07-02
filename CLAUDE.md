@AGENTS.md

# FetchIt Mobile — React Native (iOS) Port

The native port of the FetchIt web app (an AI shopping assistant). It shares the
**same Supabase project and Stripe account** as the web app at
`/Users/neilduddukuri/fetchit-app`, so accounts, plans, chats, and orders are the
same data across web and mobile. Read the web app's `CLAUDE.md` for the full
product spec (plan rules, signup flow, edge functions, family sharing, etc.) —
this file documents only what's specific to the mobile port.

> **Expo SDK 56.** This project is Expo SDK 56 + `expo-router`. Per `AGENTS.md`,
> read the versioned docs at https://docs.expo.dev/versions/v56.0.0/ before
> writing code — APIs have changed across SDKs.

## Stack
- **Expo SDK 56** (`expo ~56.0`), **React Native 0.85**, **React 19.2**.
- **expo-router** (file-based routing) — NOT React Navigation directly. Chosen
  because the project was scaffolded with expo-router and it's Expo's standard
  for SDK 56; it's built *on top of* React Navigation, so the requested
  stack/tabs behavior is expressed as files instead of navigator config.
- **@supabase/supabase-js** for auth + data (same backend as web).
- **@stripe/stripe-react-native** for payments (publishable key only; secret-key
  work stays in the web app's Supabase Edge Functions).
- **expo-secure-store** for encrypted session storage, **expo-linear-gradient**
  for the landing hero, `react-native-safe-area-context` / `react-native-screens`
  (via expo-router).

## Run
```bash
cd fetchit-mobile
npm install
npx expo start        # dev server; press i for iOS simulator
npx expo run:ios      # native dev build (needed for Apple Pay / native Stripe)
npx tsc --noEmit      # type-check
npx expo export --platform ios   # verify the bundle compiles
```
**Expo Go vs dev build:** card collection works in Expo Go, but **Apple Pay
requires a development build** (`merchantIdentifier` is set in the app.json
Stripe plugin). The Supabase Edge Functions (checkout, setup-intent, save-card,
emails, family) are deployed from the **web** repo — see its `CLAUDE.md`.

## Theme (dark-first)
The mobile shell is dark-first (the web landing page is light/cream; the web
*chat* shell is the dark reference this port follows). Tokens live in
`src/theme/colors.ts`:
- **Background** `#1A1A1A` · **Accent (yellow)** `#FFD700` · **Text** `#FFFFFF`
- Secondary accent (orange) `#FF6B35`; surfaces `#222`/`#2A2A2A`; sidebar `#111`.
- `app.json` sets `userInterfaceStyle: "dark"` and a charcoal splash.

## Project structure
```
src/
  app/                       # expo-router routes (root = src/app)
    _layout.tsx              # root Stack + providers (SafeArea, Stripe, Auth, dark theme)
    index.tsx                # Landing/Splash — logo + "Shop Smarter. Fetch Faster.",
                             #   Sign In (/login) + Create Account (/signup) buttons,
                             #   "Learn More" → slide-up bottom sheet (RN Modal).
                             #   Redirects to chat if logged in.
    login.tsx                # ✅ PASSWORDLESS on native: email → auth-gateway (attestation) → /otp
    signup.tsx               # ✅ email+password → auth-gateway (attestation) → /otp (signup)
    otp.tsx                  # ✅ 8-digit email OTP — params {email, mode}; verifyOtp type 'email'
                             #   (both flows use magic-link OTPs); resend via auth-gateway.
                             #   auto-advance/backspace boxes, shake on error, 30s resend.
                             #   signup → onboarding, login → chat.
    tos.tsx                  # public Terms of Service
    privacy-policy.tsx       # public Privacy Policy
    (onboarding)/            # post-signup flow (no headers)
      _layout.tsx
      plans.tsx              # choose plan
      terms.tsx              # TOS agreement + checkbox
      delivery.tsx           # shipping address + card
      name.tsx               # display name → saves to user_metadata → chat
    (app)/                   # PROTECTED group (session required; else → /login)
      _layout.tsx            # auth guard + Stack
      chat.tsx               # main screen — top bar, empty state, message input
      account.tsx            # Account Settings — plan card + hub to all screens + sign out
      order-history.tsx
      orders.tsx             # Orders & Analytics
      wishlist.tsx
      auto-reorder.tsx
      family-sharing.tsx
      cards-address.tsx
  components/
    AuthLayout.tsx           # logo hero + card shell for auth/onboarding
    ScreenPlaceholder.tsx    # themed stub for not-yet-ported screens
    ui/                      # Logo, Screen, Button, TextField, GoogleButton
  lib/
    supabase.ts             # client + chunked SecureStore storage adapter
    stripe.ts               # publishable key + PLAN_PRICING (mirrors web stripeClient.js)
    auth.tsx                # AuthProvider/useAuth + signIn/signUp/signOut + getPlan/getName
    nativeAuth.ts           # native signup/login/resend via the attestation auth-gateway
  attestation.ts            # App Attest (iOS) / Play Integrity (Android) client — see below
  theme/
    colors.ts               # palette, radius, spacing, font sizes
assets/images/fetchit-logo.png   # brand badge (copied from the web app's public/)
modules/
  app-attest/               # LOCAL Expo native module (autolinked from ./modules)
    expo-module.config.json # exposes ONE JS name "AppAttest" on apple + android
    index.ts                # typed native interface (requireOptionalNativeModule)
    ios/AppAttestModule.swift        # DCAppAttestService wrapper (Apple App Attest)
    ios/AppAttest.podspec
    android/build.gradle             # adds com.google.android.play:integrity
    .../AppAttestModule.kt           # Play Integrity Standard API wrapper
plugins/
  withSceneLifecycle.js     # re-applies the iOS UIScene migration on each prebuild
  withGoogleSignIn.js       # re-applies Google Sign-In URL scheme + Podfile use_modular_headers!
  withPlayIntegrity.js      # injects the Play Integrity cloud project number as Android meta-data
supabase/                   # REFERENCE files to PASTE into the Supabase dashboard (not deployed from here)
  migrations/attested_devices.sql
  migrations/attestation_challenges.sql
  migrations/email_exists.sql
  functions/attestation-challenge/index.ts
  functions/verify-app-attest/index.ts
  functions/verify-play-integrity/index.ts
  functions/auth-gateway/index.ts       # native auth path (attestation ↔ Turnstile)
```

## Navigation model
Routes are files. Groups in parentheses (`(onboarding)`, `(app)`) don't appear in
the URL and have their own `_layout.tsx`. The root `_layout` declares the Stack
and wraps everything in `SafeAreaProvider → StripeProvider → AuthProvider →
ThemeProvider`. The `(app)` layout is the **auth guard**: it shows a spinner
while the session resolves and `<Redirect href="/login" />` when there's none.
`index.tsx` does the reverse (logged-in → `/(app)/chat`), matching the web app's
`RedirectIfAuthed`. Navigate with `useRouter().push/replace` and `<Link>`.

## Supabase auth (key RN differences from web)
`src/lib/supabase.ts` — same project URL + publishable key as the web app, but:
- **No `localStorage`.** A custom `storage` adapter backs sessions with
  `expo-secure-store`. SecureStore can reject values >~2KB on iOS and Supabase
  session blobs exceed that, so the adapter **chunks** large values across
  `<key>.0`, `<key>.1`, … with a small JSON manifest at `<key>`.
- **`detectSessionInUrl: false`** — no browser URL in RN (deep-link auth, if
  added, is handled with `expo-linking`).
- **AppState auto-refresh** — `src/lib/auth.tsx` starts/stops Supabase token
  auto-refresh on `AppState` foreground/background (the documented RN pattern).
- `react-native-url-polyfill/auto` is imported first so `URL` works on Hermes.

`useAuth()` returns `{ session, loading }`; **wait for `loading === false`**
before treating "no session" as logged-out. Plan/name helpers (`getPlan`,
`getPlanBilling`, `getName`, `greetingName`) read `user_metadata` and mirror the
web `utils.js` (`getPlan` returns Free once `plan_cancels_at` passes).

## Google Sign-In (native, in-app)
Google sign-in is **native** (no browser round-trip): the
`@react-native-google-signin/google-signin` SDK presents the system sheet,
returns an **ID token**, and we hand it to Supabase. This is the mobile
counterpart of the web app's browser OAuth — the web `signInWithGoogle` /
`/auth/callback` flow does **not** apply here.

- **Client IDs (two forms of the same iOS OAuth client).** The **iOS client ID**
  `120830719857-…apps.googleusercontent.com` is passed to
  `GoogleSignin.configure({ iosClientId })`. Its **reversed** form
  `com.googleusercontent.apps.120830719857-…` is the iOS **URL scheme** the
  native sheet calls back on. Keep the two in sync.
- **Configure once at startup.** `GoogleSignin.configure(...)` runs at
  module scope in `src/app/_layout.tsx` (the root layout, loaded on launch) —
  **not** per button press. `src/app/login.tsx`'s "Continue with Google" button
  (`components/ui/GoogleButton.tsx` — white surface, multicolor "G") just calls
  `GoogleSignin.signIn()` → `supabase.auth.signInWithIdToken({ provider: 'google',
  token: idToken })` → `/(app)/chat`. It reads the ID token from both the v13+
  `{ data: { idToken } }` shape and the legacy flat shape, and swallows
  `statusCodes.SIGN_IN_CANCELLED`.
- **Survives `expo prebuild` (CNG).** `ios/` is git-ignored and regenerated, so
  the native pieces live in plugins, **never** as hand edits to `ios/`:
  - The **package's own** config plugin
    (`["@react-native-google-signin/google-signin", { iosUrlScheme: "com.googleusercontent.apps.120830719857-…" }]`
    in `app.json` `plugins`) adds the reversed-client-ID **URL scheme** to
    `Info.plist`.
  - **`plugins/withGoogleSignIn.js`** (also in `plugins`) re-applies
    `use_modular_headers!` to the **Podfile** on every prebuild (required, or the
    GoogleSignIn / GTMSessionFetcher pods fail with non-modular-header errors —
    nothing else re-adds it) and idempotently re-adds the URL scheme as a
    belt-and-suspenders. Verify the resolved plist with
    `npx expo config --type introspect`.
  - **Do NOT** put the scheme in `app.json` `ios.infoPlist.CFBundleURLTypes`:
    setting that key makes Expo **drop** the abstract top-level
    `scheme: fetchitmobile`, breaking the `fetchitmobile://join-family` deep link.
    Let the plugins append the Google scheme **alongside** `fetchitmobile` instead.
- **Build + Supabase config.** Native module → needs a **dev build**
  (`npx expo run:ios`); not available in Expo Go. The iOS client ID must also be
  added under **Supabase → Auth → Providers → Google → "Authorized Client IDs"**
  or the backend rejects the native ID token.

## App Attest (iOS) / Play Integrity (Android)
Device attestation proves requests come from a genuine, unmodified build of the
app on real hardware. **Implemented as a LOCAL Expo native module, not
Capacitor.** Capacitor wraps a *web* app in a WebView and needs a `--web-dir`;
this project is Expo RN (native runtime, `main: expo-router/entry`, no web
bundle), so `Capacitor.getPlatform()` / Capacitor plugins don't exist at
runtime here. The RN-native equivalent — an Expo module in `modules/app-attest`
keyed off `Platform.OS` — provides the same capability and survives
`expo prebuild` like the other `plugins/`.

**Client flow (`src/attestation.ts`, exported `attest(action)`):**
1. `Platform.OS === 'web'` or the native module isn't linked → **no-op**
   (`status: 'skipped'`).
2. Fetch a single-use challenge from `attestation-challenge`.
3. **iOS** — `DCAppAttestService` via `modules/app-attest`:
   - `generateKey()` once (key id persisted in the **Keychain**);
   - first time: `attestKey(keyId, challenge)` → base64 attestation → verified by
     `verify-app-attest` (registration). A per-key "registered" flag is stored in
     SecureStore so this runs once.
   - thereafter: `generateAssertion(keyId, requestData)` → per-request assertion
     (the native side also persists a local **sign-counter** mirror) → verified by
     `verify-app-attest`.
   - `DCError.featureUnsupported` (simulators / old hardware) is surfaced as
     `ERR_UNSUPPORTED` → `status: 'skipped'` (never blocks).
4. **Android** — Play Integrity **Standard API** via `modules/app-attest`:
   `requestIntegrityToken(challenge)` → signed token → verified by
   `verify-play-integrity`.
5. Returns `{ status: 'ok' | 'skipped' | 'failed', platform, token }`.

`attest(action)` (self-verifying, used by checkout) and `buildAttestation(action)`
(handshake only — the caller verifies) are the two entry points. Because a
challenge is **single-use**, whichever side calls verify-* consumes it, so the
auth flow uses `buildAttestation` and lets the gateway verify.

**Where it's wired:**
- **signup / login / OTP-resend** — routed through the **auth gateway** (see next
  section): `buildAttestation` → `auth-gateway` verifies + performs the auth op.
  This is a **hard gate** — no attestation means the gateway rejects (there is no
  fallback path on native).
- **checkout** (`(onboarding)/delivery.tsx`) — the **blocking** gate via
  `attest('checkout')`: user is authenticated, so a definitive `status: 'failed'`
  **stops checkout**; `skipped` (simulator/unsupported) and `ok` proceed.

**Fail policy (server verify functions):** **fail-OPEN on DB errors** (a Supabase
outage returns `{ verified: true }` so nobody is locked out) and **fail-CLOSED on
failed attestation** (bad crypto/verdict returns `{ verified: false }`). Missing
Google config in `verify-play-integrity` also fails open (rollout-friendly).

**Tables** (`supabase/migrations/`, paste into the SQL editor; RLS scoped to the
owning user, `rate_limits.sql` style — writes are service-role from the edge
functions):
- `attested_devices` — one row per verified device: `platform`, `key_id`,
  `public_key` (iOS SPKI), `sign_count` (authoritative counter), `last_verdict`
  (Play Integrity JSON). `user_id` is nullable (signup-time registration).
- `attestation_challenges` — short-lived single-use nonces (5-min expiry,
  `consumed` flag) + a `purge_expired_attestation_challenges()` helper.

**Edge functions** (`supabase/functions/`, create each in the dashboard and paste
the `index.ts`):
- `attestation-challenge` — mints a 32-byte challenge; optional auth.
- `verify-app-attest` — full App Attest verification (CBOR decode via `cbor-x`,
  x5c chain to the **Apple App Attest Root CA** fetched at runtime, nonce binding,
  `key_id = SHA256(pubkey)`, rpId hash, counter). Handles both the attestation
  (registration) and assertion (per-request, strictly-increasing counter) shapes.
- `verify-play-integrity` — mints a Google OAuth token from a service account
  (RS256 JWT), calls `…:decodeIntegrityToken`, and requires
  `appRecognitionVerdict = PLAY_RECOGNIZED` + `MEETS_DEVICE_INTEGRITY` +
  matching `requestHash`.
- `auth-gateway` — the native auth path (see next section).

## Native auth gateway (Turnstile ↔ attestation)
Supabase's built-in **CAPTCHA (Turnstile) stays ON project-wide** — that's what
protects the **web** app's auth (GoTrue verifies `captchaToken` itself). RN can't
render Turnstile, so native **can't** call the captcha-gated GoTrue endpoints
(`signUp` / `signInWithOtp` / `resend`) directly — they'd fail `captcha_failed`.
So native auth goes through **`auth-gateway`** instead, gated by **attestation**
rather than Turnstile. The two paths are **mutually exclusive by construction**:
- **web** → GoTrue + Turnstile (the gateway is never called), and
- **native** → `auth-gateway` + App Attest / Play Integrity (no Turnstile).

Flow (`src/lib/nativeAuth.ts` → `auth-gateway`):
1. Client `buildAttestation()` → payload; POST to `auth-gateway` with the payload
   (never a Turnstile token). **No attestation → the gateway rejects (403).**
2. Gateway verifies the payload by invoking `verify-app-attest` /
   `verify-play-integrity` (consuming the single-use challenge once), rate-limits
   per IP + email (`rl_check`), then runs the auth op with **admin APIs** (which
   are **captcha-exempt**): `admin.createUser` (signup) and
   `admin.generateLink({ type: 'magiclink' })` to mint the one-time code, emailed
   directly via Resend.
3. Client verifies the code on `otp.tsx` with `verifyOtp({ type: 'email' })` —
   **not** captcha-gated, so it runs directly against GoTrue.

**Native login is PASSWORDLESS.** There is no captcha-free way to verify a
password server-side (`signInWithPassword` itself demands a captcha token), so
native login = **email one-time code + device attestation**. Signup still stores
a password (used for **web** login); it just isn't a native login factor.
`login.tsx` collects only an email; `email_exists()` stops login from creating
accounts. **Native auth therefore requires a physical device** (App Attest is
unavailable on the Simulator — you can't sign up/in there).

> Still on GoTrue directly (not yet gatewayed): **forgot-password** and in-app
> **change-password**. Both are captcha-gated, so they remain blocked on native
> until moved behind the gateway — a follow-up. Native login being passwordless
> makes forgot-password non-essential on native.

**Manual setup checklist** (nothing here is auto-deployed from the mobile repo):
1. **Keep project CAPTCHA ON** (Auth → Settings → Turnstile) — this protects web
   and is the reason native uses the gateway. Do **not** turn it off.
2. **SQL editor:** run `attested_devices.sql`, `attestation_challenges.sql`,
   `email_exists.sql`, and (if not already present) `rate_limits.sql`.
3. **Edge functions:** create `attestation-challenge`, `verify-app-attest`,
   `verify-play-integrity`, `auth-gateway`; paste each `index.ts`. **Turn "Verify
   JWT" OFF** for all four (they must accept anonymous pre-session calls and
   enforce their own attestation/rate-limit checks — matches the app's other
   functions, which are already invoked with the opaque `sb_publishable_` key).
4. **Edge function secrets:** `APPLE_APP_ID` = `<TeamID>.com.anonymous.fetchit-mobile`,
   `APPLE_ATTEST_ENV` = `development` for dev-build testing / `production` for
   TestFlight+App Store; `ANDROID_PACKAGE_NAME` = `com.anonymous.fetchitmobile`,
   `GOOGLE_SERVICE_ACCOUNT_JSON` = a service account with the **Play Integrity
   API** enabled (JSON pasted whole); `RESEND_API_KEY` = the same Resend key
   `send-email` uses (the gateway emails the OTP itself).
5. **iOS:** add the **App Attest** capability to the target (Xcode → Signing &
   Capabilities) and rebuild with `npx expo run:ios` on a **physical device**.
6. **Android:** enable **Play Integrity API** in the Play Console (link a Google
   Cloud project), then set `expo.extra.playIntegrityCloudProjectNumber` in
   `app.json` (the linked GCP **project number**) — `plugins/withPlayIntegrity.js`
   writes it into the manifest on prebuild. Rebuild with `npx expo run:android`.
   Standard-API tokens only decode for an app **recognized by Play** (internal
   testing track or later).
7. **Dev build required** either way — the native module isn't in Expo Go.

## Status — what's built vs stubbed
- **Fully built:** Landing (logo + tagline, Sign In/Create Account CTAs, and a
  "Learn More" slide-up bottom sheet — built with RN's `Modal animationType="slide"`,
  no extra deps), **Login** (native passwordless: email → attestation-gated
  `auth-gateway` → email-code sign-in), **OTP** (`otp.tsx` — 8-box email-code
  entry with auto-advance, backspace nav, paste/one-time-code autofill,
  shake-on-error, and a 30s resend cooldown routed through `auth-gateway`;
  `verifyOtp` type `email` for both flows), **Signup** (email+password →
  `auth-gateway` creates the account and routes to OTP), the auth/theme/navigation
  foundation, Supabase client + auth context,
  Stripe config, and a working Chat shell (top bar, empty state with suggestion
  chips, message input with a mocked assistant reply — no real AI/product cards
  yet). Account Settings has a real plan card, profile, navigation hub, and a
  confirmed **Sign Out** (red `danger` Button → `Alert` → `signOut()` → `/`)
  pinned in a sticky footer below the ScrollView — always visible, with a
  top-border divider separating it from the list.
- **Stubbed (`ScreenPlaceholder`):** TOS, Privacy Policy, the onboarding steps'
  business logic (plans/terms/delivery use simple navigation; `name` actually
  saves), Order History, Orders & Analytics, Wishlist, Auto-Reorder, Family
  Sharing, Cards & Address. Each stub lists what it will contain. Port them by
  reusing `Screen`/`Button`/`TextField`/`AuthLayout` and the `lib/` helpers,
  adding Supabase data calls that mirror the web `utils.js` functions.

## Conventions
- Import via the `@/*` alias (→ `src/*`); assets via `@/assets/*`.
- Pull all colors/spacing/radii from `src/theme/colors.ts` — no hardcoded hex.
- Brand name is **FetchIt** (capital I) in UI; lowercase `fetchit` only in
  code/identifiers (matches the web app's branding rule).
- Keep `src/lib/stripe.ts` `PLAN_PRICING` in sync with the web app's and the
  `create-subscription` edge function — the price shown is the price billed.
```
