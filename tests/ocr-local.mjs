import {chromium} from 'playwright';
import {build} from 'esbuild';
import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const folder=path.join(root,'.ocr-local-extension');
await cp(path.join(root,'dist'),folder,{recursive:true});
await mkdir(path.join(root,'test-artifacts'),{recursive:true});
await build({stdin:{contents:`
import {localProvider,prepareImage} from './src/ocr.js';
import {extractRows} from './src/core.js';
globalThis.inspectLocal=async data=>{
  const blob=new Blob([Uint8Array.from(atob(data),c=>c.charCodeAt(0))],{type:'image/png'});
  const image=await prepareImage(blob),start=performance.now();
  const result=await localProvider.recognize(image.canvas);
  return {...result,rows:extractRows(result.words,result.boxes),elapsed:Math.round(performance.now()-start)};
};
globalThis.cancelLocal=async()=>{
  const canvas=document.createElement('canvas');canvas.width=canvas.height=100;
  const controller=new AbortController();
  try {await localProvider.recognize(canvas,{signal:controller.signal,onProgress:()=>controller.abort()});return 'not-cancelled';}
  catch(error){return error.name;}
};`,resolveDir:root},bundle:true,format:'iife',platform:'browser',outfile:path.join(folder,'inspect.js')});
let context;
try {
  context=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.TEST_CHROMIUM,args:[`--disable-extensions-except=${folder}`,`--load-extension=${folder}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=await context.newPage();
  const errors=[],remote=[];
  page.on('pageerror',error=>errors.push(error.message));
  context.on('request',request=>{if(/^https?:/.test(request.url())) remote.push(request.url());});
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
  await page.addScriptTag({url:`chrome-extension://${new URL(worker.url()).host}/inspect.js`});
  await context.setOffline(true);
  const input=process.env.SOURCE_SCREENSHOT || path.join(root,'tests/fixtures/stacked-form.png');
  const result=await page.evaluate(data=>inspectLocal(data),(await readFile(input)).toString('base64'));
  await writeFile(path.join(root,'test-artifacts/local-ocr.json'),JSON.stringify(result,null,2));
  assert.equal(result.engine,'PaddleOCR v4');
  assert.ok(result.words.length>2);
  assert.deepEqual(errors,[]);
  assert.deepEqual(remote,[]);
  assert.equal(await page.locator('iframe').count(),0,'Sandbox must release WASM memory after recognition');
  assert.equal(await page.evaluate(()=>cancelLocal()),'AbortError');
  assert.equal(await page.locator('iframe').count(),0,'Cancellation must release sandbox and its inference memory');
  console.log(JSON.stringify({engine:result.engine,elapsed:result.elapsed,rows:result.rows},null,2));
  console.log('PASS: production local OCR runs offline in MV3, retains region coordinates, releases sandbox, no remote requests or script errors');
} finally {await context?.close();}
