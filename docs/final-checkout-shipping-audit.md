# Final checkout shipping audit — 2026-10-11

## Verdict and confirmed fixes

Build 16's signature and IPA hash remain valid. Its v7 client and the pre-audit
place-order v21/search-products v20 deployed sources matched the original release
source. The audit confirmed two shipping defects: shipping options were not used
in checkout/budget review, and the name filter discarded options with punctuation
or missing names. Real Zinc offers currently include a priced option with a null
name; dropping it discarded genuine numeric evidence.

Shipping review v8 preserves those prices, normalizes an unavailable method name
to Unspecified service, and keeps absent/invalid amounts null. It displays a
single-item minimum only when all retained options have known prices. The value
is labeled an estimate from the quoted offer, not destination-specific. Missing
or partly unknown options and multiple-item shipping stay Unknown; undocumented
quantity scaling is not assumed. Explicit zero is preserved as an offer estimate,
without assuming Prime eligibility or guaranteed free destination shipping.

The quote exposes known retailer costs separately from FetchIt/processing fees.
Client and server reject a budget below the quoted product plus known shipping;
the server does so before Stripe reference reads or Zinc submission. Tax is
unknown before checkout, not zero. Unknown components never yield a verified total.
The numeric known-cost floor is a partial sum, not an all-in retailer total.

The previous-order regression uses $3.99 + $6.99 + $0.74 = $11.72. A $3.99 budget
is rejected locally from the signed $6.99 shipping evidence even before tax is
known ($10.98 known quoted product/shipping). The historical $0.74 is not reused
as a current tax quote. No retry of the failed order occurred.

`max_price` remains the approved retailer budget for product, shipping and tax.
FetchIt fee ($2 + rounded 3.5% of quoted subtotal) and additional provider processing
remain outside it. Only $1 + rounded 3.5% is sent as margin; Zinc automatically
adds its $1 once. The fee does not grow with shipping/tax or retailer budget.
See [Zinc Connect](https://www.zinc.com/docs/v2/connect) and
[order API](https://www.zinc.com/docs/v2/api-reference/orders/create-order).

## Shipping evidence and consent

The [official offers API](https://www.zinc.com/docs/v2/api-reference/products/get-product-offers)
provides seller shipping methods and integer-cent prices. Its request has no
shipping address or ZIP argument. These methods cannot establish eligibility for
the saved destination, the purchasing account's Prime benefits, the attempted
seller, or Zinc's selected shipping service. The cheapest quoted option is an
estimate, not a seller/service instruction.

Current test-key GET offers for B0C32J6L9F returned item 399 cents and explicit
shipping 0 with no method name. That current offer is not evidence explaining the
original $6.99 charge. Original seller/fulfillment/shipping-service attribution
remains unproved. The original ASIN was read only, never submitted to real Zinc
in this audit. The regression uses mock provider responses.

Changed signed item price/shipping, quote revision, address/payment, quantity,
variant, budget or expiry invalidate prior consent. Refreshed evidence changes the
quote digest. An unobserved external Amazon change during the retained listing's
30-minute validity or quote's five-minute window is not automatically detected;
there is no atomic destination quote/price lock. Zinc's retailer budget remains
the limit, and unknown destination costs can cause failure. No claim is made that
the saved offer remains the actual seller or service at retailer checkout.

## Tests and provider scope

129 affected offline automated tests passed, plus TypeScript and diff checks.
Coverage includes five cost lines and total, rounding, processing disclosure,
known-shipping budget rejection, unknown/free shipping, price/shipping consent
changes, variant/address mapping, duplicate taps, timeouts, card-decline handling,
restart journal recovery, tracking and failure refresh. Declines/timeouts and
persistence outages in this suite are mocked, not live experiments.

Reproduction commands (sandbox operations only):

```sh
npm run test:checkout
npm run test:checkout:sandbox
node tests/checkout-e2e/sandbox-creation-failures.cjs
RUN_REAL_CURRENCY_SEARCH=1 node --test tests/checkout-e2e/currency-search.test.cjs
```

Fresh real Zinc sandbox checks passed:

- Eight UI/service/backend lifecycle cases: authorization arithmetic over varied
  subtotals/budgets/rounding boundaries, seven simulated deliveries, one actual
  sandbox price failure, duplicate-key rejection and restart recovery.
- Two synchronous provider rejections: invalid address and insufficient funds.
  Insufficient funds is not proof of a Stripe card decline.
- Real Amazon search/details/offers through signed price and shipping evidence,
  actual checkout handler, Zinc sandbox acceptance, history tracking and simulated
  delivery. Every saved fixture address field (including apartment, state, ZIP+4,
  country and phone) matched the request. The final history-failure injection is
  explicitly mocked; the separate price-failure lifecycle case is provider-generated.

Native view primitives, Supabase authentication/database and Stripe saved-reference
reads are adapters/mocks in these integrated tests. A first real search using an
unsupported size constraint returned no eligible result; the unconstrained ASIN
search passed. No currency inference or variant guard was removed to make it pass.
No separate Stripe payment operation was performed. Sandbox processing arithmetic
is not a production rate contract. Sandbox Connect remained secured, with final
capture/processing/transfer fields absent; settlement was not verified.

Evidence: [baseline artifact/deployment](build16-shipping-audit-baseline.json),
[real offers](shipping-audit-real-offers.json), [real Amazon flow](shipping-audit-real-amazon-checkout.json),
[lifecycle cases](shipping-audit-sandbox-evidence.json),
[creation rejections](shipping-audit-sandbox-rejections.json), and
[deployment/build verification](shipping-audit-release-evidence.json).

## Deployment and artifact

place-order v22 and search-products v21 are active in production with JWT gates
preserved. Full bundle/source-map readbacks match the tested local modules; the
existing evidence columns are verified, and unauthenticated quote POST returns
401. No production authenticated purchase was used for validation. Build 16 rejects
v8 quotes and is outdated because the shipping display/validation needed client
changes. Accepted/pending recovery records are unchanged and remain usable.

One replacement iOS build was requested: 1.0.0 (17),
[EAS 1e7de7ae-4441-44ef-878a-3ad8e28804cf](https://expo.dev/accounts/durick17/projects/fetchit-mobile/builds/1e7de7ae-4441-44ef-878a-3ad8e28804cf).
Signature, app identity, App Store provisioning, production App Attest, SecureStore,
v8 bundle markers and unchanged source-digest checks passed. The verified artifact
is selected in `config/testflight-release.json` for the existing hidden-password
upload workflow; 15 mocked upload-workflow tests passed. No Apple upload occurred.
The workflow still requires the separate Apple app-specific credential at upload,
not another Stripe credential. Native runtime execution remains unverified.
See [artifact verification](shipping-audit-artifact-verification.json).

## Remaining unverified live behavior

- Actual destination shipping/tax, quantity-dependent shipping, live buying-account
  eligibility/Prime, seller and delivery service, final inventory/prices/variants,
  and retailer/carrier acceptance of the customer's real address.
- Marketplace changes not yet reflected in refreshed signed evidence, and exact
  final customer total/authorization before Zinc calculates unknown provider costs.
- Production processing rates/rounding, off-session authorization/SCA/card declines,
  final capture versus retailer total, fee deductions and settlement allocation.
- Actual hold release on failure, bank availability timing, cancellations/refunds;
  no financial operation was used to test these.
- Production outage/timeout/duplicate/restart behavior under real financial traffic;
  only local fault injection and sandbox provider idempotency were exercised.
- Physical shipment, real carrier tracking/delivery, and production webhook timing.
- Native device execution/App Attest/login with the replacement binary, Apple upload,
  processing and TestFlight availability. Signed artifacts are not native runtime tests.

No live order, hold, charge, capture, transfer or refund was created. No production
credential was changed. The failed order was not retried.
