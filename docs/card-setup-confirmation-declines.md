# September 21 confirmation failure investigation

Started from clean commit aad85fb4531d18a466631193f2dc274cab59fb0c.

The reported “Card setup failed ... update FetchIt” message is emitted in
Cards & Address only after confirmSetupIntent or confirmPlatformPaySetupIntent
returns an error. Setup creation and response validation precede that branch;
finishSavingCard/save-card and profile mapping follow successful confirmation.
The text discards the native error and does not identify its cause.

## Correlated production evidence

Supabase function invocation logs and Stripe SetupAttempts/setup_failed events
agree on the latest three failures. All times below are September 21, UTC
(Eastern is UTC minus four hours).

| Supabase create-setup-intent completed | HTTP | Stripe confirmation request | Stripe error / decline code |
| --- | --- | --- | --- |
| 06:52:28.837 | 200 | req_PwtSIILqhAdq3f | card_declined / invalid_account |
| 06:52:40.537 | 200 | req_06qvlG9pwgKnjT | card_declined / generic_decline |
| 06:52:59.326 | 200 | req_cvEtiKv3PhAdFD | card_declined / generic_decline |

Latest SetupIntent: seti_1UI15yQg8UTscDtyQdgy1csq, created 06:52:58 UTC.
Its confirmation attempt setatt_1UI15zQg8UTscDty5ED2buee failed at 06:52:59;
event evt_1UI160Qg8UTscDtyLE1NBXvi at 06:53:00 supplies the request ID above.
The intent remains requires_payment_method with livemode true. No save-card
invocation occurred in the queried four-hour window.

The live account is acct_1Th9uUQg8UTscDty with card_payments active. These are
actual recorded card confirmation declines, not missing SetupIntents or failed
card mapping. The native confirmation reached Stripe and resolved the live
intent. The deployed create-setup-intent v17 performs exact-key readback before
returning a new-client response. No new key/account mismatch was demonstrated.

A narrow backend classifier checked whether Stripe's saved error explicitly
reports a known test card used in live mode. It does not for these three errors.
This does not prove which card was entered. No raw error messages or card fields
were returned, stored, or logged by the diagnostic addition.

The request IDs above come from Stripe's event request records. Full Dashboard
request-log bodies were not available through the current workspace credentials.
The latest log can be opened by an authorized Stripe Dashboard user:
https://dashboard.stripe.com/acct_1Th9uUQg8UTscDty/logs/req_cvEtiKv3PhAdFD

A generic_decline does not establish the underlying issuer or risk-system reason.
It cannot be repaired by rotating keys, recreating the same intent repeatedly,
or changing an error string. No claim is made that the card decline is fixed.
Review the linked Stripe request/risk decision; if it is an issuer decline, the
cardholder must resolve it with the issuer or use a different valid card. Do not
bypass risk controls or automatically retry a declined card.

## Runtime and installation verification limits

Apple now reports build 7 (App Store Connect build
fe3a77af-d589-4a31-bdb6-efb564ed8dea) processingState VALID, uploaded
2026-09-21 05:37:43 UTC. This confirms import, not installation on this phone.
The previously inspected signed build 7 IPA has production App Attest, the
approved live Stripe key, production Supabase URL and OTA disabled.

Direct device enumeration remains blocked by CoreDevice/CoreSimulator permissions.
The user was asked for the existing Cards & Address footer, attempt time/timezone,
and Save Card versus Apple Pay. That information has not yet been received.
The latest server attempts are temporally consistent with this report but their
attribution to this particular phone is not conclusively verified.

## Changes and checks

Added admin-only ?setupAttempts=true to stripe-readiness using its existing
authentication gate. It reads the latest ten intents and their attempts plus
recent setup_failed events. A strict output allowlist returns only timestamps,
object/request IDs, state/mode, error codes and a boolean test-card classification.
It never returns full Stripe objects, payment methods, billing data, error
messages, keys or client secrets. No new logging of these objects was added.

Deployed stripe-readiness v16 to fpphpncruohjlppqhfep. Authentication behavior is
preserved; unauthenticated diagnostic access is checked to return 401. No
payment-path backend function, mobile code, App Attest, or webhook changed.
No mobile rebuild is warranted by the available evidence. No SetupIntent was
created or confirmed by this investigation; no card was charged.

Regression fixtures cover the observed generic_decline and invalid_account
codes, correlation IDs, and exclusion of secret/card/error-message fields.
All 13 focused tests, Deno checking, and git diff --check pass.

References: https://docs.stripe.com/declines/codes and
https://docs.stripe.com/api/setup_attempts/list .

## Follow-up: network evidence and misleading error handling

Authenticated reads of the same SetupIntents, SetupAttempts and failed events
now include the error's network_decline_code, network_advice_code and advice_code.
For req_cvEtiKv3PhAdFD and req_06qvlG9pwgKnjT, none of those codes is
returned (the allowlisted summary normalizes missing values to null). For the earlier
invalid_account attempt req_PwtSIILqhAdq3f, advice_code is do_not_try_again and
both network fields are null. Missing network fields do not establish a risk
block or an issuer response. The available evidence does not demonstrate a
configuration/integration defect causing the declines, nor identify their origin.

The workspace can authenticate Stripe API reads through the protected backend.
It has no authenticated Stripe Dashboard/browser connector or Stripe CLI session
for the full request log and risk decision. The API event correlates the request
ID but is not the full Dashboard log. No unsupported log endpoints or credentials
were used to imply additional access.

Single next action: contact Stripe Support for request req_cvEtiKv3PhAdFD on
account acct_1Th9uUQg8UTscDty and ask whether Stripe blocked the SetupIntent
confirmation before authorization or received an issuer decline, and what exact
remediation is required. Include timestamp 2026-09-21 06:52:59 UTC and SetupIntent
seti_1UI15yQg8UTscDtyQdgy1csq. Do not attach card fields or client secrets.

A separate integration defect is proven in the user-facing error handling:
Stripe React Native supplies code=Failed, stripeErrorCode=card_declined and a
declineCode, but both confirmation handlers discarded all fields and emitted
“update FetchIt.” They now use a shared static-message classifier keyed on
structured codes. Declines direct the user to a different card or issuer help
without asserting who declined; invalid accounts avoid retry advice. Cancellation,
field validation, authentication and unknown errors have separate messages. Raw
Stripe message/localizedMessage fields are never displayed or logged. Existing
safe diagnostics and stale-session protections remain intact.

Backend diagnostics deployed as stripe-readiness v17; unauthenticated requests
still return 401. 21 focused regression tests pass, including execution of the
actual Save Card and Apple Pay handlers with mocked confirmation results: declines
never reach mapping or automatically retry, and successful confirmation still
reaches mapping. TypeScript and Deno checks pass. These offline success fixtures
are not proof of a successful real card save.

Production build 1.0.0 (8) was requested solely to distribute the proven client
error-handling fix because OTA is disabled. EAS build ID:
00767489-f1f8-4b02-b36c-e7fbf31f7cd1 . The submission descriptor selects this exact
build. Artifact verification and submission status are recorded below when ready.
No changes to Stripe keys, fraud controls, App Attest, or webhooks were made.

Sources: https://docs.stripe.com/api/request_ids and
https://docs.stripe.com/declines/card .

### Build 8 artifact result

Build 1.0.0 (8) finished successfully. Independent inspection of the downloaded
signed IPA confirmed the corrected decline text is present and the former
“update FetchIt” sentence is absent. Native version/build are 1.0.0 (8), signed
App Attest remains production, embedded payment configuration equals the approved
live Stripe/production Supabase configuration, camera purpose remains present,
and OTA is disabled.

https://expo.dev/accounts/durick17/projects/fetchit-mobile/builds/00767489-f1f8-4b02-b36c-e7fbf31f7cd1

It has not been uploaded or installed by this workspace. The working Apple
app-specific password is not retained here. For release installation, the existing
private Terminal uploader now selects build 8:

```sh
cd /Users/neilduddukuri/Downloads/fetchit-mobile-main
python3 scripts/submit-testflight.py
```

This upload is separate from resolving the underlying decline. The single next
investigation action remains asking Stripe Support to trace the recorded request.
No real successful confirmation or card mapping has been verified.
