import {chromium} from 'playwright';
import path from 'node:path';
import assert from 'node:assert/strict';

const extension=path.resolve(import.meta.dirname,'../dist');
const context=await chromium.launchPersistentContext('',{headless:true,executablePath:process.env.TEST_CHROMIUM,args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`]});
try {
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const imagePage=await context.newPage();
  const image=await imagePage.evaluate(()=>{
    const canvas=document.createElement('canvas');canvas.width=2400;canvas.height=400;
    const ctx=canvas.getContext('2d');ctx.fillStyle='white';ctx.fillRect(0,0,2400,400);
    ctx.fillStyle='black';ctx.font='20px Arial';ctx.fillText('Name',60,90);ctx.fillText('Example',300,90);
    return canvas.toDataURL('image/png');
  });
  await imagePage.close();
  await worker.evaluate(image=>chrome.storage.session.set({dockCapture:{id:crypto.randomUUID(),image,rows:[],emptyControlBounds:[{x:2100,y:40,width:240,height:48}],expiresAt:Date.now()+120000}}),image);
  const panel=await context.newPage();
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html?mode=dock`);
  await panel.waitForFunction(()=>document.getElementById('image-info').textContent.startsWith('2400') && !document.getElementById('choose').disabled && document.getElementById('cancel').hidden,null,{timeout:120000});
  const read=()=>panel.evaluate(async()=>{
    const {savedCapture}=await chrome.storage.local.get('savedCapture');
    const image=new Image();image.src=savedCapture.image;await image.decode();
    const dimensions={width:image.naturalWidth,height:image.naturalHeight};
    return {box:savedCapture.emptyControlBounds[0],...dimensions};
  });
  const saved=await read();
  assert.equal(saved.width,2000);
  assert.equal(saved.box.x,1750,'Masks must be saved in the resized image coordinate space');
  assert.equal(saved.box.width,200);
  assert.equal(saved.box.y,40*saved.height/400);
  await panel.reload();
  await panel.waitForFunction(()=>!document.getElementById('choose').disabled && !document.getElementById('image').hidden);
  await panel.locator('#recognize').click();
  await panel.waitForFunction(()=>!document.getElementById('choose').disabled && document.getElementById('cancel').hidden,null,{timeout:120000});
  assert.deepEqual(await read(),saved,'Restoring and re-recognizing must not scale the masks a second time');
  console.log('PASS: large screenshot saved at 2000px, aligned placeholder masks, reload and offline re-recognition preserve coordinates');
} finally {await context.close();}
