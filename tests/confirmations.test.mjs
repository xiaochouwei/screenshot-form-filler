import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareMultiRows} from '../src/confirmations.js';
import {extractRows} from '../src/core.js';

const row={label:'Contacts',value:'East Team\nWest Team',confirmed:false,confidence:96,confirmation:'multi-layout'};
const target={id:'contacts',label:'Contacts',kind:'multi-select',supported:true,value:'',options:[{text:'East Team',value:'e'},{text:'West Team',value:'w'}]};
test('layout uncertainty is confirmed only by complete unique multi options without mutating source',()=>{
 const result=prepareMultiRows([row],[target]);
 assert.equal(row.confirmed,false);assert.equal(result.rows[0].confirmed,true);assert.deepEqual(result.rows[0].values,['East Team','West Team']);
 for(const source of [{...row,selected:false},{...row,review:'conflict'},{...row,confirmation:'manual'},{...row,confidence:79},{...row,hasConflict:true},{...row,confirmation:undefined}])assert.equal(prepareMultiRows([source],[target]).rows[0].confirmed,false);
 for(const field of [{...target,value:'occupied'},{...target,disabled:true},{...target,kind:'textarea'},{...target,options:[...target.options,target.options[0]]},{...target,options:[{text:'East Team',value:'e'}, {text:'West Team',value:'w',disabled:true}]}])assert.equal(prepareMultiRows([row],[field]).rows[0].confirmed,false);
 assert.equal(prepareMultiRows([row,row],[target]).rows[0].confirmed,false);
 assert.equal(prepareMultiRows([row],[target,{...target,id:'other'}]).rows[0].confirmed,false);
});
test('lazy options defer confirmation to explicit fill instead of checking an unseen list',()=>{
 const field={...target,kind:'multi-combobox',options:undefined};
 assert.equal(prepareMultiRows([row],[field]).rows[0].confirmed,false);
 const result=prepareMultiRows([row],[field],{allowDeferred:true});
 assert.equal(result.automatic.size,0);assert.equal(result.deferred.has(0),true);
});
test('OCR records layout-only uncertainty separately from low confidence',()=>{
 const word=(text,x,y,confidence=98)=>({text,confidence,bbox:{x0:x,y0:y,x1:x+50,y1:y+14}});
 const box={left:100,top:10,right:380,bottom:75};
 const words=[word('Contacts',10,25),word('East Team',110,20),word('West Team',110,48)];
 assert.equal(extractRows(words,[box])[0].confirmation,'multi-layout');
 assert.equal(extractRows(words.map(word=>({...word,confidence:65})),[box])[0].confirmation,undefined);
});
