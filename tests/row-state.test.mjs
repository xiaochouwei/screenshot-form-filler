import test from 'node:test';
import assert from 'node:assert/strict';
import {mergeRecords} from '../src/records.js';
import {rowSelected,rowReady,selectRow,reviewRow} from '../src/row-state.js';
import {planMatches} from '../src/core.js';

const target={id:'target',label:'Description',kind:'textarea',supported:true,value:'',maxLength:-1};
test('new pending rows are selected independently of verification and cannot fill',()=>{
  const [row]=mergeRecords([{label:'Description',value:'line one\nline two',confirmed:false}],[]);
  assert.equal(rowSelected(row),true);assert.equal(rowReady(row),false);assert.equal(row.review,'pending');
  assert.match(planMatches([row],[target])[0].reason,/核对/);
  const selected=selectRow(selectRow(row,false),true);
  assert.equal(rowReady(selected),false,'Selecting cannot certify contents');
  assert.equal(rowReady(reviewRow(selected,'image')),true);
});
test('conflicts stay selected but blocked until the source is chosen',()=>{
  const [row]=mergeRecords([{label:'Description',value:'OCR',confirmed:true}],[{label:'Description',value:'original',confirmed:true}]);
  assert.equal(rowSelected(row),true);assert.equal(row.review,'conflict');assert.equal(rowReady(row),false);
  const chosen=reviewRow(selectRow(row,false),'web');
  assert.equal(chosen.value,'original');assert.equal(rowSelected(chosen),false);assert.equal(rowReady(chosen),false);
  assert.equal(rowReady(selectRow(chosen,true)),true);
});
test('legacy unchecked rows never become a new default selection',()=>{
  assert.equal(rowSelected({confirmed:false}),false);assert.equal(rowReady({confirmed:true}),true);
  assert.equal(rowReady({confirmed:true,selected:false,review:'ready'}),false);
  assert.equal(rowReady({confirmed:true,selected:true,review:'conflict'}),false);
});
test('only measured soft wraps reconcile and hard breaks remain literal',()=>{
  const image=value=>[{label:'Description',value,confirmed:false}];
  const web={label:'Description',value:'abcdefgh',confirmed:true,textLayout:{value:'abcdefgh',softBreaks:[4]}};
  const [row]=mergeRecords(image('abcd\nefgh'),[web]);
  assert.equal(row.review,'ready');assert.equal(row.value,'abcdefgh');assert.equal(row.imageValue,'abcd\nefgh');
  for(const source of [{...web,textLayout:undefined},{...web,textLayout:{value:'stale',softBreaks:[4]}},{...web,textLayout:{value:web.value,softBreaks:[3]}}])assert.equal(mergeRecords(image('abcd\nefgh'),[source])[0].review,'conflict');
  for(const value of ['abc\ndefgh','abcd efgh','abcdXefgh'])assert.equal(mergeRecords(image(value),[web])[0].review,'conflict');
  const hard={...web,value:'abcd\nefgh',textLayout:{value:'abcd\nefgh',softBreaks:[]}};
  assert.equal(mergeRecords(image('abcdefgh'),[hard])[0].review,'conflict');
});

test('a measured wrap can restore hanging spaces but cannot change other spaces',()=>{
  const web={label:'Description',value:'hello  world',confirmed:true,textLayout:{value:'hello  world',softBreaks:[7]}};
  const [row]=mergeRecords([{label:'Description',value:'hello\nworld',confirmed:false}],[web]);
  assert.equal(row.value,'hello  world');assert.equal(row.review,'ready');
  assert.equal(mergeRecords([{label:'Description',value:'hello world',confirmed:true}],[web])[0].review,'conflict');
});
