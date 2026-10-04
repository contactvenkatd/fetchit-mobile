const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, mount } = require('./harness.cjs');

test('Actual UI and handler: $100 subtotal sends flat 550-cent Connect margin and displays one $6.50 Service fee', async () => {
  // No network transport or live payment references are used in this capture.
  const app = backend();
  const ui = mount(app.api, 'test-success', { priceCents: '10000', quantity: '1' });
  try {
    await ui.start();
    assert.match(ui.container.textContent, /Service fee: USD 6\.50/);
    assert.equal((ui.container.textContent.match(/Service fee:/g) || []).length, 1);
    assert.doesNotMatch(ui.container.textContent, /FetchIt service fee/);
    assert.match(ui.container.textContent, /shipping, taxes, and processing fees \(amounts unknown\)/);
    assert.equal(ui.button('Place Order').disabled, true);
    // Increasing retailer budget for shipping/tax must not increase our margin.
    await ui.setBudget('150.00');
    assert.match(ui.container.textContent, /Service fee: USD 6\.50/);
    await ui.click('Approve estimate'); await ui.click('Place Order');
    assert.equal(app.calls.submissions.length, 1);
    const sent = app.calls.submissions[0];
    assert.equal(sent.payment.mode, 'connect');
    assert.deepEqual(sent.payment.margin, { type: 'flat', value: 550 });
    assert.equal(sent.max_price, 15000);
    assert.equal(sent.metadata.fetchit_item_subtotal_cents, 10000);
    assert.equal(sent.metadata.fetchit_margin_cents, 550);
    assert.equal(sent.metadata.zinc_fee_cents, 100);
    assert.equal(app.calls.inserts[0].service_fee, 5.5);
  } finally { await ui.close(); }
});
