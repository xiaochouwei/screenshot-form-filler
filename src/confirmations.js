import {exactName,planMatches} from './core.js';

export function canAutoConfirmMulti(row){
  return row.selected!==false && row.review!=='conflict' && row.confirmation==='multi-layout' && row.confirmed===false && Number.isFinite(row.confidence) && row.confidence>=80 && row.confidence<=100 && !row.alternative && !row.hasConflict && !row.fields && row.checked===undefined;
}

export function prepareMultiRows(rows,targets,{allowDeferred=false}={}){
  const candidates=new Set();
  const prepared=rows.map((row,index)=>{
    if(!canAutoConfirmMulti(row))return row;
    const matches=targets.filter(target=>exactName(target.label)===exactName(row.label));
    if(matches.length!==1 || !['multi-select','multi-combobox'].includes(matches[0].kind) || (!allowDeferred && matches[0].options===undefined))return row;
    candidates.add(index);return {...row,selected:true,review:'ready',confirmed:true};
  });
  const plan=planMatches(prepared,targets);
  const automatic=new Set(),deferred=new Set();
  return {rows:prepared.map((row,index)=>{
    if(!candidates.has(index))return row;
    const entry=plan[index];
    if(!entry.ready)return rows[index];
    if(targets.find(target=>target.id===entry.targetId)?.options===undefined){deferred.add(index);return row;}
    automatic.add(index);
    return {...row,kind:entry.kind,values:entry.values,confirmation:'target-multi',note:'已按目标完整选项精确核对'};
  }),automatic,deferred};
}
