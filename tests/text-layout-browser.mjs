import {chromium} from 'playwright';
import {build} from 'esbuild';
import assert from 'node:assert/strict';
import {mergeRecords} from '../src/records.js';

const content=(await build({entryPoints:['src/content.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
const browser=await chromium.launch({headless:true,executablePath:process.env.TEST_CHROMIUM});
try{
  const page=await browser.newPage({viewport:{width:1000,height:800}});
  await page.setContent('<style>textarea{width:130px;height:220px;font:16px monospace;padding:6px;box-sizing:border-box;overflow-wrap:break-word}label{display:block}</style><form><label>Alpha<textarea id="soft"></textarea></label><label>Beta<textarea id="hard"></textarea></label><label>Gamma<textarea id="nowrap" wrap="off"></textarea></label></form>');
  await page.evaluate(()=>{
    document.getElementById('soft').value='abcdefghijABCDEFGHIJ0123456789';
    document.getElementById('hard').value='first\nsecond';
    document.getElementById('nowrap').value='abcdefghijABCDEFGHIJ0123456789';
    globalThis.chrome={runtime:{id:'test',onMessage:{addListener:fn=>globalThis.handler=fn}}};
    globalThis.send=message=>new Promise(resolve=>handler(message,{id:'test'},resolve));
  });
  await page.addScriptTag({content});
  const source=await page.evaluate(()=>send({type:'SOURCE',geometry:true}));
  const soft=source.rows.find(row=>row.label==='Alpha'),hard=source.rows.find(row=>row.label==='Beta'),nowrap=source.rows.find(row=>row.label==='Gamma');
  assert.ok(soft.textLayout?.softBreaks.length,'Source capture must record actual native soft wrapping');
  assert.deepEqual(hard.textLayout.softBreaks,[],'Intentional line breaks are never soft breaks');
  assert.deepEqual(nowrap.textLayout.softBreaks,[]);
  const styled=await page.evaluate(async()=>{
    const node=document.getElementById('soft');node.style.whiteSpace='pre';node.style.overflowWrap='normal';
    const source=await send({type:'SOURCE',geometry:true});
    return {row:source.rows.find(row=>row.label==='Alpha'),scrollWidth:node.scrollWidth,clientWidth:node.clientWidth};
  });
  assert.ok(styled.scrollWidth>styled.clientWidth);
  assert.deepEqual(styled.row.textLayout.softBreaks,[],'CSS pre must not generate imaginary soft-wrap evidence');
  await page.locator('#soft').evaluate(node=>{node.style.whiteSpace='pre-wrap';node.style.overflowWrap='break-word';});
  const imageValue=[...soft.value].map((character,index)=>(soft.textLayout.softBreaks.includes(index)?'\n':'')+character).join('');
  const [row]=mergeRecords([{label:soft.label,value:imageValue,confirmed:false}],[soft]);
  assert.equal(row.value,soft.value);assert.equal(row.review,'ready');assert.equal(row.imageValue,imageValue);
  assert.equal(mergeRecords([{label:hard.label,value:'firstsecond',confirmed:true}],[hard])[0].review,'conflict');
  assert.equal(mergeRecords([{label:soft.label,value:imageValue.slice(0,12),confirmed:true}],[soft])[0].review,'conflict','Clipped values cannot import unseen characters');
  for(const value of ['\u4e2d\u6587\u6807\u70b9\uff1a'+ '\u6d4b\u8bd5\u6587\u5b57'.repeat(8),'[regex] ^(?:ab|cd)+$ /?x=1&y=2; {"key":"value"}\nsecond line: unchanged']){
    const row=await page.evaluate(async value=>{
      document.getElementById('soft').value=value;
      return (await send({type:'SOURCE',geometry:true})).rows.find(row=>row.label==='Alpha');
    },value);
    assert.ok(row.textLayout.softBreaks.length);
    const rendered=[...value].map((character,index)=>(row.textLayout.softBreaks.includes(index)?'\n':'')+character).join('');
    const merged=mergeRecords([{label:row.label,value:rendered,confirmed:false}],[row])[0];
    assert.equal(merged.value,value);assert.equal(merged.review,'ready');
    assert.equal(mergeRecords([{label:row.label,value:rendered.replace(/\n/g,''),confirmed:true}],[row])[0].review,value.includes('\n')?'conflict':'ready');
  }
  assert.equal(await page.locator('[data-local-text-layout]').count(),0,'Measurement leaves no extra field nodes');
  await page.screenshot({path:'test-artifacts/text-layout-source.png'});
  console.log('PASS: measured native soft wraps corroborate OCR; intentional breaks, nowrap and clipped values stay distinct');
}finally{await browser.close();}
