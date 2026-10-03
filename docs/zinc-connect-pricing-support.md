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
