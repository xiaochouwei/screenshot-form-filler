export function nativeTextLayout(node){
  if(node.tagName!=='TEXTAREA' || !node.value || node.value.length>10000)return undefined;
  const doc=node.ownerDocument,style=getComputedStyle(node);
  if(doc.fonts?.status==='loading' || style.writingMode!=='horizontal-tb' || style.textTransform!=='none' || !['pre','pre-wrap','break-spaces'].includes(style.whiteSpace) || !node.clientWidth)return undefined;
  const mirror=doc.createElement('div');mirror.dataset.localTextLayout='';mirror.setAttribute('aria-hidden','true');
  for(const property of ['fontFamily','fontSize','fontWeight','fontStyle','fontStretch','fontVariant','fontFeatureSettings','fontVariationSettings','fontKerning','lineHeight','letterSpacing','wordSpacing','textIndent','textAlign','direction','tabSize','wordBreak','overflowWrap','whiteSpace','paddingTop','paddingRight','paddingBottom','paddingLeft'])mirror.style[property]=style[property];
  Object.assign(mirror.style,{position:'fixed',left:'-100000px',top:'0',visibility:'hidden',pointerEvents:'none',boxSizing:'border-box',width:`${node.clientWidth}px`,height:'auto',border:'0'});
  const text=doc.createTextNode(node.value);mirror.append(text);doc.documentElement.append(mirror);
  try{
    const range=doc.createRange(),softBreaks=[];
    let previousTop=null,index=0,previous='';
    for(const character of node.value){
      range.setStart(text,index);range.setEnd(text,index+character.length);
      const rect=range.getBoundingClientRect();
      if(rect.height && previousTop!==null && rect.top>previousTop+1 && character!=='\n' && previous!=='\n')softBreaks.push(index);
      if(rect.height)previousTop=rect.top;
      previous=character;index+=character.length;
    }
    return {value:node.value,softBreaks};
  }finally{mirror.remove();}
}
