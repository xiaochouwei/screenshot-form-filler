import test,{before,after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';

let browser,content;
before(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
  content=(await build({entryPoints:['src/content.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
});
after(async()=>{await browser?.close();});
async function setup(html) {
  const page=await browser.newPage({viewport:{width:1200,height:700}});
  await page.route('http://states.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
  await page.goto('http://states.test/');await page.setContent(html);
  await page.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{globalThis.handler=fn;}}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  await page.addScriptTag({content});return page;
}

test('state source bounds exclude empty label container space',async()=>{
  const page=await setup(`<style>body{margin:0}form{width:1180px}.field-label{width:100%;height:70px}.field-label label{display:block;width:100%;height:70px}.ivu-switch{width:44px;height:22px}</style><form><section><div class="field-label"><label>命中是否继续匹配后续规则</label></div><button type="button" class="ivu-switch ivu-switch-checked"></button></section><label class="ivu-checkbox-wrapper" style="display:block;width:1180px;height:60px"><input type="checkbox" checked>正则表达式</label></form>`);
  try {
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(source.rows.length,2,JSON.stringify(source));
    assert.ok(source.rows.every(row=>row.checked===true));
    assert.ok(source.rows.every(row=>row.bounds.x+row.bounds.width<600),'Both visible states fit a 600px selection although layout containers are wider');
    assert.ok(source.rows.every(row=>row.bounds.height<100),'Empty label padding is not screenshot evidence');
  } finally {await page.close();}
});

test('group source bounds use fields and label rather than the whole layout row',async()=>{
  const page=await setup(`<style>body{margin:0}.row{width:1180px;padding-bottom:100px}.field-label{height:25px}input[type=text]{width:150px}</style><form><div class="row"><div class="field-label"><label>匹配规则</label></div><input type="text" name="key" value="severity"><input type="text" name="value" value="P[0-2]"><label><input type="checkbox" checked>正则表达式</label></div></form>`);
  try {
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(source.rows[0].kind,'group');
    assert.ok(source.rows[0].bounds.width<650,'A cropped group must not include trailing row whitespace');
    assert.ok(source.rows[0].bounds.height<90,'A cropped group must not include bottom padding');
    assert.ok(source.rows[0].bounds.y<20,'The outer group caption must still be inside the required evidence bounds');
  } finally {await page.close();}
});

test('same existing key/value allow regex sync without rewriting the text inputs',async()=>{
  const page=await setup(`<form><div><label>匹配规则</label><input id="key" name="key" value="severity"><input id="value" name="value" value="P[0-2]"><label><input id="regex" type="checkbox">正则表达式</label></div></form>`);
  try {
    const rows=[{label:'匹配规则',kind:'group',value:'',confirmed:true,fields:[{label:'key',value:'severity',confirmed:true},{label:'value',value:'P[0-2]',confirmed:true},{label:'正则表达式',kind:'checkbox',value:'',checked:true,confirmed:true}]}];
    await page.evaluate(()=>{globalThis.writes=0;document.querySelectorAll('input:not([type=checkbox])').forEach(node=>node.oninput=()=>globalThis.writes++);});
    async function preview(syncStates) {
      const scan=await page.evaluate(()=>send({type:'SCAN'}));
      const plan=await page.evaluate(({scan,rows,syncStates})=>send({type:'PREVIEW',token:scan.token,scopeId:scan.scopes[0].id,rows,syncStates}),{scan,rows,syncStates});
      return {scan,plan};
    }
    const off=await preview(false);assert.equal(off.plan.plan[0].ready,false,'State sync still needs explicit opt in');
    const {scan,plan}=await preview(true);
    assert.equal(plan.plan[0].ready,true,JSON.stringify(plan));
    const result=await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:scan.token,previewId:plan.previewId});
    assert.equal(result.results[0].status,'filled',JSON.stringify(result));
    assert.equal(await page.locator('#regex').isChecked(),true);
    assert.equal(await page.evaluate(()=>globalThis.writes),0);
    await page.locator('#regex').uncheck();
    const stale=await preview(true);
    await page.locator('#key').fill('changed-after-preview');
    const refused=await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:stale.scan.token,previewId:stale.plan.previewId});
    assert.equal(refused.results[0].status,'skipped','Same occupancy but different raw text invalidates the state match');
    assert.equal(await page.locator('#regex').isChecked(),false);
    await page.locator('#regex').uncheck();await page.locator('#key').fill('different');
    const different=await preview(true);assert.equal(different.plan.plan[0].ready,false,'Different existing rules must not receive the state');
  } finally {await page.close();}
});
