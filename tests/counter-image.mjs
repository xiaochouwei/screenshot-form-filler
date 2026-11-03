import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.counter-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
let context;
try {
  context=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.TEST_CHROMIUM,viewport:{width:1200,height:500},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const page=await context.newPage();
  await page.route('http://counter.test/**',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`<!doctype html><meta charset="utf-8"><style>
    body{margin:30px;background:white;font:18px Arial,"Microsoft YaHei",sans-serif}section{display:flex;align-items:center;gap:16px;margin:30px 0}label{width:70px}.wrapper{position:relative}input{box-sizing:border-box;width:800px;height:44px;border:1px solid #d5d7d8;border-radius:3px;padding:8px 90px 8px 12px;font:18px Arial,sans-serif}.ivu-input-word-count,.el-input__count{position:absolute;right:12px;top:14px;font:14px Arial,sans-serif;color:#888}
    </style><form><section><label for="service">服务</label><div class="wrapper"><input id="service" maxlength="256" value="parking-pay"><span class="ivu-input-word-count">11/256</span></div></section><section><label for="ratio">描述</label><div class="wrapper"><input id="ratio" maxlength="256" value="11/256"><span class="el-input__count">6/256</span></div></section></form>`}));
  await page.goto('http://counter.test/');
  const source=await worker.evaluate(async url=>{
    const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const shown=await chrome.tabs.sendMessage(tab.id,{type:'SHOW_SHELF'},{frameId:0});
    if(!shown?.ok)throw Error('Could not prepare screenshot shelf');
    return chrome.tabs.sendMessage(tab.id,{type:'SOURCE',geometry:true},{frameId:0});
  },page.url());
  assert.equal(source.emptyControlBounds.length,2);
  await page.locator('#local-screenshot-shelf').waitFor();
  await page.locator('#local-screenshot-shelf').evaluate(node=>{node.style.visibility='hidden';});
  const buffer=await page.screenshot(),image=`data:image/png;base64,${buffer.toString('base64')}`;
  await mkdir(path.join(root,'test-artifacts'),{recursive:true});
  await writeFile(path.join(root,'test-artifacts/counter-source.png'),buffer);
  await worker.evaluate(({image,source})=>chrome.storage.session.set({dockCapture:{id:crypto.randomUUID(),tabId:1,windowId:1,image,rows:source.rows,emptyControlBounds:source.emptyControlBounds,expiresAt:Date.now()+120000}}),{image,source});
  const panel=await context.newPage();
  await context.setOffline(true);
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html?mode=dock`);
  async function ready() {
    await panel.waitForFunction(()=>document.getElementById('cancel').hidden && document.getElementById('status').textContent.includes('已识别'),null,{timeout:90000});
    await panel.waitForFunction(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture?.rows.length===2);
    return panel.evaluate(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture.rows);
  }
  const assisted=await ready();
  assert.deepEqual(assisted.map(row=>[row.label,row.value,row.confirmed,row.source,!!row.alternative]),[['服务','parking-pay',true,'image+web',false],['描述','11/256',true,'image+web',false]]);
  await panel.locator('#file').setInputFiles({name:'external.png',mimeType:'image/png',buffer});
  await panel.waitForFunction(()=>!document.getElementById('cancel').hidden);
  const external=await ready();
  assert.deepEqual(external.map(row=>[row.label,row.value,row.confirmed,row.source]),[['服务','parking-pay',true,'image'],['描述','11/256',true,'image']]);
  console.log('PASS: real offline OCR excludes counter decorations with and without source DOM; literal fractional values survive and assisted rows have no false conflicts');
} finally {await context?.close();}
