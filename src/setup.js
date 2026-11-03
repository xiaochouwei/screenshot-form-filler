const $=id=>document.getElementById(id);
const tabId=Number(new URLSearchParams(location.search).get('tab'));
let origin;
async function grant(origins){
  try{
    const allowed=await chrome.permissions.request({origins});
    if(!allowed){$('setup-status').textContent='未授权；可继续通过插件图标在当前页使用';return;}
    await chrome.runtime.sendMessage({type:'SETUP_READY',tabId});
    $('setup-status').textContent='已授权';
    $('permission-state').textContent='已获得网站访问权限';
  }catch(error){$('setup-status').textContent=error.message;}
}
$('grant-site').addEventListener('click',()=>grant([origin]));
$('grant-all').addEventListener('click',()=>grant(['http://*/*','https://*/*']));
$('capture-layout').addEventListener('change',()=>chrome.storage.local.set({captureLayout:$('capture-layout').value}));
$('shortcuts').addEventListener('click',()=>chrome.tabs.create({url:navigator.userAgent.includes('Edg/')?'edge://extensions/shortcuts':'chrome://extensions/shortcuts'}));
(async()=>{
 const tab=await chrome.tabs.get(tabId),url=new URL(tab.url);
 origin=url.protocol==='file:'?'file:///*':`${url.protocol}//${url.hostname}/*`;
 $('site').textContent=url.hostname || '本地文件';
 $('permission-state').textContent=await chrome.permissions.contains({origins:[origin]})?'此网站已授权':'此网站尚未授权';
 $('capture-layout').value=(await chrome.storage.local.get('captureLayout')).captureLayout==='window'?'window':'sidepanel';
 const commands=await chrome.commands.getAll();
 $('shortcut').textContent=commands.filter(item=>['receive-screenshot','open-workspace'].includes(item.name)).map(item=>`${item.name==='receive-screenshot'?'网页截图':'开关工作台'}：${item.shortcut || '未设置'}`).join('；');
})().catch(error=>{$('setup-status').textContent=error.message;$('grant-site').disabled=true;});
