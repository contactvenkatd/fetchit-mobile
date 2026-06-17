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
    login.tsx                # ✅ password check → signOut → signInWithOtp → /otp (login)
    signup.tsx               # ✅ signUp → /otp (signup); name/password collected here
    otp.tsx                  # ✅ 8-digit email OTP — params {email, mode}; verifyOtp
                             #   (type 'email' for login, 'signup' for signup),
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
    ui/                      # Logo, Screen, Button, TextField
  lib/
    supabase.ts             # client + chunked SecureStore storage adapter
    stripe.ts               # publishable key + PLAN_PRICING (mirrors web stripeClient.js)
    auth.tsx                # AuthProvider/useAuth + signIn/signUp/signOut + getPlan/getName
  theme/
    colors.ts               # palette, radius, spacing, font sizes
assets/images/fetchit-logo.png   # brand badge (copied from the web app's public/)
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

## Status — what's built vs stubbed
- **Fully built:** Landing (logo + tagline, Sign In/Create Account CTAs, and a
  "Learn More" slide-up bottom sheet — built with RN's `Modal animationType="slide"`,
  no extra deps), **Login** (password verify → `signOut` → `signInWithOtp` → OTP,
  an email-code 2FA step), **OTP** (`otp.tsx` — 8-box email-code entry with
  auto-advance, backspace nav, paste/one-time-code autofill, shake-on-error, and
  a 30s resend cooldown; `verifyOtp` type is `email` for login / `signup` for
  signup), **Signup** (creates the account then routes to OTP for email
  verification), the auth/theme/navigation foundation, Supabase client + auth context,
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
