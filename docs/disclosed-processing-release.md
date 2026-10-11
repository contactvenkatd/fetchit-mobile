# Disclosed processing checkout — 2026-10-11

Checkout now has Product price, Shipping, Tax, FetchIt fee and Processing fee,
with Total beneath. FetchIt fee is $2 + 3.5% of quoted item subtotal, rounded once
server-side with integer arithmetic. Zinc receives only $1 + 3.5% as a flat margin;
its automatic $1 completes the displayed fee. No separate transfer is made.

Production shipping, tax and processing amounts are not available as verified
pre-submission quotes. They remain null/Unknown, and Total remains Unknown.
The UI explicitly explains that the authorization includes the retailer budget,
FetchIt fee and additional provider-determined processing. It does not advertise
an all-in numeric payment ceiling. Approval now includes `acceptsProcessingFee`
and the v7 quote digest; old exact-total consent cannot submit. The retailer
budget still caps item, shipping and tax. Address, payment, quantity, variants,
signed offer, budget and expiry changes invalidate consent. The approved flat
FetchIt fee does not silently grow when retailer costs change.

The authenticated production account responses do not expose an applicable
processing schedule. Zinc's [Connect documentation](https://www.zinc.com/docs/v2/connect)
gives a 2.9% + $0.30 example; this is not treated as production account pricing.
The real sandbox matched nearest-cent((retailer budget + margin + 100 + 30) / 0.971)
in eight fresh cases, including fee-rounding boundaries and different budgets.
That calculation is test-only. Production does not assume it.

## Verification

- 117 affected automated checks passed: five-line display and total summation,
  fee rounding/no double count, actual handler margin, explicit processing consent,
  changed and expired approvals, saved address/variant mapping, failure refresh,
  duplicate taps, uncertain outcomes and durable restart protection.
- Four Python read-only diagnostic checks, TypeScript noEmit and diff checks passed.
- Eight real Zinc sandbox cases passed through actual UI/service/handler source:
  authorization arithmetic, acceptance, duplicate-key rejection, saved fixture
  address mapping, restart recovery, seven simulated deliveries and one price failure.
- Native view primitives, Supabase auth/database and Stripe saved-reference reads
  were mocked. This is a partial integrated provider test, not native end-to-end
  production checkout. No new standalone Stripe payment test was performed.
- Sandbox Connect stayed `secured`, with capture, processing fee and transfer fields
  absent. Actual capture and settlement remain unverified. A secured amount is not
  reported as captured money. The failed-order simulation does not prove live hold release.

Sanitized evidence: [sandbox observations](disclosed-processing-sandbox-evidence.json),
[deployed configuration readback](deployed-settlement-diagnostics.json), and
[release verification](disclosed-processing-release-evidence.json).

## Deployment and replacement build

The additive evidence migration was applied and its four columns verified.
`place-order` v21 and `search-products` v20 are active in project
`fpphpncruohjlppqhfep`, with JWT gateway gates preserved. Full deployed source-map
readbacks match all local release modules. Unauthenticated quote POST returns 401.
No authenticated production purchase was submitted as a deployment test.

The backend persists sanitized quote/consent and retailer/provider cost evidence.
Owned status refresh synchronizes local failure status and error codes, while a
persistence outage does not hide a freshly read failure. Missing seller, shipping
service and fulfillment evidence remains unknown; quoted offers are separate.

One replacement production iOS build was requested: version 1.0.0 (16),
[EAS 41b73085-0f1a-4450-9e01-f2e06663ee1a](https://expo.dev/accounts/durick17/projects/fetchit-mobile/builds/41b73085-0f1a-4450-9e01-f2e06663ee1a).
The downloaded IPA passed deep/strict code-signature verification, app identity
and version/build checks, App Store provisioning checks, production App Attest
entitlement checks, native SecureStore presence, and checkout/recovery bundle
markers. All release source digests remain unchanged. Native device execution
was not tested. See [artifact verification](disclosed-processing-artifact-verification.json).

`config/testflight-release.json` now selects this verified build for the existing
hidden-password upload workflow (`python3 scripts/submit-testflight.py`). No
upload was attempted; Apple processing and TestFlight availability are unverified.
Uploading requires the separate Apple app-specific password through that hidden
Terminal prompt, not the already verified Stripe credential.
Older builds reject v7 quotes and require this replacement for new purchases;
durable accepted/pending recovery records are preserved.

No live order, hold, charge, capture, transfer or refund was created. The original
failed order was not retried. No credentials or payment models were changed.
