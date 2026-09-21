// No secrets are persisted here. A generation invalidates every outstanding
// continuation when the user, environment, or screen changes.
export function createSetupSession() {
  let generation = 0;
  let active = null;
  return {
    reset() { generation++; },
    begin() {
      if (active) return null;
      const ticket = { generation };
      active = ticket;
      return ticket;
    },
    current(ticket) { return active === ticket && ticket.generation === generation; },
    finish(ticket) { if (active === ticket) active = null; },
  };
}

export function validateSetupResponse(data, publishableKey) {
  if (!data || typeof data.id !== 'string' || !/^seti_[A-Za-z0-9]+$/.test(data.id) ||
      typeof data.clientSecret !== 'string' ||
      !data.clientSecret.startsWith(`${data.id}_secret_`) ||
      !/^seti_[A-Za-z0-9]+_secret_[A-Za-z0-9]+$/.test(data.clientSecret)) {
    throw new Error('Card setup returned an invalid session. Please try again.');
  }
  if (data.publishableKey !== publishableKey ||
      data.livemode !== publishableKey.startsWith('pk_live_') ||
      data.stripeAccountId !== null || data.keyPairVerified !== true) {
    throw new Error('Payment configuration changed. Restart or update FetchIt before saving a card.');
  }
  return data;
}

// Shared across screen remounts so an in-flight native confirmation keeps its lock.
export const cardSetupSession = createSetupSession();
