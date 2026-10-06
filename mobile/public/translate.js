// Public translation requests use the reader's own free-service quota.
async function translateInBrowser(text,source,target){
  if(!text||source===target)return text;
  const encoder=new TextEncoder(),parts=[];let part='',bytes=0;
  for(const char of text){const size=encoder.encode(char).length;if(bytes+size>480){let boundary=0;for(const match of part.matchAll(/[\s。！？.!?]/g))boundary=match.index+match[0].length;if(boundary<part.length/2)boundary=part.length;parts.push(part.slice(0,boundary));part=part.slice(boundary);bytes=encoder.encode(part).length;}part+=char;bytes+=size;}
  if(part)parts.push(part);if(parts.length>30)throw Error('この項目は長すぎるため翻訳できません。');
  const output=[];
  for(const q of parts){
    let res;try{res=await fetch('https://api.mymemory.translated.net/get?'+new URLSearchParams({q,langpair:source+'|'+target}),{credentials:'omit',referrerPolicy:'no-referrer',signal:AbortSignal.timeout(20000)});}catch{throw Error('翻訳サービスに接続できませんでした。Google翻訳でも開けます。');}
    if(res.status===429)throw Error('翻訳サービスの利用上限に達しました。Google翻訳でも開けます。');
    if(!res.ok)throw Error('翻訳サービスに接続できませんでした。Google翻訳でも開けます。');
    const data=await res.json();if(data.quotaFinished||[403,429].includes(Number(data.responseStatus)))throw Error('翻訳サービスの利用上限に達しました。Google翻訳でも開けます。');
    if(Number(data.responseStatus)!==200||typeof data.responseData?.translatedText!=='string'||!data.responseData.translatedText.trim())throw Error('この言語への翻訳を取得できませんでした。Google翻訳でも開けます。');
    const textarea=document.createElement('textarea');textarea.innerHTML=data.responseData.translatedText;output.push(textarea.value);
  }
  return output.join('');
}
