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
test('source masks non-value count decorations in field rows while preserving real fractions',async()=>{
  const page=await browser.newPage();
  try {
    await page.setContent(`<style>section{display:flex;gap:20px;margin:20px}input{width:200px}span{display:inline-block}</style><form>
      <section><label for="service">服务</label><div><input id="service" maxlength="256" value="parking-pay"><span class="ivu-input-word-count">11/256</span></div></section>
      <section><label for="literal">比例</label><div><input id="literal" maxlength="256" value="11/256"><span class="el-input__count">6/256</span></div></section>
      <section><label for="wrong">备注</label><div><input id="wrong" maxlength="256" value="abc"><span class="char-count">4/256</span></div></section>
      <section><label for="helper">说明</label><div><input id="helper" maxlength="256" value="abc"><span id="plain">3/256</span></div></section>
      <section><label for="empty">空白</label><input id="empty" placeholder="参数说明"></section>
      </form>`);
    await page.evaluate(()=>{
      globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>{globalThis.handler=fn;}}}};
      globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
    });
    await page.addScriptTag({content});
    const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
    assert.equal(source.ok,true);
    assert.equal(source.rows.find(row=>row.label==='比例').value,'11/256');
    assert.equal(source.rows.find(row=>row.label==='服务').value,'parking-pay');
    const masked=await page.locator('span,input').evaluateAll((nodes,masks)=>nodes.filter(node=>{
      const rect=node.getBoundingClientRect();
      const x=rect.left+rect.width/2,y=rect.top+rect.height/2;
      return masks.some(box=>x>=box.x && x<=box.x+box.width && y>=box.y && y<=box.y+box.height);
    }).map(node=>node.id || node.className),source.emptyControlBounds);
    assert.deepEqual(masked.sort(),['el-input__count','empty','ivu-input-word-count','char-count','plain'].sort());
    assert.equal((await page.evaluate(()=>send({type:'SOURCE'}))).emptyControlBounds.length,0);
  } finally {await page.close();}
});
