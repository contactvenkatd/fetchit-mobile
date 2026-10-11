const test=require('node:test'), assert=require('node:assert/strict');
const modulePromise=import('../supabase/functions/_shared/settlement-diagnostics.mjs');
const account={id:'acct_1Th9uUQg8UTscDty',type:'standard',controller:{type:'account',fees:{payer:'account'},stripe_dashboard:{type:'full'}},charges_enabled:true,payouts_enabled:true,capabilities:{card_payments:'active'}};
const payment={livemode:true,status:'succeeded',amount:1386,amount_received:1386,application:'ca_private',application_fee_amount:1272,client_secret:'PRIVATE',latest_charge:{balance_transaction:{id:'txn_fixture',fee:1342,net:44,fee_details:[{type:'stripe_fee',amount:70,description:'PRIVATE'},{type:'application_fee',amount:1272}]}}};
function stripe(a=account){return {accounts:{retrieve:async()=>a},paymentIntents:{list:async()=>({data:[payment]}),retrieve:async()=>payment}};}
test('MOCK diagnostic uses only fixed GETs and strips credential/address/client-secret fields',async()=>{
 const {settlementDiagnostics}=await modulePromise;const calls=[];
 const report=await settlementDiagnostics(stripe(),'zn_live_fixture',async(url,options)=>{
  calls.push(url);assert.equal(options.method,'GET');assert.equal(options.redirect,'error');
  assert.match(url,/^https:\/\/api.zinc.com\/(wallet\/me|orders(?:\?limit=20|\/[a-f0-9-]{36}))$/);
  if(url.endsWith('/wallet/me'))return Response.json({user_id:1035,order_fee_cents:100});
  if(url.endsWith('limit=20'))return Response.json({orders:[]});
  return Response.json({status:'order_placed',shipping_address:'PRIVATE',connect:{state:'captured',connected_account_id:account.id,payment_intent_id:'pi_fixture',final_charge:1386},job_result:{price_components:{subtotal:399,shipping:699,tax:74,total:1172}}});
 });
 assert.equal(calls.length,3);assert.equal(report.feePayer,'account');assert.equal(report.zincOrders[0].stripePayment.balanceNetCents,44);
 assert.equal(report.financialOperations,0);assert.equal(report.integratedSettlementVerified,false);
 assert.doesNotMatch(JSON.stringify(report),/PRIVATE|zn_live_fixture|pi_fixture|ca_private/);
});
test('MOCK unexpected Stripe account prevents Zinc reads',async()=>{
 const {settlementDiagnostics}=await modulePromise;
 const r=await settlementDiagnostics(stripe({...account,id:'acct_other'}),'zn_live_fixture',()=>{throw Error('must not read');});
 assert.equal(r.error,'payment_account_mismatch');
});
test('MOCK wrong Zinc identity and missing key remain explicit without settlement claims',async()=>{
 const {settlementDiagnostics}=await modulePromise;
 const absent=await settlementDiagnostics(stripe(),null,()=>{throw Error('must not read');});assert.equal(absent.zincRead,'live_credential_unavailable');
 const wrong=await settlementDiagnostics(stripe(),'zn_live_fixture',async()=>Response.json({user_id:999}));assert.equal(wrong.zincRead,'account_mismatch');
});
test('MOCK network/provider errors are sanitized and unknown captures stay unknown',async()=>{
 const {settlementDiagnostics}=await modulePromise;const s=stripe();s.paymentIntents.list=async()=>{throw Error('PRIVATE')};
 const r=await settlementDiagnostics(s,'zn_live_fixture',async()=>Response.json({message:'PRIVATE'},{status:401}));
 assert.equal(r.zincRead,'identity_http_401');assert.equal(r.stripeExistingPaymentsRead,'unavailable');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);
});
