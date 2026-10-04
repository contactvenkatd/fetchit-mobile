# Build 13 purchase and fulfillment audit

Verdicts: **Still blocked** for end-to-end checkout and **Still blocked** for purchase and delivery on build 13. No live orders, holds or charges were created. Production credentials were preserved. No replacement build was started.

## Artifact and deployed source

Inspected signed FetchIt 1.0.0 (13), EAS `3ada634e-b702-4186-a4ca-674a39790bef`. IPA SHA256: `79c59c06e5005a03512687b60b4479b311ac8a6e6de78f6ee2f68239cd75e4d0`. Checkout source digests matched the saved release evidence before fixes; bundle contains estimated-cost consent. Apple internal TestFlight availability was previously confirmed by the user's supplied VALID/BETA_INTERNAL_TESTING output, not independently queried in this audit.

At audit start, deployed place-order v14 was ACTIVE with JWT verification, estimate consent and no guaranteed-maximum-only guard. Search-products v12 dropped currency. Backend fixes deployed in this audit: place-order v15 and search-products v13, both ACTIVE with JWT verification. These do not update build 13's client bundle.

## Confirmed blockers in build 13

- Search-to-checkout loses price currency. Checkout correctly refuses unknown/non-USD currency. Fixed backend preserves an explicit currency and excludes confirmed unavailable products, but Zinc's documented search schema does not establish a currency field or an all-results-USD guarantee. Unknown currency remains blocked rather than guessed.
- Submission protection is screen-local. An automated probe using the verified build-13 source snapshot reproduced an uncertain response followed by a restart producing two POSTs with different idempotency keys. Both provider requests were mocks. Fixed source persists a per-user SecureStore journal before submission and restores acceptance or uncertainty across restarts. It fails closed when recovery is unavailable. This is device-local protection, not a cross-device atomic reservation; unresolved submissions require reconciliation/support.
- Order history does not refresh Zinc state; later failures/shipping can remain stale. Fixed source polls scoped status every 30 seconds, separates retailer state from payment capture, and displays tracking/estimated delivery. Backend now maps shipped/in-transit/delivered and gives failure precedence over stale delivered tracking.
- Requested size/color was not passed as an order variant. Fixed source discloses variants, binds them to consent and sends Zinc's documented Size/Color variant array. Strict fulfillment is retained. A client replacement is necessary to ship these three client fixes.

No new client build was started: the authoritative search-currency question still prevents complete verification, so another signed build now would not resolve all blockers.

## Checkout, payment and address checks

Estimated-cost wording and explicit variable-fee consent are present. USD-only checkout, zero FetchIt markup, verified $1 Zinc fee, unknown shipping/tax/processing labeled unknown, and a separately approved retailer max_price budget remain enforced. No unsupported processing percentage is added. The budget caps retailer costs including shipping/tax; it does not promise an all-in charge ceiling. The initial item-only budget may be insufficient; increasing it requires fresh consent, never an automatic retry.

Automated checks exercised orderable product URL, quantity, selected variants, USD, retailer budget, saved customer/payment-method ownership, and all shipping fields including apartment/unit. The backend uses authenticated profile data rather than caller-supplied addresses/cards. Added US-state completeness preflight. Card decline, provider-mode mismatch, timeout, malformed acceptance and uncertain persistence are rejected or marked uncertain, not completed. An accepted Zinc request is not proof of capture or delivery.

## Read-only production checks

Live Zinc wallet verified user **1035**, order fee **100 cents**. Stripe verified live account **acct_1Th9uUQg8UTscDty**, charges enabled and card payments active. Existing SetupIntent readback confirmed publishable/secret key pairing. Stored profile audit: 3 profiles, 1 valid, 1 missing payment references, 1 wrong mode/owner; the latter two must repair their saved payment setup before purchasing.

Fresh GET /settings/connect returned 404, so this audit could not freshly verify Zinc's account-to-Stripe linkage. Earlier authenticated administrator evidence reported user 1035 linked to this same Stripe account and ready. A 404 is not evidence of a disconnected account. A temporary authenticated read-only audit function was removed after use. Secret digests were checked before/after; no credentials were changed or returned.

## Fulfillment expectations and limits

Public retailer catalog lists verified US Amazon and active US Walmart/Target/Best Buy. A representative documentation Amazon URL returned orderable=true, US support and guest checkout; this is retailer support evidence, not stock evidence for a customer-selected SKU. No specific customer SKU was supplied. No metered live search/details call was made because it could debit the account.

Zinc's strict order rules are expected to purchase the requested available item/quantity/variant and ship to the mapped customer address when retailer checkout succeeds and the approved retailer budget is sufficient. An unavailable item, unavailable variant, invalid address or exceeded budget fails the order rather than proving shipment. Tracking is supplied after retailer shipment and may contain multiple packages. Sandbox delivered states are simulations, not proof of real shipment.

References: [create order](https://www.zinc.com/docs/v2/api-reference/orders/create-order), [tracking](https://www.zinc.com/docs/v2/api-reference/orders/tracking), [retailer support](https://www.zinc.com/docs/v2/api-reference/retailers/list-retailers), [search schema](https://www.zinc.com/docs/v2/api-reference/search/cross-retailer), [Connect](https://www.zinc.com/docs/v2/connect).

## Verification results

- Baseline build-13 flow: **57 offline tests passed**; these did not previously cover the reproduced restart defect.
- Fixed source: **67 offline UI/backend/provider-safety tests passed**. React Native primitives, Supabase auth/database, and provider behaviors are mocked. Real application service, checkout, estimate, handler and status logic are exercised. Not native-device testing.
- Real Zinc sandbox: all **4 scenarios passed** on baseline and fixed source: simulated success/delivery, asynchronous price exceeded, invalid address, insufficient funds. Duplicate-key response checked separately. Real Zinc test API; mocked authentication/database/Stripe references; no actual retailer purchase, real shipment or combined live Connect verification.
- Stripe: reused successful saved test-component evidence, run `1109f588-5009-4e83-8b5f-40e67dab7655`: authorization, idempotency, excessive-capture rejection, lower capture and decline. **Zero new Stripe financial operations**. This is separate from Zinc-owned Connect.
- TypeScript: `npx tsc --noEmit` passed.

Exact Zinc Support question: **For GET /search, is every results[].price denominated in USD cents, including international retailer URLs; if not, what authoritative field or free read-only endpoint gives the price currency for the returned orderable URL?**

Fresh Connect linkage confirmation is also required before claiming combined production readiness: confirm live Zinc user 1035 is currently linked and enabled for Stripe account acct_1Th9uUQg8UTscDty, and identify the supported read-only way to verify that linkage when GET /settings/connect returns 404.

Production placement endpoint is enabled for valid, explicitly approved USD requests; normal build-13 shopping is not verified usable end to end. Complete verification requires authoritative currency evidence, fresh Connect linkage confirmation, and a tested replacement client containing recovery, variants and order-history fixes. No real retailer purchase or delivery has been verified.
