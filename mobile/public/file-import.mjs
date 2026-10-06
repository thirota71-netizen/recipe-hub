import {needsOcr,createOcrReader} from './ocr.mjs';
export {parseDraft,applyAutoDraft} from './recipe-parser.mjs';
export async function extractFile(file,onProgress=()=>{},options={}){
  const {signal}=options;const check=()=>{if(signal?.aborted)throw new DOMException('読み取りを中止しました。','AbortError');};check();
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
    let pdf,ocr;const cancel=()=>task.destroy();signal?.addEventListener('abort',cancel,{once:true});try{pdf=await task.promise;check();if(pdf.numPages>100)throw Error('PDFは100ページ以内にしてください。');const pages=[];let length=0;
      for(let n=1;n<=pdf.numPages;n++){check();onProgress(`PDFを読み取り中… ${n} / ${pdf.numPages}ページ`);const page=await pdf.getPage(n),content=await page.getTextContent();let line='',lastY=null;const lines=[];
        for(const item of content.items){if(!('str' in item))continue;const y=item.transform?.[5];if(lastY!==null&&y!==undefined&&Math.abs(y-lastY)>3&&line){lines.push(line);line='';}line+=item.str+(item.hasEOL?'':' ');lastY=y;if(item.hasEOL){lines.push(line);line='';lastY=null;}}
        if(line)lines.push(line);let pageText=lines.join('\n');const operators=await page.getOperatorList();const imageOps=[pdfjs.OPS.paintImageXObject,pdfjs.OPS.paintInlineImageXObject,pdfjs.OPS.paintImageXObjectRepeat,pdfjs.OPS.paintImageMaskXObject];const hasImage=operators.fnArray.some(op=>imageOps.includes(op));if(options.forceOcr||needsOcr(pageText,hasImage)){ocr??=await createOcrReader(onProgress,signal);pageText=await ocr.recognize(page,n,pdf.numPages);}check();length+=pageText.length;if(length>100000)throw Error('読み取った文章が長すぎます。レシピ部分だけのファイルにしてください。');pages.push(pageText);page.cleanup();}
      text=pages.join('\n\n');
    }finally{signal?.removeEventListener('abort',cancel);if(ocr)await ocr.close();await task.destroy();}
  }else throw Error('PDF・Word（.docx）・テキスト（.txt）に対応しています。');
  if(text.length>100000)throw Error('文章は10万文字以内のファイルにしてください。');
  if(!text.trim())throw Error('文字を読み取れませんでした。OCRでも文字を確認できない場合は、鮮明なスキャンを選ぶか手入力で補ってください。');
  return text;
}
