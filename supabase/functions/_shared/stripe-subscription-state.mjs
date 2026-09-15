// Pure policy shared by the webhook and offline tests. Stripe is authoritative.
export const SUBSCRIPTION_EVENTS = new Set([
  'customer.subscription.created', 'customer.subscription.updated',
  'customer.subscription.deleted', 'customer.subscription.paused',
  'customer.subscription.resumed', 'invoice.paid', 'invoice.payment_failed',
  'invoice.payment_action_required',
]);

export function subscriptionState(subscriptions) {
  const plans = new Set(['Plus', 'Pro', 'Max']);
  const ours = subscriptions.filter(s => plans.has(s.metadata?.plan));
  if (!ours.length) return null;
  const usable = ours.filter(s => ['active', 'trialing', 'past_due'].includes(s.status))
    .sort((a, b) => b.created - a.created || b.id.localeCompare(a.id));
  const sub = usable[0];
  if (!sub) {
    // An initial failed/incomplete checkout must not revoke an unrelated plan.
    if (ours.every(s => ['incomplete', 'incomplete_expired'].includes(s.status))) return null;
    return { plan: 'Free', plan_billing: 'monthly', plan_cancels_at: null, stripe_subscription_status: 'inactive' };
  }
  const interval = sub.items?.data?.[0]?.price?.recurring?.interval;
  const end = sub.current_period_end ?? sub.items?.data?.[0]?.current_period_end;
  if (!['month', 'year'].includes(interval)) throw new Error('Unsupported billing interval');
  if (sub.cancel_at_period_end && !Number.isFinite(end)) throw new Error('Missing period end');
  return {
    plan: sub.metadata.plan,
    plan_billing: interval === 'year' ? 'annual' : 'monthly',
    plan_cancels_at: sub.cancel_at_period_end ? new Date(end * 1000).toISOString() : null,
    stripe_subscription_status: sub.status,
  };
}
