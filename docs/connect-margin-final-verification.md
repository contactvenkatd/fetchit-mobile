# Final Connect margin verification

**PASS — deployed code/configuration and targeted payload/UI test.** No confirmed mismatch was found. No client/backend fix, rebuild, configuration/credential change or live order/hold/charge/transfer/payout occurred.

Fresh read-only deployed source-map inspection matched place-order v16, checkout-pricing and stripe-backend exactly to the source executed by the test. The server derives subtotal from signed unit price times quantity and computes `200 + round(itemSubtotalCents × 0.035)` once with BigInt intermediates. It sends only that amount as flat Connect margin; retailer budget, shipping, tax, Zinc and processing fees do not enter its percentage base.

For a 10000-cent item subtotal, the captured sanitized request fields are:

```json
{
  "payment": {
    "mode": "connect",
    "margin": { "type": "flat", "value": 550 }
  },
  "max_price": 15000,
  "metadata": {
    "fetchit_item_subtotal_cents": 10000,
    "fetchit_margin_cents": 550,
    "zinc_fee_cents": 100
  }
}
```

Increasing the retailer budget to 15000 cents leaves margin at 550 cents. The actual checkout UI displays exactly one **Service fee: USD 6.50**, with shipping, taxes and processing fees separately disclosed as unknown. Zinc's 100 cents is excluded from our 550-cent earnings; internal database service_fee records only our $5.50 margin. The test captures the actual handler's outgoing body with mocked native/auth/database/Stripe/provider transports and makes no Zinc network request.

Targeted regression: `node --test tests/checkout-e2e/connect-margin.test.cjs` — **1 passed**. Existing rounding, quantity, consent and tampering tests remain unchanged and their evidence was reused.

## Read-only account ownership

A fresh GET to the existing authenticated deployed Stripe readiness diagnostic verified live account **acct_1Th9uUQg8UTscDty**, charges/payouts enabled and publishable-key pairing. It retrieves saved Customers and PaymentMethods with that account's configured backend secret, verifies live mode, the method's attached Customer, Customer ownership metadata and authenticated user metadata. No connected-account override is used. The current audit reports one valid saved pair, one profile missing references and one wrong-mode/owner profile; invalid/missing profiles remain blocked and cannot be certified as valid pairs.

The actual place-order handler repeats those ownership/mode checks before Zinc submission. Thus the verified valid pair resides on the intended account; this is not a claim that every legacy profile is valid. User 1035 and this account's Zinc linkage were established by earlier authenticated evidence; the user's fresh dashboard confirmation says Connected and Your account is ready, without independently showing those IDs.

## Documented settlement versus actual payout

[Zinc Connect documentation](https://www.zinc.com/docs/v2/connect) explicitly defines flat margin values in cents, saved Customer/PaymentMethod references on the connected account, a shared customer charge, margin settlement to that Stripe account, and Zinc retention of retailer cost plus its standard $1 fee as reimbursement. For this example our documented margin is $5.50; Zinc's fee remains $1 separately. Processing costs are additionally disclosed; its example rate is not assumed to be our applicable rate.

This verifies request construction, current account scope and documented settlement semantics. A Zinc-owned live capture, settlement transaction, Stripe transfer, payout and bank receipt remain untested. No actual payout is claimed.
