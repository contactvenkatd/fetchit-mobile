const test=require('node:test'),assert=require('node:assert/strict');
const {load,mount,backend}=require('./harness.cjs');const {mountChat}=require('./search-ui.cjs');
const intent={productQuery:'wireless headphones',quantity:1,size:null,color:null,priceCeiling:100,retailerPreference:null};
const row={product_id:'B000000001',title:'Real handler fixture headphones',image:'https://example.invalid/image.jpg'};
function handler(fetcher,decision={allowed:true,snapshot:null}){
 let fn;const charges=[];
 load('supabase/functions/search-products/index.ts',{}, {Response,Request,URL,console:{warn(){},info(){},error(){}},fetch:fetcher,
  signListingPrice:async()=> 'signed-fixture',authenticateRequest:async()=>({id:'fixture'}),checkQuota:async(user,bucket)=>typeof decision==='function'?decision(user,bucket):decision,
  chargeQuota:async(_,__,cost)=>charges.push(cost),ZINC_CALL_MICROCENTS:1000000,
  Deno:{env:{get:n=>({ZINC_API_KEY:'mock',SUPABASE_SERVICE_ROLE_KEY:'mock'})[n]},serve:f=>fn=f}},true);
 return {charges,async call(){return fn(new Request('https://fixture.invalid',{method:'POST',body:JSON.stringify(intent)}));}};
}
const httpInvoke=async(response)=>response.ok?{data:await response.json(),error:null}:{data:null,error:{context:response}};
test('MOCK confirmed production failure: unavailable quota denies Zinc, renders actionable error, never requests AI zero-result prose',async()=>{
 let paid=0;const api=handler(async()=>{paid++;throw Error()}, {allowed:false,reason:'unavailable'});
 const ui=await mountChat(async(name,{body})=>{if(body.searchFailure)throw Error('Must not ask AI to hide a search failure');return name==='parse-shopping-intent'?{data:{type:'shopping_intent',intent}}:httpInvoke(await api.call());});
 try{await ui.search();assert.match(ui.container.textContent,/contact FetchIt support/);assert.equal(paid,0);assert.doesNotMatch(ui.container.textContent,/nothing came up/);}finally{await ui.close();}
});
test('MOCK optional enrichment timeout preserves product card with honest unknown price and blocks checkout',async()=>{
 const api=handler(async url=>{if(url.pathname==='/products/search')return Response.json({status:'completed',results:[row]});throw new DOMException('timeout','TimeoutError');});
 const response=await api.call();const data=await response.json();assert.equal(data.results.length,1);assert.equal(data.results[0].listingProof,null);assert.equal(data.results[0].price,null);
 const ui=await mountChat(async name=>({data:name==='parse-shopping-intent'?{type:'shopping_intent',intent}:data}));
 try{await ui.search();assert.match(ui.container.textContent,/fixture headphones/);assert.match(ui.container.textContent,/Checkout unavailable/);assert.ok([...ui.container.querySelectorAll('button')].find(x=>x.textContent.includes(row.title)).disabled);assert.ok(ui.container.querySelector('img'));}finally{await ui.close();}
 assert.deepEqual(api.charges,[1000000]);
 const app=backend();const checkout=mount(app.api,'test-success',{productUrl:data.results[0].url,listingProof:'',currency:'',priceCents:''});
 try{await checkout.start();assert.ok(!checkout.button('Approve estimate'));assert.equal(app.calls.submissions.length,0);}finally{await checkout.close();}
});
for(const [http,code,text] of [[402,'zinc_credit_required','credits'],[401,'zinc_authentication_failed','support'],[429,'zinc_rate_limited','Wait a minute'],[500,'zinc_upstream_error','try again']]){
 test(`MOCK Zinc HTTP ${http} remains a search error, with actionable chat output`,async()=>{
  const api=handler(async()=>new Response('{}',{status:http}));const r=await api.call();assert.equal((await r.json()).error.code,code);
  const ui=await mountChat(async name=>name==='parse-shopping-intent'?{data:{type:'shopping_intent',intent}}:httpInvoke(await api.call()));
  try{await ui.search();assert.match(ui.container.textContent,new RegExp(text,'i'));assert.doesNotMatch(ui.container.textContent,/nothing came up/);}finally{await ui.close();}
 });
}
test('MOCK missing deployed quota RPC fails closed; restored dollar RPC enables the same shopping search',async()=>{
 let schemaReady=false,paid=0;
 const db={from:()=>({select:()=>({eq:()=>({maybeSingle:async()=>({data:{plan:'Free',verified_at:new Date().toISOString()}})})})}),
  rpc:async(name,args)=>{assert.equal(name,'quota_consume');assert.equal(args.p_cost_cents,'0.000000');
   return schemaReady?{data:[{allowed:true,cents_used:0,period:'2026-10',resets_at:'2026-11-01T00:00:00Z'}]}:{error:{code:'PGRST202'},data:null};}};
 const quota=load('supabase/functions/_shared/usage-quota.ts',{}, {console:{error(){},warn(){}},
  Deno:{env:{get:n=>({SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'mock'})[n]}},createClient:()=>db},true);
 const api=handler(async()=>{paid++;return Response.json({status:'completed',results:[]});},quota.checkQuota);
 assert.equal((await api.call()).status,503);assert.equal(paid,0);
 schemaReady=true;assert.equal((await api.call()).status,200);assert.equal(paid,1);
});

test('MOCK missing shipping enrichment preserves a verified offer and rendered product card',async()=>{
 const api=handler(async url=>Response.json(url.pathname==='/products/search'?{status:'completed',results:[row]}:
  url.pathname.endsWith('/offers')?{status:'completed',retailer:'amazon',asin:row.product_id,offers:[{price:1999,currency:'USD',available:true,condition:'New',seller:{id:'seller',name:'Seller'}}]}:
  {status:'completed',retailer:'amazon',asin:row.product_id,title:row.title,buyapi_hint:true}));
 const response=await api.call(),data=await response.json();assert.equal(data.results[0].listingProof,'signed-fixture');assert.deepEqual(data.results[0].amazon.shippingOptions,[]);
 const ui=await mountChat(async name=>({data:name==='parse-shopping-intent'?{type:'shopping_intent',intent}:data}));
 try{await ui.search();const card=[...ui.container.querySelectorAll('button')].find(x=>x.textContent.includes(row.title));assert.ok(card);assert.equal(card.disabled,false);assert.match(card.textContent,/USD 19.99/);}finally{await ui.close();}
});
