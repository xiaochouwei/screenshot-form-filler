import {createElement,Camera,ClipboardPaste,Upload,ChevronUp,ChevronDown,Trash2,SlidersHorizontal,ArrowDownToLine,X,Link} from 'lucide';
import {canAutoConfirmMulti} from './confirmations.js';
import {rowSelected,rowReady} from './row-state.js';

export function createShelf({scan,preview,fill,inspect,armLocal}) {
  const host=document.createElement('div');host.id='local-screenshot-shelf';
  host.style.cssText='all:initial;position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:2147483646;max-width:calc(100vw - 16px);width:660px;color-scheme:light;';
  const root=host.attachShadow({mode:'closed'});
  const style=document.createElement('style');
  style.textContent=`
  :host{font:13px "Microsoft YaHei",system-ui,sans-serif;color:#25332f;letter-spacing:0}*{box-sizing:border-box;letter-spacing:0}button,select{font:inherit}button{cursor:pointer;border:1px solid #d9e1df;background:#fff;color:#33443e;border-radius:4px;min-height:32px;display:inline-flex;gap:6px;align-items:center;justify-content:center;padding:6px 10px}button:hover{background:#eef6f2}button:disabled{opacity:.45;cursor:default}button:focus-visible,select:focus-visible{outline:2px solid #087d68;outline-offset:2px}svg{width:16px;height:16px;flex-shrink:0}.icon{padding:6px;width:32px;flex-shrink:0}.handle{display:flex;margin:0 auto;min-width:130px;border-radius:0 0 5px 5px;border-top:3px solid #087d68;box-shadow:0 2px 6px #0001;font-size:12px}.body{border:1px solid #d9e1df;border-top:3px solid #087d68;border-radius:0 0 6px 6px;background:#fff;box-shadow:0 4px 18px #0002;padding:10px}.tools{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.tools strong{margin-right:auto;font-size:13px}.cards{display:flex;gap:8px;overflow-x:auto;padding:12px 0 8px;min-height:44px}.card{position:relative;width:112px;flex:0 0 112px;padding:4px;display:flex;flex-direction:column;gap:3px;align-items:stretch;min-height:90px}.card[aria-pressed=true]{border:2px solid #087d68;padding:3px}.card[draggable=true]{cursor:grab}.card img{width:100%;height:60px;object-fit:contain;background:#f2f4f3;pointer-events:none}.card span{font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.bottom{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.primary{background:#087d68;color:white;border-color:#087d68}.primary:hover{background:#066552}output{display:block;line-height:1.6;font-size:12px;overflow-wrap:anywhere;margin-top:7px}.error{color:#aa3c30}select{max-width:100%;min-height:32px;border:1px solid #d9e1df;border-radius:4px;background:#fff;padding:4px}.summary{margin-right:auto;font-size:12px}.sync{display:flex;align-items:center;font-size:11px;gap:5px}.sync input{accent-color:#087d68}details{font-size:11px;color:#64766e;margin-top:6px;max-height:140px;overflow:auto}li{margin:5px 0;overflow-wrap:anywhere}[hidden]{display:none!important}@media(max-width:440px){.body{padding:8px}.tools strong{width:100%}.card{width:96px;flex-basis:96px}.tools{gap:4px}}
  `;
  const make=(tag,attrs={},text='')=>{const n=document.createElement(tag);for(const [k,v]of Object.entries(attrs))n.setAttribute(k,v);if(text)n.textContent=text;return n;};
  const button=(name,icon,fn,compact=false)=>{const n=make('button',{type:'button',title:name,'aria-label':name,...(compact?{class:'icon'}:{})});if(icon)n.append(createElement(icon));if(!compact)n.append(document.createTextNode(name));n.addEventListener('click',()=>Promise.resolve().then(fn).catch(error=>status(error.message,true)));return n;};
  let state={items:[],selectedId:null},expanded=false,dragging=false,pendingRefresh=false,working=false,refreshSequence=0,destroyed=false;
  const body=make('div',{class:'body',hidden:''}),handle=button('展开图片架',ChevronDown,()=>open(true));handle.className='handle';
  const tools=make('div',{class:'tools'});tools.append(make('strong',{},'截图填表'));
  const file=make('input',{type:'file',accept:'image/png,image/jpeg,image/webp,image/bmp',hidden:''});
  tools.append(button('截图',Camera,()=>runtime({type:'SHELF_CAPTURE'})),button('粘贴图片',ClipboardPaste,async()=>{
    try {const items=await navigator.clipboard.read();for(const item of items){const type=item.types.find(t=>['image/png','image/jpeg','image/webp','image/bmp'].includes(t));if(type){await importImage(await item.getType(type));return;}}status('剪贴板中没有图片',true);}
    catch {await runtime({type:'SHELF_EDITOR',paste:true});status('请在打开的图片窗口按 Ctrl+V 粘贴图片');}
  }),button('导入图片',Upload,()=>file.click(),true),button('核对字段',SlidersHorizontal,()=>runtime({type:'SHELF_EDITOR',id:current()?.id}),true),button('删除所选图片',Trash2,async()=>{if(current())await history({type:'delete',id:current().id});},true),button('清空图片架',X,async()=>{await history({type:'clear'});},true),button('收起图片架',ChevronUp,()=>open(false),true));
  const cards=make('div',{class:'cards','aria-label':'截图列表'}),bottom=make('div',{class:'bottom'}),summary=make('span',{class:'summary'},'暂无截图');
  const inbox=make('iframe',{title:'图片接收区',src:chrome.runtime.getURL('inbox.html'),allow:'clipboard-read; clipboard-write'});
  inbox.style.cssText='width:112px;min-width:112px;height:90px;border:0;flex-shrink:0;';
  const scope=make('select',{'aria-label':'目标表单',hidden:''});
  const sync=make('input',{type:'checkbox'}),syncLabel=make('label',{class:'sync'});syncLabel.append(sync,document.createTextNode('同步状态'));
  const add=make('input',{type:'checkbox'}),addLabel=make('label',{class:'sync',title:'允许调用网页已有且归属明确的添加入口，单次最多新增 5 行'});addLabel.append(add,document.createTextNode('允许增项'));
  const fillButton=button('开始填入',ArrowDownToLine,async()=>{
    const item=current();if(!item)return;
    const url=location.href,selectedScope=scope.value,syncStates=sync.checked,allowAdd=add.checked;
    working=true;fillButton.disabled=true;
    try {
      const latest=await runtime({type:'HISTORY',action:{type:'get'}});
      if(destroyed)throw Error('网站访问已撤销，请重新授权');
      if(location.href!==url || scope.value!==selectedScope || sync.checked!==syncStates || add.checked!==allowAdd)throw Error('页面已变化，请重新选择后填写');
      if(!latest.state.items.some(record=>record.id===item.id && record.revision===item.revision))throw Error('截图已变化，请重新选择后填写');
      const data=await scan();if(!data.ok)throw Error(data.error);chooseScopes(data);
      if(selectedScope && !data.scopes.some(record=>record.id===selectedScope))throw Error('目标表单已变化，请重新选择');
      if(!scope.value){status('请选择目标表单',true);return;}
      const approved=preview({token:data.token,scopeId:scope.value,rows:item.rows,syncStates,allowAdd});
      if(!approved.ok)throw Error(approved.error);
      const result=await fill({token:data.token,previewId:approved.previewId});
      if(!result.ok)throw Error(result.error);showResult(result.results);
    }
    finally{working=false;fillButton.disabled=!ready(current());}
  });fillButton.className='primary';
  const output=make('output',{'aria-live':'polite'}),details=make('details'),list=make('ul');details.append(make('summary',{},'填写详情'),list);details.hidden=true;
  const access=button('启用网站',Link,()=>runtime({type:'SHELF_SETUP'}));access.hidden=true;
  tools.append(button('网站访问设置',Link,()=>runtime({type:'SHELF_SETUP'}),true));
  bottom.append(summary,scope,syncLabel,addLabel,fillButton);body.append(tools,cards,bottom,output,details,access,file);root.append(style,handle,body);document.documentElement.append(host);
  function current(){return state.items.find(item=>item.id===state.selectedId);}
  const ready=item=>item?.status==='ready' && item.rows.some(row=>rowReady(row) || canAutoConfirmMulti(row));
  function status(text,error=false){output.textContent=text;output.className=error?'error':'';}
  async function runtime(message){const response=await chrome.runtime.sendMessage(message);if(!response?.ok)throw Error(response?.error || '插件未响应，请刷新网页');return response;}
  async function history(action){const response=await runtime({type:'HISTORY',action});state=response.state;render();await analyze();return response;}
  function chooseScopes(data){const old=scope.value;scope.replaceChildren(make('option',{value:''},'选择目标表单'),...data.scopes.map(s=>make('option',{value:s.id},`${s.name} · ${s.count} 个字段`)));scope.hidden=data.scopes.length<2;if(data.scopes.some(s=>s.id===old))scope.value=old;else if(data.scopes.length===1)scope.value=data.scopes[0].id;}
  async function analyze(){
    if(destroyed || working || dragging || !expanded)return;
    try{
      const item=current(),pending=item?.rows.filter(row=>rowSelected(row) && !rowReady(row) && !canAutoConfirmMulti(row)).length || 0;
      if(!ready(item)){
        summary.textContent=item?.status==='processing'?'本机识别中…':item?.status==='error'?'识别失败':pending?`${pending} 项待核对`:'暂无可填写字段';
        fillButton.disabled=true;return;
      }
      const data=inspect({scopeId:scope.value,rows:item.rows,syncStates:sync.checked,allowAdd:add.checked});chooseScopes(data);
      if(data.resolvedRows.some((row,index)=>row.confirmed && !item.rows[index].confirmed)){
        await history({type:'update',id:item.id,revision:item.revision,patch:{rows:data.resolvedRows}});return;
      }
      fillButton.disabled=false;
      if(!scope.value){summary.textContent=`${item.rows.filter(rowSelected).length} 项 · 选择表单`;return;}
      summary.textContent=`${data.plan.filter(p=>p.ready).length} 项可填写${pending?` · ${pending} 待核对`:''}${data.plan.some(p=>p.create)?' · 含增项':''}`;
    }catch(error){status(error.message,true);}
  }
  function render(){
    if(dragging){pendingRefresh=true;return;}
    for(const card of cards.querySelectorAll('[data-capture-id]'))card.remove();
    for(const item of state.items){
      const card=make('button',{type:'button',class:'card','data-capture-id':item.id,'aria-label':item.info || '截图','aria-pressed':String(item.id===state.selectedId),draggable:String(ready(item))});
      const img=make('canvas',{'role':'img','aria-label':item.info || '截图',width:'216',height:'120'});
      img.style.cssText='width:100%;height:60px;pointer-events:none;background:#f2f4f3;';
      const match=/^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(item.image);
      if(match)createImageBitmap(new Blob([Uint8Array.from(atob(match[2]),character=>character.charCodeAt(0))],{type:match[1]})).then(bitmap=>{
        const factor=Math.min(img.width/bitmap.width,img.height/bitmap.height);
        img.getContext('2d').drawImage(bitmap,(img.width-bitmap.width*factor)/2,(img.height-bitmap.height*factor)/2,bitmap.width*factor,bitmap.height*factor);bitmap.close();
      }).catch(()=>{});
      const pending=item.rows.filter(row=>rowSelected(row) && !rowReady(row) && !canAutoConfirmMulti(row)).length;
      const caption=make('span',{},item.status==='processing'?'正在识别…':item.status==='error'?'识别失败':`${item.rows.filter(rowSelected).length} 项${pending?` · ${pending} 待核对`:''} · ${new Date(item.createdAt).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`);
      card.append(img,caption);
      card.addEventListener('click',()=>history({type:'select',id:item.id}).catch(e=>status(e.message,true)));
      card.addEventListener('dragstart',event=>{
        if(!ready(item) || working){event.preventDefault();return;}
        dragging=true;
        const key=crypto.randomUUID();
        const registration=runtime({type:'SHELF_DRAG',id:item.id,revision:item.revision,key,syncStates:sync.checked,allowAdd:add.checked});
        registration.catch(e=>status(e.message,true));
        armLocal({key,registration,index:-1,rows:structuredClone(item.rows),syncStates:sync.checked,allowAdd:add.checked,url:location.href,expires:Date.now()+60000});
        event.dataTransfer.effectAllowed='copy';
        event.dataTransfer.setData('application/x-local-screenshot-field',key);
        event.dataTransfer.setData('text/plain',`local-screenshot:${key}`);
        event.dataTransfer.setDragImage(card,card.offsetWidth/2,card.offsetHeight/2);
        host.style.pointerEvents='none';host.style.opacity='.35';
      });
      card.addEventListener('dragend',()=>{
        dragging=false;host.style.pointerEvents='';host.style.opacity='';
        if(pendingRefresh){pendingRefresh=false;render();}
      });
      cards.insertBefore(card,inbox.parentNode===cards?inbox:null);
    }
    if(!inbox.isConnected)cards.append(inbox);
    fillButton.disabled=working || !ready(current());
    if(current()?.status==='error')status(current().error || '识别失败，请打开核对字段后重试',true);
  }
  function open(value){const changed=expanded!==value;expanded=value;body.hidden=!value;handle.hidden=value;if(value && changed){refresh();analyze();}}
  async function refresh(){if(destroyed)return;const sequence=++refreshSequence;try{const response=await runtime({type:'HISTORY',action:{type:'get'}});if(destroyed || sequence!==refreshSequence)return;state=response.state;render();await analyze();const permission=await runtime({type:'SHELF_ACCESS'});access.hidden=permission.enabled;}catch(error){status(error.message,true);}}
  async function importImage(blob){if(blob.size>12*1024*1024)throw Error('图片大小须在 12 MB 以内');const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});open(true);status('正在本机识别…');await runtime({type:'SHELF_IMPORT',image});status('识别完成');}
  root.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.stopPropagation();event.dataTransfer.dropEffect='copy';}});
  root.addEventListener('drop',event=>{if(!event.dataTransfer?.types.includes('Files'))return;event.preventDefault();event.stopPropagation();status('此位置不接收文件，请使用图片接收区或导入按钮',true);});
  file.addEventListener('change',()=>{if(file.files[0])importImage(file.files[0]).catch(e=>status(e.message,true));file.value='';});
  sync.addEventListener('change',()=>{chrome.storage.local.set({syncStates:sync.checked});analyze();});scope.addEventListener('change',analyze);add.addEventListener('change',analyze);
  chrome.storage.local.get('syncStates').then(value=>{sync.checked=value.syncStates===true;});
  chrome.storage.onChanged.addListener((changes,area)=>{if(area!=='local')return;if(changes.screenshotHistory)refresh();if(changes.syncStates){sync.checked=changes.syncStates.newValue===true;analyze();}});
  document.addEventListener('focusin',event=>{if(expanded && !event.composedPath().includes(host))analyze();});
  let refreshTimer;
  const changed=()=>{clearTimeout(refreshTimer);refreshTimer=setTimeout(analyze,180);};
  document.addEventListener('input',event=>{if(!event.composedPath().includes(host))changed();});
  document.addEventListener('change',event=>{if(!event.composedPath().includes(host))changed();});
  const observer=new MutationObserver(records=>{if(expanded && !working && !dragging && records.some(record=>record.target!==host))changed();});
  observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','readonly','aria-disabled','aria-checked','hidden']});
  window.addEventListener('focus',()=>{if(expanded)refresh();});
  function showResult(results){open(true);const filled=results.filter(r=>r.status==='filled').length;summary.textContent=`已填写 ${filled} 项`;status(`已填写 ${filled} 项，跳过或失败 ${results.length-filled} 项`);list.replaceChildren(...results.map(r=>make('li',{},`${r.label}：${r.reason || r.status}`)));details.hidden=false;}
  refresh();
  return {open,showResult,status,host,destroy(){destroyed=true;observer.disconnect();clearTimeout(refreshTimer);host.remove();state={items:[],selectedId:null};},setFilling(value){working=value;fillButton.disabled=value || !ready(current());}};
}
