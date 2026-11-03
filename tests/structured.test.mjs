import test from 'node:test';
import assert from 'node:assert/strict';
import {validRows, planMatches, extractRows, detectInputBoxes} from '../src/core.js';

const source=()=>({label:'匹配规则',kind:'group',value:'',confirmed:true,fields:[
  {label:'key',value:'severity',confirmed:true},
  {label:'value',value:'P[0-2]',confirmed:true},
  {label:'正则表达式',kind:'checkbox',value:'',checked:true,confirmed:true},
]});
const target=()=>({id:'rule',label:'匹配规则',kind:'group',value:'',supported:true,fields:[
  {id:'v',label:'value',kind:'text',value:'',supported:true},
  {id:'k',label:'key',kind:'text',value:'',supported:true},
  {id:'r',label:'正则表达式',kind:'checkbox',value:'\u0001',checked:false,supported:true},
]});
test('structured rows validate children and match keys, not child order',()=>{
  assert.equal(validRows([source()]),true);
  const plan=planMatches([source()],[target()],{syncStates:true});
  assert.equal(plan[0].ready,true,JSON.stringify(plan));
  assert.deepEqual(plan[0].fields.map(field=>[field.targetId,field.value,field.checked]),[['k','severity',undefined],['v','P[0-2]',undefined],['r','',true]]);
});
test('groups reject nested or ambiguous structure and validate the whole group before filling',()=>{
  const nested=source();nested.fields.push(source());
  assert.equal(validRows([nested]),false);
  const duplicate=source();duplicate.fields.push({...duplicate.fields[0]});
  assert.equal(planMatches([duplicate],[target()],{syncStates:true})[0].ready,false);
  const occupied=target();occupied.fields[1].value='existing';
  assert.equal(planMatches([source()],[occupied],{syncStates:true})[0].ready,false);
  assert.equal(planMatches([source()],[target()])[0].ready,false,'State sync still requires opt in');
  assert.equal(planMatches([source()],[target(),target()],{syncStates:true})[0].ready,false);
  const renamed=target();renamed.label='规则';
  assert.equal(planMatches([source()],[renamed],{syncStates:true})[0].ready,false);
});

test('existing group text can be preserved only with an explicit exact equality fact',()=>{
  const field=target();field.fields.find(child=>child.label==='key').value='\u0001';
  assert.equal(planMatches([source()],[field],{syncStates:true})[0].ready,false);
  field.fields.find(child=>child.label==='key').sameValue=true;
  const [plan]=planMatches([source()],[field],{syncStates:true});
  assert.equal(plan.ready,true);
  assert.equal(plan.fields.find(child=>child.label==='key').unchanged,true);
  assert.equal(planMatches([source()],[field])[0].ready,false);
});
test('OCR preserves two adjacent inputs sharing a caption as a key/value group',()=>{
  const word=(text,x0,x1)=>({text,confidence:98,bbox:{x0,y0:30,x1,y1:45}});
  const boxes=[{left:100,top:20,right:340,bottom:55},{left:355,top:20,right:595,bottom:55}];
  const rows=extractRows([word('匹配规则',15,90),word('severity',110,170),word('P[0-2]',365,425)],boxes);
  assert.equal(rows.length,1);
  assert.equal(rows[0].kind,'group');
  assert.deepEqual(rows[0].fields.map(field=>[field.label,field.value]),[['key','severity'],['value','P[0-2]']]);
  assert.equal(validRows(rows),true);
  assert.equal(rows[0].confirmed,false,'Position alone cannot establish key/value semantics');
});

test('OCR required marker attached to a caption is not part of the field name',()=>{
  const rows=extractRows([{text:'*名称',confidence:98,bbox:{x0:10,y0:20,x1:50,y1:35}},{text:'样例',confidence:98,bbox:{x0:75,y0:20,x1:110,y1:35}}],[{left:65,top:10,right:250,bottom:45}]);
  assert.equal(rows[0].label,'名称');
});

test('light clipped input borders retain field geometry without accepting a horizontal divider',()=>{
  const width=600,height=180,pixels=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const n=(y*width+x)*4;pixels[n]=pixels[n+1]=pixels[n+2]=230;};
  for(const [left,right,top,bottom] of [[100,599,20,50],[100,320,80,110],[335,575,80,110]]) {
    for(let x=left;x<=right;x++) {ink(x,top);ink(x,bottom);}
    for(let y=top;y<=bottom;y++) {ink(left,y);if(right<599) ink(right,y);}
  }
  for(let x=0;x<width;x++) ink(x,150);
  const boxes=detectInputBoxes(pixels,width,height);
  assert.equal(boxes.length,3,JSON.stringify(boxes));
  assert.equal(boxes[0].clipped,true);
});
test('two independently captioned adjacent inputs are not combined',()=>{
  const word=(text,x0,x1)=>({text,confidence:98,bbox:{x0,y0:30,x1,y1:45}});
  const rows=extractRows([word('姓名',10,45),word('样例',65,100),word('城市',245,280),word('南京',300,335)],[{left:55,top:20,right:225,bottom:55},{left:290,top:20,right:460,bottom:55}]);
  assert.deepEqual(rows.map(row=>row.label),['姓名','城市']);
  assert.ok(rows.every(row=>!row.fields));
});
