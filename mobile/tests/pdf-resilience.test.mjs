import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {pathToFileURL} from 'node:url';
import {extractFile,parseDraft} from '../public/file-import.mjs';
import * as pdfjs from '../public/pdf.mjs';
test('iPad compatibility mode keeps text when sparse-page image decoding fails',async()=>{
 const originalNavigator=Object.getOwnPropertyDescriptor(globalThis,'navigator');
 Object.defineProperty(globalThis,'navigator',{configurable:true,value:{userAgent:'Mozilla/5.0 (iPad)',platform:'MacIntel',maxTouchPoints:5}});
 const data=fs.readFileSync('tests/fixtures/japanese-columns.pdf');
 pdfjs.GlobalWorkerOptions.workerSrc=new URL('../public/pdf.worker.mjs',import.meta.url).href;
 const task=pdfjs.getDocument({data:new Uint8Array(data)});const pdf=await task.promise;const page=await pdf.getPage(1);const proto=Object.getPrototypeOf(page),original=proto.getOperatorList;let images=0;
 proto.getOperatorList=async()=>{images++;throw Error('Image decoding unavailable');};
 try{const draft=parseDraft(await extractFile(new File([data],'recipe.pdf')));assert.equal(draft.title,'りんごケーキ');assert.equal(draft.steps.length,3);assert.equal(images,2);assert.ok(globalThis.pdfjsWorker.WorkerMessageHandler);}
 finally{proto.getOperatorList=original;await task.destroy();Object.defineProperty(globalThis,'navigator',originalNavigator);delete globalThis.pdfjsWorker;}
});
test('failed secondary OCR preserves readable PDF fields in the real form',async()=>{
 const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',hidden:false,disabled:false,files:[],focus(){},showModal(){},close(){}});return nodes.get(id);};
 const context=vm.createContext({$:node,crypto:globalThis.crypto,AbortController,File,FormData,document:{querySelector:()=>node('close')}});
 const source=fs.readFileSync('public/entry.js','utf8').replaceAll("'/file-import.mjs'",JSON.stringify(pathToFileURL(process.cwd()+'/public/file-import.mjs').href));
 new vm.Script(source,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(context);
 globalThis.Tesseract={createWorker:async()=>{throw Error('OCR initialization failed');}};
 try{node('entry-file').files=[new File([fs.readFileSync('tests/fixtures/partial-recipe.pdf')],'partial.pdf')];await node('entry-file').onchange();assert.equal(node('entry-title').value,'Chicken Recipe');assert.equal(node('entry-ingredients').value,'Chicken 200g');assert.equal(node('extracted-panel').hidden,false);assert.equal(node('entry-save').disabled,false);assert.match(node('file-status').textContent,/読み取れた項目は反映/);assert.doesNotMatch(node('file-status').textContent,/^自動読み取りに失敗/);}
 finally{delete globalThis.Tesseract;}
});
test('WebKit without ReadableStream async iteration reproduces old error and autofills with getReader',async()=>{
 const descriptor=Object.getOwnPropertyDescriptor(ReadableStream.prototype,Symbol.asyncIterator);
 delete ReadableStream.prototype[Symbol.asyncIterator];
 let task;
 try{
  const bytes=fs.readFileSync('tests/fixtures/japanese-columns.pdf');
  task=pdfjs.getDocument({data:new Uint8Array(bytes)});const pdf=await task.promise;const page=await pdf.getPage(1);
  await assert.rejects(()=>page.getTextContent(),/async iterable|not a function/);
  await task.destroy();task=null;
  const nodes=new Map(),node=id=>{if(!nodes.has(id))nodes.set(id,{value:'',files:[],hidden:false,disabled:false,focus(){},showModal(){},close(){}});return nodes.get(id);};
  const context=vm.createContext({$:node,crypto:globalThis.crypto,AbortController,File,FormData,document:{querySelector:()=>node('close')}});
  const source=fs.readFileSync('public/entry.js','utf8').replaceAll("'/file-import.mjs'",JSON.stringify(pathToFileURL(process.cwd()+'/public/file-import.mjs').href));
  new vm.Script(source,{importModuleDynamically:vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER}).runInContext(context);
  node('entry-file').files=[new File([bytes],'recipe.pdf')];await node('entry-file').onchange();
  assert.equal(node('entry-title').value,'りんごケーキ');assert.equal(node('entry-author').value,'テスト作者');assert.equal(node('entry-ingredients').value.split('\n').length,6);assert.equal(node('entry-steps').value.split('\n').length,3);assert.equal(node('entry-retry').hidden,true);assert.match(node('file-status').textContent,/自動反映/);
 }finally{if(task)await task.destroy();Object.defineProperty(ReadableStream.prototype,Symbol.asyncIterator,descriptor);}
});
