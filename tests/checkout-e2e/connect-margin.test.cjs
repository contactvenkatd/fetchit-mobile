const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, mount } = require('./harness.cjs');

test('$100 subtotal displays a $5.50 FetchIt fee independent of retailer budget; processing is separately disclosed', async () => {
  const app = backend();
  const ui = mount(app.api, 'test-success', { priceCents: '10000', quantity: '1' });
  try {
    await ui.start(); await ui.setBudget('100.00');
    assert.match(ui.container.textContent, /FetchIt fee: USD 5\.50/);
    assert.equal((ui.container.textContent.match(/FetchIt fee:/g) || []).length, 1);
    assert.doesNotMatch(ui.container.textContent, /Service fee:/);
    await ui.setBudget('150.00');
    assert.match(ui.container.textContent, /FetchIt fee: USD 5\.50/);
    assert.match(ui.container.textContent,/Processing fee: Unknown/);
    await ui.click('Approve estimate');
    assert.equal(ui.button('Place Order').disabled,false);
    await ui.click('Place Order');
    assert.equal(app.calls.submissions.length,1);
    assert.equal(app.calls.submissions[0].payment.margin.value,450);
    assert.equal(app.calls.submissions[0].max_price,15000);
  } finally { await ui.close(); }
});
