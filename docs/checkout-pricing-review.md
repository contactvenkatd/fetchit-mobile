# Approved estimate checkout — current release

The guaranteed customer maximum requirement was replaced by the user-approved
estimate flow on 2026-10-03. Historical investigations below remain evidence,
but their maximum-only release block no longer describes the current contract.

Checkout supports confirmed USD item pricing and zero FetchIt markup. It displays
item subtotal plus Zinc's documented Connect $1 fee as known costs, with shipping,
tax, and processing amounts explicitly unknown. The complete estimated total is
null rather than an invented numeric total. Exact customer disclosure:
“Estimated total. Final shipping, taxes, and processing fees may vary.”

Zinc's Connect guide independently states its standard $1 fee; wallet GET evidence
for user 1035 verifies 100 cents but is not treated as authority for Connect fees.
https://www.zinc.com/docs/v2/connect

Processing 2.9% + $0.30 remains only Zinc's documented example. No production
processing schedule or gross-up/rounding formula is installed. Unknown processing
fees are explicitly additional, and the customer approves variable fees.

The separately disclosed USD retailer budget includes items, shipping and tax,
and is sent unchanged as Zinc max_price. Zinc and processing fees are outside
that retailer budget. Customer consent is bound to estimate revision, item
subtotal, retailer budget, product, quantity, account and server-loaded address /
card references; changing those details or expiry requires new consent. Old
maximum-only approvals are rejected. Acceptance/uncertainty locks and the same
idempotency key remain. Capture reporting still requires verified Stripe data;
retailer success, a hold, and simulation never establish a real payment.

Verification: 55 offline screen/service/backend regression tests passed, including
production-shaped configuration with real estimate logic and mock provider I/O.
TypeScript passed. Previously completed real Zinc sandbox and Stripe component
tests are reused; no provider tests or live financial actions were run for this
change. This does not certify a live Zinc-owned Connect capture.

Production place-order v14 is ACTIVE with JWT verification enabled. Existing
production credential digests were unchanged after deployment. An anonymous,
quote-only runtime preflight passed production live-mode checks and returned the
handler's expected unauthorized response before any provider operation. Production
checkout is enabled for clients with the new estimate contract; older approvals
cannot authorize it.

One signed iOS artifact was built: version 1.0.0, build 13, EAS ID
3ada634e-b702-4186-a4ca-674a39790bef (FINISHED). The initial upload failed before
creating a build because EAS attempted protected Git metadata changes; no-VCS
upload preserved that metadata and produced this single artifact. Downloaded IPA
code signature, provisioning identity, production App Attest entitlement, exact
estimate disclosure and absence of the old maximum promise all passed checks.
IPA: dist/checkout-estimate-build-13/FetchIt-1.0.0-13.ipa.
TestFlight release selector now points to this verified build 13. Existing hidden
password command: `PATH="/Users/neilduddukuri/.npm-global/bin:$PATH" python3 scripts/submit-testflight.py`
(run from the repository in Terminal). The existing upload workflow passed all
12 tests and independently verified the selected IPA, including camera purpose.
The older delivery receipt is ignored for build 13. No rebuild was requested or
performed. Apple acceptance remains pending the hidden-password upload; no Apple
password was requested in chat, written to a file, or committed.

Not submitted to TestFlight. Runtime/build verification created no live purchase,
hold, or charge. Full results are in checkout-provider-evidence.json.

---

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

## Automated verification resumed — 2026-10-03

Continued clean local main `5fe2f10`; remote main could not be verified because
Git metadata writes are restricted and github.com DNS fails. Read the exact
Expo 56 docs again before coding. Completed the interrupted DOM runner: full
screen/Button rendering, actual service/backend/quote/status modules, automatic
consent and placement with isolated fixtures. New provider boundaries reject
live keys and non-sandbox product URLs. No production fee adapter was installed.

Fixed unknown upstream error/already_exists handling to preserve the uncertain
outcome lock, normalized HTTP 5xx/408 as uncertain, rejected mismatched Zinc/Stripe
modes before submission, and corrected status parsing for tracking_numbers and
job_result.error_details/error_type. Test-key status is explicitly simulated even
when Connect metadata is absent. Captured amount remains independently verified
against Stripe mode/account and never inferred from authorization or Zinc
simulation. Production pricing guard remains unchanged.

52 focused mocked checkout tests and 41 Python tests pass; TypeScript and diff
checks pass. Full Node run before the last two mode guards: 66 pass, one skip,
one pre-existing Google-auth failure. No native-device/deployed-database/provider
pricing claim is made. The real Zinc runner was executed and blocked by
ENOTFOUND api.zinc.com before minting any key or order. Stripe test secret is
absent, so no real Stripe test operation ran. The optional Stripe component
runner is implemented but not executed against Stripe; it does not test Zinc
Connect linkage. Detailed boundaries/results/commands are in
[checkout E2E README](../tests/checkout-e2e/README.md).

One final signed EAS iOS build was attempted after tests; ENOTFOUND api.expo.dev
prevented submission and no build ID exists. A local iOS bundle/assets export is
prepared at dist/checkout-final; this is not a signed IPA or TestFlight release.
Production functions/credentials remain unchanged. No live order, hold, charge,
retry/replay, deployment or upload occurred. Complete automated checkout
verification has NOT passed. Verified production pricing, provider integration,
durable recovery across remounts/restarts/devices and live behavior remain
untested; sandbox simulation cannot establish a real retailer purchase.

## Network/pricing follow-up — 2026-10-03

No application/test code changed and no completed mocked tests were rerun.
The requested real sandbox runner was attempted once again. It failed before
sandbox-key creation with ENOTFOUND; Stripe component tests did not run because
CHECKOUT_STRIPE_TEST_SECRET_KEY is absent. CHECKOUT_ZINC_TEST_KEY is also absent,
which is not itself a sandbox prerequisite: the runner can mint one once the
network works. No provider key/order/payment object was created this turn.

Network checks: socket.getaddrinfo fails for api.zinc.com, api.stripe.com,
api.expo.dev and github.com. curl reports DNS error 6. scutil --dns reports
"No DNS configuration available" in this execution environment. The generated
/etc/resolv.conf exists but explicitly says macOS does not consult it for normal
DNS resolution; editing it would not be a supported repair. No proxy variables
are configured. These observations do not establish that the host's normal
network is broken: this session has restricted network execution, no escalation,
and no permission to alter system network settings. An execution environment
with working permitted outbound DNS/HTTPS/SSH is needed to continue.

HEAD and the locally cached refs/remotes/origin/main both equal
5fe2f104f869ef47738d811dbb607fd53e87e361. git ls-remote fails on github.com DNS.
Read-only web attempts to GitHub's current branch-ref/commit APIs were
unavailable; the available commit-history page was crawled two months ago and
cannot verify current main. No reset/rebase/update was performed; prior local
checkout changes remain intact.

Current primary documentation was read again through the read-only web tool:
- https://www.zinc.com/docs/v2/connect describes a retailer ceiling excluding
  margin/fees, a hold followed by actual capture, and an illustrative $1 Zinc
  fee plus 2.9% + $0.30 Stripe processing example.
- https://www.zinc.com/docs/v2/api-reference/orders/create-order says fulfillment
  concessions cannot relax max_price.
- https://www.zinc.com/docs/v2/api-reference/wallet/get-wallet identifies
  order_fee_cents as a negotiated, server-derived, environment-tunable fee.
  The page documents wallet funding; its applicability to the exact card Connect
  calculation still requires account-specific verification.

These sources do not resolve the outstanding exact Connect integer calculation,
rounding, additional card/FX fees, currency basis, account fee revision and
aggregate authorization/capture ceiling guarantee. A public example plus a
sandbox simulation is not an account-specific production pricing contract.
No authenticated account fee read or provider confirmation is available in the
current session. The existing support questions remain the missing evidence;
no support message was sent. The verified production adapter still returns null.

Production checkout remains disabled by the guard; no deployment or credential
change occurred. Complete real-provider checkout verification remains blocked.
No new EAS signed build or local export was attempted this turn: the user now
requires a single signed EAS build only after the complete flow passes.

## Execution-network cause established — 2026-10-03

The user confirmed normal Mac Terminal reaches Zinc, Stripe, GitHub and Expo.
Inspection of this execution process now identifies the specific difference:
CODEX_SANDBOX=seatbelt and CODEX_SANDBOX_NETWORK_DISABLED=1. localhost resolves,
but all four external service hostnames fail in this process. The active session
policy explicitly restricts network access and forbids escalation. These facts
explain the DNS-shaped failures without implicating the Mac's system DNS.
No DNS, proxy, hosts-file, system network or Codex permission setting was changed.

Read only the relevant sandbox settings in ~/.codex/config.toml: no explicit
top-level sandbox_mode, approval_policy or sandbox_workspace_write.network_access
setting is present. Repository .codex/config.toml is absent. Those files do not
override the active network-disabled execution policy. Official OpenAI docs
identify sandbox_workspace_write.network_access=true as permitting outbound
network in a workspace-write sandbox:
https://learn.chatgpt.com/docs/config-file/config-reference
A launch/resume policy permitting network access is required; modifying an
ordinary process environment variable would not remove the Seatbelt restriction.
This agent cannot change or bypass that enforced policy inside the session.

Unfinished checkout code remains preserved. No mocked/sandbox test or build was
rerun after confirming the restriction; no account pricing data became
accessible. No provider credentials or live orders/holds/charges were created or
changed. The production pricing guard remains intact. The next authorized step
in a network-enabled session is to recheck connectivity, verify remote main
without discarding local changes, run the existing sandbox runner, then resume
read-only account-specific pricing verification.


## Network-enabled sandbox verification — 2026-10-03

External HTTPS connectivity is now confirmed from the execution process: Zinc and
Stripe both returned HTTP responses. The exact Expo 56 documentation was read
before editing. Existing local changes were retained. Remote Git SSH now reaches
GitHub but fails public-key authentication; remote main was not verified or changed.

Executed the existing real-provider runner. The initial short status deadline
failed during test-success polling. Added safe stage/operator/location diagnostics
without assertion values, credentials or raw provider response bodies, and extended
the terminal-status deadline from 12 to 35 seconds to accommodate the actual
five-second UI polling interval and ten-second provider-read timeout.

The subsequent runner passed ALL FOUR real Zinc sandbox cases: test-success
(simulated delivery), test-price-exceeded (asynchronous max_price_exceeded),
test-invalid-address (creation rejection) and test-insufficient-funds (creation
rejection). Both accepted cases also verified Zinc's HTTP 409 already_exists
response to the same idempotency key. A provisional zn_test_ key was minted and
stored only in the existing mode-0600 OS-temporary cache; it was reused. Only
sandbox products were submitted; no live purchase, hold or charge was created.

The runner still exits 1, correctly: CHECKOUT_STRIPE_TEST_SECRET_KEY is absent,
so real Stripe test authorization/capture/decline checks did not run. Auth/database,
Stripe reference reads and fee calculation remain mocked in the Zinc integration.
Complete checkout and customer-ceiling verification remain explicitly false.
The 52 focused offline tests, TypeScript noEmit and whitespace checks passed.

Read-only sandbox order/wallet observations returned simulated secured_amount
1164 cents and zinc_fee/order_fee_cents 100 cents. The runner's 1000-cent retailer
budget uses a FICTIONAL 1100-cent UI approval. The simulation therefore cannot
validate that approval ceiling; a functional sandbox lifecycle pass is not a pricing
pass. These sandbox figures are consistent with the previously discussed candidate
formula but do not establish its production rounding or account applicability.

Re-read https://www.zinc.com/docs/v2/connect and fetched the current
https://api.zinc.com/openapi.json. The schema exposes Connect secured/final/fee
amounts after order creation and a server-derived wallet order_fee_cents, but no
pre-order account-specific Connect quote/formula/fee revision or full customer
ceiling contract. The Connect page says Connect orders do not use the wallet;
therefore the sandbox wallet fee is not independent production Connect proof.
No production credential was extracted or changed to obtain these observations.

Pricing remains unresolved pending account-specific Zinc confirmation of the
integer formula/rounding, fee inputs and revision, charged-currency/FX ceiling,
and authorization/aggregate-capture guarantees described in
[zinc-connect-pricing-support.md](zinc-connect-pricing-support.md). Requested an
explicit Stripe test credential source and any existing provider pricing confirmation
without asking for secrets in chat. verifiedConnectPricing() still returns null.
No application pricing adapter, production guard, deployment, build or production
credentials changed. No live financial operation or support message was sent.


## Hidden Stripe input and independent Zinc pricing probes — 2026-10-03

Prepared stripe-hidden.py and stripe-stdin.cjs for hidden interactive Terminal
input. The key is validated as unmasked sk_test_, kept only in process memory,
and passed through a pipe. It is not saved or placed in command arguments or
environment variables. Hidden-input failure is fail-closed. A PTY safety check
confirmed live-key input is rejected without echo or network requests; both
existing provider boundary tests and syntax/whitespace checks passed.

The automatic graphical input attempt was unavailable, and computer-use access
to Terminal is prohibited by that tool. Requested user execution of the hidden
Terminal command. No Stripe test key or result has arrived yet; real Stripe checks
are pending, not passed. The runner now also verifies the hold is unchanged after
excessive-capture rejection and reports retrieved captured/remaining cents.
The sanitized result is timestamped in the OS temporary directory, separate from
credentials. Production credentials were not accessed or changed.

Used the independent zinc-pricing-probe.cjs, without loading the fictional pricing
adapter, to submit exactly three new zero-margin sandbox Connect orders. Returned
retailer budget/Zinc fee/secured cents were 908/100/1069, 909/100/1070, and
1000/100/1164. Later GETs confirmed all were simulated order_placed in USD, with
retailer totals 808, 809 and 900 respectively. Connect still reported secured and
null stripe_fee/final_charge fields, so final capture cannot be verified here.

The 1164-cent hold is consistent with the documented 2.9% + 30-cent processing
example grossed up over the returned 100-cent Zinc fee: (1000+100+30)/0.971,
rounded nearest, is 1164. The implied processing allowance is 64 cents; it is NOT
an independently returned Stripe fee. At budget 908, that expression is
1069.00103 (nearest=1069, ceiling=1070); at 909 it is 1070.03090
(nearest=1070, ceiling=1071). Thus the observations fit nearest-cent gross-up
and disagree with the previously proposed ceiling as the exact sandbox algorithm.
A ceiling may conservatively bound those observations but cannot bound unknown
production surcharges, currency basis or later authorizations/captures.

No invented fee or numerical production adapter was installed. The supported
statement is that Zinc returned a simulated 1164-cent hold for this 1000-cent
sandbox budget, not that 1164 is a verified production customer maximum.
The exact remaining provider question, including pre-order fee revision and
aggregate authorization/capture guarantee, is appended to the support notes.
verifiedConnectPricing() remains null and the guard remains unchanged. No live
order, hold, charge, deployment, build or support message occurred.


## Saved Stripe pass verified; Zinc ceiling still unverified — 2026-10-03

Read the saved hidden-input result completed at 2026-10-03T15:58:18.331Z,
run 1109f588-5009-4e83-8b5f-40e67dab7655. Stripe test component PASSED:
livemode=false; authorized=1100 cents; attempted 1101-cent capture rejected;
actual captured=950 cents; remaining capturable=0; idempotency and card decline
verified. No Stripe test or Stripe API request was repeated in this continuation.
This removes the missing-test-key blocker for those completed component checks,
but does not establish Zinc-owned Connect linkage or production fee behavior.

Read-only GETs of the three existing Zinc sandbox orders reconfirmed the earlier
908/1069, 909/1070 and 1000/1164 budget/hold observations, returned Zinc fee=100,
USD retailer totals=808/809/900, state=secured, and null stripe_fee/final_charge.
No new sandbox order was created this turn. Sanitized observations and the saved
Stripe pass are in [checkout-provider-evidence.json](checkout-provider-evidence.json).

Current Connect docs, full docs index, create-order payment rules and fresh OpenAPI
schema were inspected. The OpenAPI paths expose wallet, usage and already-created
pending payment/order resources; no pre-order Connect quote or fee/revision endpoint
was found. The wallet fee is server-derived and environment-tunable, but no source
establishes its authority for the exact end-customer Connect fee. No existing browser
is available for authenticated account pricing inspection. No production key was
retrieved or changed, no support message sent, and no hold/payment page was created.

For zero margin, the observations fit:
H_nearest(M,F) = round((M + F + 30) * 1000 / 971),
where F=100 is the RETURNED SANDBOX fee and 2.9%/30 cents come from Zinc's
DOCUMENTED EXAMPLE. For positive integer cents, an exact integer representation
of this candidate is floor((2000*(M+F+30)+971)/1942). These are inferred candidates,
not installed pricing rules. A conservative upper bound under that SAME CONFIRMED
fee model would be H_up(M,F)=ceil((M+F+30)*1000/971). At M=1000 both give 1164;
that is 64 cents above the fictional 1100 approval, accounting for processing.

This bound is monotone: if the full retailer amount A<=M in the charged currency,
fee inputs remain fixed, and actual capture follows the same model, then
H_nearest(A,F)<=H_up(M,F). The mathematics is resolved CONDITIONALLY. The missing
provider facts are the production fee inputs/rounding/currency basis and guarantee
that all authorizations/captures follow that bound, including any additional fees
or replacement holds. Sandbox state never reaching captured and the independent
Stripe component pass cannot establish those facts. Additional simulation samples
cannot substitute for the provider contract.

Exact remaining Zinc question: for FetchIt user 1035, what authoritative pre-order
Connect fee inputs/revision and integer rounding rule define H(M), and does Zinc
guarantee aggregate authorization AND capture <= H(M) for a retailer total <= M
including tax, shipping, fees and FX in the charged currency, without any extra
card/cross-border charge, fee change, increased/replacement hold or overcapture
that exceeds approval? The full question remains in the support notes.

verifiedConnectPricing() remains null. The guard and all existing local application
changes are retained; complete checkout remains unverified. No Stripe rerun,
production credential change, deployment/build, live purchase, hold or charge occurred.


## Read-only production fee access check and final Support dependency — 2026-10-03

Used the existing Supabase CLI login held in the OS keychain, in memory only,
to GET production secret metadata. The Zinc secret is present; its returned value
is a 64-character SHA256 digest, not a usable credential. Neither ZINC_API_KEY nor
ZINC_KEY is available in the execution environment. Local source shows that all
existing Zinc diagnostic helpers require separately supplied hidden live-key input;
the existing deployed Stripe readiness interface exposes identity/readiness but
not the Connect processing-fee schedule. No key was printed, retrieved through a
new deployment, changed, or rotated. Therefore ACTUAL PRODUCTION order_fee_cents
and applicable account-specific Connect processing fees remain UNREAD, not 100
or 2.9% + 30 cents by assumption. The earlier 100-cent fee is sandbox evidence only.

Reviewed Zinc's Connect guide, authentication rules and the wallet OpenAPI contract.
The wallet fee is server-derived/environment-tunable, but the Connect guide says
Connect does not use the wallet. Wallet fee applicability to Connect still needs
confirmation. Stripe's US standard pricing distinguishes domestic 2.9% + 30 cents,
international-card additions and conversion additions; custom pricing also exists.
A USD charge does not establish domestic-card eligibility or that Zinc passes
exactly those published merchant fees to this customer. Those rates were NOT
installed as FetchIt's production fee schedule.
Sources: https://www.zinc.com/docs/v2/connect,
https://api.zinc.com/openapi.json, https://stripe.com/us/pricing.

A new quote endpoint is not mathematically necessary. If authoritative fixed
Connect fee inputs F, p and b apply to an approved order, the full retailer payable
A is bounded by M in USD, and Zinc guarantees the same monotone fee function for
all authorizations/captures, then a conservative integer maximum can be derived
from ceil((M+F+b)/(1-p)). That is a conditional construction, not a verified numeric
maximum: this session cannot establish the production inputs or full guarantee.
No production adapter was implemented. No completed Stripe, Zinc or offline test
was repeated, and no sandbox/live order, hold or charge was created.

The current single Support question is:

For Zinc user 1035, zero-margin USD Connect checkout, what production Connect fee F (is GET /wallet/me.order_fee_cents authoritative), processing percentage p, fixed fee b and rounding apply and remain fixed for an approved order, and does ceil((M + F + b) / (1 - p)) bound every authorization and aggregate capture when the full retailer payable including tax, shipping and fees is at most M USD cents, with no additional customer-billed fees or increased/replacement holds exceeding that bound without fresh customer approval?

Stopping pricing work at this evidence boundary as requested. No support message
was sent. The pricing guard and production credentials are unchanged; existing
local checkout work remains preserved.


## Hidden production wallet read prepared — 2026-10-03

Added scripts/read-zinc-wallet-pricing.py at the user's explicit request. Hidden
interactive input accepts only a complete zn_live_ key; no key is saved, echoed,
passed to subprocesses or placed in arguments/environment variables. It makes
exactly one GET https://api.zinc.com/wallet/me, with normal TLS verification,
redirect refusal, bounded response size and no retry. It makes no Supabase,
Stripe, settings, order or other provider request. A response must identify
integer user_id 1035 before any fee is reported. Only typed order_fee_cents,
verified user identity, timestamps and verification flags are saved to a unique
mode-0600 OS-temporary JSON result; raw wallet data and the key are excluded.

New offline safety checks passed for the single GET boundary, wrong-account
rejection, redirect refusal, sanitized output and hidden test-key rejection.
No completed provider test was repeated, and no production request was made by
those safety checks. Requested local hidden key entry; the actual production
wallet fee remains pending that execution. Its Connect applicability will not be
inferred from wallet lookup alone. Pricing guard and credentials remain unchanged.


## Production wallet fee verified; Connect processing gap narrowed — 2026-10-03

Read the user-specified sanitized result at
/var/folders/l9/8_0lpmq95_g7y34jbl1jk01m0000gn/T/fetchit-zinc-wallet-pricing-result-ea1_yt1k.json.
Its GET /wallet/me observation at 17:14:00.424869+00:00 verifies user 1035 and
integer orderFeeCents=100, with financialOperations=0. No key was read from disk,
requested again or saved. No provider request or completed test was repeated.
The actual production WALLET fee is now known; earlier notes saying it was unread
are superseded. Durable sanitized evidence is updated in checkout-provider-evidence.json.

Zinc's current Connect guide independently states a standard $1 Connect fee and
uses 2.9%+$0.30 processing in its example. Thus a 100-cent fee has both production
wallet evidence and independent public Connect documentation; we are not deriving
Connect applicability solely from a matching sandbox or wallet field. Missing are
authority of wallet.order_fee_cents for Connect, account-specific processing terms,
fee stability and the enforceable customer ceiling. USD by itself does not exclude
international-card charges; the narrowed Support question targets USD retailer
checkout with a US-issued saved card rather than every card charged in USD.

Under CONFIRMED fixed F=100, p=0.029, b=30, zero margin and charged-currency
retailer ceiling, H(M)=ceil((M+130)*1000/971) is a conservative integer maximum
for nearest/ceiling gross-up and is monotone. M=1000 gives H=1164. Wallet evidence
does not confirm p/b, rounding, USD-cost enforcement or the complete authorization/
aggregate-capture contract, so this remains a conditional calculation. No numeric
production adapter or guard change is warranted yet. The remaining single Support
question is recorded in zinc-connect-pricing-support.md and in the evidence file:

For Zinc user 1035 (production GET /wallet/me verifies order_fee_cents=100), zero-margin Connect orders with USD retailer checkout and a US-issued saved card, does H=ceil((M+100+30)*1000/971) guarantee that every authorization and aggregate capture stays at or below H when the complete retailer payable including tax, shipping and fees is at most max_price=M USD cents, with the 100-cent Connect fee and 2.9%+30-cent processing terms fixed for the order and no additional fees, FX, increased/replacement hold or overcapture exceeding H without fresh customer approval?

No new quote endpoint is required if that contract is confirmed. No support message,
Stripe/Zinc/offline test rerun, new order, hold, charge, deployment or credential change
occurred in this continuation. verifiedConnectPricing() remains null; the pricing
guard remains active until the maximum and complete flow are verified.


## Remaining processing calculation only — 2026-10-03

Reused the saved production fee observation (user 1035, 100 cents), Stripe test pass,
Zinc partial integration and 52 focused offline checks. No tests repeated or new
provider/payment operations performed. Read exact Expo 56 docs before any potential
implementation. Inspected current Connect docs, the complete official docs index,
API/product changelogs, and the official zincio/skills universal-checkout reference.
None specifies an account-applicable processing-rate/fixed-fee/rounding contract.

New authoritative currency evidence: Zinc's 2026-10-02 changelog says the checkout
total is converted before comparison with the USD max_price cap at the same rate
used for billing, including retries/recovery. This supersedes the earlier uncertainty
about local-currency totals being compared directly to a USD cap. The 2026-07-24
changelog documents release of Connect holds on all terminal failure paths. Sources:
https://www.zinc.com/docs/changelog and https://www.zinc.com/docs/v2/connect.
Retailer-cost ceilings including shipping/tax and hold/actual-capture/remainder-release
are accepted as documented behavior, not reopened as separate requirements.

The ONE remaining provider fact is the production Connect processing function
applicable to user 1035: rate, fixed fee, charge currency, integer rounding, surcharge
rules and fixed applicability during an approved order. The example remains an
example; sandbox nearest-cent behavior is not promoted to production evidence.
No public authoritative source establishes those account terms. No new quote
endpoint or payment model is required if the fee function can be established.

Existing local code already contains the requested authorization copy, explicit
approval, server-side approval binding and retailer-budget max_price enforcement,
plus duplicate protection and status reporting. verifiedConnectPricing() still returns
null; no numeric fee implementation can be enabled on the current evidence. No
source change/test rerun is necessary at this boundary. No final signed iOS build
was started because complete checkout verification remains unfulfilled.

Current precise Support question:

For Zinc user 1035 with a verified 100-cent Zinc fee and zero margin, which production Connect formula (processing percentage, fixed cents, charge currency, integer rounding and any issuer-country/FX surcharges) applies to authorization at max_price and capture at the actual retailer total, and are those inputs fixed per approved order so the formula evaluated at max_price reliably bounds both amounts?

No previously supplied key requested, no production credential changed, and no live
order, hold, charge, deployment or support message created. The pricing guard remains.
