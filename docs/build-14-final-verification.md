# Final build 14 verification

Apple accepted FetchIt **1.0.0 (14)**, delivery `9f7d22d4-0ce8-45fc-907f-7f3e7b38b7bb`: `IMPORT-STATUS: VALID`, `BUILD-STATUS: BETA_INTERNAL_TESTING`, and `IS-ON-APP-STORE-CONNECT: true`. It is available for internal TestFlight and is no longer processing. External testing approval is not established by delivery status. The status-only wrapper called `scripts/submit-testflight.py`'s parser and hidden Terminal password prompt; no password was printed or saved. No rebuild or upload occurred during this audit.

## Source, deployment and checkout

The signed IPA checksum remains `40c63caf35eea6983fca4dbdec51a3d28e46a521434340398245beb856fa3dc7`. Final production source digests match the verified release. Fresh read-only deployed function bodies match the previously verified bodies byte for byte: place-order v16, search-products v15, and stripe-readiness v18. No client or backend production code changed in this audit.

- The server computes our fee once: `200 + floor((itemSubtotalCents * 35 + 500) / 1000)`, using integer BigInt intermediates. Item subtotal is verified unit price times quantity, excluding all other fees. Zinc receives only our flat margin through Connect. One **Service fee** line adds Zinc's verified 100 cents once; components remain separate internally.
- Explicit USD price evidence can proceed. Unknown or conflicting currency is blocked. Signed provider price evidence and server-derived subtotal reject client price/fee tampering. The obsolete guaranteed-maximum pricing guard is absent.
- Explicit consent covers the estimate, unknown shipping/tax/processing, and separate enforced retailer budget. Changes invalidate approval. Authenticated saved payment references, product, quantity, Size/Color and complete profile shipping address—including apartment/unit—map to Zinc.
- A persistent device-local journal records an attempt before submission. Duplicate taps, timeouts, uncertain replies and app restarts retain the same attempt and do not issue a new purchase. Unknown outcomes remain locked for reconciliation. This does not provide cross-device atomic exclusion or protection after deleting app/keychain data.
- History polls current retailer/payment/shipment/tracking state. Later failure overrides stale shipment success; failed or unavailable payment/status cannot become a completed purchase. Exact stock, variant availability and retailer budget remain prerequisites; fulfillment failure cannot silently substitute another item.

## Tests

Reused unchanged evidence: **83 automated UI/backend/provider checks**, **four real Zinc sandbox simulations**, **15 upload-script regression checks**, TypeScript, and saved separate Stripe test evidence `1109f588-5009-4e83-8b5f-40e67dab7655`. Stripe tests were not repeated.

Additional automated checks: **3 passed** (`node --test tests/checkout-e2e/final-build14.test.cjs`). These cover actual search normalization/signing through USD quote/consent/submission with quantity, variants, saved card and apartment address; accepted-attempt recovery after reload; unresolved-currency blocking; and mounted history polling through transit, delivery, failure and unavailable status. Native primitives, authentication/database and provider responses are mocked. These are not native-device tests.

Additional real Zinc sandbox check: **1 passed** (`RUN_BUILD14_TARGETED_ZINC_SANDBOX=1 node --test tests/checkout-e2e/final-build14.test.cjs`). It uses the same mapping and recovery path with real Zinc test API submission/readback. Search, authentication/database and Stripe references remain fixtures. Zinc's purchase and fulfillment are simulated; this does not verify a live retailer order, actual variant stock, shipment, or combined live Connect capture. No new Stripe financial operation or live order/hold/charge occurred. Whitespace checks passed.

## Production expectation and remaining gaps

Recent read-only evidence identifies Zinc user **1035**, order fee **100 cents**, and live Stripe account **acct_1Th9uUQg8UTscDty** with charges enabled and card payments active. Fresh credential digests are unchanged. Earlier authenticated administrator evidence linked these accounts and reported Connect ready. The available `/settings/connect` endpoint returns 404, so current linkage could not be freshly confirmed; 404 does not establish disconnection.

For supported, in-stock, explicitly verified USD items, the code supports ordering through Zinc and shipment to the supplied address, provided the live Connect linkage remains active and the saved card/address and retailer budget are valid. An unconditional production end-to-end verdict remains blocked by the unconfirmed current Connect linkage. Listings without currency remain individually blocked; eligible USD checkout is enabled.

Exact remaining currency question: **For a cross-retailer GET /search result without currency/currency_code, what authoritative per-result field or documented retailer/domain rule establishes the ISO currency and minor-unit scale of price?** The documented Etsy USD rule belongs to a different endpoint and cannot establish this contract.

Exact remaining configuration question: **Is Zinc user 1035 currently Connect-ready for Stripe account acct_1Th9uUQg8UTscDty, and which supported read-only endpoint confirms that linkage?**

No actual live purchase or delivery was verified. Retailer acceptance and carrier completion are not guaranteed. See [the implementation and prior provider evidence](replacement-checkout-fulfillment-verification.md) for the complete mappings, official documentation and earlier test limits.

## Strongest continuous verification follow-up

**Complete automated flow: passed within the partial-integration boundary below.** Two additional real Zinc test orders were used, without repeating the earlier four scenarios or separate Stripe financial tests:

1. Actual checkout UI and backend handler: signed eligible-USD fixture → quantity 2, Large/Black → subtotal 2000 cents, our margin 270 cents and combined Service fee 370 cents → explicit consent → saved card/customer → complete saved-profile address → one Zinc acceptance despite two taps → accepted journal survives reload → actual `src/lib/data.ts` mapper reads the backend's inserted row → actual order-history status service polls that same Zinc ID → tracking and simulated delivery shown, with simulated payment and no claim of captured funds or real shipment. All first/last name, address line 1/2, city, state, postal code, phone and country values were asserted.
2. Real Zinc sandbox accepts an order, then the test injects a lost response before the backend sees acceptance. No successful local order is fabricated. Fresh client modules restore the unresolved journal and prevent another submission. A test-only readback confirms the original simulated order exists; only one purchase POST occurred.

Both passed. Real coverage is Zinc's test API POST/GET and its simulated tracking/delivery. The actual release screen, services, integer arithmetic, signing, backend handler, DB-row mapping and status normalization execute locally. Native UI primitives, authentication, database transport and Stripe saved-reference reads are mocked; the eligible USD listing is a signed search fixture. This is not a call through deployed Supabase authentication/RLS/network infrastructure. Deployed source equality and previous read-only schema/RLS checks provide separate evidence. No full live Connect payment capture, stock purchase or carrier operation was tested.

Affected checks rerun: **3 targeted offline tests passed** and **12 safety tests passed**, including decline, timeout/restart, unavailable products, missing US state, fulfillment failures and recovery corruption. Earlier real invalid-address and insufficient-funds sandbox cases and unchanged fee/tampering tests remain applicable. No confirmed production defect was found; only tests and evidence changed. Build 14 remains current; no rebuild is needed.

### Ordinary search and current account checks

A single free `zn_test_` cross-retailer search for a cast-iron skillet returned **10 results, zero explicit USD currencies, and 10 missing currency fields**. This is an actual search response, not the eligible USD fixture used for checkout. Every result in that sample would be blocked by the final normalizer/checkout contract. The official `/search` schema and four documented examples also omit currency. Thus ordinary search is a practical blocker, not merely a hypothetical malformed-input case. Production prevalence was not measured: [Zinc documents](https://www.zinc.com/docs/v2/api-reference/search/cross-retailer) that successful live searches debit the wallet, so no live search was made under the no-charges instruction. Neither the test sample nor documentation proves that most production results are missing currency.

A fresh authenticated read-only GET to the existing deployed stripe-readiness function confirmed live **acct_1Th9uUQg8UTscDty**, charges/payouts enabled, active card payments, and verified existing-SetupIntent publishable-key pairing. Of three profiles, one has valid payment references, one is missing references, and one has wrong-mode/owner references. Only valid saved references can proceed; the others must save a valid card. No transaction was created or mutated.

The current Zinc Connect linkage gap remains: the API endpoint previously returned 404 and no supported alternate account-read endpoint was found in the official contract. Browser access to the signed-in dashboard was rejected by automatic approval; Google Chrome access was not approved. This rejection prevented fresh dashboard verification, and was not bypassed. Stripe's readiness alone does not prove Zinc's linkage. Earlier linked/ready evidence remains historical evidence.

**Expected to purchase through Zinc and ship to the saved address: no unconditional production verdict yet.** The demonstrated eligible-USD flow supports that expectation only with an active live Zinc linkage to the intended Stripe account, valid saved card/address, supported retailer, available exact variant/quantity and sufficient retailer budget. Missing-currency search results cannot currently reach purchase. The exact currency and linkage questions above remain unresolved.

Still unverified: native iPhone execution/real SecureStore lifecycle, the complete deployed authenticated purchase path, a Zinc-owned live Connect authorization/capture, current production SKU stock/variant availability, a real retailer accepting the saved address, and an actual carrier shipment/delivery. Device-local restart tests do not establish cross-device exclusion or recovery after app/keychain deletion. Sandbox delivery and separate Stripe tests do not establish any real shipment.

## Superseding currency fix

The subsequent [backend-only currency search resolution](currency-search-resolution.md) opens documented verified-USD Etsy search results and passed an actual search-to-checkout-to-Zinc simulated delivery flow. Build 14 remains current. Other unresolved-currency listings stay blocked; current Connect dashboard confirmation remains pending. Earlier deployed search-v15 and ordinary-search-blocked observations above describe the state before search-v16 deployment.

## Fresh dashboard readiness confirmation

The user reports the current Zinc dashboard shows Connected and Your account is ready. This closes the pending manual readiness check. Zinc user 1035 and Stripe acct_1Th9uUQg8UTscDty are attributed separately to earlier authenticated ID verification; the fresh dashboard confirmation does not independently verify IDs it does not show. No completed tests were repeated. The final supported-USD purchase expectation and remaining native/live limits are recorded in [the currency search resolution](currency-search-resolution.md).
