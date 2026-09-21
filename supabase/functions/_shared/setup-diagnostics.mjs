// Strict allowlist: never return full Stripe objects, messages, payment methods,
// billing details, credentials, or client secrets from diagnostic reads.
export function setupFailureSummary(error) {
  if (!error) return null;
  return {
    testCardInLiveMode: /live mode/i.test(error.message ?? '') && /(?:known )?test card/i.test(error.message ?? ''),
    type: error.type ?? null,
    code: error.code ?? null,
    declineCode: error.decline_code ?? null,
    networkDeclineCode: error.network_decline_code ?? null,
    networkAdviceCode: error.network_advice_code ?? null,
    adviceCode: error.advice_code ?? null,
    requestId: error.request_log_url?.match(/req_[A-Za-z0-9]+/)?.[0] ?? null,
  };
}

export async function recentSetupDiagnostics(stripe) {
  const intents = await stripe.setupIntents.list({ limit: 10 });
  const setups = [];
  for (const intent of intents.data) {
    const attempts = await stripe.setupAttempts.list({ setup_intent: intent.id, limit: 10 });
    setups.push({
      id: intent.id, created: intent.created, status: intent.status, livemode: intent.livemode,
      lastError: setupFailureSummary(intent.last_setup_error),
      attempts: attempts.data.map(attempt => ({
        id: attempt.id, created: attempt.created, status: attempt.status,
        error: setupFailureSummary(attempt.setup_error),
      })),
    });
  }
  const events = await stripe.events.list({ type: 'setup_intent.setup_failed', limit: 20 });
  return {
    setups,
    failedEvents: events.data.map(event => ({
      id: event.id, created: event.created, setupIntentId: event.data.object.id,
      requestId: typeof event.request === 'string' ? event.request : event.request?.id ?? null,
      error: setupFailureSummary(event.data.object.last_setup_error),
    })),
  };
}
