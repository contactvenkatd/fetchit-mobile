const assert=require('node:assert/strict'),fs=require('node:fs');
const {backend,mount}=require('./harness.cjs');
const {sandboxKey,sandboxFetch}=require('./providers.cjs');
(async()=>{
 const key=await sandboxKey(),request=sandboxFetch(key),observations=[];
 for(const slug of ['test-invalid-address','test-insufficient-funds']) {
  const app=backend({key,upstream:request}),ui=mount(app.api,slug);
  try{
   await ui.start();await ui.setBudget('12.00');await ui.click('Approve estimate');
   await ui.act(async()=>{const b=ui.button('Place Order');b.click();b.click();});await ui.flush();
   const deadline=Date.now()+15000;
   while(ui.container.textContent.includes('Loading')&&Date.now()<deadline) await ui.act(async()=>{await new Promise(r=>setTimeout(r,200));});
   assert.equal(app.calls.submissions.length,1);assert.equal(app.calls.inserts.length,0);
   assert.match(ui.container.textContent,slug==='test-invalid-address'?/address|shipping/i:/funds/i);
   assert.doesNotMatch(ui.container.textContent,/Order submitted|Actual captured amount/);
   observations.push({scenario:slug,providerRequests:1,acceptedOrders:0,realZincSandbox:true,authDatabaseStripeRefsMocked:true});
  }finally{await ui.close();}
 }
 fs.writeFileSync('docs/shipping-audit-sandbox-rejections.json',JSON.stringify({observedAt:new Date().toISOString(),observations,liveFinancialOperations:0,stripeCardDeclineVerified:false},null,2)+'\n');console.log('Two real Zinc sandbox creation rejections passed; not a Stripe card-decline test.');
})().catch(e=>{console.log(JSON.stringify({code:e.code||e.name,location:e.stack?.split('\n').find(l=>l.includes('sandbox-creation-failures.cjs:'))?.trim()}));process.exitCode=1;});
