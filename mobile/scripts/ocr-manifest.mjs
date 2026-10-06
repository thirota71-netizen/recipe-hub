import fs from 'node:fs';
import {createHash} from 'node:crypto';
export const paths=Object.fromEntries([
  ...['tesseract-core-lstm.wasm.js','tesseract-core-simd-lstm.wasm.js','tesseract-core-relaxedsimd-lstm.wasm.js'].map(name=>[name,'node_modules/tesseract.js-core/'+name]),
  ...['jpn','eng'].map(lang=>[lang+'.traineddata.gz',`node_modules/@tesseract.js-data/${lang}/4.0.0_best_int/${lang}.traineddata.gz`])
]);
const manifest=Object.fromEntries(Object.entries(paths).map(([name,path])=>{const bytes=fs.readFileSync(path);return[name,{sha:createHash('sha256').update(bytes).digest('hex'),size:bytes.length}];}));
fs.writeFileSync('worker/ocr-manifest.js','// Generated from pinned OCR packages. Public assets only.\nexport default '+JSON.stringify(manifest)+';\n');
