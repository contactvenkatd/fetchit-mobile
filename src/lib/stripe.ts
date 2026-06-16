// Stripe config (mobile) — publishable key only, safe to ship.
//
// As on the web, the *secret* key never touches the client: creating customers
// and subscriptions happens in the same Supabase Edge Functions the web app
// deploys (create-subscription, create-setup-intent, save-card, …). The app's
// job is limited to collecting the card via @stripe/stripe-react-native and
// confirming the PaymentIntent/SetupIntent the function returns.
//
// Wrap the navigation tree in <StripeProvider publishableKey={STRIPE_PUBLISHABLE_KEY}>.
// NOTE: card collection works in Expo Go, but Apple Pay requires a development
// build with `merchantIdentifier` set in the app.json Stripe plugin config.

// Stripe test-mode publishable key (same project as the web app). No real charges.
export const STRIPE_PUBLISHABLE_KEY =
  'pk_test_51Th9ugHqjZ0DYGoFydiFTMk58JXPCXzCcJxpdj0dFWC11vdv4sTiFuE5JPwu74G4jc8wQThpG8f7jL3AtDfVv89A00LkDZYfo2';

// Authoritative price map — MUST stay in sync with the web app's PLAN_PRICING
// and the create-subscription edge function's cents/interval table.
//   Plus — $4.99 flat (monthly only, no commitment)
//   Pro  — $19.99/mo or $17.99/mo billed annually ($215.88/yr)
//   Max  — $99.99/mo or $89.99/mo billed annually ($1,079.88/yr), 5 members
export const PLAN_PRICING = {
  Plus: {
    monthly: { cents: 499, interval: 'month', perMonth: 4.99 },
    annual: { cents: 499, interval: 'month', perMonth: 4.99 },
    flat: true,
  },
  Pro: {
    monthly: { cents: 1999, interval: 'month', perMonth: 19.99 },
    annual: { cents: 21588, interval: 'year', perMonth: 17.99 },
  },
  Max: {
    monthly: { cents: 9999, interval: 'month', perMonth: 99.99 },
    annual: { cents: 107988, interval: 'year', perMonth: 89.99 },
    family: 5,
  },
} as const;

export type PlanName = 'Free' | keyof typeof PLAN_PRICING;
export type Billing = 'monthly' | 'annual';

const billingKey = (b: Billing): 'monthly' | 'annual' =>
  b === 'annual' ? 'annual' : 'monthly';

// "1,079.88" / "17.99" — 2-decimal USD with thousands separators.
export function money(n: number): string {
  return Number(n).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Per-month sticker price for a paid plan + billing period (0 for Free/unknown).
export function monthlyDisplay(plan: PlanName, billing: Billing): number {
  if (plan === 'Free') return 0;
  const p = PLAN_PRICING[plan];
  return p ? p[billingKey(billing)].perMonth : 0;
}

export function isFlatPlan(plan: PlanName): boolean {
  return plan !== 'Free' && !!(PLAN_PRICING[plan] as { flat?: boolean }).flat;
}

export function familyMembers(plan: PlanName): number {
  if (plan === 'Free') return 0;
  return (PLAN_PRICING[plan] as { family?: number }).family ?? 0;
}
