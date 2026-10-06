export const LANGUAGES={ja:'日本語',en:'English','zh-CN':'中文（简体）','zh-TW':'中文（繁體）',ko:'한국어',fr:'Français',es:'Español',de:'Deutsch',it:'Italiano',pt:'Português'};
const encoder=new TextEncoder(),cache=new Map();
// Preserve every Unicode character and whitespace while obeying the provider's byte limit.
export function splitTranslation(text){
  const parts=[];let part='',bytes=0;
  for(const char of text){const size=encoder.encode(char).length;if(bytes+size>480){let boundary=0;for(const match of part.matchAll(/[\s。！？.!?]/g))boundary=match.index+match[0].length;if(boundary<part.length/2)boundary=part.length;parts.push(part.slice(0,boundary));part=part.slice(boundary);bytes=encoder.encode(part).length;}part+=char;bytes+=size;}
  if(part)parts.push(part);return parts;
}
function decode(text){return text.replace(/&(?:amp|quot|apos|lt|gt|#39|#\d+|#x[\da-f]+);/gi,x=>{const names={'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>','&#39;':"'"};if(names[x])return names[x];const hex=x.startsWith('&#x'),n=parseInt(x.slice(hex?3:2,-1),hex?16:10);return n<=0x10ffff?String.fromCodePoint(n):x;});}
async function translate(text,source,target){
  if(!text||source===target)return text;
  const key=JSON.stringify([source,target,text]);if(cache.has(key))return cache.get(key);
  const parts=splitTranslation(text),translated=[];
  if(parts.length>30)throw Error('この項目は長すぎるため翻訳できません。原文をご確認ください。');
  for(const part of parts){
    const endpoint='https://api.mymemory.translated.net/get?'+new URLSearchParams({q:part,langpair:source+'|'+target});
    let response;try{response=await fetch(endpoint,{signal:AbortSignal.timeout(20000),redirect:'error'});}catch{throw Error('翻訳サービスに接続できませんでした。原文をご確認ください。');}
    if(!response.ok)throw Error(response.status===429?'翻訳サービスの利用上限に達しました。時間をおいてお試しください。':'翻訳サービスに接続できませんでした。');
    const data=await response.json();
    if(data.quotaFinished||Number(data.responseStatus)===403||Number(data.responseStatus)===429)throw Error('翻訳サービスの利用上限に達しました。時間をおいてお試しください。');
    if(Number(data.responseStatus)!==200||typeof data.responseData?.translatedText!=='string'||!data.responseData.translatedText.trim())throw Error('この言語への翻訳を取得できませんでした。原文をご確認ください。');
    translated.push(decode(data.responseData.translatedText));
  }
  const result=translated.join('');if(cache.size>=1000)cache.delete(cache.keys().next().value);cache.set(key,result);return result;
}
export async function translateField(data,db){
  const {id,source,target,field,index}=data;
  if(typeof id!=='string'||!Object.hasOwn(LANGUAGES,source)||!Object.hasOwn(LANGUAGES,target))throw Error('レシピと翻訳元・翻訳先の言語を選んでください。');
  if(!['title','description','servings','ingredients','steps'].includes(field))throw Error('翻訳する項目が正しくありません。');
  const row=await db.prepare('SELECT body FROM recipes WHERE id=?').bind(id).first();if(!row)throw Error('レシピが見つかりません。');
  const recipe=JSON.parse(row.body);let text=recipe[field]||'';
  if(['ingredients','steps'].includes(field)){if(!Number.isInteger(index)||index<0||index>=text.length)throw Error('翻訳する項目が正しくありません。');text=text[index];}
  if(typeof text!=='string')throw Error('翻訳する内容が正しくありません。');
  return{text:await translate(text,source,target),source,target,provider:'MyMemory'};
}
