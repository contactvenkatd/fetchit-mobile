# Order placement investigation — October 2, 2026

Started on clean branch `main`, commit `eedead3`. Read root `AGENTS.md` and
Expo's exact v56 documentation before edits. No existing working changes were
present. Production investigation used authenticated Management API database/log
reads, downloaded deployed source, and the existing GET-only admin Stripe
readiness endpoint. No deployment, push, payment, Zinc purchase, event replay,
order update, or credential change was performed.

## Affected order and correlation

There is one latest order, unambiguously newer than the two August orders:

| Field | Verified value |
| --- | --- |
| FetchIt order | `970ec16f-4858-4c3f-89d5-39e781158fe1` |
| Database creation | `2026-09-21 08:02:40.249928+00` |
| Database status now | `pending` |
| Stored Zinc order | `ca260bad-0964-40d5-8150-dde5357a30aa` |
| Function response timestamp | `2026-09-21T08:02:40.385000` UTC |
| Function HTTP status | `201` |
| Supabase request ID | `01a0c2fc-f7e2-71e1-b90b-62132e192b8d` |
| Invocation log ID | `923c2d50-5fa1-4d81-868e-1fb61063aa55` |
| Execution ID | `1f950b97-f10d-4172-b251-903e5284fed5` |
| Deployed function version | `10` |
| Duration | `6815` ms |
| Response content length | `185` bytes |

The authenticated log user matches the order's owner (checked in process;
customer identifiers and personal data are omitted). User agent identifies the
native FetchIt client. One `place-order` invocation was returned for September 21;
none for October 2. These bounded queries do not establish absence outside the
queried windows. The full September 21 window has only this placement candidate.

Runtime records for the matching execution show boot and subsequent shutdown,
without an error record in the queried interval. A later runtime shutdown is not
an HTTP timeout: this invocation had already returned 201.

## Actual sequence and what ran

`chat.tsx` routes product details to `checkout-confirmation.tsx`. The screen loads
the user's profile, generates an idempotency UUID, and invokes `place-order`
through `orderService.ts`. It does not insert an order or confirm a PaymentIntent.

Deployed `place-order` v10 follows current source's checkout logic:

1. JWT gateway and handler authenticate; JSON/product input is validated.
2. Load user-scoped profile and validate saved payment references, shipping name,
   address and phone. Retrieve Stripe customer and payment method; require mode,
   attachment and user ownership to match.
3. POST to `https://api.zinc.com/orders` with `payment.mode=connect`, saved Stripe
   references, maximum price and the frontend idempotency key.
4. Require a successful Zinc HTTP response with string `id` and `status`.
5. Insert the returned Zinc ID and status into `orders` under user RLS.
6. Return a 201 confirmation. If recording fails after Zinc accepts, return 201
   with `recorded=false`, `id=null` and a warning, rather than retrying a purchase.
7. Frontend validates the response and shows “Order submitted” and the Zinc
   status. It does not wait for retailer completion.

The row plus matched successful invocation and deployed control flow support
successful validation, Stripe reference verification, Zinc submission acceptance
and database recording. Zinc submission did start; the observation that no Zinc
order is visible in a dashboard is not proof that submission never occurred.
The exact Zinc HTTP status, full response, Stripe payment ID and Zinc request ID
were not logged/stored and cannot be reconstructed from these records.

No separate FetchIt Stripe charge creation ran: this handler has no such call.
Zinc owns the authorization/capture sequence in Connect mode. Zinc's documented
creation response can be `pending`; an accepted submission is not a completed
retailer purchase. Its GET order response exposes Connect state, payment intent,
connected account, simulation flag and job result. Those are the next required
read-only evidence, not another POST.

## State advancement and known limitations

The database row explicitly stores `pending`; it is neither a draft row nor
proof of payment/retailer completion. The table's legacy default is `completed`,
but this handler explicitly writes the returned Zinc status.

No order-table triggers, public order/Zinc routines, queue tables, pg_cron or
pg_net extensions were found. The deployed function inventory has no Zinc
webhook or order worker. Source has no Zinc status polling. Stripe webhooks
reconcile subscriptions; their configured event set does not advance purchases.
Consequently this row is an initial snapshot, and FetchIt cannot currently
observe Zinc's later success or failure. This observability gap does not prove
that Zinc's own processing failed or needs a FetchIt worker to start it.

Current read-only Stripe readiness independently verifies live account
`acct_1Th9uUQg8UTscDty`, live balance, active card payments and exact public-key
pairing using an existing intent. This proves current configuration, not an
order-specific payment. It does not search this order's Stripe transaction or
verify Zinc's linked account/mode. Both subscription webhook destinations remain
enabled; this was not changed or attributed to the order.

`ZINC_API_KEY` is present in production secret inventory. Management API lists
secret names, not values. The existing admin diagnostic endpoint has no Zinc
order retrieval or order-specific Stripe search. No authenticated Zinc connector
or usable browser surface was available; native Chrome access was rejected by
the computer-use tool. No credentials were exported or security restrictions
bypassed. Therefore current Zinc status, key live/test mode, Connect linkage,
job error, payment ID and upstream request IDs remain unverified.

The first failed transaction step and cause are **not proven**. Available evidence
ends at an accepted pending submission and successful backend response. It does
not prove device receipt/rendering of that response. No frontend crash/network
telemetry was available. The earlier card setup declines are different
SetupIntent operations; they do not explain this accepted order.

## Targeted local safety fix and regression tests

A separate client defect is demonstrated offline: the original screen's
`submitting` React state remains false between rapid taps before a render, so its
actual handler submits twice. It also offers retry advice after transport errors
whose outcome may already include an accepted purchase.

Added a synchronous ref lock, retained after successful submission (including
`recorded=false`) or uncertain outcome. Transport failures, malformed
confirmations and ambiguous Zinc responses now direct the user to order history
and support and disable another purchase on that screen. A definite rejection
can still be explicitly retried with the same idempotency key. No automatic
charge/purchase retries were added.

This is a safety fix, **not a demonstrated resolution of this order's downstream
problem**. The lock is screen-local; it is not durable protection across remounts,
app restarts or devices. Zinc receives the existing idempotency key, but FetchIt
has no persistent submission reservation or unique Zinc-ID constraint. Durable
idempotency and status reconciliation need a separately reviewed implementation.

Ten offline tests execute actual screen/service/backend source with mocked
providers. Coverage includes duplicate taps before render, taps after success,
accepted-but-unrecorded orders, ambiguous outcomes, explicit rejection retries
with the same key, and Zinc rejection preventing local insertion. No network
or provider purchase is used by these tests.

Validation: all ten focused tests pass; TypeScript and `git diff --check` pass.
Full Node suite: 45 pass, one skipped, one existing failure
(`Google authentication bypass remains disabled`). Auth code was untouched.

## Safely completing the investigation/order

Retrieve existing Zinc order `ca260bad-0964-40d5-8150-dde5357a30aa` with the same
account/credential context used by the deployed function. Inspect only its
status, timestamps, timeline, job error code and `connect` state/payment-intent
ID/account/simulation flag. If GET returns not found, verify account and key mode
before concluding no order exists. Then retrieve the existing Stripe intent in
that exact account/mode and correlate its request IDs/events with Zinc's timeline.
Use existing provider read access or support; do not paste keys into chat.

If already purchased/charged, recover confirmation and reconcile from verified
provider evidence. If still pending, determine why processing is waiting before
any further purchase. If conclusively failed with no active authorization,
charge or purchase, obtain a new explicit purchase decision after correcting the
proven cause. Until these reads distinguish the outcomes, this order cannot be
safely completed by retrying, replaying events or manually marking it successful.

Primary references:
- https://docs.expo.dev/versions/v56.0.0/
- https://docs.expo.dev/versions/v56.0.0/sdk/crypto/
- https://supabase.com/docs/guides/observability/advanced-log-filtering
- https://www.zinc.com/docs/v2/api-reference/orders/create-order
- https://www.zinc.com/docs/v2/api-reference/orders/get-order
- https://www.zinc.com/docs/v2/api-reference/introduction/webhooks
