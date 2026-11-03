import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
try {
  const page=await browser.newPage();
  await page.route('http://multi.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8">'}));
  await page.goto('http://multi.test/');
  await page.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{globalThis.handler=fn;}},sendMessage:async message=>{globalThis.dropResult=message;return {ok:true};}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  const content=await readFile(new URL('../dist/content.js',import.meta.url),'utf8');
  async function setup(kind,names=['值班组-主','值班组-备'],delay=0) {
    await page.setContent('<style>[hidden]{display:none!important} [role=combobox],.ivu-select,.el-select,.ant-select{min-height:32px} [role=option]{padding:8px}</style><form><div id="field"></div><button type="submit">提交</button></form>');
    await page.evaluate(({kind,names,delay})=>{
      globalThis.submitted=false;globalThis.selectionClicks=0;
      document.querySelector('form').onsubmit=event=>{event.preventDefault();globalThis.submitted=true;};
      const host=document.getElementById('field');
      if(kind==='native') {
        const label=document.createElement('label');label.htmlFor='contacts';label.textContent='电话联系人';
        const node=document.createElement('select');node.id='contacts';node.multiple=true;
        for(const [index,name] of names.entries()) node.append(new Option(name,String(index+1)));
        host.append(label,node);return;
      }
      const configs={ivu:['ivu-select ivu-select-multiple','ivu-select-selection','ivu-select-dropdown','ivu-select-item','ivu-tag-text'],el:['el-select','el-select__wrapper','el-select-dropdown','el-select-dropdown__item','el-tag__content'],ant:['ant-select ant-select-multiple','ant-select-selector','ant-select-dropdown','ant-select-item-option','ant-select-selection-item']};
      const [ownerClass,triggerClass,popupClass,itemClass,tagClass]=configs[kind];
      const owner=document.createElement('div');owner.id='contacts';owner.className=ownerClass;owner.setAttribute('aria-label','电话联系人');
      const trigger=document.createElement('div');trigger.className=triggerClass;trigger.textContent='请选择电话联系人';
      if(kind==='el') {const tags=document.createElement('div');tags.className='el-select__tags';trigger.append(tags);}
      owner.append(trigger);host.append(owner);
      trigger.onclick=()=>{
        const existing=document.getElementById('options');if(existing){existing.hidden=false;return;}
        const popup=document.createElement('div');popup.id='options';popup.className=popupClass;popup.setAttribute('role','listbox');popup.setAttribute('aria-multiselectable','true');document.body.append(popup);
        const populate=()=>names.forEach((name,index)=>{
          const option=document.createElement('div');option.className=itemClass;option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.textContent=name;
          option.onclick=()=>{globalThis.selectionClicks++;option.setAttribute('aria-selected','true');const tag=document.createElement('span');tag.className=tagClass;tag.textContent=name;trigger.append(tag);popup.hidden=true;};
          popup.append(option);
        });
        if(delay) setTimeout(populate,delay);else populate();
      };
    },{kind,names,delay});
    // setContent uses document.open: reinstall document event listeners as a navigation would.
    await page.evaluate(()=>delete globalThis.__localScreenshotFillerInstalled);
    await page.addScriptTag({content});
  }
  async function fill(value,pending=false) {
    const scan=await page.evaluate(()=>send({type:'SCAN'}));
    const preview=await page.evaluate(({value,token,scopeId,pending})=>send({type:'PREVIEW',token,scopeId,rows:[{label:'电话联系人',value,confirmed:!pending,...(pending?{confidence:96,confirmation:'multi-layout'}:{})}]}),{value,token:scan.token,scopeId:scan.scopes[0].id,pending});
    const result=await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:scan.token,previewId:preview.previewId});
    return {preview,result};
  }
  for(const kind of ['native','ivu','el','ant']) {
    await setup(kind,undefined,kind==='ant'?180:0);
    const {preview,result}=await fill('值班组-主 值班组-备');
    assert.equal(preview.plan[0].ready,true,`${kind}: ${JSON.stringify(preview)}`);
    assert.equal(result.results[0].status,'filled',`${kind}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.results[0].values,['值班组-主','值班组-备']);
    assert.equal(await page.evaluate(()=>globalThis.submitted),false);
    if(kind==='native') assert.deepEqual(await page.locator('#contacts').evaluate(node=>[...node.selectedOptions].map(option=>option.label)),['值班组-主','值班组-备']);
    else assert.equal(await page.evaluate(()=>globalThis.selectionClicks),2);
  }
  for(const names of [['A','B','A B'],['A','B']]) {
    await setup('ivu',names);
    const {result}=await fill(names.length===3?'A B':'A missing');
    assert.equal(result.results[0].status,'failed');
    assert.equal(await page.evaluate(()=>globalThis.selectionClicks),0,'Validate every complete option before the first selection');
  }
  for(const kind of ['native','ivu','el','ant']){
    await setup(kind,undefined,kind==='ant'?180:0);
    const {preview,result}=await fill('值班组-主\n值班组-备',true);
    assert.equal(preview.plan[0].ready,true,`${kind}: layout-only uncertainty can be checked against exact options`);
    assert.equal(result.results[0].status,'filled',`${kind}: ${JSON.stringify(result)}`);
    assert.deepEqual(result.results[0].values,['值班组-主','值班组-备']);
  }
  await setup('native',['East Team','West Team']);
  assert.equal((await fill('East Team West Team')).result.results[0].status,'filled');
  assert.equal((await fill('East Team')).result.results[0].status,'skipped','Existing selections must be preserved');
  await setup('ivu');
  await page.evaluate(async()=>{
    globalThis.dropResult=null;
    const handle=document.createElement('button');handle.id='drag-source';handle.textContent='截图';handle.draggable=true;
    handle.ondragstart=event=>event.dataTransfer.setData('application/x-local-screenshot-field','multi-text-drag');document.body.append(handle);
    await send({type:'ARM_DRAG',index:-1,key:'multi-text-drag',rows:[{label:'电话联系人',value:'值班组-主 值班组-备',confirmed:true}]});
  });
  await page.locator('#drag-source').dragTo(page.locator('#contacts'));
  await page.waitForFunction(()=>globalThis.dropResult).catch(async error=>{console.log(await page.evaluate(()=>({result:globalThis.dropResult,html:document.body.innerHTML})));throw error;});
  assert.ok(await page.evaluate(()=>dropResult.results),JSON.stringify(await page.evaluate(()=>dropResult)));
  assert.equal(await page.evaluate(()=>dropResult.results[0].status),'filled');
  assert.deepEqual(await page.evaluate(()=>dropResult.results[0].values),['值班组-主','值班组-备']);
  console.log('PASS: one-line OCR → native/iView/Element/Ant multi-select; lazy/async options, re-opened menus, exact labels with internal spaces, readback, no partial selection on ambiguity or missing values, existing selections preserved, no submit');
} finally {await browser.close();}
