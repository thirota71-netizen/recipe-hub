import fs from 'node:fs';
for(const [source,target] of [['node_modules/pdfjs-dist/legacy/build/pdf.mjs','public/pdf.mjs'],['node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs','public/pdf.worker.mjs'],['node_modules/mammoth/mammoth.browser.js','public/mammoth.browser.js']])fs.copyFileSync(source,target);
for(const [source,target] of [['node_modules/tesseract.js/dist/tesseract.min.js','public/tesseract.min.js'],['node_modules/tesseract.js/dist/worker.min.js','public/tesseract.worker.min.js']])fs.copyFileSync(source,target);
await import('./ocr-manifest.mjs');
const assets={};
for(const name of fs.readdirSync('public')){const p='public/'+name;const binary=name.endsWith('.png');assets['/'+name]={body:fs.readFileSync(p,binary?'base64':'utf8'),binary};}
const source=fs.readFileSync('worker/index.js','utf8');
fs.mkdirSync('dist/server',{recursive:true});
fs.writeFileSync('dist/server/index.js','const ASSETS='+JSON.stringify(assets)+';\n'+source);
fs.copyFileSync('worker/crawler.js','dist/server/crawler.js');
console.log('Built Worker with embedded PWA assets');

fs.copyFileSync('worker/translation.js','dist/server/translation.js');

fs.copyFileSync('worker/entries.js','dist/server/entries.js');

fs.copyFileSync('worker/ocr-assets.js','dist/server/ocr-assets.js');

fs.copyFileSync('worker/ocr-manifest.js','dist/server/ocr-manifest.js');
