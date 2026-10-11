const test = require('node:test');
const assert = require('node:assert/strict');
const { backend, mount, mountHistory, load, fixtureProof, localOrderId, zincId } = require('./harness.cjs');
const pricing = load('supabase/functions/_shared/checkout-pricing.ts');
const display = load('src/services/checkoutPricing.ts');
const context = { userId: 'fixture', productUrl: 'https://retailer.example/item', quantity: 1,
  itemSubtotalCents: 399, retailerBudgetCents: 1172, currency: 'USD', profile: { address: 'fixture', payment: 'fixture' } };

test('3.5% rounds once on subtotal; shipping/tax/budget do not inflate fee', async () => {
  for (const [subtotal, fee] of [[1,200],[14,200],[15,201],[50,202],[100,204],[399,214],[798,228],[10000,550]])
    assert.equal(pricing.calculateServiceMargin(subtotal),fee-100);
  for (const subtotal of [-1, 0, 1.1, NaN, Infinity]) assert.equal(pricing.calculateServiceMargin(subtotal),null);
  const quote = await pricing.createCheckoutQuote(context);
  assert.equal(quote.fetchitMarginCents,114); assert.equal(quote.serviceFeeCents,214);
  assert.equal(quote.revision,'usd-disclosed-processing-v7');
  assert.equal(quote.serviceFeeCents,quote.fetchitMarginCents+quote.zincFeeCents); assert.equal(quote.knownCostsCents,613);
  assert.equal(quote.estimatedTotalCents,null); assert.equal(quote.shippingCents,null); assert.equal(quote.taxCents,null);
  assert.equal((await pricing.createCheckoutQuote({...context,retailerBudgetCents:2000})).fetchitMarginCents,114);
});

test('exactly five display rows; sum uses every row and refuses unknown/invalid/overflow', () => {
  const lines = display.checkoutCostLines({itemSubtotalCents:399,shippingCents:699,taxCents:74,serviceFeeCents:214,paymentFeeCents:72},399);
  assert.deepEqual(Array.from(lines,l=>l.label),['Product price','Shipping','Tax','FetchIt fee','Processing fee']);
  assert.equal(display.checkoutTotalCents(lines),1458);
  assert.equal(display.checkoutTotalCents(display.checkoutCostLines(null,399)),null);
  assert.equal(display.checkoutTotalCents([{cents:399},{cents:0},{cents:0},{cents:214},{cents:0}]),613);
  assert.equal(display.checkoutTotalCents([{cents:399},{cents:null},{cents:74},{cents:214},{cents:0}]),null);
  assert.equal(display.checkoutTotalCents([{cents:Number.MAX_SAFE_INTEGER},{cents:1},{cents:0},{cents:214},{cents:0}]),null);
});

test('real DOM review has five cost lines, unknown processing and total, and explicit approval', async () => {
  const app=backend(); const ui=mount(app.api,'test-success',{priceCents:'399'});
  try {
    await ui.start(); await ui.setBudget('11.72');
    const text=ui.container.textContent;
    for (const label of ['Product price:','Shipping:','Tax:','FetchIt fee:','Processing fee:']) assert.equal(text.split(label).length-1,1);
    assert.match(text,/FetchIt fee: USD 2\.14/); assert.match(text,/Shipping: Unknown/); assert.match(text,/Tax: Unknown/);
    assert.match(text,/Total: Unknown/); assert.doesNotMatch(text,/Service fee|Zinc fee|Processing fees:/);
    assert.match(text,/Processing fee: Unknown/);
    assert.equal(ui.button('Approve estimate').disabled,false); assert.equal(ui.button('Place Order').disabled,true);
    await ui.click('Place Order'); assert.equal(app.calls.submissions.length,0); assert.equal(app.calls.stripeReads,0);
    await ui.click('Approve estimate'); assert.equal(ui.button('Place Order').disabled,false);
    await ui.setBudget('12.00'); assert.equal(ui.button('Place Order').disabled,true);
  } finally { await ui.close(); }
});

test('server refuses prior consent without explicit processing approval before payment/provider reads', async () => {
  const app=backend(); const input={...context, unitPriceCents:399, displayedPriceCents:1172,
    listingProof:await fixtureProof(context.productUrl,399), productName:'Fixture',productImage:null,retailer:'Fixture',idempotencyKey:'00000000-0000-4000-8000-000000000000'};
  const quote=await app.api.getCheckoutQuote(input);
  await assert.rejects(app.api.placeOrder({...input,approval:{quoteId:quote.id,mode:'estimate',acceptsVariableFees:true,retailerBudgetCents:1172,currency:'USD'}}),e=>e.code==='checkout_approval_required' && !e.outcomeUnknown);
  assert.equal(app.calls.submissions.length,0); assert.equal(app.calls.stripeReads,0); assert.equal(app.calls.inserts.length,0);
});

test('consent digest changes for address/payment, variant, quantity, budget and offer evidence; expiry and zero headroom remain enforced', async () => {
  const now=600000; const quote=await pricing.createCheckoutQuote(context,now);
  const approval={quoteId:quote.id,mode:'estimate',acceptsVariableFees:true,acceptsProcessingFee:true,retailerBudgetCents:1172,currency:'USD'};
  assert.equal(pricing.approvesQuote(approval,quote,now),true);
  for(const change of [{profile:{address:'changed'}},{profile:{payment:'changed'}},{variants:[{label:'Color',value:'Blue'}]},
    {quantity:2},{itemSubtotalCents:400},{retailerBudgetCents:1173},{listingEvidence:{sellerId:'changed',shippingOptions:[]}}]) {
    const next=await pricing.createCheckoutQuote({...context,...change},now);
    assert.equal(pricing.approvesQuote(approval,next,now),false);
  }
  assert.equal(pricing.approvesQuote(approval,quote,quote.expiresAt),false);
  const equal=await pricing.createCheckoutQuote({...context,retailerBudgetCents:399},now);
  const a={...approval,quoteId:equal.id,retailerBudgetCents:399};
  assert.equal(pricing.approvesQuote(a,equal,now),false);
  assert.equal(pricing.approvesQuote({...a,acknowledgesZeroHeadroom:true},equal,now),true);
});

test('failure refresh synchronizes owned row and retains only sanitized cost evidence', async () => {
  const app=backend({existingOrder:true,upstream:async()=>Response.json({id:zincId,status:'order_failed',error_type:'Max Price Exceeded',
    shipping_address:{address_line1:'PRIVATE ADDRESS'},job_result:{price_components:{subtotal:399,shipping:699,tax:74,total:1172,currency:'USD',breakdown_recorded:true},checkout_html:'SECRET'},connect:{simulated:true}})});
  const status=await app.api.getCheckoutOrderStatus(localOrderId);
  assert.equal(status.errorCode,'max_price_exceeded'); assert.equal(status.retailerStatus,'failed');
  assert.equal(app.calls.updates.length,1); assert.equal(app.calls.updates[0].status,'order_failed');
  const evidence=app.calls.updates[0].zinc_cost_evidence;
  assert.equal(evidence.shippingCents,699); assert.equal(evidence.selectedShippingService,null);
  assert.doesNotMatch(JSON.stringify(app.calls.updates),/PRIVATE|SECRET|address_line1|checkout_html/);
  const ui=mountHistory(app.api,[{id:localOrderId,zincOrderId:zincId,status:'pending',orderPrice:3.99,serviceFee:2.14}]);
  try {await ui.start();assert.match(ui.container.textContent,/Order failed/);assert.match(ui.container.textContent,/max price exceeded/);assert.doesNotMatch(ui.container.textContent,/Service fee:/);} finally {await ui.close();}
});

test('status lookup enforces ownership; persistence failure still returns live failure',async()=>{
  const other=backend({existingOrder:true,owned:false});
  await assert.rejects(other.api.getCheckoutOrderStatus(localOrderId),e=>e.code==='order_not_found');assert.equal(other.calls.statuses,0);
  const app=backend({existingOrder:true,syncFails:true,upstream:async()=>Response.json({id:zincId,status:'order_failed',job_result:{error_details:{code:'max_price_exceeded'}}})});
  assert.equal((await app.api.getCheckoutOrderStatus(localOrderId)).errorCode,'max_price_exceeded');
});

test('unchanged checkout request maps full saved address, selected variant, quantity, exact budget and server fee', () => {
  const ts=require('typescript'); const fs=require('node:fs'); const vm=require('node:vm');
  const file=ts.createSourceFile('handler.ts',fs.readFileSync('supabase/functions/place-order/index.ts','utf8'),ts.ScriptTarget.Latest,true);
  let declaration;
  const visit=node=>{if(ts.isVariableDeclaration(node)&&node.name.getText(file)==='zincRequest')declaration=node;ts.forEachChild(node,visit);};visit(file);
  assert.ok(declaration);
  const vars={ result:null, orderBody:{productUrl:'https://www.amazon.com/dp/B0C32J6L9F',quantity:2,variants:[{label:'Color',value:'Blue'}],idempotencyKey:'fixture'},
    listing:{amazon:{asin:'B0C32J6L9F',sellerId:'SELLER',sellerName:'Fixture seller'}},
    quote:{itemSubtotalCents:798,fetchitMarginCents:128,serviceFeeCents:228,zincFeeCents:100,retailerBudgetCents:1500,revision:'usd-disclosed-processing-v7'},
    name:{firstName:'Fixture',lastName:'User'},profile:{address_line2:'Unit fixture',state:'CA'},addressLine1:'Street fixture',
    city:'City fixture',postalCode:'12345-6789',phone:'5555555555',country:'US',paymentMethod:'pm_fixture',customer:'cus_fixture'};
  vm.runInNewContext(ts.transpileModule(`result = ${declaration.initializer.getText(file)}`,{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,vars);
  const request=JSON.parse(JSON.stringify(vars.result));
  assert.deepEqual(request.shipping_address,{first_name:'Fixture',last_name:'User',address_line1:'Street fixture',address_line2:'Unit fixture',city:'City fixture',state:'CA',postal_code:'12345-6789',phone_number:'5555555555',country:'US'});
  assert.deepEqual(request.products,[{url:vars.orderBody.productUrl,quantity:2,condition_in:['New'],variant:vars.orderBody.variants}]);
  assert.equal(request.max_price,1500);assert.equal(request.payment.margin.value,128);
  assert.equal(request.idempotency_key,'fixture');
  assert.deepEqual(Object.keys(request.payment).sort(),['customer','margin','mode','payment_method']);
  assert.equal(request.transfer,undefined); assert.equal(request.transfer_data,undefined);
  assert.equal(request.payment.margin.value + vars.quote.zincFeeCents,vars.quote.serviceFeeCents);
});
