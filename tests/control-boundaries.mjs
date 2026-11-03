import test, {before, after} from 'node:test';
import assert from 'node:assert/strict';
import {chromium} from 'playwright';
import {build} from 'esbuild';

let browser, controls, content;
before(async()=>{
  browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
  controls=(await build({entryPoints:['src/controls.js'],bundle:true,write:false,format:'iife',globalName:'choices'})).outputFiles[0].text;
  content=(await build({entryPoints:['src/content.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
});
after(async()=>{await browser?.close();});

async function choicePage({multi=false,delay=0,change=''}={}) {
  const page=await browser.newPage();
  await page.setContent('<style>[hidden]{display:none!important}.ivu-select,.ivu-select-dropdown{min-height:32px;min-width:100px}.ivu-select-item{padding:8px}</style><form><div id="owner" class="ivu-select"><div class="ivu-select-selection"></div></div></form>');
  await page.evaluate(({multi,delay,change})=>{
    window.clicks=[];
    const owner=document.getElementById('owner'),trigger=owner.firstElementChild;
    if(multi) owner.classList.add('ivu-select-multiple');
    else {const value=document.createElement('span');value.className='ivu-select-selected-value';trigger.append(value);}
    trigger.onclick=()=>{
      if(document.getElementById('options')) return;
      const popup=document.createElement('div');popup.id='options';popup.className='ivu-select-dropdown';document.body.append(popup);
      const populate=()=>['A','B'].forEach(name=>{
        const option=document.createElement('div');option.className='ivu-select-item';option.textContent=name;
        option.onclick=()=>{
          window.clicks.push(name);option.classList.add('ivu-select-item-selected');
          if(multi) {const tag=document.createElement('span');tag.className='ivu-tag-text';tag.textContent=name;trigger.append(tag);}
          else {trigger.querySelector('.ivu-select-selected-value').textContent=name;popup.hidden=true;}
          if(change==='disabled') owner.setAttribute('aria-disabled','true');
          if(change==='readonly') owner.setAttribute('aria-readonly','true');
          if(change==='hidden') owner.style.opacity='0';
          if(change==='extra-selection' && name==='A') {const tag=document.createElement('span');tag.className='ivu-tag-text';tag.textContent='Unexpected';trigger.append(tag);}
        };
        popup.append(option);
      });
      if(delay) setTimeout(populate,delay);else populate();
    };
  },{multi,delay,change});
  await page.addScriptTag({content:controls});
  return page;
}

for(const multi of [false,true]) test(`waits for delayed ${multi?'typed multi':'single'} dropdown options`,async()=>{
  const page=await choicePage({multi,delay:180});
  try {
    const result=await page.evaluate(async multi=>{
      try {return {value:await choices.writeChoice(document.getElementById('owner'),multi?{values:['A','B']}:{value:'B'})};}
      catch(error){return {error:error.message};}
    },multi);
    assert.equal(result.error,undefined,JSON.stringify(result));
    assert.deepEqual(await page.evaluate(()=>window.clicks),multi?['A','B']:['B']);
  } finally {await page.close();}
});

for(const mode of ['late-popup','late-options','incremental','busy']) test(`waits for ${mode} without repeated opening clicks`,async()=>{
  const page=await choicePage();
  try {
    await page.evaluate(mode=>{
      const owner=document.getElementById('owner'),trigger=owner.firstElementChild;
      window.opens=0;
      trigger.onclick=()=>{
        opens++;
        const mount=()=>{
          const popup=document.createElement('div');popup.id='options';popup.className='ivu-select-dropdown';document.body.append(popup);
          const add=value=>{
            const option=document.createElement('div');option.className='ivu-select-item';option.textContent=value;
            option.onclick=()=>{clicks.push(value);trigger.querySelector('.ivu-select-selected-value').textContent=value;popup.hidden=true;};popup.append(option);
          };
          if(mode==='busy') {popup.setAttribute('aria-busy','true');add('B');setTimeout(()=>{popup.removeAttribute('aria-busy');window.loaded=true;},800);}
          else if(mode==='incremental') {add('A');setTimeout(()=>{add('B');window.loaded=true;},800);}
          else if(mode==='late-options')setTimeout(()=>{add('B');window.loaded=true;},1400);
          else {add('B');window.loaded=true;}
        };
        if(mode==='late-popup')setTimeout(mount,800);else mount();
      };
    },mode);
    const result=await page.evaluate(async()=>{
      try {const value=await choices.writeChoice(document.getElementById('owner'),{value:'B'});return {value,loaded:window.loaded};}
      catch(error){return {error:error.message};}
    });
    assert.equal(result.error,undefined,JSON.stringify(result));
    assert.equal(result.loaded,true,'Must wait until options finish loading');
    assert.equal(await page.evaluate(()=>opens),1,'Never toggle repeatedly while waiting');
    assert.deepEqual(await page.evaluate(()=>clicks),['B']);
  } finally {await page.close();}
});

test('an already open unlinked dropdown is explained without toggling or guessing',async()=>{
  const page=await choicePage();
  try {
    await page.evaluate(()=>{
      document.getElementById('owner').setAttribute('aria-expanded','true');
      document.querySelector('.ivu-select-selection').click();
      window.opens=0;document.querySelector('.ivu-select-selection').onclick=()=>opens++;
    });
    const result=await page.evaluate(async()=>{
      try {await choices.writeChoice(document.getElementById('owner'),{value:'B'});return {};}
      catch(error){return {error:error.message};}
    });
    assert.match(result.error,/已展开.*收起/);
    assert.equal(await page.evaluate(()=>opens),0);
    assert.deepEqual(await page.evaluate(()=>clicks),[]);
  } finally {await page.close();}
});

test('an already open explicitly linked portal is used without another opening click',async()=>{
  const page=await choicePage();
  try {
    await page.evaluate(()=>{
      document.querySelector('.ivu-select-selection').click();
      document.getElementById('owner').setAttribute('aria-controls','options');
      document.getElementById('owner').setAttribute('aria-expanded','true');
      window.opens=0;document.querySelector('.ivu-select-selection').onclick=()=>opens++;
    });
    await page.evaluate(()=>choices.writeChoice(document.getElementById('owner'),{value:'B'}));
    assert.equal(await page.evaluate(()=>opens),0);
    assert.deepEqual(await page.evaluate(()=>clicks),['B']);
  } finally {await page.close();}
});

for(const change of ['disabled','owner-reference','navigation']) test(`stops waiting when ${change} changes before options arrive`,async()=>{
  const page=await choicePage({delay:800});
  try {
    await page.evaluate(change=>{
      const trigger=document.querySelector('.ivu-select-selection'),open=trigger.onclick;
      trigger.onclick=()=>{
        open();
        setTimeout(()=>{
          const owner=document.getElementById('owner');
          if(change==='disabled')owner.setAttribute('aria-disabled','true');
          if(change==='owner-reference')owner.setAttribute('aria-controls','another-menu');
          if(change==='navigation')history.pushState({},'','#changed');
        },200);
      };
    },change);
    const result=await page.evaluate(async()=>{
      try {await choices.writeChoice(document.getElementById('owner'),{value:'B'});return {};}
      catch(error){return {error:error.message};}
    });
    assert.ok(result.error,JSON.stringify(result));
    assert.deepEqual(await page.evaluate(()=>clicks),[]);
  } finally {await page.close();}
});

test('missing multi option times out without selecting the available subset',async()=>{
  const page=await choicePage({multi:true});
  try {
    const result=await page.evaluate(async()=>{
      try {await choices.writeChoice(document.getElementById('owner'),{values:['A','missing']});return {};}
      catch(error){return {error:error.message};}
    });
    assert.match(result.error,/等待下拉选项超时/);
    assert.deepEqual(await page.evaluate(()=>clicks),[]);
  } finally {await page.close();}
});

test('a non-opening trigger reports expansion timeout and is clicked only once',async()=>{
  const page=await choicePage();
  try {
    await page.evaluate(()=>{
      window.opens=0;document.getElementById('owner').setAttribute('aria-expanded','false');
      document.querySelector('.ivu-select-selection').onclick=()=>opens++;
    });
    const result=await page.evaluate(async()=>{
      try {await choices.writeChoice(document.getElementById('owner'),{value:'B'});return {};}
      catch(error){return {error:error.message};}
    });
    assert.match(result.error,/未展开或展开超时/);
    assert.equal(await page.evaluate(()=>opens),1);
    assert.deepEqual(await page.evaluate(()=>clicks),[]);
  } finally {await page.close();}
});

for(const change of ['disabled','readonly','hidden','extra-selection']) test(`stops before the second selection when target becomes ${change}`,async()=>{
  const page=await choicePage({multi:true,change});
  try {
    const result=await page.evaluate(async()=>{
      try {await choices.writeChoice(document.getElementById('owner'),{values:['A','B']});return {ok:true};}
      catch(error){return {ok:false,error:error.message};}
    });
    assert.equal(result.ok,false,JSON.stringify(result));
    assert.deepEqual(await page.evaluate(()=>window.clicks),['A'],'Must stop after the first observed state change');
  } finally {await page.close();}
});

test('partial or empty ARIA label references cannot fall back to a shorter name',async()=>{
  const page=await browser.newPage();
  try {
    await page.route('http://boundaries.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
    await page.goto('http://boundaries.test/');
    await page.setContent('<form><span id="caption">Name</span><span id="blank"></span><input aria-labelledby="caption missing"><input aria-labelledby="caption blank"><label>Fallback<input aria-labelledby="missing"></label><input aria-labelledby="caption"></form>');
    await page.evaluate(()=>{
      globalThis.chrome={runtime:{id:'test',onMessage:{addListener:handler=>{globalThis.handler=handler;}}}};
      globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
    });
    await page.addScriptTag({content});
    const scan=await page.evaluate(()=>send({type:'SCAN'}));
    assert.deepEqual(scan.fields.map(field=>field.label),['','','','Name']);
    assert.deepEqual(scan.fields.map(field=>field.supported),[false,false,false,true]);
  } finally {await page.close();}
});

test('text input under an ARIA-disabled container cannot be filled',async()=>{
  const page=await browser.newPage();
  try {
    await page.route('http://disabled.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html>'}));
    await page.goto('http://disabled.test/');
    await page.setContent('<form><div aria-disabled="true"><label for="name">Name</label><input id="name"></div></form>');
    await page.evaluate(()=>{
      globalThis.chrome={runtime:{id:'test',onMessage:{addListener:handler=>{globalThis.handler=handler;}}}};
      globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
    });
    await page.addScriptTag({content});
    const scan=await page.evaluate(()=>send({type:'SCAN'}));
    const preview=await page.evaluate(scan=>send({type:'PREVIEW',token:scan.token,scopeId:scan.scopes[0].id,rows:[{label:'Name',value:'Example',confirmed:true}]}),scan);
    assert.equal(preview.plan[0].ready,false);
    await page.evaluate(({token,previewId})=>send({type:'FILL',token,previewId}),{token:scan.token,previewId:preview.previewId});
    assert.equal(await page.locator('#name').inputValue(),'');
  } finally {await page.close();}
});

test('framework dropdown with a disabled native input cannot open or select',async()=>{
  const page=await choicePage();
  try {
    await page.evaluate(()=>{const input=document.createElement('input');input.disabled=true;document.querySelector('.ivu-select-selection').append(input);});
    const result=await page.evaluate(async()=>{
      try {await choices.writeChoice(document.getElementById('owner'),{value:'A'});return {ok:true};}
      catch(error){return {ok:false,error:error.message};}
    });
    assert.equal(result.ok,false);
    assert.deepEqual(await page.evaluate(()=>window.clicks),[]);
    assert.equal(await page.locator('#options').count(),0);
  } finally {await page.close();}
});
