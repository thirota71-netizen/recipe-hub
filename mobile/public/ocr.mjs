let library;
function abort(signal){if(signal?.aborted)throw new DOMException('読み取りを中止しました。','AbortError');}
async function loadLibrary(){if(globalThis.Tesseract)return globalThis.Tesseract;if(!library)library=new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/tesseract.min.js';script.onload=()=>resolve(globalThis.Tesseract);script.onerror=()=>{library=null;reject(Error('OCR機能を読み込めませんでした。接続を確認して再度お試しください。'));};document.head.append(script);});return library;}
export function needsOcr(text,hasImage=false){const letters=(text.match(/[\p{L}\p{N}]/gu)||[]).length;return letters<8||(hasImage&&letters<180);}
export function ocrScale(width,height){return Math.min(2.5,Math.sqrt(4000000/(width*height)));}
export async function createOcrReader(onProgress,signal){
  abort(signal);const engine=await loadLibrary();abort(signal);
  onProgress('OCRの日本語・英語データを準備中… 初回は少し時間がかかります。');
  let worker;try{worker=await engine.createWorker('jpn+eng',1,{workerPath:'/tesseract.worker.min.js',workerBlobURL:false,corePath:'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0',logger:message=>{if(!signal?.aborted&&message.status==='recognizing text')onProgress(`文字を読み取り中… ${Math.round(message.progress*100)}%`);}});}catch{throw Error('OCRの言語データを読み込めませんでした。インターネット接続を確認して再度お試しください。');}
  if(signal?.aborted){await worker.terminate();abort(signal);}
  const cancel=()=>worker.terminate().catch(()=>{});signal?.addEventListener('abort',cancel,{once:true});
  return{
    async recognize(page,pageNumber,total){abort(signal);const size=page.getViewport({scale:1}),viewport=page.getViewport({scale:ocrScale(size.width,size.height)}),canvas=document.createElement('canvas');canvas.width=Math.ceil(viewport.width);canvas.height=Math.ceil(viewport.height);const context=canvas.getContext('2d');if(!context)throw Error('画像の読み取りを開始できませんでした。');const task=page.render({canvasContext:context,viewport,background:'rgb(255,255,255)'});const stop=()=>task.cancel();signal?.addEventListener('abort',stop,{once:true});
      try{onProgress(`スキャンPDFを読み取り中… ${pageNumber} / ${total}ページ`);await task.promise;abort(signal);const result=await worker.recognize(canvas,{rotateAuto:true});abort(signal);return result.data.text;}finally{signal?.removeEventListener('abort',stop);canvas.width=canvas.height=0;}
    },
    async close(){signal?.removeEventListener('abort',cancel);await worker.terminate();}
  };
}
