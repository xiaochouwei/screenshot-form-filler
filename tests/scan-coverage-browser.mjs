import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';

const script=(await build({entryPoints:['src/content.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
try{
  const page=await browser.newPage();
  await page.setContent('<form id="main"><div><label>Arbitrary caption</label><input id="data"><input type="button" value="Help"></div><div role="textbox" contenteditable="true" aria-label="Rich text">Text</div><div role="slider" aria-label="Volume"></div><div><label>A</label><label>B</label><input id="ambiguous"></div><input type="hidden" value="meta"></form><label>Outside<input></label><iframe srcdoc="<input aria-label=Inside>"></iframe>');
  await page.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>globalThis.handler=fn}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  await page.addScriptTag({content:script});
  let scan=await page.evaluate(()=>send({type:'SCAN'}));
  assert.ok(scan.fields.some(field=>field.label==='Arbitrary caption' && field.supported),'An adjacent action input must not erase a clear caption');
  for(const label of ['Rich text','Volume'])assert.ok(scan.fields.some(field=>field.label===label && !field.supported && field.reason),'Unsupported semantic controls must appear with an explanation');
  assert.ok(scan.fields.some(field=>!field.label && field.reason==='没有明确字段标签'));
  assert.equal(scan.coverage.logicalFields,scan.fields.length);
  assert.equal(scan.coverage.supported+scan.coverage.unsupported,scan.fields.length);
  assert.equal(scan.coverage.frames.length,1);assert.equal(scan.coverage.frames[0].status,'not-scanned');
  assert.equal(scan.scopes.reduce((sum,scope)=>sum+scope.count,0),scan.fields.length);
  assert.equal(scan.coverage.stable,true);
  const baseline=scan.fields.length;
  await page.evaluate(()=>{
    const semantic=document.createElement('div');semantic.setAttribute('role','spinbutton');semantic.setAttribute('aria-label','Quantity');semantic.innerHTML='<input value="5">';document.getElementById('main').append(semantic);
    const host=document.createElement('div');document.body.append(host);host.attachShadow({mode:'open'}).innerHTML='<form><label>Shadow caption<input></label></form>';
  });
  scan=await page.evaluate(()=>send({type:'SCAN'}));
  assert.equal(scan.fields.length,baseline+2,'Unsupported semantic wrappers must not expose a second plain-input writer');
  assert.ok(scan.fields.some(field=>field.label==='Shadow caption' && field.supported));
  assert.ok(scan.fields.some(field=>field.label==='Quantity' && !field.supported));
  scan=await page.evaluate(async()=>{
    document.getElementById('main').setAttribute('aria-busy','true');
    setTimeout(()=>{const label=document.createElement('label');label.textContent='Delayed';label.append(document.createElement('input'));document.getElementById('main').append(label);document.getElementById('main').removeAttribute('aria-busy');},350);
    return send({type:'SCAN'});
  });
  assert.ok(scan.fields.some(field=>field.label==='Delayed'),'Wait for rendering before declaring a stable scan');
  const unstable=await page.evaluate(async()=>{document.getElementById('main').setAttribute('aria-busy','true');return send({type:'SCAN'});});
  assert.equal(unstable.coverage.stable,false);
  const preview=await page.evaluate(scan=>send({type:'PREVIEW',token:scan.token,scopeId:scan.scopes[0].id,rows:[{label:'Arbitrary caption',value:'test',confirmed:true}]}),unstable);
  assert.equal(preview.ok,false,'An unsettled scan cannot authorize filling');
  const revoked=await page.evaluate(async()=>{
    document.getElementById('main').removeAttribute('aria-busy');
    const pending=send({type:'SCAN'});
    await new Promise(resolve=>setTimeout(resolve,50));
    await send({type:'REVOKE_SHELF'});
    await send({type:'SHOW_SHELF'});
    return pending;
  });
  assert.equal(revoked.ok,false,'Reauthorization must not resurrect a scan begun before revocation');
  assert.equal((await page.evaluate(()=>send({type:'SCAN'}))).ok,true,'A fresh authorized scan remains available');
  const loadingPage=await browser.newPage();
  await loadingPage.setContent('<main aria-busy="true" style="min-height:100px">Loading</main>');
  await loadingPage.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>globalThis.handler=fn}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  await loadingPage.addScriptTag({content:script});
  const initiallyEmpty=await loadingPage.evaluate(()=>{
    setTimeout(()=>{document.querySelector('main').innerHTML='<form><label>Later caption<input></label></form>';document.querySelector('main').removeAttribute('aria-busy');},350);
    return send({type:'SCAN'});
  });
  assert.ok(initiallyEmpty.fields.some(field=>field.label==='Later caption'),'Visible loading outside a not-yet-rendered form must delay the scan');
  console.log('PASS: generic captions, semantic unsupported inventory, scope/total counts, frame gaps and bounded stable rendering scan');
}finally{await browser.close();}
