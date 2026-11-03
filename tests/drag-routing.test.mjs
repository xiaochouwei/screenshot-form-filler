import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

test('cross-window drag is claimed by its real receiver once and cannot survive navigation',async()=>{
  const listeners={},storage={};
  let history={items:[],selectedId:null};
  const hints=[];
  let injections=0;
  let injectionGate=null;
  const event=key=>({addListener:fn=>{listeners[key]=fn;}});
  const tabs=[{id:1,windowId:10,url:'https://source.test/',active:true},{id:2,windowId:20,url:'https://target.test/',active:true},{id:3,windowId:30,url:'https://denied.test/',active:true}];
  const chrome={runtime:{id:'extension',getURL:p=>`chrome-extension://extension/${p}`,onInstalled:event('install'),onStartup:event('startup'),onMessage:event('message')},
    action:{onClicked:event('action')},commands:{onCommand:event('command')},
    tabs:{query:async()=>tabs,get:async id=>tabs.find(t=>t.id===id),sendMessage:async(tabId,message,target)=>{hints.push({tabId,message,target});return {ok:true};},onUpdated:event('updated'),onRemoved:event('removed')},
    permissions:{onRemoved:event('permissionRemoved'),onAdded:event('permissionAdded')},
    scripting:{executeScript:async({target})=>{injections++;if(injectionGate)await injectionGate;if(target.tabId===3)throw Error('No permission');return [{frameId:0,documentId:`doc-${target.tabId}`}];}},
    sidePanel:{setPanelBehavior:async()=>{}},
    storage:{local:{get:async()=>({screenshotHistory:history})},session:{get:async key=>({[key]:storage[key]}),set:async value=>Object.assign(storage,value),remove:async key=>delete storage[key]}}
  };
  const result=await build({entryPoints:['src/background.js'],bundle:true,write:false,platform:'browser',format:'iife'});
  vm.runInNewContext(result.outputFiles[0].text,{chrome,crypto:globalThis.crypto,Date,console,setTimeout,clearTimeout,URL});
  const panel={id:'extension',url:'chrome-extension://extension/panel.html?mode=dock'};
  const send=(message,sender=panel)=>new Promise(resolve=>{if(!listeners.message(message,sender,resolve))resolve({unhandled:true});});
  const key='12345678-1234-1234-1234-123456789abc';
  const rows=[{label:'名称',value:'example',confirmed:true}];
  const register=()=>send({type:'REGISTER_DRAG',key,index:-1,rows,syncStates:false});
  assert.equal((await send({type:'PREPARE_RECEIVERS'})).targets.length,2);
  const preparedInjections=injections;
  hints.length=0;
  assert.equal((await register()).ok,true);
  assert.equal(hints.length,2);
  for(const hint of hints) {
    assert.equal(hint.message.type,'DRAG_READY');
    assert.equal(hint.message.key,key);
    assert.equal(hint.target.documentId,`doc-${hint.tabId}`);
    assert.equal(Object.keys(hint.message).sort().join(','),'key,type','Receiver hints must not broadcast screenshot values');
  }
  assert.equal(injections,preparedInjections,'Dragstart must use already prepared receiver identities without waiting to inject every tab');
  const receiver=id=>({id:'extension',tab:tabs.find(t=>t.id===id),url:tabs.find(t=>t.id===id).url,documentId:`doc-${id}`,frameId:0});
  assert.match((await send({type:'CLAIM_DRAG',key:'missing'},receiver(2))).error,/标记/);
  assert.match((await send({type:'CLAIM_DRAG',key},receiver(3))).error,/未连接/);
  assert.match((await send({type:'CLAIM_DRAG',key},{...receiver(2),documentId:'new-document'})).error,/变化/);
  const accepted=await send({type:'CLAIM_DRAG',key},receiver(2));
  assert.equal(accepted.ok,true);
  assert.equal(accepted.drag.rows[0].value,'example');
  assert.equal((await send({type:'CLAIM_DRAG',key},receiver(1))).ok,false,'Cannot replay into another window');
  await register();tabs[1].url='https://target.test/changed';
  assert.equal((await send({type:'CLAIM_DRAG',key},receiver(2))).ok,false);
  let releaseInjection;
  injectionGate=new Promise(resolve=>{releaseInjection=resolve;});
  const previous=injections,preparing=send({type:'PREPARE_RECEIVERS'});
  while(injections===previous)await new Promise(resolve=>setTimeout(resolve,0));
  await listeners.permissionRemoved();
  hints.length=0;releaseInjection();
  assert.equal((await preparing).targets.length,0,'An injection begun before revocation cannot reauthorize its old document');
  assert.equal(hints.some(hint=>hint.message.type==='SHOW_SHELF'),false);
  assert.equal((await send({type:'REGISTER_DRAG',key,index:-1,rows},receiver(1))).ok,false,'Web content cannot authorize a drag');
  tabs[1].url='https://target.test/';
  history={items:[{id:'capture',revision:1,rows,status:'ready'}],selectedId:'capture'};
  assert.equal((await send({type:'REGISTER_DRAG',key,index:-1,rows,captureId:'capture',revision:1})).ok,true);
  history={items:[],selectedId:null};
  assert.equal((await send({type:'CLAIM_DRAG',key},receiver(2))).ok,false,'Deleting a detailed-editor screenshot must invalidate an already-started drag');
  // Restart the MV3 worker without rebuilding its receiver cache; session drag survives.
  storage.activeDrag={key,rows,index:-1,expiresAt:Date.now()+60000,targets:tabs.slice(0,2).map(t=>({tabId:t.id,url:t.url,documentId:`doc-${t.id}`}))};
  vm.runInNewContext(result.outputFiles[0].text,{chrome,crypto:globalThis.crypto,Date,console,setTimeout,clearTimeout,URL});
  hints.length=0;
  await listeners.permissionRemoved();
  assert.equal(hints.filter(hint=>hint.message.type==='REVOKE_SHELF' && hint.tabId===2).length,1,'Revocation must reach injected pages after a worker restart');
  assert.equal((await send({type:'SHELF_ACCESS'},receiver(2))).ok,false,'Revoked documents cannot access shelf services');
  assert.equal(storage.activeDrag,undefined,'Revocation must invalidate an already registered drag');
  assert.equal((await send({type:'CLAIM_DRAG',key},receiver(2))).ok,false);
});
