import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {parseDraft,applyAutoDraft} from '../public/recipe-parser.mjs';
import {ocrAssetUrl,serveOcrAsset,installOcrAsset} from '../worker/ocr-assets.js';
test('inline, decorative headings and headingless recipes populate actual fields',()=>{for(const text of ['鶏肉料理\n■材料・分量（2人分）\n鶏肉 200g\nしょうゆ 大さじ1\n①鶏肉を切る\n②20分焼く','Chicken Recipe\nIngredients: Chicken 200g\nDirections: Cook for 20 minutes.','照り焼き\n鶏肉 200g\nしょうゆ 大さじ1\n鶏肉を切る。\nフライパンで焼く。']){const r=parseDraft(text);assert.ok(r.title);assert.ok(r.ingredients.length,JSON.stringify(r));assert.ok(r.steps.length,JSON.stringify(r));}assert.equal(parseDraft('鶏肉料理\n材料（2人分）\n鶏肉 200g\n作り方\n焼く').servings,'2人分');});
test('autofill preserves edits made during extraction and fills other inputs',()=>{const fields={title:{value:'自分で修正した料理名'},ingredients:{value:''},steps:{value:''}};assert.equal(applyAutoDraft({title:'自動料理名',ingredients:['鶏肉 200g'],steps:['焼く']},{title:'',ingredients:'',steps:''},fields),true);assert.equal(fields.title.value,'自分で修正した料理名');assert.equal(fields.ingredients.value,'鶏肉 200g');applyAutoDraft({ingredients:[]},{ingredients:'鶏肉 200g'},{ingredients:fields.ingredients});assert.equal(fields.ingredients.value,'');});
test('OCR assets require pinned checksums and are served from private Site storage',async()=>{
  assert.equal(ocrAssetUrl('../secrets'),null);assert.equal(ocrAssetUrl('evil.js'),null);assert.equal(ocrAssetUrl('jpn.traineddata.gz'),'/api/ocr-assets/jpn.traineddata.gz');
  const files=new Map(),env={FILES:{put:async(key,data)=>files.set(key,data),get:async key=>files.has(key)?{body:files.get(key)}:null}};
  assert.equal((await serveOcrAsset('evil.js',{},env)).status,404);assert.equal((await serveOcrAsset('eng.traineddata.gz',{},env)).status,503);
  const bytes=fs.readFileSync('node_modules/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz');
  const request=body=>new Request('https://example.test/api/ocr-assets/install/eng.traineddata.gz',{method:'POST',headers:{'Content-Type':'application/octet-stream'},body});
  await installOcrAsset('eng.traineddata.gz',request(bytes),env);const response=await serveOcrAsset('eng.traineddata.gz',{},env);assert.equal(response.status,200);assert.deepEqual(new Uint8Array(await response.arrayBuffer()),new Uint8Array(bytes));
  const bad=new Uint8Array(bytes);bad[0]^=1;await assert.rejects(()=>installOcrAsset('eng.traineddata.gz',request(bad),env),/checksum/);assert.equal(files.size,1);
});
test('selecting a real PDF automatically fills the actual form without extra clicks',async()=>{
  const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,files:[],focus(){},showModal(){this.open=true;},close(){this.open=false;}});return nodes.get(id);};
  const context=vm.createContext({$:node,crypto:globalThis.crypto,AbortController,File,FormData,document:{querySelector:()=>node('close')},fetch:()=>{throw Error('No saving or external request expected');}});
  const moduleUrl=pathToFileURL(process.cwd()+'/public/file-import.mjs').href;
  const source=fs.readFileSync('public/entry.js','utf8').replaceAll("'/file-import.mjs'",JSON.stringify(moduleUrl));
  new vm.Script(source,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(context);
  node('entry-file').files=[new File([fs.readFileSync('tests/fixtures/recipe.pdf')],'recipe.pdf')];
  await node('entry-file').onchange();
  assert.equal(node('entry-title').value,'Chicken Recipe');assert.match(node('entry-ingredients').value,/Chicken 200g/);assert.match(node('entry-steps').value,/20 minutes/);assert.equal(node('entry-save').disabled,false);assert.match(node('file-status').textContent,/自動反映/);
  // Japanese CID fonts require CMaps. This own fixture also has two columns,
  // wrapped ingredient quantities, notes before ingredients and a second page.
  node('entry-file').files=[new File([fs.readFileSync('tests/fixtures/japanese-columns.pdf')],'japanese.pdf')];
  await node('entry-file').onchange();
  assert.equal(node('entry-title').value,'りんごケーキ');assert.equal(node('entry-author').value,'テスト作者');
  assert.deepEqual(node('entry-ingredients').value.split('\n'),['■ 生地（作りやすい量.8個分）','りんご 1個','砂糖 大さじ2（甘い味なら大さじ3）','水 200㏄','レモン汁 適量','薄力粉 100ｇ']);
  assert.deepEqual(node('entry-steps').value.split('\n'),['りんごを切る。','材料をボウルに入れて混ぜ合わせる。','オーブンで焼く。']);
  assert.equal(node('entry-description').value,'均等に焼く。\n家族のおやつです。');assert.equal(node('entry-retry').hidden,true);
  const {createCanvas}=await import('@napi-rs/canvas');globalThis.document={createElement:()=>createCanvas(1,1)};globalThis.Tesseract={createWorker:async()=>({recognize:async()=>({data:{text:'鶏肉料理\n■材料・分量（2人分）\n鶏肉 200g\n①鶏肉を切る\n②20分焼く'}}),terminate:async()=>{}})};try{node('entry-file').files=[new File([fs.readFileSync('tests/fixtures/scan.pdf')],'scan.pdf')];await node('entry-file').onchange();assert.equal(node('entry-title').value,'鶏肉料理');assert.equal(node('entry-ingredients').value,'鶏肉 200g');assert.match(node('entry-steps').value,/20分焼く/);assert.equal(node('entry-servings').value,'2人分');assert.equal(node('entry-retry').hidden,true);}finally{delete globalThis.document;delete globalThis.Tesseract;}
});
