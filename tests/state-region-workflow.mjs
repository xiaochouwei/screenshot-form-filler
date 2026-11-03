import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.state-region-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
const background=await readFile(path.join(extension,'background.js'),'utf8');
await writeFile(path.join(extension,'background.js'),`const register=chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);chrome.commands.onCommand.addListener=fn=>{globalThis.command=fn;register(fn);};\n${background}`);
const html=source=>`<!doctype html><meta charset="utf-8"><title>${source?'来源':'目标'}</title><style>
body{margin:0;background:white;font:16px "Microsoft YaHei",sans-serif}form{padding:20px;width:1140px}.row{margin-bottom:30px}.field-label{display:block;width:1100px;padding-bottom:14px}.field-label label{display:block;width:1100px}input[type=text]{box-sizing:border-box;width:170px;height:34px;border:1px solid #ddd;padding:6px;margin-right:12px}.ivu-switch{width:44px;height:22px;border:0;border-radius:11px;background:#ccc;position:relative}.ivu-switch-checked{background:#2d8cf0}.ivu-switch:after{content:'';position:absolute;width:18px;height:18px;left:2px;top:2px;border-radius:50%;background:white}.ivu-switch-checked:after{left:24px}.ivu-checkbox-wrapper{display:inline-flex;gap:6px;align-items:center}.ivu-checkbox{width:14px;height:14px;border:1px solid #ccc}.ivu-checkbox.checked{background:#2d8cf0}.ivu-checkbox input{display:none}.rule{width:1100px;padding-bottom:100px}
</style><form><div class="row"><div class="field-label"><label>命中是否继续匹配后续规则</label></div><button id="continue" type="button" class="ivu-switch ${source?'ivu-switch-checked':''}"></button></div><div class="rule"><div class="field-label"><label>匹配规则</label></div><input type="text" id="key" name="key" value="severity"><input type="text" id="value" name="value" value="P[0-2]"><label class="ivu-checkbox-wrapper"><span class="ivu-checkbox ${source?'checked':''}"><input type="checkbox" id="regex" ${source?'checked':''}></span><span>正则表达式</span></label></div><button type="submit">创建</button></form><script>window.submits=0;window.textWrites=0;document.querySelector('form').onsubmit=e=>{e.preventDefault();window.submits++;};document.querySelectorAll('input[type=text]').forEach(node=>node.oninput=()=>window.textWrites++);document.getElementById('continue').onclick=e=>e.currentTarget.classList.toggle('ivu-switch-checked');document.getElementById('regex').onchange=e=>e.target.parentElement.classList.toggle('checked',e.target.checked);</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html(req.url==='/source'));});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context;
try {
  context=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.TEST_CHROMIUM,viewport:{width:1250,height:700},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto(`http://127.0.0.1:${server.address().port}/source`);
  const target=await context.newPage();await target.goto(`http://127.0.0.1:${server.address().port}/target`);
  await context.setOffline(true);
  await source.bringToFront();
  await worker.evaluate(()=>chrome.storage.local.set({captureLayout:'window'}));
  await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);globalThis.command('receive-screenshot',tab);},source.url());
  await source.locator('#local-screenshot-selection').waitFor({state:'attached'});
  // All label text, controls and state glyphs are inside; blank 1100px rows are not.
  await source.mouse.move(5,5);await source.mouse.down();await source.mouse.move(650,250,{steps:6});
  const popup=context.waitForEvent('page');await source.mouse.up();
  const panel=await popup;await panel.waitForURL(/panel.html\?mode=dock/);
  await panel.setViewportSize({width:390,height:850});
  await panel.waitForFunction(()=>document.getElementById('cancel').hidden && !document.getElementById('choose').disabled && document.querySelectorAll('.data-row').length>0,null,{timeout:120000});
  const capture=await panel.evaluate(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture);
  assert.equal(capture.sourceRows.find(row=>row.label==='命中是否继续匹配后续规则')?.checked,true,JSON.stringify(capture));
  assert.equal(capture.sourceRows.find(row=>row.label==='匹配规则')?.fields.find(child=>child.label==='正则表达式')?.checked,true,JSON.stringify(capture));
  await panel.locator('#workspace-details').evaluate(node=>node.open=true);
  // Explicitly review any OCR disagreement; DOM evidence is never silently adopted.
  await panel.getByRole('button',{name:'采用网页原值'}).evaluateAll(buttons=>buttons.forEach(button=>button.click()));
  for(const label of ['命中是否继续匹配后续规则','匹配规则']) {
    const index=await panel.locator('.field-label').evaluateAll((nodes,label)=>nodes.findIndex(node=>node.value===label),label);
    assert.ok(index>=0,`Missing source row ${label}`);
    await panel.locator('.data-row').nth(index).locator('[aria-label^="参与填写"]').check();
  }
  await target.bringToFront();
  await panel.locator('#fill').click();
  await panel.waitForFunction(()=>!document.getElementById('choose').disabled);
  assert.equal(await target.locator('#continue').evaluate(node=>node.classList.contains('ivu-switch-checked')),false,'State sync starts disabled');
  assert.equal(await target.locator('#regex').isChecked(),false);
  await panel.locator('#fill-options').evaluate(node=>node.open=true);
  await panel.locator('#sync-states').check();
  await panel.locator('#fill').click();
  await panel.waitForFunction(()=>!document.getElementById('choose').disabled);
  assert.equal(await target.locator('#continue').evaluate(node=>node.classList.contains('ivu-switch-checked')),true,await panel.locator('#matches').textContent());
  assert.equal(await target.locator('#regex').isChecked(),true,await panel.locator('#matches').textContent());
  assert.equal(await target.evaluate(()=>window.textWrites),0,'Existing matching key/value must not be rewritten');
  assert.equal(await target.evaluate(()=>window.submits),0);
  assert.equal(await target.locator('#key').inputValue(),'severity');
  assert.equal(await target.locator('#value').inputValue(),'P[0-2]');
  await target.locator('#continue').click();
  await target.locator('.ivu-checkbox-wrapper').click();
  await panel.locator('#dropzone').scrollIntoViewIfNeeded();
  const transfer=await panel.evaluateHandle(()=>new DataTransfer());
  await panel.locator('#dropzone').dispatchEvent('dragstart',{dataTransfer:transfer});
  const key=await transfer.evaluate(data=>data.getData('application/x-local-screenshot-field'));
  assert.ok(key);
  await panel.waitForFunction(async key=>(await chrome.storage.session.get('activeDrag')).activeDrag?.key===key,key);
  const session=await context.newCDPSession(target);
  const data={items:[{mimeType:'application/x-local-screenshot-field',data:key}],dragOperationsMask:1};
  for(const type of ['dragEnter','dragOver','drop']) await session.send('Input.dispatchDragEvent',{type,x:35,y:65,data});
  await session.detach();
  await target.waitForFunction(()=>document.getElementById('regex').checked && document.getElementById('continue').classList.contains('ivu-switch-checked'));
  assert.equal(await target.evaluate(()=>window.textWrites),0);
  assert.equal(await target.evaluate(()=>window.submits),0);
  assert.equal(await panel.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await mkdir(path.join(root,'test-artifacts'),{recursive:true});
  await target.screenshot({path:path.join(root,'test-artifacts/state-region-filled.png')});
  await panel.screenshot({path:path.join(root,'test-artifacts/state-region-panel.png'),fullPage:true});
  console.log('PASS: shortcut region excludes blank layout space, retains DOM switch and grouped regex state, offline OCR/review, one-click and trusted drop sync both states while preserving matching text; opt-in enforced, no submit, narrow panel');
} finally {await context?.close();await new Promise(resolve=>server.close(resolve));}
