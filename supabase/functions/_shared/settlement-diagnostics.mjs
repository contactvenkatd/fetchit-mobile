// Admin-only GET diagnostics. No credential values, addresses or raw errors leave memory.
const cents = v => Number.isSafeInteger(v) && v >= 0 ? v : null;
const choice = (v, allowed) => allowed.includes(v) ? v : null;
const machine = v => typeof v === 'string' && /^[a-z][a-z_]{0,50}$/.test(v) && !/^(?:sk_|zn_|pk_|rk_)/.test(v) ? v : null;
const piId = v => typeof v === 'string' && /^pi_[A-Za-z0-9]+$/.test(v) ? v : null;
const expectedAccount = 'acct_1Th9uUQg8UTscDty';
const originalId = 'd22c4050-dac6-49f5-a3f7-7e2b604cd9fe';
function paymentSummary(p) {
  const charge = p.latest_charge && typeof p.latest_charge === 'object' ? p.latest_charge : {};
  const b = charge.balance_transaction && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : {};
  return { live: p.livemode === true, status: machine(p.status), amountCents: cents(p.amount),
    capturableCents: cents(p.amount_capturable), receivedCents: cents(p.amount_received),
    applicationPresent: Boolean(p.application), applicationFeeCents: cents(p.application_fee_amount),
    transferAmountCents: cents(p.transfer_data?.amount), balanceAvailable: Boolean(b.id),
    balanceFeeCents: cents(b.fee), balanceNetCents: Number.isSafeInteger(b.net) ? b.net : null,
    fees: Array.isArray(b.fee_details) ? b.fee_details.map(f => ({
      type: choice(f.type, ['stripe_fee', 'application_fee', 'payment_method_passthrough_fee', 'tax']), amountCents: cents(f.amount) })) : [] };
}
function orderSummary(o) {
  const c = o.connect ?? {}, prices = o.job_result?.price_components ?? o.price_components ?? {};
  return { status: machine(o.status), connectState: machine(c.state), simulated: c.simulated === true,
    expectedAccountLinked: c.connected_account_id ? c.connected_account_id === expectedAccount : null,
    paymentReferencePresent: Boolean(piId(c.payment_intent_id)),
    securedCents: cents(c.secured_amount), orderCostCents: cents(c.order_cost),
    marginCents: cents(c.customer_margin), zincFeeCents: cents(c.zinc_fee),
    stripeFeeCents: cents(c.stripe_fee), finalChargeCents: cents(c.final_charge), transferCents: cents(c.transfer_amount),
    retailerCosts: { subtotal: cents(prices.subtotal), shipping: cents(prices.shipping), tax: cents(prices.tax), total: cents(prices.total) } };
}
export async function settlementDiagnostics(stripe, zincKey, fetcher = fetch) {
  const account = await stripe.accounts.retrieve();
  if (account.id !== expectedAccount) return { error: 'payment_account_mismatch', financialOperations: 0 };
  let c = account.controller ?? {};
  let explicitAccountLookup = 'not_needed';
  if (!c.fees?.payer) {
    try {
      const explicit = await stripe.accounts.retrieve(expectedAccount);
      if (explicit.id !== expectedAccount) return { error: 'payment_account_mismatch', financialOperations: 0 };
      c = explicit.controller ?? c;
      explicitAccountLookup = 'same_account_verified';
    } catch { explicitAccountLookup = 'unavailable'; }
  }
  const report = { observedAt: new Date().toISOString(), effectiveStripeSecret: 'STRIPE_SECRET_KEY',
    accountVerified: true, chargesEnabled: account.charges_enabled === true, payoutsEnabled: account.payouts_enabled === true,
    cardPayments: machine(account.capabilities?.card_payments),
    accountType: choice(account.type, ['standard', 'express', 'custom', 'none']),
    controllerReturned: Boolean(account.controller), explicitAccountLookup,
    feePayerFieldReturned: typeof c.fees?.payer === 'string',
    controllerType: choice(c.type, ['account', 'application']),
    feePayer: choice(c.fees?.payer, ['account', 'application', 'application_custom', 'application_express']),
    lossesPayments: choice(c.losses?.payments, ['stripe', 'application']),
    dashboardType: choice(c.stripe_dashboard?.type, ['full', 'express', 'none']),
    financialOperations: 0, integratedSettlementVerified: false, zincOrders: [], recentStripePayments: [] };
  // Existing Stripe records only. This does not label unrelated payments as Zinc payments.
  try {
    const payments = await stripe.paymentIntents.list({ limit: 20, expand: ['data.latest_charge.balance_transaction'] });
    report.recentStripePayments = payments.data.filter(p => p.livemode === true).map(paymentSummary);
  } catch { report.stripeExistingPaymentsRead = 'unavailable'; }
  if (!/^zn_live_[A-Za-z0-9_-]+$/.test(zincKey ?? '')) {
    report.zincRead = 'live_credential_unavailable'; return report;
  }
  const read = async path => {
    if (!['/wallet/me', '/orders?limit=20', `/orders/${originalId}`].includes(path)) throw new Error('read_target_forbidden');
    const r = await fetcher('https://api.zinc.com' + path, { method: 'GET', headers: { Authorization: `Bearer ${zincKey}` }, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!r.ok) return { unavailableHttpStatus: r.status };
    return r.json();
  };
  let wallet;
  try { wallet = await read('/wallet/me'); } catch { report.zincRead = 'identity_read_unavailable'; return report; }
  if (wallet.user_id !== 1035) { report.zincRead = wallet.unavailableHttpStatus ? `identity_http_${wallet.unavailableHttpStatus}` : 'account_mismatch'; return report; }
  report.zincIdentityVerified = true; report.walletOrderFeeCents = cents(wallet.order_fee_cents);
  const orders = [];
  try { const original = await read(`/orders/${originalId}`); if (original.unavailableHttpStatus) report.originalOrderReadHttpStatus = original.unavailableHttpStatus; else orders.push(original); } catch { report.originalOrderRead = 'unavailable'; }
  try {
    const recent = await read('/orders?limit=20');
    if (Array.isArray(recent.orders)) orders.push(...recent.orders.filter(o => o.id !== originalId && o.connect));
    else report.zincRecentOrdersRead = recent.unavailableHttpStatus ? `http_${recent.unavailableHttpStatus}` : 'shape_unavailable';
  } catch { report.zincRecentOrdersRead = 'unavailable'; }
  for (const order of orders.slice(0, 20)) {
    const summary = orderSummary(order), id = piId(order.connect?.payment_intent_id);
    if (id && order.connect?.connected_account_id === expectedAccount && order.connect?.simulated !== true) {
      try {
        const p = await stripe.paymentIntents.retrieve(id, { expand: ['latest_charge.balance_transaction'] });
        if (p.livemode === true) summary.stripePayment = paymentSummary(p);
        else summary.stripePaymentRead = 'mode_mismatch';
      } catch { summary.stripePaymentRead = 'unavailable'; }
    }
    report.zincOrders.push(summary);
  }
  return report;
}
