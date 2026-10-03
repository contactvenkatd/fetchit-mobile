// Sandbox evidence only. No quote adapter or assumed fees are used for requests.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { sandboxKey, sandboxFetch } = require('./providers.cjs');
(async () => {
  const request = sandboxFetch(await sandboxKey());
  const observations = [];
  for (const budget of [908, 909, 1000]) {
    const response = await request('https://api.zinc.com/orders', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({
        products: [{ url: 'https://zinc.com/shop/products/test-success', quantity: 1 }],
        max_price: budget, idempotency_key: crypto.randomUUID(),
        shipping_address: { first_name: 'Sandbox', last_name: 'Agent',
          address_line1: '101 Market St', city: 'San Francisco', state: 'CA',
          postal_code: '94105', country: 'US', phone_number: '4155552671' },
        payment: { mode: 'connect', customer: 'cus_fixture', payment_method: 'pm_fixture',
          margin: { type: 'flat', value: 0 } },
      }) });
    assert.equal(response.status, 201);
    const order = await response.json();
    assert.equal(order.connect?.simulated, true);
    assert.ok(Number.isSafeInteger(order.connect.secured_amount));
    assert.ok(Number.isSafeInteger(order.connect.zinc_fee));
    observations.push({ orderId: order.id, retailerBudgetCents: budget,
      marginCents: 0, simulated: true, securedCents: order.connect.secured_amount,
      zincFeeCents: order.connect.zinc_fee, stripeFeeCents: order.connect.stripe_fee ?? null,
      finalChargeCents: order.connect.final_charge ?? null });
  }
  console.log(JSON.stringify({ scope: 'Zinc sandbox only; not a production pricing contract',
    customerCeilingVerified: false, observations }, null, 2));
})().catch(error => {
  console.log(JSON.stringify({ outcome: 'failed', code: error.code || error.cause?.code || error.name }));
  process.exitCode = 1;
});
