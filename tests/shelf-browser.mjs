import {chromium} from 'playwright';
import {cp,readFile,writeFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
import http from 'node:http';

const root=path.resolve(import.meta.dirname,'..'),extension=path.join(root,'.shelf-extension');
await cp(path.join(root,'dist'),extension,{recursive:true});
const manifest=JSON.parse(await readFile(path.join(extension,'manifest.json'),'utf8'));
await writeFile(path.join(extension,'manifest.json'),JSON.stringify({...manifest,host_permissions:['http://127.0.0.1/*']}));
const content=await readFile(path.join(extension,'content.js'),'utf8');
await writeFile(path.join(extension,'content.js'),content.replace('host.attachShadow({ mode: "closed" })','host.attachShadow({ mode: "open" })'));
const html=`<!doctype html><meta charset="utf-8"><title>Shelf form</title><style>body{font:16px sans-serif;margin:0;padding:240px 30px 30px}form{padding:25px;border:1px solid #aaa;margin-bottom:20px}label{display:inline-block;width:110px}input,select{height:34px;width:240px}p{margin:12px 0}</style>
<form id="main"><h2>Primary</h2><p><label for="name">Name</label><input id="name"></p><p><label for="occupied">Existing</label><input id="occupied" value="keep"></p><p><label for="env">Environment</label><select id="env"><option value="">Choose</option><option value="p">Production</option></select></p><button>Submit</button></form>
<form id="other"><label for="othername">Name</label><input id="othername"></form><script>window.submitted=0;document.querySelectorAll('form').forEach(f=>f.onsubmit=e=>{e.preventDefault();window.submitted++});</script>`;
const dynamicHTML=`<!doctype html><meta charset="utf-8"><title>Dynamic form</title><style>body{font:16px sans-serif;padding:270px 25px 25px}form{border:1px solid #aaa;padding:25px}label{display:inline-block;width:100px}input{height:34px}section{margin:15px}button{margin:15px}</style><form id="dynamic"><h2>Dynamic</h2><label for="contacts">Contacts</label><select id="contacts" multiple><option>A Team</option><option>B Team</option></select><div id="rules"></div><button id="add" type="button">Add Filters</button><button>Submit</button></form><script>window.adds=0;window.submitted=0;document.querySelector('form').onsubmit=event=>{event.preventDefault();submitted++};document.getElementById('add').onclick=()=>{adds++;const row=document.createElement('section');row.innerHTML='<label>Filters</label><input name="key"><input name="value">';document.getElementById('rules').append(row);};</script>`;
const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html;charset=utf-8');if(req.url==='/csp')res.setHeader('Content-Security-Policy',"img-src 'self'; frame-src 'none'");res.end(req.url==='/dynamic'?dynamicHTML:html);});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let context,productionContext;
try {
 context=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:process.env.HEADED!=='1',viewport:{width:1200,height:950},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 context.setDefaultTimeout(15000);
 // Expose only the private shelf root for locators. Pointer and drop paths are unchanged.
 await context.addInitScript(()=>{const attach=Element.prototype.attachShadow;Element.prototype.attachShadow=function(options){return attach.call(this,this.id==='local-screenshot-shelf'?{...options,mode:'open'}:options);};});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');
 const seed=await context.newPage();await seed.goto(worker.url().replace('background.js','panel.html'));
 const showShelf=(target,inspector=seed)=>inspector.evaluate(async url=>{const [tab]=await chrome.tabs.query({url});await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});return chrome.tabs.sendMessage(tab.id,{type:'SHOW_SHELF',expanded:false});},target.url());
 const image=await seed.evaluate(()=>{const c=document.createElement('canvas');c.width=400;c.height=90;const x=c.getContext('2d');x.fillStyle='white';x.fillRect(0,0,400,90);x.fillStyle='black';x.font='20px sans-serif';x.fillText('Name: Alice',20,45);return c.toDataURL();});
 const rows=[{label:'Name',value:'Alice',confirmed:true},{label:'Existing',value:'replace',confirmed:true},{label:'Environment',value:'Production',confirmed:true}];
 const added=await seed.evaluate(async({image,rows})=>chrome.runtime.sendMessage({type:'HISTORY',action:{type:'add',capture:{id:crypto.randomUUID(),image,rows,status:'ready',info:'First'}}}),{image,rows});
 assert.equal(added.ok,true,JSON.stringify(added));
 const page=await context.newPage();await page.goto(`http://127.0.0.1:${server.address().port}/`);
 await showShelf(page);
 await page.locator('#local-screenshot-shelf').waitFor();
 await page.getByRole('button',{name:'展开图片架',exact:true}).click();
 const thumb=page.locator('#local-screenshot-shelf').locator('[data-capture-id]').first();
 await thumb.waitFor();
 // A complete pointer gesture: no dispatchEvent, DataTransfer injection, or CDP drop.
 const from=await thumb.boundingBox(),to=await page.locator('#main').boundingBox();
 await page.mouse.move(from.x+from.width/2,from.y+from.height/2);await page.mouse.down();
 await page.mouse.move(from.x+from.width/2+12,from.y+from.height/2+12,{steps:6});
 await page.mouse.move(to.x+to.width/2,to.y+30,{steps:35});await page.mouse.up();
 await page.waitForFunction(()=>document.getElementById('name').value==='Alice' && document.getElementById('env').value==='p');
 assert.equal(await page.locator('#env').inputValue(),'p');
 assert.equal(await page.locator('#occupied').inputValue(),'keep');
 assert.equal(await page.locator('#othername').inputValue(),'');
 assert.equal(await page.evaluate(()=>window.submitted),0);
 await page.locator('#name').fill('');await page.locator('#env').selectOption('');
 await seed.evaluate(async url=>{
   const [tab]=await chrome.tabs.query({url});
   await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
     const send=chrome.runtime.sendMessage.bind(chrome.runtime);let once=true;
     chrome.runtime.sendMessage=async message=>{
       if(once && message.type==='HISTORY' && message.action?.type==='get'){
         once=false;document.documentElement.dataset.delayedHistory='1';await new Promise(resolve=>setTimeout(resolve,500));
       }
       return send(message);
     };
   }});
 },page.url());
 await page.getByRole('button',{name:'开始填入',exact:true}).click();
 await page.locator('html[data-delayed-history]').waitFor();
 await page.evaluate(()=>history.pushState({},'', '/navigated'));
 await page.getByText('页面已变化，请重新选择后填写',{exact:true}).waitFor();
 assert.equal(await page.locator('#name').inputValue(),'','A pending fill must not follow SPA navigation');
 await page.getByRole('button',{name:'开始填入',exact:true}).click();
 await page.getByRole('combobox',{name:'目标表单',exact:true}).selectOption({index:1});
 await page.getByRole('button',{name:'开始填入',exact:true}).click();
 await page.waitForFunction(()=>document.getElementById('name').value==='Alice' && document.getElementById('env').value==='p');
 const second=await context.newPage();await second.goto(`http://127.0.0.1:${server.address().port}/second`);
 await showShelf(second);
 await second.getByRole('button',{name:'展开图片架',exact:true}).click();
 assert.equal(await second.locator('[data-capture-id]').count(),1);
 const scan=await seed.evaluate(async url=>{const [t]=await chrome.tabs.query({url});return chrome.tabs.sendMessage(t.id,{type:'SCAN'});},second.url());
 assert.equal(scan.fields.length,4,'Shelf inputs must never become source or target fields');
 await mkdir(path.join(root,'test-artifacts'),{recursive:true});
 await page.screenshot({path:path.join(root,'test-artifacts/shelf-desktop.png')});
 await second.setViewportSize({width:390,height:800});
 await second.screenshot({path:path.join(root,'test-artifacts/shelf-narrow.png')});
 assert.equal(await second.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
 // Restrictive page image/frame policies must not blank saved thumbnails or block button filling.
 const restricted=await context.newPage();await restricted.goto(`http://127.0.0.1:${server.address().port}/csp`);
 await showShelf(restricted);
 await restricted.getByRole('button',{name:'展开图片架',exact:true}).click();
 await restricted.locator('[data-capture-id] canvas').evaluate(async canvas=>{
   const end=Date.now()+5000;
   while(Date.now()<end){if(canvas.getContext('2d').getImageData(0,0,216,120).data.some((v,i)=>i%4===3 && v>0))return;await new Promise(r=>setTimeout(r,50));}
   throw Error('Saved thumbnail remained blank under page CSP');
 });
 await restricted.getByRole('combobox',{name:'目标表单',exact:true}).selectOption({index:1});
 await restricted.getByRole('button',{name:'开始填入',exact:true}).click();
 await restricted.waitForFunction(()=>document.getElementById('name').value==='Alice');
 const command=message=>seed.evaluate(async({url,message})=>{const [tab]=await chrome.tabs.query({url});return chrome.tabs.sendMessage(tab.id,message);},{url:restricted.url(),message});
 await restricted.locator('#name').fill('');
 await seed.evaluate(async url=>{
   const [tab]=await chrome.tabs.query({url});
   await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>{
     const send=chrome.runtime.sendMessage.bind(chrome.runtime);let once=true;
     chrome.runtime.sendMessage=async message=>{
       const result=await send(message);
       if(once && message.type==='HISTORY' && message.action?.type==='get'){
         once=false;document.documentElement.dataset.awaitingRevoke='1';await new Promise(r=>setTimeout(r,500));
       }
       return result;
     };
   }});
 },restricted.url());
 await restricted.getByRole('button',{name:'开始填入',exact:true}).click();
 await restricted.locator('html[data-awaiting-revoke]').waitFor();
 assert.equal((await command({type:'REVOKE_SHELF'})).ok,true);
 await restricted.locator('#local-screenshot-shelf').waitFor({state:'detached'});
 assert.equal((await command({type:'SCAN'})).ok,false,'Revoked receiver must reject scans');
 await seed.evaluate(()=>chrome.storage.local.set({syncStates:true}));
 assert.equal(await restricted.locator('#local-screenshot-shelf').count(),0,'Storage updates must not revive a revoked shelf');
 await restricted.waitForTimeout(650);
 assert.equal(await restricted.locator('#name').inputValue(),'','Pending button fill must stop after revocation');
 assert.equal((await command({type:'SHOW_SHELF',expanded:true})).ok,true);
 await restricted.locator('[data-capture-id]').waitFor();
 await seed.evaluate(()=>chrome.storage.local.set({syncStates:false}));
 // Verify the shipped closed shadow root with coordinates, without changing the bundle.
 productionContext=await chromium.launchPersistentContext('',{executablePath:process.env.TEST_CHROMIUM,headless:true,viewport:{width:1200,height:950},args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
 const productionWorker=productionContext.serviceWorkers()[0]||await productionContext.waitForEvent('serviceworker');
 await writeFile(path.join(extension,'content.js'),content);
 const productionSeed=await productionContext.newPage();await productionSeed.goto(productionWorker.url().replace('background.js','panel.html'));
 await productionSeed.evaluate(async({image,rows})=>chrome.runtime.sendMessage({type:'HISTORY',action:{type:'add',capture:{id:crypto.randomUUID(),image,rows,status:'ready',info:'Closed root'}}}),{image,rows});
 const closed=await productionContext.newPage();await closed.goto(`http://127.0.0.1:${server.address().port}/closed`);
 await showShelf(closed,productionSeed);
 await closed.locator('#local-screenshot-shelf').waitFor();
 assert.equal(await closed.locator('#local-screenshot-shelf').evaluate(host=>host.shadowRoot),null);
 let shelfBox=await closed.locator('#local-screenshot-shelf').boundingBox();
 await closed.mouse.click(shelfBox.x+shelfBox.width/2,shelfBox.y+16);
 await closed.waitForFunction(()=>document.getElementById('local-screenshot-shelf').getBoundingClientRect().height>180);
 await closed.screenshot({path:path.join(root,'test-artifacts/shelf-closed-before.png')});
 shelfBox=await closed.locator('#local-screenshot-shelf').boundingBox();
 await closed.mouse.move(shelfBox.x+68,shelfBox.y+90);await closed.mouse.down();
 await closed.mouse.move(shelfBox.x+85,shelfBox.y+110,{steps:6});
 await closed.mouse.move(400,290,{steps:30});await closed.mouse.up();
 await closed.waitForFunction(()=>document.getElementById('name').value==='Alice' && document.getElementById('env').value==='p');
 await closed.waitForFunction(()=>document.getElementById('local-screenshot-shelf').getBoundingClientRect().height>230);
 await closed.screenshot({path:path.join(root,'test-artifacts/shelf-closed-filled.png')});
 await writeFile(path.join(extension,'content.js'),content.replace('host.attachShadow({ mode: "closed" })','host.attachShadow({ mode: "open" })'));
 const dynamicRows=[{label:'Filters',kind:'group',value:'',confirmed:true,fields:[{label:'key',value:'host',confirmed:true},{label:'value',value:'server-1',confirmed:true}]},{label:'Contacts',value:'A Team\nB Team',confirmed:false,confirmation:'multi-layout',confidence:96}];
 await seed.evaluate(({image,rows})=>chrome.runtime.sendMessage({type:'HISTORY',action:{type:'add',capture:{id:crypto.randomUUID(),image,rows,status:'ready',info:'Dynamic'}}}),{image,rows:dynamicRows});
 const dynamic=await context.newPage();await dynamic.goto(`http://127.0.0.1:${server.address().port}/dynamic`);
 await showShelf(dynamic);
 await dynamic.getByRole('button',{name:'展开图片架',exact:true}).click();
 await seed.waitForFunction(async()=>(await chrome.storage.local.get('savedCapture')).savedCapture.rows.find(row=>row.label==='Contacts')?.confirmed===true);
 assert.equal(await dynamic.getByRole('checkbox',{name:'允许增项',exact:true}).isChecked(),false);
 await dynamic.getByRole('button',{name:'开始填入',exact:true}).click();
 await dynamic.waitForFunction(()=>document.getElementById('contacts').selectedOptions.length===2);
 await dynamic.getByRole('button',{name:'开始填入',exact:true}).waitFor({state:'visible'});
 await dynamic.waitForFunction(()=>!document.getElementById('local-screenshot-shelf').shadowRoot.querySelector('.primary').disabled);
 assert.equal(await dynamic.evaluate(()=>adds),0);
 await dynamic.getByRole('checkbox',{name:'允许增项',exact:true}).check();
 await dynamic.getByRole('button',{name:'开始填入',exact:true}).click();
 await dynamic.waitForFunction(()=>document.querySelector('[name=key]')?.value==='host' && document.querySelector('[name=value]')?.value==='server-1' && !document.getElementById('local-screenshot-shelf').shadowRoot.querySelector('.primary').disabled);
 await dynamic.screenshot({path:path.join(root,'test-artifacts/dynamic-shelf.png')});
 await dynamic.reload();await showShelf(dynamic);await dynamic.getByRole('button',{name:'展开图片架',exact:true}).click();
 await dynamic.getByRole('checkbox',{name:'允许增项',exact:true}).check();
 const dynamicThumb=await dynamic.locator('[data-capture-id][aria-pressed=true]').boundingBox(),dynamicForm=await dynamic.locator('#dynamic').boundingBox();
 await dynamic.mouse.move(dynamicThumb.x+50,dynamicThumb.y+35);await dynamic.mouse.down();await dynamic.mouse.move(dynamicThumb.x+65,dynamicThumb.y+50,{steps:5});await dynamic.mouse.move(dynamicForm.x+120,dynamicForm.y+80,{steps:30});await dynamic.mouse.up();
 await dynamic.waitForFunction(()=>document.querySelector('[name=key]')?.value==='host' && document.querySelector('[name=value]')?.value==='server-1' && !document.getElementById('local-screenshot-shelf').shadowRoot.querySelector('.primary').disabled);assert.equal(await dynamic.evaluate(()=>adds),1);assert.equal(await dynamic.evaluate(()=>submitted),0);
 const editor=await context.newPage();await editor.goto(worker.url().replace('background.js','panel.html?mode=dock'));
 await editor.waitForFunction(()=>document.querySelectorAll('.data-row').length===2);
 await editor.locator('#workspace-details').evaluate(node=>node.open=true);
 assert.equal(await editor.locator('#allow-add').isChecked(),false);
 await editor.locator('[aria-label="参与填写 2"]').uncheck();
 await editor.waitForFunction(async()=>(await chrome.storage.local.get('savedCapture')).savedCapture.rows[1].confirmation==='manual');
 await dynamic.reload();await dynamic.bringToFront();
 await editor.evaluate(()=>document.getElementById('scan').click());await editor.waitForFunction(()=>document.getElementById('scope').value);
 await editor.locator('#fill-options').evaluate(node=>node.open=true);
 await editor.locator('#allow-add').check();await dynamic.bringToFront();await editor.evaluate(()=>document.getElementById('fill').click());
 await dynamic.waitForFunction(()=>document.querySelector('[name=key]')?.value==='host' && document.querySelector('[name=value]')?.value==='server-1');
 await editor.waitForFunction(()=>!document.getElementById('fill').disabled && document.getElementById('summary').textContent==='1 项已写入');
 assert.equal(await dynamic.locator('#contacts').evaluate(node=>node.selectedOptions.length),0,'Manual multi exclusion must survive shelf/editor storage restore');
 assert.equal(await editor.locator('[aria-label="参与填写 2"]').isChecked(),false);
 await editor.screenshot({path:path.join(root,'test-artifacts/dynamic-editor.png'),fullPage:true});
 console.log('PASS: full pointer thumbnail drag, strict batch fill, target scope, occupied protection, button fallback, shared history, no submit, isolated shelf, narrow layout, CSP thumbnails/fill and revocation');
} finally {await productionContext?.close();await context?.close();await new Promise(resolve=>server.close(resolve));}
