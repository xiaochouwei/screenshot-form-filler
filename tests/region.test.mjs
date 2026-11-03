import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {build} from 'esbuild';

test('shortcut captures before selection; only a valid selection opens the panel and queues an image once', async () => {
  const listeners={},store={},opened=[],sent=[],calls=[];
  const tab={id:17,windowId:4,url:'https://example.test/form',active:true};
  const viewport={width:1000,height:700,scrollX:0,scrollY:0,scale:1};
  const event=name=>({addListener:fn=>{listeners[name]=fn;}});
  const chrome={
    commands:{onCommand:event('command')},
    runtime:{id:'test-id',getURL:p=>`chrome-extension://test-id/${p}`,onInstalled:event('install'),onStartup:event('startup'),onMessage:event('message')},
    sidePanel:{setPanelBehavior:async()=>{}},
    windows:{create:async options=>{opened.push(options);return {id:40};}},
    action:{onClicked:event('action'),setBadgeText:async()=>{},setTitle:async()=>{},setBadgeBackgroundColor:async()=>{}},
    tabs:{onUpdated:event('updated'),onRemoved:event('removed'),get:async()=>tab,query:async()=>[tab],captureVisibleTab:async()=>{calls.push('capture');return 'data:image/png;base64,AAAA';},sendMessage:async(id,msg)=>{calls.push(msg.type);sent.push(msg);return {ok:true,rows:[]};}},
    permissions:{onRemoved:event('permissionRemoved'),onAdded:event('permissionAdded')},
    scripting:{executeScript:async options=>{if(options.files) calls.push('inject');return [{documentId:'document-17',result:viewport}];}},
    storage:{local:{get:async()=>({captureLayout:'window'})},session:{get:async key=>({[key]:store[key]}),set:async values=>Object.assign(store,values),remove:async key=>{delete store[key];}}},
  };
  const bundled=await build({entryPoints:['src/background.js'],bundle:true,write:false,platform:'browser',format:'iife'});
  vm.runInNewContext(bundled.outputFiles[0].text,{chrome,crypto:globalThis.crypto,Date,console,setTimeout,clearTimeout,URL});
  listeners.command('receive-screenshot',tab);
  await new Promise(r=>setImmediate(r));
  assert.equal(opened.length,0,'Do not resize the source by opening the side panel before capture');
  assert.ok(calls.indexOf('capture')>=0 && calls.indexOf('capture')<calls.indexOf('START_REGION'));
  const selection=sent.find(m=>m.type==='START_REGION');
  assert.ok(selection?.token);
  const send=(message,sender={id:'test-id',url:tab.url,tab,frameId:0,documentId:'document-17'})=>new Promise(resolve=>listeners.message(message,sender,resolve));
  assert.equal((await send({type:'REGION_CAPTURE',token:'invalid',image:'data:image/png;base64,AAAA'})).ok,false);
  const pending=send({type:'REGION_CAPTURE',token:selection.token,image:'data:image/png;base64,AAAA'});
  assert.equal((await pending).ok,true);
  assert.equal(opened.length,1);
  assert.equal(opened[0].type,'popup');
  const panel={id:'test-id',url:'chrome-extension://test-id/panel.html?mode=dock'};
  const {request}=await send({type:'TAKE_CAPTURE_REQUEST',windowId:40,dock:true},panel);
  assert.equal(request.image,'data:image/png;base64,AAAA');
  assert.equal(request.tabId,17);
  assert.equal((await send({type:'TAKE_CAPTURE_REQUEST',windowId:40,dock:true},panel)).request,null);
  assert.equal((await send({type:'REGION_CAPTURE',token:selection.token,image:'data:image/png;base64,AAAA'})).ok,false,'Selection cannot replay');
  assert.equal((await send({type:'TAKE_CAPTURE_REQUEST',windowId:4})).ok,false,'Web content cannot take image payloads');
});
