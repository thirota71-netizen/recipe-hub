import manifest from './ocr-manifest.js';
const known=name=>Object.hasOwn(manifest,name)?manifest[name]:null;
const key=(name,item)=>'system/ocr/'+item.sha+'/'+name;
export function ocrAssetUrl(name){return known(name)?'/api/ocr-assets/'+name:null;}
export async function serveOcrAsset(name,headers,env){
  const item=known(name);if(!item)return new Response('Not found',{status:404});
  if(!env?.FILES)return new Response('OCR storage unavailable',{status:503});
  const asset=await env.FILES.get(key(name,item));if(!asset)return new Response('OCR data not installed',{status:503});
  const type=name.endsWith('.js')?'text/javascript;charset=utf-8':'application/octet-stream';
  return new Response(asset.body,{headers:{...headers,'Content-Type':type,'Content-Length':String(item.size),'Cache-Control':'public,max-age=604800','X-Content-Type-Options':'nosniff'}});
}
export async function installOcrAsset(name,request,env){
  const item=known(name);if(!item)throw Error('Unsupported OCR asset');
  if(request.headers.get('Content-Type')!=='application/octet-stream')throw Error('Expected binary OCR data');
  if(!env.FILES)throw Error('OCR storage unavailable');
  const reader=request.body.getReader(),chunks=[];let size=0;
  while(true){const {value,done}=await reader.read();if(done)break;size+=value.length;if(size>item.size){await reader.cancel();throw Error('OCR asset size mismatch');}chunks.push(value);}
  if(size!==item.size)throw Error('OCR asset size mismatch');const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.length;}
  const digest=await crypto.subtle.digest('SHA-256',bytes);const sha=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
  if(sha!==item.sha)throw Error('OCR asset checksum mismatch');
  await env.FILES.put(key(name,item),bytes);return{asset:name,installed:true};
}
