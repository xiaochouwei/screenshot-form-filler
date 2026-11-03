import test from 'node:test';
import assert from 'node:assert/strict';
import {planMatches} from '../src/core.js';

const options=names=>names.map((text,index)=>({text,value:String(index+1),disabled:false}));
const source=value=>({label:'电话联系人',value,confirmed:true});
const target=(names,extra={})=>({id:'contacts',label:'电话联系人',kind:'multi-combobox',supported:true,value:'',options:options(names),...extra});

test('one-line OCR text becomes multiple exact options only on a multi-select target',()=>{
  const [plan]=planMatches([source('值班组-主 值班组-备')],[target(['值班组-主','值班组-备'])]);
  assert.equal(plan.ready,true,JSON.stringify(plan));
  assert.deepEqual(plan.values,['值班组-主','值班组-备']);
});

test('internal spaces belong to each complete option, not word delimiters',()=>{
  const [plan]=planMatches([source('East Team\nWest Team')],[target(['East Team','West Team'])]);
  assert.equal(plan.ready,true,JSON.stringify(plan));
  assert.deepEqual(plan.values,['East Team','West Team']);
});

test('all segmentations are checked even when several paths reach the same offset',()=>{
  const [plan]=planMatches([source('A B C A B D')],[target(['A B C','A','B C','A B','C','B D'])]);
  assert.equal(plan.ready,false,JSON.stringify(plan));
});

test('ambiguous segmentation, unknown text, punctuation, duplicates and unavailable options do not fill',()=>{
  for(const [value,names,extra] of [
    ['A B',['A','B','A B']],
    ['A missing',['A','B']],
    ['A,B',['A','B']],
    ['A A',['A','B']],
    ['a B',['A','B']],
    ['A B',['A','A','B']],
    ['A B',['A','B'],{options:[{text:'A',value:'a'},{text:'B',value:'b',disabled:true}]}],
    ['A B',['A','B'],{value:'occupied'}],
  ]) assert.equal(planMatches([source(value)],[target(names,extra)])[0].ready,false,`${value} / ${names}`);
});

test('lazy multi-select defers exact parsing until its own options have loaded',()=>{
  const [plan]=planMatches([source('A B')],[target([],{options:undefined})]);
  assert.equal(plan.ready,true,JSON.stringify(plan));
  assert.equal(plan.resolveMultiText,true);
  assert.equal(plan.values,undefined);
});

test('unconfirmed, boolean and group sources are never inferred as multi-select values',()=>{
  const field=target(['A','B']);
  assert.equal(planMatches([{...source('A B'),confirmed:false}],[field])[0].ready,false);
  assert.equal(planMatches([{...source(''),kind:'checkbox',checked:true}],[field])[0].ready,false);
  assert.equal(planMatches([source('A B')],[{...field,kind:'select'}])[0].ready,false);
});
