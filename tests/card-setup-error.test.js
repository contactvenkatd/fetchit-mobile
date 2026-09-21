const test = require('node:test');
const assert = require('node:assert/strict');
const { cardSetupErrorMessage } = require('../src/lib/card-setup-error.mjs');

test('actual native generic decline shape gives actionable guidance without blaming configuration or issuer', () => {
  const message = cardSetupErrorMessage({ code: 'Failed', stripeErrorCode: 'card_declined', declineCode: 'generic_decline', type: 'card_error', message: 'PRIVATE' });
  assert.match(message, /declined.*not saved.*different card/);
  assert.doesNotMatch(message, /update|FetchIt|issuer declined|bank declined|PRIVATE/);
});
test('invalid account gives verification guidance; fraud declines do not disclose risk decisions', () => {
  assert.match(cardSetupErrorMessage({ code: 'Failed', stripeErrorCode: 'card_declined', declineCode: 'invalid_account' }), /Use a different card/);
  for (const declineCode of ['fraudulent', 'lost_card', 'stolen_card']) {
    const message = cardSetupErrorMessage({ code: 'Failed', stripeErrorCode: 'card_declined', declineCode });
    assert.match(message, /declined/);
    assert.doesNotMatch(message, /fraud|lost|stolen|update/);
  }
});
test('cancellation, field errors, authentication and unknown failures are distinct and never echo raw errors', () => {
  assert.match(cardSetupErrorMessage({ code: 'Canceled', stripeErrorCode: 'card_declined' }), /canceled/);
  assert.match(cardSetupErrorMessage({ stripeErrorCode: 'incorrect_cvc' }), /Check the details/);
  assert.match(cardSetupErrorMessage({ stripeErrorCode: 'setup_intent_authentication_failure' }), /verification was unsuccessful/);
  for (const error of [null, {}, { code: 'PRIVATE', message: 'PRIVATE', localizedMessage: 'PRIVATE' }]) {
    assert.doesNotMatch(cardSetupErrorMessage(error), /PRIVATE|update FetchIt/);
  }
});

// Execute each actual screen handler with SDK/network functions replaced, so
// these assertions cover the confirmation-to-mapping boundary, not a copied flow.
function screenHandler(name, confirmError) {
  const fs = require('node:fs');
  const vm = require('node:vm');
  const ts = require('typescript');
  const { createSetupSession } = require('../src/lib/setup-session.mjs');
  const source = ts.createSourceFile('cards-address.tsx', fs.readFileSync(require.resolve('../src/app/(app)/cards-address.tsx'), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) handler = node;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(handler);
  const calls = { create: 0, confirm: 0, save: 0, messages: [] };
  const session = createSetupSession();
  const setup = { id: 'seti_fixture', clientSecret: 'seti_fixture_secret_complete', customerId: 'cus_fixture' };
  const confirm = async secret => {
    calls.confirm++;
    assert.equal(secret, setup.clientSecret);
    return confirmError ? { error: confirmError } : { setupIntent: { id: setup.id, status: 'Succeeded', paymentMethod: { id: 'pm_fixture' } } };
  };
  const context = {
    setupSession: session, cardSetupErrorMessage, cardComplete: true,
    address: { fullName: '', addressLine1: '', addressLine2: '', city: '', state: '', zip: '' },
    PlatformPay: { PaymentType: { Immediate: 'Immediate' } },
    setCardError: message => calls.messages.push(message), setSavingCard: () => {},
    createSetupIntent: async () => { calls.create++; return { data: setup }; },
    confirmSetupIntent: confirm, confirmPlatformPaySetupIntent: confirm,
    finishSavingCard: async () => { calls.save++; },
  };
  const code = ts.transpileModule(handler.getText(source), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.createContext(context); vm.runInContext(code, context);
  return { run: context[name], calls, session };
}

for (const name of ['handleSaveCard', 'handleApplePay']) {
  test(`${name}: recorded decline is shown accurately, never saved or automatically retried`, async () => {
    const { run, calls, session } = screenHandler(name, { code: 'Failed', stripeErrorCode: 'card_declined', declineCode: 'generic_decline', message: 'PRIVATE' });
    await run();
    assert.equal(calls.create, 1);
    assert.equal(calls.confirm, 1);
    assert.equal(calls.save, 0);
    assert.match(calls.messages.at(-1), /declined.*not saved/);
    assert.doesNotMatch(calls.messages.join(' '), /PRIVATE|update FetchIt/);
    assert.ok(session.begin()); // lock released for a later, explicit user action
  });
  test(`${name}: successful confirmation still reaches card mapping`, async () => {
    const { run, calls } = screenHandler(name, null);
    await run();
    assert.equal(calls.save, 1);
  });
}
