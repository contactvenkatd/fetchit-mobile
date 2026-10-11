// Sandbox evidence only. No quote adapter or assumed fees are used for requests.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sandboxKey, sandboxFetch } = require('./providers.cjs');
(async () => {
  const request = sandboxFetch(await sandboxKey());
  const observations = [];
  for (const budget of [1000, 1200]) {
    const response = await request('https://api.zinc.com/orders', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        products: [{ url: 'https://zinc.com/shop/products/test-success', quantity: 1 }],
        max_price: budget, idempotency_key: crypto.randomUUID(),
        shipping_address: { first_name: 'Sandbox', last_name: 'Agent',
          address_line1: '101 Market St', city: 'San Francisco', state: 'CA',
          postal_code: '94105', country: 'US', phone_number: '4155552671' },
        payment: { mode: 'connect', customer: 'cus_fixture', payment_method: 'pm_fixture',
          margin: { type: 'flat', value: 235 } },
      }) });
    assert.equal(response.status, 201);
    let order = await response.json();
    const orderId = order.id;
    for (let attempt = 0; attempt < 5; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 1000));
      const refreshed = await request(`https://api.zinc.com/orders/${orderId}`);
      assert.equal(refreshed.ok, true);
      order = await refreshed.json();
      if (order.connect?.final_charge != null) break;
    }
    assert.equal(order.connect?.simulated, true);
    assert.ok(Number.isSafeInteger(order.connect.secured_amount));
    assert.ok(Number.isSafeInteger(order.connect.zinc_fee));
    observations.push({ orderId: order.id, retailerBudgetCents: budget,
      marginCents: 235, simulated: true,
      status: order.status, connectState: order.connect.state,
      retailerTotalCents: order.job_result?.price_components?.total ?? null,
      transferCents: order.connect.transfer_amount ?? null, securedCents: order.connect.secured_amount,
      budgetPlusGrossFeeCents: budget + 235,
      exceedsBudgetPlusGrossFee: order.connect.secured_amount > budget + 235,
      zincFeeCents: order.connect.zinc_fee, stripeFeeCents: order.connect.stripe_fee ?? null,
      finalChargeCents: order.connect.final_charge ?? null });
  }
  const evidence = { observedAt: new Date().toISOString(), scope: 'Zinc sandbox only; not a production pricing contract',
    customerCeilingVerified: false, observations };
  require('node:fs').writeFileSync('docs/zinc-gross-fee-sandbox-evidence.json', JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
})().catch(error => {
  console.log(JSON.stringify({ outcome: 'failed', code: error.code || error.cause?.code || error.name }));
  process.exitCode = 1;
});
