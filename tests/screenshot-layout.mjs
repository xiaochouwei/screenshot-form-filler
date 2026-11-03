import { chromium } from 'playwright';
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.layout-extension');
await cp(path.join(root, 'dist'), extension, {recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['http://127.0.0.1/*']}));
await mkdir(path.join(root,'test-artifacts'),{recursive:true});
await build({stdin:{contents:`import {localProvider,prepareImage} from './src/ocr.js'; import {extractRows} from './src/core.js'; globalThis.inspectImage=async base64=>{const blob=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'});const p=await prepareImage(blob); const result=await localProvider.recognize(p.canvas); return {...result,rows:extractRows(result.words,result.boxes)};};`,resolveDir:root},bundle:true,platform:'browser',outfile:path.join(extension,'inspect.js')});
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><title>上下布局回归</title><form><label for="name">项目名称</label><input id="name"><label for="url">Prometheus URL</label><input id="url" type="url" value="http://"><label for="logs">日志清理 URL</label><input id="logs" type="url" placeholder="http://192.168.1.10:31180/"><label for="different">日志地址</label><input id="different"></form>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
const context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const target=await context.newPage();
  await target.goto(`http://127.0.0.1:${server.address().port}/`);
  const page=await context.newPage();
  await page.setViewportSize({width:400,height:1000});
  await page.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
  await page.addScriptTag({url:`chrome-extension://${new URL(worker.url()).host}/inspect.js`});
  await context.setOffline(true);
  const screenshot=process.env.SOURCE_SCREENSHOT || path.join(root,'tests/fixtures/stacked-form.png');
  const result=await page.evaluate(base64=>inspectImage(base64),(await readFile(screenshot)).toString('base64'));
  await writeFile(path.join(root,'test-artifacts/stacked-ocr.json'),JSON.stringify(result,null,2));
  console.log('Recognized:',result.rows);
  assert.deepEqual(result.rows.map(({label,value})=>({label,value})),[
    {label:'项目名称',value:'包头'},
    {label:'Prometheus URL',value:'http://10.0.0.21:30090'},
    {label:'日志清理 URL',value:'http://10.0.0.18:31180/'},
  ]);
  await page.waitForFunction(()=>!document.getElementById('choose').disabled);
  await page.locator('#file').setInputFiles(screenshot);
  await page.waitForFunction(()=>document.querySelectorAll('.data-row').length===3 && document.getElementById('cancel').hidden);
  const rows=await page.locator('.data-row').evaluateAll(ns=>ns.map(n=>({label:n.querySelector('.field-label').value,value:n.querySelector('.field-value').value})));
  assert.deepEqual(rows,result.rows.map(({label,value})=>({label,value})));
  // Existing installations restore the compressed screenshot. Re-recognition
  // after an update must work without asking the user to capture it again.
  await page.reload();
  await page.waitForFunction(()=>!document.getElementById('recognize').disabled);
  await page.locator('#recognize').click();
  await page.waitForFunction(()=>document.getElementById('cancel').hidden && !document.getElementById('recognize').disabled);
  assert.deepEqual(await page.locator('.data-row').evaluateAll(ns=>ns.map(n=>({label:n.querySelector('.field-label').value,value:n.querySelector('.field-value').value}))),rows);
  assert.equal(await page.locator('.data-row input[type=checkbox]:checked').count(),3,'New recognition selects every extracted row, including lower-confidence JPEG text');
  await page.screenshot({path:path.join(root,'test-artifacts/stacked-panel.png'),fullPage:true});
  await target.bringToFront();
  await page.evaluate(()=>document.getElementById('fill').click());
  await page.waitForFunction(()=>document.getElementById('summary').textContent==='2 项已写入');
  assert.equal(await target.locator('#name').inputValue(),'包头');
  assert.equal(await target.locator('#url').inputValue(),'http://');
  assert.equal(await target.locator('#logs').inputValue(),'http://10.0.0.18:31180/');
  assert.equal(await target.locator('#different').inputValue(),'');
  // A URL prefix is actual content; after an explicit clear, one-click can fill it.
  await target.locator('#url').fill('');
  await page.evaluate(()=>document.getElementById('fill').click());
  await page.waitForFunction(()=>document.getElementById('summary').textContent==='1 项已写入');
  assert.equal(await target.locator('#url').inputValue(),'http://10.0.0.21:30090');
  console.log('PASS: actual user screenshot offline OCR, three exact stacked fields, no helper-text field; real import UI; one-click fills name/log URL, skips existing http:// and wrong labels, fills URL after explicit clear');
} finally {await context.close();await new Promise(r=>server.close(r));}
