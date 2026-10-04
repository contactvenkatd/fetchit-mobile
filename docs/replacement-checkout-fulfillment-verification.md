# Replacement checkout and fulfillment verification

Status: **Still blocked for purchases whose price currency is unresolved.** Do not claim expected real purchase/delivery until that fact and live Connect linkage are established. A replacement production iOS build was requested once: `6a4c889d-6c15-46e1-8b25-48ba4b7f3a7c`, version 1.0.0 (14). The signed IPA was verified and the hidden-password TestFlight upload selection now points to build 14. The subsequent user upload was accepted by Apple and is available for internal TestFlight; see the [final build 14 audit](build-14-final-verification.md). No upload was performed by this verification audit.

## Final implementation

- Our margin is calculated on the server using integer cents: `200 + floor((itemSubtotalCents * 35 + 500) / 1000)`, with BigInt intermediate arithmetic. Item subtotal is verified unit price times quantity. Shipping, tax, Zinc fees and processing are excluded from its percentage base. The client does not calculate this fee.
- Single customer-facing **Service fee** amount combines our margin and the documented applicable $1 Zinc Connect fee. Example: item subtotal 3000 cents gives our margin 305 cents, combined Service fee 405 cents, known estimated components 3405 cents. Our margin and Zinc fee remain separate in the quote and Zinc metadata; database service_fee records only our margin. History combines the recorded margin with the verified Zinc fee for display.
- Zinc receives `payment.mode=connect`, `margin.type=flat`, and `margin.value=our margin`. Zinc adds its own fee once; no separate Stripe charge, percent margin or payment-model change. [Connect documentation](https://www.zinc.com/docs/v2/connect) explicitly documents flat margin cents, shared customer charge and margin settlement.
- Signed provider-price evidence prevents changing the price, product URL or currency. The server derives subtotal from that evidence and quantity and rejects conflicting client amounts. Evidence expires after 30 minutes; customer quote/consent expires after at most 5 minutes. The existing Supabase service-role secret signs evidence; no credentials were added or changed. No signed evidence is issued for unresolved/non-USD currency.
- Checkout discloses unknown shipping, taxes and processing before explicit variable-fee approval. It says: “Estimated total. Final shipping, taxes, and processing fees may vary.” Retailer max_price budget is disclosed separately and server-enforced. Service fee and processing are additional; no guaranteed all-in ceiling. Changed quantity, variant, address, saved card, budget or fee revision invalidates consent. Old fee-revision clients fail closed rather than authorize new fees silently.
- Before submission, a per-authenticated-user SecureStore journal records the attempt. Duplicate taps and restarts recover accepted or uncertain attempts without issuing a new key/POST. Definite rejection may clear the matching attempt. Unknown outcomes stay locked for reconciliation/support. Accepted orders require an explicit new-purchase action to reset. This is device-local recovery, not an atomic cross-device reservation or protection after deleting app/keychain data.
- Requested Size/Color is disclosed, consent-bound and submitted using Zinc's documented variant array. Strict fulfillment is retained; unavailable item/variant, insufficient quantity or retailer-budget failure does not silently substitute.
- Address comes from authenticated profile: first/last name, both address lines including apartment/unit, city, state, postal code, country and phone. US state and required fields are checked before submission. Saved Stripe customer/card mode and ownership are checked read-only.
- Checkout and order history poll scoped Zinc status. Later failures override stale delivered tracking; shipping/in-transit/delivered, tracking numbers and ETA are shown. Retailer state and verified payment/capture are separate. Declines and later payment failures never become completed purchases; unavailable status stays explicitly unconfirmed.

## Currency investigation — exact remaining issue

Current official cross-retailer `/search` Sku schema (including the live public OpenAPI) contains an integer price but no currency field and no universal USD denomination guarantee. The app preserves explicit `currency` or `currency_code`; conflicting codes remain unresolved. It never derives USD from `$`, retailer slug, a US shipping address or a `.com` domain. Missing currency blocks only that purchase.

Retailer-specific Zinc documentation establishes that Etsy `/products/search` is narrowed to US shops, excludes remaining non-USD listings and exposes `currency_code=USD` without converting prices. Etsy details can instead contain another currency. That documented rule belongs to `/products/search`, not the `/search` endpoint this application uses, so it cannot justify globally labeling cross-retailer prices USD. Amazon describes local currencies across national stores. Best Buy's current international-order help does not establish Zinc's search denomination; an old community Q&A is insufficient as a current API contract. No production data calls that debit the wallet were made.

Exact remaining question: **For a cross-retailer GET /search result without currency/currency_code, what authoritative per-result field or documented retailer/domain rule establishes the ISO currency and minor-unit scale of price?**

References: [cross-retailer search](https://www.zinc.com/docs/v2/api-reference/search/cross-retailer.md), [live OpenAPI](https://api.zinc.com/openapi.json), [retailer-specific search rules](https://www.zinc.com/docs/v2/api-reference/products/search.md), [Amazon local currency rules](https://sell.amazon.com/global-selling/usa-to-international).

## Account and deployment checks

Read-only live wallet verification: Zinc user **1035**, order_fee_cents **100**. Read-only Stripe verification: live **acct_1Th9uUQg8UTscDty**, charges enabled, card payments active. Previous read-only publishable/secret key pairing and saved Stripe component evidence remain applicable because credentials are unchanged.

Fresh GET /settings/connect still returns 404. This is not proof of disconnection; earlier authenticated administrator evidence linked user 1035 to the same Stripe account and reported ready. Current linkage cannot be freshly confirmed with the available API or approved browser access. The precise configuration question is whether user 1035 remains Connect-ready for acct_1Th9uUQg8UTscDty and which supported read-only endpoint confirms it. Temporary authenticated read-only audit function was removed, and secret digests matched before/after. Read-only production schema inspection confirms numeric service_fee/order_price columns, text order status/Zinc reference, profile apartment/card fields, and owner-scoped orders/profiles policies for reads and inserts; no new fee constraint prevents persistence. No production row was inserted.

Backend place-order **v16 ACTIVE**, JWT verification enabled, contains server fee, signed price enforcement, full address/variant mapping and fulfillment status. Search-products **v15 ACTIVE**, JWT verification enabled, preserves explicit currency/currency_code and signs price evidence. The old guaranteed-maximum-only guard is absent; unresolved currency and mandatory consent remain enforced.

## Tests and fulfillment limits

- **83 automated UI/backend/provider-safety checks passed**. Real app screen/service/quote/handler/status/journal logic; mocked native primitives, auth/database, provider responses and signing key. Covers rounding including half cents, quantity reapproval, tampered amounts/proofs, consent, declines, duplicates, timeout/restart, corrupt recovery, variants, address/unit mapping, missing US state, tracking and fulfillment/payment failures. Not native-device or full deployed Supabase integration.
- **Four real Zinc sandbox scenarios passed with the final fee**: simulated successful delivery, asynchronous price exceeded, invalid address and insufficient funds. Zinc duplicate-key rejection checked separately. Real zn_test API; simulated purchase; mocked auth/database/Stripe references and fixture price evidence. Not a real retailer purchase or combined production Connect test. Returned sandbox hold was 1406 cents for retailer budget 1000, our margin 235, Zinc fee 100; customer_margin/final_charge remained null in readback. No production fee/rate/capture guarantee is inferred from that observation.
- Saved separate Stripe component evidence reused: `1109f588-5009-4e83-8b5f-40e67dab7655`, test mode. Authorization/idempotency, excessive-capture rejection, lower capture and decline passed earlier. **Zero new Stripe financial tests**; not Zinc-owned Connect capture.
- TypeScript passed. TestFlight upload regression suite: **15 passed**. Whitespace check passed.

Supported retailer + available exact variant/quantity + sufficient retailer budget + valid address/card + working Connect linkage should allow Zinc to submit the retailer order and the retailer to ship to the supplied address. Tracking then reports carrier progress. Retailers can cancel or run out of stock; carrier completion is not guaranteed. Sandbox delivered means simulated delivery and never proves an actual shipment. No live order, hold, charge or credential change occurred.

## Signed replacement artifact

Build **14**, EAS `6a4c889d-6c15-46e1-8b25-48ba4b7f3a7c`, FINISHED, production/STORE, version 1.0.0. Exactly one build request. IPA: `dist/checkout-service-fee-build-14/FetchIt-1.0.0-14.ipa`. SHA256: `40c63caf35eea6983fca4dbdec51a3d28e46a521434340398245beb856fa3dc7`.

Verified codesign deep/strict signature; team/app identity PV7JV2P9Q8.ai.compreo.fetchit; App Store provisioning; production App Attest; get-task-allow false; SecureStore native module. Client source digests matched the submitted source. Bundle contains Service fee display and no “FetchIt service fee” label, final estimate disclosure, fee revision v2, signed price evidence handling, persistent journal/recovery, Size/Color, address line 2, current retailer/payment status and tracking strings. Server fee arithmetic and enforcement were independently checked in deployed v16; server code is not part of the IPA.

Existing hidden-password upload command, now selecting verified build 14:

```sh
python3 scripts/submit-testflight.py
```

The existing upload selection remains build 14. Do not reupload it: the subsequent delivery 9f7d22d4-0ce8-45fc-907f-7f3e7b38b7bb is VALID and BETA_INTERNAL_TESTING. The status-only check used the script’s hidden Terminal password prompt and did not rebuild or upload. External testing approval is not established by this result.
