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
  const page=await browser.newPage({viewport:{width:1400,height:900}});
  await page.setContent(`<style>body{font:18px Arial}section{margin:20px 0;display:flex;align-items:center;gap:15px}input{width:170px;height:30px}label{min-width:60px}</style>${html}`);
  await page.evaluate(()=>{
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{globalThis.handler=fn;}}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  await page.addScriptTag({content});return page;
}
async function masked(page,selector,masks) {
  return page.locator(selector).evaluate((node,masks)=>{
    const range=document.createRange();range.selectNodeContents(node);
    const rect=node.matches('input,textarea')?node.getBoundingClientRect():range.getBoundingClientRect();
    const x=rect.x+rect.width/2,y=rect.y+rect.height/2;
    return masks.some(box=>x>=box.x && x<=box.x+box.width && y>=box.y && y<=box.y+box.height);
  },masks);
}

test('source excludes arbitrary row and page descriptions while preserving labels and real entered text',async()=>{
  const page=await setup(`<aside role="note" id="page-note">该区域展示系统默认的处理方式</aside><form>
    <section><label for="path">路径</label><input id="path" value="/api/*" aria-describedby="outside"><span id="inline">按参数组合决定分发策略</span></section>
    <section><label for="actual">备注</label><input id="actual" value="按参数组合决定分发策略"><span class="helper-text" id="named">按参数组合决定分发策略</span></section>
    <section><label>参数</label><input id="unnamed" placeholder="参数名"><select><option value="">等于</option></select><input id="second" placeholder="参数值"><span id="multi-help">也可按多个条件组合</span></section>
    </form><p id="outside">支持通配符但不支持正则</p><p id="static">其他独立展示的业务值</p>`);
  try {
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(source.rows.find(row=>row.label==='备注').value,'按参数组合决定分发策略');
    for(const selector of ['#page-note','#inline','#named','#multi-help','#outside','#unnamed','#second']) assert.equal(await masked(page,selector,source.emptyControlBounds),true,selector);
    for(const selector of ['label[for=path]','label[for=actual]','#actual','#path','#static']) assert.equal(await masked(page,selector,source.emptyControlBounds),false,selector);
    assert.equal((await page.evaluate(()=>send({type:'SOURCE'}))).emptyControlBounds.length,0);
  } finally {await page.close();}
});

test('empty grouped children are masked even though the outer group is not a text field',async()=>{
  const page=await setup(`<form><section><label>规则</label><input name="key" id="key" placeholder="字段名"><input name="value" id="value" placeholder="字段值"><span id="help">组合说明不属于填写内容</span></section></form>`);
  try {
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    for(const selector of ['#key','#value','#help']) assert.equal(await masked(page,selector,source.emptyControlBounds),true,selector);
    assert.equal(await masked(page,'label',source.emptyControlBounds),false);
  } finally {await page.close();}
});

test('open Shadow DOM descriptions preserve the actual input and its label',async()=>{
  const page=await setup('<div id="host"></div>');
  try {
    await page.evaluate(()=>document.getElementById('host').attachShadow({mode:'open'}).innerHTML=`<form><section><label for="source">来源</label><input id="source" value="example" aria-describedby="help"><span id="help">此处为字段说明</span></section></form>`);
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(source.rows.find(row=>row.label==='来源').value,'example');
    assert.equal(await masked(page,'#host #help',source.emptyControlBounds),true);
    assert.equal(await masked(page,'#host input',source.emptyControlBounds),false);
  } finally {await page.close();}
});

test('help nested in a native caption is not part of the field name or screenshot evidence',async()=>{
  const page=await setup('<form><section><label for="name">名称<small id="help" class="helper-text">最多填写一项</small></label><input id="name" value="example" aria-describedby="help"></section></form>');
  try {
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.deepEqual(source.rows.map(row=>[row.label,row.value]),[['名称','example']]);
    assert.equal(await masked(page,'#help',source.emptyControlBounds),true);
    await page.locator('#help').evaluate(node=>node.className='');
    const linked=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(linked.rows[0].label,'名称','ARIA description works without a framework class');
    assert.equal(await masked(page,'#help',linked.emptyControlBounds),true);
  } finally {await page.close();}
});

test('a description container with real controls does not erase their field captions',async()=>{
  const page=await setup('<div role="alert"><form><section><label for="name">名称</label><input id="name" value="example"><span class="helper-text" id="help">说明</span></section></form></div>');
  try {
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(await masked(page,'label',source.emptyControlBounds),false);
    assert.equal(await masked(page,'#name',source.emptyControlBounds),false);
    assert.equal(await masked(page,'#help',source.emptyControlBounds),true);
  } finally {await page.close();}
});
