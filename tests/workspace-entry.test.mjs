import test from 'node:test';
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import vm from 'node:vm';

const bundle=(await build({entryPoints:['src/background.js'],bundle:true,write:false,format:'iife'})).outputFiles[0].text;
function boot({captureFails=false,store={}}={}){
  const listeners={},calls=[],tab={id:7,windowId:4,url:'https://example.test/form',active:true};
  const event=key=>({addListener:fn=>{listeners[key]=fn;}});
  const chrome={
    runtime:{id:'extension',getURL:path=>`chrome-extension://extension/${path}`,onInstalled:event('install'),onStartup:event('startup'),onMessage:event('message'),getContexts:async()=>[{}],sendMessage:async message=>{calls.push(message);return {ok:true};}},
    action:{onClicked:event('action'),setBadgeText:async()=>{},setTitle:async()=>{}},
    commands:{onCommand:event('command')},
    sidePanel:{setPanelBehavior:async options=>calls.push({type:'behavior',...options}),onOpened:event('panelOpened'),onClosed:event('panelClosed'),close:options=>{calls.push({type:'close',...options});return Promise.resolve();},open:options=>{calls.push({type:'open',...options});return Promise.resolve();}},
    tabs:{query:async()=>[tab],get:async()=>tab,onUpdated:event('updated'),onRemoved:event('removed'),captureVisibleTab:async()=>{calls.push({type:'capture'});if(captureFails)throw Error('fixture capture denied');return 'data:image/png;base64,AA==';},sendMessage:async(_id,message)=>{calls.push(message);return {ok:true,rows:[]};}},
    scripting:{executeScript:async()=>[{documentId:'document-7',result:{width:900,height:700,scrollX:0,scrollY:0,scale:1}}]},
    permissions:{onAdded:event('added'),onRemoved:event('removed')},
    storage:{local:{get:async()=>({})},session:{get:async key=>key===null?{...store}:{[key]:store[key]},set:async value=>Object.assign(store,value),remove:async key=>delete store[key]}}
  };
  vm.runInNewContext(bundle,{chrome,crypto:globalThis.crypto,Date,console,setTimeout,clearTimeout,URL});
  const send=(message,sender={id:'extension',url:tab.url,frameId:0,tab,documentId:'document-7'})=>new Promise(resolve=>{if(!listeners.message(message,sender,resolve))resolve({unhandled:true});});
  return {listeners,calls,tab,send};
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
test('native workspace entry does not create a persistent page shelf',async()=>{
  const {listeners,calls,tab}=boot();
  listeners.install();listeners.updated(tab.id,{status:'complete'},tab);await settle();
  assert.equal(calls.find(call=>call.type==='behavior')?.openPanelOnActionClick,true);
  assert.ok(calls.some(call=>call.type==='ENABLE_RECEIVER'));
  assert.ok(!calls.some(call=>call.type==='SHOW_SHELF'));
  listeners.command('open-workspace',tab);
  assert.equal(calls.at(-1).type,'open','Open the native panel before losing the keyboard gesture');
  assert.equal(calls.at(-1).windowId,tab.windowId);
});
test('capture remains at the original viewport and defaults to background OCR without a page overlay',async()=>{
  const {listeners,calls,tab,send}=boot();
  listeners.command('receive-screenshot',tab);await settle();
  assert.ok(!calls.some(call=>call.type==='open'),'Capture must not resize the source before region selection');
  const selection=calls.find(call=>call.type==='START_REGION');
  assert.equal(selection.openWorkspace,true);
  assert.equal((await send({type:'OPEN_WORKSPACE'})).ok,true);
  const result=await send({type:'REGION_CAPTURE',token:selection.token,image:'data:image/png;base64,AA==',rows:[]});
  assert.equal(result.ok,true);await settle();
  assert.ok(calls.some(call=>call.type==='PROCESS_IMAGE'));
  assert.ok(!calls.some(call=>call.type==='SHOW_SHELF'));
  assert.equal((await send({type:'OPEN_WORKSPACE'},{id:'other',tab})).unhandled,true);
});
test('workspace shortcut follows native open and close events per browser window',async()=>{
  const {listeners,calls,tab}=boot();await settle();
  listeners.command('open-workspace',tab);await settle();
  assert.equal(calls.at(-1).type,'open');
  listeners.panelOpened({windowId:tab.windowId});await settle();
  listeners.command('open-workspace',tab);await settle();
  assert.equal(calls.at(-1).type,'close');
  assert.equal(calls.at(-1).windowId,tab.windowId);
  listeners.panelClosed({windowId:tab.windowId});await settle();
  listeners.command('open-workspace',tab);await settle();
  assert.equal(calls.at(-1).type,'open');
  listeners.panelClosed({windowId:tab.windowId});await settle();
  listeners.panelOpened({windowId:99});await settle();
  listeners.command('open-workspace',tab);await settle();
  assert.equal(calls.at(-1).type,'open','Another browser window cannot force this window to close');
});
test('worker restart restores native window state and standalone pages cannot report visibility',async()=>{
  const {listeners,calls,tab,send}=boot({store:{'workspaceOpen-4':true}});
  listeners.command('open-workspace',tab);await settle();
  assert.equal(calls.at(-1).type,'close');
  const sender={id:'extension',url:'chrome-extension://extension/panel.html'};
  assert.equal((await send({type:'WORKSPACE_VISIBILITY',windowId:4,visible:true},{...sender,tab})).unhandled,true);
  assert.equal((await send({type:'WORKSPACE_VISIBILITY',windowId:4,visible:true},sender)).ok,true);
  listeners.command('open-workspace',tab);await settle();assert.equal(calls.at(-1).type,'close');
  assert.equal((await send({type:'WORKSPACE_VISIBILITY',windowId:4,visible:false},sender)).ok,true);
  listeners.command('open-workspace',tab);await settle();assert.equal(calls.at(-1).type,'open');
});
test('capture failures never request the retired page shelf',async()=>{
  const {listeners,calls,tab}=boot({captureFails:true});
  listeners.command('receive-screenshot',tab);await settle();
  assert.ok(calls.some(call=>call.type==='capture'));
  assert.ok(!calls.some(call=>['SHOW_SHELF','SHELF_ERROR'].includes(call.type)));
});
