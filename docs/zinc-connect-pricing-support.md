# Four-line pricing contract investigation — 2026-10-11

## Superseding decision: separately disclosed processing (v7)

The user now authorizes additional, separately disclosed payment-processing costs.
The previous four-line exact-total contract and its mismatch block are superseded
only for fresh v7 approvals. Display Product price, Shipping, Tax, FetchIt fee,
Processing fee, then Total. The gross FetchIt fee stays $2 + 3.5% of the quoted
product subtotal, rounded once. Zinc receives a flat margin of $1 + 3.5%; Zinc's
automatic $1 is included in the displayed fee once, without a second transfer.

Production processing remains unknown. Neither authenticated Stripe account view
returns a fee schedule; Zinc's public Connect example is not an account-specific
rate contract. No production fee rate is invented or imported from sandbox.
Shipping/tax/processing/Total stay null and display Unknown. Approval explicitly
consents to actual retailer costs within the retailer budget, the displayed fee,
and additional provider-determined processing with unknown rate and amount.
The retailer budget is not presented as the card authorization ceiling. Flat
margin is fixed from the approved quoted subtotal, even when retailer shipping,
tax or prices change within the retailer limit. Changes to quote, saved address,
payment, variant, quantity, budget, signed offer or expiry require fresh consent.

The real sandbox's observed gross-up is nearest-cent((budget + margin + 100 + 30)
/ 0.971), checked against actual secured amounts. This is sandbox-only evidence,
not production terms. The earlier zero-processing comparisons below are historical.



## Current result: corrected split fails real sandbox authorization (20:08 UTC)

The local v6 implementation displays exactly Product price, Shipping, Tax and
FetchIt fee, followed by Total. The combined fee is $2 + 3.5% of product subtotal,
rounded once with integer arithmetic. Zinc receives only the FetchIt margin
($1 + 3.5%); its automatic $1 is not sent again. Unknown shipping and tax remain
unknown. Consent, budget, address/variant, status and durable duplicate protections
remain enforced. The existing provider-payment mismatch guard remains necessary.

Real isolated Zinc sandbox calls with this exact margin produced:

| Product input | Retailer budget | FetchIt margin | Approved maximum total | Zinc secured | Excess |
| --- | --- | --- | --- | --- | --- |
| $3.99 | $11.72 | $1.14 | $13.86 | $14.58 | $0.72 |
| $10.00 | $10.00 | $1.35 | $12.35 | $13.03 | $0.68 |
| $10.00 | $12.00 | $1.35 | $14.35 | $15.09 | $0.74 |
| $100.00 | $100.00 | $4.50 | $105.50 | $108.96 | $3.46 |

These are provider-reported sandbox authorizations, not assumed production rates.
The sandbox generated its own retailer subtotals; the product inputs above are
server calculation inputs, not proof of controllable retailer prices. All four
payments remained secured after polling; final capture, fee deduction and
settlement amounts were absent. This is not an integrated UI-to-settlement pass.
See `zinc-platform-split-sandbox-evidence.json` for sanitized observations.

Existing authorized Supabase access was reused to extend only the admin read-only
`stripe-readiness` diagnostic (deployed version 21). No checkout backend or
migration was released. The deployed secret authenticates the expected live
Stripe account; both default and explicit account lookup identify the same
Standard account. Neither view returns controller fee-payer fields. This means
the platform-side fee-payer configuration is unavailable through these account
responses, not that an account setting was proved absent.

Existing original-order payment evidence shows a canceled $7.65 authorization,
$0 received, $4.99 application fee configured, and no balance transaction. That
fee is not evidence of a settled deduction or successful final allocation. The
original failed order was read, never retried. The Zinc wallet reports its $1 fee.
See `deployed-settlement-diagnostics.json` for the allowlisted readback.

The precise remaining control is Zinc's creation/confirmation amount and its
automatic final capture calculation: it adds provider costs to the customer
amount. Stripe fee-payer configuration controls who bears a fee debit; it does
not itself rewrite that PaymentIntent amount. The authenticated account views
and documented Zinc order payment contract expose no verified configuration
that changes this calculation to the approved total while deducting processing
from FetchIt's proceeds. No separate capture or payment-model change was used.

Validation: 79 affected automated tests passed, TypeScript passed and diff
whitespace checks passed. Those checks include mocked UI/backend protections;
they do not establish provider settlement. Four real sandbox checks failed the
approved-authorization equality. No live financial operations occurred. Checkout
release, evidence migration, replacement iOS build, TestFlight selection and
commit/push remain gated on a working provider calculation.


## Fresh deployed credential verification after user update

Read-only authenticated verification at 2026-10-11 19:57 UTC used the existing
Supabase CLI authorization and the deployed `stripe-readiness` GET endpoint.
Full deployed function bundles were retrieved (no deployment), verifying both
`place-order` and `create-setup-intent` invoke `paymentStripe()`, which selects
only `STRIPE_SECRET_KEY`. Deployed readiness also reads that same secret directly.
`STRIPE_PAYMENT_SECRET_KEY` is neither configured in production secret metadata
nor referenced in these deployed bundles. No override was identified.

Project `fpphpncruohjlppqhfep` records `STRIPE_SECRET_KEY` updated at
`2026-10-11T19:55:46.009Z`. Runtime Stripe authentication succeeds in live mode
for `acct_1Th9uUQg8UTscDty`, with charges and payouts enabled, details submitted,
and `card_payments` active. Public/secret account pairing is verified through a
readback of an existing SetupIntent. No secret values or digests were logged.

The deployed saved-profile audit returns: 3 profiles, 1 valid saved pair, 1 missing
pair, 1 failing the combined mode/ownership check, 0 unavailable. The valid pair
was retrieved with this account's credential and checked for live mode, customer
metadata owner, payment-method attachment and auth-user mapping. The combined
failure bucket does not distinguish a missing Stripe resource, wrong mode,
metadata owner or auth mapping; it is not proof that the pair belongs to a
different account. No references were changed.

[Sanitized deployed evidence](stripe-effective-key-verification.json) records the
configuration source and results. This resolves the effective payment credential
and account-readiness question; it does not verify Stripe controller fee-payer
settings, current Zinc linkage or processing allocation. Existing readiness does
not expose those fields. The private GET-only audit launcher remains available
for that narrower missing access. No completed checkout tests were repeated.

The local v6 split below remains implemented and tested; production was not
updated. Processing still has no verified deduction-only contract. Its mismatch
guard remains. No key replacement, financial operation, deployment or build was
performed.

## Implemented platform split — current v6

The latest authorized change implements only the platform split, using existing
Zinc Connect mode. `calculateServiceMargin` returns 100 cents plus 3.5% of the
entire product subtotal, rounded once with integer arithmetic. Zinc's request
uses this margin only. The displayed combined `serviceFeeCents` is margin plus
Zinc's automatic 100 cents; `knownCostsCents` includes the combined fee once.
The four display labels remain Product price, Shipping, Tax and FetchIt fee,
with Total beneath. Unknown shipping, tax and processing remain null.

For product subtotal 399 cents: FetchIt margin 114, Zinc automatic fee 100,
displayed combined fee 214. At retailer costs 1172, the four-line total is 1386
cents before any processing addition. No extra transfer is constructed. Checkout
persistence records the combined customer fee plus separate sanitized margin,
Zinc fee and unknown processing evidence. Quote revision `usd-four-line-split-v6`
binds the changed allocation and requires fresh consent.

This does NOT verify processing is deducted from FetchIt's proceeds. The existing
payment-mismatch guard remains, with a processing-specific explanation. No new
blanket block was added for temporary quote unavailability. Product review,
unknown-cost display, explicit retailer budgets, status refresh and restart
recovery remain available. Submission still requires a verified payment contract.
No credential audit, provider order creation, financial operation, deployment or
build was performed for this split implementation. Prior provider findings below
are historical evidence, not integrated tests of this new request margin.

Verification: 75 offline checkout checks passed (62 main checks plus 13 protection
checks), including rounding, four rows, no double counting/transfer, actual handler
request margin with mocked provider transport, consent changes, failure refresh,
signed address/variant mapping, repeated taps and durable restart recovery.
TypeScript and whitespace checks passed. No new integrated provider test ran;
authorization, capture and settlement of this split are not claimed verified.



This section supersedes the older estimate-release discussion below. The current
requested customer fee is exactly `200 + round(itemSubtotalCents * 35 / 1000)` cents.
The customer must not authorize or pay undisclosed provider additions. The local
v5 checkout is blocked, not functional, and has not been deployed.

## Current next step: private read-only account audit

The exact allocation remains fixed: customer pays retailer costs + gross fee;
Zinc receives retailer costs + 100 cents; FetchIt receives gross fee - 100 cents
before actual processing deductions. No combined gross fee is enabled as margin.

Prepared `scripts/run-settlement-audit.command` and
`scripts/read-settlement-configuration.py`. They use hidden Terminal input for
existing deployed Zinc/Stripe credentials, compare them in memory with deployed
secret digests through the existing Supabase CLI authorization, and issue only
allowlisted GET requests. The audit retains current Stripe controller/fee-payer
settings, current Zinc identity, and available existing Zinc/Stripe payment,
capture, balance-transaction and fee-allocation fields. Missing fields remain
unknown and `integratedSettlementVerified` stays false. No keys, full addresses,
raw provider messages or client secrets are retained.

The sanitized result is written atomically with mode 0600 to the OS temporary
directory as `fetchit-settlement-account-readonly.json`. Four new mocked safety
checks pass: GET-only boundary, deployed-key mismatch stops provider access,
allowlisted evidence/redaction, and partial-access handling. These are diagnostic
safety tests, not integrated settlement evidence. Completed checkout tests were
not repeated.

The native automation tool refused access to `com.apple.Terminal` for safety
reasons, so it could not open the private prompt. The user must open the prepared
.command file or run `python3 scripts/read-settlement-configuration.py` in an
interactive Terminal from the project directory. Credentials must never be sent
in chat or supplied in command arguments. Work requiring account configuration
is awaiting that private entry and sanitized result; unsupported allocation is
not assumed. The local block, release gate, existing protections and payment
model remain unchanged. No deployment or build was started.

## Final account and payment-control investigation

Final policy: exactly Product price, Shipping, Tax and FetchIt fee, with Total
beneath. FetchIt fee is `200 + round(itemSubtotalCents * 35 / 1000)` cents and
INCLUDES Zinc's 100 cents. Processing is a FetchIt expense. No second Zinc fee
may be added to the customer total. This policy is fixed.

No supported end-to-end replacement was established. This is not a finding that
Stripe cannot deduct costs from proceeds. It can. The unresolved boundary is
control of the customer amount inside Zinc's create/authorize/capture sequence,
plus missing authenticated account configuration and real integrated capture
access. The local checkout remains blocked and is not functional.

### Controls inspected beyond margin

| Control | Supported behavior | Why it does not establish this checkout |
| --- | --- | --- |
| Stripe Accounts v1 `controller.fees.payer` / v2 `defaults.responsibilities.fees_collector` | Chooses whether Stripe debits the connected account or platform for direct-charge processing costs. Stripe documents selection at account creation / Merchant configuration; v2 responsibilities cannot subsequently be updated. | This selects a fee debtor, not the PaymentIntent's customer `amount`. FetchIt's current setting was not retrieved; readiness is insufficient. |
| Stripe `application_fee_amount` | Allocates proceeds to the application owner; direct-charge processing fees can also be deducted from proceeds. | The application fee and customer amount are separate fields. Changing a fee allocation does not itself lower the amount Zinc authorizes. The actual Zinc application's fee values/permissions were not accessible. |
| Stripe `transfer_data.amount` | Sets a destination transfer as part of a compatible funds flow. | This changes allocation, not the customer charge. No delegated Zinc transfer/capture contract was established; no payment-model switch was made. |
| Stripe Platform Pricing Tool | Calculates application fees for eligible platform-controlled payments, with explicit application fees/transfer amounts overriding rules. Connected accounts cannot view/edit platform pricing schemes. | Rules govern application fees, not the customer amount. Eligibility and Zinc's actual explicit fee/transfer configuration were not verified. |
| Stripe PaymentIntent update / capture | Provides `amount`, `amount_to_capture`, `application_fee_amount`, and transfer controls on permitted payments. Capture requires `requires_capture`. | Zinc authorizes before returning the order, then automatically captures after retailer purchase. Post-response updates cannot undo an excessive original authorization and have no verified handoff preventing a race with Zinc. This is a coordination/amount-control limitation, not a proven blanket Stripe permission denial. |
| Payout timing, application-fee refunds or transfer reversals | Can change when proceeds arrive or adjust funds after a payment. | They cannot prevent the initial excessive authorization; refunding later would not meet the exact approved-charge requirement. No financial mutation was performed. |

Sources:
- [Zinc Connect lifecycle](https://www.zinc.com/docs/v2/connect)
- [Stripe fee behavior](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)
- [Stripe account configuration](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration)
- [Stripe direct-charge proceeds and fees](https://docs.stripe.com/connect/direct-charges?platform=web&ui=elements)
- [Stripe platform pricing rules](https://docs.stripe.com/connect/platform-pricing-tools)
- [Stripe PaymentIntent update](https://docs.stripe.com/api/payment_intents/update)
- [Stripe PaymentIntent capture](https://docs.stripe.com/api/payment_intents/capture)
- [Stripe platform controls](https://docs.stripe.com/connect/platform-controls-for-stripe-dashboard-accounts)

### Exact provider-controlled operation

Zinc's documented `POST /orders` authorizes the customer before returning an
order; `max_price` excludes margin and provider additions. Zinc later chooses
and sends the final capture automatically. FetchIt needs the same transaction
to use customer authorization/capture amounts based on approved retailer costs
plus the gross fee, while costs are deducted from FetchIt's proceeds. FetchIt
cannot supply or take over that amount-and-allocation operation through the
currently exposed Zinc order contract. The current OpenAPI `CheckoutOrderCreate`
accepts product/address/budget/idempotency, retailer credentials, metadata,
notifications, fulfillment and payment; `OrderPayment` contains only mode,
customer, payment method and margin. Existing-order routes expose reads, timeline
and cancellation, not a pause, delegated capture, supplied PaymentIntent, or
approval of a final settlement split.

This conclusion uses more than a missing schema field: Zinc explicitly documents
its authorization and automatic capture sequence, and retained real sandbox
observations show the resulting provider additions and zero-margin/rounding
failures. A later Stripe capture call cannot make an earlier over-authorization
match consent. A later refund cannot satisfy the original charge contract either.
No supported mechanism was found that changes those operations through ordinary
account fee-payer or settlement settings. Account-specific overrides remain
UNKNOWN rather than proven nonexistent.

Conceptually the desired accounting is straightforward: for retailer cost C,
gross fee G and actual processing cost P, customer pays C+G, Zinc receives C+100,
and FetchIt retains G-100-P. Stripe supports building blocks for allocations and
fee debits, but that arithmetic is not a tested Zinc configuration. In particular,
we have not verified Zinc collects C+100 through any particular Stripe field.

### Access and verification boundary

No usable Stripe secret/OAuth credential is present in relevant environment,
project env files or standard Stripe CLI configuration paths. The existing
backend readiness endpoint uses a stored credential but returns identity,
capabilities and readiness, not controller fee responsibility or Zinc-created
PaymentIntent allocation fields. No new audit endpoint was deployed and no
backend credential was extracted. Prior dashboard/admin reports prove historical
readiness, not current fee allocation.

Browser automation again rejected navigation to Zinc settings with the explicit
'user changed application' error. It did not reach authenticated settings; the
account's current fee-payer/settlement settings were therefore not inspected.
That is missing access, not evidence of disconnection or a disabled setting.

A new GET of one EXISTING isolated sandbox order returned Connect `secured`, no
PaymentIntent reference, no connected-account reference, and null final charge,
Stripe fee and transfer. See [sanitized readback](zinc-payment-control-readback.json).
There is consequently no real Stripe object reference from this fixture to use
for a verified integrated update/capture/settlement test. Generic Stripe tests
would not establish Zinc's behavior and were not substituted.

No completed pricing tests were rerun. No new order, hold, charge, capture, refund,
retry, credential change, deployment or build was performed in this follow-up.
Only documentation and sanitized evidence were added; runtime protections remain
unchanged. No Support message was sent or required as the conclusion.

## Current authoritative evidence

- Zinc's [Connect guide](https://www.zinc.com/docs/v2/connect) says the customer's
  authorization includes `max_price`, margin, Zinc's $1 fee, and Stripe's fee.
  Capture uses the actual retailer cost plus margin and provider fees. Its example
  charges $55.41 for $50 of retailer cost and a $2.50 margin, not $52.50.
- The public [OpenAPI schema](https://api.zinc.com/openapi.json), retrieved at
  `2026-10-11T19:18:41.092374+00:00`, has SHA256
  `91d32522e935707bfd76ada63aefa3da6f86d0c469848a17de245a25f6739140`.
  `OrderPayment` exposes only `mode`, `payment_method`, `customer`, and `margin`.
  `MarginSpec.value` has a minimum of zero and is described as markup computed
  before fees. There is no public fee-allocation, settlement configuration,
  customer-total cap, or negative-margin field.
- Stripe's [fee-payer guide](https://docs.stripe.com/connect/direct-charges-fee-payer-behavior)
  allocates Stripe fees between the connected account and platform for direct
  charges. It does not establish a Zinc setting that changes the customer amount
  Zinc creates. Stripe says fee payer is specified at account creation; this is
  not an ordinary existing-account checkout toggle. No configuration was changed.
- Zinc's [offers API](https://www.zinc.com/docs/v2/api-reference/products/get-product-offers)
  exposes shipping-option prices, but its parameters contain no destination.
  The current schema contains no pre-order destination-specific checkout quote
  or tax-estimate endpoint. Final retailer price components are order results,
  after submission, rather than an approval-bound pre-authorization quote.

Reducing the flat margin is not an established solution: it would require exact,
authoritative processing inputs and a stable retailer total for both authorization
and capture, and cannot offset provider costs exceeding the customer fee because
negative margin is disallowed. Hiding fees or changing metadata cannot change
these documented charge semantics. No account-specific private override was
verified; the public contract does not provide one.

## Net-margin follow-up: empirical calculation, not an enabled checkout

The previous conclusion was too broad if read as saying margin reduction cannot
work at all. Fresh real Zinc sandbox authorizations demonstrate that it works for
some fixed totals. [Sanitized evidence](zinc-net-margin-sandbox-evidence.json)
contains 12 calculation cases plus adjacent-integer and fractional-margin probes.
All use isolated test-success products; chosen item subtotals are calculation
inputs, not independently controlled retailer prices. Actual sandbox subtotals
and totals are recorded separately.

For integer-cent margins, every observed authorization matched this hypothesis:
`A(B,M) = round((B + M + 100 + 30) / 0.971)` cents.
Here B is the retailer budget, M the submitted margin. This is an empirical
sandbox formula, not verified production terms. The public Connect guide's
2.9% + $0.30 example does not specify an account-specific contractual rate or
rounding implementation. No authenticated production fee contract is available.

For desired gross fee G and target T = B + G, the tested candidate was
`M = round(0.971 * T) - B - 130`. This correctly targets many authorizations:

| Item calculation subtotal | Budget | Gross fee | Sent net margin | Observed authorization |
| --- | --- | --- | --- | --- |
| $0.14 | $2.00 | $2.00 | $0.58 | $4.00 |
| $0.15 | $2.00 | $2.01 | $0.59 | $4.01 |
| $3.99 | $11.72 | $2.14 | $0.44 | $13.86 |
| $10.00 | $10.00 | $2.35 | $0.69 | $12.35 |
| $10.00 | $12.00 | $2.35 | $0.63 | $14.35 |
| $100.00 | $100.00 | $5.50 | $1.14 | $105.50 |

Exact observed limitations:

- With a $3.99 subtotal and $26.99 budget, zero margin authorizes $29.13,
  exactly budget plus the $2.14 fee. At $27.00 budget, zero margin authorizes
  $29.15, exceeding the $29.14 target. At $50.00 budget, zero margin authorizes
  $52.83 versus a $52.14 target. Candidate margins are negative (-1 and -67
  cents); Zinc's schema disallows them. These are authorization costs, not
  observed capture deductions.
- With $10 subtotal, $10.24 budget and $2.35 gross fee, the $12.59 target falls
  between integer-margin results: 68 cents authorizes $12.58; 69 cents authorizes
  $12.60. The schema permits numeric margins, so 68.5 cents was also tested:
  it still authorized $12.58. Fractional input did not repair this boundary;
  this does not establish how every fractional margin is normalized.
- Flat margin cannot generally keep the same gross fee when retailer totals
  change. At budget $11.72, margin 44 cents targets $13.86. Sandbox returned
  actual retailer total $10.72. Under the integer hypothesis, capture would be
  $12.83, versus retailer plus original gross fee of $12.86. This three-cent
  shortfall is a conditional calculation, NOT an observed capture. Budget
  $12.00 and margin 63 cents likewise predict $13.32 at returned retailer total
  $11.00, versus the required $13.35. A nonnegative percent margin also cannot
  implement the decreasing net margin needed as retailer cost increases.

All 14 sandbox observations remained Connect `secured`; final charge, Stripe
fee and transfer were null on repeated reads. No documented sandbox capture
control was found in the current API schema. No capture mutation, separate
Stripe test, live financial operation or production checkout change was made.
Consequently this is partial authorization evidence, not successful end-to-end
settlement verification. The block remains. The three test-boundary checks pass,
including rejection of live keys and invalid/negative margins; whitespace checks
pass. Production code was unchanged in this follow-up.

The smallest path to retaining the existing payment model is to obtain Zinc's
applicable fee/rounding contract and capture test support, then use net margins
only where exact authorization and final total can both be verified. Unknown
retailer totals, uncovered fees and rounding gaps must remain ineligible rather
than increase the charge. A supported way to recompute net margin at final cost,
or an authoritative locked retailer quote, would be needed for changing totals.
No new fee-allocation setting is assumed necessary for the fixed cases above.

## Provider clarification needed (draft only; not sent)

Can Zinc Connect authorize and capture only the customer-approved retailer item,
shipping and tax total plus our gross customer fee of $2 + 3.5% of item subtotal,
rounded once to cents, while deducting all Zinc and processing fees from FetchIt's
settlement or another FetchIt-funded balance? Identify the supported configuration,
including when those fees exceed our customer fee. Provide a destination-specific
shipping/tax quote before authorization, an approval-bound all-in charge cap, and
sandbox behavior demonstrating both authorization and capture within that cap.
Do not create or modify any live order, hold, charge, refund or credential.

The smallest alternative under the currently documented Connect flow is explicit
variable-fee consent to retailer costs plus margin and provider fees. That relaxes
the requested fixed four-line customer pricing, so it has not been implemented.
Preserving the exact requested pricing requires a provider-supported contract
change, or a separately authorized payment-model redesign.

## Verification and release boundary

The server now computes the final 3.5% gross fee using integer arithmetic and
rounds once; the quote revision invalidates previous consent. Four display lines
and unknown shipping/tax handling remain intact. This gross fee is not a verified
Connect net margin or guaranteed profit.

Fresh authenticated Zinc sandbox diagnostics used only an isolated `zn_test_`
credential and documented test-success products. No production credential was
changed. See [sanitized observations](zinc-gross-fee-sandbox-evidence.json).
With a flat 235-cent margin, budgets of 1000 and 1200 cents produced simulated
secured amounts of 1406 and 1612 cents, respectively. Budget plus gross fee was
only 1235 and 1435 cents. Reported retailer totals were 900 and 1100 cents. Both
orders reached `order_placed` but Connect remained `secured`; `stripe_fee`,
`final_charge`, and `transfer_amount` remained null after polling. Therefore actual
capture, fee deductions, and settlement were not verified. These are provider
sandbox observations, not real Stripe holds, a full app checkout, or production
shipping/tax evidence. No separate Stripe test was run for this decision.

The 74 offline checkout checks passed, covering fee rounding, four-line display,
totals, consent, failure refresh, signed variant/address mapping and duplicate/
restart protections. TypeScript and whitespace checks passed. Mock protection
tests are distinct from the real sandbox diagnostic. The requested continuous
UI-to-provider capture/settlement test has not passed. The local block stays in
place; no deployment, migration application, iOS build, TestFlight upload, commit
or push was performed. The failed live order was not touched.

---

# Historical unresolved facts

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
