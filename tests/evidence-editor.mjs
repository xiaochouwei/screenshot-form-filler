import {chromium} from 'playwright';
import {cp,readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';
import {mergeRecords} from '../src/records.js';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.evidence-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['http://127.0.0.1/*']}));
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end('<title>Generic evidence</title><style>body{padding:260px 20px;font:16px sans-serif}label{display:block;margin:15px}textarea{width:300px;height:70px}</style><form><label>Description<textarea id="description"></textarea></label><label>Notes<textarea id="notes"></textarea></label><button>Submit</button></form><script>window.submitted=0;document.querySelector("form").onsubmit=e=>{e.preventDefault();submitted++}</script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context;
try{
  context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,viewport:{width:1100,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const target=await context.newPage();await target.goto(`http://127.0.0.1:${server.address().port}/`);
  const panel=await context.newPage();await panel.goto(worker.url().replace('background.js','panel.html'));
  await panel.waitForFunction(()=>!document.getElementById('choose').disabled);
  const rows=mergeRecords([{label:'Description',value:'misread',confirmed:true},{label:'Notes',value:'first\nsecond',confirmed:false}],[{label:'Description',value:'source exact',confirmed:true}]);
  await panel.evaluate(async rows=>{
    const canvas=document.createElement('canvas');canvas.width=400;canvas.height=100;const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,400,100);ctx.fillStyle='black';ctx.fillText('Description',20,40);
    await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'add',capture:{id:crypto.randomUUID(),image:canvas.toDataURL(),rows,status:'ready'}}});
  },rows);
  await panel.waitForFunction(()=>document.querySelectorAll('.data-row').length===2 && !document.getElementById('choose').disabled);
  const first=panel.locator('.data-row').nth(0),second=panel.locator('.data-row').nth(1);
  assert.equal(await first.locator('input[type=checkbox]').isChecked(),true);
  assert.equal(await second.locator('input[type=checkbox]').isChecked(),true);
  assert.equal(await panel.locator('#fill').isDisabled(),true,'Selected pending/conflict values cannot fill');
  assert.equal(await first.locator('.alternative-value').inputValue(),'source exact');
  await first.evaluate(node=>node.scrollIntoView({block:'start'}));
  await panel.screenshot({path:'test-artifacts/evidence-conflict.png'});
  await panel.evaluate(()=>scrollTo(0,0));
  await first.locator('input[type=checkbox]').uncheck();await first.getByRole('button',{name:'采用网页原值',exact:true}).click();
  assert.equal(await first.locator('input[type=checkbox]').isChecked(),false,'Choosing evidence must preserve exclusion');
  await first.locator('input[type=checkbox]').check();
  await target.bringToFront();await panel.evaluate(()=>document.getElementById('fill').click());
  await target.waitForFunction(()=>document.getElementById('description').value==='source exact');
  await panel.waitForFunction(()=>!document.getElementById('fill').disabled);
  assert.equal(await target.locator('#notes').inputValue(),'');
  await second.getByRole('button',{name:'确认当前值',exact:true}).click();
  await target.bringToFront();await panel.evaluate(()=>document.getElementById('fill').click());
  await target.waitForFunction(()=>document.getElementById('notes').value==='first\nsecond');
  await panel.waitForFunction(()=>!document.getElementById('fill').disabled);
  await first.locator('input[type=checkbox]').uncheck();
  await panel.waitForFunction(async()=>{const saved=(await chrome.storage.local.get('savedCapture')).savedCapture;return saved.rows[0].selected===false;});
  await panel.reload();await panel.waitForFunction(()=>document.querySelectorAll('.data-row').length===2 && !document.getElementById('choose').disabled);
  assert.equal(await first.locator('input[type=checkbox]').isChecked(),false);
  await second.locator('.field-value').fill('edited');
  assert.equal(await second.locator('input[type=checkbox]').isChecked(),true);
  assert.equal(await second.getByRole('button',{name:'确认当前值',exact:true}).isVisible(),true,'Editing reveals review without toggling participation');
  assert.equal(await panel.locator('#fill').isDisabled(),true);
  await second.getByRole('button',{name:'确认当前值',exact:true}).click();
  await target.bringToFront();await panel.evaluate(()=>document.getElementById('scan').click());
  await panel.waitForFunction(()=>!document.getElementById('scan').disabled && document.getElementById('page-note').textContent.includes('全页'));
  assert.match(await panel.locator('#page-note').innerText(),/当前表单 2 项.*全页 2 项.*已适配 2.*未适配 0/);
  assert.match(await panel.locator('#target-fields').inputValue(),/候选节点.*2 个字段/);
  assert.equal(await target.evaluate(()=>submitted),0);
  await panel.screenshot({path:'test-artifacts/evidence-editor.png',fullPage:true});
  await panel.setViewportSize({width:390,height:850});await panel.screenshot({path:'test-artifacts/evidence-editor-narrow.png',fullPage:true});
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  const states=[
    {label:'Switch',value:'true',kind:'switch',checked:true,confirmed:false,selected:true,review:'conflict',alternative:{label:'Switch',value:'false',kind:'switch',checked:false}},
    {label:'Checkbox',value:'false',kind:'checkbox',checked:false,confirmed:false,selected:true,review:'conflict',alternative:{label:'Checkbox',value:'true',kind:'checkbox',checked:true}},
    {label:'Group',value:'',kind:'group',fields:[{label:'Enabled',value:'true',kind:'checkbox',checked:true,confirmed:true},{label:'Options',value:'',kind:'multi-select',values:['Alpha'],confirmed:true}],confirmed:false,selected:true,review:'conflict',alternative:{label:'Group',value:'',kind:'group',fields:[{label:'Enabled',value:'false',kind:'checkbox',checked:false,confirmed:true},{label:'Options',value:'',kind:'multi-select',values:['Alpha','Beta'],confirmed:true}]}}
  ];
  const stored=await panel.evaluate(async rows=>{
    return chrome.runtime.sendMessage({type:'HISTORY',action:{type:'add',capture:{id:crypto.randomUUID(),image:(await chrome.storage.local.get('savedCapture')).savedCapture.image,rows,status:'ready'}}});
  },states);
  assert.equal(stored.ok,true,stored.error);
  await panel.waitForFunction(()=>document.querySelectorAll('.data-row').length===3 && !document.getElementById('choose').disabled);
  assert.equal(await panel.locator('.alternative-value').nth(0).inputValue(),'关闭 / 未勾选');
  assert.equal(await panel.locator('.alternative-value').nth(1).inputValue(),'开启 / 勾选');
  assert.equal(await panel.locator('.alternative-value').nth(2).inputValue(),'Enabled: 关闭 / 未勾选\nOptions: Alpha\nBeta');
  assert.equal(await panel.locator('#fill').isDisabled(),true,'Displaying source states does not verify them');
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await panel.screenshot({path:'test-artifacts/evidence-states-narrow.png',fullPage:true});
  console.log('PASS: selected pending/conflict editor states, explicit evidence choice, default participation, no implicit confirmation, manual exclusion restore and narrow layout');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
