export function validateSetupClient(body, live) {
  // Older web clients send an empty body; retain their existing contract.
  if (body.publishableKey === undefined) return null;
  const key = body.publishableKey;
  if (typeof key !== 'string' || !/^pk_(live|test)_[A-Za-z0-9]+$/.test(key) ||
      key.startsWith('pk_live_') !== live || body.stripeAccountId != null) {
    throw new Error('Payment configuration mismatch. Update FetchIt before saving a card.');
  }
  return key;
}

export async function verifiedSetupResponse(publicStripe, setup, customerId, publicKey) {
  if (!setup.client_secret) throw new Error('Missing setup secret');
  // Retrieve the very same intent with the client's exact public credential.
  // This proves account, mode and platform context, without confirming a card.
  if (publicStripe) {
    const readback = await publicStripe.setupIntents.retrieve(setup.id, { client_secret: setup.client_secret });
    if (readback.id !== setup.id || readback.livemode !== setup.livemode) throw new Error('Key pairing failed');
  }
  return {
    id: setup.id, clientSecret: setup.client_secret, customerId,
    livemode: setup.livemode, stripeAccountId: null,
    publishableKey: publicKey, keyPairVerified: Boolean(publicStripe),
  };
}
