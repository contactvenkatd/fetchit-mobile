# Currency-bearing search resolution

Backend search now provides a supported currency-bearing shopping path. Build **14** remains current: no client code changed, so no rebuild or upload was needed. Search-products **v16 ACTIVE**, JWT verification enabled, was verified by comparing the original source in its downloaded deployed source map exactly with the tested source. Credential digests are unchanged; place-order remains v16 and stripe-readiness v18.

## Supported search path

Cross-retailer prices are never assumed to be USD. When that search has no eligible USD result, the server requests `/products/search?retailer=etsy` and puts eligible Etsy results first. An Etsy preference uses the supported endpoint directly. The provider's actual currency_code and price are preserved and signed; the URL must match the provider's numeric product ID on www.etsy.com. Malformed/unrelated URLs are excluded. Missing, conflicting and non-USD currency cannot obtain USD proof. Fallback failure preserves the original blocked results. Existing verified USD results avoid the extra call.

[Zinc's documented retailer-specific search](https://www.zinc.com/docs/v2/api-reference/products/search) establishes Etsy's USD search scope, currency_code and minor-unit price contract. A real test-key call returned those fields; the continuous flow retained an actual returned price and URL unchanged. It did not replace the item with a test-success URL or mock currency.

This opens normal shopping through verified Etsy results. It does not establish currency for every Amazon or other cross-retailer result; those individual purchases remain blocked. Fallback results identify their actual retailer. A query can still return no eligible available product.

Successful production data calls cost $0.01 each from the Zinc wallet under the documented contract; fallback may add one call to cross-retailer search, while direct Etsy search uses one. Test keys are unmetered. No live data call or wallet debit occurred here. Search requires sufficient wallet funds; current production balance was not freshly verified. Data-call costs were not invented as checkout processing fees.

## Verification

**55 affected automated checks passed**, including three new search-contract checks and existing fee, consent, tampering, decline, unavailable-product, address/variant, timeout/restart and status-failure coverage. TypeScript and whitespace checks passed.

**One real Zinc sandbox continuous flow passed**:

```sh
RUN_REAL_CURRENCY_SEARCH=1 node --test tests/checkout-e2e/currency-search.test.cjs
```

Actual free cross-retailer search → actual Etsy search currency/price → real signed price proof → actual checkout UI, quantity two, fee/consent → saved card references and complete saved-profile address → actual backend handler → real Zinc test API acceptance of the same retailer URL → two taps produce one POST → freshly loaded client restores accepted attempt → actual saved-row mapper → actual history screen polls the same order → tracking and simulated delivery, with simulated payment and no captured-funds claim.

Native primitives, authentication/database transport and Stripe reference reads are mocked. The saved address is a test profile; first/last name, both street lines, city, state, postal code, phone and country were asserted against the Zinc request. This does not exercise a customer's real card/address or deployed authenticated purchase network. The real result was ordered without invented size/color selections; unchanged separate tests cover variant mapping and consent. Sandbox acceptance does not establish live variant stock.

Previously passing real Zinc failure scenarios, lost-response-after-acceptance recovery and separate Stripe component evidence were reused. No new Stripe financial tests were run. Sandbox delivery remains simulated.

A read-only `/retailers/check` for a returned Etsy URL reported orderable true, support active, guest checkout, and guidance to POST that URL normally. This supports Zinc submission for Etsy; stock, address acceptance and carrier completion remain order-specific and are not guaranteed.

## Live linkage and verdict

Fresh read-only Stripe evidence identifies live **acct_1Th9uUQg8UTscDty**, charges/payouts enabled, active card payments and verified existing-SetupIntent key pairing. Earlier authenticated Zinc dashboard evidence confirmed user **1035** linked to this account and ready. The unsupported endpoint's 404 does not prove disconnection. Current official OpenAPI lists no Connect/settings status route; browser access was previously rejected by automatic approval.

The requested manual read-only check was: **In the signed-in Zinc dashboard, open Settings → Stripe Connect; confirm Zinc user 1035, connected account acct_1Th9uUQg8UTscDty, and Connect ready/charges enabled. Do not onboard, reconnect or change settings.** Independent fixes and deployment continued. The user subsequently confirmed the current dashboard shows **Connected** and **Your account is ready**. This is fresh user-reported readiness evidence. It does not independently show or verify either account ID; user 1035 and acct_1Th9uUQg8UTscDty remain attributed to the earlier authenticated ID checks. No completed tests were repeated.

**Supported verified-USD Etsy purchases are expected to order through Zinc and ship to the saved address**, provided the earlier live linkage remains active, saved live payment references/address are valid, exact quantity/variants are available, retailer budget is sufficient, and search wallet funds are available. The fresh dashboard readiness confirmation closes the pending readiness check alongside the separately verified IDs. Missing currency continues to block individual results outside the verified path; universal cross-retailer currency is not claimed resolved.

Unverified: native iPhone execution, the full deployed authenticated purchase path, Zinc-owned live Connect authorization/capture, real retailer purchase/address acceptance, and actual shipment/delivery. Device-local recovery does not establish cross-device atomic exclusion or recovery after deleting app/keychain data. Build 14's server fee, combined Service fee, variable-cost disclosure/consent, address/variants, duplicate protection and status/tracking remain unchanged. No live order, hold, charge or credential change occurred.

## Current Amazon priority

The subsequent [Amazon US verification](amazon-us-checkout-verification.md) supersedes this earlier Etsy search scope. Search and place-order v17 support the documented Amazon search/details/explicit-USD offer path, passed a real Amazon sandbox continuous flow, and preserve build 14. Other retailer search is deferred; no Etsy result is relabeled as Amazon.
