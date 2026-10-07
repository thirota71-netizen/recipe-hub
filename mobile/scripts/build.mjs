import fs from 'node:fs';
for(const [source,target] of [['node_modules/pdfjs-dist/legacy/build/pdf.mjs','public/pdf.mjs'],['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','public/pdf.worker.mjs'],['node_modules/mammoth/mammoth.browser.js','public/mammoth.browser.js']])fs.copyFileSync(source,target);
for(const [source,target] of [['node_modules/tesseract.js/dist/tesseract.min.js','public/tesseract.min.js'],['node_modules/tesseract.js/dist/worker.min.js','public/tesseract.worker.min.js']])fs.copyFileSync(source,target);
await import('./ocr-manifest.mjs');
const assets={};
// Japanese CID fonts need PDF.js's packed character maps, served locally.
fs.cpSync('node_modules/pdfjs-dist/cmaps','public/cmaps',{recursive:true});
fs.cpSync('node_modules/pdfjs-dist/standard_fonts','public/pdf-fonts',{recursive:true});
fs.cpSync('node_modules/pdfjs-dist/wasm','public/pdf-wasm',{recursive:true});
function embed(directory,prefix=''){for(const name of fs.readdirSync(directory)){const p=directory+'/'+name,url=prefix+'/'+name;if(fs.statSync(p).isDirectory()){embed(p,url);continue;}const binary=/\.(?:png|bcmap|pfb|ttf|wasm)$/.test(name);assets[url]={body:fs.readFileSync(p,binary?'base64':'utf8'),binary};}}
embed('public');
const source=fs.readFileSync('worker/index.js','utf8');
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+source);
fs.copyFileSync('worker/crawler.js','dist/server/crawler.js');
console.log('Built Worker with embedded PWA assets');

fs.copyFileSync('worker/translation.js','dist/server/translation.js');

fs.copyFileSync('worker/entries.js','dist/server/entries.js');

fs.copyFileSync('worker/ocr-assets.js','dist/server/ocr-assets.js');

fs.copyFileSync('worker/ocr-manifest.js','dist/server/ocr-manifest.js');
