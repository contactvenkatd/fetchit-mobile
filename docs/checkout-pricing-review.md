# Checkout pricing review — 2026-10-03

Real checkout is blocked pending an enforceable, verified full customer charge ceiling.
No order, authorization, capture, retry or replay was performed during this review.

## Actual data flow

Chat sends product.price (minor units), quantity and explicitly known currency to checkout.
Checkout previously displayed unit price × quantity as the payable total and sent that
value as displayedPriceCents. Backend copied it to Zinc max_price, supplied the quantity
once, and supplied payment.mode=connect with margin.flat=0. The database order_price
and response totalCents are copies of this input, not evidence of captured payment.

Zinc's documented max_price excludes margin and fees. Connect holds that ceiling plus
margin, Zinc fee and Stripe fee, and captures its actual total after retailer checkout.
The documentation illustrates a standard $1 Zinc fee and 2.9% + $0.30 processing fee;
these examples are not a verified account-specific fee quote or rounding guarantee.
The customer funds retailer cost, margin and platform/payment fees under this contract.
FetchIt currently requests no margin/service fee. Shipping/taxes were not quoted.
Search price has no guaranteed currency field in the documented Sku response; currency
must not be inferred from a dollar sign. A dedicated all-in-cap field is not necessary
if the enforced retailer ceiling and a verified monotone fee calculation bound both
the hold and capture. Its absence does not establish that safe Connect checkout is
impossible. The account-specific fee/currency/enforcement contract remains unverified.

Sources: https://www.zinc.com/docs/v2/connect and https://api.zinc.com/openapi.json

## Fix and verification

Checkout displays item subtotal separately, marks shipping/tax/platform/payment fees
unknown, and disables placement while approvedMaximumCents is unavailable. Integer
minor-unit arithmetic validates quantity 1–100 and safe products; invalid quantities
are not silently replaced with one. No fee percentage or rounding rule is invented.
USD is formatted only when explicitly identified; other/unknown currency is labelled.
Production place-order independently rejects checkout_pricing_unavailable before
profile/Stripe/Zinc/database operations, protecting older builds too. This deliberately
blocks checkout until a supported contract is implemented, rather than claiming a
subtotal is an approved full charge. JWT, live-key/simulation checks and existing
idempotency, synchronous duplicate lock and uncertain-outcome behavior remain.

Focused order-placement tests: 17 passed. Zinc diagnostic/setup Python tests: 23 passed.
TestFlight upload workflow tests: 12 passed. TypeScript noEmit passed. Mock tests cover partial persistence failure, uncertain
outcomes, duplicate taps, simulation IDs, unknown fees and safe integer pricing.

## Release and remaining dependency

Build 10 ce377dd2-4cf5-4393-b4ed-b1b01a2a58eb finished but lacks this pricing correction.
Replacement build 11: 77b49be0-edb5-45a3-9343-fa5c287fa236, version 1.0.0,
FINISHED at 2026-10-03T05:03:31.951Z. Downloaded IPA identity and pricing-block
text verified; signed App Attest entitlement is production. Not uploaded to
TestFlight: Apple app-specific password input remains necessary.
Production place-order v13 deployed ACTIVE with verify_jwt=true.

Before real checkout, verify the existing Connect contract rather than requiring a new
cap field or payment model. If retailer cost A (including shipping, tax and retailer
fees in the charged currency) is enforced at A <= max_price M, and Zinc's verified
charge function G is monotone, then G(M + margin + Zinc fee) bounds both authorization
and G(A + margin + Zinc fee). Show that maximum explicitly, not an asserted final total.
Bind approval server-side to product/quantity/retailer budget/currency/fee configuration
and reject stale or missing approval before Zinc submission. Preserve duplicate locks
and uncertain outcomes. Neither old simulated order can be replayed.

Follow-up investigation: the published Connect example is consistent with a gross-up
at 2.9% + 30 USD cents: ceil((M + margin + Zinc fee + 30) / 0.971). In integer cents,
M=5000, margin=250 and Zinc fee=100 give 5541, matching the documented example.
This is a candidate derived from the example, NOT the verified production algorithm.
Nearest-cent rounding gives the same example, so it does not resolve rounding. Both
methods differ for a pre-processing base of 1008 cents (1069 versus 1070 cents).
A conservative ceil would bound those two methods if that fee model were confirmed;
no extra formula padding can establish an unknown production fee schedule.

GET /wallet/me exposes server-derived, negotiated order_fee_cents; its schema says the
fee is environment-tunable. The available production functions provide no authenticated
GET path to this wallet field using the stored key. No secret was extracted and no
new diagnostic deployment was performed. Readiness alone is not fee verification.
OrderPriceComponents documents converted_payment_total including FX markup; neither
max_price's charged-currency semantics nor Connect's USD restriction is established.
Public Create Order docs enforce max_price and Connect docs describe hold then actual
capture, but do not explicitly exclude additional authorization/overcapture or specify
account-specific processor surcharges. Exact questions are in
[zinc-connect-pricing-support.md](zinc-connect-pricing-support.md).

No new build, application-code change, deployment, key change or order/payment request
was made in this follow-up. The production pricing guard remains active.
After one separately authorized manual attempt, correlate a new backend order, Zinc
acceptance/simulation and retailer status, linked Stripe authorization/capture and
actual amount, and frontend outcome independently. HTTP 201 is not purchase success.

## Local maximum-approval implementation (not deployed or built)

The checkout screen requests a quote using action=quote on place-order. The quote path
returns before any Stripe payment/reference calls, Zinc submission or order insert.
Quotes bind the server-authenticated user, product URL, quantity, retailer budget,
server-loaded shipping/payment references, verified pricing revision, USD maximum and
five-minute validity window through a deterministic digest. No raw profile data is
returned. Placement independently recomputes that quote and requires exact approval
of its ID, currency and maximum. Expiry is checked again after Stripe reference reads,
immediately before the potentially financial Zinc call. A mismatch requires fresh
approval; the client clears prior consent and never automatically places an order.

When a verified quote exists, the UI says:
"Authorize up to $X, including shipping, taxes, and fees. Your final charge may be lower."
It separately explains the temporary card hold and release of unused authorization.
There is an explicit Approve maximum action before Place Order. Changing the retailer
budget invalidates consent. Budget parsing rejects extra decimal places, and USD
formatting uses exact integer minor units without floating-point cent rounding.
The Zinc request retains payment.mode=connect, zero flat margin, the approved retailer
budget as max_price and the existing idempotency key. It never sends the full approved
customer maximum as retailer cost and makes no separate Stripe capture call.

verifiedConnectPricing() intentionally returns null. No example fee formula, negotiated
fee guess or FX assumption has been installed. Therefore no real numeric maximum is
issued and production submission remains blocked. A verified adapter must compute the
smallest reliable bound for the selected retailer budget and account-specific rules,
and guarantee actual-only capture within that bound. Shipping and tax may remain
unquoted components covered by the explicitly approved retailer budget; they are not
represented as zero or as a known final total.

Current focused tests: 31 passed, including missing/forged/changed/expired consent,
fee revision and user/address/card/product/quantity/budget binding, quote-only requests,
expiry during Stripe reference verification, malformed server quotes, explicit consent,
changed-limit reapproval, duplicate taps, partial persistence and uncertain outcomes.
Tests use a deliberately fictional adapter solely to exercise enforcement; they do not
verify Zinc's production calculation. TypeScript noEmit and diff whitespace checks pass.

Production remains place-order v13. Build 11 lacks these new local approval changes.
No replacement build was started, no backend was deployed, no keys changed, and no
order/charge/capture was requested. Release remains deferred until the exact Support
questions above are resolved and the real pricing adapter can be verified and tested.

## Interrupted automated-integration preparation / GitHub handoff

The current local source adds an authenticated read-only status action to
place-order, scoped by both order ID and the authenticated user. Production RLS
was read-only verified as auth.uid() = orders.user_id. The status reader filters
Zinc data and verifies a linked Stripe intent against account/mode before reporting
captured amount; simulated Zinc results are explicitly marked and never reported
as actual captured funds. Checkout polls this action after recorded submission.
Zinc submission now has a timeout whose failure preserves the uncertain-outcome
lock. These additions are LOCAL and not deployed; integrated status tests remain
outstanding.

End-to-end preparation was interrupted by the user's GitHub push request after
isolated jsdom dependencies were installed. No UI/backend/Zinc end-to-end runner
was finished, no sandbox key/order was minted/created, and no Stripe test key was
available. No replacement build was started. The 31 focused mocked checkout tests,
23 diagnostic/setup tests and TypeScript checks passed before handoff. This is
work in progress, not "automated checkout verification passed". Production remains
place-order v13 with the pricing guard, and build 11 remains the last finished build.
