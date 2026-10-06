// Only immutable public OCR assets are fetched. No recipe or credential is sent upstream.
export function ocrAssetUrl(name){
  if(['jpn.traineddata.gz','eng.traineddata.gz'].includes(name)){const lang=name.split('.')[0];return `https://cdn.jsdelivr.net/npm/@tesseract.js-data/${lang}@1.0.0/4.0.0_best_int/${name}`;}
  if(/^tesseract-core(?:-(?:simd|relaxedsimd))?(?:-lstm)?\.wasm(?:\.js)?$/.test(name))return 'https://cdn.jsdelivr.net/npm/tesseract.js-core@7.0.0/'+name;
  return null;
}
export async function serveOcrAsset(name,headers){
  const url=ocrAssetUrl(name);if(!url)return new Response('Not found',{status:404});
  let res;try{res=await fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error',cf:{cacheTtl:604800,cacheEverything:true}});}catch{return new Response('OCR data unavailable',{status:503});}
  if(!res.ok)return new Response('OCR data unavailable',{status:503});
  const type=name.endsWith('.js')?'text/javascript;charset=utf-8':name.endsWith('.wasm')?'application/wasm':'application/octet-stream';
  return new Response(res.body,{headers:{...headers,'Content-Type':type,'Cache-Control':'public,max-age=604800','X-Content-Type-Options':'nosniff'}});
}
