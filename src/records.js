import {exactName} from './core.js';
import {resolveMultiValue} from './multi-values.js';
import {initializeRow} from './row-state.js';

function sameRenderedText(image,web){
  const layout=web.textLayout;
  if(!layout || layout.value!==web.value || !Array.isArray(layout.softBreaks) || image.fields || image.values || image.checked!==undefined || web.fields || web.values || web.checked!==undefined)return false;
  const breaks=new Set(layout.softBreaks);
  let offset=0,removed=0;
  for(let index=0;index<image.value.length;index++){
    const character=image.value[index];
    if(character===web.value[offset]){offset++;continue;}
    if(character==='\n' && index>0 && image.value[index-1]!=='\n'){
      const wrap=[...breaks].find(position=>position===offset || position>offset && /^[ \t]+$/.test(web.value.slice(offset,position)));
      if(wrap!==undefined){offset=wrap;removed++;continue;}
    }
    return false;
  }
  return offset===web.value.length && removed>0;
}

function equivalent(a,b) {
  if(a.fields || b.fields) return a.fields && b.fields && a.fields.length===b.fields.length && a.fields.every(child=>{
    const matches=b.fields.filter(other=>exactName(other.label)===exactName(child.label));
    return matches.length===1 && equivalent(child,matches[0]);
  });
  if(a.checked!==undefined || b.checked!==undefined) return a.checked===b.checked;
  if(a.values || b.values) return a.values && b.values && a.values.length===b.values.length && a.values.every(value=>b.values.includes(value));
  return a.value===b.value;
}

export function mergeRecords(imageRows,webRows) {
  const result=imageRows.map(row=>({...structuredClone(row),source:'image'}));
  for(const web of webRows) {
    const name=exactName(web.label);
    if(webRows.filter(row=>exactName(row.label)===name).length!==1) continue;
    const matches=result.filter(row=>exactName(row.label)===name);
    if(!matches.length) {result.push({...structuredClone(web),source:'web'});continue;}
    if(matches.length!==1) continue;
    const row=matches[0];
    if(Array.isArray(web.values) && !row.values && !row.fields && row.checked===undefined) {
      const resolved=resolveMultiValue(row.value,web.values.map((text,index)=>({text,value:String(index)})));
      if(resolved.values?.length===web.values.length && resolved.values.every(value=>web.values.includes(value))) {
        row.kind=web.kind;row.values=resolved.values;
      }
    }
    if(row.fields && web.fields && row.fields.every(field=>{
      const peers=web.fields.filter(other=>exactName(other.label)===exactName(field.label));
      return peers.length===1 && equivalent(field,peers[0]);
    })) {
      const missing=web.fields.filter(field=>!row.fields.some(other=>exactName(other.label)===exactName(field.label)));
      if(missing.every(field=>['checkbox','switch'].includes(field.kind) && typeof field.checked==='boolean')) row.fields.push(...structuredClone(missing));
    }
    const layoutMatch=!equivalent(row,web) && sameRenderedText(row,web);
    if(equivalent(row,web) || layoutMatch) {
      if(layoutMatch){row.imageValue=row.value;row.value=web.value;}
      row.source='image+web';row.confirmed=true;row.review='ready';row.note=layoutMatch?'已按来源控件折行位置校对，保留网页真实换行':'截图与网页原值一致';
      if(row.fields) row.fields.forEach(field=>field.confirmed=true);
    } else {
      row.confirmed=false;row.review='conflict';row.alternative=structuredClone(web);row.note='截图与来源网页存在真实字符差异或未验证的折行，请选择采用值';
    }
  }
  return result.slice(0,200).map(initializeRow);
}
