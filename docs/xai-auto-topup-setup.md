# xAI (Grok) auto top-up — one-time console setup

Grok's prepaid credits are topped up by **xAI's built-in auto top-up**, not by
FetchIt code. This is account configuration; do it once and record the
confirmation below. Source: [xAI billing docs](https://docs.x.ai/console/billing).

Target configuration:

| Setting (xAI label) | Value | Meaning |
|---|---|---|
| Credit balance threshold | **$10** | Top-up fires when prepaid credits drop to $10 |
| Top-up amount | **$100** | Fixed amount bought per top-up (xAI minimum $5). xAI has no "maximum per top-up" — this fixed amount is it |
| Maximum total value of top-ups per month | **$500** | Hard monthly cap; no further auto top-ups until the next billing cycle once reached |

## Steps

1. Sign in at **console.x.ai** with an account that administers the team used
   by `XAI_API_KEY`.
2. **Add a payment method first** (auto top-up charges the team's default
   payment method): **Billing → Billing details → Add Payment Information**.
   Prefer a card: xAI notes bank-transfer purchases take 2–3 business days,
   which would leave Grok without credit while a top-up settles. Make sure it
   is set as the **default** payment method.
3. Open **Billing → API spend management**.
4. Turn on **auto top-up** and enter:
   - credit balance threshold: `10`
   - top-up amount: `100`
   - maximum total value of top-ups per month: `500`
5. Save.
6. While on that page, check the **invoiced billing limit** is still **$0**
   (the default). With $0, requests are rejected once prepaid credits run out
   instead of accruing an uncapped invoice — keeping the $500/month cap a real
   ceiling.

## Confirm it worked

- The API spend management page shows auto top-up enabled with $10 / $100 / $500.
- xAI warns when 80% of the monthly top-up maximum ($400) has been used.
- After the first automatic top-up, the Usage explorer (or the Management API
  `GET /v1/billing/teams/{team_id}/prepaid/balance`) lists a change with
  `changeOrigin: AUTO_PURCHASE`.

Record: configured on ________ by ________; first AUTO_PURCHASE seen ________.

## What happens at the cap

Once $500 of top-ups have been bought in a month, xAI stops topping up. When
credits then run out, xAI rejects Grok requests: `parse-shopping-intent`
returns 502 and chat shows its generic "couldn't respond" message (search and
the rest of the app keep working). The per-user AI budgets in
`_shared/usage-quota.ts` cap individual users, but their sum across all users
can exceed $500/month — raise the xAI cap as paid usage grows.
