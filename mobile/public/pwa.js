if('serviceWorker' in navigator){window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));}
const isStandalone=window.matchMedia('(display-mode: standalone)').matches||navigator.standalone;
if(!isStandalone){const note=document.getElementById('install-note');if(note)note.hidden=false;}
if(document.modelContext?.registerTool){Promise.resolve(document.modelContext.registerTool({name:'search_saved_recipes',description:'登録済みレシピを検索し、画面の検索結果を更新する。Web検索や新規登録は行わない。',inputSchema:{type:'object',properties:{query:{type:'string',maxLength:150}},required:['query'],additionalProperties:false},annotations:{readOnlyHint:true,untrustedContentHint:true},async execute(input){if(typeof input?.query!=='string'||input.query.length>150)throw Error('検索語は150文字以内の文字列で指定してください。');document.getElementById('query').value=input.query;setMode('local');await load();return{count:recipes.length,recipes:recipes.map(r=>({title:r.title,url:r.url}))};}})).catch(()=>{});}

// Check for updates when returning to a home-screen app. Never discard a recipe draft.
async function checkAppUpdate(){
  const current=document.querySelector?.('meta[name="app-version"]')?.content;if(!current||document.visibilityState!=='visible')return;
  try{const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)return;const next=await response.json();if(!next.version||next.version===current)return;
    const draft=[...document.querySelectorAll('#entry-form input,#entry-form textarea,#url')].some(input=>input.value);
    if(draft){if(typeof notice==='function')notice('アプリの更新があります。入力したレシピを保存してから画面を読み直してください。');return;}
    location.reload();
  }catch{}
}
document.addEventListener?.('visibilitychange',()=>{if(document.visibilityState==='visible'){navigator.serviceWorker?.getRegistration().then(reg=>reg?.update()).catch(()=>{});checkAppUpdate();}});
if(navigator.serviceWorker)navigator.serviceWorker.addEventListener('message',event=>{if(event.data?.type==='APP_UPDATED')checkAppUpdate();});
