export function parseDraft(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const draft={title:lines[0]||'',ingredients:[],steps:[],description:[],servings:'',minutes:''};let section='description';
  for(const line of lines.slice(1)){
    if(/^(材料|ingredients)\s*[:：]?(?:[（(].*[）)])?$/i.test(line)){section='ingredients';continue;}
    if(/^(作り方|作りかた|手順|調理手順|instructions|directions|method)\s*[:：]?$/i.test(line)){section='steps';continue;}
    const time=line.match(/^(?:調理時間|時間|total time)\s*[:：]?\s*(\d+)\s*(?:分|min(?:utes)?)$/i);if(time){draft.minutes=time[1];continue;}
    const yieldMatch=line.match(/^(?:分量|servings|yield)\s*[:：]\s*(.+)$/i);if(yieldMatch){draft.servings=yieldMatch[1];continue;}
    draft[section].push(section==='steps'?line.replace(/^\d+[.)．、]\s*/,''):line);
  }
  draft.title=draft.title.slice(0,200);draft.description=draft.description.join('\n');return draft;
}
export async function extractFile(file,onProgress=()=>{}){
  if(!file.size||file.size>10*1024*1024)throw Error('ファイルは空ではない10MB以内のものを選んでください。');
  const ext=file.name.toLowerCase().split('.').pop();let text;
  if(ext==='txt'){const data=await file.arrayBuffer();text=new TextDecoder('utf-8',{fatal:true}).decode(data);}
  else if(ext==='docx'){
    if(!globalThis.mammoth){await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/mammoth.browser.js';script.onload=resolve;script.onerror=()=>reject(Error('Wordの読み取り機能を読み込めませんでした。'));document.head.append(script);});}
    text=(await globalThis.mammoth.extractRawText({arrayBuffer:await file.arrayBuffer()})).value;
  }else if(ext==='pdf'){
    const pdfjs=await import('./pdf.mjs');pdfjs.GlobalWorkerOptions.workerSrc=new URL('./pdf.worker.mjs',import.meta.url).href;
    const task=pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer()),isEvalSupported:false,useWorkerFetch:false});
    task.onPassword=()=>{task.destroy();};
    let pdf;try{pdf=await task.promise;if(pdf.numPages>100)throw Error('PDFは100ページ以内にしてください。');const pages=[];let length=0;
      for(let n=1;n<=pdf.numPages;n++){onProgress(`PDFを読み取り中… ${n} / ${pdf.numPages}ページ`);const page=await pdf.getPage(n),content=await page.getTextContent();let line='',lastY=null;const lines=[];
        for(const item of content.items){if(!('str' in item))continue;const y=item.transform?.[5];if(lastY!==null&&y!==undefined&&Math.abs(y-lastY)>3&&line){lines.push(line);line='';}line+=item.str+(item.hasEOL?'':' ');lastY=y;if(item.hasEOL){lines.push(line);line='';lastY=null;}}
        if(line)lines.push(line);const pageText=lines.join('\n');length+=pageText.length;if(length>100000)throw Error('読み取った文章が長すぎます。レシピ部分だけのファイルにしてください。');pages.push(pageText);page.cleanup();}
      text=pages.join('\n\n');
    }finally{await task.destroy();}
  }else throw Error('PDF・Word（.docx）・テキスト（.txt）に対応しています。');
  if(text.length>100000)throw Error('文章は10万文字以内のファイルにしてください。');
  if(!text.trim())throw Error('文字を読み取れませんでした。画像のPDFは、元ファイルを添付したまま下の欄へ手入力できます。');
  return text;
}
