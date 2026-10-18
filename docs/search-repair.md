# Search repair — 2026-10-18

Production search is restored. The authenticated deployed query **Best wireless
headphones under $100** returned four real Zinc products, and the actual client
parser and chat screen rendered all four cards. One had a verified USD offer
(ASIN B0HJWJQTB9, 4,999 cents) and signed price proof. Three were explicitly
unverified and disabled for checkout. See [sanitized evidence](search-repair-evidence.json).

## Exact cause and production evidence

Search-products v21 exactly matched the working repository search source and its
shared modules. It required `checkQuota` before any Zinc call. Production had no
`usage_quotas`, no `plan_entitlements`, and neither `quota_consume` nor
`quota_status` RPC. Production logs at 04:21:22 and 04:22:46 UTC show
`usage-quota: quota check failed (zinc)` and search HTTP 503. This was missing
schema deployment, not exhausted user budget, a Zinc credential failure, or a
Zinc response contract change. The handler correctly failed closed.

The customized deployed parse-shopping-intent v17 differs from the repository:
it has the existing personality prompt and does not include the newer quota
module. Its tool invocation worked. It was preserved, not replaced as part of
this repair. Thus Grok text could continue while the product search gate failed.
The existing client showed only a generic retry message for the search error.

A bounded production-key, GET-only probe read the wallet, searched wireless
headphones once, and read one candidate's details and offers. Wallet authentication
succeeded for the expected account, with 1,267 cents spendable before the probe.
Search returned 22 real catalog rows. Search/details/offers returned HTTP 200 in
2.4/6.2/2.7 seconds. No response-contract failure or timeout occurred in that
probe. A temporary admin-only diagnostic function used the existing management
login, exposed no credentials, and was removed after verification.

The final authenticated query did encounter two HTTP 429 enrichment failures.
These are a second, now-handled upstream condition: the original catch-and-drop
behavior would hide those products. The repaired handler returned their actual
search titles/images/ASINs with unknown price/currency, no proof, a clear reason,
and checkout disabled. Another result lacked an eligible verified offer; a fifth
candidate exceeded the requested budget and remained excluded. No automatic
provider retries were added.

## Fix and safeguards

Applied the repository's two existing quota migrations in order, including
numeric dollar metering, RLS and service-role-only RPC permissions. Added
`scripts/verify-search-prerequisites.py` as a read-only release gate. Deployed
search-products **v23**, JWT verification retained, and the missing usage-status
**v1** endpoint. Downloaded deployed source maps match the tested handlers and
shared modules exactly.

Search errors distinguish provider credits, authentication, rate limits and other
upstream failures. The client maps known codes to safe, actionable messages;
errors never become successful empty results or trigger AI zero-results prose.
Only a genuine successful empty search uses the existing suggestion path.

Optional details/variant/offer enrichment no longer silently discards otherwise
valid catalog cards. Unverified results cannot obtain listing proofs. Missing
shipping data remains unknown and does not invalidate a verified product offer.
The existing explicit currency/price-proof checks, supported offer/variant guards,
retailer spending limits, fee split, processing disclosure/consent, saved-address
mapping and duplicate/restart protections are preserved. No purchase handler,
credential, order, authorization hold or payment charge was changed or created.

## Verification and scope

- 49 focused mocked checks passed across quota, search-contract and card/error
  tests, including a missing-RPC failure followed by restored-RPC search access,
  optional enrichment timeout, missing shipping, wrong currency/variant/quantity,
  and upstream HTTP 401/402/429/500.
- All 129 checkout regression checks passed. These use mocked providers unless
  explicitly opted into a real provider run; no order-enabled real test was run.
- TypeScript and whitespace checks passed.
- Broader unit suite: 109 passed, one pre-existing failure in the Google sign-in
  assertion. Both the failing test and login source are unchanged from repository
  HEAD; the isolated assertion still fails. It was not altered to hide the failure.
- One real continuous deployed shopping/UI verification passed in 16.2 seconds:
  actual shopping query → deployed Grok tool intent → authenticated search with
  working quota accounting → real Zinc → actual client parsing → four rendered
  chat cards. Native layout/auth UI and persistence are adapters, so native phone
  execution is not claimed. No AI-only response or fake product fixture counts
  as the result.
- Two bounded authenticated searches used 18 successful metered Zinc calls total;
  the diagnostic used three more. The final search used seven successful calls
  and preserved cards through two failed/rate-limited enrichment calls. The
  existing account's usage endpoint reported 18 cents used of its 50-cent search
  budget. No orders, holds or payment charges were created. Credentials unchanged.

The live UI test accepts an explicitly supplied line-delimited JSON invocation
bridge via `FETCHIT_SEARCH_LIVE_BRIDGE`; its allowlist must contain only
parse-shopping-intent, search-products and usage-status, never orders. Default
mock tests need no credentials:

```sh
node --test tests/usage-quota.test.js tests/checkout-e2e/currency-search.test.cjs tests/checkout-e2e/search-regression.test.cjs
npm run test:checkout
npx tsc --noEmit
python3 scripts/verify-search-prerequisites.py
```

## iOS release

Client changes require a phone update for specific errors and explicit disabled
unverified cards. Existing build 17 can receive restored backend product results;
its checkout still rejects missing evidence. One replacement production build
19 was requested: `b46de3e9-0902-4aa6-bf15-5b72c4b25f65`.
Build 18 was incremented but failed before archive upload because the workspace
Git configuration is read-only; no EAS build was created for it. Build 19 used
EAS's no-VCS archive mode and preserves the existing checkout/shipping source.
The release selector now points to verified build 19. The signed App Store IPA
has production App Attest, both new search markers and all checked checkout
safeguard markers. Preserved checkout source digests match the previous shipping
audit. See [artifact verification](search-repair-artifact-verification.json).
No Apple upload or TestFlight availability is claimed here.

The workspace Git directory is read-only. The fix is committed/pushed from a
writable checkout on top of the already-pushed checkout/shipping commits, leaving
all existing workspace changes intact. No force push is used.
