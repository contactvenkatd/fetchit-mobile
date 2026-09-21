const test = require('node:test');
const assert = require('node:assert/strict');
const { recentSetupDiagnostics, setupFailureSummary } = require('../supabase/functions/_shared/setup-diagnostics.mjs');
test('setup diagnostics allowlist excludes secrets, raw errors, and card data', async () => {
  const error = { type: 'card_error', code: 'card_declined', decline_code: 'generic_decline', request_log_url: 'https://dashboard.stripe.com/logs/req_fixture', message: 'PRIVATE', payment_method: { card: 'PRIVATE' } };
  const intent = { id: 'seti_fixture', created: 123, status: 'requires_payment_method', livemode: true, client_secret: 'PRIVATE', metadata: { email: 'PRIVATE' }, last_setup_error: error };
  const result = await recentSetupDiagnostics({
    setupIntents: { list: async () => ({ data: [intent] }) },
    setupAttempts: { list: async params => { assert.equal(params.setup_intent, intent.id); return { data: [{ id: 'setatt_fixture', created: 124, status: 'failed', setup_error: error, payment_method_details: 'PRIVATE' }] }; } },
    events: { list: async () => ({ data: [{ id: 'evt_fixture', created: 125, request: { id: 'req_fixture' }, data: { object: intent } }] }) },
  });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|client_secret|payment_method_details|message/);
  assert.equal(result.setups[0].attempts[0].error.code, 'card_declined');
  assert.equal(result.failedEvents[0].requestId, 'req_fixture');
  assert.equal(setupFailureSummary(null), null);
});

test('recorded decline codes remain distinct from configuration failures', () => {
  for (const decline of ['generic_decline', 'invalid_account']) {
    const summary = setupFailureSummary({ type: 'card_error', code: 'card_declined', decline_code: decline });
    assert.equal(summary.code, 'card_declined');
    assert.equal(summary.declineCode, decline);
    assert.equal(summary.testCardInLiveMode, false);
  }
  const summary = setupFailureSummary({ code: 'card_declined', message: 'Your request was in live mode, but used a known test card.' });
  assert.equal(summary.testCardInLiveMode, true);
  assert.equal('message' in summary, false);
});

test('network/advice evidence remains explicit; missing network evidence is not labeled issuer or risk', () => {
  const latest = setupFailureSummary({ code: 'card_declined', decline_code: 'generic_decline' });
  assert.equal(latest.networkDeclineCode, null);
  assert.equal(latest.networkAdviceCode, null);
  assert.equal(latest.adviceCode, null);
  assert.equal('declineSource' in latest, false);
  const first = setupFailureSummary({ code: 'card_declined', decline_code: 'invalid_account', advice_code: 'do_not_try_again' });
  assert.equal(first.adviceCode, 'do_not_try_again');
  const network = setupFailureSummary({ network_decline_code: '05', network_advice_code: '03' });
  assert.equal(network.networkDeclineCode, '05');
  assert.equal(network.networkAdviceCode, '03');
});
