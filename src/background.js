import {validRows} from './core.js';
import {reduceHistory} from './history.js';

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  receivers().catch(()=>{});
});
chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  enqueue(async()=>{
    if((await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']})).length)return;
    let state=await getHistory();
    for(const item of state.items.filter(item=>item.status==='processing'))state=await changeHistory({type:'update',id:item.id,revision:item.revision,patch:{status:'error',error:'上次识别已中断，可在核对字段窗口重新识别'}});
  }).catch(()=>{});
});

// Serialize request creation/consumption so a reused panel cannot read twice.
let requests = Promise.resolve();
function enqueue(operation) {
  const result = requests.then(operation);
  requests = result.catch(() => {});
  return result;
}
const dockURL=chrome.runtime.getURL('panel.html?mode=dock');
const panelSender=sender=>sender.id===chrome.runtime.id && [chrome.runtime.getURL('panel.html'),dockURL].includes(sender.url);
const receiverCache=new Map();
const revokedDocuments=new Set();
const revokedTabs=new Set();
let revocation=Promise.resolve(),revoking=false;
async function injectReceiver(tab) {
  if (!Number.isInteger(tab?.id) || !/^(https?|file):/.test(tab.url || '')) return null;
  try {
    const access=revocation;
    await access;
    const [frame]=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']});
    const current=await chrome.tabs.get(tab.id);
    if(access!==revocation || current.url!==tab.url || !frame?.documentId) {receiverCache.delete(tab.id);return null;}
    const receiver={tabId:tab.id,url:tab.url,documentId:frame.documentId};
    revokedDocuments.delete(frame.documentId);
    revokedTabs.delete(tab.id);
    receiverCache.set(tab.id,receiver);
    await chrome.tabs.sendMessage(tab.id,{type:'ENABLE_RECEIVER'},{documentId:frame.documentId});
    return receiver;
  } catch {receiverCache.delete(tab.id);return null;}
}
async function receivers() {
  const tabs=await chrome.tabs.query({});
  const result=await Promise.all(tabs.map(injectReceiver));
  return result.filter(Boolean);
}
async function openDock() {
  const {dockWindowId}=await chrome.storage.session.get('dockWindowId');
  if(Number.isInteger(dockWindowId)) {
    try {
      const existing=await chrome.windows.get(dockWindowId,{populate:true});
      if(existing.tabs?.some(tab=>tab.url===dockURL)) {await chrome.windows.update(dockWindowId,{focused:true});return;}
    } catch {}
  }
  const window=await chrome.windows.create({url:dockURL,type:'popup',width:390,height:570,focused:true});
  await chrome.storage.session.set({dockWindowId:window.id});
}
const workspaceWindows=new Set(),workspaceTouched=new Set();
let workspaceStateLoaded=false;
const workspaceState=chrome.storage.session.get(null).then(state=>{
  for(const key of Object.keys(state))if(key.startsWith('workspaceOpen-') && state[key]===true){const id=Number(key.slice('workspaceOpen-'.length));if(Number.isInteger(id) && !workspaceTouched.has(id))workspaceWindows.add(id);}
}).catch(()=>{}).finally(()=>{workspaceStateLoaded=true;});
function workspaceVisibility(windowId,visible){
  workspaceTouched.add(windowId);
  if(visible)workspaceWindows.add(windowId);else workspaceWindows.delete(windowId);
  const key=`workspaceOpen-${windowId}`;
  (visible?chrome.storage.session.set({[key]:true}):chrome.storage.session.remove(key)).catch(()=>{});
}
chrome.sidePanel.onOpened?.addListener(({windowId})=>workspaceVisibility(windowId,true));
chrome.sidePanel.onClosed?.addListener(({windowId})=>workspaceVisibility(windowId,false));
const openWorkspace=tab=>chrome.sidePanel.open({windowId:tab.windowId}).then(()=>workspaceVisibility(tab.windowId,true));
function closeWorkspace(windowId){
  return chrome.sidePanel.close({windowId}).then(()=>workspaceVisibility(windowId,false));
}
function toggleWorkspace(tab){
  if(!workspaceStateLoaded)return workspaceState.then(()=>toggleWorkspace(tab));
  return workspaceWindows.has(tab.windowId)?closeWorkspace(tab.windowId):openWorkspace(tab);
}
chrome.action.onClicked.addListener(tab=>{injectReceiver(tab).catch(error=>captureError(tab.id,error));});
chrome.tabs.onUpdated.addListener((id,change,tab)=>{
  if(change.status==='loading' || change.url) receiverCache.delete(id);
  if(change.status==='complete') injectReceiver(tab);
});
chrome.tabs.onRemoved.addListener(id=>{receiverCache.delete(id);revokedTabs.delete(id);chrome.storage.session.remove(`regionSelection-${id}`).catch(()=>{});});
chrome.permissions.onRemoved.addListener(()=>{
  revoking=true;
  for(const receiver of receiverCache.values())revokedDocuments.add(receiver.documentId);
  receiverCache.clear();
  // Injected scripts survive MV3 worker suspension, so enumerate tabs independently of the cache.
  const current=revocation.then(async()=>{
    const tabs=await chrome.tabs.query({});
    await chrome.storage.session.remove('activeDrag');
    await Promise.allSettled(tabs.map(async tab=>{
      revokedTabs.add(tab.id);
      await chrome.tabs.sendMessage(tab.id,{type:'REVOKE_SHELF'},{frameId:0});
    }));
  }).catch(()=>{});
  revocation=current;
  return current.finally(()=>{if(revocation===current)revoking=false;});
});
chrome.permissions.onAdded.addListener(()=>{receivers().catch(()=>{});});
let offscreenStarting=null;
async function ensureProcessor(){
  if(offscreenStarting)return offscreenStarting;
  offscreenStarting=(async()=>{
    if(!(await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT'],documentUrls:[chrome.runtime.getURL('processor.html')]})).length)
      await chrome.offscreen.createDocument({url:'processor.html',reasons:['WORKERS'],justification:'Process imported screenshot images locally using the bundled OCR workers'});
  })();
  try{await offscreenStarting;}finally{offscreenStarting=null;}
}
async function getHistory(){
  const {screenshotHistory,savedCapture}=await chrome.storage.local.get(['screenshotHistory','savedCapture']);
  if(screenshotHistory)return screenshotHistory;
  let state={items:[],selectedId:null};
  if(savedCapture?.image && Array.isArray(savedCapture.rows))state=reduceHistory(state,{type:'add',capture:{...savedCapture,id:crypto.randomUUID(),status:'ready'}});
  await chrome.storage.local.set({screenshotHistory:state,...(state.items.length?{savedCapture:state.items[0]}:{})});return state;
}
async function changeHistory(action){
  const state=reduceHistory(await getHistory(),action);
  if(action.type==='get')return state;
  const savedCapture=state.items.find(item=>item.id===state.selectedId) || null;
  await chrome.storage.local.set({screenshotHistory:state,savedCapture});return state;
}
function contentSender(sender){return !revoking && sender.id===chrome.runtime.id && sender.frameId===0 && !revokedDocuments.has(sender.documentId) && !revokedTabs.has(sender.tab?.id) && Number.isInteger(sender.tab?.id) && /^(https?|file):/.test(sender.url || '');}
let importJobs=0;
async function processImport(message){
  if(typeof message.image!=='string' || message.image.length>17*1024*1024 || !/^data:image\/(png|jpeg|webp|bmp);base64,[A-Za-z0-9+/=]+$/.test(message.image))throw Error('图片格式无效或超过 12 MB');
  if(importJobs>=3)throw Error('已有 3 张图片正在处理，请稍候再导入');
  importJobs++;
  try{
    await ensureProcessor();
    const result=await chrome.runtime.sendMessage({type:'PROCESS_IMAGE',id:crypto.randomUUID(),image:message.image,sourceRows:message.rows || [],masks:message.emptyControlBounds || []});
    if(!result?.ok)throw Error(result?.error || '本机识别失败，请重新导入');
  }finally{importJobs--;}
}
const regionKey=id=>`regionSelection-${id}`;
async function regionSelection(id) {
  const key=regionKey(id);
  return (await chrome.storage.session.get(key))[key];
}
const starting = new Set();
async function captureError(tabId,error) {
  console.warn('Screenshot selection:',error.message);
  await chrome.action.setBadgeText({tabId,text:'!'}).catch(()=>{});
  await chrome.action.setTitle({tabId,title:`截图失败：${error.message}`}).catch(()=>{});
}
async function beginSelection(tab) {
  if (starting.has(tab.id)) return {ok:false,error:'截图正在启动，请稍候'};
  starting.add(tab.id);
  try {
    if (!/^(https?|file):/.test(tab.url || '')) throw new Error('请在普通网页中框选截图');
    const [{result:viewport,documentId:currentDocumentId}] = await chrome.scripting.executeScript({target:{tabId:tab.id},func:()=>({width:innerWidth,height:innerHeight,scrollX,scrollY,scale:visualViewport?.scale || 1})});
    const selection=await regionSelection(tab.id);
    if (selection && selection.documentId===currentDocumentId && selection.expiresAt > Date.now()) {
      await chrome.tabs.sendMessage(tab.id,{type:'CANCEL_REGION'},{frameId:0}).catch(()=>{});
      await chrome.storage.session.remove(regionKey(tab.id));
      return {ok:true};
    }
    if(selection) await chrome.storage.session.remove(regionKey(tab.id));
    const before = await chrome.tabs.get(tab.id);
    if (!before.active || before.url !== tab.url) throw new Error('页面已切换，请重新框选');
    if(!await injectReceiver(tab))throw Error('无法连接来源网页，请刷新后重试');
    const source=await chrome.tabs.sendMessage(tab.id,{type:'SOURCE',geometry:true},{frameId:0});
    await chrome.tabs.sendMessage(tab.id,{type:'HIDE_SHELF',hidden:true});
    let image;
    try {image = await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'});}
    finally {await chrome.tabs.sendMessage(tab.id,{type:'HIDE_SHELF',hidden:false}).catch(()=>{});}
    const after = await chrome.tabs.get(tab.id);
    if (!after.active || after.url !== tab.url) throw new Error('页面已切换，请重新框选');
    const [{documentId}]=await chrome.scripting.executeScript({target:{tabId:tab.id},files:['region.js']});
    if(!documentId) throw new Error('无法确认框选页面，请重试');
    const token=crypto.randomUUID();
    await chrome.storage.session.set({[regionKey(tab.id)]:{token,url:tab.url,windowId:tab.windowId,documentId,expiresAt:Date.now()+120000}});
    const {captureLayout}=await chrome.storage.local.get('captureLayout');
    const response=await chrome.tabs.sendMessage(tab.id,{type:'START_REGION',token,image,viewport,records:source?.ok ? source.rows : [],emptyControlBounds:source?.ok ? source.emptyControlBounds : [],openWorkspace:captureLayout!=='window'},{frameId:0});
    if (!response?.ok) throw new Error(response?.error || '无法启动框选');
    await chrome.action.setBadgeText({tabId:tab.id,text:''});
    await chrome.action.setTitle({tabId:tab.id,title:'打开截图填表'});
    return {ok:true};
  } catch (error) {
    await chrome.storage.session.remove(regionKey(tab.id)).catch(()=>{});await captureError(tab.id,error);
    return {ok:false,error:error.message};
  }
  finally { starting.delete(tab.id); }
}
chrome.commands.onCommand.addListener((command, tab) => {
  if(command==='open-workspace' && Number.isInteger(tab?.windowId)){
    toggleWorkspace(tab).catch(error=>captureError(tab.id,error));return;
  }
  if (command === 'receive-screenshot' && Number.isInteger(tab?.id) && Number.isInteger(tab.windowId)) beginSelection(tab);
});
chrome.runtime.onMessage.addListener((message,sender,respond) => {
  if(message?.type==='WORKSPACE_VISIBILITY'){
    if(sender.url!==chrome.runtime.getURL('panel.html') || !panelSender(sender) || sender.tab || !Number.isInteger(message.windowId) || typeof message.visible!=='boolean')return;
    workspaceVisibility(message.windowId,message.visible);respond({ok:true});return;
  }
  if(message?.type==='CLOSE_WORKSPACE'){
    if(sender.url!==chrome.runtime.getURL('panel.html') || !panelSender(sender) || !Number.isInteger(message.windowId))return;
    closeWorkspace(message.windowId).then(()=>respond({ok:true}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type==='OPEN_WORKSPACE'){
    if(!contentSender(sender))return;
    openWorkspace(sender.tab).then(()=>respond({ok:true}),error=>{captureError(sender.tab.id,error);respond({ok:false,error:'截图会保存在本机，请点击插件图标查看'});});return true;
  }
  if(message?.type==='PANEL_CAPTURE'){
    if(!panelSender(sender) || !Number.isInteger(message.tabId))return;
    chrome.tabs.get(message.tabId).then(tab=>beginSelection(tab)).then(respond,error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type==='INBOX_IMPORT'){
    if(sender.id!==chrome.runtime.id || sender.url!==chrome.runtime.getURL('inbox.html')){respond({ok:false});return;}
    processImport(message).then(()=>respond({ok:true}),error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type==='SETUP_READY'){
    if(sender.id!==chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL('setup.html?tab='))){respond({ok:false});return;}
    receivers().then(()=>respond({ok:true}),()=>respond({ok:false}));return true;
  }
  if(message?.type==='HISTORY'){
    const processorSender=sender.id===chrome.runtime.id && sender.url===chrome.runtime.getURL('processor.html');
    if(!panelSender(sender) && !contentSender(sender) && !processorSender){respond({ok:false});return;}
    const action=message.action;
    if(!action || !['get','add','update','select','delete','clear'].includes(action.type) ||
      (action.type==='add' && (!action.capture || !validRows(action.capture.rows))) ||
      (action.type==='update' && (!action.patch || action.patch.rows!==undefined && !validRows(action.patch.rows)))){respond({ok:false,error:'截图数据无效'});return;}
    enqueue(()=>changeHistory(action)).then(state=>respond({ok:true,state})).catch(error=>respond({ok:false,error:error.message}));return true;
  }
  if(['SHELF_CAPTURE','SHELF_IMPORT','SHELF_EDITOR','SHELF_DRAG','SHELF_SETUP','SHELF_ACCESS'].includes(message?.type)){
    if(!contentSender(sender)){respond({ok:false});return;}
    (async()=>{
      if(message.type==='SHELF_ACCESS'){
        const url=new URL(sender.url),origin=url.protocol==='file:'?'file:///*':`${url.protocol}//${url.hostname}/*`;
        return {ok:true,enabled:await chrome.permissions.contains({origins:[origin]})};
      }
      if(message.type==='SHELF_SETUP'){await chrome.windows.create({url:chrome.runtime.getURL(`setup.html?tab=${sender.tab.id}`),type:'popup',width:420,height:460,focused:true});return {ok:true};}
      if(message.type==='SHELF_CAPTURE')return await beginSelection(sender.tab);
      if(message.type==='SHELF_IMPORT'){await processImport(message);return {ok:true};}
      if(message.type==='SHELF_EDITOR'){
        if(message.id)await enqueue(()=>changeHistory({type:'select',id:message.id}));
        await openDock();return {ok:true};
      }
      if(!/^[a-f0-9-]{36}$/.test(message.key || ''))throw Error('拖拽标记无效');
      return await enqueue(async()=>{
        const state=await getHistory(),item=state.items.find(item=>item.id===message.id);
        if(!item || item.status!=='ready' || item.revision!==message.revision || !validRows(item.rows))throw Error('截图已变化，请重新拖动');
        const targets=receiverCache.size?[...receiverCache.values()]:await receivers();
        await chrome.storage.session.set({activeDrag:{key:message.key,captureId:item.id,revision:item.revision,rows:item.rows,index:-1,syncStates:message.syncStates===true,allowAdd:message.allowAdd===true,expiresAt:Date.now()+60000,targets}});
        await Promise.allSettled(targets.map(target=>chrome.tabs.sendMessage(target.tabId,{type:'DRAG_READY',key:message.key},{documentId:target.documentId})));
        return {ok:true};
      });
    })().then(respond,error=>respond({ok:false,error:error.message}));return true;
  }
  if(['PREPARE_RECEIVERS','REGISTER_DRAG','OPEN_DOCK'].includes(message?.type)) {
    if(!panelSender(sender)) {respond({ok:false});return;}
    if(message.type==='OPEN_DOCK') {openDock().then(()=>respond({ok:true})).catch(()=>respond({ok:false}));return true;}
    if(message.type==='PREPARE_RECEIVERS') {receivers().then(targets=>respond({ok:true,targets})).catch(()=>respond({ok:false}));return true;}
    if(!/^[a-f0-9-]{36}$/.test(message.key || '') || !validRows(message.rows) || !message.rows.length ||
       !Number.isInteger(message.index) || (message.index!==-1 && !message.rows[message.index])) {respond({ok:false});return;}
    enqueue(async()=>{
      const targets=receiverCache.size ? [...receiverCache.values()] : await receivers();
      const history=await getHistory();
      const item=history.items.find(item=>item.id===message.captureId);
      if(message.captureId && (!item || item.revision!==message.revision))throw Error('截图已变化，请重新拖动');
      if(!message.captureId && history.selectedId)throw Error('请重新打开核对窗口后拖动截图');
      const rows=item?.rows || message.rows;
      if(message.index!==-1 && !rows[message.index])throw Error('字段已变化，请重新拖动');
      await chrome.storage.session.set({activeDrag:{key:message.key,...(item?{captureId:item.id,revision:item.revision}:{}),rows,index:message.index,syncStates:message.syncStates===true,allowAdd:message.index===-1 && message.allowAdd===true,expiresAt:Date.now()+60000,targets}});
      await Promise.allSettled(targets.map(target=>Promise.resolve().then(()=>chrome.tabs.sendMessage(target.tabId,{type:'DRAG_READY',key:message.key},{documentId:target.documentId}))));
      return {ok:true,count:targets.length};
    }).then(respond).catch(error=>respond({ok:false,error:error.message}));return true;
  }
  if(message?.type==='CLAIM_DRAG') {
    if(!contentSender(sender)) {respond({ok:false});return;}
    enqueue(async()=>{
      if(!contentSender(sender))return {ok:false,error:'网站访问已撤销，请重新授权'};
      const {activeDrag}=await chrome.storage.session.get('activeDrag');
      if(!activeDrag) return {ok:false,error:'拖拽记录已结束，请重新拖动截图'};
      if(activeDrag.key!==message.key) return {ok:false,error:'拖拽标记未完整传到目标网页，请重新拖动'};
      if(activeDrag.expiresAt<=Date.now()) return {ok:false,error:'拖拽已超时，请重新拖动截图'};
      if(activeDrag.captureId){
        const state=await getHistory();
        if(!state.items.some(item=>item.id===activeDrag.captureId && item.revision===activeDrag.revision))return {ok:false,error:'截图已变化，请重新拖动'};
      }
      const target=activeDrag.targets.find(t=>t.tabId===sender.tab.id && t.url===sender.url && t.documentId===sender.documentId);
      if(!target) return {ok:false,error:activeDrag.targets.some(t=>t.tabId===sender.tab.id) ? '目标网页已变化，请刷新后重新拖动' : '目标网页未连接，请先授权该网站'};
      if((await chrome.tabs.get(sender.tab.id)).url!==target.url) return {ok:false,error:'目标网页已变化，请重新拖动'};
      await chrome.storage.session.remove('activeDrag');
      if(!contentSender(sender))return {ok:false,error:'网站访问已撤销，请重新授权'};
      return {ok:true,drag:{key:activeDrag.key,index:activeDrag.index,rows:activeDrag.rows,syncStates:activeDrag.syncStates,allowAdd:activeDrag.allowAdd===true}};
    }).then(respond).catch(()=>respond({ok:false}));return true;
  }
  if (['REGION_CAPTURE','REGION_CANCEL','REGION_PING'].includes(message?.type)) {
    enqueue(async()=> {
      if(sender.id !== chrome.runtime.id || sender.frameId !== 0 || !Number.isInteger(sender.tab?.id)) {
        return {ok:false,error:'框选请求无效'};
      }
      const selection=await regionSelection(sender.tab?.id);
      if(!selection) return {ok:false,error:'框选记录已丢失，请刷新网页后重试'};
      if(selection.expiresAt <= Date.now()) return {ok:false,error:'框选超过两分钟，请重新按快捷键'};
      if(selection.token !== message.token) return {ok:false,error:'已有新的框选，请完成最新一次框选'};
      if(selection.documentId !== sender.documentId) return {ok:false,error:'页面已刷新，请重新框选'};
      if(new URL(selection.url).origin !== new URL(sender.url).origin) return {ok:false,error:'网站已切换，请重新框选'};
      if (message.type === 'REGION_PING') return {ok:true};
      await chrome.storage.session.remove(regionKey(sender.tab.id));
      if (message.type === 'REGION_CANCEL') return {ok:true};
      if (typeof message.image !== 'string' || message.image.length > 8*1024*1024 || !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(message.image)) {
        return {ok:false,error:'截图过大，请缩小框选范围'};
      }
      if(message.rows && !validRows(message.rows)) return {ok:false,error:'截图字段无效'};
      if(message.emptyControlBounds && (!Array.isArray(message.emptyControlBounds) || message.emptyControlBounds.length>2000 || !message.emptyControlBounds.every(box=>box && ['x','y','width','height'].every(key=>Number.isFinite(box[key])) && box.width>0 && box.height>0))) return {ok:false,error:'空控件区域无效'};
      const {captureLayout}=await chrome.storage.local.get('captureLayout');
      if(captureLayout!=='window'){
        // OCR uses HISTORY messages, which must not wait behind this region request.
        processImport(message).catch(error=>captureError(sender.tab.id,error));
        return {ok:true};
      }
      await chrome.storage.session.set({dockCapture:{
        id:crypto.randomUUID(),tabId:sender.tab.id,windowId:selection.windowId,
        image:message.image,rows:message.rows || [],emptyControlBounds:message.emptyControlBounds || [],expiresAt:Date.now()+120000,
      }});
      await openDock();
      return {ok:true};
    }).then(respond).catch(error=>{captureError(sender.tab?.id,error);respond({ok:false,error:'无法打开截图窗口，请点击插件图标接收截图'});});
    return true;
  }
  if (message?.type !== 'TAKE_CAPTURE_REQUEST') return;
  if (!panelSender(sender) || !Number.isInteger(message.windowId) || (message.dock && sender.url!==dockURL)) {
    respond({ok:false}); return;
  }
  enqueue(async () => {
    const key = message.dock ? 'dockCapture' : `quickCapture-${message.windowId}`;
    const request = (await chrome.storage.session.get(key))[key];
    if (!request) return {ok:true,request:null};
    await chrome.storage.session.set({[key]:null});
    return {ok:true,request:request.expiresAt>Date.now() ? request : null};
  }).then(respond).catch(() => respond({ok:false}));
  return true;
});
