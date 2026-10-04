# Final install release check — 1.0.0 (14)

**Ready to install build 14.** No confirmed release defect or artifact/backend mismatch remains within the supported scope. No build, upload, configuration or credential change was performed. No live order, hold or charge was created.

## Artifact, backend and Apple

The unchanged release selection is EAS build `6a4c889d-6c15-46e1-8b25-48ba4b7f3a7c`, version 1.0.0 (14). Its IPA SHA256 remains `40c63caf35eea6983fca4dbdec51a3d28e46a521434340398245beb856fa3dc7`, matching the previously verified deep/strict signed App Store artifact. Embedded version/build and checkout/recovery/status bundle markers were reread. All recorded checkout client source digests match the release source; unchanged signature/provisioning evidence was reused.

Fresh read-only deployed bundles confirm original source equality for place-order v16, search-products v16, checkout-pricing, listing-price and order-status. Functions remain ACTIVE; place-order/search-products retain JWT verification. Production credential digests are unchanged. Search v16 matches the tested documented Etsy fallback; there have been no production source changes since that flow passed. Build 14 already consumes its existing currency/price/proof contract.

Saved Apple delivery `9f7d22d4-0ce8-45fc-907f-7f3e7b38b7bb` confirms `VALID`, `BETA_INTERNAL_TESTING`, and on App Store Connect for 1.0.0 (14). This establishes internal TestFlight availability, not external testing approval. The earlier artifact verification's `testFlightUploaded: false` describes its pre-upload date, not the subsequently accepted delivery.

## Supported checkout scope and evidence

Verified-USD Etsy results from Zinc's documented `/products/search` path can reach checkout; unresolved cross-retailer currency remains individually blocked. The real test-key search supplied the actual USD code, price and URL unchanged through UI/backend acceptance, saved-row mapping, restart recovery, tracking and simulated delivery. The 55 affected checks and prior provider evidence remain applicable and were not repeated.

The server calculates `200 + round(itemSubtotalCents × 0.035)` once with integer intermediates. The percentage base excludes shipping, tax and other fees. One Service fee combines our margin and Zinc's verified 100 cents once; only our margin is sent as Connect margin. Estimated-cost disclosure, explicit approval, saved payment ownership/mode checks, quantity/Size/Color, complete address, persistent attempt protection, current payment/retailer status and tracking remain unchanged. Processing/shipping/tax amounts remain honestly unconfirmed where unknown.

Fresh user-reported dashboard evidence says Connected and Your account is ready. User 1035 and Stripe acct_1Th9uUQg8UTscDty are attributed separately to earlier authenticated ID checks; the fresh readiness confirmation does not independently show or verify those IDs.

## Saved delivery address

The deployed backend selects `profiles` by the authenticated `user.id`, not a client-supplied recipient. That profile supplies Zinc's `shipping_address`: first/last name, address_line1, address_line2 including apartment/unit, city, state, postal_code, country and phone_number. This is the order's requested delivery destination. There is no test, default or fallback **location** in the production request. Missing profile/name/street/city/postal/country, or a missing US state, rejects checkout; it does not select another address. Client-supplied address fields cannot override that destination.

Values are location-preserving, not literally byte-for-byte unchanged: surrounding whitespace is trimmed, full_name is split into first and remaining last names, and a recognized country name/code is normalized to ISO uppercase. An empty optional second line becomes null. A null/absent profile phone may use the authenticated user's phone; if no usable phone is available, checkout rejects. This is a phone source fallback, not an alternate address.

The previously uncovered check used a read-only SELECT of current production profile values, kept them in memory, and executed the actual handler with mocked authentication/database/Stripe/provider transports. **Two complete saved profiles mapped every shipping field exactly after the stated normalization; one incomplete profile was rejected without substitute location. Zero real Zinc requests occurred.** Personal address values were neither printed nor saved. This checks actual stored field values and mapping, not a customer's live order. It does not establish which app session the user will sign into or prove retailer acceptance of a particular address.

Eligible successful orders are **expected to ship to the authenticated customer's saved address**, provided that profile/address and live saved card are valid, the exact item/quantity/variants are available, retailer budget and search wallet funds suffice, and Connect remains ready. Retailer acceptance and carrier completion are not guaranteed.

## Limits kept separate from release defects

Native iPhone execution and real SecureStore lifecycle, the complete deployed authenticated purchase network, Zinc-owned live Connect authorization/capture, actual retailer purchase/address acceptance, and real shipment/delivery remain untested. Sandbox fulfillment is simulated; separate Stripe component tests do not establish a shipment. Device-local restart protection does not establish cross-device atomic exclusion or recovery after deleting app/keychain data. These are verification limits, not newly confirmed release defects.

## Current Amazon priority

The subsequent [Amazon US verification](amazon-us-checkout-verification.md) supersedes this earlier Etsy search scope. Search and place-order v17 support the documented Amazon search/details/explicit-USD offer path, passed a real Amazon sandbox continuous flow, and preserve build 14. Other retailer search is deferred; no Etsy result is relabeled as Amazon.
