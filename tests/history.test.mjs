import {test} from 'node:test';
import assert from 'node:assert/strict';
import {reduceHistory} from '../src/history.js';

const capture=(id,value=id)=>({id,image:'data:image/png;base64,AA==',rows:[{label:'Name',value,confirmed:true}],status:'ready',info:id});
test('history keeps distinct images, switches selection and rejects stale edits',()=>{
  let state=reduceHistory(null,{type:'add',capture:capture('a')});
  state=reduceHistory(state,{type:'add',capture:capture('b')});
  assert.deepEqual(state.items.map(item=>item.id),['b','a']);
  state=reduceHistory(state,{type:'select',id:'a'});
  assert.equal(state.selectedId,'a');
  state=reduceHistory(state,{type:'update',id:'a',revision:1,patch:{rows:capture('a','updated').rows}});
  assert.equal(state.items[1].rows[0].value,'updated');
  assert.throws(()=>reduceHistory(state,{type:'update',id:'a',revision:1,patch:{rows:[]}}),/已变化/);
  state=reduceHistory(state,{type:'delete',id:'a'});
  assert.equal(state.selectedId,'b');
  assert.throws(()=>reduceHistory(state,{type:'update',id:'a',revision:2,patch:{rows:[]}}),/已删除/);
});
test('history bounds count and bytes, evicts oldest and refuses an oversized record',()=>{
  let state;
  for(let i=0;i<14;i++) state=reduceHistory(state,{type:'add',capture:capture(String(i))});
  assert.equal(state.items.length,10);
  assert.equal(state.items.at(-1).id,'4');
  assert.throws(()=>reduceHistory(state,{type:'add',capture:{...capture('large'),image:'x'.repeat(4*1024*1024)}}),/过大/);
  state=reduceHistory(state,{type:'clear'});
  assert.equal(state.items.length,0);
  assert.equal(state.selectedId,null);
});
