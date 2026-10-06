import fs from 'node:fs';
const assets={};
for(const name of fs.readdirSync('public')){const p='public/'+name;const binary=name.endsWith('.png');assets['/'+name]={body:fs.readFileSync(p,binary?'base64':'utf8'),binary};}
const source=fs.readFileSync('worker/index.js','utf8');
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+source);
fs.copyFileSync('worker/crawler.js','dist/server/crawler.js');
console.log('Built Worker with embedded PWA assets');
