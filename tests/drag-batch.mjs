import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const browser=await chromium.launch({executablePath:process.env.TEST_CHROMIUM,headless:true});
try {
  const page=await browser.newPage();
  await page.route('http://drag.test/**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>Drag</title>'}));
  await page.goto('http://drag.test/');
  await page.setContent(`<button id="source" draggable="true">Screenshot</button>
    <form id="first" style="padding:20px;border:1px solid"><h2 id="heading">Target A</h2><label for="name">项目名称</label><input id="name"><label for="url">Prometheus URL</label><input id="url" value="http://"><label for="logs">日志清理 URL</label><input id="logs"><label for="uncertain">待核对</label><input id="uncertain"><label for="different">日志地址</label><input id="different"></form>
    <form id="second" style="padding:20px;border:1px solid"><label for="other">项目名称</label><input id="other"></form>
    <p id="outside">Outside both forms</p>`);
  await page.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>globalThis.handler=fn},sendMessage:async m=>{globalThis.dropResult=m;}}};
    globalThis.send=m=>new Promise(r=>handler(m,{id:'test'},r));
    document.getElementById('source').addEventListener('dragstart',e=>{e.dataTransfer.setData('application/x-local-screenshot-field',globalThis.dragToken);});
  });
  await page.addScriptTag({content:await readFile(new URL('../dist/content.js',import.meta.url),'utf8')});
  const rows=[{label:'项目名称',value:'包头',confirmed:true},{label:'Prometheus URL',value:'http://10.0.0.21:30090',confirmed:true},{label:'日志清理 URL',value:'http://10.0.0.18:31180/',confirmed:true},{label:'待核对',value:'uncertain',confirmed:false}];
  let sequence=0;
  async function arm(sourceRows=rows) {
    const result=await page.evaluate(async({rows,key})=>{globalThis.dragToken=key;globalThis.dropResult=null;return send({type:'ARM_DRAG',key,index:-1,rows});},{rows:sourceRows,key:`token-${++sequence}`});
    assert.equal(result.ok,true,'Whole screenshot must support batch drag');
  }
  await arm();
  await page.locator('#source').dragTo(page.locator('#outside'));
  await page.waitForFunction(()=>globalThis.dropResult);
  assert.equal(await page.locator('#name').inputValue(),'','A drop outside multiple forms must never guess');
  await arm();
  await page.locator('#source').dragTo(page.locator('#heading'));
  await page.waitForFunction(()=>globalThis.dropResult);
  assert.equal(await page.locator('#name').inputValue(),'包头');
  assert.equal(await page.locator('#logs').inputValue(),'http://10.0.0.18:31180/');
  assert.equal(await page.locator('#url').inputValue(),'http://');
  for(const id of ['uncertain','different','other']) assert.equal(await page.locator('#'+id).inputValue(),'');
  assert.equal(await page.evaluate(()=>dropResult.results.filter(r=>r.status==='filled').length),2);
  await page.locator('#name').fill('');
  await page.locator('#source').dragTo(page.locator('#heading'));
  assert.equal(await page.locator('#name').inputValue(),'','A used token cannot be replayed');
  await arm([{label:'项目名称',value:'a',confirmed:true},{label:'项目名称',value:'b',confirmed:true}]);
  await page.locator('#source').dragTo(page.locator('#heading'));
  await page.waitForFunction(()=>globalThis.dropResult);
  assert.equal(await page.locator('#name').inputValue(),'','Duplicate source names remain blocked');
  await arm();
  await page.evaluate(()=>history.pushState({},'','/changed'));
  await page.locator('#source').dragTo(page.locator('#heading'));
  assert.equal(await page.locator('#name').inputValue(),'','SPA navigation invalidates an armed drag');
  console.log('PASS: whole-image trusted drop, specific form scope, occupied/uncertain/different-name skips, duplicates, ambiguous outside drop, replay and navigation refusal');
} finally {await browser.close();}
