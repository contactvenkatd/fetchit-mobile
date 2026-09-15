import Stripe from 'npm:stripe@17.7.0';
import { createClient } from 'npm:@supabase/supabase-js@2';

// Admin-only diagnostics: Stripe/database reads plus an optional signed, ignored
// webhook probe (no financial or database mutations). Invoke with
// the Supabase service-role credential; never add this credential to the app.
Deno.serve(async (req) => {
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const auditToken = Deno.env.get('STRIPE_READINESS_TOKEN');
  const adminAuthorized = serviceKey && req.headers.get('authorization') === `Bearer ${serviceKey}`;
  const auditAuthorized = auditToken && req.headers.get('x-readiness-token') === auditToken;
  if (!adminAuthorized && !auditAuthorized) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (req.method !== 'GET') return Response.json({ error: 'method_not_allowed' }, { status: 405 });
  const key = Deno.env.get('STRIPE_SECRET_KEY')?.trim();
  if (!key) return Response.json({ stripeSecretPresent: false }, { status: 503 });
  const live = key.startsWith('sk_live_');
  const url = Deno.env.get('SUPABASE_URL')!;
  if (new URL(url).hostname === 'fpphpncruohjlppqhfep.supabase.co' && !live) {
    return Response.json({ error: 'production_requires_live_key', stripeSecretPresent: true,
      configuredKeyKind: key.startsWith('sk_test_') ? 'test_secret'
        : key.startsWith('rk_live_') ? 'live_restricted'
        : key.startsWith('pk_') ? 'publishable' : 'unrecognized_format',
      containsAssignment: key.startsWith('STRIPE_SECRET_KEY='),
      containsWrappingQuotes: /^[\"']/.test(key),
      webhookSigningSecretPresent: Boolean(Deno.env.get('STRIPE_WEBHOOK_SECRET')),
    }, { status: 503 });
  }
  const stripe = new Stripe(key, { apiVersion: '2025-02-24.acacia' });
  let stage = 'stripe_account';
  let accountSummary = {};
  try {
    const account = await stripe.accounts.retrieve();
    accountSummary = { stripeAuthenticated: true, accountId: account.id, chargesEnabled: account.charges_enabled, payoutsEnabled: account.payouts_enabled, capabilities: account.capabilities };
    stage = 'stripe_balance';
    const balance = await stripe.balance.retrieve();
    stage = 'stripe_webhooks';
    const endpoints = [];
    for await (const endpoint of stripe.webhookEndpoints.list({ limit: 100 })) {
      endpoints.push({ id: endpoint.id, apiVersion: endpoint.api_version, ownAccount: endpoint.application === null, url: new URL(endpoint.url).origin + new URL(endpoint.url).pathname, livemode: endpoint.livemode,
        status: endpoint.status, enabledEvents: endpoint.enabled_events });
    }
    // Prove key pairing by retrieving an EXISTING live intent using the app's
    // exact public key. No intents, customers or transactions are created.
    const publicKey = 'pk_live_51Th9uUQg8UTscDtyq5PmFrg5LvlMc0KhzXpoSs3k42rBZfJkFOpaCQ6zSegBxrzIt0arakY1fB1MDeVi9FfZrSLA00uREA0Mlp';
    let publishableKeyPairing: Record<string, unknown> = { verified: false, reason: 'no_existing_live_intent' };
    try {
      const publicStripe = new Stripe(publicKey, { apiVersion: '2025-02-24.acacia' });
      const setup = (await stripe.setupIntents.list({ limit: 1 })).data[0];
      if (setup?.client_secret) {
        const readback = await publicStripe.setupIntents.retrieve(setup.id, { client_secret: setup.client_secret });
        publishableKeyPairing = { verified: readback.id === setup.id && readback.livemode === true, method: 'existing_setup_intent_readback' };
      } else {
        const payment = (await stripe.paymentIntents.list({ limit: 1 })).data[0];
        if (payment?.client_secret) {
          const readback = await publicStripe.paymentIntents.retrieve(payment.id, { client_secret: payment.client_secret });
          publishableKeyPairing = { verified: readback.id === payment.id && readback.livemode === true, method: 'existing_payment_intent_readback' };
        }
      }
    } catch (error) {
      publishableKeyPairing = { verified: false, reason: 'readback_unavailable', upstreamStatus: (error as { statusCode?: number }).statusCode ?? null };
    }
    // This synthetic event is intentionally outside the handler's supported
    // event set, so successful signature verification returns ignored before
    // accessing Stripe or the database. Never generate a billing event here.
    let webhookSignatureProbe: Record<string, unknown> = { attempted: false };
    const signingSecret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
    if (new URL(req.url).searchParams.get('verify_webhook') === '1' && signingSecret) {
      const body = JSON.stringify({ id: 'evt_fetchit_configuration_probe', object: 'event',
        type: 'fetchit.configuration_probe', livemode: live, data: { object: {} } });
      const timestamp = Math.floor(Date.now() / 1000);
      const encoder = new TextEncoder();
      const hmacKey = await crypto.subtle.importKey('raw', encoder.encode(signingSecret),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
      const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', hmacKey, encoder.encode(`${timestamp}.${body}`)));
      const digest = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      const response = await fetch(`${url}/functions/v1/stripe-webhook`, { method: 'POST',
        headers: { 'content-type': 'application/json', 'stripe-signature': `t=${timestamp},v1=${digest}` }, body });
      const result = await response.json();
      webhookSignatureProbe = { attempted: true, status: response.status,
        validSignatureAccepted: response.ok && result.received === true && result.ignored === true,
        financialEvent: false };
    }
    stage = 'supabase_profile_audit';
    if (!serviceKey) throw new Error('Backend database credential missing');
    const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const counts = { profiles: 0, valid: 0, missingReferences: 0, wrongModeOrOwner: 0, unavailable: 0 };
    for (let offset = 0; ; offset += 100) {
      const { data: profiles, error } = await admin.from('profiles')
        .select('user_id,stripe_customer_id,stripe_payment_method_id').order('user_id').range(offset, offset + 99);
      if (error) throw new Error('Profile audit unavailable');
      for (const profile of profiles ?? []) {
        counts.profiles++;
        if (!profile.stripe_customer_id || !profile.stripe_payment_method_id) { counts.missingReferences++; continue; }
        try {
          const customer = await stripe.customers.retrieve(profile.stripe_customer_id);
          const pm = await stripe.paymentMethods.retrieve(profile.stripe_payment_method_id);
          const { data, error: userError } = await admin.auth.admin.getUserById(profile.user_id);
          if (userError || !data.user) { counts.unavailable++; continue; }
          const pmCustomer = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id;
          if (customer.deleted || customer.livemode !== live || pm.livemode !== live ||
            customer.metadata.supabase_uid !== profile.user_id || pmCustomer !== customer.id ||
            data.user.user_metadata.stripe_customer_id !== customer.id) counts.wrongModeOrOwner++;
          else counts.valid++;
        } catch (error) {
          if ((error as { code?: string }).code === 'resource_missing') counts.wrongModeOrOwner++;
          else counts.unavailable++;
        }
      }
      if (!profiles || profiles.length < 100) break;
    }
    return Response.json({
      stripeAuthenticated: true, keyMode: live ? 'live' : 'test', balanceLiveMode: balance.livemode,
      accountId: account.id, chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled, detailsSubmitted: account.details_submitted,
      capabilities: account.capabilities, requirementsCurrentlyDue: account.requirements?.currently_due,
      webhookSigningSecretPresent: Boolean(Deno.env.get('STRIPE_WEBHOOK_SECRET')),
      endpoints, profileAudit: counts, publishableKeyPairing, webhookSignatureProbe,
      limitations: ['If no existing live intent is available, publishable-key/account pairing requires Dashboard verification.',
        'Zinc Connect account linkage requires Zinc Dashboard verification.',
        'No financial transaction was attempted.'],
    });
  } catch (error) {
    return Response.json({ error: 'readiness_check_failed', failedCheck: stage,
      stripeSecretPresent: true, webhookSigningSecretPresent: Boolean(Deno.env.get('STRIPE_WEBHOOK_SECRET')),
      ...accountSummary, upstreamStatus: (error as { statusCode?: number }).statusCode ?? null,
    }, { status: 502 });
  }
});
