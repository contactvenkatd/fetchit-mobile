// Real Zinc sandbox requests with the current server split. No Stripe/live payment writes.
const assert = require('node:assert/strict'), crypto = require('node:crypto'), fs = require('node:fs');
const { sandboxKey, sandboxFetch } = require('./providers.cjs');
const { load } = require('./harness.cjs');
const pricing = load('supabase/functions/_shared/checkout-pricing.ts');
(async () => {
  const request=sandboxFetch(await sandboxKey()), observations=[];
  for (const [subtotal,budget] of [[399,1172],[1000,1000],[1000,1200],[10000,10000]]) {
    const quote=await pricing.createCheckoutQuote({userId:'sandbox',productUrl:'https://zinc.com/shop/products/test-success',quantity:1,itemSubtotalCents:subtotal,retailerBudgetCents:budget,currency:'USD',profile:{fixture:'saved-address'}});
    assert.equal(quote.serviceFeeCents,quote.fetchitMarginCents+100);
    const response=await request('https://api.zinc.com/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({
      products:[{url:'https://zinc.com/shop/products/test-success',quantity:1}],max_price:budget,idempotency_key:crypto.randomUUID(),
      shipping_address:{first_name:'Sandbox',last_name:'Agent',address_line1:'101 Market St',address_line2:'Unit 4',city:'San Francisco',state:'CA',postal_code:'94105',country:'US',phone_number:'4155552671'},
      payment:{mode:'connect',customer:'cus_fixture',payment_method:'pm_fixture',margin:{type:'flat',value:quote.fetchitMarginCents}}
    })});
    assert.equal(response.status,201);const order=await response.json();assert.equal(order.connect?.simulated,true);
    observations.push({orderId:order.id,calculationSubtotalCents:subtotal,retailerBudgetCents:budget,
      marginCents:quote.fetchitMarginCents,combinedDisplayedFeeCents:quote.serviceFeeCents,
      targetAuthorizationCents:budget+quote.serviceFeeCents,securedCents:order.connect.secured_amount,
      authorizationDifferenceCents:order.connect.secured_amount-budget-quote.serviceFeeCents,
      automaticZincFeeCents:order.connect.zinc_fee,simulated:true});
  }
  for(let attempt=0;attempt<3;attempt++) {
    await new Promise(resolve=>setTimeout(resolve,2000));
    for(const o of observations) {
      const response=await request('https://api.zinc.com/orders/'+o.orderId);assert.equal(response.ok,true);
      const order=await response.json();assert.equal(order.connect?.simulated,true);
      Object.assign(o,{status:order.status,connectState:order.connect.state,
        actualSandboxRetailerTotalCents:order.job_result?.price_components?.total??null,
        actualSandboxSubtotalCents:order.job_result?.price_components?.subtotal??null,
        finalChargeCents:order.connect.final_charge??null,stripeFeeCents:order.connect.stripe_fee??null,
        transferCents:order.connect.transfer_amount??null});
    }
  }
  const result={observedAt:new Date().toISOString(),scope:'current server split, real Zinc isolated sandbox simulation; direct diagnostic, not a completed app checkout',
    pricingRevision:pricing.ESTIMATE_REVISION,productionFeeFormulaAssumed:false,
    subtotalScope:'calculation inputs vary; test-success retailer prices are not independently controllable',
    captureAndSettlementVerified:observations.every(o=>o.finalChargeCents!==null&&o.transferCents!==null),
    customerAuthorizationMatches:observations.every(o=>o.authorizationDifferenceCents===0),observations};
  fs.writeFileSync('docs/zinc-platform-split-sandbox-evidence.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.log(JSON.stringify({outcome:'failed',code:error.code||error.cause?.code||error.name}));process.exitCode=1;});
