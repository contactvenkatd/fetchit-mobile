# Checkout end-to-end verification — incomplete

This directory currently contains only the isolated DOM test dependencies.
The UI/backend/Zinc sandbox runner has not been implemented or executed.
No Stripe test-mode integration has run; no test secret is available in the
current execution environment. Production credentials have not been accessed
or changed for these tests. No sandbox key or sandbox order was created.

The existing 31 focused checkout tests use mocks for auth, database, Stripe
reference reads and Zinc requests, and a fictional pricing adapter only to
exercise approval enforcement. They do NOT verify production Zinc fees or
provide end-to-end/native UI verification. The production pricing adapter
continues to return unavailable pending the facts listed in
../../docs/zinc-connect-pricing-support.md.

Local read-only order-status polling has been added to checkout and the backend,
but its integration verification remains outstanding. It is not deployed.
Do not report "automated checkout verification passed" or start a release build
on the basis of these dependencies or focused tests alone.
