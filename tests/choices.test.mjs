import test from 'node:test';
import assert from 'node:assert/strict';
import { validRows, planMatches } from '../src/core.js';

const row = extra => ({ label: 'Choice', value: 'A', confirmed: true, ...extra });
const field = extra => ({ id: 'choice', label: 'Choice', value: '', supported: true, kind: 'select', options: [{text:'A',value:'a'},{text:'B',value:'b'}], ...extra });
const plan = (source, target, settings) => planMatches([row(source)], [field(target)], settings)[0];

test('typed row validation rejects inferred and incompatible state payloads', () => {
  assert.equal(validRows([row({kind:'checkbox',checked:false,value:''})]), true);
  for (const extra of [{checked:true}, {kind:'checkbox'}, {kind:'checkbox',checked:'false'}, {kind:'text',checked:false}, {kind:'multi-select',values:['A','A']}, {kind:'multi-select',values:'A,B'}, {kind:'text',values:['A']}, {kind:'unknown'}, {kind:'multi-select',values:['']}, {kind:'multi-select',values:Array(201).fill('A')}]) assert.equal(validRows([row(extra)]), false, JSON.stringify(extra));
  assert.equal(validRows([null]), false);
  assert.equal(validRows([row({kind:'multi-select',values:['A','B']})]), true);
});

test('boolean states always require explicit opt-in and never use text inference', () => {
  for (const kind of ['checkbox','switch']) {
    assert.equal(plan({kind,checked:false,value:''},{kind,value:'\u0001'}).ready, false);
    assert.equal(plan({kind,checked:false,value:''},{kind,value:'\u0001'},{syncStates:true}).ready, true);
    assert.equal(plan({value:'true'},{kind,value:'\u0001'},{syncStates:true}).ready, false);
    assert.equal(plan({kind,checked:true},{kind:'text'},{syncStates:true}).ready, false);
  }
});

test('multi-select requires array and empty target; every option exact and unique', () => {
  assert.equal(plan({kind:'multi-select',values:['A','B']},{kind:'multi-select'}).ready,true);
  assert.equal(plan({value:'A,B'},{kind:'multi-select'}).ready,false);
  assert.equal(plan({kind:'multi-select',values:['A','B']},{kind:'multi-select',value:'\u0001'},{syncStates:true}).ready,false);
  assert.equal(plan({kind:'multi-select',values:['A','missing']},{kind:'multi-select'}).ready,false);
  assert.equal(plan({kind:'multi-select',values:['A']},{kind:'select'}).ready,false);
});

test('radio can fill empty and only replace selected state with opt-in', () => {
  assert.equal(plan({}, {kind:'radio'}).ready, true);
  assert.equal(plan({}, {kind:'radio',value:'\u0001'}).ready, false);
  assert.equal(plan({}, {kind:'radio',value:'\u0001'}, {syncStates:true}).ready, true);
  assert.equal(plan({}, {kind:'text',value:'existing'}, {syncStates:true}).ready, false);
});

test('duplicate disabled options and duplicate underlying values remain ambiguous', () => {
  assert.equal(plan({}, {options:[{text:'A',value:'a'},{text:'A',value:'b',disabled:true}]}).ready,false);
  assert.equal(plan({}, {options:[{text:'A',value:'a'},{text:'B',value:'a'}]}).ready,false);
});
