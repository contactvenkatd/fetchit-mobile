const assert = require('node:assert/strict');
const test = require('node:test');
const policy = import('../supabase/functions/_shared/stripe-subscription-state.mjs');
const subscription = (override = {}) => ({
  id: 'sub_test_fixture', created: 100, status: 'active', metadata: { plan: 'Pro' },
  current_period_end: 2000000000, cancel_at_period_end: false,
  items: { data: [{ price: { recurring: { interval: 'year' } } }] }, ...override,
});

test('webhook grants the latest usable plan, including when an old subscription is deleted', async () => {
  const { subscriptionState } = await policy;
  const state = subscriptionState([subscription({ status: 'canceled' }),
    subscription({ id: 'sub_new', created: 101, metadata: { plan: 'Max' } })]);
  assert.equal(state.plan, 'Max');
  assert.equal(state.plan_billing, 'annual');
});
test('failed initial checkout cannot revoke another plan or grant paid access', async () => {
  const { subscriptionState } = await policy;
  assert.equal(subscriptionState([subscription({ status: 'incomplete' })]), null);
  assert.equal(subscriptionState([]), null);
  assert.equal(subscriptionState([subscription({ metadata: { plan: 'unrelated' } })]), null);
});
test('cancellation retains access until period end then reconciles to Free', async () => {
  const { subscriptionState } = await policy;
  const state = subscriptionState([subscription({ cancel_at_period_end: true })]);
  assert.equal(state.plan, 'Pro');
  assert.equal(state.plan_cancels_at, new Date(2000000000 * 1000).toISOString());
  assert.equal(subscriptionState([subscription({ status: 'canceled' })]).plan, 'Free');
});
test('renewal failures retain access during retries but unpaid subscriptions lose access', async () => {
  const { subscriptionState } = await policy;
  assert.equal(subscriptionState([subscription({ status: 'past_due' })]).plan, 'Pro');
  assert.equal(subscriptionState([subscription({ status: 'unpaid' })]).plan, 'Free');
  assert.throws(() => subscriptionState([subscription({ items: {} })]));
});
