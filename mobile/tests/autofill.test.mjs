import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {parseDraft,applyAutoDraft} from '../public/recipe-parser.mjs';
import {ocrAssetUrl,serveOcrAsset} from '../worker/ocr-assets.js';
test('inline, decorative headings and headingless recipes populate actual fields',()=>{for(const text of ['鶏肉料理\n■材料・分量（2人分）\n鶏肉 200g\nしょうゆ 大さじ1\n①鶏肉を切る\n②20分焼く','Chicken Recipe\nIngredients: Chicken 200g\nDirections: Cook for 20 minutes.','照り焼き\n鶏肉 200g\nしょうゆ 大さじ1\n鶏肉を切る。\nフライパンで焼く。']){const r=parseDraft(text);assert.ok(r.title);assert.ok(r.ingredients.length,JSON.stringify(r));assert.ok(r.steps.length,JSON.stringify(r));}assert.equal(parseDraft('鶏肉料理\n材料（2人分）\n鶏肉 200g\n作り方\n焼く').servings,'2人分');});
test('autofill preserves edits made during extraction and fills other inputs',()=>{const fields={title:{value:'自分で修正した料理名'},ingredients:{value:''},steps:{value:''}};assert.equal(applyAutoDraft({title:'自動料理名',ingredients:['鶏肉 200g'],steps:['焼く']},{title:'',ingredients:'',steps:''},fields),true);assert.equal(fields.title.value,'自分で修正した料理名');assert.equal(fields.ingredients.value,'鶏肉 200g');applyAutoDraft({ingredients:[]},{ingredients:'鶏肉 200g'},{ingredients:fields.ingredients});assert.equal(fields.ingredients.value,'');});
test('OCR asset gateway only serves allowlisted public assets',async()=>{assert.equal(ocrAssetUrl('../secrets'),null);assert.equal(ocrAssetUrl('evil.js'),null);assert.match(ocrAssetUrl('jpn.traineddata.gz'),/jpn@1.0.0/);const original=globalThis.fetch;globalThis.fetch=async(url,options)=>{assert.match(url,/^https:\/\/cdn.jsdelivr.net\/npm\/tesseract.js-core@7.0.0\//);assert.equal(options.headers,undefined);return new Response('public OCR code');};try{assert.equal((await serveOcrAsset('evil.js',{})).status,404);const r=await serveOcrAsset('tesseract-core-simd-lstm.wasm.js',{});assert.equal(r.status,200);assert.match(r.headers.get('Content-Type'),/javascript/);}finally{globalThis.fetch=original;}});
test('selecting a real PDF automatically fills the actual form without extra clicks',async()=>{
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,files:[],focus(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const context=vm.createContext({$:node,crypto:globalThis.crypto,AbortController,File,FormData,document:{querySelector:()=>node('close')},fetch:()=>{throw Error('No saving or external request expected');}});
  const moduleUrl=pathToFileURL(process.cwd()+'/public/file-import.mjs').href;
  const source=fs.readFileSync('public/entry.js','utf8').replaceAll("'/file-import.mjs'",JSON.stringify(moduleUrl));
  new vm.Script(source,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(context);
  node('entry-file').files=[new File([fs.readFileSync('tests/fixtures/recipe.pdf')],'recipe.pdf')];
  await node('entry-file').onchange();
  assert.equal(node('entry-title').value,'Chicken Recipe');assert.match(node('entry-ingredients').value,/Chicken 200g/);assert.match(node('entry-steps').value,/20 minutes/);assert.equal(node('entry-save').disabled,false);assert.match(node('file-status').textContent,/自動反映/);
  const {createCanvas}=await import('@napi-rs/canvas');globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.Tesseract={createWorker:async()=>({recognize:async()=>({data:{text:'鶏肉料理\n■材料・分量（2人分）\n鶏肉 200g\n①鶏肉を切る\n②20分焼く'}}),terminate:async()=>{}})};try{node('entry-file').files=[new File([fs.readFileSync('tests/fixtures/scan.pdf')],'scan.pdf')];await node('entry-file').onchange();assert.equal(node('entry-title').value,'鶏肉料理');assert.equal(node('entry-ingredients').value,'鶏肉 200g');assert.match(node('entry-steps').value,/20分焼く/);assert.equal(node('entry-servings').value,'2人分');assert.equal(node('entry-retry').hidden,true);}finally{delete globalThis.document;delete globalThis.Tesseract;}
});
