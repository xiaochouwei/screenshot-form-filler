if (!globalThis.__localRegionCapture) {
  globalThis.__localRegionCapture = true;
  let cancel = null;
  chrome.runtime.onMessage.addListener((message,sender,respond) => {
    if (sender.id !== chrome.runtime.id) return;
    if (message?.type === 'CANCEL_REGION') { cancel?.(); respond({ok:true}); return; }
    if (message?.type !== 'START_REGION') return;
    cancel?.();
    start(message).then(()=>respond({ok:true})).catch(error=>respond({ok:false,error:error.message}));
    return true;
  });
  async function start({image,token,viewport,records=[],emptyControlBounds=[],openWorkspace=false}) {
    const unchanged=()=>innerWidth===viewport.width && innerHeight===viewport.height && scrollX===viewport.scrollX && scrollY===viewport.scrollY && (visualViewport?.scale || 1)===viewport.scale;
    const bitmap=await createImageBitmap(await (await fetch(image)).blob());
    if (!unchanged() || viewport.scale!==1) { bitmap.close(); throw new Error('页面尺寸已变化或正在触屏缩放，请重新框选'); }
    const host=document.createElement('div');
    host.id='local-screenshot-selection';
    const shadow=host.attachShadow({mode:'closed'});
    const style=document.createElement('style');
    style.textContent=`
      dialog { all:initial; display:block; position:fixed; inset:0; margin:0; padding:0; border:0; width:100vw; height:100vh; max-width:none; max-height:none; overflow:hidden; cursor:crosshair; touch-action:none; user-select:none; background:#fff; }
      dialog::backdrop { background:transparent; }
      canvas { display:block; position:absolute; inset:0; width:100%; height:100%; pointer-events:none; }
      .box { position:absolute; box-sizing:border-box; border:2px solid #009b78; box-shadow:0 0 0 200vmax #0007; pointer-events:none; }
      output { position:absolute; background:#fff; color:#222; border:1px solid #777; padding:4px 8px; font:12px sans-serif; pointer-events:none; }
    `;
    const dialog=document.createElement('dialog');
    dialog.setAttribute('aria-label','框选截图'); dialog.tabIndex=-1;
    const canvas=document.createElement('canvas');
    canvas.width=bitmap.width; canvas.height=bitmap.height;
    canvas.getContext('2d').drawImage(bitmap,0,0); bitmap.close();
    const box=document.createElement('div'); box.className='box';
    const size=document.createElement('output'); size.hidden=true;
    dialog.append(canvas,box,size); shadow.append(style,dialog); document.documentElement.append(host);
    let origin=null,done=false;
    const send=type=>chrome.runtime.sendMessage({type,token}).catch(()=>{});
    // An explicit selection is bounded to two minutes; messages keep its worker alive.
    const heartbeat=setInterval(()=>send('REGION_PING'),20000);
    const timer=setTimeout(()=>finish(true),120000);
    function finish(notify) {
      if(done) return; done=true;
      clearInterval(heartbeat); clearTimeout(timer);
      window.removeEventListener('resize',abort); window.removeEventListener('scroll',abort,true);
      document.removeEventListener('visibilitychange',hidden);
      dialog.close(); host.remove(); canvas.width=canvas.height=0;
      cancel=null;
      if(notify) send('REGION_CANCEL');
    }
    function abort() { finish(true); }
    function hidden() { if(document.hidden) abort(); }
    cancel=abort;
    dialog.addEventListener('cancel',event=>{event.preventDefault();abort();});
    dialog.addEventListener('keydown',event=>{event.stopPropagation();if(event.key==='Escape') {event.preventDefault();abort();}});
    dialog.addEventListener('wheel',event=>event.preventDefault(),{passive:false});
    const point=event=>({x:Math.max(0,Math.min(innerWidth,event.clientX)),y:Math.max(0,Math.min(innerHeight,event.clientY))});
    const rect=event=>{const end=point(event);return {x:Math.min(origin.x,end.x),y:Math.min(origin.y,end.y),width:Math.abs(origin.x-end.x),height:Math.abs(origin.y-end.y)};};
    dialog.addEventListener('pointerdown',event=>{
      if(!event.isTrusted || event.button!==0 || done) return;
      event.preventDefault(); event.stopPropagation();
      origin=point(event); dialog.setPointerCapture(event.pointerId);
      Object.assign(box.style,{left:`${origin.x}px`,top:`${origin.y}px`,width:'0px',height:'0px'});
    });
    dialog.addEventListener('pointermove',event=>{
      if(!origin || done) return;
      const r=rect(event);
      Object.assign(box.style,{left:`${r.x}px`,top:`${r.y}px`,width:`${r.width}px`,height:`${r.height}px`});
      size.hidden=false; size.textContent=`${Math.round(r.width)} × ${Math.round(r.height)}`;
      Object.assign(size.style,{left:`${Math.min(r.x,Math.max(0,innerWidth-140))}px`,top:`${r.y>32?r.y-30:Math.min(innerHeight-30,r.y+r.height+4)}px`});
    });
    dialog.addEventListener('pointercancel',abort);
    dialog.addEventListener('pointerup',event=>{
      if(!event.isTrusted || !origin || event.button!==0 || done) return;
      event.preventDefault(); event.stopPropagation();
      if(!unchanged()) {abort();return;}
      const r=rect(event); origin=null;
      if(r.width<8 || r.height<8) {size.hidden=true;box.style.width=box.style.height='0px';return;}
      const sx=canvas.width/viewport.width,sy=canvas.height/viewport.height;
      const x=Math.round(r.x*sx),y=Math.round(r.y*sy);
      const crop=document.createElement('canvas');
      crop.width=Math.max(1,Math.round((r.x+r.width)*sx)-x); crop.height=Math.max(1,Math.round((r.y+r.height)*sy)-y);
      crop.getContext('2d').drawImage(canvas,x,y,crop.width,crop.height,0,0,crop.width,crop.height);
      const data=crop.toDataURL('image/png'); crop.width=crop.height=0;
      const rows=records.filter(row=>row.bounds && row.bounds.x>=r.x && row.bounds.y>=r.y && row.bounds.x+row.bounds.width<=r.x+r.width && row.bounds.y+row.bounds.height<=r.y+r.height).map(({bounds,...row})=>row);
      const masks=emptyControlBounds.flatMap(box=>{
        const left=Math.max(r.x,box.x),top=Math.max(r.y,box.y),right=Math.min(r.x+r.width,box.x+box.width),bottom=Math.min(r.y+r.height,box.y+box.height);
        return right>left && bottom>top ? [{x:(left-r.x)*sx,y:(top-r.y)*sy,width:(right-left)*sx,height:(bottom-top)*sy}] : [];
      });
      if(openWorkspace)chrome.runtime.sendMessage({type:'OPEN_WORKSPACE'}).catch(()=>{});
      chrome.runtime.sendMessage({type:'REGION_CAPTURE',token,image:data,rows,emptyControlBounds:masks}).then(result=>{
        if(!result?.ok) alert(result?.error || '截图接收失败，请重新框选');
      }).catch(()=>alert('插件已更新或连接中断，请刷新网页后重试'));
      finish(false);
    });
    dialog.showModal(); dialog.focus({preventScroll:true});
    window.addEventListener('resize',abort); window.addEventListener('scroll',abort,true);
    document.addEventListener('visibilitychange',hidden);
  }
}
