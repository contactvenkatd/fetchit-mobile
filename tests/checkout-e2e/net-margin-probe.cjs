// Diagnostic hypothesis only: never imported by production checkout.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const { sandboxKey, sandboxFetch } = require('./providers.cjs');
const round = (n,d) => Math.floor((n + d/2)/d);
const gross = s => 200 + round(s*35,1000);
// Hypothesis inferred from prior sandbox holds, NOT a production fee contract.
const authorization = (b,m) => round((b+m+130)*1000,971);
function plan(subtotal,budget) {
  const fee=gross(subtotal), target=budget+fee;
  const margin=round(target*971,1000)-budget-130;
  return {subtotalCents:subtotal,budgetCents:budget,grossFeeCents:fee,targetAuthorizationCents:target,
    candidateMarginCents:margin,predictedAuthorizationCents:authorization(budget,Math.max(0,margin))};
}
(async () => {
  const request=sandboxFetch(await sandboxKey());
  const cases=[[14,200],[15,200],[100,500],[399,1172],[1000,1000],[1000,1200],[10000,10000],
    [399,2698],[399,2699],[399,2700],[399,5000],[1000,1024,69],[1000,1024,68.5]];
  // Find a cent skipped by the hypothesized integer gross-up.
  for(let b=1000;b<1100;b++) { const p=plan(1000,b); if(p.predictedAuthorizationCents!==p.targetAuthorizationCents) {cases.push([1000,b]);break;} }
  const observations=[];
  for(const [subtotal,budget,overrideMargin] of cases) {
    const p=plan(subtotal,budget);
    // Negative margins are prohibited; test zero to establish minimum charge.
    const sentMargin=overrideMargin ?? Math.max(0,p.candidateMarginCents);
    p.predictedAuthorizationCents=authorization(budget,sentMargin);
    const response=await request('https://api.zinc.com/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      products:[{url:'https://zinc.com/shop/products/test-success',quantity:1}],max_price:budget,
      idempotency_key:crypto.randomUUID(),
      shipping_address:{first_name:'Sandbox',last_name:'Agent',address_line1:'101 Market St',city:'San Francisco',state:'CA',postal_code:'94105',country:'US',phone_number:'4155552671'},
      payment:{mode:'connect',customer:'cus_fixture',payment_method:'pm_fixture',margin:{type:'flat',value:sentMargin}}
    })});
    if(response.status!==201) { observations.push({...p,httpStatus:response.status,accepted:false}); continue; }
    const order=await response.json();assert.equal(order.connect?.simulated,true);
    observations.push({...p,orderId:order.id,sentMarginCents:sentMargin,simulated:true,
      securedCents:order.connect.secured_amount,zincFeeCents:order.connect.zinc_fee,
      authorizationMatchesTarget:order.connect.secured_amount===p.targetAuthorizationCents,
      matchesHypothesis:order.connect.secured_amount===p.predictedAuthorizationCents});
  }
  // Poll all accepted cases for capture; no capture/cancel/simulation mutations.
  for(let attempt=0;attempt<3;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,2000));
    for(const o of observations.filter(x=>x.orderId)) {
      const response=await request(`https://api.zinc.com/orders/${o.orderId}`);assert.equal(response.ok,true);
      const order=await response.json();assert.equal(order.connect?.simulated,true);
      Object.assign(o,{status:order.status,connectState:order.connect.state,
        retailerTotalCents:order.job_result?.price_components?.total??null,
        retailerSubtotalCents:order.job_result?.price_components?.subtotal??null,
        finalChargeCents:order.connect.final_charge??null,stripeFeeCents:order.connect.stripe_fee??null,
        transferCents:order.connect.transfer_amount??null});
      // Conditional mathematical comparison, explicitly not observed capture.
      if(Number.isSafeInteger(o.retailerTotalCents)) Object.assign(o,{
        hypotheticalCaptureCents:authorization(o.retailerTotalCents,o.sentMarginCents),
        retailerPlusOriginalGrossCents:o.retailerTotalCents+o.grossFeeCents});
    }
  }
  const evidence={observedAt:new Date().toISOString(),scope:'Real Zinc sandbox simulation; no production or separate Stripe tests',
    hypothesis:'round((retailerBudget + flatMargin + 100 + 30) / 0.971) cents; inferred, not verified production terms',
    subtotalScope:'Subtotal is a checkout calculation input, not a controllable price of the sandbox test product; actual returned subtotal retained separately',
    productionFeeFormulaVerified:false,observations};
  fs.writeFileSync('docs/zinc-net-margin-sandbox-evidence.json',JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify(evidence,null,2));
})().catch(error=>{console.log(JSON.stringify({outcome:'failed',code:error.code||error.cause?.code||error.name}));process.exitCode=1;});
