// Real Zinc sandbox only. UI/service/handler are actual source; auth, DB, native
// primitives and Stripe saved-reference reads are adapters. Never a Stripe charge.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {backend,mount,localOrderId,profile,load} = require('./harness.cjs');
const {sandboxKey,sandboxFetch} = require('./providers.cjs');
const pricing=load('supabase/functions/_shared/checkout-pricing.ts');
// Independently inferred sandbox schedule, not imported into production pricing.
const sandboxAuthorization=(budget,margin)=>Number((BigInt(budget+margin+130)*1000n+485n)/971n);
(async()=>{
 const key=await sandboxKey(), request=sandboxFetch(key), observations=[];
 for(const [subtotal,budget,slug] of [[399,1172,'test-success'],[1000,1000,'test-success'],[1000,1200,'test-success'],[10000,10000,'test-success'],[14,200,'test-success'],[15,200,'test-success'],[399,2699,'test-success'],[399,1172,'test-price-exceeded']]) {
  const app=backend({key,upstream:request});
  const ui=mount(app.api,slug,{priceCents:String(subtotal)});
  try {
   await ui.start(); await ui.setBudget((budget/100).toFixed(2));
   assert.match(ui.container.textContent,/Processing fee: Unknown/);
   assert.match(ui.container.textContent,/Total: Unknown/);
   assert.match(ui.container.textContent,/provider-determined processing costs whose rate and amount are currently unknown/);
   assert.equal(ui.button('Place Order').disabled,true);
   if(budget===subtotal) await ui.click('Acknowledge zero shipping/tax headroom');
   await ui.click('Approve estimate');
   assert.equal(ui.button('Place Order').disabled,false);
   const b=ui.button('Place Order'); await ui.act(async()=>{b.click();b.click();}); await ui.flush();
   assert.equal(app.calls.submissions.length,1);
   const body=app.calls.submissions[0], margin=pricing.calculateServiceMargin(subtotal);
   assert.equal(body.payment.margin.value,margin);assert.equal(body.max_price,budget);
   assert.equal(body.shipping_address.address_line1,profile.address_line1);
   assert.equal(body.shipping_address.address_line2,profile.address_line2);
   assert.equal(body.shipping_address.postal_code,profile.zip);
   const invocation=app.calls.invocations.find(x=>x.approval);
   assert.equal(invocation.approval.acceptsProcessingFee,true);
   const deadline=Date.now()+40000;
   let status;
   do {
    await ui.act(async()=>{await new Promise(r=>setTimeout(r,2500));});
    if(app.calls.inserts.length) try { status=await app.api.getCheckoutOrderStatus(localOrderId); } catch { /* read-only poll can recover; never retry creation */ }
   }while(Date.now()<deadline && status?.retailerStatus!==(slug==='test-success'?'delivered':'failed'));
   assert.ok(status);assert.equal(status.simulated,true);assert.equal(status.payment.status,'simulated');
   assert.equal(status.retailerStatus,slug==='test-success'?'delivered':'failed');
   if(slug==='test-price-exceeded') assert.equal(status.errorCode,'max_price_exceeded');
   const id=app.calls.inserts[0].zinc_order_id;
   const response=await request('https://api.zinc.com/orders/'+id);assert.equal(response.ok,true);
   const raw=await response.json();assert.equal(raw.connect.simulated,true);
   const predicted=sandboxAuthorization(budget,margin);
   assert.equal(raw.connect.secured_amount,predicted);assert.equal(raw.connect.zinc_fee,100);
   const reloaded=app.reloadApi();const recovered=await reloaded.getSavedSubmission();
   assert.equal(recovered.order.zincOrderId,id);
   await assert.rejects(reloaded.placeOrder(invocation));
   assert.equal(app.calls.submissions.length,1);
   const duplicate=await request('https://api.zinc.com/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
   assert.equal(duplicate.status,409);
   const o={subtotalInputCents:subtotal,retailerBudgetCents:budget,marginCents:margin,fetchitFeeCents:margin+100,
    predictedSandboxAuthorizationCents:predicted,securedCents:raw.connect.secured_amount,
    impliedProcessingAllowanceCents:predicted-budget-margin-100,simulated:true,retailerStatus:status.retailerStatus,
    providerState:raw.connect.state,retailerTotalCents:raw.job_result?.price_components?.total??null,
    finalChargeCents:raw.connect.final_charge??null,processingFeeCents:raw.connect.stripe_fee??null,
    transferCents:raw.connect.transfer_amount??null,addressMappingVerified:true,restartVerified:true,duplicateVerified:true};
   observations.push(o);console.log(JSON.stringify(o));
  }finally{await ui.close();}
 }
 const result={observedAt:new Date().toISOString(),pricingRevision:pricing.ESTIMATE_REVISION,
  scope:'real Zinc simulated order lifecycle through actual UI/service/handler; native/auth/DB/Stripe reference reads mocked',
  sandboxFormula:'nearest-cent((retailerBudget + FetchItMargin + Zinc100 + fixed30) / 0.971)',
  productionProcessingRateVerified:false,productionProcessingDisplayed:'Unknown',productionTotalDisplayed:'Unknown',
  authorizationChecksPassed:true,captureAndSettlementVerified:observations.every(o=>o.finalChargeCents!==null && o.transferCents!==null),
  liveFinancialOperations:0,separateStripeOperations:0,observations};
 fs.writeFileSync('docs/shipping-audit-sandbox-evidence.json',JSON.stringify(result,null,2)+'\n');
})().catch(e=>{console.log(JSON.stringify({outcome:'failed',code:e.code||e.name,location:e.stack?.split('\n').find(l=>l.includes('disclosed-processing-sandbox.cjs:'))?.trim()}));process.exitCode=1;});
