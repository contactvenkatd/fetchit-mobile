// Executes complete application modules. Native layout primitives, auth and DB
// are test adapters; the service, screen handlers, pricing and backend are real.
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');
const crypto = require('node:crypto');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
function load(file, imports = {}, globals = {}, stripImports = false) {
  let source = fs.readFileSync(path.join(root, file), 'utf8');
  if (stripImports) {
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
    source = ast.statements.filter(x => !ts.isImportDeclaration(x)).map(x => x.getFullText(ast)).join('\n');
  }
  const context = { exports: {}, require(name) {
    if (Object.hasOwn(imports, name)) return imports[name];
    throw new Error(`Unexpected module ${name}`);
  }, TextEncoder, crypto: crypto.webcrypto, Date, setTimeout, clearTimeout, ...globals };
  vm.runInNewContext(ts.transpileModule(source, { compilerOptions: {
    target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText, context, { filename: file });
  return context.exports;
}
const pricing = load('supabase/functions/_shared/checkout-pricing.ts');
const userId = crypto.randomUUID();
const localOrderId = crypto.randomUUID();
const zincId = crypto.randomUUID();
const profile = { full_name: 'Sandbox Agent', country: 'US', phone_number: '4155552671',
  stripe_payment_method_id: 'pm_fixture', stripe_customer_id: 'cus_fixture',
  address_line1: '101 Market St', city: 'San Francisco', state: 'CA', zip: '94105' };
function backend({ upstream, stripe, key = 'zn_test_fixture', pricingAvailable = true, persistFails = false, owned = true, production = false, capturedCents = 950 } = {}) {
  const liveMode = key.startsWith('zn_live_');
  const calls = { submissions: [], inserts: [], statuses: 0, stripeReads: 0, invocations: [] };
  let handler;
  let saved;
  const paymentStripe = () => stripe || {
    customers: { retrieve: async () => { calls.stripeReads++; return { livemode: liveMode, metadata: { supabase_uid: userId } }; } },
    paymentMethods: { retrieve: async () => { calls.stripeReads++; return { livemode: liveMode, customer: profile.stripe_customer_id }; } },
    accounts: { retrieve: async () => ({ id: 'acct_fixture' }) },
    paymentIntents: { retrieve: async () => ({ livemode: liveMode, status: 'succeeded', amount_received: capturedCents, currency: 'usd' }) },
  };
  const providerFetch = async (url, options) => {
    if (url === 'https://api.zinc.com/orders' && options?.method === 'POST') {
      calls.submissions.push(JSON.parse(options.body));
    } else calls.statuses++;
    if (upstream) return upstream(url, options);
    return Response.json(options?.method === 'POST' ? { id: zincId, status: 'pending', connect: { simulated: true } } : {
      id: zincId, status: 'order_placed', tracking_numbers: [{ status: 'delivered' }],
      connect: { simulated: true, final_charge: 950 },
    });
  };
  const status = load('supabase/functions/_shared/order-status.ts', {
    './stripe-backend.ts': { paymentStripe, stripeIsLive: () => liveMode },
  }, { fetch: providerFetch, AbortSignal }).readOrderStatus;
  const db = {
    auth: { getUser: async () => ({ data: { user: { id: userId,
      user_metadata: { stripe_customer_id: profile.stripe_customer_id } } } }) },
    from(table) {
      if (table === 'profiles') return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }) };
      return {
        select: () => { const filters = {}; const q = { eq(k, v) { filters[k] = v; return q; },
          maybeSingle: async () => ({ data: owned && saved && filters.id === localOrderId && filters.user_id === userId
            ? { id: localOrderId, zinc_order_id: saved.zinc_order_id } : null }) }; return q; },
        insert(row) { calls.inserts.push(row); saved = row; return { select: () => ({ single: async () => persistFails
          ? { error: { message: 'mock database failure' } } : { data: { id: localOrderId } } }) }; },
      };
    },
  };
  load('supabase/functions/place-order/index.ts', {}, {
    Response, Request, URL, AbortSignal, console,
    Deno: { env: { get: n => ({ SUPABASE_URL: production ? 'https://fpphpncruohjlppqhfep.supabase.co' : 'https://isolated.invalid', SUPABASE_ANON_KEY: 'mock', ZINC_API_KEY: key })[n] }, serve: fn => { handler = fn; } },
    createClient: () => db, paymentStripe, stripeIsLive: () => liveMode,
    createCheckoutQuote: context => pricingAvailable ? pricing.createCheckoutQuote(context) : null,
    approvesQuote: pricing.approvesQuote, readOrderStatus: status, fetch: providerFetch,
  }, true);
  const invoke = async (_, { body }) => {
    calls.invocations.push(body);
    const response = await handler(new Request('https://isolated.invalid/place-order', {
      method: 'POST', headers: { Authorization: 'Bearer mock-user' }, body: JSON.stringify(body),
    }));
    const data = await response.json();
    return response.ok ? { data, error: null } : { data: null, error: { context: { json: async () => data } } };
  };
  return { calls, invoke, api: load('src/services/orderService.ts', { '@/lib/supabase': { supabase: { functions: { invoke } } } }) };
}
function mount(api, slug = 'test-success', params = {}) {
  const { JSDOM } = require('jsdom');
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://isolated.invalid' });
  global.window = dom.window; global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const React = require('react');
  const { createRoot } = require('react-dom/client');
  const { act } = React;
  const h = React.createElement;
  let changeBudget;
  const wrapper = tag => ({ children }) => h(tag, null, children);
  const native = {
    View: wrapper('div'), Text: wrapper('span'), ScrollView: wrapper('div'),
    ActivityIndicator: () => h('span', null, 'Loading'), StyleSheet: { create: x => x },
    TextInput: ({ value, onChangeText, accessibilityLabel, editable }) => { changeBudget = onChangeText; return h('input', {
      value, 'aria-label': accessibilityLabel, disabled: editable === false, onChange: e => onChangeText(e.target.value),
    }); },
    Pressable: ({ children, disabled, onPress }) => h('button', { disabled, onClick: onPress }, children),
  };
  const common = { react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'react-native': native };
  const colors = load('src/theme/colors.ts');
  const button = load('src/components/ui/Button.tsx', { ...common, '@/theme/colors': colors });
  const screen = load('src/app/(app)/checkout-confirmation.tsx', {
    ...common, 'expo-crypto': { randomUUID: crypto.randomUUID }, 'expo-image': { Image: () => null },
    'expo-router': { useRouter: () => ({ replace() {}, back() {} }), useLocalSearchParams: () => ({
      productUrl: `https://zinc.com/shop/products/${slug}`, title: 'Isolated checkout fixture', retailer: 'Zinc sandbox', priceCents: '1000', quantity: '1', currency: 'USD', ...params,
    }) }, '@/components/ui/Button': button, '@/components/ui/Screen': { Screen: wrapper('main') },
    '@/lib/api': { getProfile: async () => ({ fullName: profile.full_name, addressLine1: profile.address_line1,
      city: profile.city, state: profile.state, zip: profile.zip, country: profile.country,
      stripeCustomerId: profile.stripe_customer_id, stripePaymentMethodId: profile.stripe_payment_method_id, cardLast4: '4242', cardBrand: 'visa' }) },
    '@/services/orderService': api, '@/theme/colors': colors,
    '@/services/checkoutPricing': load('src/services/checkoutPricing.ts'),
  }).default;
  const container = document.getElementById('root');
  const reactRoot = createRoot(container);
  const flush = async () => { await act(async () => { await new Promise(r => setTimeout(r, 20)); }); };
  return { container, act, flush,
    setBudget: async value => { await act(async () => changeBudget(value)); await flush(); },
    start: async () => { await act(async () => reactRoot.render(h(screen))); await flush(); },
    button: label => [...container.querySelectorAll('button')].find(b => b.textContent === label),
    click: async label => { const b = [...container.querySelectorAll('button')].find(b => b.textContent === label);
      if (!b) throw new Error(`Missing button ${label}`); await act(async () => b.click()); await flush(); },
    close: async () => { await act(async () => reactRoot.unmount()); dom.window.close(); },
  };
}
module.exports = { backend, mount, load, profile, userId, localOrderId, zincId };
