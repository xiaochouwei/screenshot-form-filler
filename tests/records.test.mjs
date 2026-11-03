import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRecords} from '../src/records.js';

test('external screenshots work without any source webpage values',()=>{
  const image=[{label:'名称',value:'样例',confirmed:true}];
  assert.deepEqual(mergeRecords(image,[]).map(row=>[row.label,row.value,row.confirmed,row.source]),[['名称','样例',true,'image']]);
});
test('source DOM corroborates image data, disagreements remain visible and unconfirmed',()=>{
  const image=[{label:'名称',value:'样例',confirmed:true},{label:'项目',value:'misread',confirmed:true}];
  const web=[{label:'名称',value:'样例',confirmed:true},{label:'项目',value:'真实值',confirmed:true},{label:'开关',kind:'switch',value:'',checked:true,confirmed:true}];
  const result=mergeRecords(image,web);
  assert.equal(result[0].source,'image+web');
  assert.equal(result[1].value,'misread');
  assert.equal(result[1].confirmed,false);
  assert.equal(result[1].alternative.value,'真实值');
  assert.equal(result[2].checked,true);
  assert.equal(result[2].source,'web');
});
test('ambiguous DOM duplicates never replace or corroborate a screenshot value',()=>{
  const result=mergeRecords([{label:'名称',value:'样例',confirmed:false}],[{label:'名称',value:'样例',confirmed:true},{label:'名称',value:'样例',confirmed:true}]);
  assert.equal(result.length,1);
  assert.equal(result[0].confirmed,false);
});

test('DOM multi-select typing corroborates each screenshot line without replacing text',()=>{
  const image=[{label:'联系人',value:'主班\n备班',confirmed:false}];
  const web=[{label:'联系人',value:'',kind:'multi-select',values:['主班','备班'],confirmed:true}];
  const [row]=mergeRecords(image,web);
  assert.equal(row.value,'主班\n备班');
  assert.deepEqual(row.values,['主班','备班']);
  assert.equal(row.source,'image+web');
  assert.equal(row.confirmed,true);
  const [conflict]=mergeRecords([{...image[0],value:'主班\n另一个人'}],web);
  assert.equal(conflict.values,undefined);
  assert.equal(conflict.confirmed,false);
});

test('DOM confirms group roles and supplies only missing typed state children',()=>{
  const image={label:'匹配规则',kind:'group',value:'',confirmed:false,fields:[{label:'key',value:'severity',confirmed:true},{label:'value',value:'P[0-2]',confirmed:true}]};
  const web={...structuredClone(image),confirmed:true,fields:[...structuredClone(image.fields),{label:'正则表达式',kind:'checkbox',value:'',checked:true,confirmed:true}]};
  const [row]=mergeRecords([image],[web]);
  assert.equal(row.source,'image+web');
  assert.equal(row.confirmed,true);
  assert.equal(row.fields[2].checked,true);
  const changed=structuredClone(web);changed.fields[0].value='different';
  const [conflict]=mergeRecords([image],[changed]);
  assert.equal(conflict.fields.length,2);
  assert.equal(conflict.confirmed,false);
});

test('DOM corroborates two chip captions on the same OCR line as distinct selected options',()=>{
  const image=[{label:'联系人',value:'值班组-主 值班组-备',confirmed:false}];
  const web=[{label:'联系人',kind:'multi-combobox',value:'值班组-主\n值班组-备',values:['值班组-主','值班组-备'],confirmed:true}];
  const [row]=mergeRecords(image,web);
  assert.deepEqual(row.values,['值班组-主','值班组-备']);
  assert.equal(row.source,'image+web');
  assert.equal(row.confirmed,true);
});
