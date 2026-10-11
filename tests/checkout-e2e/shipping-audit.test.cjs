const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {load,backend,mount,profile}=require('./harness.cjs');
const pricing=load('supabase/functions/_shared/checkout-pricing.ts');
const signing=load('supabase/functions/_shared/listing-price.ts');
const asin='B0C32J6L9F',url='https://www.amazon.com/dp/'+asin;
const amazon=(shippingOptions)=>({asin,sellerId:'SELLER_FIXTURE',sellerName:'Quoted seller',condition:'New',variants:[],shippingOptions});
async function input(options,price=399,budget=1172) {
 return {productUrl:url,unitPriceCents:price,itemSubtotalCents:price,quantity:1,displayedPriceCents:budget,currency:'USD',
  listingProof:await signing.signListingPrice(url,price,'USD','mock-signing-key',Date.now(),amazon(options)),
  productName:'Fixture',productImage:null,retailer:'amazon',idempotencyKey:crypto.randomUUID()};
}
const approval=q=>({quoteId:q.id,mode:'estimate',acceptsVariableFees:true,acceptsProcessingFee:true,retailerBudgetCents:q.retailerBudgetCents,currency:'USD'});

test('regression: 399 + 699 + 74 = 1172 retailer cents; 399 budget is rejected before provider or card reads',async()=>{
 assert.equal(pricing.knownRetailerCosts(399,699,74),1172);
 assert.ok(pricing.knownRetailerCosts(399,699,74)>399);
 const app=backend(),i=await input([{name:'Standard (3–5 days)',price:699}],399,399);
 const q=await app.api.getCheckoutQuote(i);
 assert.equal(q.shippingCents,699);assert.equal(q.shippingScope,'offer_estimate_not_destination_specific');
 assert.equal(q.taxCents,null);assert.equal(q.knownRetailerCostsCents,1098);assert.equal(q.canSubmit,false);
 await assert.rejects(app.api.placeOrder({...i,approval:{...approval(q),acknowledgesZeroHeadroom:true}}),e=>e.code==='insufficient_retailer_budget'&&!e.outcomeUnknown);
 assert.equal(app.calls.submissions.length,0);assert.equal(app.calls.stripeReads,0);assert.equal(app.calls.inserts.length,0);
});

test('DOM discloses non-destination offer shipping, requires sufficient retailer budget and includes no provider fee in max_price',async()=>{
 const i=await input([{name:'Standard (3–5 days)',price:699}],399,399),app=backend();
 const ui=mount(app.api,'test-success',{productUrl:url,priceCents:'399',listingProof:i.listingProof});
 try {
  await ui.start();await ui.setBudget('3.99');
  assert.match(ui.container.textContent,/Shipping: Estimate USD 6\.99 · quoted offer; destination unconfirmed/);
  assert.match(ui.container.textContent,/not destination-specific/);assert.match(ui.container.textContent,/Total: Unknown/);
  assert.equal(ui.button('Approve estimate').disabled,true);assert.equal(ui.button('Place Order').disabled,true);
  await ui.setBudget('11.72');await ui.click('Approve estimate');await ui.click('Place Order');
  assert.equal(app.calls.submissions.length,1);assert.equal(app.calls.submissions[0].max_price,1172);
  assert.equal(app.calls.submissions[0].payment.margin.value,114);
  assert.equal(app.calls.inserts[0].checkout_evidence.shippingScope,'offer_estimate_not_destination_specific');
 }finally{await ui.close();}
});

for(const [options,quantity,expected] of [[[],1,null],[[{name:'Standard',price:null}],1,null],[[{name:'Standard',price:699},{name:'Other',price:null}],1,null],[[{name:'Free',price:0}],1,0],[[{name:'Standard',price:699},{name:'Fast',price:999}],1,699],[[{name:'Standard',price:699}],2,null]]) {
 test('unknown remains unknown; explicit free stays zero; no assumed quantity scaling: '+JSON.stringify({options,quantity}),()=>{
  assert.equal(pricing.offerShipping(amazon(options),quantity).cents,expected);
 });
}

test('changed signed item price or shipping cannot reuse prior approval; client shipping overrides are ignored',async()=>{
 const app=backend(),i=await input([{name:'Standard',price:699}],399,2000),q=await app.api.getCheckoutQuote(i);
 for(const next of [await input([{name:'Standard',price:799}],399,2000),await input([{name:'Standard',price:699}],400,2000)]) {
  const updated=await app.api.getCheckoutQuote(next);assert.notEqual(q.id,updated.id);
  await assert.rejects(app.api.placeOrder({...next,approval:approval(q)}),e=>e.code==='checkout_approval_required');
 }
 const unchanged=await app.api.getCheckoutQuote({...i,shippingCents:0,taxCents:0});assert.equal(unchanged.shippingCents,699);
 assert.equal(app.calls.submissions.length,0);assert.equal(app.calls.stripeReads,0);
});

test('signed shipping tampering is rejected; malformed provider-signed shipping cannot become free',async()=>{
 const i=await input([{name:'Standard',price:699}]);const proof=JSON.parse(i.listingProof);proof.payload.amazon.shippingOptions[0].price=0;
 assert.equal(await signing.verifyListingPrice(JSON.stringify(proof),url,'mock-signing-key'),null);
 for(const shippingOptions of [[{name:'Standard',price:-1}],[{name:'Standard',price:'699'}],[{name:'\n',price:0}]]) {
  const p=await signing.signListingPrice(url,399,'USD','mock-signing-key',Date.now(),amazon(shippingOptions));
  assert.equal(await signing.verifyListingPrice(p,url,'mock-signing-key'),null);
 }
});

test('offer parser preserves punctuation, missing names and unknown amounts from provider response',async()=>{
 let handler;const q={authenticateRequest:async()=>({id:'fixture'}),checkQuota:async()=>({allowed:true,snapshot:null}),chargeQuota:async()=>{},quotaExceededBody:()=>({}),ZINC_CALL_MICROCENTS:1000000};
 load('supabase/functions/search-products/index.ts',{}, {Response,Request,URL,...q,signListingPrice:signing.signListingPrice,
  Deno:{env:{get:n=>({ZINC_API_KEY:'zn_test_fixture',SUPABASE_SERVICE_ROLE_KEY:'mock-signing-key'})[n]},serve:f=>handler=f},
  fetch:async u=>Response.json(u.pathname==='/products/search'?{status:'completed',results:[{product_id:asin}]}:u.pathname.endsWith('/offers')?
   {status:'completed',retailer:'amazon',asin,offers:[{price:399,currency:'USD',available:true,condition:'New',seller:{id:'SELLER',name:'Seller'},shipping_options:[{name:'Standard (3–5 days)',price:699},{price:999},{name:'Unknown'}]}]}:
   {status:'completed',retailer:'amazon',asin,title:'Fixture',buyapi_hint:true})},true);
 const r=await handler(new Request('https://isolated.invalid/search-products',{method:'POST',body:JSON.stringify({productQuery:'fixture',quantity:1,retailerPreference:'amazon',size:null,color:null,priceCeiling:null})}));
 assert.equal(r.status,200);const result=(await r.json()).results[0];
 assert.deepEqual(JSON.parse(JSON.stringify(result.amazon.shippingOptions)),[{name:'Standard (3–5 days)',price:699},{name:'Unspecified service',price:999},{name:'Unknown',price:null}]);
 const signed=await signing.verifyListingPrice(result.listingProof,url,'mock-signing-key');assert.equal(signed.amazon.shippingOptions[0].price,699);
 assert.equal(pricing.offerShipping(signed.amazon,1).cents,null);
});

test('unknown shipping estimate cannot yield a verified total; finite budget arithmetic rejects overflow',async()=>{
 const display=load('src/services/checkoutPricing.ts');
 const rows=display.checkoutCostLines({itemSubtotalCents:399,shippingCents:699,shippingScope:'offer_estimate_not_destination_specific',taxCents:74,serviceFeeCents:214,paymentFeeCents:72},399);
 assert.equal(display.checkoutTotalCents(rows),null);
 assert.equal(pricing.knownRetailerCosts(Number.MAX_SAFE_INTEGER,1,null),null);
 assert.equal(await pricing.createCheckoutQuote({userId:'fixture',productUrl:url,quantity:1,itemSubtotalCents:399,retailerBudgetCents:Number.MAX_SAFE_INTEGER,currency:'USD',profile:{}}),null);
});
