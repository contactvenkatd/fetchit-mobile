# Current unresolved facts

The replacement uses a documented flat Connect margin, calculated from the item subtotal only. Processing remains unknown; no exact maximum is promised. Remaining facts are the currency of cross-retailer search results without an explicit code, and fresh read-only confirmation of live Zinc-to-Stripe linkage. See [replacement verification](replacement-checkout-fulfillment-verification.md). Earlier zero-margin maximum questions are historical.

---

# Current estimate release

The customer approved variable-fee estimates instead of a guaranteed maximum.
The unresolved processing schedule does not block this explicitly approved flow:
processing is disclosed as unknown; no example rate is assumed.

Remaining optional Zinc Support question: “For Zinc user 1035, zero-margin USD
Connect orders, what processing percentage, fixed fee, charge currency, rounding,
and any issuer-country/FX surcharges apply to authorization and capture?”

The documented Connect standard $1 fee supports the estimated Zinc component
independently of the verified wallet fee. Historical maximum questions below are
superseded as release requirements; none received a provider answer.

---

# Zinc Support: verify Connect's calculable customer spending ceiling

Context: FetchIt production, Zinc user 1035, connected Stripe account
acct_1Th9uUQg8UTscDty. Identity and Connect readiness are already verified.
Endpoint: POST https://api.zinc.com/orders, payment.mode="connect",
margin={"type":"flat","value":0}; customer_notifications and fulfillment omitted.
We have NOT placed a live test order. Please do not create, retry or charge one.

We want to use the existing max_price contract to show and obtain explicit approval
for a maximum customer authorization/charge. We do not require a new all-in-cap field
if the existing guarantees establish this bound.

Please confirm the following for our live account:

1. Does max_price M enforce the ENTIRE retailer payable total, including all quantities,
   shipping, tax and retailer/import/regulatory fees, before the retailer purchase?
   Is this checked in the SAME currency and amount basis used for the Connect charge?
   Where currency conversion occurs, is the converted total INCLUDING FX markup <= M,
   or is only the original-currency total limited? How can we enforce USD-only checkout
   and identify its currency before submitting?

2. What EXACT integer-cent formula and rounding does ConnectService use to set the
   PaymentIntent authorization and final capture? The documentation's example suggests
   gross-up at 2.9% + 30 cents, with a standard Zinc fee of 100 cents. Confirm or correct
   these production values for user 1035, whether GET /wallet/me.order_fee_cents is
   authoritative for CONNECT too, and any international-card, cross-border, FX,
   Connect/platform or other customer-billed additions. Are fees fixed for the order
   once authorization occurs? How can we read/version the fee inputs before approval?

3. If we calculate H from M using that confirmed formula and show the customer
   "Authorize up to USD H; final charge may be lower", does Zinc guarantee that BOTH
   the authorization and aggregate final customer charge never exceed H? Can Zinc
   increase/recreate a hold, use overcapture, or create another charge automatically?
   If retailer costs or fees would exceed H, will Zinc fail/release the hold before
   purchasing instead? Please provide the failure code and documented guarantee.

Illustrative candidate ONLY, not a production fee assumption:
H_cents = ceil((M_cents + flat_margin_cents + zinc_fee_cents + 30) * 1000 / 971).
The published M=5000, margin=250, Zinc fee=100 example gives H=5541.
Nearest-cent rounding also gives 5541, so that example cannot establish the algorithm.
Please provide the actual formula and a cent-boundary example that resolves rounding.

References:
- https://www.zinc.com/docs/v2/connect
- https://www.zinc.com/docs/v2/api-reference/orders/create-order
- https://www.zinc.com/docs/v2/api-reference/wallet/get-wallet
- https://api.zinc.com/openapi.json (OrderPriceComponents conversion semantics)

No credentials, customer/card details or full upstream responses are required.


## Exact remaining question after real sandbox observations

Our test-key, zero-margin Connect orders returned:

| max_price (cents) | returned zinc_fee | returned secured_amount |
| --- | --- | --- |
| 908 | 100 | 1069 |
| 909 | 100 | 1070 |
| 1000 | 100 | 1164 |

The 1000-cent result explains why a 1100-cent assumed approval was insufficient:
it covered goods plus Zinc's returned fee but omitted processing. With the documented
2.9% + 30-cent example, nearest-cent gross-up of (1000 + 100 + 30) / 0.971 gives
1164 cents; the implied processing allowance is 64 cents. The 908/909 probes give
1069/1070 with nearest rounding versus 1070/1071 with ceiling rounding. These are
observations and a compatible inference, not confirmation of the production algorithm.
All three simulated orders remain connect.state=secured after retailer order_placed,
with stripe_fee and final_charge null. Therefore they do not verify actual-only capture
or a full authorization/capture bound. No production fee adapter was enabled.

**Please confirm for FetchIt user 1035: what pre-order, versioned fee/currency inputs
and integer rounding rule let us calculate H(M), and does Zinc guarantee that both
aggregate authorization and aggregate captured charges are <= H(M) whenever the
full retailer payable amount, including tax/shipping/fees and any FX markup in the
charged currency, is <= M? Specifically, does live Connect use the sandbox-observed
nearest-cent gross-up at 2.9% + 30 cents with our applicable Connect fee (is it 100
cents, and is wallet.order_fee_cents authoritative for Connect), or are there additional
card/cross-border/FX charges? Can any fee change, replacement/increased hold,
overcapture or extra charge exceed H without a new customer approval?**

We need a documented guarantee and a pre-order authoritative fee revision/read path;
post-creation secured_amount arrives after the hold and cannot establish prior consent.
Please answer without creating any live order, hold, capture or retry.


## Current single Support question after read-only production access check

The earlier detailed questions are retained as investigation history. The current
request can be answered without a new quote endpoint or any live transaction:

For Zinc user 1035, zero-margin USD Connect checkout, what production Connect fee F (is GET /wallet/me.order_fee_cents authoritative), processing percentage p, fixed fee b and rounding apply and remain fixed for an approved order, and does ceil((M + F + b) / (1 - p)) bound every authorization and aggregate capture when the full retailer payable including tax, shipping and fees is at most M USD cents, with no additional customer-billed fees or increased/replacement holds exceeding that bound without fresh customer approval?

Please provide the account-specific fee values and the existing contractual guarantee;
do not create an order, authorization, capture, retry or credential change.


## Narrowed single question after production wallet fee verification

Production GET /wallet/me, observed at 2026-10-03T17:14:00.424869+00:00,
verified user 1035 and order_fee_cents=100. This supersedes the earlier unread-fee
status. The result contains no key and records zero financial operations. Zinc's
Connect guide independently describes a standard 100-cent Connect fee; agreement
with the wallet value is corroborating evidence, not proof the wallet field controls
Connect or that fees remain fixed for an approved order. No key or test rerun needed.

The remaining question is now about this specific candidate and supported scope:

For Zinc user 1035 (production GET /wallet/me verifies order_fee_cents=100), zero-margin Connect orders with USD retailer checkout and a US-issued saved card, does H=ceil((M+100+30)*1000/971) guarantee that every authorization and aggregate capture stays at or below H when the complete retailer payable including tax, shipping and fees is at most max_price=M USD cents, with the 100-cent Connect fee and 2.9%+30-cent processing terms fixed for the order and no additional fees, FX, increased/replacement hold or overcapture exceeding H without fresh customer approval?

An affirmative account-specific guarantee would support computing a conservative
maximum locally; it would not require a new quote endpoint. If the US-issued-card
restriction is insufficient, please identify the exact additional customer-billed
fee inputs or restrictions needed. Please do not create any financial operation.


## Current question: processing function only

Accepting the documented retailer ceiling and Connect hold/capture/release behavior,
and retaining the independently verified 100-cent production fee, the only remaining
provider dependency is the account-applicable processing function. Zinc's October 2
changelog establishes USD-cap comparison after conversion at the billed rate; its
July 24 entry documents release on every terminal failure path. Earlier broader
questions remain history, not additional requirements.

For Zinc user 1035 with a verified 100-cent Zinc fee and zero margin, which production Connect formula (processing percentage, fixed cents, charge currency, integer rounding and any issuer-country/FX surcharges) applies to authorization at max_price and capture at the actual retailer total, and are those inputs fixed per approved order so the formula evaluated at max_price reliably bounds both amounts?
