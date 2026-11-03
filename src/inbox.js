import {createElement,ClipboardPaste,Upload} from 'lucide';
const $=id=>document.getElementById(id);
$('paste').append(createElement(ClipboardPaste));$('choose').append(createElement(Upload));
async function importImage(blob){
  if(!['image/png','image/jpeg','image/webp','image/bmp'].includes(blob.type) || blob.size>12*1024*1024)throw Error('图片须为 PNG/JPG/WebP/BMP，且不超过 12 MB');
  $('status').textContent='本机识别中…';
  const image=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob);});
  const result=await chrome.runtime.sendMessage({type:'INBOX_IMPORT',image});
  if(!result?.ok)throw Error(result?.error || '图片导入失败');
  $('status').textContent='识别完成';
}
const error=reason=>{$('status').textContent=reason.message;};
$('choose').addEventListener('click',()=>$('file').click());
$('file').addEventListener('change',()=>{if($('file').files[0])importImage($('file').files[0]).catch(error);$('file').value='';});
$('paste').addEventListener('click',async()=>{
  try{for(const item of await navigator.clipboard.read()){const type=item.types.find(type=>type.startsWith('image/'));if(type){await importImage(await item.getType(type));return;}}throw Error('剪贴板中没有图片');}
  catch{document.body.focus();$('status').textContent='请按 Ctrl+V';}
});
document.addEventListener('paste',event=>{
  const image=[...(event.clipboardData?.items || [])].find(item=>item.kind==='file' && item.type.startsWith('image/'))?.getAsFile();
  if(image){event.preventDefault();importImage(image).catch(error);}
});
document.addEventListener('dragover',event=>{if(event.dataTransfer?.types.includes('Files')){event.preventDefault();event.dataTransfer.dropEffect='copy';document.body.classList.add('dragging');}});
document.addEventListener('dragleave',()=>document.body.classList.remove('dragging'));
document.addEventListener('drop',event=>{event.preventDefault();document.body.classList.remove('dragging');const image=[...(event.dataTransfer?.files || [])].find(file=>file.type.startsWith('image/'));if(image)importImage(image).catch(error);else $('status').textContent='请选择图片文件';});
