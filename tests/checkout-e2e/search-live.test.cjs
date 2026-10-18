const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {mountChat}=require('./search-ui.cjs');
// Opt in explicitly. The external bridge must use existing auth and permit only
// search/intent/usage calls. No provider order API is invoked by this test.
test('REAL deployed shopping message → Grok intent → Zinc results → client parsing → rendered chat cards',
 {skip:!process.env.FETCHIT_SEARCH_LIVE_BRIDGE},async()=>{
 const {spawn}=require('node:child_process'),readline=require('node:readline');
 const child=spawn('python3',['-u',process.env.FETCHIT_SEARCH_LIVE_BRIDGE],{stdio:['pipe','pipe','pipe']});
 let pending;const lines=readline.createInterface({input:child.stdout});lines.on('line',line=>{if(pending){const done=pending;pending=null;done(JSON.parse(line));}});
 const observed={};const invoke=async(name,{body})=>{
  const response=await new Promise((resolve,reject)=>{
   const timer=setTimeout(()=>reject(Error('Live search exceeded 60 seconds')),60000);
   pending=x=>{clearTimeout(timer);resolve(x)};child.stdin.write(JSON.stringify({name,body})+'\n');
  });
  assert.equal(response.error,null);observed[name]=response.data;return response;
 };
 const ui=await mountChat(invoke);
 try{
  await ui.search();const data=observed['search-products'];assert.ok(data?.results.length>0,'Actual Zinc results are required');
  assert.equal(observed['parse-shopping-intent'].type,'shopping_intent');
  const buttons=[...ui.container.querySelectorAll('button')];
  for(const row of data.results){
   assert.match(row.url,/^https:\/\/www.amazon.com\/dp\/[A-Z0-9]{10}$/);
   const card=buttons.find(x=>x.getAttribute('aria-label')===`${row.title}, ${row.retailer}`);
   assert.ok(card,`Missing actual result card ${row.productId}`);
   assert.equal(card.disabled,Boolean(row.checkoutUnavailableReason));
  }
  assert.ok(data.results.some(x=>x.listingProof&&x.currency==='USD'),'At least one real verified offer must render');
  const evidence={observedAt:new Date().toISOString(),query:'Best wireless headphones under $100',
   scope:'Authenticated deployed Grok and Zinc search; real client services/chat screen; native layout/auth UI/persistence mocked; no orders',
   results:data.results.map(x=>({asin:x.productId,title:x.title,url:x.url,priceCents:x.price,currency:x.currency,proofPresent:Boolean(x.listingProof),checkoutUnavailableReason:x.checkoutUnavailableReason??null})),
   renderedCardCount:data.results.length,financialOperations:0,nativePhoneVerified:false};
  if(process.env.FETCHIT_SEARCH_LIVE_EVIDENCE)fs.writeFileSync(process.env.FETCHIT_SEARCH_LIVE_EVIDENCE,JSON.stringify(evidence,null,2)+'\n');
  console.log(JSON.stringify({realZincCards:data.results.length,verifiedUsdOffers:data.results.filter(x=>x.listingProof&&x.currency==='USD').length}));
 }finally{await ui.close();lines.close();child.kill();}
 });
