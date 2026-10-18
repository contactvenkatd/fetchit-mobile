// Real chat screen and service/parser; only native layout, auth and persistence are adapters.
const { load } = require('./harness.cjs');
async function mountChat(invoke) {
 const { JSDOM } = require('jsdom'); const dom = new JSDOM('<div id="root"></div>');
 global.window=dom.window;global.document=dom.window.document;global.IS_REACT_ACT_ENVIRONMENT=true;
 const React=require('react'),{createRoot}=require('react-dom/client'),h=React.createElement;
 const wrapper=tag=>({children})=>h(tag,null,children);
 const native={View:wrapper('div'),Text:wrapper('span'),KeyboardAvoidingView:wrapper('div'),
  Pressable:({children,onPress,disabled,accessibilityLabel})=>h('button',{onClick:onPress,disabled,'aria-label':accessibilityLabel},children),
  TextInput:()=>h('input'),FlatList:({data,renderItem,ListFooterComponent})=>h('div',null,data.map(item=>h(React.Fragment,{key:item.id},renderItem({item}))),ListFooterComponent),
  Platform:{OS:'web'},StyleSheet:{create:x=>x},PanResponder:{create:()=>({panHandlers:{}})},
  Animated:{Value:class{interpolate(){return 1}},View:wrapper('div'),loop:()=>({start(){},stop(){}}),sequence(){},delay(){},timing(){}}};
 const common={react:React,'react/jsx-runtime':require('react/jsx-runtime'),'react-native':native};
 let pendingCalls=0;const supabase={functions:{invoke:async(...args)=>{pendingCalls++;try{return await invoke(...args)}finally{pendingCalls--}}}};const imports={'@/lib/supabase':{supabase}};
 const quota=load('src/services/quotaService.ts',imports);
 const services={...imports,'@/services/quotaService':quota};
 const zinc=load('src/services/zincService.ts',services),grok=load('src/services/grokService.ts',services);
 const screen=load('src/app/(app)/chat.tsx',{...common,'expo-router':{useRouter:()=>({push(){}})},'expo-image':{Image:({source})=>h('img',{src:source})},
  'react-native-safe-area-context':{SafeAreaView:wrapper('main')},'@/components/ChatHistoryDrawer':{ChatHistoryDrawer:()=>null},'@/components/ui/Logo':{Logo:()=>null},
  '@/lib/auth':{useAuth:()=>({session:{user:{id:'fixture'}}}),greetingName:()=> 'Friend'},
  '@/lib/chats':{createChat:async()=>({id:'fixture'}),updateChatMessages:async()=>{}},'@/services/grokService':grok,'@/services/zincService':zinc,
  '@/services/quotaService':quota,'@/theme/colors':load('src/theme/colors.ts'),'@/services/checkoutPricing':load('src/services/checkoutPricing.ts')},
  {requestAnimationFrame:fn=>fn(),console:{error(){}}}).default;
 const container=document.getElementById('root'),root=createRoot(container);
 await React.act(async()=>root.render(h(screen)));
 return {container,async search(label='Best wireless headphones under $100'){
  const button=[...container.querySelectorAll('button')].find(x=>x.textContent===label);
  await React.act(async()=>{button.click();const deadline=Date.now()+65000;do{await new Promise(r=>setTimeout(r,20));}while(pendingCalls&&Date.now()<deadline);});
 },async close(){await React.act(async()=>root.unmount());dom.window.close();}};
}
module.exports={mountChat};
