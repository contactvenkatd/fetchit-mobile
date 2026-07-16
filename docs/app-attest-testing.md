# App Attest testing

Local tests need no Apple, Google, Supabase, or production credentials:

```sh
npm test
npm run lint
npx tsc --noEmit
```

## Coverage

| Security behavior | Local automated coverage | External coverage |
| --- | --- | --- |
| Google auth bypass disabled | UI and gateway source invariant | Physical app smoke test |
| Stale-key recovery bounded to one retry | Shared recovery policy | Physical iPhone stale-key flow |
| Missing server device bounded to one registration | Shared recovery policy | Delete staging device row |
| AAGUID environment | Pure verifier identity policy | Development/production Apple artifact |
| RP ID and key ID | Pure verifier identity policy | Physical App Attest registration |
| Nonce binding | Pure constant-time comparison policy | Physical App Attest registration |
| Certificate chain | Pure fail-closed chain policy | Real Apple `x5c` artifact |
| Missing Apple configuration | Pure configuration policy | Staging secrets removed |
| Assertion counter replay | Pure counter policy and atomic SQL invariant | Replay against staging |
| Canonical request alteration | Shared canonical serializer | Altered staging assertion request |

The local policy tests cover every requested rejection without credentials. Full parsing, certificate signatures, Secure Enclave artifacts, database RPC execution, and device retry behavior remain staging/physical-device integration coverage.

## Disposable Supabase staging

1. Create a new disposable Supabase project. Never reuse the production project or its keys.
2. Link the CLI to that staging ref: `npx supabase link --project-ref STAGING_REF`.
3. Apply migrations with `npx supabase db push`, then deploy only to staging with `npx supabase functions deploy attestation-challenge verify-app-attest verify-play-integrity auth-gateway`.
4. Set staging secrets: `APPLE_APP_ID=PV7JV2P9Q8.ai.compreo.fetchit`, `APPLE_ATTEST_ENV=development`, `RESEND_API_KEY` for a test-only Resend account, and Android secrets only if testing Android. Supabase supplies its URL and service-role key.
5. Run the safe smoke scaffold. The explicit opt-in and hostname/ref check are intentional:

```sh
ALLOW_DISPOSABLE_SUPABASE_STAGING=yes \
STAGING_PROJECT_REF=STAGING_REF \
STAGING_SUPABASE_URL=https://STAGING_REF.supabase.co \
STAGING_SUPABASE_ANON_KEY=STAGING_ANON_KEY \
PRODUCTION_PROJECT_REF=PRODUCTION_REF \
node --test tests/app-attest-staging.integration.test.js
```

6. Inspect staging tables after each negative test: a rejected proof must not create an `attested_devices` row; challenges must be consumed once; assertion counters must increase atomically. Delete the project when finished.

## Physical iPhone

1. Use an App ID/provisioning profile for `ai.compreo.fetchit` with App Attest enabled and add the test iPhone to the development profile.
2. Point the app's public Supabase URL and anon key to the disposable staging project.
3. Set `APPLE_ATTEST_ENV=development` in staging. Build the `development` EAS profile; confirm the generated entitlement is `development`. Do not use Expo Go or a simulator.
4. Install on the physical iPhone. Sign up, receive the test email OTP, verify it, sign out, and sign in again. Confirm registration followed by assertions and a strictly increasing server counter.
5. Delete the staging `attested_devices` row while leaving the phone key intact; the next auth request must re-register once and succeed. Repeat the deletion while forcing registration failure; confirm there is only one re-registration attempt.
6. To exercise stale-key recovery, invalidate/remove the App Attest key state in a test build or reinstall/reset the test app, then attempt auth. Confirm one key reset/retry only.
7. Negative staging variants: set the wrong `APPLE_ATTEST_ENV`, wrong `APPLE_APP_ID`, or remove either secret, redeploy staging, and confirm auth fails. Restore the correct secrets after each case.
8. Replay a captured assertion and alter one canonical field (`action`, challenge id, email, or platform) in a staging-only test client. Confirm rejection and no counter advance.
9. Record Edge Function logs and the staging device/challenge rows, then remove the development build and delete the disposable project.

Real Apple certificate-chain, AAGUID, nonce, key identity, and assertion-signature validation require artifacts from a physical App Attest-capable iPhone. The local suite tests their deterministic fail-closed policy; the staging/iPhone flow tests the external cryptographic path.
