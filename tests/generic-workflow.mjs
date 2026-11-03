import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.generic-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['http://127.0.0.1/*']}));
const html=source=>`<!doctype html><meta charset="utf-8"><title>通用表单测试</title><style>
body{font-family:"Microsoft YaHei",sans-serif;background:white;margin:30px}form{width:780px;padding:24px;border:1px solid #ddd}section{display:flex;align-items:center;margin:24px 0;gap:20px}label{width:100px;text-align:right;flex-shrink:0;font-size:16px}input{font:16px "Microsoft YaHei",sans-serif;width:570px;height:40px;box-sizing:border-box;border:1px solid #ccc;border-radius:3px;padding:8px;color:#222;background:#fff}
</style><form><section class="arbitrary-row-a"><label>名称</label><div><span><input id="name" value="${source?'曲靖saas':''}" placeholder="请输入名称"></span></div></section><section class="arbitrary-row-b"><label>优先级</label><div><input id="priority" type="number" value="${source?'20':''}" placeholder="请输入优先级"></div></section><section class="arbitrary-row-c"><label>Prometheus</label><div class="ivu-select"><input id="custom" value="${source?'生产Prometheus':''}" placeholder="请选择Prometheus"></div></section></form>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html(req.url==='/source'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let context;
try {
  context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(20000);
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto(`http://127.0.0.1:${server.address().port}/source`);
  await mkdir(path.join(root,'test-artifacts'),{recursive:true});
  const screenshot=path.join(root,'test-artifacts/generic-source.png');
  await source.locator('form').screenshot({path:screenshot});
  const target=await context.newPage();await target.goto(`http://127.0.0.1:${server.address().port}/target`);
  const panel=await context.newPage();await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html`);
  await panel.waitForFunction(()=>!document.getElementById('choose').disabled);
  await context.setOffline(true);
  await panel.locator('#file').setInputFiles(screenshot);
  await panel.waitForFunction(()=>document.getElementById('cancel').hidden && document.querySelectorAll('.data-row').length>0);
  const rows=await panel.locator('.data-row').evaluateAll(nodes=>nodes.map(n=>({label:n.querySelector('.field-label').value,value:n.querySelector('.field-value').value,checked:n.querySelector('input').checked})));
  assert.ok(rows.length>=2);
  assert.ok(rows.every(r=>r.checked),'All recognized screenshot rows are selected without manual confirmation');
  assert.equal(rows.find(r=>r.label==='名称')?.value,'曲靖saas');
  assert.equal(rows.find(r=>r.label==='优先级')?.value,'20');
  await target.bringToFront();
  await panel.evaluate(()=>document.getElementById('fill').click());
  await panel.waitForFunction(()=>document.getElementById('summary').textContent==='2 项已写入');
  assert.equal(await target.locator('#name').inputValue(),'曲靖saas');
  assert.equal(await target.locator('#priority').inputValue(),'20');
  assert.equal(await target.locator('#custom').inputValue(),'','Custom dropdown is not treated as an ordinary text box');
  await target.screenshot({path:path.join(root,'test-artifacts/generic-filled.png')});
  await panel.setViewportSize({width:380,height:1050});
  await panel.locator('#target-details').evaluate(node=>{node.open=true;});
  await panel.screenshot({path:path.join(root,'test-artifacts/generic-results.png'),fullPage:true});
  console.log('PASS: actual form screenshot -> offline OCR -> default selection -> one-click fill 名称=曲靖saas and 优先级=20 on arbitrary containers without label associations; custom dropdown untouched');
} finally {await context?.close();await new Promise(r=>server.close(r));}
