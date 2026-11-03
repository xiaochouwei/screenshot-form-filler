export const rowSelected=row=>typeof row.selected==='boolean'?row.selected:row.confirmed===true;
export const rowReview=row=>row.review || (row.confirmed?'ready':'pending');
export const rowReady=row=>rowSelected(row) && rowReview(row)==='ready';

export function initializeRow(row){
  const selected=row.selected ?? true,review=row.review || (row.confirmed?'ready':'pending');
  return {...row,selected,review,confirmed:selected && review==='ready',...(row.fields?{fields:row.fields.map(initializeRow)}:{})};
}

export function selectRow(row,selected){
  const review=rowReview(row);
  return {...row,selected,review,confirmed:selected && review==='ready',confirmation:'manual'};
}

export function reviewRow(row,source){
  const chosen=source==='web'?row.alternative:row;
  if(!chosen)throw Error('没有可采用的来源值');
  const {alternative,hasConflict,...value}=structuredClone(chosen);
  const selected=rowSelected(row);
  return {...value,source:source==='web'?'web':row.source,selected,review:'ready',confirmed:selected,confirmation:'manual',note:source==='web'?'已采用来源网页原值':'已核对并采用截图值',...(value.fields?{fields:value.fields.map(field=>({...field,selected:true,review:'ready',confirmed:true}))}:{})};
}
