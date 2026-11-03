import { chromium } from 'playwright';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const extension=path.join(root,'.placeholder-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
let context;
try {
  context=await chromium.launchPersistentContext('',{
    executablePath:process.env.TEST_CHROMIUM,headless:true,viewport:{width:900,height:500},
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source=await context.newPage();
  await source.route('http://form.test/**',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`<!doctype html><meta charset="utf-8"><title>来源</title><style>body{font:20px Arial,sans-serif;background:white}form{margin:40px}section{display:flex;align-items:center;gap:26px;margin:26px 0}label{width:100px}input{width:300px;height:44px;font:20px Arial,sans-serif}input::placeholder{color:#a9b3bd}</style><form><section><label for="blank">参数</label><input id="blank" placeholder="参数说明"></section><section><label for="filled">服务</label><input id="filled" value="h5"></section></form>`}));
  await source.goto('http://form.test/source');
  const snapshot=await worker.evaluate(async url=>{
    const tab=(await chrome.tabs.query({})).find(item=>item.url===url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    return chrome.tabs.sendMessage(tab.id,{type:'SOURCE',geometry:true},{frameId:0});
  },source.url());
  assert.equal(snapshot.emptyControlBounds.length,1);
  const image=`data:image/png;base64,${(await source.screenshot()).toString('base64')}`;
  await worker.evaluate(({image,rows,emptyControlBounds})=>chrome.storage.session.set({dockCapture:{
    id:crypto.randomUUID(),tabId:1,windowId:1,image,rows,emptyControlBounds,expiresAt:Date.now()+120000,
  }}),{image,rows:snapshot.rows,emptyControlBounds:snapshot.emptyControlBounds});
  const panel=await context.newPage();
  await context.setOffline(true);
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html?mode=dock`);
  await panel.waitForFunction(()=>document.getElementById('cancel').hidden && document.getElementById('status').textContent.includes('已识别'),null,{timeout:120000});
  const rows=await panel.locator('.data-row').evaluateAll(nodes=>nodes.map(node=>({label:node.querySelector('.field-label').value,value:node.querySelector('.field-value').value})));
  assert.ok(rows.some(row=>row.label==='服务' && row.value==='h5'),JSON.stringify(rows));
  assert.ok(!rows.some(row=>row.value.includes('参数说明')),JSON.stringify(rows));
  console.log('PASS: DOM empty control masks a non-keyword placeholder while preserving filled field');
} finally {await context?.close();}
