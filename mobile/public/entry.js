let entryId=crypto.randomUUID(),entryFile=null,fileRevision=0,entrySaving=false,entryReading=false,entryAbort;
const inputFields=['title','minutes','servings','ingredients','steps','description','author'];
function openEntry(){$('entry-error').textContent='';$('entry-dialog').showModal();$('entry-title').focus();}
$('open-entry').onclick=openEntry;
function applyDraft(draft){for(const field of inputFields){if(draft[field]!==undefined)$('entry-'+field).value=Array.isArray(draft[field])?draft[field].join('\n'):draft[field];}}
$('apply-extracted').onclick=async()=>{const {parseDraft}=await import('/file-import.mjs');applyDraft(parseDraft($('extracted-text').value));$('file-status').textContent='入力欄に反映しました。材料・作り方・分量を確認してから保存してください。';};
$('entry-file').onchange=async()=>{
  entryAbort?.abort();entryAbort=new AbortController();const signal=entryAbort.signal;entryReading=false;$('entry-save').disabled=false;const seq=++fileRevision;const snapshot=Object.fromEntries(inputFields.map(field=>[field,$('entry-'+field).value]));entryFile=$('entry-file').files[0]||null;$('entry-remove-file').hidden=!entryFile;$('extracted-panel').hidden=true;$('entry-error').textContent='';if(!entryFile)return;
  const ext=entryFile.name.toLowerCase().split('.').pop();if(!['pdf','docx','txt'].includes(ext)||!entryFile.size||entryFile.size>10*1024*1024){entryFile=null;$('entry-file').value='';$('entry-remove-file').hidden=true;$('file-status').textContent='PDF・Word（.docx）・テキスト（.txt）、10MB以内のファイルを選んでください。';return;}
  entryReading=true;$('entry-retry').hidden=true;$('file-status').textContent='ファイルを読み取り中…';$('entry-save').disabled=true;
  try{const {extractFile,parseDraft,applyAutoDraft}=await import('/file-import.mjs');let text=await extractFile(entryFile,message=>{if(seq===fileRevision)$('file-status').textContent=message;},{signal});if(seq!==fileRevision)return;let parsed=parseDraft(text),ocrWarning='';if(ext==='pdf'&&(!parsed.ingredients.length||!parsed.steps.length)){
$('file-status').textContent='レシピの項目を確認できないため、画像としてもう一度読み取っています…';try{const ocrText=await extractFile(entryFile,message=>{if(seq===fileRevision)$('file-status').textContent=message;},{signal,forceOcr:true});if(seq!==fileRevision)return;const ocrDraft=parseDraft(ocrText);if(ocrDraft.ingredients.length+ocrDraft.steps.length>parsed.ingredients.length+parsed.steps.length){text=ocrText;parsed=ocrDraft;}}catch(err){if(signal.aborted)throw err;ocrWarning='追加の画像読み取りは完了できませんでしたが、PDFから読み取れた項目は反映しました。'+err.message;}}
$('extracted-text').value=text;$('extracted-panel').hidden=false;$('extracted-panel').open=true;const kept=applyAutoDraft(parsed,snapshot,Object.fromEntries(inputFields.map(field=>[field,$('entry-'+field)])));$('entry-retry').hidden=Boolean(parsed.ingredients.length&&parsed.steps.length);
$('file-status').textContent='読み取り結果を入力欄へ自動反映しました。'+(kept?'読み取り中に修正した欄はそのまま残しています。':'')+'分量・材料・手順を確認してから保存してください。'+ocrWarning;}
  catch(err){if(seq===fileRevision){$('file-status').textContent='自動読み取りに失敗しました。'+err.message;$('entry-retry').hidden=false;}}
  finally{if(seq===fileRevision){entryReading=false;$('entry-save').disabled=false;}}
};
$('entry-remove-file').onclick=()=>{entryAbort?.abort();entryReading=false;fileRevision++;entryFile=null;$('entry-file').value='';$('entry-remove-file').hidden=true;$('file-status').textContent='ファイルを外しました。入力した内容は残っています。';$('extracted-panel').hidden=true;$('entry-save').disabled=false;};
document.querySelector('[data-close="entry-dialog"]').onclick=()=>$('entry-dialog').close();
$('entry-form').onsubmit=async e=>{
  e.preventDefault();if(entrySaving||entryReading)return;entrySaving=true;$('entry-save').disabled=true;$('entry-file').disabled=true;$('entry-remove-file').disabled=true;$('entry-save').textContent='保存中…';$('entry-error').textContent='';
  const recipe={id:entryId};for(const field of inputFields)recipe[field]=$('entry-'+field).value.trim();recipe.minutes=recipe.minutes?Number(recipe.minutes):null;for(const field of ['ingredients','steps'])recipe[field]=recipe[field].split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  try{let response;if(entryFile){const body=new FormData();body.append('recipe',JSON.stringify(recipe));body.append('file',entryFile);response=await fetch('/api/entries',{method:'POST',body});}else response=await fetch('/api/entries',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(recipe)});
    const data=await response.json();if(!response.ok)throw Error(data.error||'保存できませんでした。');
    $('entry-dialog').close();$('entry-form').reset();entryId=crypto.randomUUID();entryFile=null;fileRevision++;$('entry-remove-file').hidden=true;$('extracted-panel').hidden=true;$('file-status').textContent='';$('query').value='';$('site').value='';$('minutes').value='0';setMode('local');
    notice(`「${data.recipe.title}」を保存しました。`);try{await load();}catch{notice('保存しました。一覧の更新に失敗したので、画面を読み直してください。');}
  }catch(err){$('entry-error').textContent=err.message;}
  finally{entrySaving=false;$('entry-save').disabled=false;$('entry-file').disabled=false;$('entry-remove-file').disabled=false;$('entry-save').textContent='確認して保存';}
};

$('entry-retry').onclick=()=>{if(!entrySaving&&!entryReading&&entryFile)$('entry-file').onchange();};
