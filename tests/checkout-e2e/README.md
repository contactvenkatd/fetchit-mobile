# Current estimate regression verification

Run only the offline changes: `node --test tests/order-placement.test.js tests/checkout-e2e/checkout.test.cjs`.
55 tests passed for the approved estimate contract. Harness uses real estimate
logic; no fictional pricing adapter. Shipping, taxes and processing remain null.
Production-shaped mocked provider tests cover variable-fee consent, old-client
rejection, USD validation, separate retailer budget, duplicate protection,
uncertainty and accurate captured amounts above known estimated components.

Previously completed Zinc sandbox and Stripe tests are evidence already saved in
`docs/checkout-provider-evidence.json`. Do not rerun them for this release.
The sandbox runner is updated for compatibility but was not run again.
Historical verification details follow.

---

# Automated checkout verification — incomplete

## Commands

From the repository root:

```sh
npm ci
npm ci --prefix tests/checkout-e2e
npm run test:checkout
npm run test:checkout:sandbox
```

`test:checkout` executes 52 offline checks. The new DOM suite renders the actual
checkout component and actual Button with React DOM, uses the real order service,
quote generation, backend handler and status reader, and automatically approves
and clicks Place Order. React Native layout/input primitives are DOM adapters.
Supabase auth/database and Zinc/Stripe are mocked; the fee adapter is explicitly
FICTIONAL (`retailerBudget + 100`), not a verified pricing rule. This is not native
device testing or a deployed Supabase integration.

Checks cover disabled placement before consent, approval/submission binding,
changed-budget reapproval, unknown pricing, duplicate taps before render,
timeouts, malformed acceptance, HTTP 5xx, already_exists, card decline,
accepted-but-unrecorded submission, asynchronous budget failure, scoped status
reads, simulation labels, account/mode mismatches and actual captured amounts
below the maximum reaching the UI. Focused tests also cover expired/forged
approval and user/address/card/product/quantity/fee-revision binding.

## Real provider runner

`sandbox.cjs` mints a documented provisional Zinc test key automatically, keeps
it in a mode-0600 file in the OS temporary directory and reuses it across runs.
Alternatively provide `CHECKOUT_ZINC_TEST_KEY` with a `zn_test_` value. It never
reads production key variables or follows device/claim/live approval endpoints.
All order products must be documented `zinc.com/shop/products/test-*` URLs.
Every financial provider network boundary rejects live keys; redirects fail.
Sandbox keys/data expire after seven days of inactivity per Zinc documentation.

The runner drives the DOM UI through the application service/backend to Zinc
for success, price exceeded, invalid address and insufficient funds, polls
status, and independently exercises Zinc's duplicate-key response. Auth/DB,
Stripe reference reads and pricing remain mocked: this is a PARTIAL integration.
Simulated delivery is never evidence of a retailer purchase or payment capture.

If `CHECKOUT_STRIPE_TEST_SECRET_KEY=sk_test_...` is explicitly available, the
runner separately tests Stripe manual test authorization, idempotent creation,
rejected excessive capture, lower actual capture, retrieval and decline with
Stripe's documented fake PaymentMethods. Test records carry a unique run ID;
uncaptured test intents are cancelled on exit where retrieval is possible.
This component check is NOT Zinc-owned Connect authorization/capture and is
never presented as a complete combined checkout flow. No production settings,
keys, card details or database records are read/changed by these runners.

The runner exits nonzero on missing credentials, networking errors or failing
checks. Its report always says `completeCheckoutVerified: false` because the
production fee contract and combined Zinc/Stripe Connect remain unverified.
Never promote this partial suite to a complete verification claim.

## Observed results, 2026-10-03

- Focused checkout: **52 passed**, all provider behavior mocked.
- Python suite: **41 passed**. TypeScript and whitespace checks passed.
- Full Node suite before the last two provider-mode checks: 66 passed, one skipped,
  one existing failure (`Google authentication bypass remains disabled`).
- Real Zinc sandbox: **blocked**, `ENOTFOUND api.zinc.com`; no key/order minted.
- Real Stripe test: **not run**, explicit test secret absent.
- Signed EAS iOS build: **blocked**, `ENOTFOUND api.expo.dev`; no build ID issued.
- Local iOS export: prepared in `dist/checkout-final` (bundle/assets, not an IPA).

Started from clean local `main` at `5fe2f10`. Remote freshness could not be checked:
fetch cannot write `.git/FETCH_HEAD`, and `ls-remote` cannot resolve github.com.
The exact Expo 56 docs were read before edits; installed SDK dependencies were
preserved. Production pricing still returns unavailable. No deployment, live
order, authorization, capture, credentials change or TestFlight upload occurred.

Untested: verified account-specific all-in fee/currency/rounding rules, actual
retailer purchase/price enforcement, Zinc-owned Stripe authorization and lower
capture/release, bank behavior, native UI/device networking, deployed Supabase
RLS and persistence, cross-remount/restart/device durable checkout recovery.
The existing lock is screen-local, and Zinc idempotency is preserved per attempt;
a freshly generated key on a new screen is not durable purchase recovery.

## Primary references

- [Expo 56](https://docs.expo.dev/versions/v56.0.0/)
- [Zinc sandbox quickstart](https://www.zinc.com/docs/v2/agent-sandbox/quickstart)
- [Zinc sandbox semantics](https://www.zinc.com/docs/v2/api-reference/introduction/sandbox)
- [Zinc idempotency](https://www.zinc.com/docs/v2/api-reference/introduction/idempotency)
- [Zinc order schema](https://www.zinc.com/docs/v2/api-reference/orders/get-order)
- [Connect pricing contract](https://www.zinc.com/docs/v2/connect)
- [Stripe testing](https://docs.stripe.com/testing)
- [Stripe capture](https://docs.stripe.com/api/payment_intents/capture)

Outstanding production contract questions remain in
[the pricing support notes](../../docs/zinc-connect-pricing-support.md).

## Latest follow-up

The sandbox runner was retried without rerunning mocked tests or changing code.
DNS still fails for Zinc, Stripe, GitHub and EAS in the restricted execution
session. No Zinc test key/order was created. CHECKOUT_STRIPE_TEST_SECRET_KEY
is absent; CHECKOUT_ZINC_TEST_KEY is absent but automatic minting needs no signup
once networking works. No new signed build/export was attempted because the
complete checkout flow has not passed. Remote main remains unverified; only
local HEAD and cached origin/main are confirmed as 5fe2f10. Production pricing
and credentials remain unchanged, and checkout stays guarded/disabled.


## Network-enabled verification, 2026-10-03

This supersedes the earlier DNS-blocked observation above. Zinc and Stripe HTTPS
connectivity now works. Real Zinc sandbox success/delivery, asynchronous budget
failure, invalid address and insufficient funds all passed. The two accepted
cases also passed real duplicate-key rejection. A temporary mode-0600 Zinc test
key was minted and reused; no production credentials were touched.

The original 12-second terminal-status deadline was insufficient on the real
network. It is now 35 seconds, accounting for five-second UI polling and provider
read timeouts. Failure reporting includes only stage/operator/source location.

`npm run test:checkout:sandbox` still exits **1** because the explicit Stripe test
secret is absent. **Complete checkout and customer-ceiling verification are false.**
The runner's fictional 1100-cent approval is not a verified ceiling: read-only
sandbox observations returned a simulated 1164-cent hold. Sandbox fee observations
must not be installed as a production adapter. The production pricing guard remains.

Focused offline checks: **52 passed**. TypeScript and whitespace checks passed.
No live purchase, hold, charge, deployment or build occurred. Next prerequisites
are the explicit Stripe test secret and account-specific Zinc pricing guarantees
listed in the support notes; native/deployed/combined Connect checks remain open.


## Hidden Stripe test-key input

Run in an interactive Terminal:

```sh
python3 tests/checkout-e2e/stripe-hidden.py
```

Enter an unmasked `sk_test_` secret at the hidden prompt. The prompt fails closed
if hidden input is unavailable. The key is passed to Node through an anonymous
pipe, never saved or placed in command arguments, environment variables or logs.
A sanitized timestamped result is written to the OS temporary file
`fetchit-checkout-stripe-test-result.json`. The checks cover manual test authorization,
idempotent creation, excessive-capture rejection with an unchanged hold, lower capture,
retrieved captured/remaining amounts and a fake-card decline. This remains a Stripe
component test, not verification of Zinc-owned Connect payments.

`node tests/checkout-e2e/zinc-pricing-probe.cjs` independently probes three sandbox
budgets through the test-only provider boundary, without the DOM harness or fictional
pricing adapter. It reports returned hold/fee fields and never installs a pricing rule.
Observed budget/hold cents: 908/1069, 909/1070, 1000/1164; returned Zinc fee: 100.
Final Stripe-fee/capture fields remain null even after simulated retailer placement.
See the support notes for the exact remaining production-ceiling question.


## Stripe saved result verified, 2026-10-03

The hidden-input Stripe test completed at 15:58:18.331Z and **passed**. Verified
saved results: test mode, 1100-cent authorization, 1101-cent capture rejected,
950-cent capture, zero remaining capturable, idempotency and decline checks passed.
The checks were **not rerun** after the user reported completion. This supersedes
the earlier missing-Stripe-key observations for these component checks only.

[Provider evidence](../../docs/checkout-provider-evidence.json) contains the sanitized
saved result and fresh read-only retrievals of the three existing Zinc sandbox orders.
Those still expose no final capture/Stripe fee; combined Zinc-owned Connect and
production pricing remain unverified. No new order or payment was created in this
continuation. The production guard remains unchanged.
