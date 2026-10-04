const assert = require('node:assert/strict');
const { backend, mount } = require('./harness.cjs');
const { sandboxKey, sandboxFetch } = require('./providers.cjs');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  let stage = 'sandbox key';
  const report = { completeCheckoutVerified: false, customerCeilingVerified: false,
    pricing: 'Real estimate contract; unknown shipping/tax/processing remain null; no guaranteed ceiling',
    adapters: ['Native UI primitives', 'Supabase authentication and database', 'Stripe reference reads'],
    zinc: 'not run', stripe: 'not run', realRetailerPurchase: false };
  try {
    const key = await sandboxKey();
    const upstream = sandboxFetch(key);
    for (const slug of ['test-success', 'test-price-exceeded', 'test-invalid-address', 'test-insufficient-funds']) {
      stage = `${slug}: submit`;
      const app = backend({ key, upstream }); const ui = mount(app.api, slug);
      try {
        await ui.start(); await ui.click('Approve estimate');
        const button = ui.button('Place Order');
        await ui.act(async () => { button.click(); button.click(); }); await ui.flush();
        assert.equal(app.calls.submissions.length, 1);
        const submissionDeadline = Date.now() + 15000;
        while (ui.container.textContent.includes('Loading') && Date.now() < submissionDeadline) {
          await ui.act(async () => { await new Promise(r => setTimeout(r, 100)); });
        }
        assert.doesNotMatch(ui.container.textContent, /Loading/, 'Submission must resolve before checking its result');
        if (['test-success', 'test-price-exceeded'].includes(slug)) {
          stage = `${slug}: terminal status`;
          // The screen polls every five seconds, and each real provider read may
          // take up to ten seconds. Allow delivery plus two polling cycles.
          const deadline = Date.now() + 35000;
          while (Date.now() < deadline && !/Retailer status: delivered|max_price_exceeded/.test(ui.container.textContent)) {
            await ui.act(async () => { await new Promise(r => setTimeout(r, 1000)); });
          }
          assert.match(ui.container.textContent, slug === 'test-success' ? /Retailer status: delivered/ : /max_price_exceeded/);
          assert.match(ui.container.textContent, /Payment status: simulated/);
          assert.doesNotMatch(ui.container.textContent, /Actual captured amount/);
          // Verify Zinc's own duplicate-key enforcement, independently of the UI lock.
          stage = `${slug}: duplicate key`;
          const repeated = await upstream('https://api.zinc.com/orders', { method: 'POST', body: JSON.stringify(app.calls.submissions[0]), headers: { 'Content-Type': 'application/json' } });
          const duplicate = await repeated.json();
          assert.equal(repeated.ok, false); assert.equal(duplicate.code ?? duplicate.error?.code, 'already_exists');
        } else {
          stage = `${slug}: creation failure`;
          assert.equal(app.calls.inserts.length, 0);
          assert.doesNotMatch(ui.container.textContent, /Order submitted/);
          assert.match(ui.container.textContent, slug === 'test-invalid-address' ? /address|shipping/i : /funds/i);
        }
        console.log(`ZINC SANDBOX partial integration passed: ${slug}; auth/DB/Stripe refs mocked; estimate logic real`);
      } finally { await ui.close(); }
    }
    report.zinc = 'passed: partial UI/backend sandbox integration; simulated purchase only';
  } catch (error) {
    report.zinc = `blocked or failed: ${error.code ?? error.cause?.code ?? error.name}`;
    report.zincFailure = { stage, operator: error.operator,
      // Omit assertion values and provider response bodies, which may contain secrets.
      location: error.stack?.split('\n').find(line => line.includes('sandbox.cjs:'))?.trim() };
    process.exitCode = 1;
  }
  // This audit reuses completed evidence; never creates another Stripe intent.
  const evidence = JSON.parse(fs.readFileSync(path.join(__dirname, '../../docs/checkout-provider-evidence.json'), 'utf8')).stripe;
  assert.equal(evidence.outcome, 'passed');
  assert.equal(evidence.livemode, false);
  report.stripe = { outcome: 'saved evidence reused', scope: evidence.scope, runId: evidence.runId,
    completedAt: evidence.completedAt, newStripeOperations: 0 };
  console.log(JSON.stringify(report, null, 2));
  // This runner never certifies the full flow: production pricing and Zinc-owned
  // Stripe Connect authorization/capture are outside the provisional sandbox.
})().catch(error => { console.error(error.name); process.exitCode = 1; });
