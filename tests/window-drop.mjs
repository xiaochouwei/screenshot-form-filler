import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.window-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
const background=await readFile(path.join(extension,'background.js'),'utf8');
await writeFile(path.join(extension,'background.js'),`const register=chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);chrome.commands.onCommand.addListener=fn=>{globalThis.command=fn;register(fn);};\n${background}`);
const html=source=>`<!doctype html><meta charset="utf-8"><title>${source?'来源':'目标'}窗口</title><style>
body{font:15px "Microsoft YaHei",sans-serif;margin:25px;background:white}form{width:820px;border:1px solid #ccc;padding:20px}section{display:flex;align-items:center;gap:14px;margin:12px 0;min-height:32px}section>label{width:130px}input:not([type=checkbox]):not([type=radio]),select,.ivu-select{width:420px;min-height:32px}fieldset{border:1px solid #ccc;margin:10px 0}.ivu-select-dropdown{border:1px solid #ccc;background:white}.ivu-select-item{padding:8px;cursor:pointer}
</style><form id="target"><h2 id="heading">配置表单</h2>
<section><label for="name">名称</label><input id="name" value="${source?'曲靖saas':''}"></section>
<section><label for="environment">环境</label><select id="environment"><option value="">请选择</option><option value="prod" ${source?'selected':''}>生产</option><option value="test">测试</option></select></section>
<section><label for="contacts">电话联系人</label><select id="contacts" multiple><option value="primary" ${source?'selected':''}>值班主</option><option value="backup" ${source?'selected':''}>值班备</option></select></section>
<section><label for="notification">短信告警</label><input id="notification" type="checkbox" ${source?'checked':''}></section>
<section><label>继续匹配</label><button id="continue" type="button" role="switch" aria-label="继续匹配" aria-checked="${source?'true':'false'}">开关</button></section>
<fieldset><legend>告警等级</legend><label><input type="radio" name="severity" value="1" ${source?'checked':''}>P1</label><label><input type="radio" name="severity" value="2">P2</label></fieldset>
<section><label>Prometheus</label><div class="ivu-select" id="prom"><div class="ivu-select-selection"><span class="ivu-select-selected-value">${source?'生产监控':''}</span></div><ul class="ivu-select-dropdown" hidden><li class="ivu-select-item ${source?'ivu-select-item-selected':''}">生产监控</li><li class="ivu-select-item">测试监控</li></ul></div></section>
</form><form id="other"><label for="othername">名称</label><input id="othername"></form>
<script>document.getElementById('continue').onclick=e=>e.currentTarget.setAttribute('aria-checked',String(e.currentTarget.getAttribute('aria-checked')!=='true'));
const combo=document.getElementById('prom'),menu=combo.querySelector('ul');combo.onclick=e=>{if(e.target.matches('li')){combo.querySelector('span').textContent=e.target.textContent;menu.querySelectorAll('li').forEach(n=>n.classList.toggle('ivu-select-item-selected',n===e.target));menu.hidden=true;}else menu.hidden=!menu.hidden;};</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html(req.url==='/source'));});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let context;
try {
  context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,viewport:{width:1250,height:1000},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(20000);
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source=await context.newPage();await source.goto(`http://127.0.0.1:${server.address().port}/source`);
  const newTarget=context.waitForEvent('page');
  await worker.evaluate(url=>chrome.windows.create({url,width:1200,height:900}),`http://127.0.0.1:${server.address().port}/target`);
  const target=await newTarget;await target.waitForLoadState();
  await worker.evaluate(()=>chrome.storage.local.set({captureLayout:'window'}));
  await source.bringToFront();
  const bounds=await source.locator('#target').boundingBox();
  await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);await chrome.windows.update(tab.windowId,{focused:true});await chrome.tabs.update(tab.id,{active:true});globalThis.command('receive-screenshot',tab);},source.url());
  await source.locator('#local-screenshot-selection').waitFor({state:'attached'});
  await source.mouse.move(bounds.x,bounds.y);await source.mouse.down();await source.mouse.move(bounds.x+bounds.width,bounds.y+bounds.height,{steps:5});
  const popupEvent=context.waitForEvent('page');
  await source.mouse.up();
  const dock=await popupEvent;await dock.waitForURL(/panel.html\?mode=dock/);
  await dock.waitForFunction(()=>document.getElementById('cancel').hidden && !document.getElementById('paste').disabled && document.querySelectorAll('.data-row').length>=7,null,{timeout:90000});
  const capture=await dock.evaluate(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture);
  assert.equal(capture.rows.length,7,JSON.stringify(capture.rows));
  await dock.waitForFunction(()=>document.getElementById('dropzone').draggable);
  await dock.locator('#receiver').evaluate(node=>{node.add(new Option('未连接的其他网页','-9'));node.value='-9';node.dispatchEvent(new Event('change'));});
  assert.equal(await dock.locator('#dropzone').evaluate(node=>node.draggable),true,'A disconnected selection must not block dragging to other connected webpages');
  assert.equal(await dock.locator('#workspace-details').getAttribute('open'),null,'Compact window keeps detail rows collapsed');
  assert.equal(await dock.locator('#sync-states').isChecked(),false);
  const saved=await dock.evaluate(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture);
  assert.equal(saved.rows.find(r=>r.label==='名称').value,'曲靖saas');
  assert.deepEqual(saved.rows.find(r=>r.label==='电话联系人').values,['值班主','值班备']);
  assert.equal(saved.rows.find(r=>r.label==='短信告警').checked,true);
  assert.ok(!saved.rows.some(r=>r.label==='名称' && !r.value),'Outside form must not become a second source row');
  const drag=async(stripCustomKey=false)=>{
    await dock.locator('#dropzone').scrollIntoViewIfNeeded();
    await dock.locator('#dropzone').evaluate(node=>{
      window.nativeDrag=null;
      node.addEventListener('dragstart',event=>{window.nativeDrag={types:[...event.dataTransfer.types],key:event.dataTransfer.getData('application/x-local-screenshot-field'),trusted:event.isTrusted};},{once:true});
    });
    const imageBounds=await dock.locator('#image').boundingBox();
    await dock.mouse.move(imageBounds.x+imageBounds.width/2,imageBounds.y+imageBounds.height/2);
    await dock.mouse.down();
    await dock.mouse.move(imageBounds.x+imageBounds.width/2+35,imageBounds.y+imageBounds.height/2+10,{steps:6});
    await dock.waitForFunction(()=>window.nativeDrag?.key);
    const nativeDrag=await dock.evaluate(()=>window.nativeDrag);
    assert.equal(nativeDrag.trusted,true,'Source dragstart must be a real browser mouse event');
    assert.deepEqual(nativeDrag.types,['application/x-local-screenshot-field','text/plain']);
    const key=nativeDrag.key;
    const deadline=Date.now()+10000;
    while((await worker.evaluate(async()=> (await chrome.storage.session.get('activeDrag')).activeDrag?.key))!==key) {if(Date.now()>deadline)throw Error('Drag registration timeout');await new Promise(r=>setTimeout(r,30));}
    const session=await context.newCDPSession(target);
    const data={items:stripCustomKey?[{mimeType:'text/plain',data:`local-screenshot:${key}`}]:[{mimeType:'application/x-local-screenshot-field',data:key}],dragOperationsMask:1};
    if(stripCustomKey) {
      const ordinary={items:[{mimeType:'text/plain',data:'ordinary text'}],dragOperationsMask:1};
      await session.send('Input.dispatchDragEvent',{type:'dragEnter',x:150,y:70,data:ordinary});
      await session.send('Input.dispatchDragEvent',{type:'dragOver',x:150,y:70,data:ordinary});
      await session.send('Input.dispatchDragEvent',{type:'drop',x:150,y:70,data:ordinary});
      assert.equal((await worker.evaluate(async()=> (await chrome.storage.session.get('activeDrag')).activeDrag)).key,key,'Ordinary text cannot consume the screenshot token');
      assert.equal(await target.locator('html > div').evaluateAll(nodes=>nodes.some(node=>node.style.outline.includes('3px'))),false,'An unrelated drop clears the temporary hint');
    }
    await session.send('Input.dispatchDragEvent',{type:'dragEnter',x:150,y:70,data});
    await session.send('Input.dispatchDragEvent',{type:'dragOver',x:150,y:70,data});
    assert.equal(await target.locator('html > div').evaluateAll(nodes=>nodes.some(node=>node.style.outline.includes('3px'))),true,'Both native and plain-text fallback drags must show a receiving highlight');
    await mkdir(path.join(root,'test-artifacts'),{recursive:true});
    await target.screenshot({path:path.join(root,'test-artifacts/window-drop-highlight.png')});
    await session.send('Input.dispatchDragEvent',{type:'drop',x:150,y:70,data});
    await dock.mouse.up();
    await session.detach();return key;
  };
  await drag();
  try {await target.waitForFunction(()=>document.getElementById('name').value==='曲靖saas' && document.getElementById('prom').querySelector('span').textContent==='生产监控');}
  catch(error) {console.error(await dock.locator('#status').textContent(),await dock.locator('#matches').textContent(),await worker.evaluate(()=>chrome.storage.session.get('activeDrag')));throw error;}
  assert.equal(await target.locator('#environment').inputValue(),'prod');
  assert.deepEqual(await target.locator('#contacts').evaluate(node=>[...node.selectedOptions].map(o=>o.value)),['primary','backup']);
  assert.equal(await target.locator('#notification').isChecked(),false);
  assert.equal(await target.locator('#continue').getAttribute('aria-checked'),'false');
  assert.equal(await target.locator('[name=severity]:checked').inputValue(),'1');
  assert.equal(await target.locator('#othername').inputValue(),'','Drop stays in the form under the pointer');
  await dock.locator('#workspace-details').evaluate(node=>node.open=true);
  assert.equal(await dock.locator('#fill').isVisible(),true,'Compact window must expose the direct fill command');
  await target.locator('#name').fill('');
  await dock.locator('#scan').click();
  await dock.locator('#scope').selectOption({index:1});
  await dock.locator('#match').click();
  await dock.locator('#fill').click();
  await target.waitForFunction(()=>document.getElementById('name').value==='曲靖saas');
  assert.equal(await target.locator('#name').inputValue(),'曲靖saas','Direct fill uses the selected target form');
  await dock.locator('#workspace-details').evaluate(node=>node.open=true);
  await dock.locator('#fill-options').evaluate(node=>node.open=true);
  await dock.locator('#sync-states').check();
  await drag(true);
  await target.waitForFunction(()=>document.getElementById('notification').checked && document.getElementById('continue').getAttribute('aria-checked')==='true');
  await dock.waitForFunction(()=>document.getElementById('status').textContent.includes('拖拽'));
  await target.screenshot({path:path.join(root,'test-artifacts/window-drop-filled.png')});
  await dock.setViewportSize({width:360,height:540});
  assert.equal(await dock.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await dock.screenshot({path:path.join(root,'test-artifacts/window-drop-dock.png'),fullPage:true});
  await dock.evaluate(async()=>{const {savedCapture}=await chrome.storage.local.get('savedCapture');const rows=savedCapture.rows.filter(row=>typeof row.checked==='boolean').map(row=>({...row,value:'',checked:false}));await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'update',id:savedCapture.id,revision:savedCapture.revision,patch:{rows}}});});
  await dock.reload();
  await dock.waitForFunction(()=>document.querySelectorAll('.data-row').length===2 && document.getElementById('dropzone').draggable);
  await drag();
  await target.waitForFunction(()=>!document.getElementById('notification').checked && document.getElementById('continue').getAttribute('aria-checked')==='false');
  await dock.evaluate(async()=>{
    const {savedCapture}=await chrome.storage.local.get('savedCapture');
    await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'update',id:savedCapture.id,revision:savedCapture.revision,patch:{rows:[{label:'名称',value:'stale',confirmed:true}]}}});
  });
  await dock.reload();await dock.waitForFunction(()=>document.querySelectorAll('.data-row').length===1);
  await target.locator('#name').fill('');await target.bringToFront();
  await dock.evaluate(()=>document.getElementById('scan').click());
  await dock.waitForFunction(()=>document.getElementById('scope').options.length>1);
  await dock.locator('#workspace-details').evaluate(node=>node.open=true);
  await dock.selectOption('#scope',{index:1});
  await dock.evaluate(()=>{
    const send=chrome.tabs.sendMessage.bind(chrome.tabs);
    chrome.tabs.sendMessage=async(...args)=>{
      const result=await send(...args);
      if(args[1].type==='PREVIEW'){
        const {savedCapture}=await chrome.storage.local.get('savedCapture');
        await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'delete',id:savedCapture.id}});
      }
      return result;
    };
    document.getElementById('fill').click();
  });
  await dock.waitForFunction(()=>document.getElementById('status').textContent.includes('截图已变化'));
  assert.equal(await target.locator('#name').inputValue(),'','Deletion during preview must prevent stale detailed-editor fill');
  console.log('PASS: real region snapshot with selected DOM values -> compact popup -> one-use trusted drop in second browser window; correct form only; native/custom select, multi-select, radio; checkbox/switch sync opt-in; narrow dock');
} finally {await context?.close();await new Promise(r=>server.close(r));}
