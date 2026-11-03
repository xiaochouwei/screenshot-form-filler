import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.shelf-processing-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['<all_urls>']}));
const content=await readFile(path.join(extension,'content.js'),'utf8');
await writeFile(path.join(extension,'content.js'),content.replace('host.attachShadow({ mode: "closed" })','host.attachShadow({ mode: "open" })'));
const html=`<!doctype html><meta charset="utf-8"><title>Capture source</title><style>body{background:white;font:18px Arial;margin:0;padding:270px 40px}form{width:700px;padding:30px;border:1px solid #aaa}label{display:inline-block;width:130px}input{width:400px;height:38px;font:18px Arial;padding:4px;border:1px solid #555}p{margin:20px 0}</style><form><p><label for="name">Name</label><input id="name" value="Alice"></p><p><label for="city">City</label><input id="city" value="Shanghai"></p></form>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');res.end(html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context;
try{
 context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,viewport:{width:1200,height:900},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.setDefaultTimeout(20000);
 const remote=[];context.on('request',request=>{if(/^https?:/.test(request.url()) && !request.url().startsWith('http://127.0.0.1:'))remote.push(request.url());});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const inspector=await context.newPage();await inspector.goto(worker.url().replace('background.js','panel.html'));
 const waitHistory=async predicate=>{const deadline=Date.now()+150000;let count=0;while(Date.now()<deadline){const h=await inspector.evaluate(async()=>(await chrome.storage.local.get('screenshotHistory')).screenshotHistory);if(h && predicate(h))return h;if(++count%40===0)console.log('Waiting for OCR:',h?.items.map(i=>({id:i.id,status:i.status,error:i.error})),await page.locator('#local-screenshot-shelf output').textContent());await new Promise(resolve=>setTimeout(resolve,250));}throw Error('History timeout');};
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
 const showShelf=()=>inspector.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});return chrome.tabs.sendMessage(tab.id,{type:'SHOW_SHELF',expanded:false});},page.url());
 await showShelf();
 await page.evaluate(()=>{
   window.leakedFiles=0;
   for(const type of ['paste','drop'])window.addEventListener(type,event=>{window.leakedFiles+=(event.clipboardData?.files.length || event.dataTransfer?.files.length || 0);},true);
 });
 page.on('console',message=>{if(message.type()==='error')console.error(message.text());});
 await page.getByRole('button',{name:'展开图片架',exact:true}).click();
 await context.setOffline(true);
 await page.getByRole('button',{name:'截图',exact:true}).click();
 await page.locator('#local-screenshot-selection').waitFor({state:'attached'});
 const box=await page.locator('form').boundingBox();
 await page.mouse.move(box.x-2,box.y-2);await page.mouse.down();await page.mouse.move(box.x+box.width+2,box.y+box.height+2,{steps:12});await page.mouse.up();
 let state;
 try{state=await waitHistory(h=>h.items.length===1 && h.items[0].status!=='processing');}
 catch(error){console.error('Shelf:',await page.locator('#local-screenshot-shelf output').textContent());console.error('Contexts:',await worker.evaluate(()=>chrome.runtime.getContexts({})));throw error;}
 assert.equal(state.items[0]?.status,'ready',JSON.stringify(state));
 assert.equal(state.items[0].rows.find(r=>r.label==='Name')?.value,'Alice');
 assert.equal(state.items[0].rows.find(r=>r.label==='City')?.value,'Shanghai');
 assert.ok(state.items[0].rows.some(r=>r.source==='image+web'),'OCR must corroborate captured DOM evidence');
 assert.equal(context.pages().filter(p=>p.url().includes('mode=dock')).length,0,'Capture should stay in the page without a popup');
 // Import a standalone PNG: no source DOM can assist this record.
 const png=await page.locator('form').screenshot();
 const inbox=page.frameLocator('iframe[title="图片接收区"]');
 await inbox.locator('body').evaluate((body,base64)=>{
   const bytes=Uint8Array.from(atob(base64),character=>character.charCodeAt(0));
   const transfer=new DataTransfer();transfer.items.add(new File([bytes],'external.png',{type:'image/png'}));
   body.dispatchEvent(new ClipboardEvent('paste',{clipboardData:transfer,bubbles:true,composed:true}));
 },png.toString('base64'));
 state=await waitHistory(h=>h.items.length===2 && h.items[0].status!=='processing');
 assert.equal(state.items[0].status,'ready',JSON.stringify(state.items[0]));
 assert.equal(state.items[0].sourceRows.length,0);
 assert.equal(state.items[0].rows.find(r=>r.label==='Name')?.value,'Alice');
 assert.ok(state.items[0].rows.every(r=>r.source==='image'));
 assert.equal(await page.evaluate(()=>window.leakedFiles),0,'Native image paste in the extension inbox must not reach host-page capture listeners');
 const id=state.items[0].id;
 await page.locator('#name').fill('');await page.locator('#city').fill('');
 await page.getByRole('button',{name:'开始填入',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('name').value==='Alice' && document.getElementById('city').value==='Shanghai');
 await context.setOffline(false);await page.reload();await showShelf();await page.getByRole('button',{name:'展开图片架',exact:true}).click();
 await page.locator(`[data-capture-id="${id}"]`).waitFor();
 await page.getByRole('button',{name:'删除所选图片',exact:true}).click();
 await waitHistory(h=>h.items.length===1);
 assert.notEqual((await inspector.evaluate(async()=>(await chrome.storage.local.get('savedCapture')).savedCapture)).id,id);
 await page.locator('#local-screenshot-shelf input[type=file]').setInputFiles({name:'cancel.png',mimeType:'image/png',buffer:png});
 const pending=await waitHistory(h=>h.items.length===2 && h.items[0].status==='processing');
 const canceledId=pending.items[0].id;
 await page.getByRole('button',{name:'删除所选图片',exact:true}).click();
 await page.getByText('截图已删除，请重新选择',{exact:true}).waitFor({timeout:120000});
 state=await waitHistory(h=>h.items.length===1);
 assert.ok(!state.items.some(item=>item.id===canceledId),'Late OCR must never resurrect a deleted screenshot');
 assert.deepEqual(remote,[],'Offscreen OCR must not make cloud requests');
 await mkdir(path.join(root,'test-artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'test-artifacts/shelf-recognition.png')});
 console.log('PASS: in-page region capture -> offscreen local OCR+DOM corroboration; external image -> image-only OCR -> fill; no popup; shared persistent history and deletion');
}finally{await context?.close();await new Promise(resolve=>server.close(resolve));}
