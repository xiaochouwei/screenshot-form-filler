import { createIcons, ScanText, Trash2, ImagePlus, Upload, ClipboardPaste, ScanLine, X, Plus, RefreshCw, ListChecks, ArrowDownToLine, Check, Minus, CircleAlert, Maximize2, GripVertical, Link, Camera, ExternalLink, Settings2, Keyboard } from 'lucide';
import { extractRows } from './core.js';
import { localProvider, prepareImage } from './ocr.js';
import {mergeRecords} from './records.js';
import {canAutoConfirmMulti} from './confirmations.js';
import {rowSelected,rowReview,rowReady,selectRow,reviewRow} from './row-state.js';

const icons = { ScanText, Trash2, ImagePlus, Upload, ClipboardPaste, ScanLine, X, Plus, RefreshCw, ListChecks, ArrowDownToLine, Check, Minus, CircleAlert, Maximize2, GripVertical, Link, Camera, ExternalLink, Settings2, Keyboard };
const $ = id => document.getElementById(id);
const paintIcons = () => createIcons({ icons });
const dock=new URLSearchParams(location.search).get('mode')==='dock';
document.body.classList.toggle('dock',dock);
if(dock) $('workspace-details').open=false;
let receiverTabs=[];
let receiverTargets=new Set();
let refreshingReceivers=null;
let sourceTabId=null;
let rows = [];
let sourceRows = [];
let imageBlob = null;
let imageUrl = '';
let scan = null;
let preview = null;
let abortController = null;
let busy = false;
let generation = 0;
let savedImage = '';
let sourceHash = '';
let emptyControlBounds = [];
let savedMaskScale = {x:1,y:1};
let saveQueue = Promise.resolve();
let dragKey = crypto.randomUUID();
let panelWindowId = null;
let initialized = false;
let pendingShortcut = null;
let shortcutRunning = false;
let shortcutAgain = false;
let captureRef=null;
let panelSaving=0;
let restorePending=false;
let restoring=false;
let captureStatus='ready';
let summaryMode='source';
let currentPageTab=null;
async function refreshCurrentPage(){
  try{
    const tab=await activeTab(),url=new URL(tab.url);
    currentPageTab=tab;
    $('current-page-title').textContent=tab.title || url.hostname;
    $('current-page-title').title=tab.title || tab.url;
    $('current-page-url').textContent=url.hostname || '本地文件';
    const connected=receiverTargets.has(tab.id);
    $('current-page-connection').textContent=connected?'已连接':'待连接';
    $('current-page-connection').dataset.state=connected?'connected':'pending';
    $('connect-current').hidden=connected;
  }catch{
    currentPageTab=null;$('connect-current').hidden=true;
    $('current-page-title').textContent='请选择普通网页';$('current-page-url').textContent='';
    $('current-page-connection').textContent='不可用';$('current-page-connection').dataset.state='error';
  }
}
$('connect-current').addEventListener('click',async()=>{
  const tab=currentPageTab;if(!tab)return;
  const url=new URL(tab.url),origin=url.protocol==='file:'?'file:///*':`${url.protocol}//${url.hostname}/*`;
  try{
    if(!await chrome.permissions.request({origins:[origin]})){status('网站未授权，未连接',true);return;}
    await refreshReceivers();status('当前网站已连接');
  }catch(error){status(error.message || '网站连接失败',true);}
});
function renderHistory(state){
  $('capture-history').replaceChildren();$('history-empty').hidden=!!state.items.length;
  for(const item of state.items){
    const button=document.createElement('button');button.type='button';button.disabled=busy;button.className='history-item';button.dataset.captureId=item.id;button.setAttribute('aria-pressed',String(item.id===state.selectedId));
    const image=document.createElement('img');image.src=item.image;image.alt='';
    const caption=document.createElement('span');caption.className='history-caption';caption.textContent=new Date(item.createdAt).toLocaleTimeString([],{hour:'2-digit',minute:'2-digit'});
    const stateLabel=document.createElement('span');stateLabel.className='history-state';stateLabel.textContent=item.status==='processing'?'识别中':item.status==='error'?'识别失败':`${item.rows.length} 项`;
    button.title=`${caption.textContent} · ${stateLabel.textContent}`;button.setAttribute('aria-label',`选择图片 ${caption.textContent} ${stateLabel.textContent}`);button.append(image,caption,stateLabel);
    button.addEventListener('click',async()=>{
      if(busy || item.id===captureRef?.id)return;
      setBusy(true);
      try{await saveQueue;const response=await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'select',id:item.id}});if(!response?.ok)throw Error(response?.error || '图片已变化');}
      catch(error){status(error.message,true);}
      finally{setBusy(false);await restore();}
    });
    $('capture-history').append(button);
  }
}
$('settings-toggle').addEventListener('click',()=>{
  const open=$('settings-section').hidden;$('settings-section').hidden=!open;$('settings-toggle').setAttribute('aria-expanded',String(open));
  if(open)refreshReceivers();
});
$('popout').addEventListener('click',async()=>{try{await saveQueue;const result=await chrome.runtime.sendMessage({type:'OPEN_DOCK'});if(!result?.ok)throw Error('无法打开图片窗口');}catch(error){status(error.message,true);}});
$('close-workspace').addEventListener('click',async()=>{
  try{await saveQueue;if(dock){window.close();return;}const response=await chrome.runtime.sendMessage({type:'CLOSE_WORKSPACE',windowId:panelWindowId});if(!response?.ok)throw Error(response?.error || '无法关闭侧栏');}
  catch(error){status(error.message,true);}
});
$('shortcut-settings').addEventListener('click',()=>chrome.tabs.create({url:navigator.userAgent.includes('Edg/')?'edge://extensions/shortcuts':'chrome://extensions/shortcuts'}));
$('clear-history').addEventListener('click',async()=>{
  if(busy || !confirm('清空全部本机图片记录？'))return;
  try{await saveQueue;const response=await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'clear'}});if(!response?.ok)throw Error(response?.error || '清空失败');status('图片历史已清空');}
  catch(error){status(error.message,true);}
});
$('region-capture').addEventListener('click',async()=>{
  setBusy(true);
  try{const tab=await connect();const response=await chrome.runtime.sendMessage({type:'PANEL_CAPTURE',tabId:tab.id});if(!response?.ok)throw Error(response?.error || '无法开始截图');status('正在框选网页…');}
  catch(error){status(error.message,true);}
  finally{setBusy(false);}
});
function transferRows() {
  const transfer=({label,value,confirmed,selected,review,kind,checked,values,fields,confidence,confirmation,alternative,hasConflict})=>({label,value,confirmed,...(selected!==undefined?{selected}:{}),...(review?{review}:{}),...(kind?{kind}:{}),...(typeof checked==='boolean'?{checked}:{}),...(Array.isArray(values)?{values}: {}),...(fields?{fields:fields.map(transfer)}:{}),...(confidence!==undefined?{confidence}:{}),...(confirmation?{confirmation}:{}),...(alternative || hasConflict?{hasConflict:true}:{})});
  return rows.map(transfer);
}
async function refreshReceivers() {
  if(refreshingReceivers) return refreshingReceivers;
  const refresh=(async()=>{try {
    const old=$('receiver').value;
    const response=await chrome.runtime.sendMessage({type:'PREPARE_RECEIVERS'});
    receiverTabs=(await chrome.tabs.query({})).filter(tab=>/^(https?|file):/.test(tab.url || ''));
    receiverTabs.sort((a,b)=>Number(b.active)-Number(a.active));
    const connected=new Set((response?.targets || []).map(t=>t.tabId));
    receiverTargets=connected;
    $('receiver').replaceChildren(new Option('选择接收网页',''),...receiverTabs.map(tab=>new Option(`${connected.has(tab.id)?'已连接':'未连接'} · ${tab.title || new URL(tab.url).hostname} · 窗口 ${tab.windowId}`,String(tab.id))));
    if(receiverTabs.some(t=>String(t.id)===old)) $('receiver').value=old;
    else if(receiverTabs.length) $('receiver').value=String(receiverTabs.find(tab=>tab.id!==sourceTabId)?.id || receiverTabs[0].id);
    $('enable-websites').hidden=await chrome.permissions.contains({origins:['http://*/*','https://*/*']});
    $('receiver-status').textContent=connected.has(Number($('receiver').value)) ? `${connected.size} 个网页已连接` : '所选网页未连接，请授权后拖拽';
  } catch { receiverTargets=new Set();$('receiver-status').textContent='接收网页刷新失败'; }
  finally {await refreshCurrentPage();update();}})();
  refreshingReceivers=refresh;
  try {return await refresh;}
  finally {refreshingReceivers=null;}
}
$('refresh-receivers').addEventListener('click',refreshReceivers);
$('enable-websites').addEventListener('click',async()=>{
  try {
    if(!await chrome.permissions.request({origins:['http://*/*','https://*/*']})) {status('未获得网站访问权限，无法拖拽到未连接网页',true);return;}
    if(refreshingReceivers) await refreshingReceivers;
    await refreshReceivers();status('网页已连接，可拖拽截图');
  } catch(error) {status(error.message || '网页授权失败',true);}
});
$('connect-receiver').addEventListener('click',async()=>{
  const tab=receiverTabs.find(tab=>String(tab.id)===$('receiver').value);
  if(!tab) return;
  const url=new URL(tab.url),origin=url.protocol==='file:'?'file:///*':`${url.protocol}//${url.hostname}/*`;
  try {
    const granted=await chrome.permissions.request({origins:[origin]});
    if(!granted) {status('网站未授权，未连接',true);return;}
    if(refreshingReceivers) await refreshingReceivers;
    await refreshReceivers();status('目标网站已连接');
  } catch(error) {status(error.message || '网站连接失败',true);}
});
$('receiver').addEventListener('change',()=>{$('receiver-status').textContent=receiverTargets.has(Number($('receiver').value))?`${receiverTargets.size} 个网页已连接`:'所选网页未连接，请授权后拖拽';update();});
$('sync-states').addEventListener('change',()=>{chrome.storage.local.set({syncStates:$('sync-states').checked}).catch(()=>{});invalidate();});
$('allow-add').addEventListener('change',invalidate);
window.addEventListener('focus',()=>{if(initialized) refreshReceivers();});
async function imageHash(blob) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('');
}
function imageDataBlob(data) {
  const match = /^data:(image\/(?:png|jpeg));base64,([A-Za-z0-9+/=]+)$/.exec(data);
  if (!match) throw new Error('本机截图格式无效');
  return new Blob([Uint8Array.from(atob(match[2]), c => c.charCodeAt(0))], {type:match[1]});
}
function persist() {
  const masks=emptyControlBounds.map(box=>({x:box.x*savedMaskScale.x,y:box.y*savedMaskScale.y,width:box.width*savedMaskScale.x,height:box.height*savedMaskScale.y}));
  const savedCapture = {image:savedImage, sourceHash, rows:structuredClone(rows), sourceRows, emptyControlBounds:masks, maskCoordinates:'saved-image', info:$('image-info').textContent};
  if(!savedImage)return;
  captureRef ||= {id:crypto.randomUUID(),revision:null};
  const ref=captureRef;
  saveQueue = saveQueue.catch(() => {}).then(async()=>{
    panelSaving++;
    try{
      const action=ref.revision===null?{type:'add',capture:{...savedCapture,id:ref.id,status:'ready'}}:{type:'update',id:ref.id,revision:ref.revision,patch:{...savedCapture,status:'ready',error:''}};
      const response=await chrome.runtime.sendMessage({type:'HISTORY',action});
      if(!response?.ok)throw Error(response?.error || '截图保存失败');
      ref.revision=response.state.items.find(item=>item.id===ref.id)?.revision;
      renderHistory(response.state);
    }finally{panelSaving--;}
  });
  saveQueue.catch(() => status('本机保存失败，请检查浏览器存储空间', true));
}

function status(text, error = false) { $('status').textContent = text; $('status').classList.toggle('error', error); if(error)$('status').scrollIntoView({block:'nearest'}); }
function invalidate() {
  preview = null;summaryMode='source';$('results-details').hidden=true; $('matches').replaceChildren(); update();
  persist();
}
function update() {
  $('recognize').disabled = busy || captureStatus==='processing' || !imageBlob;
  $('view').disabled = busy || !imageBlob;
  $('scan').disabled = busy;
  $('capture').disabled = busy;
  $('region-capture').disabled=busy;
  $('choose').disabled = busy; $('paste').disabled = busy; $('add').disabled = busy;
  $('clear-history').disabled=busy;
  for(const button of $('capture-history').querySelectorAll('button'))button.disabled=busy;
  $('scope').disabled = busy || !scan;
  $('allow-add').disabled=busy;
  $('match').disabled = busy || !rows.length || !scan || !$('scope').value;
  const transferable=rows.some(r => (rowReady(r) || canAutoConfirmMulti(r)) && r.label && (r.value || r.fields?.length || typeof r.checked==='boolean'));
  $('fill').disabled = busy || !transferable;
  $('dropzone').draggable = !busy && !!imageBlob && transferable && receiverTargets.size>0;
  $('dropzone').classList.toggle('drag-ready',$('dropzone').draggable);
  $('cancel').hidden = !abortController;
  $('recognize').hidden = !!abortController;
  $('clear').disabled = busy && !abortController;
  for (const control of $('rows').querySelectorAll('input,textarea,select,button')) control.disabled = busy;
  if(summaryMode==='source')$('summary').textContent=`${rows.filter(row=>rowReady(row) || canAutoConfirmMulti(row)).length} 项待填写`;
}
function setBusy(value) { busy = value; update(); if (!value && initialized) {queueMicrotask(receiveShortcut);if(restorePending){restorePending=false;queueMicrotask(restore);}} }
function fit(node) { node.style.height = 'auto'; node.style.height = `${Math.min(160, Math.max(36, node.scrollHeight + 2))}px`; }
function displayValue(row){
  if(typeof row.checked==='boolean')return row.checked?'开启 / 勾选':'关闭 / 未勾选';
  if(row.fields)return row.fields.map(field=>`${field.label}: ${displayValue(field)}`).join('\n');
  return row.values?.join('\n') ?? row.value ?? '';
}
window.addEventListener('resize', () => { for (const node of $('rows').querySelectorAll('textarea')) fit(node); });

function renderRows() {
  $('rows').replaceChildren(); $('row-count').textContent = String(rows.length); $('compact-count').textContent=String(rows.length); $('empty-rows').hidden = rows.length > 0;
  rows.forEach((row, index) => {
    const wrapper = document.createElement('div'); wrapper.className = 'data-row';wrapper.dataset.review=rowReview(row);
    const handle = document.createElement('button'); handle.className = 'icon-button drag-field'; handle.title = '拖到同名空白输入框'; handle.setAttribute('aria-label', `拖拽字段 ${index + 1}`); handle.draggable = true;
    const grip = document.createElement('i'); grip.setAttribute('data-lucide','grip-vertical'); handle.append(grip);
    handle.addEventListener('pointerenter', () => { if (!busy) refreshReceivers(); });
    handle.addEventListener('focus', () => { if (!busy) refreshReceivers(); });
    handle.addEventListener('dragstart', event => {
      if (busy || !rowReady(row) && !canAutoConfirmMulti(row)) { event.preventDefault(); status(rowSelected(row)?'内容待核对，请先选择采用值':'请勾选要填写的字段',true); return; }
      dragKey = crypto.randomUUID();
      event.dataTransfer.clearData();
      event.dataTransfer.setData('application/x-local-screenshot-field',dragKey);
      event.dataTransfer.setData('text/plain',`local-screenshot:${dragKey}`);
      event.dataTransfer.effectAllowed='copy';
      armDrag(index,dragKey).catch(error => status(error.message,true));
    });
    const label = document.createElement('textarea'); label.className = 'field-label'; label.rows = 1; label.value = row.label; label.maxLength = 300; label.setAttribute('aria-label', `字段名称 ${index + 1}`);
    const value = document.createElement(typeof row.checked==='boolean'?'select':'textarea'); value.className = 'field-value'; value.rows = 1;
    if(typeof row.checked==='boolean') value.append(new Option('开启 / 勾选','true'),new Option('关闭 / 未勾选','false'));
    value.value = typeof row.checked==='boolean'?String(row.checked):row.values?.join('\n') || row.value; value.maxLength = 10000; value.setAttribute('aria-label', `字段值 ${index + 1}`);
    if(row.kind==='group') {value.value=displayValue(row);value.readOnly=true;}
    const confirmed = document.createElement('input'); confirmed.type = 'checkbox'; confirmed.checked = rowSelected(row); confirmed.title = '参与填写'; confirmed.setAttribute('aria-label', `参与填写 ${index + 1}`);
    const remove = document.createElement('button'); remove.className = 'icon-button'; remove.title = '删除字段'; remove.setAttribute('aria-label', `删除字段 ${index + 1}`); const symbol = document.createElement('i'); symbol.setAttribute('data-lucide', 'x'); remove.append(symbol);
    const kind = document.createElement('select'); kind.className = 'row-kind'; kind.setAttribute('aria-label', `字段类型 ${index + 1}`);
    kind.append(new Option('文字','text'),new Option('多选值','multi'),new Option('开关状态','state'));
    if(row.kind==='group') kind.append(new Option('组合字段','group'));
    kind.value = row.kind==='group'?'group':typeof row.checked==='boolean' ? 'state' : Array.isArray(row.values) ? 'multi' : 'text';
    label.addEventListener('input', () => { row.label = label.value;delete row.alternative;delete row.hasConflict;row.selected=rowSelected(row);row.review='pending';row.confirmation='manual';row.confirmed = false; fit(label);refreshReview(); invalidate(); });
    value.addEventListener('input', () => {
      if(typeof row.checked==='boolean') {row.checked=value.value==='true';row.value=row.checked?'true':'false';}
      else {row.value=value.value;if(Array.isArray(row.values)) row.values=value.value.split(/\r?\n/).filter(item=>item.trim());}
      row.selected=rowSelected(row);row.review='pending';row.confirmation='manual';row.confirmed = false; if(value.tagName==='TEXTAREA') fit(value);refreshReview(); invalidate();
    });
    confirmed.addEventListener('change', () => { Object.assign(row,selectRow(row,confirmed.checked));invalidate(); });
    kind.addEventListener('change', () => {
      if(kind.value==='state') {row.kind='switch';row.value='';row.checked=false;delete row.values;delete row.fields;}
      else if(kind.value==='multi') {row.kind='multi-select';delete row.checked;delete row.fields;row.values=row.value.split(/\r?\n/).filter(item=>item.trim());}
      else if(kind.value!=='group') {delete row.kind;delete row.checked;delete row.values;delete row.fields;}
      if(kind.value==='multi' && row.confirmation!=='manual' && row.confidence>=80 && !row.alternative)row.confirmation='multi-layout';else row.confirmation='manual';
      row.selected=rowSelected(row);row.review='pending';row.confirmed=false;invalidate();renderRows();
    });
    remove.addEventListener('click', () => { rows.splice(index, 1); invalidate(); renderRows(); });
    wrapper.append(label, value, confirmed, remove, handle,kind);
    if(row.fields) {
      const editor=document.createElement('div');editor.className='group-fields';
      row.fields.forEach(field=>{
        const item=document.createElement('label');item.className='group-field';
        const caption=document.createElement('span');caption.textContent=field.label;
        const input=document.createElement(field.checked===undefined?'textarea':'input');
        input.setAttribute('aria-label',`${row.label} / ${field.label}`);
        if(field.checked!==undefined) {input.type='checkbox';input.checked=field.checked;}
        else {input.rows=1;input.value=field.value;input.maxLength=10000;}
        input.addEventListener('input',()=>{
          if(field.checked!==undefined) field.checked=input.checked;else field.value=input.value;
          row.selected=rowSelected(row);row.review='pending';row.confirmed=false;field.confirmed=true;
          value.value=displayValue(row);
          refreshReview();
          invalidate();
        });
        item.append(caption,input);editor.append(item);
      });
      wrapper.append(editor);
    }
    const provenance=document.createElement('span');provenance.className='row-origin';
    provenance.textContent=row.source==='web'?'网页辅助':row.source==='image+web'?'截图 · 网页校对':row.source==='image'?'截图':'';
    if(provenance.textContent) wrapper.append(provenance);
    const review=document.createElement('span');review.className='row-review';review.dataset.state=rowReview(row);review.textContent=rowReview(row)==='ready'?'来源可用':rowReview(row)==='conflict'?'来源冲突 · 待核对':'待核对';wrapper.append(review);
    const useImage=document.createElement('button');useImage.className='button small review-image';useImage.textContent=row.alternative?'采用截图值':'确认当前值';useImage.hidden=rowReview(row)==='ready';
    useImage.addEventListener('click',()=>{rows[index]=reviewRow(row,'image');invalidate();renderRows();});wrapper.append(useImage);
    if(row.alternative) {
      const webValue=document.createElement('textarea');webValue.className='alternative-value';webValue.readOnly=true;webValue.rows=2;webValue.setAttribute('aria-label',`来源网页值 ${index+1}`);webValue.value=displayValue(row.alternative);wrapper.append(webValue);
      const useWeb=document.createElement('button');useWeb.className='button small alternative';useWeb.textContent='采用网页原值';
      useWeb.addEventListener('click',()=>{rows[index]=reviewRow(row,'web');invalidate();renderRows();});
      wrapper.append(useWeb);
    }
    if (row.note) { const note = document.createElement('div'); note.className = 'row-note'; note.textContent = row.note; wrapper.append(note); }
    function refreshReview(){
      wrapper.dataset.review=rowReview(row);
      review.dataset.state=rowReview(row);review.textContent=rowReview(row)==='ready'?'来源可用':rowReview(row)==='conflict'?'来源冲突 · 待核对':'待核对';
      useImage.hidden=rowReview(row)==='ready';useImage.textContent=row.alternative?'采用截图值':'确认当前值';
      for(const node of wrapper.querySelectorAll('.alternative,.alternative-value'))node.hidden=!row.alternative;
      const note=wrapper.querySelector('.row-note');if(note){row.note='内容已编辑，待核对';note.textContent=row.note;}
    }
    $('rows').append(wrapper);
    requestAnimationFrame(() => { fit(label); if(value.tagName==='TEXTAREA') fit(value); });
  });
  paintIcons(); update();
}

async function importImage(blob, webSourceRows = null, masks = []) {
  if (busy) return;
  captureStatus='ready';
  const run = ++generation;
  setBusy(true);
  try {
    const prepared = await prepareImage(blob);
    if (run !== generation) return;
    prepared.canvas.width = prepared.canvas.height = 0;
    sourceHash = await imageHash(blob);
    captureRef={id:crypto.randomUUID(),revision:null};
    if (imageUrl) URL.revokeObjectURL(imageUrl);
    imageBlob = blob; imageUrl = URL.createObjectURL(blob); $('image').src = imageUrl;
    emptyControlBounds = masks;
    const bitmap = await createImageBitmap(blob);
    const canvas = document.createElement('canvas'); const factor = Math.min(1, 2000 / Math.max(bitmap.width, bitmap.height));
    canvas.width = Math.round(bitmap.width*factor); canvas.height = Math.round(bitmap.height*factor);
    savedMaskScale={x:canvas.width/bitmap.width,y:canvas.height/bitmap.height};
    canvas.getContext('2d').drawImage(bitmap,0,0,canvas.width,canvas.height); bitmap.close();
    savedImage = canvas.toDataURL('image/jpeg',.88); canvas.width = canvas.height = 0;
    $('image').hidden = false; $('empty-image').hidden = true;
    $('image-info').textContent = `${prepared.width} × ${prepared.height} · ${(blob.size / 1024).toFixed(0)} KB`;
    sourceRows = structuredClone(webSourceRows || []);
    rows = webSourceRows?.map(row=>({...row,source:'web'})) || []; $('raw').value = ''; $('raw-details').hidden = true; invalidate(); renderRows();
    status(webSourceRows?.length ? `已读取 ${rows.length} 个网页原值，继续识别截图文字` : '截图已保存，开始本地识别');
  } catch (error) { status(error.message || '图片读取失败', true); }
  finally { setBusy(false); }
  if (imageBlob === blob) await recognize();
}

$('choose').addEventListener('click', () => $('file').click());
$('view').addEventListener('click', () => { if (imageUrl) chrome.tabs.create({ url: imageUrl }); });
$('file').addEventListener('change', () => { const file = $('file').files[0]; if (file) importImage(file); $('file').value = ''; });
async function readClipboardImage() {
  const items = await navigator.clipboard.read();
  for (const item of items) {
    const type = item.types.find(t => ['image/png', 'image/jpeg', 'image/webp', 'image/bmp'].includes(t));
    if (type) return item.getType(type);
  }
  return null;
}
$('paste').addEventListener('click', async () => {
  try {
    const image = await readClipboardImage();
    if (image) { await importImage(image); return; }
    status('剪贴板中没有图片', true);
  } catch { status('无法读取剪贴板，请在侧栏空白处粘贴，或导入图片文件', true); }
});
document.addEventListener('paste', event => {
  const file = [...(event.clipboardData?.items || [])].find(i => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
  if (file) { event.preventDefault(); importImage(file); }
});
document.addEventListener('dragover', event => { if (event.dataTransfer?.types.includes('Files')) { event.preventDefault(); $('dropzone').classList.add('dragging'); } });
document.addEventListener('dragleave', event => { if (!event.relatedTarget) $('dropzone').classList.remove('dragging'); });
document.addEventListener('drop', event => { event.preventDefault(); $('dropzone').classList.remove('dragging'); const file = event.dataTransfer?.files[0]; if (file) importImage(file); });
$('image').addEventListener('pointerenter', () => { if (!busy) refreshReceivers(); });
$('dropzone').addEventListener('pointerdown',event=>{
  if(event.button!==0 || !imageBlob || busy || $('dropzone').draggable) return;
  status(dock && !receiverTargets.size ? '尚无已连接网页，请先连接目标网站' : '没有已勾选的可填写字段，请先核对冲突项或采用网页原值',true);
});
$('dropzone').addEventListener('dragstart', event => {
  if (!$('dropzone').draggable || busy) { event.preventDefault(); status('目标网页未连接，请先授权网站',true); return; }
  dragKey = crypto.randomUUID();
  // Only the short-lived token crosses the native drag boundary.
  event.dataTransfer.clearData();
  event.dataTransfer.setData('application/x-local-screenshot-field',dragKey);
  event.dataTransfer.setData('text/plain',`local-screenshot:${dragKey}`);
  event.dataTransfer.effectAllowed='copy';
  armDrag(-1,dragKey).catch(error=>status(error.message,true));
});

async function recognize() {
  if (busy || !imageBlob) return;
  const webRows = sourceRows;
  const run = ++generation;
  const controller = new AbortController(); abortController = controller; setBusy(true); invalidate();
  $('progress').hidden = false; $('progress').value = 0; status('正在启动本地识别…');
  const timer = setTimeout(() => controller.abort(), 120000);
  let prepared;
  try {
    prepared = await prepareImage(imageBlob);
    if(emptyControlBounds.length) {
      const ctx=prepared.canvas.getContext('2d');
      const scaleX=prepared.canvas.width/prepared.width,scaleY=prepared.canvas.height/prepared.height;
      ctx.fillStyle='#fff';
      for(const box of emptyControlBounds) ctx.fillRect(box.x*scaleX,box.y*scaleY,box.width*scaleX,box.height*scaleY);
    }
    const result = await localProvider.recognize(prepared.canvas, { signal: controller.signal, onProgress(event) {
      $('progress').value = Math.round((event.progress || 0) * 100);
      status(event.status === 'recognizing text' ? `正在识别 ${Math.round((event.progress || 0) * 100)}%` : '正在加载本地识别资源…');
    } });
    if (run !== generation) return;
    const fromImage = extractRows(result.words,result.boxes).slice(0,200);
    rows = mergeRecords(fromImage,webRows); $('raw').value = result.text; $('raw-details').hidden = false;
    renderRows(); persist(); status(rows.length ? `已识别 ${fromImage.length} 个截图字段，${rows.filter(row=>row.source==='web'||row.source==='image+web').length} 个有网页辅助；请核对名称和值` : '未识别出明确的字段和值，可查看原文或添加字段', !rows.length);
  } catch (error) { if (run === generation) status(error.name === 'AbortError' ? '识别已取消或超时' : webRows.length ? `已保留 ${webRows.length} 个网页原值；截图文字识别失败，请重试` : '本地识别失败，请重新导入清晰截图', error.name !== 'AbortError'); }
  finally {
    clearTimeout(timer); if (prepared) prepared.canvas.width = prepared.canvas.height = 0;
    if (run === generation) { abortController = null; $('progress').hidden = true; setBusy(false); }
  }
}
$('recognize').addEventListener('click', recognize);
$('cancel').addEventListener('click', () => abortController?.abort());
$('clear').addEventListener('click', () => {
  if (busy && !abortController) return;
  const deleted=captureRef;captureRef=null;
  saveQueue=saveQueue.catch(()=>{}).then(()=>deleted?chrome.runtime.sendMessage({type:'HISTORY',action:{type:'delete',id:deleted.id}}):chrome.storage.local.set({savedCapture:null}));
  generation++; abortController?.abort(); abortController = null; busy = false;
  if (imageUrl) URL.revokeObjectURL(imageUrl);
  imageBlob = null; imageUrl = ''; savedImage = ''; sourceHash = ''; emptyControlBounds = []; savedMaskScale={x:1,y:1}; rows = []; sourceRows=[]; scan = null; $('image').removeAttribute('src'); $('image').hidden = true; $('empty-image').hidden = false;
  $('image-info').textContent = '未选择截图'; $('raw').value = ''; $('raw-details').hidden = true; $('progress').hidden = true;
  $('scope').replaceChildren(new Option('请选择表单', '')); $('page-title').textContent = '尚未选择页面'; $('page-note').textContent = '';
  $('target-details').hidden = true; $('target-fields').value = '';
  invalidate(); renderRows(); status('已删除本机保存的截图和字段');
});
$('add').addEventListener('click', () => { if (rows.length >= 200) { status('最多处理 200 个字段', true); return; } rows.push({ label: '', value: '', selected:true,review:'pending',confirmed: false }); invalidate(); renderRows(); $('rows').lastElementChild.querySelector('.field-label').focus(); });

async function activeTab() {
  const windowId=dock ? (await chrome.windows.getLastFocused({windowTypes:['normal']})).id : panelWindowId;
  const tab=(await chrome.tabs.query({active:true,windowId}))[0];
  if (!tab?.id || !/^(https?|file):/.test(tab.url || '')) throw new Error('请先切换到普通网页，再按快捷键或点击插件图标');
  return tab;
}
async function connect(request = true, tabId = null) {
  const tab = tabId === null ? await activeTab() : await chrome.tabs.get(tabId);
  if (!tab.active || !/^(https?|file):/.test(tab.url || '')) throw new Error('目标页已切换，请重新扫描');
  // A shortcut grants activeTab. Try that grant before requesting site access.
  try { await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}); return tab; }
  catch { if (!request) throw new Error('当前页未连接，请点击浏览器工具栏的插件图标后重试'); }
  const url = new URL(tab.url);
  const origin = url.protocol === 'file:' ? 'file:///*' : `${url.protocol}//${url.hostname}/*`;
  if (!await chrome.permissions.contains({origins:[origin]})) {
    if (!await chrome.permissions.request({origins:[origin]})) throw new Error('未获得当前网站权限，未读取或填写网页');
  }
  try { await chrome.scripting.executeScript({target:{tabId:tab.id},files:['content.js']}); }
  catch (error) { throw new Error(`无法连接该网页：${error.message}`); }
  return tab;
}
async function armDrag(index,key) {
  const ref=captureRef;
  await assertCaptureFresh(ref);
    const response=await chrome.runtime.sendMessage({type:'REGISTER_DRAG',key,index,rows:transferRows(),captureId:ref?.id,revision:ref?.revision,syncStates:$('sync-states').checked,allowAdd:$('allow-add').checked});
  if(!response?.ok || !response.count) throw new Error(response?.error || '没有已连接的接收网页，请先连接目标网站');
}
async function assertCaptureFresh(ref){
  await saveQueue;
  if(ref!==captureRef)throw Error('截图已变化，请重新选择后填写');
  if(!ref)return;
  const response=await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'get'}});
  if(!response?.ok || !response.state.items.some(item=>item.id===ref.id && item.revision===ref.revision))throw Error('截图已变化，请重新选择后填写');
}
$('capture').addEventListener('click', async () => {
  setBusy(true);
  try {
    const tab = await connect();
    const [visibleTab]=await chrome.tabs.query({active:true,windowId:tab.windowId});
    if(visibleTab?.id!==tab.id) throw new Error('请先在来源窗口打开所选网页，再截图');
    const source = await chrome.tabs.sendMessage(tab.id,{type:'SOURCE'},{frameId:0});
    if (!source?.ok) throw new Error(source?.error || '无法读取当前表单');
    let image;
    await chrome.tabs.sendMessage(tab.id,{type:'HIDE_SHELF',hidden:true});
    try { image = await chrome.tabs.captureVisibleTab(tab.windowId,{format:'png'}); }
    catch { throw new Error('请先点击浏览器工具栏的插件图标，再截取网页'); }
    finally {await chrome.tabs.sendMessage(tab.id,{type:'HIDE_SHELF',hidden:false}).catch(()=>{});}
    const current = await activeTab();
    const [capturedTab]=await chrome.tabs.query({active:true,windowId:tab.windowId});
    if (current.id !== tab.id || current.url !== tab.url || capturedTab?.id!==tab.id) throw new Error('页面已切换，请重新截图');
    setBusy(false);
    await importImage(imageDataBlob(image),source.rows.length ? source.rows : null);
  } catch (error) { status(error.message,true); }
  finally { setBusy(false); }
});
async function send(message) {
  const tab = scan && await chrome.tabs.get(scan.tabId);
  if (!tab || !tab.active || tab.url !== scan.url) { scan = null; invalidate(); throw new Error('目标页面已变化，请重新扫描'); }
  const response = await chrome.tabs.sendMessage(tab.id, message, { frameId: 0 });
  if (!response?.ok) throw new Error(response?.error || '页面未响应，请重新扫描');
  return response;
}
async function scanPage(tabId = null) {
  const selected = scan?.tabId;
  const selectedScope = $('scope').value;
  const tab = await connect(true,tabId);
  const data = await chrome.tabs.sendMessage(tab.id,{type:'SCAN'},{frameId:0});
  if (!data?.ok) throw new Error(data?.error || '扫描失败');
  scan = {...data,tabId:tab.id,windowId:tab.windowId}; $('page-title').textContent = data.title || new URL(data.url).hostname;
  const options = data.scopes.map(s => new Option(`${s.name} · ${s.count} 个字段`,s.id));
  $('scope').replaceChildren(new Option('请选择表单',''),...options);
  if (selected === tab.id && options.some(o => o.value === selectedScope)) $('scope').value = selectedScope;
  else if (options.length === 1) $('scope').value = options[0].value;
  renderScanSummary();
  const coverage=data.coverage;
  $('target-fields').value = (coverage?[`当前已渲染：${coverage.rawCandidates} 个候选节点 → ${coverage.logicalFields} 个字段；组合子项 ${coverage.groupChildren} 个；动作按钮 ${coverage.excludedActions} 个不作为字段`,...coverage.frames.map(frame=>`${frame.title}：内嵌页面未扫描`)]:[]).concat(data.fields.map(field => {
    const scope = data.scopes.find(s => s.id === field.scopeId)?.name || '';
      return `${scope} / ${field.label || '（未读取到标签）'}${field.fields?` { ${field.fields.map(child=>child.label).join(', ')} }`:''} [${field.adapter || field.kind} / ${field.labelSource || 'unresolved'}]${field.reason ? `：${field.reason}` : field.disabled || field.readonly?'：只读或禁用':'：已适配'}`;
  })).join('\n');
  $('target-details').hidden = false;
  return data;
}
$('scan').addEventListener('click', async () => {
  setBusy(true); invalidate(); scan = null; $('target-details').hidden = true;
  try {
    const data = await scanPage();
    status(data.fields.length ? '页面扫描完成' : '未发现可读取的表单控件', !data.fields.length);
  } catch (error) { $('scope').replaceChildren(new Option('请选择表单', '')); $('page-title').textContent = '未连接页面'; $('page-note').textContent = ''; status(error.message, true); }
  finally { setBusy(false); }
});
function renderScanSummary(){
  if(!scan)return;
  const selected=scan.scopes.find(scope=>scope.id===$('scope').value),coverage=scan.coverage;
  const fields=selected?scan.fields.filter(field=>field.scopeId===selected.id):scan.fields;
  $('page-note').textContent=`${selected?`当前表单 ${selected.count} 项 · `:''}全页 ${scan.fields.length} 项 · 已适配 ${fields.filter(field=>field.supported).length} · 未适配 ${fields.filter(field=>!field.supported).length}${coverage?.unnamed?` · 无标签 ${coverage.unnamed}`:''}${scan.frames?` · ${scan.frames} 个内嵌页面未扫描`:''}${coverage?.stable===false?' · 页面仍在加载或变化':''}`;
}
$('scope').addEventListener('change',()=>{renderScanSummary();invalidate();});
function renderMatches(items, results = false) {
  $('results-title').textContent=results?'填写结果':'匹配预览';
  $('results-details').hidden=!items.length;$('results-details').open=!!items.length;$('results-count').textContent=String(items.length);summaryMode=results?'result':'preview';
  $('matches').replaceChildren();
  for (const item of items) {
    const state = results ? item.status : item.ready ? 'ready' : 'skipped';
    const wrapper = document.createElement('div'); wrapper.className = `match-row ${state}`;
    const icon = document.createElement('i'); icon.setAttribute('data-lucide', ['ready', 'filled'].includes(state) ? 'check' : ['failed', 'invalid'].includes(state) ? 'circle-alert' : 'minus');
    const content = document.createElement('div'); const title = document.createElement('strong'); title.textContent = item.label || '未命名字段';
    const reason = document.createElement('p'); reason.textContent = item.reason;
    content.append(title, reason); wrapper.append(icon, content); $('matches').append(wrapper);
  }
  paintIcons();
  if(items.length)$('results-details').scrollIntoView({block:'nearest'});
}
function retainResolvedChoices(items) {
  let changed=false;
  for(const item of items) {
    const row=rows[item.index];
    const automatic=row && canAutoConfirmMulti(row) && (item.autoConfirmed || item.autoPending && item.status==='filled');
    if(!(item.ready || item.status==='filled') || !['multi-select','multi-combobox'].includes(item.kind) || !item.values?.length || !row || row.values && !automatic || row.fields || row.checked!==undefined || row.label.trim()!==item.label || row.value!==item.value || !row.confirmed && !automatic) continue;
    if(automatic){row.selected=true;row.review='ready';row.confirmed=true;row.confirmation='target-multi';}
    row.kind=item.kind;row.values=[...item.values];row.note=`已按目标完整选项精确拆分为 ${item.values.length} 项`;
    changed=true;
  }
  if(changed) {renderRows();persist();}
}
$('match').addEventListener('click', async () => {
  setBusy(true); invalidate();
  try {
    const response = await send({ type: 'PREVIEW', token: scan.token, scopeId: $('scope').value, rows: transferRows(),syncStates:$('sync-states').checked,allowAdd:$('allow-add').checked });
    preview = response; retainResolvedChoices(response.plan); renderMatches(response.plan);
    const count = response.plan.filter(p => p.ready).length; $('summary').textContent = `${count} 项可填写`;
    status(count ? '匹配完成；填入可能触发网页自动保存，请确认后操作' : '没有可填写的同名空白字段', !count);
  } catch (error) { status(error.message || '匹配失败，请重新扫描', true); }
  finally { setBusy(false); }
});
$('fill').addEventListener('click', async () => {
  const ref=captureRef;
  setBusy(true);
  try {
    await scanPage(scan?.tabId);
    await assertCaptureFresh(ref);
    if (!$('scope').value) throw new Error('当前页有多个表单，请选择目标表单后再次一键填入');
    const approved = await send({type:'PREVIEW',token:scan.token,scopeId:$('scope').value,rows:transferRows(),syncStates:$('sync-states').checked,allowAdd:$('allow-add').checked});
    await assertCaptureFresh(ref);
    preview = null;
    const response = await send({ type: 'FILL', token: scan.token, previewId: approved.previewId });
    retainResolvedChoices(response.results);
    renderMatches(response.results, true);
    const filled = response.results.filter(r => r.status === 'filled').length;
    const invalid = response.results.filter(r => r.status === 'invalid').length;
    $('summary').textContent = `${filled} 项已写入`;
    status(`已写入 ${filled} 项${invalid ? `，${invalid} 项校验未通过` : ''}；请检查网页后自行提交`);
  } catch (error) { status(error.message || '填写失败，请重新扫描', true); }
  finally { setBusy(false); }
});
chrome.tabs.onActivated.addListener(({tabId,windowId}) => {if(windowId===panelWindowId || dock)refreshReceivers(); if (!busy && scan?.windowId===windowId && scan.tabId!==tabId) { scan = null; invalidate(); $('target-details').hidden = true; $('page-title').textContent = '页面已切换，请重新扫描'; } });
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if(tabId===currentPageTab?.id || tab?.active && (tab.windowId===panelWindowId || dock)){
    if(change.url || change.status==='loading')receiverTargets.delete(tabId);
    if(change.status==='complete')refreshReceivers();
    else if(change.url || change.title || change.status==='loading')refreshCurrentPage();
  }
  if (tabId === scan?.tabId && (change.url || change.status === 'loading')) { scan = null; invalidate(); $('target-details').hidden = true; $('page-title').textContent = '页面已变化，请重新扫描'; }
});
window.addEventListener('pagehide', () => { abortController?.abort(); if (imageUrl) URL.revokeObjectURL(imageUrl); });
chrome.runtime.onMessage.addListener((message,sender) => {
  if (sender.id !== chrome.runtime.id || message?.type !== 'DROP_RESULT') return;
  if(message.dragKey && message.dragKey!==dragKey) return;
  if (message.results) {
    retainResolvedChoices(message.results);
    renderMatches(message.results,true);
    $('summary').textContent = `${message.results.filter(r=>r.status==='filled').length} 项已写入`;
  }
  status(`拖拽：${message.text}`);
});
async function receiveShortcut() {
  if (!initialized || busy || shortcutRunning) return;
  shortcutRunning = true;
  try {
    const key = dock ? 'dockCapture' : `quickCapture-${panelWindowId}`;
    if ((await chrome.storage.session.get(key))[key]) {
      const response = await chrome.runtime.sendMessage({type:'TAKE_CAPTURE_REQUEST',windowId:panelWindowId,dock});
      if (response?.request) pendingShortcut = response.request;
    }
    const request = pendingShortcut;
    if (!request) return;
    if (request.expiresAt <= Date.now()) { pendingShortcut=null; status('截图接收已超时，请重新按快捷键',true); return; }
    if (request.image) {
      pendingShortcut=null;
      sourceTabId=request.tabId ?? null;
      status('正在接收框选截图…');
      await importImage(imageDataBlob(request.image),request.rows?.length ? request.rows : null,request.emptyControlBounds || []);
      return;
    }
    const run = generation;
    window.focus();
    status('正在接收剪贴板截图…');
    let blob;
    try { blob = await readClipboardImage(); }
    catch (error) {
      if (!document.hasFocus()) { status('等待侧栏获得焦点以接收截图'); return; }
      pendingShortcut=null;
      throw new Error('无法接收剪贴板图片，请在侧栏按 Ctrl+V 粘贴截图');
    }
    pendingShortcut=null;
    if (run !== generation || busy) return;
    // Connect the invoking page while its activeTab permission is available.
    await chrome.scripting.executeScript({target:{tabId:request.tabId},files:['content.js']}).catch(()=>{});
    if (run !== generation || busy) return;
    const unchanged = blob && imageBlob && rows.length && blob.size<=12*1024*1024 && await imageHash(blob)===sourceHash;
    if (run !== generation || busy) return;
    if (unchanged) status('截图未变化，已保留核对结果');
    else if (blob) await importImage(blob);
    else status(rows.length ? '剪贴板没有图片，保留已保存截图' : '剪贴板没有图片，请截图后再次按快捷键',true);
  } catch (error) { status(error.message || '截图接收失败',true); }
  finally {
    shortcutRunning=false;
    if (shortcutAgain) { shortcutAgain=false; queueMicrotask(receiveShortcut); }
  }
}
chrome.storage.onChanged.addListener((changes,area) => {
  if(area==='local' && changes.savedCapture && !panelSaving){
    if(busy)restorePending=true;else restore();
  }
  if (area === 'session' && changes[dock?'dockCapture':`quickCapture-${panelWindowId}`]?.newValue) {
    if (shortcutRunning) shortcutAgain=true;
    else receiveShortcut();
  }
});
window.addEventListener('focus', () => { if (pendingShortcut) receiveShortcut(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && pendingShortcut) receiveShortcut(); });
async function restore() {
  if(restoring)return;
  restoring=true;
  setBusy(true);
  try {
    const response=await chrome.runtime.sendMessage({type:'HISTORY',action:{type:'get'}});
    if(response?.ok)renderHistory(response.state);
    const {savedCapture} = await chrome.storage.local.get('savedCapture');
    if(captureRef?.id!==savedCapture?.id){preview=null;summaryMode='source';$('matches').replaceChildren();$('results-details').hidden=true;}
    if (savedCapture && Array.isArray(savedCapture.rows)) {
      captureRef={id:savedCapture.id || crypto.randomUUID(),revision:savedCapture.revision ?? null};captureStatus=savedCapture.status || 'ready';
      rows = savedCapture.rows;sourceRows=savedCapture.sourceRows || rows.filter(row=>row.source==='web'); savedImage = savedCapture.image || ''; sourceHash=savedCapture.sourceHash || '';
      // Older captures did not record which image size their masks belonged to.
      emptyControlBounds=savedCapture.maskCoordinates==='saved-image' ? savedCapture.emptyControlBounds || [] : [];
      savedMaskScale={x:1,y:1};
      if(imageUrl)URL.revokeObjectURL(imageUrl);
      if (savedImage) { imageBlob = imageDataBlob(savedImage); imageUrl=URL.createObjectURL(imageBlob); $('image').src=imageUrl; $('image').hidden=false; $('empty-image').hidden=true; }
      $('raw').value=savedCapture.raw || '';$('raw-details').hidden=!savedCapture.raw;
      $('image-info').textContent=savedCapture.info || '本机已保存'; renderRows();
      if(captureStatus==='processing'){status('正在本机识别…');$('progress').hidden=false;$('progress').removeAttribute('value');}
      else{$('progress').hidden=true;if(captureStatus==='error')status(savedCapture.error || '识别失败，请重试',true);else if(rows.length || savedImage)status(`${rows.length} 项 · ${rows.filter(row=>rowSelected(row) && !rowReady(row)).length} 待核对`);}
    } else {
      captureRef=null;captureStatus='ready';rows=[];sourceRows=[];savedImage='';imageBlob=null;
      if(imageUrl)URL.revokeObjectURL(imageUrl);imageUrl='';
      $('image').removeAttribute('src');$('image').hidden=true;$('empty-image').hidden=false;$('progress').hidden=true;renderRows();
      $('image-info').textContent='未选择图片';$('raw').value='';$('raw-details').hidden=true;
      if(!$('status').classList.contains('error'))status('等待导入');
    }
  } catch { status('本机保存内容读取失败',true); }
  finally { restoring=false;setBusy(false); }
}
paintIcons();
async function start() {
  panelWindowId=(await chrome.windows.getCurrent()).id;
  if(!dock && !await chrome.tabs.getCurrent()){
    const visibility=()=>chrome.runtime.sendMessage({type:'WORKSPACE_VISIBILITY',windowId:panelWindowId,visible:!document.hidden}).catch(()=>{});
    document.addEventListener('visibilitychange',visibility);
    window.addEventListener('pagehide',()=>chrome.runtime.sendMessage({type:'WORKSPACE_VISIBILITY',windowId:panelWindowId,visible:false}).catch(()=>{}));
    visibility();
  }
  $('sync-states').checked=(await chrome.storage.local.get('syncStates')).syncStates===true;
  await restore();
  initialized=true;
  await receiveShortcut();
  await refreshReceivers();
}
start().catch(()=>status('侧栏初始化失败，请重新打开',true));
