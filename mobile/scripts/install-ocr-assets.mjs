// Provision immutable public OCR data in the owner's existing Site storage.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {paths} from './ocr-manifest.mjs';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write('Ready for private Site setup JSON on stdin (input is hidden).\n');
let input='';for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
const {origin,token}=JSON.parse(input.trim());const base=new URL(origin);
if(base.protocol!=='https:'||!base.hostname.endsWith('.chatgpt.site'))throw Error('Expected trusted Sites origin');
for(const [name,path] of Object.entries(paths)){
  const bytes=fs.readFileSync(path),headers={'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/octet-stream'};
  const result=await fetch(new URL('/api/ocr-assets/install/'+name,base),{method:'POST',headers,body:bytes,signal:AbortSignal.timeout(120000)});
  if(!result.ok)throw Error('OCR setup failed: '+name+' HTTP '+result.status);
  const check=await fetch(new URL('/api/ocr-assets/'+name,base),{headers:{'OAI-Sites-Authorization':'Bearer '+token},signal:AbortSignal.timeout(120000)});
  if(!check.ok)throw Error('OCR verification failed: '+name);
  const hash=createHash('sha256').update(new Uint8Array(await check.arrayBuffer())).digest('hex');
  if(hash!==createHash('sha256').update(bytes).digest('hex'))throw Error('OCR verification checksum mismatch');
  console.log(JSON.stringify({asset:name,bytes:bytes.length,verified:true}));
}
process.exit(0);
