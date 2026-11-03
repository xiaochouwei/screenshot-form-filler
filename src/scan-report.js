export function scanCoverage({fields,roots,rawCandidates,stable=null}){
  return {
    rawCandidates,logicalFields:fields.length,groupChildren:fields.filter(field=>field.fields).reduce((sum,field)=>sum+field.fields.length,0),
    supported:fields.filter(field=>field.supported).length,unsupported:fields.filter(field=>!field.supported).length,
    unnamed:fields.filter(field=>!field.label).length,unavailable:fields.filter(field=>field.disabled || field.readonly || field.visible===false).length,
    excludedActions:roots.reduce((sum,root)=>sum+root.querySelectorAll('button,input[type="button"],input[type="submit"],input[type="reset"],input[type="image"]').length,0),
    frames:roots.flatMap(root=>[...root.querySelectorAll('iframe,frame')]).map((frame,index)=>({index,title:frame.title || frame.name || `Frame ${index+1}`,status:'not-scanned'})),
    stable,
  };
}
