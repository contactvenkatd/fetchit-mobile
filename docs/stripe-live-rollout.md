# Stripe production rollout

Updated September 15, 2026 (US Eastern). **Live backend authentication and
webhook configuration checks now pass. No successful payment has been verified.**

## Latest verification and remaining steps

- Production runtime `STRIPE_SECRET_KEY` successfully authenticates to
  **acct_1Th9uUQg8UTscDty**. Key mode and balance are live; charges and payouts are
  enabled and `card_payments` is active. Neither Stripe secret was retrieved into
  local tooling, printed or committed. The previous test-key blocker is resolved.
- `STRIPE_WEBHOOK_SECRET` is present. The backend independently lists endpoint
  **we_1UFn7YQg8UTscDtyMlgwUZy0**, enabled/live/own-account, exact production URL,
  API **2025-02-24.acacia**, and exactly the eight required events.
- Unsigned and invalid-signature webhook requests return 400. A synthetic,
  correctly signed `fetchit.configuration_probe` returns 200/ignored before
  Stripe/database reconciliation. This proves signature enforcement against the
  stored secret; it does not prove delivery from Stripe or payment reconciliation.
- **Publishable-key/account pairing is confirmed by the user in Stripe Dashboard**:
  the full supplied public key matches account `acct_1Th9uUQg8UTscDty`. Backend
  secret-key account identity is independently verified. The prior read-only API
  pairing attempt could not run because no existing live intent was available.
- The profile audit completed with no unavailable reads: 3 profiles, 2 without
  complete saved payment references, 1 wrong-mode/missing/ownership mapping, and
  0 verified live saved-card mappings. That existing card must be recollected
  through live card setup; records were preserved. Supabase backend database
  credentials worked for the audit, resolving the earlier uncertainty.
- Zinc Connect linkage/Apple Pay certificate remain Dashboard checks. Hosted web
  live-key settings are unverified; subscription CORS still defaults to
  `http://localhost:3000`. The sibling web development env has a test key against
  this production backend. Coordinate web settings before browser live checkout;
  development/preview still need their separate hosted test backend.
- Native Google sign-in still bypasses App Attest (see finding below). This
  remains a release concern; no auth code or tests were weakened.
- A fresh authorized EAS production iOS build attempt reached signing setup and
  failed with `Credentials are not set up. Run this command again in interactive
  mode.` Remote build number advanced **2 → 3**. No build queued; no build URL.
  Run `eas build --platform ios --profile production` in your own terminal to
  complete Apple signing. Do not add `--auto-submit`.

## Actually applied remotely

Authenticated access to production project **fpphpncruohjlppqhfep** succeeded.
Project name: `contactvenkatd's Project`, region `us-east-2`, `ACTIVE_HEALTHY`.
CLI 2.39.2 works; the installed 2.106.0 executable is terminated on this machine.

Production payment source was downloaded through the authenticated Management
API and decoded locally with the official ESZIP parser before comparison.
The six payment handlers and webhook were already deployed. This continuation
redeployed only `stripe-readiness` to add exact endpoint metadata, read-only key
pairing checks and the optional ignored signature probe. Current deployments:

| Function | Observed version after rollout | Gateway JWT |
| --- | ---: | --- |
| create-subscription | 22 | enabled |
| create-setup-intent | 15 | enabled |
| save-card | 15 | enabled |
| cancel-subscription | 19 | enabled |
| reactivate-subscription | 16 | enabled |
| place-order | 9 | enabled |
| stripe-readiness | 11 | disabled; separate admin credential required |
| stripe-webhook | 5 | disabled; Stripe signature required |

Secret updates incremented other function version counters. Their deployment
bundle hashes, source update timestamps, and JWT settings remained unchanged,
including auth-gateway and all attestation functions. No auth source was deployed.

Two reviewed, additive migrations were applied individually through the
Management API (no blanket `db push`):

| Local migration | Recorded production version |
| --- | --- |
| 20260915000000_stripe_webhook_state.sql | 20260915025010 |
| 20260915001000_preserve_stripe_profile_references.sql | 20260915025051 |

The API assigns execution-time versions. The second migration's initial schema
application succeeded but its history insertion collided with the first's
same-second version; an idempotent reapplication recorded it successfully.
Do not blindly reapply or repair the entire repository's migration history.
Existing counts stayed **6 users, 3 profiles, 2 orders**. All three new tables
have RLS enabled and client access revoked; the reference-archive trigger is
active. No existing data was deleted or rewritten by the migrations.

EAS project `cdbe685f-4a42-4078-8217-8c0e3489ed5a`
(`durick17/fetchit-mobile`) has the four public production settings below.
The production app configuration selects this Supabase project and the exact
supplied live publishable key. No Stripe secret is in EAS or mobile config.

## Configuration and flow changes

- `config/payment-environment.js`, Expo config and mobile Stripe/Supabase
  clients select validated environment-specific public settings. Production
  requires the approved key/project. Development/preview/test reject the
  production hostname and live publishable keys; defaults use local Supabase.
- Mobile checkout explicitly confirms on-device and checks for Stripe's
  `Succeeded` status. Free schedules actual cancellation; paid plan changes
  retain the existing cancellation policy and allow cancellation retry without
  starting another payment. The unsupported trial promise was removed.
- Backend payment handlers read `STRIPE_SECRET_KEY` only from backend storage.
  Production rejects test credentials. Stripe is pinned to 17.7.0 and API
  `2025-02-24.acacia` for the existing invoice confirmation response shape.
- Customer resolution checks mode and `supabase_uid` ownership. Only missing
  objects can trigger idempotent customer replacement in user-initiated setup
  or checkout. Old references are retained in server-written
  `app_metadata.stripe_customer_history` and mode mappings in `stripe_customers`.
  Network/authentication failures never trigger replacement.
- Saved cards must already belong to the verified customer and environment.
  Profile reference changes archive the old customer/payment-method IDs.
- `place-order` verifies ownership, mode and payment-method attachment before
  the existing Zinc Connect request. Zinc request structure is unchanged.
- Comparison with actual production found the prepared web-source copy added
  off-session PaymentIntent confirmation. That addition was removed; checkout
  retains production's client-confirmation flow. Actual deployed CORS behavior
  was preserved: setup/save-card allow `*`; subscription functions use
  `ALLOWED_ORIGIN`, currently falling back to `http://localhost:3000`.
  The hosted web origin must be configured before browser checkout is ready.
- Auth/JWT gates and App Attest entitlement selection were preserved.

The shared web source originally lives in
`/Users/neilduddukuri/fetchit-app/supabase/functions` (read-only here).
Synchronize the reviewed payment sources and shared helpers back to that owning
repository before any later web-side redeployment to avoid reverting safeguards.

No hardcoded product, price, customer or connected-account IDs were found in
payment source. Products use `metadata.fetchit_plan` (Plus/Pro/Max), with inline
prices. Existing checkout creates live products when needed; rollout checks did
not create products or transactions. Mode cannot be determined from `cus_`,
`pm_`, or `acct_` prefixes. Database reads found **4 users with customer references,
1 profile with a customer/payment method, and 0 server-stored live mappings**.
One user has Max metadata. These facts do not establish Stripe mode or payment
status. Audit against the corrected live account, preserve old references, and
collect fresh live cards where necessary; do not invent or delete IDs.

## Exact environment variables

| Scope | Name | Purpose |
| --- | --- | --- |
| Mobile/EAS | APP_ENV | production / preview / development / test |
| Mobile/EAS | EXPO_PUBLIC_STRIPE_PUBLISHABLE_KEY | supplied public live key in production; test elsewhere |
| Mobile/EAS | EXPO_PUBLIC_SUPABASE_URL | production project URL or separate test backend |
| Mobile/EAS | EXPO_PUBLIC_SUPABASE_ANON_KEY | selected backend public client key |
| Backend only | STRIPE_SECRET_KEY | matching active live Stripe secret; runtime verified |
| Backend only | STRIPE_WEBHOOK_SECRET | production endpoint signing secret; present and signature probe passed |
| Backend only | STRIPE_READINESS_TOKEN | generated admin diagnostics credential, stored only as a secret |
| Backend only | SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY | Supabase-injected backend settings |
| Order function | SUPABASE_ANON_KEY, ZINC_API_KEY | user-scoped database access and Zinc credential |
| Subscription functions | ALLOWED_ORIGIN | actual production web origin for CORS |
| Web frontend | REACT_APP_STRIPE_PUBLISHABLE_KEY | matching public live key |
| Web frontend | REACT_APP_SUPABASE_URL, REACT_APP_SUPABASE_ANON_KEY | web backend target/public key |

## Secure secret entry and webhook setup

Reference instructions: both secrets are now configured and the endpoint exists.
Do not recreate it or overwrite secrets unless correcting a verified problem.

1. Open the intended Stripe account's **live API keys** page. Verify it contains
   the exact publishable key supplied for this app. Use the newly rotated live
   secret, never the previously exposed secret.
2. Open [production Supabase → Edge Functions → Secrets](https://supabase.com/dashboard/project/fpphpncruohjlppqhfep/functions/secrets).
   Edit `STRIPE_SECRET_KEY`; enter only the new live secret value, without quotes
   or a `STRIPE_SECRET_KEY=` prefix, and save. Do not paste it into chat or shell
   commands. Secret changes do not require putting the value in a deployment.
3. In that same live Stripe account, open **Workbench → Webhooks → Create an
   event destination**. Choose **Your account**, snapshot events, API version
   `2025-02-24.acacia`, and this already-deployed endpoint:

   `https://fpphpncruohjlppqhfep.supabase.co/functions/v1/stripe-webhook`

   Enable these eight events:

   - customer.subscription.created
   - customer.subscription.updated
   - customer.subscription.deleted
   - customer.subscription.paused
   - customer.subscription.resumed
   - invoice.paid
   - invoice.payment_failed
   - invoice.payment_action_required

4. Copy that destination's signing secret directly into `STRIPE_WEBHOOK_SECRET`
   on the Supabase secrets page and save. Use neither a test endpoint secret nor
   a Stripe CLI listener secret. Never paste it into chat.
5. Repeat the admin-only readiness GET using trusted backend tooling. It accepts
   the injected service-role Authorization credential or `x-readiness-token`
   matching backend `STRIPE_READINESS_TOKEN`. Neither credential belongs in the
   mobile app. This session generated the diagnostic token in process memory and
   stored it only in backend secret storage; it was not printed or saved locally.
   It also supports `?verify_webhook=1` to send a signed, ignored configuration
   event to the deployed handler. The latest runtime database audit succeeded.
6. Confirm account identity against the publishable-key Dashboard, balance live
   mode, charges/card-payment capabilities, account requirements, the enabled live
   destination and required events, and stored reference ownership/mode. Verify
   Apple Pay merchant `merchant.ai.compreo.fetchit` and its processing certificate
   in Stripe. Verify Zinc's live Connect linkage in Zinc's Dashboard. The audit
   cannot prove publishable-key pairing or Zinc linkage by itself.

The webhook verifies the raw Stripe signature and mode/account scope, reads
current subscriptions, validates customer/user ownership and applies an atomic,
replay-safe, ordered metadata snapshot. Active/trialing/past_due retain access;
canceled/unpaid/paused lose paid access when no usable subscription remains.
Initial incomplete checkout does not grant access or revoke an unrelated plan.
Family membership metadata is preserved. Database failures cause retryable 500s.

## Verification results

- All eight deployed functions are ACTIVE. Six payment endpoints returned 200
  to OPTIONS and 401 to unauthenticated POST. Readiness rejected unauthenticated
  GET with 401. These establish routing/access controls, not successful payments.
- Admin readiness: HTTP 200, live authentication, expected account, active card
  payments and matching live webhook endpoint/version/events. Unsigned/invalid
  webhook signatures return 400; the signed non-financial probe returns 200/ignored.
  Publishable-key pairing was subsequently confirmed by the user in Dashboard.
  See the latest audit counts and limitations above.
- Mobile TypeScript and all eight Deno entrypoint checks pass.
- Nine Node payment/configuration/reconciliation tests pass.
- Four offline Deno tests pass: signature/timestamp/mode checks, production test-key
  rejection, customer transition/ownership/idempotency, and SQL replay/ordering/
  reference preservation/permissions. Dummy test credentials only; no network
  permission was granted to those tests.
- Full Node suite: **19 pass, 1 skipped, 1 failure** (Google App Attest bypass).
- Prior production iOS export passed (1,913 modules); this is not a device test.
- `git diff --check` passes. Runtime validation created no financial transactions,
  Zinc orders, data deletion or App Store submissions. The user subsequently
  authorized committing and pushing the reviewed rollout sources; this does not
  resolve the outstanding rollout items above.

### App Attest release finding

`src/app/login.tsx:107` and `src/app/signup.tsx:102` call
`supabase.auth.signInWithIdToken({ provider: 'google', ... })` directly from enabled
Google buttons, without attestation. Apple OAuth also calls Supabase directly.
The actual deployed auth-gateway supports email signup/login/resend/OTP/password
operations, requires attestation, and has no OAuth action. Therefore Google does
**not** use the required attested flow. The failing assertion must not be waived
because compilation passes. Resolve OAuth gateway support and token-bound
attestation with appropriate tests before releasing. Auth code/test behavior
was preserved during this payment task; physical-device App Attest verification
is still required after an eligible build is installed.

## iOS build and installation

**The new build attempt failed before queueing; no build URL exists.**
EAS is authenticated as `durick17`. The latest attempt consumed build number 3
and stopped at Apple signing setup. Run from this repository:

```sh
eas build --platform ios --profile production
```

At the Apple-account prompt, complete Apple Developer login/2FA in the terminal,
select the correct team, then allow EAS to select/create the production distribution
certificate and provisioning profile. The next attempt may increment the build
number again. Do not add `--auto-submit`. EAS prints a build URL when queued.

The production profile is store-signed. Its IPA cannot be directly installed by
an ad hoc installation link. After build success, a separately authorized upload
to App Store Connect/TestFlight is required for TestFlight installation; none was
performed here. Once processed, add the build to the tester group, accept the
invitation on the iPhone and Install/Update FetchIt in TestFlight, checking the
build number. Direct installation instead needs a separately configured ad hoc
profile and registered UDID; existing preview deliberately uses test payments.
An already-installed test-key binary does not change when backend secrets change.

## API webhook setup when Dashboard only offers Dahlia

Historical setup: the user authorized creating the Acacia endpoint through Stripe's API and saving
its signing secret directly to production Supabase. At that step no locally available newly
rotated live Stripe credential was found, so the agent supplied the script below.
The user subsequently ran it successfully; endpoint and secret presence are now
independently verified as reported above. Do not create another endpoint.
For future recovery only, the prepared script is:

```sh
python3 scripts/configure-stripe-webhook.py
```

It prompts for the newly rotated live key with hidden input, uses the existing
Supabase CLI macOS Keychain login (or prompts secretly for a Supabase access token),
checks all existing endpoint pages, and creates only if this URL is absent.
A conflicting endpoint stops execution without creating a duplicate. An exact
existing endpoint is reused and requires hidden input of its Dashboard signing
secret because Stripe does not return that secret on GET.

Creation explicitly requests `connect=false`, `2025-02-24.acacia`, exactly the
eight events above, and description `FetchIt Production Webhook`. The response
is verified and independently retrieved before the secret is sent directly to
Supabase. Credentials/raw responses are never printed or stored in files.
Stripe rejection prints HTTP status and sanitized type/code/param/message;
there is no version fallback or account-default change. Five offline checks
passed for exact parameters, reuse, conflict refusal, redaction and doc parity.
The script does not change `STRIPE_SECRET_KEY` or create financial transactions.
Endpoint configuration verification does not establish successful webhook
reconciliation or an end-to-end payment.


## Duplicate destination check — September 15

User confirmed the full production public key matches the expected live account.
Backend inspection now finds two enabled own-account destinations with identical
URL, live mode, Acacia version and all eight required events:

- Original: `we_1UFn7YQg8UTscDtyMlgwUZy0`
- Additional: `we_1UFnTvQg8UTscDtyzYEbRfnv`

The stored signing secret passes the synthetic ignored-event probe, but this
alone does not identify its destination. Stripe GET/list does not expose existing
signing secrets. **Neither destination was disabled or deleted, and neither
Stripe secret was changed.** Endpoint-specific secret matching is still required.

Run in your own terminal:

```sh
python3 scripts/deduplicate-stripe-webhooks.py
```

The simplified workflow prompts **only for the original destination's signing
secret**, with hidden input. It reuses the existing Supabase CLI login and the
live Stripe API key already stored on the backend. No second signing secret or
Stripe API key is requested. If CLI login is missing, it exits with the login
command rather than asking for another credential.

The script sends a signed, ignored event to the deployed webhook, then sends
that same proof to the narrow `stripe-webhook-cleanup` backend helper. The helper
requires privileged production CLI access, verifies the proof against the stored
secret and actual handler, checks the account and both exact configurations,
and disables only `we_1UFnTvQg8UTscDtyzYEbRfnv`. The original must remain enabled.
Neither signing secret is transmitted; only a timestamped HMAC proof is sent.
Working secrets are never changed. Already-disabled retries do not repeat the
mutation. The helper has no delete, secret-write or financial-transaction path.

Offline tests verify one hidden prompt, failed-proof refusal, admin rejection,
exact disable-only mutation and idempotent retry. The helper was deployed to make
the workflow runnable. Cleanup itself has not run with the original secret;
both destinations remain unchanged until the user runs the script successfully.

### Hidden-input validation update

The cleanup script accepts nonempty `whsec_` values without a fixed-length rule
and trims surrounding whitespace. Rejections now identify empty input, masking
characters/dots, wrong key types, IDs, variable assignments, quotes, missing
prefix/value, internal whitespace or hidden formatting, without echoing input.
The earlier generic message did not establish which mistake occurred; no actual
user secret was inspected. Hidden input fails closed if terminal echo cannot be
disabled. Six offline tests pass, including one-prompt behavior, no network on
invalid input and mandatory deployed-handler verification before cleanup.
No backend redeployment or secret changes are needed for this local script fix.
