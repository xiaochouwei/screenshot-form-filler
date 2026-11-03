const maxBytes=3*1024*1024;
const bytes=value=>new TextEncoder().encode(JSON.stringify(value)).length;

export function reduceHistory(previous,action) {
  const state=structuredClone(previous || {items:[],selectedId:null});
  if(action.type==='add') {
    const capture=structuredClone(action.capture);
    if(!capture?.id || !capture.image || !Array.isArray(capture.rows)) throw new Error('截图记录无效');
    if(state.items.some(item=>item.id===capture.id)) throw new Error('截图记录已存在');
    if(bytes(capture)>maxBytes) throw new Error('保存图片过大，请缩小截图范围');
    state.items.unshift({...capture,revision:1,createdAt:Date.now()});
    state.selectedId=capture.id;
  } else if(action.type==='update') {
    const item=state.items.find(item=>item.id===action.id);
    if(!item) throw new Error('截图已删除，请重新选择');
    if(item.revision!==action.revision) throw new Error('截图已变化，请重新打开核对');
    // Record identity and creation order never come from an editor patch.
    const {rows,status,error,info,sourceRows,emptyControlBounds,maskCoordinates,sourceHash,raw}=action.patch;
    Object.assign(item,Object.fromEntries(Object.entries({rows,status,error,info,sourceRows,emptyControlBounds,maskCoordinates,sourceHash,raw}).filter(([,value])=>value!==undefined)));
    item.revision++;
    if(bytes(item)>maxBytes) throw new Error('保存图片过大，请缩小截图范围');
  } else if(action.type==='select') {
    if(!state.items.some(item=>item.id===action.id)) throw new Error('截图已删除，请重新选择');
    state.selectedId=action.id;
  } else if(action.type==='delete') {
    state.items=state.items.filter(item=>item.id!==action.id);
    if(state.selectedId===action.id) state.selectedId=state.items[0]?.id || null;
  } else if(action.type==='clear') {
    state.items=[];state.selectedId=null;
  } else if(action.type!=='get') throw new Error('截图操作无效');
  const protectedId=action.type==='update'?action.id:state.selectedId;
  while(state.items.length>10 || bytes(state)>maxBytes) {
    const index=state.items.findLastIndex(item=>item.id!==protectedId && item.id!==state.selectedId);
    if(index<0) throw new Error('保存图片过大，请缩小截图范围');
    state.items.splice(index,1);
  }
  if(!state.items.some(item=>item.id===state.selectedId)) state.selectedId=state.items[0]?.id || null;
  return state;
}
