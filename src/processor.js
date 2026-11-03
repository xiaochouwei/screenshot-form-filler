import {prepareImage,localProvider} from './ocr.js';
import {extractRows} from './core.js';
import {mergeRecords} from './records.js';

let queue=Promise.resolve();
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
  if(sender.id!==chrome.runtime.id || message?.type!=='PROCESS_IMAGE')return;
  queue=queue.catch(()=>{}).then(()=>processImage(message));
  queue.then(respond,error=>respond({ok:false,error:error.message}));return true;
});
async function history(action){const response=await chrome.runtime.sendMessage({type:'HISTORY',action});if(!response?.ok)throw Error(response?.error || '图片保存失败');return response.state;}
async function processImage({id,image,sourceRows=[],masks=[]}) {
  let prepared,record,controller;
  try {
    const match=/^data:(image\/(?:png|jpeg|webp|bmp));base64,([A-Za-z0-9+/=]+)$/.exec(image);
    if(!match)throw Error('图片格式无效');
    const blob=new Blob([Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0))],{type:match[1]});
    prepared=await prepareImage(blob);
    const bitmap=await createImageBitmap(blob),canvas=document.createElement('canvas');
    const factor=Math.min(1,2000/Math.max(bitmap.width,bitmap.height));
    canvas.width=Math.round(bitmap.width*factor);canvas.height=Math.round(bitmap.height*factor);
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height);bitmap.close();
    const normalizedMasks=masks.map(box=>({x:box.x*canvas.width/prepared.width,y:box.y*canvas.height/prepared.height,width:box.width*canvas.width/prepared.width,height:box.height*canvas.height/prepared.height}));
    const state=await history({type:'add',capture:{id,image:canvas.toDataURL('image/jpeg',.88),rows:[],sourceRows,emptyControlBounds:normalizedMasks,maskCoordinates:'saved-image',status:'processing',info:`${prepared.width} × ${prepared.height}`}});
    canvas.width=canvas.height=0;record=state.items.find(item=>item.id===id);
    const ctx=prepared.canvas.getContext('2d');ctx.fillStyle='#fff';
    for(const box of masks)ctx.fillRect(box.x*prepared.canvas.width/prepared.width,box.y*prepared.canvas.height/prepared.height,box.width*prepared.canvas.width/prepared.width,box.height*prepared.canvas.height/prepared.height);
    controller=new AbortController();const timer=setTimeout(()=>controller.abort(),120000);
    let evidence;
    try{evidence=await localProvider.recognize(prepared.canvas,{signal:controller.signal});}finally{clearTimeout(timer);}
    await history({type:'update',id,revision:record.revision,patch:{rows:mergeRecords(extractRows(evidence.words,evidence.boxes).slice(0,200),sourceRows),raw:evidence.text,status:'ready',error:''}});
    return {ok:true,id};
  } catch(error) {
    if(record)await history({type:'update',id,revision:record.revision,patch:{status:'error',error:error.name==='AbortError'?'识别超时，请核对图片后重试':error.message}}).catch(()=>{});
    return {ok:false,error:error.message};
  } finally {if(prepared)prepared.canvas.width=prepared.canvas.height=0;}
}
