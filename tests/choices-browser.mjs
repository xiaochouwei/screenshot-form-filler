import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { build } from 'esbuild';

const compiled = await build({ entryPoints: ['src/controls.js'], bundle:true, write:false, format:'iife', globalName:'choices' });
const browser = await chromium.launch({executablePath:process.env.CHROMIUM_PATH || 'C:/Users/96266/AppData/Local/ms-playwright/chromium-1243/chrome-win64/chrome.exe',headless:true});
const page = await browser.newPage();
try {
  await page.setContent(`<style>[hidden]{display:none!important} input,select{min-height:20px} [role],.ivu-select,.el-select,.ant-select{min-height:24px} .popup{border:1px solid}</style>
    <input id="secret" type="password"><input id="hidden" type="hidden">
    <label>Enabled<input id="check" type="checkbox"></label>
    <button id="switch" role="switch" aria-label="Sync" aria-checked="false" onclick="this.setAttribute('aria-checked',this.getAttribute('aria-checked')==='true'?'false':'true')">toggle</button>
    <fieldset id="radio"><legend>Mode</legend><label><input type="radio" name="mode" value="a">A</label><label><input type="radio" name="mode" value="b">B</label></fieldset>
    <select id="single"><option value="">Choose</option><option value="a">A</option><option value="b">B</option></select>
    <select id="multiple" multiple><option value="a">A</option><option value="b">B</option><option value="c" disabled>C</option></select>
    <select id="duplicate"><option value="">Choose</option><option value="a">A</option><option value="b" disabled>A</option></select>
    <select id="revert" onchange="this.value='' "><option value="">Choose</option><option>A</option></select>
    <div id="aria" role="combobox" aria-controls="aria-popup" onclick="document.getElementById('aria-popup').hidden=false"></div>
    <div id="aria-popup" role="listbox" hidden><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false">B</div></div>
    <div id="aria-multi" role="listbox" aria-multiselectable="true"><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false">B</div></div>
    <div id="ivu" class="ivu-select"><div class="ivu-select-selection"><span class="ivu-select-placeholder">Choose</span><span class="ivu-select-selected-value"></span></div></div>
    <div id="el" class="el-select"><div class="el-select__wrapper"><span class="el-select__selected-item el-select__placeholder is-transparent">Choose</span><span class="el-select__selected-item el-select__placeholder value"></span><input placeholder="Search"></div></div>
    <div id="ant" class="ant-select"><div class="ant-select-selector"><span class="ant-select-selection-placeholder">Choose</span><span class="ant-select-selection-item"></span><input role="combobox" aria-label="search"></div></div>
    <div id="ambiguous" class="ant-select"><div class="ant-select-selector">Choose</div></div>
    <button id="save" onclick="window.saved=true">Save</button>`);
  await page.addScriptTag({content:compiled.outputFiles[0].text});
  await page.evaluate(() => {
    for (const option of document.querySelectorAll('[role="option"]')) option.onclick = () => {
      const popup = option.parentElement;
      if (popup.getAttribute('aria-multiselectable') !== 'true') for (const sibling of popup.children) sibling.setAttribute('aria-selected','false');
      option.setAttribute('aria-selected', option.getAttribute('aria-selected') === 'true' ? 'false' : 'true');
    };
    for (const [id,popupClass,itemClass,selected] of [['ivu','ivu-select-dropdown','ivu-select-item','.ivu-select-selected-value'],['el','el-select-dropdown','el-select-dropdown__item','.value'],['ant','ant-select-dropdown','ant-select-item-option','.ant-select-selection-item']]) {
      const owner=document.getElementById(id);
      const popup=document.createElement('div'); popup.className=popupClass; popup.hidden=true;
      for (const value of ['A','B']) { const item=document.createElement('div'); item.className=itemClass; item.textContent=value; item.onclick=()=>{owner.querySelector(selected).textContent=value;popup.hidden=true;};popup.append(item); }
      document.body.append(popup); owner.firstElementChild.onclick=()=>popup.hidden=false;
    }
    document.querySelector('#ambiguous .ant-select-selector').onclick=()=>{
      for(let i=0;i<2;i++){const popup=document.createElement('div');popup.className='ant-select-dropdown';popup.innerHTML='<div class="ant-select-item-option">A</div>';document.body.append(popup);}
    };
  });
  const run = (id,entry) => page.evaluate(async ({id,entry}) => {try {return {ok:true,value:await choices.writeChoice(document.getElementById(id),entry)};} catch(error){return {ok:false,error:error.message};}}, {id,entry});
  const ids = await page.evaluate(()=>choices.controlNodes(document).map(node=>node.id));
  assert.ok(ids.includes('secret') && ids.includes('hidden'));
  assert.equal(ids.filter(id=>id==='radio').length,1);
  assert.equal(ids.includes('aria-popup'),false);
  assert.equal(await page.evaluate(()=>choices.choiceLabel(document.getElementById('radio'))),'Mode');
  assert.equal(await page.evaluate(()=>choices.choiceLabel(document.getElementById('check'))),'Enabled');
  assert.equal((await run('check',{checked:true})).ok,false);
  assert.equal((await run('check',{checked:true,syncStates:true})).ok,true);
  assert.equal((await run('check',{checked:false,syncStates:true})).ok,true);
  await page.evaluate(()=>document.getElementById('check').indeterminate=true);
  assert.equal((await run('check',{checked:true,syncStates:true})).ok,false);
  assert.equal((await run('switch',{checked:true,syncStates:true})).ok,true);
  assert.equal((await run('radio',{value:'A'})).ok,true);
  assert.equal((await run('radio',{value:'B'})).ok,false);
  assert.equal((await run('radio',{value:'B',syncStates:true})).ok,true);
  assert.equal((await run('single',{value:'A'})).ok,true);
  assert.equal((await run('single',{value:'B',syncStates:true})).ok,false);
  assert.equal((await run('multiple',{value:'A,B'})).ok,false);
  assert.equal((await run('multiple',{values:['A','C']})).ok,false);
  assert.equal((await run('multiple',{values:['A','B']})).ok,true);
  assert.equal((await run('duplicate',{value:'A'})).ok,false);
  assert.equal((await run('revert',{value:'A'})).ok,false);
  for(const id of ['aria','ivu','el','ant']) {
    const result=await run(id,{value:'B'}); assert.equal(result.ok,true,`${id}: ${result.error}`);
    assert.equal((await run(id,{value:'A'})).ok,false);
  }
  assert.equal((await run('aria-multi',{values:['A','B']})).ok,true);
  assert.equal((await run('ambiguous',{value:'A'})).ok,false);
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `<form onsubmit="event.preventDefault();window.saved=true"><button id="submit-switch" role="switch" aria-checked="false">Dangerous default button</button></form>
      <div id="mixed" role="checkbox" aria-checked="mixed">Mixed</div>
      <fieldset id="bad-radio"><legend>Bad</legend><label><input type="radio" name="x">A</label><label><input type="radio" name="y">B</label></fieldset>
      <div id="searched" class="ant-select"><div class="ant-select-selector"><input value="search query"></div></div>
      <div id="custom-duplicate" role="listbox"><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false" aria-disabled="true">A</div></div>
      <div id="ant-multi" class="ant-select ant-select-multiple"><div class="ant-select-selector"><span class="ant-select-selection-placeholder">Choose</span></div><div role="listbox" aria-multiselectable="true"><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false">B</div></div></div>
      <div id="ivu-multi" class="ivu-select ivu-select-multiple"><div class="ivu-select-selection"></div><div role="listbox" aria-multiselectable="true"><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false">B</div></div></div>
      <div id="el-multi" class="el-select"><div class="el-select__wrapper"><div class="el-select__tags"></div></div><div role="listbox" aria-multiselectable="true"><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false">B</div></div></div>`;
    document.body.append(fixture);
    for (const id of ['ant-multi','ivu-multi','el-multi']) {
      const owner = document.getElementById(id);
      for (const option of owner.querySelectorAll('[role="option"]')) option.onclick = () => {
        option.setAttribute('aria-selected','true');
        const tag = document.createElement('span');
        tag.className = id === 'ant-multi' ? 'ant-select-selection-item' : id === 'ivu-multi' ? 'ivu-tag-text' : 'el-tag__content';
        tag.textContent=option.textContent; owner.firstElementChild.append(tag);
      };
    }
  });
  for (const id of ['mixed','submit-switch']) assert.equal((await run(id,{checked:true,syncStates:true})).ok,false,id);
  for (const id of ['bad-radio','searched','custom-duplicate']) assert.equal((await run(id,{value:'A'})).ok,false,id);
  for (const id of ['ant-multi','ivu-multi','el-multi']) {
    const result = await run(id,{values:['A','B']}); assert.equal(result.ok,true,`${id}: ${result.error}`);
    assert.equal((await run(id,{values:['A'],syncStates:true})).ok,false,id);
  }
  await page.evaluate(() => {
    const fixture = document.createElement('div');
    fixture.innerHTML = `<label id="ivu-check" class="ivu-checkbox-wrapper"><span class="ivu-checkbox"><input type="checkbox" style="display:none"></span>IView checkbox<input id="still-hidden" type="hidden"></label>
      <label id="el-check" class="el-checkbox"><input type="checkbox" style="display:none">Element checkbox</label>
      <label id="ant-check" class="ant-checkbox-wrapper"><span class="ant-checkbox"><input type="checkbox" style="display:none"></span>Ant checkbox</label>
      <label id="disabled-check" class="ivu-checkbox-wrapper ivu-checkbox-wrapper-disabled"><input type="checkbox" style="display:none">Disabled</label>
      <button type="button" id="ivu-switch" class="ivu-switch">On / Off</button>
      <div id="el-switch" class="el-switch"><input type="checkbox" style="display:none"><span>On / Off</span></div>
      <button type="button" id="ant-switch" class="ant-switch">On / Off</button>
      <button type="button" id="disabled-switch" class="ant-switch ant-switch-disabled">Disabled</button>
      <button type="button" id="stuck-switch" class="ivu-switch">Stuck</button>
      <div id="conflict-switch" role="switch" aria-checked="true"><input type="checkbox" style="display:none"></div>
      <div id="many-checkboxes" role="checkbox" aria-checked="false"><input type="checkbox"><input type="checkbox"></div>
      <label id="native-disabled" class="el-checkbox"><input type="checkbox" disabled style="display:none">Disabled input</label>
      <label id="named-aria" class="ivu-checkbox-wrapper"><input type="checkbox" aria-label="Receive updates" style="display:none">Yes</label>
      <span id="updates-name">Receive alerts</span><label id="named-by" class="el-checkbox"><input type="checkbox" aria-labelledby="updates-name" style="display:none">Yes</label>
      <label for="external-checkbox">Receive reports</label><span id="named-external" class="ant-checkbox-wrapper"><input id="external-checkbox" type="checkbox" style="display:none">Yes</span>
      <label id="named-icon" class="ant-checkbox-wrapper"><input type="checkbox" aria-label="Notifications" style="display:none"><span aria-hidden="true">+</span></label>
      <label id="conflict-name" class="ivu-checkbox-wrapper" aria-label="Outer"><input type="checkbox" aria-label="Inner" style="display:none">Yes</label>
      <label for="conflicting-external-input">Outer</label><label id="conflict-external-name" class="el-checkbox"><input id="conflicting-external-input" type="checkbox" aria-label="Inner" style="display:none">Yes</label>
      <label id="missing-name" class="ant-checkbox-wrapper"><input type="checkbox" aria-labelledby="missing-label" style="display:none">Yes</label>
      <div id="moving-owner" role="combobox" aria-controls="first-popup"></div>
      <div id="first-popup" role="listbox" aria-multiselectable="true"><div role="option" aria-selected="false">A</div><div role="option" aria-selected="false">B</div></div>
      <div id="second-popup" role="listbox" hidden><div role="option" aria-selected="false">B</div></div>
      <div id="wrong-owner" class="ant-select"><div class="ant-select-selector"><input role="combobox" aria-controls="mine"></div></div>
      <div id="mine" class="ant-select-dropdown" hidden><div role="option" aria-selected="false">A</div></div>
      <div id="unrelated" class="ant-select-dropdown" hidden><div class="ant-select-item-option">A</div></div>`;
    document.body.append(fixture);
    for (const [id, checkedClass] of [['ivu-switch','ivu-switch-checked'],['el-switch','is-checked'],['ant-switch','ant-switch-checked']]) {
      const control = document.getElementById(id);
      control.onclick = () => { control.classList.toggle(checkedClass); const input=control.querySelector('input'); if(input) input.checked=control.classList.contains(checkedClass); };
    }
    document.querySelector('#wrong-owner .ant-select-selector').onclick=()=>document.getElementById('unrelated').hidden=false;
    document.querySelector('#unrelated .ant-select-item-option').onclick=()=>window.unrelatedClicked=true;
    const firstOptions=document.querySelectorAll('#first-popup [role="option"]');
    firstOptions[0].onclick=()=>{firstOptions[0].setAttribute('aria-selected','true');document.getElementById('moving-owner').setAttribute('aria-controls','second-popup');};
    firstOptions[1].onclick=()=>window.staleOptionClicked=true;
  });
  const represented = await page.evaluate(()=>choices.controlNodes(document).map(node=>node.id));
  assert.ok(represented.includes('still-hidden'),'Unrelated hidden input retained');
  for (const [id,name] of [['named-aria','Receive updates'],['named-by','Receive alerts'],['named-external','Receive reports'],['named-icon','Notifications']]) {
    assert.equal(await page.evaluate(id=>choices.choiceLabel(document.getElementById(id)),id),name,id);
    assert.equal(await page.evaluate(id=>choices.choiceInfo(document.getElementById(id)).supported,id),true,id);
  }
  assert.equal((await run('named-icon',{checked:true,syncStates:true})).ok,true,'Icon-only checkbox keeps native explicit name');
  for(const id of ['conflict-name','conflict-external-name','missing-name']) {
    assert.equal(await page.evaluate(id=>choices.choiceLabel(document.getElementById(id)),id),'',id);
    assert.equal((await run(id,{checked:true,syncStates:true})).ok,false,id);
  }
  for (const id of ['ivu-check','el-check','ant-check']) {
    assert.equal(represented.filter(value=>value===id).length,1,id);
    assert.equal((await run(id,{checked:true,syncStates:true})).ok,true,id);
    assert.equal((await run(id,{checked:false,syncStates:true})).ok,true,id);
  }
  for (const id of ['ivu-switch','el-switch','ant-switch']) {
    assert.equal(await page.evaluate(id=>choices.choiceLabel(document.getElementById(id)),id),'','Switch captions must not become field names');
    assert.equal((await run(id,{checked:true})).ok,false,id);
    assert.equal((await run(id,{checked:true,syncStates:true})).ok,true,id);
    assert.equal((await run(id,{checked:false,syncStates:true})).ok,true,id);
  }
  for (const id of ['disabled-check','disabled-switch','stuck-switch','conflict-switch','many-checkboxes','native-disabled']) assert.equal((await run(id,{checked:true,syncStates:true})).ok,false,id);
  assert.equal((await run('conflict-switch',{checked:false,syncStates:true})).ok,false,'Conflicting aria/native state cannot report no-op success');
  assert.equal((await run('moving-owner',{values:['A','B']})).ok,false);
  assert.equal(await page.evaluate(()=>!!window.staleOptionClicked),false,'Ownership must be checked before every option click');
  assert.equal((await run('wrong-owner',{value:'A'})).ok,false);
  assert.equal(await page.evaluate(()=>!!window.unrelatedClicked),false,'Explicit aria-controls must prevent unrelated framework popup fallback');
  assert.equal(await page.evaluate(()=>!!window.saved),false);
  console.log('Choice browser checks passed: native/ARIA/framework selections, opt-in state sync, ambiguity, occupancy, readback, no action buttons.');
} finally { await browser.close(); }
