// Service access is read fresh from Sites get_site; never persist credentials.
import fs from 'node:fs';
if(process.stdin.isTTY)process.stdin.setRawMode(true);
process.stdout.write('Ready for private Site request JSON on stdin (input is hidden).\n');
let input='';
for await(const chunk of process.stdin){input+=chunk;if(input.includes('\n'))break;}
const {origin,token,action='run'}=JSON.parse(input.trim());
const base=new URL(origin);
if(base.protocol!=='https:'||!base.hostname.endsWith('.chatgpt.site'))throw Error('Expected trusted Sites origin');
const path=action==='run'?'/api/crawl/run':'/api/crawl/status';
const response=await fetch(new URL(path,base),{method:action==='run'?'POST':'GET',headers:{'OAI-Sites-Authorization':'Bearer '+token,'Content-Type':'application/json'},...(action==='run'?{body:'{}'}:{}),signal:AbortSignal.timeout(240000)});
const text=await response.text();
if(!response.ok){console.log(JSON.stringify({status:response.status,error:text.slice(0,1500)}));process.exit(1);}
console.log(JSON.stringify(JSON.parse(text)));
process.exit(0);
