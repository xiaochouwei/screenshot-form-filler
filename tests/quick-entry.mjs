import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const extension=path.join(root,'.quick-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
assert.equal(manifest.commands?.['receive-screenshot']?.suggested_key?.default,'Alt+Shift+S');
// Native toolbar/shortcut permissions are tested at their API boundary in
// region.test.mjs. This fixture preserves legacy clipboard request coverage.
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['http://127.0.0.1/*']}));
const server=http.createServer((_,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<!doctype html><title>快捷拖拽测试</title><form id="target" style="padding:20px;border:1px solid"><h2 id="heading">目标表单</h2><label for="name">项目名称</label><input id="name"><label for="url">Prometheus URL</label><input id="url" value="http://"><label for="logs">日志清理 URL</label><input id="logs"></form>');});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let context;
let clipboardBackup;
let panel;
try {
  context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  const target=await context.newPage();
  await target.goto(`http://127.0.0.1:${server.address().port}/`);
  panel=await context.newPage();
  const errors=[];
  panel.on('pageerror',e=>errors.push(e.message));
  await panel.setViewportSize({width:380,height:950});
  await panel.goto(`chrome-extension://${id}/panel.html`);
  await panel.waitForFunction(()=>!document.getElementById('paste').disabled);
  await context.grantPermissions(['clipboard-read','clipboard-write']);
  clipboardBackup=await panel.evaluate(async()=>{
    const backup=[];
    for(const item of await navigator.clipboard.read()) {
      const entry={};
      for(const type of item.types) entry[type]=Array.from(new Uint8Array(await (await item.getType(type)).arrayBuffer()));
      if(Object.keys(entry).length) backup.push(entry);
    }
    return backup;
  });
  await panel.evaluate(async base64=>{
    const image=new Blob([Uint8Array.from(atob(base64),c=>c.charCodeAt(0))],{type:'image/png'});
    await navigator.clipboard.write([new ClipboardItem({'image/png':image})]);
    const read=navigator.clipboard.read.bind(navigator.clipboard);
    globalThis.clipboardReads=0;
    navigator.clipboard.read=()=>{globalThis.clipboardReads++;return read();};
  },(await readFile(path.join(root,'tests/fixtures/stacked-form.png'))).toString('base64'));
  const tab=await panel.evaluate(async()=>{const tabs=await chrome.tabs.query({currentWindow:true});return tabs.find(t=>t.url?.startsWith('http://127.0.0.1'));});
  await context.setOffline(true);
  const queue=()=>panel.evaluate(async tab=>chrome.storage.session.set({[`quickCapture-${tab.windowId}`]:{id:crypto.randomUUID(),windowId:tab.windowId,tabId:tab.id,expiresAt:Date.now()+60000}}),tab);
  await queue();
  await panel.waitForFunction(()=>document.querySelectorAll('.data-row').length===3 && document.getElementById('dropzone').draggable,{timeout:60000});
  assert.deepEqual(await panel.locator('.data-row').evaluateAll(ns=>ns.map(n=>[n.querySelector('.field-label').value,n.querySelector('.field-value').value])),[
    ['项目名称','包头'],['Prometheus URL','http://10.0.0.21:30090'],['日志清理 URL','http://10.0.0.18:31180/'],
  ]);
  assert.equal(await panel.evaluate(()=>clipboardReads),1,'Shortcut reads the clipboard exactly once');
  await target.bringToFront();
  const transfer=await panel.evaluateHandle(()=>new DataTransfer());
  await panel.locator('#dropzone').dispatchEvent('dragstart',{dataTransfer:transfer});
  const types=await transfer.evaluate(d=>d.types);
  assert.deepEqual(types,['application/x-local-screenshot-field','text/plain'],'Do not expose screenshot bytes/URL as native drop data');
  const key=await transfer.evaluate(d=>d.getData('application/x-local-screenshot-field'));
  await panel.waitForTimeout(300);
  await target.evaluate(key=>{
    const handle=document.createElement('button');handle.id='drag-source';handle.textContent='Screenshot';handle.draggable=true;
    handle.addEventListener('dragstart',e=>e.dataTransfer.setData('application/x-local-screenshot-field',key));document.body.prepend(handle);
  },key);
  await target.locator('#drag-source').dragTo(target.locator('#heading'));
  await target.waitForFunction(()=>document.getElementById('name').value==='包头' && document.getElementById('logs').value==='http://10.0.0.18:31180/');
  assert.equal(await target.locator('#url').inputValue(),'http://');
  await panel.waitForFunction(()=>document.getElementById('summary').textContent==='2 项已写入');
  assert.equal(await panel.evaluate(()=>clipboardReads),1,'Drag and tab changes must not monitor the clipboard');
  await panel.bringToFront();
  await panel.screenshot({path:path.join(root,'test-artifacts/quick-drag.png'),fullPage:true});
  await panel.locator('.field-value').first().fill('人工修正');
  await panel.locator('.data-row input[type=checkbox]').first().check();
  await panel.locator('.data-row').first().getByRole('button',{name:'确认当前值',exact:true}).click();
  await queue();
  await panel.waitForFunction(()=>clipboardReads===2 && document.getElementById('status').textContent.includes('已保留核对结果') && !document.getElementById('paste').disabled);
  assert.equal(await panel.locator('.field-value').first().inputValue(),'人工修正','Same clipboard screenshot must retain reviewed edits');
  assert.deepEqual(errors,[]);
  console.log('PASS: shortcut request -> real clipboard image -> automatic offline OCR -> whole-image token -> trusted batch drop; no upload/recognize/fill clicks; preserved occupied URL, one read per request, same image keeps corrections');
} finally {
  if(panel && clipboardBackup) {
    await panel.bringToFront().catch(()=>{});
    await panel.evaluate(async backup=>{
      if(!backup.length) {await navigator.clipboard.writeText('');return;}
      await navigator.clipboard.write(backup.map(entry=>new ClipboardItem(Object.fromEntries(Object.entries(entry).map(([type,bytes])=>[type,new Blob([new Uint8Array(bytes)],{type})])))));
    },clipboardBackup).catch(error=>console.error('Clipboard restore failed:',error.message));
  }
  await context?.close();await new Promise(r=>server.close(r));
}
