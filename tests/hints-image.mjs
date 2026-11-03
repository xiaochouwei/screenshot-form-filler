import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.hints-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
let context;
try {
  context=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.TEST_CHROMIUM,viewport:{width:1400,height:650},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const source=await context.newPage();
  await source.route('http://hints.test/source',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:`<!doctype html><meta charset="utf-8"><style>body{font:18px Arial,"Microsoft YaHei",sans-serif;margin:30px;background:white}section{display:flex;align-items:center;gap:16px;margin:25px 0}label{width:80px}input,select{box-sizing:border-box;height:42px;border:1px solid #d5d7d8;border-radius:3px;font:18px Arial,sans-serif;padding:8px}input{width:650px}.parameter input{width:230px}.parameter select{width:100px}.hint{color:#777}</style>
    <p role="note">环境说明　　　　　　　本页按所选条件进行分发</p><form>
    <section><label for="path">路径</label><input id="path" value="/profiles/*" aria-describedby="validation"><span class="hint">支持多个条件进行组合</span></section>
    <section class="parameter"><label>参数</label><input placeholder="参数名"><select><option value="">等于</option></select><input placeholder="参数值"><span>根据参数组合决定处理策略</span></section>
    <section><label for="remark">备注</label><input id="remark" value="profile-cache"><span class="helper-text">profile-cache</span></section>
    </form><p id="validation">路径说明　　　　　　　仅支持预定的字符格式</p>`}));
  await source.goto('http://hints.test/source');
  const snapshot=await worker.evaluate(async url=>{
    const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    return chrome.tabs.sendMessage(tab.id,{type:'SOURCE',geometry:true},{frameId:0});
  },source.url());
  assert.equal(snapshot.rows.length,2,JSON.stringify(snapshot));
  const buffer=await source.screenshot(),image=`data:image/png;base64,${buffer.toString('base64')}`;
  await mkdir(path.join(root,'test-artifacts'),{recursive:true});
  await writeFile(path.join(root,'test-artifacts/hints-source.png'),buffer);
  await worker.evaluate(({image,snapshot})=>chrome.storage.session.set({dockCapture:{id:crypto.randomUUID(),tabId:1,windowId:1,image,rows:snapshot.rows,emptyControlBounds:snapshot.emptyControlBounds,expiresAt:Date.now()+120000}}),{image,snapshot});
  const panel=await context.newPage();
  await context.setOffline(true);
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html?mode=dock`);
  await panel.waitForFunction(()=>document.getElementById('cancel').hidden && document.getElementById('status').textContent.includes('已识别'),null,{timeout:90000});
  const saved=await panel.evaluate(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture);
  assert.deepEqual(saved.rows.map(row=>[row.label,row.value,row.source,!!row.alternative]),[['路径','/profiles/*','image+web',false],['备注','profile-cache','image+web',false]]);
  const raw=await panel.locator('#raw').inputValue();
  for(const hint of ['环境说明','支持多个条件','参数名','参数值','根据参数组合','路径说明']) assert.ok(!raw.includes(hint),raw);
  assert.equal(raw.split('profile-cache').length-1,1,'Actual input survives; identical helper text is masked');
  const target=await context.newPage();
  await target.route('http://hints.test/target',route=>route.fulfill({contentType:'text/html;charset=utf-8',body:'<!doctype html><meta charset="utf-8"><form><label for="path">路径</label><input id="path"><label for="remark">备注</label><input id="remark"><label for="param">参数</label><input id="param"></form>'}));
  await target.goto('http://hints.test/target');
  const result=await worker.evaluate(async({url,rows})=>{
    const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);
    await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const send=message=>chrome.tabs.sendMessage(tab.id,message,{frameId:0});
    const scan=await send({type:'SCAN'}),preview=await send({type:'PREVIEW',token:scan.token,scopeId:scan.scopes[0].id,rows});
    return send({type:'FILL',token:scan.token,previewId:preview.previewId});
  },{url:target.url(),rows:saved.rows});
  assert.equal(result.results.filter(row=>row.status==='filled').length,2,JSON.stringify(result));
  assert.equal(await target.locator('#path').inputValue(),'/profiles/*');
  assert.equal(await target.locator('#remark').inputValue(),'profile-cache');
  assert.equal(await target.locator('#param').inputValue(),'');
  console.log('PASS: real offline screenshot OCR and fill excludes row/page help and unlabeled multi-control placeholders; identical real value survives');
} finally {await context?.close();}
