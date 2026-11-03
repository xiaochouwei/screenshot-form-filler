import {exactName} from './core.js';

export const maxAdditions=5;
export const formSelector='form,dialog,[role="form"],[role="dialog"],.el-dialog,.ant-modal,.ivu-form,.el-form,.ant-form';

export function findAddEntry(scope,label,{visible,labelText}){
  if(!scope?.isConnected || scope.nodeType===9)return null;
  const matches=[];
  for(const button of scope.querySelectorAll('button,[role="button"]')){
    if(button.closest(formSelector)!==scope || !visible(button) || button.matches(':disabled,[aria-disabled="true"]') || button.closest('[inert],[aria-disabled="true"]'))continue;
    const native=button.tagName==='BUTTON' && button.type==='button';
    const custom=['DIV','SPAN'].includes(button.tagName) && !button.querySelector('button,input,select,textarea,a[href],label,form');
    if((!native && !custom) || button.parentElement?.closest('button,input,label,a[href]') || button.closest('a[href]') || button.hasAttribute('formaction') || button.hasAttribute('aria-haspopup'))continue;
    const text=exactName(button.getAttribute('aria-label') || labelText(button)).replace(/^[+＋]\s*/,'');
    const named=/^(?:添加|新增|增加)\s*(.+)$/.exec(text) || /^Add\s+(.+)$/i.exec(text);
    let region=scope;
    const reference=button.getAttribute('aria-controls');
    if(reference){
      if(reference.trim().split(/\s+/).length!==1)continue;
      region=button.getRootNode().getElementById?.(reference);
      if(!region || !scope.contains(region))continue;
      let hidden=false;
      for(let parent=region;parent;parent=parent.parentElement){
        const style=getComputedStyle(parent);
        if(parent.matches('[hidden],[inert],[aria-hidden="true"]') || style.display==='none' || style.visibility==='hidden' || style.visibility==='collapse' || style.opacity==='0' || style.contentVisibility==='hidden')hidden=true;
        if(parent===scope)break;
      }
      if(hidden)continue;
    }
    const labelled=region.getAttribute('aria-labelledby')?.trim().split(/\s+/).map(id=>region.getRootNode().getElementById?.(id));
    const regionName=region.getAttribute('aria-label') || (labelled?.every(Boolean)?labelled.map(labelText).join(' '):'');
    if(named ? exactName(named[1])===exactName(label) : /^(?:添加|新增|增加|Add)$/i.test(text) && reference && exactName(regionName)===exactName(label))matches.push({button,region});
  }
  return matches.length===1?matches[0]:null;
}
