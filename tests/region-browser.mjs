import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root=path.resolve(import.meta.dirname,'..');
const extension=path.join(root,'.region-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
// Native commands cannot be sent with page keyboard events. Capture uses a
// test-only all_urls grant; the production manifest retains activeTab only.
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
const background=await readFile(path.join(extension,'background.js'),'utf8');
await writeFile(path.join(extension,'background.js'),`const registerCommand=chrome.commands.onCommand.addListener.bind(chrome.commands.onCommand);chrome.commands.onCommand.addListener=fn=>{globalThis.testCommand=fn;registerCommand(fn);};
const capture=chrome.tabs.captureVisibleTab.bind(chrome.tabs);chrome.tabs.captureVisibleTab=async(...args)=>{globalThis.testSnapshot=await capture(...args);return globalThis.testSnapshot;};
chrome.runtime.onMessage.addListener(message=>{if(message.type==='REGION_CAPTURE')globalThis.testCrop=message.image;});\n${background}`);
await writeFile(path.join(extension,'inspector.html'),'<!doctype html><title>Capture verification</title>');
const fixture=await readFile(path.join(root,'tests/fixtures/stacked-form.png'));
const server=http.createServer((req,res)=>{
  if(req.url==='/image.png'){res.setHeader('Content-Type','image/png');res.end(fixture);return;}
  res.setHeader('Content-Type','text/html;charset=utf-8');
  res.end('<!doctype html><title>局部截图测试</title><style>body{margin:0;background:white}img{position:absolute;left:40px;top:40px;max-width:1100px}#outside{position:absolute;top:800px;background:#f00;width:150px;height:60px}</style><img src="/image.png"><div id="outside">OUTSIDE CROP</div>');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
let context;
try {
  context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,viewport:{width:1280,height:1000},deviceScaleFactor:1.5,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
  context.setDefaultTimeout(15000);
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id=new URL(worker.url()).host;
  await worker.evaluate(()=>chrome.storage.local.set({captureLayout:'window'}));
  const page=await context.newPage();
  const dialogs=[];
  page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.dismiss();});
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.locator('img').evaluate(img=>img.decode());
  const bounds=await page.locator('img').boundingBox();
  const command=async()=>{
    await page.bringToFront();
    await worker.evaluate(async url=>{
      const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);
      await chrome.windows.update(tab.windowId,{focused:true});
      await chrome.tabs.update(tab.id,{active:true});
      globalThis.testCommand('receive-screenshot',tab);
    },page.url());
    try { await page.locator('#local-screenshot-selection').waitFor({state:'attached'}); }
    catch(error) { console.error(await worker.evaluate(async()=>{const [tab]=await chrome.tabs.query({active:true,currentWindow:true});return chrome.action.getTitle({tabId:tab.id});})); throw error; }
    // Closed shadow intentionally hides screenshot pixels from page scripts.
    assert.equal(await page.locator('#local-screenshot-selection').evaluate(n=>n.shadowRoot),null);
  };
  await command();
  await page.keyboard.press('Escape');
  await page.locator('#local-screenshot-selection').waitFor({state:'detached'});
  assert.equal(await worker.evaluate(async()=>Object.keys(await chrome.storage.session.get(null)).filter(k=>k.startsWith('quickCapture-')).length),0,'Cancel must preserve prior capture');
  await page.waitForTimeout(600);
  await command();
  await page.evaluate(()=>history.replaceState(null,'','?view=changed'));
  await page.mouse.move(20,20);await page.mouse.down();await page.mouse.move(22,22);await page.mouse.up();
  assert.equal(await page.locator('#local-screenshot-selection').count(),1,'Tiny accidental click keeps selection open');
  await page.mouse.move(bounds.x+bounds.width,bounds.y+bounds.height);
  await page.mouse.down();await page.mouse.move(bounds.x,bounds.y,{steps:8});
  await mkdir(path.join(root,'test-artifacts'),{recursive:true});
  await page.screenshot({path:path.join(root,'test-artifacts/region-selection.png')});
  await page.mouse.up();
  await page.locator('#local-screenshot-selection').waitFor({state:'detached'});
  await page.waitForTimeout(1000);
  const windows=await worker.evaluate(()=>chrome.windows.getAll({populate:true,windowTypes:['popup']}));
  assert.equal(windows.filter(window=>window.tabs.some(tab=>tab.url?.endsWith('panel.html?mode=dock'))).length,1,`Real pointer release must open the compact window; dialogs=${JSON.stringify(dialogs)}; session=${JSON.stringify(await worker.evaluate(()=>chrome.storage.session.get(null)))}`);
  // A separate extension page can inspect session/local data without bringing
  // it to the front or replacing the selected source with a test screenshot.
  const inspect=await context.newPage();
  await inspect.goto(`chrome-extension://${id}/inspector.html`);
  let saved;
  const deadline=Date.now()+90000;
  do {
    saved=await inspect.evaluate(async()=> (await chrome.storage.local.get('savedCapture')).savedCapture);
    if(saved?.rows?.length===3) break;
    await new Promise(r=>setTimeout(r,200));
  } while(Date.now()<deadline);
  assert.deepEqual(saved.rows.map(r=>[r.label,r.value]),[
    ['项目名称','包头'],['Prometheus URL','http://10.0.0.21:30090'],['日志清理 URL','http://10.0.0.18:31180/'],
  ]);
  const images=await worker.evaluate(()=>({source:globalThis.testSnapshot,crop:globalThis.testCrop}));
  const pixels=await inspect.evaluate(async({images,bounds})=>{
    const load=async url=>{const img=new Image();img.src=url;await img.decode();return img;};
    const source=await load(images.source),crop=await load(images.crop);
    const sx=source.width/1280,sy=source.height/1000;
    const a=document.createElement('canvas'),b=document.createElement('canvas');
    a.width=b.width=crop.width;a.height=b.height=crop.height;
    a.getContext('2d').drawImage(source,-Math.round(bounds.x*sx),-Math.round(bounds.y*sy));
    b.getContext('2d').drawImage(crop,0,0);
    const first=a.getContext('2d').getImageData(0,0,a.width,a.height).data,second=b.getContext('2d').getImageData(0,0,b.width,b.height).data;
    return {same:first.every((n,i)=>n===second[i]),width:crop.width,height:crop.height,expectedWidth:Math.round(bounds.width*sx),expectedHeight:Math.round(bounds.height*sy)};
  },{images,bounds});
  assert.equal(pixels.same,true,'Crop pixels must exactly match the source without overlay or selection border');
  assert.equal(pixels.width,pixels.expectedWidth);assert.equal(pixels.height,pixels.expectedHeight);
  await inspect.goto(`chrome-extension://${id}/panel.html`);
  await inspect.waitForFunction(()=>document.querySelectorAll('.data-row').length===3);
  await inspect.setViewportSize({width:380,height:950});
  await inspect.screenshot({path:path.join(root,'test-artifacts/region-result.png'),fullPage:true});
  await page.waitForTimeout(600);
  await command();
  await worker.evaluate(async url=>{const tab=(await chrome.tabs.query({})).find(tab=>tab.url===url);globalThis.testCommand('receive-screenshot',tab);},page.url());
  await page.locator('#local-screenshot-selection').waitFor({state:'detached'});
  await page.waitForTimeout(600);
  await command();
  await page.setViewportSize({width:1180,height:900});
  await page.locator('#local-screenshot-selection').waitFor({state:'detached'});
  console.log('PASS: real captureVisibleTab, closed selection overlay, Escape, tiny selection, reverse drag, 1.5x pixel scale, compact popup from pointer release, automatic crop OCR and persistence');
} finally {await context?.close();await new Promise(r=>server.close(r));}
