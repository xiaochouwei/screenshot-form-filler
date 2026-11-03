import {chromium} from 'playwright';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
try {
  const page=await browser.newPage();
  await page.route('http://labels.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><title>Labels</title>'}));
  await page.goto('http://labels.test/');
  await page.setContent(`<form>
    <div class="ant-form-item"><div class="ant-form-item-label"><label class="ant-form-item-required" for="name">名称</label></div><div class="ant-form-item-control"><input id="actual-name" placeholder="请输入名称"></div></div>
    <div class="ant-form-item"><div class="ant-form-item-label"><label for="priority">优先级</label></div><div><input id="actual-priority" type="number"></div></div>
    <div class="ant-form-item"><div class="ant-form-item-label"><label>Prometheus</label></div><div class="ant-select"><input id="custom" role="combobox"></div></div>
    <div class="ant-form-item"><div class="ant-form-item-label"><label>第一标签</label><label>第二标签</label></div><input id="ambiguous"></div>
    <div class="form-item"><label class="form-label">匹配规则</label><input id="key"><input id="value"></div>
    <div class="form-item"><span class="form-label">标签</span><input id="single"></div>
    <input id="placeholder-only" placeholder="字段名称">
  </form>`);
  await page.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{globalThis.handler=fn;}}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  await page.addScriptTag({content:await readFile(new URL('../dist/content.js',import.meta.url),'utf8')});
  const scan=await page.evaluate(()=>send({type:'SCAN'}));
  assert.deepEqual(scan.fields.map(f=>f.label),['名称','优先级','Prometheus','','','','标签','']);
  const preview=await page.evaluate(({token,scopeId})=>send({type:'PREVIEW',token,scopeId,rows:[
    {label:'名称',value:'曲靖saas',confirmed:false},
    {label:'优先级',value:'20',confirmed:true},
    {label:'Prometheus',value:'曲靖生产Prometheus',confirmed:true},
    {label:'# 电话联系人',value:'test',confirmed:true},
  ]}),{token:scan.token,scopeId:scan.scopes[0].id});
  assert.match(preview.plan[0].reason,/勾选/,'Recognized same-name field must explain selection, not missing label');
  assert.equal(preview.plan[1].ready,true);
  assert.equal(preview.plan[2].ready,true,'Framework selection is validated after opening its option list');
  assert.equal(preview.plan[3].ready,false,'OCR punctuation is never normalized into a match');
  const fill=await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:scan.token,previewId:preview.previewId});
  assert.equal(fill.results[1].status,'filled');
  assert.equal(fill.results[2].status,'failed','Missing options must not write into the search input');
  assert.equal(await page.locator('#actual-priority').inputValue(),'20');
  assert.equal(await page.locator('#actual-name').inputValue(),'');
  const approved=await page.evaluate(({token,scopeId})=>send({type:'PREVIEW',token,scopeId,rows:[{label:'名称',value:'曲靖saas',confirmed:true}]}),{token:scan.token,scopeId:scan.scopes[0].id});
  await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:scan.token,previewId:approved.previewId});
  assert.equal(await page.locator('#actual-name').inputValue(),'曲靖saas');
  // No framework class whitelist: the relationship must survive arbitrary
  // container names, separate label wrappers and browser-generated controls.
  await page.setContent(`<form>
    <div class="unknown-row"><label>名称</label><div><div><input id="generic-name" placeholder="请输入名称"></div></div></div>
    <div class="ivu-form-item"><label class="ivu-form-item-label">优先级</label><div class="ivu-form-item-content"><input type="hidden" value="metadata"><span><input id="generic-priority" type="number"></span></div></div>
    <section><div><span class="custom-field-label">地址</span></div><div><input id="generic-address"></div></section>
    <div><label>Prometheus</label><div class="ivu-select"><input id="generic-combo"></div></div>
    <div><label>匹配规则</label><input id="generic-key"><input id="generic-value"></div>
    <div><label>标签甲</label><label>标签乙</label><input id="generic-ambiguous"></div>
    <div><div class="field-label"><label for="elsewhere">别人的标签</label></div><input id="generic-unrelated"></div>
    <div><label for="elsewhere">明确关联</label><input id="elsewhere"></div>
    <div><p>普通说明文字</p><input id="generic-help" placeholder="名称"></div>
    <div><span class="custom-label">重复名称</span><input id="duplicate-a"></div>
    <div><span class="custom-label">重复名称</span><input id="duplicate-b"></div>
  </form>`);
  const generic=await page.evaluate(()=>send({type:'SCAN'}));
  assert.deepEqual(generic.fields.map(f=>f.label),['名称','','优先级','地址','Prometheus','','','','','','','重复名称','重复名称']);
  const genericPreview=await page.evaluate(({token,scopeId})=>send({type:'PREVIEW',token,scopeId,rows:[
    {label:'名称',value:'通用名称',confirmed:true},
    {label:'优先级',value:'20',confirmed:true},
    {label:'地址',value:'http://example.test/',confirmed:true},
    {label:'Prometheus',value:'production',confirmed:true},
    {label:'匹配规则',value:'severity',confirmed:true},
    {label:'普通说明文字',value:'no',confirmed:true},
    {label:'重复名称',value:'no',confirmed:true},
  ]}),{token:generic.token,scopeId:generic.scopes[0].id});
  assert.deepEqual(genericPreview.plan.map(p=>p.ready),[true,true,true,true,false,false,false]);
  await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:generic.token,previewId:genericPreview.previewId});
  assert.equal(await page.locator('#generic-name').inputValue(),'通用名称');
  assert.equal(await page.locator('#generic-priority').inputValue(),'20');
  assert.equal(await page.locator('#generic-address').inputValue(),'http://example.test/');
  for(const id of ['generic-combo','generic-key','generic-value','generic-ambiguous','generic-unrelated','elsewhere','generic-help','duplicate-a','duplicate-b']) assert.equal(await page.locator(`#${id}`).inputValue(),'');
  await page.setContent('<div id="remote-label" style="position:absolute;left:20px;top:20px">区域标签</div><input aria-labelledby="remote-label" value="原值" style="position:absolute;left:300px;top:200px">');
  const snapshot=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
  assert.equal(snapshot.rows[0].label,'区域标签');
  assert.equal(snapshot.rows[0].bounds.x,20);
  assert.equal(snapshot.rows[0].bounds.y,20);
  assert.ok(snapshot.rows[0].bounds.width>280 && snapshot.rows[0].bounds.height>180,'Source bounds must contain the referenced ARIA label as well as input');
  await page.setContent('<form><label for="plain">名称</label><input id="plain" value="原值"><div><label>搜索下拉</label><div class="ant-select"><div class="ant-select-selector"><input value="搜索中"></div></div></div></form>');
  const searching=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
  assert.equal(searching.ok,true);
  assert.deepEqual(searching.rows.map(row=>[row.label,row.value]),[['名称','原值']],'An unselected dropdown search must not invalidate other source values');
  await page.setContent('<form><label for="blank">参数</label><input id="blank" placeholder="请输入参数名"><label for="filled">服务</label><input id="filled" value="h5"></form>');
  const placeholders=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
  const blank=await page.locator('#blank').boundingBox();
  assert.deepEqual(placeholders.rows.map(row=>[row.label,row.value]),[['服务','h5']]);
  assert.ok(placeholders.emptyControlBounds.some(box=>Math.abs(box.x-blank.x)<1 && Math.abs(box.width-blank.width)<1));
  const ivu = source => `<style>.ivu-select{display:block;width:320px;min-height:32px}.ivu-select-selection{min-height:32px}.ivu-switch{width:45px;height:24px}[hidden]{display:none!important}</style><form>
    <div class="ivu-form-item"><label class="ivu-form-item-label">电话联系人</label><div class="ivu-form-item-content"><div class="ivu-select ivu-select-multiple"><div class="ivu-select-selection"><span class="ivu-tag"><span class="ivu-tag-text">${source ? '值班主' : ''}</span></span><span class="ivu-tag"><span class="ivu-tag-text">${source ? '值班备' : ''}</span></span></div><div class="ivu-select-dropdown" hidden><div class="ivu-select-item">值班主</div><div class="ivu-select-item">值班备</div></div></div></div></div>
    <div class="ivu-form-item"><label class="ivu-form-item-label">Prometheus</label><div class="ivu-form-item-content"><div class="ivu-select"><div class="ivu-select-selection"><span class="ivu-select-selected-value">${source ? '生产监控' : ''}</span></div><div class="ivu-select-dropdown" hidden><div class="ivu-select-item">生产监控</div><div class="ivu-select-item">测试监控</div></div></div></div></div>
    <div class="ivu-form-item"><label class="ivu-form-item-label">继续匹配后续规则</label><div class="ivu-form-item-content"><button type="button" class="ivu-switch ${source ? 'ivu-switch-checked' : ''}"><span class="ivu-switch-inner"></span></button></div></div>
  </form>`;
  await page.setContent(ivu(true));
  const ivuRows=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
  assert.equal(ivuRows.ok,true);
  assert.deepEqual(ivuRows.rows.map(row=>[row.label,row.kind,row.value,row.values,row.checked]),[
    ['电话联系人','multi-combobox','值班主\n值班备',['值班主','值班备'],undefined],
    ['Prometheus','combobox','生产监控',undefined,undefined],
    ['继续匹配后续规则','switch','',undefined,true],
  ]);
  await page.setContent(ivu(false));
  await page.evaluate(()=>{
    document.querySelectorAll('.ivu-select').forEach(select=>{
      const popup=select.querySelector('.ivu-select-dropdown');
      select.querySelector('.ivu-select-selection').onclick=()=>{popup.hidden=false;};
      popup.querySelectorAll('.ivu-select-item').forEach(item=>item.onclick=()=>{
        const selected=[...select.querySelectorAll('.ivu-tag-text,.ivu-select-selected-value')].find(node=>!node.textContent);
        selected.textContent=item.textContent;
        item.classList.add('ivu-select-item-selected');
        popup.hidden=true;
      });
    });
    document.querySelector('.ivu-switch').onclick=e=>e.currentTarget.classList.toggle('ivu-switch-checked');
  });
  const ivuScan=await page.evaluate(()=>send({type:'SCAN'}));
  const ivuPreview=await page.evaluate(({rows,token,scopeId})=>send({type:'PREVIEW',rows,token,scopeId,syncStates:true}),{rows:ivuRows.rows,token:ivuScan.token,scopeId:ivuScan.scopes[0].id});
  assert.deepEqual(ivuPreview.plan.map(entry=>entry.ready),[true,true,true],JSON.stringify({plan:ivuPreview.plan,fields:ivuScan.fields}));
  const ivuFill=await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:ivuScan.token,previewId:ivuPreview.previewId});
  assert.deepEqual(ivuFill.results.map(result=>result.status),['filled','filled','filled']);
  assert.equal(await page.locator('.ivu-switch').evaluate(node=>node.classList.contains('ivu-switch-checked')),true);
  await page.setContent(`<form>
    <div class="field-row"><div class="field-label"><label for="contact-search">电话联系人</label></div><div class="field-control"><div class="ivu-select"><div class="ivu-select-selection"><input id="contact-search" readonly></div><div class="ivu-select-dropdown" hidden><div class="ivu-select-item">值班主</div></div></div></div></div>
    <div class="field-row"><div class="field-label"><label for="rank"><span>*</span>优先级</label></div><div class="field-control"><div class="ivu-input-number"><input id="rank" type="text" role="spinbutton"></div></div></div>
  </form>`);
  const nested=await page.evaluate(()=>send({type:'SCAN'}));
  assert.equal(nested.fields.find(field=>field.kind==='combobox')?.label,'电话联系人');
  const rank=nested.fields.find(field=>field.label==='优先级');
  assert.equal(rank?.kind,'number');
  assert.equal(rank.supported,true);
  const rankPreview=await page.evaluate(({token,scopeId})=>send({type:'PREVIEW',token,scopeId,rows:[{label:'优先级',value:'20',confirmed:true}]}),{token:nested.token,scopeId:nested.scopes[0].id});
  assert.equal(rankPreview.plan[0].ready,true);
  const rankFill=await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:nested.token,previewId:rankPreview.previewId});
  assert.equal(rankFill.results[0].status,'filled');
  assert.equal(await page.locator('#rank').inputValue(),'20');
  await page.setContent('<form><div class="ivu-select"><span class="visible-selection">真实选择值</span></div><div class="ivu-select"><span class="ivu-select-placeholder">请选择</span></div></form>');
  const customMask=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
  const selected=await page.locator('.visible-selection').boundingBox();
  const placeholder=await page.locator('.ivu-select-placeholder').boundingBox();
  const covers=(box,rect)=>box.x<rect.x+rect.width && box.x+box.width>rect.x && box.y<rect.y+rect.height && box.y+box.height>rect.y;
  assert.ok(!customMask.emptyControlBounds.some(box=>covers(box,selected)),'Unknown custom selection must remain visible to OCR');
  assert.ok(customMask.emptyControlBounds.some(box=>covers(box,placeholder)),'Explicit placeholder can be excluded from OCR');
  console.log('PASS: nested label containers, generic labels, confirmation gate, exact names, missing dropdown options, ambiguous labels, multi-input rows and ARIA source bounds');
} finally {await browser.close();}
