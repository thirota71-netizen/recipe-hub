const $ = id => document.getElementById(id);
let config, recipes = [], mode = 'local', searching = false, revision = 0;
function el(tag, text, cls) {const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;}
function notice(text) {$('notice').textContent=text;$('notice').classList.toggle('visible',Boolean(text));}
async function api(path, data) {const res=await fetch(path,data===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});const json=await res.json();if(!res.ok)throw new Error(json.error||'読み込みに失敗しました。');return json;}
function image(url, title) {const n=el('img');n.src=url;n.alt=title;n.loading='lazy';n.referrerPolicy='no-referrer';n.addEventListener('error',()=>n.remove(),{once:true});return n;}
const translationCache=new Map();
let detailRevision=0;
function showDetail(r) {
  const seq=++detailRevision,area=$('detail');area.replaceChildren();$('detail-site').textContent=r.site;
  const controls=el('section',undefined,'translation-controls');
  const sourceLabel=el('label','翻訳元'),source=el('select');source.setAttribute('aria-label','翻訳元の言語');
  const targetLabel=el('label','翻訳先'),target=el('select');target.setAttribute('aria-label','翻訳先の言語');
  for(const [code,name] of Object.entries(config.languages)){for(const select of [source,target]){const option=el('option',name);option.value=code;select.append(option);}}
  source.value=r.site==='Just One Cookbook'?'en':'ja';target.value='ja';try{target.value=localStorage.getItem('translation-language')||'ja';}catch{}
  const translate=el('button','翻訳する','primary'),original=el('button','原文に戻す');translate.type=original.type='button';
  sourceLabel.append(source);targetLabel.append(target);controls.append(sourceLabel,targetLabel,translate,original);
  const status=el('p','', 'translation-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
  area.append(controls,el('p','アプリ内翻訳ではレシピ本文をMyMemoryへ送信します。「Google翻訳で開く」はGoogleへ送信し別画面で表示します。機械翻訳のため、分量・温度・加熱時間は原文も確認してください。','small'),status);
  const alternatives=el('div',undefined,'translation-alternatives');area.append(alternatives);
  function googleLinks(){alternatives.replaceChildren();const text=[r.title,r.description,r.servings,'材料 / Ingredients',...r.ingredients,'手順 / Directions',...r.steps.map((text,i)=>`${i+1}. ${text}`)].filter(Boolean).join('\n');const chars=Array.from(text),parts=[];for(let i=0;i<chars.length;i+=2500)parts.push(chars.slice(i,i+2500).join(''));for(let i=0;i<parts.length;i++){const a=el('a',parts.length===1?'Google翻訳で開く':`Google翻訳で開く（${i+1} / ${parts.length}）`);a.href='https://translate.google.com/?'+new URLSearchParams({sl:source.value,tl:target.value,text:parts[i],op:'translate'});a.target='_blank';a.rel='noopener noreferrer';alternatives.append(a);}}
  source.onchange=target.onchange=googleLinks;googleLinks();
  const content=el('div');area.append(content);
  function draw(view,language){content.replaceChildren();content.lang=language;if(r.image)content.append(image(r.image,r.title));content.append(el('h2',view.title));const meta=el('div',undefined,'meta');meta.append(el('span',r.minutes===null?'調理時間：記載なし':`調理時間：${r.minutes}分`),el('span',view.servings||'分量：記載なし'));content.append(meta);if(r.author)content.append(el('p',`作者：${r.author}`,'small'));if(view.description)content.append(el('p',view.description));content.append(el('h3','材料'));const list=el('ul');for(const ingredient of view.ingredients)list.append(el('li',ingredient));content.append(view.ingredients.length?list:el('p','材料の記載を取得できませんでした。'));content.append(el('h3','作り方'));const steps=el('ol');for(const step of view.steps)steps.append(el('li',step));content.append(view.steps.length?steps:el('p','手順の記載を取得できませんでした。元のレシピをご確認ください。'));if(r.sourceFile){const a=el('a',`添付ファイルをダウンロード（${r.sourceFile.name}）`);a.href='/api/files/'+encodeURIComponent(r.id);content.append(a);}else if(!r.sourceType){const a=el('a','元のレシピを見る');a.href=r.url;a.target='_blank';a.rel='noopener noreferrer';content.append(a);}}
  let operation=0;
  original.onclick=()=>{operation++;translate.disabled=false;source.disabled=target.disabled=false;status.textContent='原文を表示しています。';draw(r,source.value);};
  translate.onclick=async()=>{
    const op=++operation,from=source.value,to=target.value;
    if(from===to){draw(r,from);status.textContent='翻訳元と翻訳先が同じです。原文を表示しています。';return;}
    translate.disabled=true;source.disabled=target.disabled=true;
    try{try{localStorage.setItem('translation-language',to);}catch{}
      const view={...r,ingredients:[...r.ingredients],steps:[...r.steps]};
      const fields=['title','description','servings'].filter(field=>r[field]).map(field=>({field,text:r[field]}));
      for(const field of ['ingredients','steps'])r[field].forEach((text,index)=>fields.push({field,index,text}));
      for(let i=0;i<fields.length;i++){
        if(seq!==detailRevision||op!==operation||!$('detail-dialog').open)return;
        status.textContent=`翻訳中… ${i+1} / ${fields.length}`;
        const item=fields[i],key=JSON.stringify([r.id,item.text,from,to]);let text=translationCache.get(key);
        if(text===undefined){text=await translateInBrowser(item.text,from,to);translationCache.set(key,text);}
        if(item.index===undefined)view[item.field]=text;else view[item.field][item.index]=text;
      }
      if(seq!==detailRevision||op!==operation||!$('detail-dialog').open)return;
      draw(view,to);status.textContent=`${config.languages[to]}への翻訳を表示しています。`;
    }catch(err){if(seq===detailRevision&&op===operation){draw(r,from);status.textContent=err.message+' 原文を表示しています。';}}
    finally{if(seq===detailRevision&&op===operation){translate.disabled=false;source.disabled=target.disabled=false;}}
  };
  draw(r,source.value);$('detail-dialog').showModal();
}
function render() {$('results').replaceChildren();$('count').textContent=recipes.length;$('empty').hidden=recipes.length>0;const hasFilter=$('query').value||$('site').value||$('minutes').value!=='0';$('empty').querySelector('h2').textContent=hasFilter?'該当するレシピがありません':'最初のレシピを追加しましょう';for(const r of recipes){const card=el('article',undefined,'card');if(r.image)card.append(image(r.image,r.title));const body=el('div',undefined,'body');body.append(el('span',r.site,'pill'),el('h3',r.title));const meta=el('div',undefined,'meta');meta.append(el('span',r.minutes===null?'時間：記載なし':`${r.minutes}分`),el('span',r.servings||'分量：記載なし'));body.append(meta,el('p',r.ingredients.slice(0,4).join(' / ')||'材料は元ページをご確認ください','ingredients-preview'));const button=el('button','材料・作り方を見る');button.addEventListener('click',()=>showDetail(r));body.append(button);card.append(body);$('results').append(card);}}
async function load() {const seq=++revision;const p=new URLSearchParams({q:$('query').value,site:$('site').value,minutes:$('minutes').value,sort:$('sort').value});const data=await api('/api/recipes?'+p);if(seq!==revision)return;recipes=data.recipes;render();}
function setMode(next) {mode=next;for(const key of ['local','web']){$(key).classList.toggle('active',key===next);$(key).setAttribute('aria-pressed',String(key===next));}notice(next==='web'?(config?.webSearch?'検索すると対応サイトからレシピを取り込みます。取得できないページは結果に含まれません。':'Web横断検索は未設定です。READMEの案内に従い検索APIキーを設定してください。URLからの追加は利用できます。'):'');}
$('local').onclick=()=>setMode('local');$('web').onclick=()=>setMode('web');
$('search-form').onsubmit=async e=>{e.preventDefault();if(searching)return;searching=true;const button=e.currentTarget.querySelector('button');button.disabled=true;notice(mode==='web'?'サイトを検索して、レシピを読み込んでいます…':'');try{if(mode==='web'){const result=await api('/api/web-search',{q:$('query').value});notice(`${result.found}件の候補から${result.imported}件を取り込みました。${result.skipped.length?`${result.skipped.length}件は情報を取得できませんでした。`:''}`);}await load();}catch(err){notice(err.message);}finally{searching=false;button.disabled=false;}};
for(const key of ['site','minutes','sort'])$(key).onchange=()=>load().catch(e=>notice(e.message));
function openImport() {$('import-error').textContent='';$('import-dialog').showModal();$('url').focus();}
$('open-import').onclick=openImport;$('empty-import').onclick=openImport;
for(const button of document.querySelectorAll('[data-close]'))button.onclick=()=>$(button.dataset.close).close();
$('import-form').onsubmit=async e=>{e.preventDefault();$('import-submit').disabled=true;$('import-submit').textContent='取り込み中…';$('import-error').textContent='';try{const result=await api('/api/import',{url:$('url').value.trim()});$('import-dialog').close();$('query').value='';$('site').value='';$('minutes').value='0';setMode('local');await load();notice(`「${result.recipe.title}」を追加しました。`);$('url').value='';}catch(err){$('import-error').textContent=err.message;}finally{$('import-submit').disabled=false;$('import-submit').textContent='取り込む';}};
(async()=>{try{config=await api('/api/config');for(const site of [...Object.values(config.sites),...(config.localSources||[])]){const option=el('option',site);option.value=site;$('site').append(option);}await load();}catch(e){notice('接続できません。python app.py で起動してから開いてください。');}})();

(async()=>{try{const status=await api('/api/crawl/status');const last=status.last;$('crawl-status').textContent=last?`自動収集：${new Date(last.finishedAt).toLocaleString('ja-JP')} · 今回${last.imported}件取得 · 合計${status.total}件`:`自動収集対象：${status.sources.join(' / ')} · 初回収集を準備中`;if(last?.status==='no_imports')$('crawl-status').textContent+='（今回取得できたレシピはありません）';}catch{$('crawl-status').textContent='収集状況を取得できませんでした。';}})();
