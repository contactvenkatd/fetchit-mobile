# Explicit retailer budget release — 2026-10-11

## Contract and rollout

Deploy the matching backend before distributing the replacement client. Production
place-order v18 is ACTIVE with verify_jwt=true. Search-products remains v17 ACTIVE
with verify_jwt=true. No migrations, credentials, payment settings, or other
functions were changed.

The replacement client requires a typed integer-cent USD retailer budget at least
as large as the item subtotal. It displays shipping/tax headroom and requires
separate acknowledgment for zero headroom before estimate approval. Editing the
budget clears both acknowledgment and approval. Shipping, tax, and processing
remain unknown; Service and processing fees are additional to the retailer budget.
The server sends the approved retailer budget unchanged as Zinc max_price.

Consent revision usd-explicit-budget-v3 is included in the server-generated quote
digest. Cached v2 approvals fail exact quote binding before Stripe reference reads
or provider submission. Equal-subtotal budgets additionally require the boolean
acknowledgesZeroHeadroom=true. The replacement client rejects v2 quotes, so backend
rollback to v17 would block its checkout; do not restore v2 consent as a fallback.
A further correction must preserve or explicitly supersede this consent contract.

After this deployment, build 14 rejects v3 quotes as checkout_pricing_unavailable
and cannot approve a new checkout. Its cached v2 approval is rejected by v18 as
checkout_approval_required. An in-flight request already accepted before deployment
is not retroactively changed. Build 14 can still use the unchanged authenticated
order-status and persistent recovery paths; this deployment does not clear its
pending journal or authorize a retry. Install replacement build 15 for new checkout.
Temporary blocking of new checkout in build 14 is intentional during rollout.

Authentication and ownership, live/test mode checks, saved card/customer matching,
complete saved address including apartment/unit, signed listing and variants,
server-calculated 200 + round(subtotal cents × 0.035) margin plus one 100-cent Zinc
fee, duplicate submission locks and uncertain-outcome protection remain intact.
The device journal is written before submission and survives restart. A pending
attempt stays locked; no release step resets it.

## Validation

Reused completed tests without rerunning provider operations: 106 offline checkout
checks (including build-14/v3 rollout compatibility), the separate margin regression,
TypeScript noEmit, and whitespace checks passed. The broader Node suite has 69
passed, one skipped, and one unrelated failure: “Google authentication bypass
remains disabled” in tests/app-attest-hardening.test.js expects a disabled Google
button in the unchanged login screen. Authentication source was not changed.

Fresh deployed-source download matches all five release files byte for byte:
place-order/index.ts, checkout-pricing.ts, stripe-backend.ts, order-status.ts, and
listing-price.ts. A production POST containing only action=quote without an
Authorization header returned gateway HTTP 401 UNAUTHORIZED_NO_AUTH_HEADER.
No authenticated purchase or provider financial request was issued.

## Replacement artifact and Apple

Exactly one production iOS build was created with existing remote signing
credentials: EAS 779b3267-5a4d-4466-bfc4-1f634cee6fab, version 1.0.0, build 15.
EAS remote numbering advanced from 14 to 15. EAS_NO_VCS=1 avoided this workspace's
Git metadata restriction. No duplicate build or credential change was requested.

The build finished at 2026-10-11T05:01:31.627Z. Its downloaded IPA passed deep/strict
code-signature verification and embedded version/build identity checks. The signed
app entitlement is exactly production App Attest; the CMS-verified App Store
provisioning profile permits production, matches the expected app/team, has no
device list, and disables get-task-allow. OpenSSL verified/decoded the profile
without keychain writes. Budget-entry, headroom, zero-headroom acknowledgment,
usd-explicit-budget-v3, persistent pending-journal and unresolved-attempt markers
are present in the signed bundle; usd-service-fee-v2 is absent. The native SecureStore
module is present, and all recorded release source digests are unchanged. Mock UI
and restart tests are reused; these artifact checks do not claim native execution.

IPA SHA256: cd0517e75e681c5f40a8420a53cd7c7b603e1f7fff90c453d3b9ff16dc3da361.
Local artifact: dist/checkout-explicit-budget-build-15/FetchIt-1.0.0-15.ipa (ignored).
The TestFlight selector now points to this verified build 15. The unchanged upload
workflow independently verified its identity and camera purpose; it ignores the
saved build-14 delivery receipt. A final EAS listing shows exactly one replacement
build, build 15 FINISHED, followed by the existing builds 14 and 13.

Apple status for build 15: upload not attempted, processing not started by this
workflow, and Apple acceptance/internal testing availability not established.

The existing scripts/submit-testflight.py workflow reads an app-specific password
with hidden Terminal input and persists only public delivery identifiers. No Apple
upload credential is available in this session. Run from Terminal:

```sh
cd /Users/neilduddukuri/Downloads/fetchit-mobile-main
PATH="/Users/neilduddukuri/.npm-global/bin:$PATH" python3 scripts/submit-testflight.py
```

Upload success, Apple processing, and Apple acceptance are separate states. A
successful upload/delivery ID alone is not acceptance. The workflow checks delivery
status and requires validated import plus presence on App Store Connect; internal
TestFlight availability additionally requires BETA_INTERNAL_TESTING. The saved
build-14 receipt cannot establish any status for build 15.

## Scope limits

No live order or payment was created, retried, cancelled, or modified. Order
d22c4050-dac6-49f5-a3f7-7e2b604cd9fe was left untouched. This release neither fixes
that pending order nor proves physical delivery. Native iPhone runtime, actual
SecureStore restart lifecycle, complete deployed authenticated purchase transport,
live Zinc Connect authorization/capture, retailer acceptance, and physical shipment
remain unverified. Mock restart checks and signed bundle markers provide narrower
evidence; device-local storage does not establish cross-device exclusion or recovery
after deleting app/keychain data.

Git release work uses a temporary checkout because this workspace forbids writes
to Git metadata. Remote main is fetched and integrated before a normal push; no
force push is used. Only source, tests, release selection and sanitized documentation
are included; generated IPAs, unpacked apps, logs and credentials remain excluded.
