# Amazon US checkout verification

**Expected to order eligible Amazon US items through Zinc and ship to the authenticated customer's saved US address. Install build 14.** No client change or rebuild was necessary. Place-order and search-products are **v17 ACTIVE**, JWT verification enabled. Downloaded deployed source maps match the final tested handlers, price-evidence, fee and status modules exactly. Build 14's client digests, signed IPA checksum and release selection are unchanged. Production credentials are unchanged.

## Currency and product identity

The server now searches only the supported Amazon-specific `/products/search?retailer=amazon` endpoint. Other retailer requests are deferred with an explicit unsupported-retailer error; an Amazon request never falls back to or relabels Etsy.

Search price and cross-retailer currency are not trusted. Each candidate's actual ASIN is used to retrieve Amazon details and `/products/{asin}/offers?retailer=amazon`. [Zinc's offers contract](https://www.zinc.com/docs/v2/api-reference/products/get-product-offers) defines integer-cent prices excluding shipping. Real API readback supplied explicit `currency: USD` on an available New offer for the matching ASIN. The runtime requires that same explicit USD field every time and rejects missing/conflicting/non-USD currency; no domain-based USD inference or currency conversion is installed.

Zinc's [details contract](https://www.zinc.com/docs/v2/api-reference/products/get-product) identifies ASINs and documents Amazon variant_specifics/all_variants. Requested Size/Color must match actual specifics, resolving to a documented child ASIN when needed, and the child is independently read and priced. The canonical `https://www.amazon.com/dp/{ASIN}` URL retains that actual selected ASIN; retailer-specific search often returns no URL, so the documented create-order URL shape is constructed from the returned ASIN. No fixture URL replaces it.

The proof signs the actual USD price, selected ASIN, requested variants, quoted seller and minimum quantity. The backend rejects changed variants, quantities below that minimum, and old Amazon proofs without these details. Submission enforces the supported `condition_in: [New]` constraint, preserving quantity and selected variant fields.

## Seller and availability scope

Only available New offers with a valid quoted seller and explicit USD price qualify. Digital/subscription, gift-card, Fresh/Pantry, customizable, explicitly unorderable/expired, international and Prime-only offers are excluded. Missing detail/offer evidence fails closed. Availability is observed at quote time; final stock and requested quantity remain subject to retailer checkout.

Zinc v2's documented OrderProduct supports URL, quantity, variants and condition constraints, **not seller-ID or offer-ID pinning**. No unsupported field is invented. The quoted seller ID/name is preserved in signed evidence and outgoing metadata; checkout's product text explicitly says the quoted seller may vary. This verifies seller traceability and New condition, not purchase from an exact named seller. Exact-seller requests remain outside the supported scope pending a documented pinning mechanism.

## Amazon support, shipping and requirements

Read-only GET /retailers lists Amazon at amazon.com as verified with US in supported_countries and no mandatory customer retailer account. A current `/retailers/check` for an actual Amazon ASIN URL returned orderable true, support active, guest checkout and guidance to order normally. Its ships_to field is null, so it does not prove eligibility for a specific ZIP/address; US support is established separately by the registry.

The backend requires a saved US address with a valid five-digit or ZIP+4 postal code and existing required name/street/city/state/phone fields. First/last name, both street lines including apartment/unit, city, state, postal code, country and phone map to Zinc shipping_address from the authenticated profile, preserving the existing documented normalization. No test/default/fallback location is used in production. The delivery destination is that saved profile address. Retailer address acceptance, remote-area restrictions and carrier completion remain untested, order-specific conditions.

The current API supports guest checkout for this Amazon URL; no customer Amazon credentials or Prime membership is assumed or changed. Prime-only offers and special unsupported product types are excluded. Conditional retailer challenges/failures continue to surface through current status reporting rather than false completion.

## Fee, payment and recovery

Our margin remains `200 + round(itemSubtotalCents × 0.035)`, calculated once on the server with integer intermediates. Only verified unit price × quantity forms its percentage base; shipping/tax/Zinc/processing do not inflate it. It is sent as Connect flat margin. One Service fee combines it with Zinc's 100 cents once. Variable-cost disclosure, explicit consent, retailer budget, saved payment ownership/live-mode checks, persistent duplicate/restart protection and current payment/shipment/tracking behavior remain intact.

Fresh user-reported Zinc dashboard readiness is Connected / Your account is ready. Zinc user 1035 and Stripe acct_1Th9uUQg8UTscDty are attributed to earlier authenticated ID evidence; the readiness confirmation does not independently verify IDs. Recent read-only Stripe evidence verified the intended account and valid saved pair; invalid/missing legacy references remain blocked. Separate Stripe component evidence was reused with zero new Stripe financial operations.

## Tests and limits

- **95 checkout checks passed** after the Amazon search/proof integration.
- **17 targeted checks passed** after final Amazon guards, including available/expired/Prime/currency/condition checks, signed variant/minimum quantity, US address/ZIP rejection and the unchanged $100 flat-margin/$6.50 combined fee case. TypeScript and whitespace passed.
- **Final continuous real Amazon sandbox test passed:** actual Amazon search → details and selected 12-inch variant → matching explicit-USD offer → actual UI/consent and quantity two → actual backend handler → same real Amazon ASIN URL, New condition and quoted seller metadata → Zinc test API acceptance → double taps issue one POST → reload restores accepted attempt → actual saved-row mapper → actual order-history service/screen → tracking and simulated delivery. No Etsy item or mocked currency was substituted.

Command: `RUN_REAL_CURRENCY_SEARCH=1 node --test tests/checkout-e2e/currency-search.test.cjs`. Native primitives, Supabase authentication/database transport and Stripe saved-reference reads are mocked. Amazon search/details/offers and Zinc order/status requests use real unmetered zn_test APIs. Zinc purchase/payment/delivery are simulated; native phone behavior and deployed authenticated purchase transport are not exercised. The final guard changes were covered by the targeted checks and final continuous run, rather than repeating all unchanged checks.

No live data API debit, purchase, hold, charge, transfer, payout, account credential change or new iOS build occurred. Production search/detail/offer APIs are metered under Zinc's documented rules and require wallet funds; these are not invented customer processing fees.

## Final scope and blockers

**Eligible Amazon US purchases are expected to order and ship to the saved address**, conditional on current USD available New offer evidence, matching requested variants/quantity, valid live card/customer, complete supported US destination, sufficient retailer budget/search wallet funds and active Connect readiness. No confirmed code/configuration blocker remains for that scope.

Missing currency, unavailable/unresolved variants, unsupported product types, invalid payment/address and unmet offer minimums intentionally block individual purchases. Exact seller pinning is unsupported by the documented v2 contract. Specific-address live shipping eligibility, actual retailer acceptance, Zinc-owned live payment capture and real shipment/delivery remain untested; sandbox delivered does not prove a shipment or guarantee retailer/carrier completion. Build 14 remains the build to install, with saved Apple VALID/internal-TestFlight acceptance reused.

## Final continuous release check — 2026-10-04

PASS: the final continuous run completed in 14.5 seconds using real Zinc test-key Amazon search/details/offers and order/status APIs. ASIN B0CB75WJZP supplied explicit USD at 17,500 cents per unit; quantity two and Size 12 inch produced a 35,000-cent item subtotal, Connect flat margin 1,425 cents, and one Service fee of 1,525 cents including Zinc's 100 cents once. Consent preceded submission. The selected customer/payment references and every saved-profile shipping field matched the outgoing payload. A distinct saved-address fixture (including apartment, ZIP+4 and phone) replaced the harness's original profile before checkout; the original default address was never substituted. This verifies mapping from a mocked saved profile, not live retailer acceptance of the customer's personal address.

One submission was observed across duplicate taps, restart recovery, status refresh, tracking and simulated delivery. After real sandbox delivery, an explicitly mocked failure response verified that overall retailer status became failed without paid/captured/completed success. Existing unchanged decline, uncertain-response and timeout evidence was reused. This injected failure is not a real Zinc failure event.

Authentication, database transport, Stripe saved-reference reads and native UI primitives were mocked. The actual build-14 checkout/history/service source and actual backend handlers ran locally; the authenticated deployed purchase route and native iPhone runtime were not exercised. Fresh read-only deployed-source downloads matched all five tested checkout/search/shared modules exactly (place-order/search-products v17). All seven client source digests and the signed build-14 IPA checksum remained unchanged; production credential digests remained unchanged. No production source changes, rebuild, upload or live financial operation was required.

The first run's added fee-count assertion was incorrectly placed after transition to confirmation; only its timing was corrected, and the affected continuous test passed on rerun. No production defect was found.
