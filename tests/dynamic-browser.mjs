import {chromium} from 'playwright';
import {readFile,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';

const root=path.resolve(import.meta.dirname,'..');
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
try{
 const page=await browser.newPage({viewport:{width:1100,height:850}});
 await page.goto('about:blank');
 await page.evaluate(()=>{
   globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>globalThis.handler=fn}}};
   globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
 });
 await page.addScriptTag({content:await readFile(path.join(root,'dist/content.js'),'utf8')});
 const row=(label='Filters')=>({label,kind:'group',value:'',confirmed:true,fields:[{label:'key',value:'host',confirmed:true},{label:'value',value:'server-1',confirmed:true}]});
 const fixture=async(mode='normal')=>{
   await page.setContent(`<style>body{font:16px sans-serif;padding:24px}form{border:1px solid #aaa;padding:18px;margin:15px}section{margin:15px}label{display:inline-block;width:100px}input{height:30px}button{margin:10px}</style><form id="main"><h2>Primary</h2><label for="base">Base</label><input id="base"><div id="rows"></div><button type="${mode==='submit'?'submit':'button'}" id="add">+ Add Filters</button>${mode==='ambiguous'?'<button type="button">Add Filters</button>':''}</form><form id="other"><h2>Other</h2><label for="other-base">Base</label><input id="other-base"><button type="button">Add Filters</button></form>`);
   await page.evaluate(mode=>{
     window.adds=0;window.submits=0;
     document.querySelectorAll('form').forEach(form=>form.onsubmit=event=>{event.preventDefault();window.submits++;});
     const add=document.getElementById('add');if(mode==='disabled')add.disabled=true;
     add.onclick=()=>{
       window.adds++;
       if(mode==='nothing')return;
       if(mode==='navigate'){history.pushState({},'','#changed');return;}
       const insert=()=>{const section=document.createElement('section');section.innerHTML='<label>Filters</label><input name="key"><input name="value">';document.getElementById('rows').append(section);};
       if(mode==='delayed')setTimeout(insert,180);else insert();
     };
   },mode);
 };
 const plan=async(rows,allowAdd=false)=>page.evaluate(async({rows,allowAdd})=>{const scan=await send({type:'SCAN'});const preview=await send({type:'PREVIEW',token:scan.token,scopeId:(scan.scopes.find(scope=>scope.name==='Primary') || scan.scopes[0]).id,rows,allowAdd});return {scan,preview};},{rows,allowAdd});
 const fill=({scan,preview})=>page.evaluate(({scan,preview})=>send({type:'FILL',token:scan.token,previewId:preview.previewId}),{scan,preview});
 await fixture();let p=await plan([row()]);assert.equal(p.preview.plan[0].ready,false);await fill(p);assert.equal(await page.evaluate(()=>adds),0);
 p=await plan([row()],true);assert.equal(p.preview.plan[0].ready,true,'Opt-in should plan the uniquely named add entry');
 assert.equal(await page.evaluate(()=>adds),0,'Preview must never add rows');
 let result=await fill(p);assert.equal(result.results[0].status,'filled',JSON.stringify(result));
 assert.equal(await page.locator('#main [name=key]').inputValue(),'host');assert.equal(await page.locator('#main [name=value]').inputValue(),'server-1');
 assert.equal(await page.locator('#other section').count(),0);assert.equal(await page.evaluate(()=>adds),1);assert.equal(await page.evaluate(()=>submits),0);
 await fill(await plan([row()],true));assert.equal(await page.evaluate(()=>adds),1,'Repeated fill must not append over an existing same-name group');
 await mkdir(path.join(root,'test-artifacts'),{recursive:true});await page.screenshot({path:path.join(root,'test-artifacts/dynamic-filled.png')});
 for(const mode of ['ambiguous','submit','disabled']){
   await fixture(mode);p=await plan([row()],true);assert.equal(p.preview.plan[0].ready,false,mode);await fill(p);assert.equal(await page.evaluate(()=>adds),0,mode);
 }
 await fixture();await fill(await plan([{...row(),confirmed:false}],true));assert.equal(await page.evaluate(()=>adds),0);
 for(const state of [{selected:false,review:'ready'},{selected:true,review:'conflict'}]){
   await fixture();await fill(await plan([{...row(),...state}],true));assert.equal(await page.evaluate(()=>adds),0,'New state must override stale legacy confirmed flags before adding');
 }
 await fixture();await fill(await plan([row(),row()],true));assert.equal(await page.evaluate(()=>adds),0,'Duplicate source labels cannot create rows');
 for(const markup of ['<input type="submit" role="button" aria-label="Add Filters">','<input type="reset" role="button" aria-label="Add Filters">','<div role="button" aria-label="Add Filters"><button>Submit</button></div>','<label role="button" aria-label="Add Filters" for="submitter">Add Filters</label><input id="submitter" type="submit">']){
   await fixture();await page.evaluate(markup=>{document.getElementById('add').remove();document.getElementById('rows').innerHTML=markup;},markup);
   p=await plan([row()],true);assert.equal(p.preview.plan[0].ready,false,markup);await fill(p);assert.equal(await page.evaluate(()=>submits),0);
 }
 await fixture('delayed');result=await fill(await plan([row()],true));assert.equal(result.results[0].status,'filled',JSON.stringify(result));
 await fixture('nothing');result=await fill(await plan([row()],true));assert.equal(await page.evaluate(()=>adds),1);assert.ok(result.results.every(item=>item.status!=='filled'));
 await fixture();await page.evaluate(()=>{document.getElementById('add').onclick=()=>{adds++;const dialog=document.createElement('dialog');dialog.innerHTML='<section><label>Filters</label><input name="key"><input name="value"></section>';document.getElementById('main').append(dialog);dialog.showModal();};});
 result=await fill(await plan([row()],true));assert.ok(result.results.every(item=>item.status!=='filled'),'Opening a native modal must not be mistaken for adding a row');assert.equal(await page.locator('dialog [name=key]').inputValue(),'');
 await fixture('navigate');result=await fill(await plan([row()],true));assert.ok(result.results.every(item=>item.status!=='filled'));assert.equal(await page.evaluate(()=>adds),1);
 await fixture();await page.locator('#base').evaluate(node=>{node.previousElementSibling.remove();node.remove();});
 result=await fill(await plan([row()],true));assert.equal(result.results[0].status,'filled','An empty form with a clear add entry still needs a target scope');
 await fixture();await page.evaluate(()=>{
   const add=document.getElementById('add');add.textContent='Add';add.setAttribute('aria-controls','rows');document.getElementById('rows').setAttribute('aria-label','Filters');
 });
 result=await fill(await plan([row()],true));assert.equal(result.results[0].status,'filled','An explicit region reference can name a generic Add button');
 await fixture();await page.evaluate(()=>{document.getElementById('add').onclick=()=>adds++;});
 p=await plan([row()],true);await page.locator('#add').evaluate(node=>{node.textContent='Delete Filters';});await fill(p);assert.equal(await page.evaluate(()=>adds),0,'Changed add identity must not be clicked');
 await fixture();await page.evaluate(()=>{
   document.getElementById('add').remove();
   for(let index=0;index<6;index++){
     const button=document.createElement('button');button.type='button';button.textContent=`Add Field ${index}`;button.onclick=()=>{adds++;const section=document.createElement('section');section.innerHTML=`<label>Field ${index}</label><input name="key"><input name="value">`;document.getElementById('rows').append(section);};document.getElementById('main').append(button);
   }
 });
 result=await fill(await plan(Array.from({length:6},(_,index)=>row(`Field ${index}`)),true));assert.equal(await page.evaluate(()=>adds),5);assert.equal(result.results.filter(item=>item.status==='filled').length,5);
 await page.setContent('<form><label for="contacts">Contacts</label><select id="contacts" multiple><option>A Team</option><option>B Team</option></select></form>');
 const pending={label:'Contacts',value:'A Team\nB Team',confirmed:false,confidence:97,confirmation:'multi-layout'};
 p=await plan([pending]);assert.equal(p.preview.plan[0].ready,true,'Unique complete multi options should confirm layout-only uncertainty');
 result=await fill(p);assert.equal(result.results[0].status,'filled');assert.deepEqual(await page.locator('#contacts').evaluate(node=>[...node.selectedOptions].map(o=>o.textContent)),['A Team','B Team']);
 await page.locator('#contacts').selectOption([]);
 for(const source of [{...pending,confirmation:'manual'},{...pending,confidence:70},{...pending,alternative:{label:'Contacts',value:'other',confirmed:true}},{...pending,value:'A Team\nmissing'}]){
   p=await plan([source]);assert.equal(p.preview.plan[0].ready,false,JSON.stringify(source));
 }
 console.log('PASS: opt-in dynamic group creation, exact add label/scope, preview without clicks, repeated/ambiguous/submit/disabled protection, async creation, stop on failure/navigation; multi default confirmation preserves manual exclusion');
}finally{await browser.close();}
