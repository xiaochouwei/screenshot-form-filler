import { planMatches, exactName, validRows } from './core.js';
import {controlNodes,candidateNodes,controlAdapter,choiceInfo,choiceLabel,readChoice,writeChoice} from './controls.js';
import {findFieldGroups} from './field-groups.js';
import {createShelf} from './shelf.js';
import {prepareMultiRows} from './confirmations.js';
import {findAddEntry,maxAdditions,formSelector} from './dynamic-fields.js';
import {nativeTextLayout} from './text-layout.js';
import {scanCoverage} from './scan-report.js';
import {rowReady} from './row-state.js';

if (!globalThis.__localScreenshotFillerInstalled) {
  document.getElementById('local-screenshot-shelf')?.remove();
  globalThis.__localScreenshotFillerInstalled = true;
  let session = null;
  let drag = null;
  let shelf=null;
  let shelfRevoked=false;
  let filling=false;
  let scanSequence=0;
  function getShelf(){return shelf ||= createShelf({scan,preview,fill,inspect,armLocal:value=>{drag=value;}});}
  const hintSelector='[role="note"],[role="tooltip"],[role="alert"],.hint,.help-block,.help-text,.helper-text,.form-text,.ivu-form-item-error-tip,.ivu-form-item-extra,.el-form-item__error,.ant-form-item-explain,.ant-form-item-extra';
  const ids = new WeakMap();
  let nextId = 1;
  const newToken = () => [...crypto.getRandomValues(new Uint32Array(4))].map(n => n.toString(16).padStart(8, '0')).join('');
  const idOf = node => {
    if (!ids.has(node)) ids.set(node, `field-${nextId++}`);
    return ids.get(node);
  };
  const rootNodes = () => {
    const roots = [document];
    for (let i = 0; i < roots.length; i++) for (const node of roots[i].querySelectorAll('*')) if (node.shadowRoot && node.id!=='local-screenshot-shelf') roots.push(node.shadowRoot);
    return roots;
  };
  const visible = node => {
    for (let current = node; current; current = current.parentElement || current.getRootNode()?.host) {
      if (current.matches('[hidden],[inert],[aria-hidden="true"]')) return false;
      const style = getComputedStyle(current);
      if (style.visibility === 'hidden' || style.visibility === 'collapse' || style.opacity === '0' || style.contentVisibility === 'hidden' || style.clipPath !== 'none' || style.clip !== 'auto') return false;
    }
    return [...node.getClientRects()].some(rect => rect.width > 0 && rect.height > 0);
  };
  function labelText(node) {
    const copy = node.cloneNode(true);
    const descriptions=new Set((node.control?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    for(const hint of copy.querySelectorAll(`${hintSelector},[id]`)) if(hint.matches(hintSelector) || descriptions.has(hint.id)) hint.remove();
    for (const marker of copy.querySelectorAll('.required,.is-required,.ant-form-item-required-mark,.el-form-item__asterisk,[aria-hidden="true"]')) {
      if (/^[\s*＊]+$/.test(marker.textContent)) marker.remove();
    }
    return exactName(copy.textContent).replace(/^[*＊]\s*/, '');
  }
  function labelOf(node) {
    const root = node.getRootNode();
    const labelledBy = node.getAttribute('aria-labelledby');
    if (labelledBy !== null) {
      const parts = labelledBy.trim().split(/\s+/).map(id => root.getElementById?.(id));
      return parts.every(part=>part && labelText(part)) ? parts.map(labelText).join(' ') : '';
    }
    const explicit = [...(node.labels || [])].map(labelText).filter(Boolean);
    if (explicit.length) return explicit.every(x => x === explicit[0]) ? explicit[0] : '';
    if (node.getAttribute('aria-label')) return exactName(node.getAttribute('aria-label'));
    const choiceName=choiceInfo(node) ? choiceLabel(node) : '';
    if(choiceName) return exactName(choiceName);
    if (!visible(node) || node.type === 'hidden') return '';
    // Use the nearest unambiguous field structure, independent of its UI kit.
    // Never use placeholders, help text, distance or semantic similarity.
    let item = node.parentElement;
    for (let depth = 0; item && depth < 8 && !item.matches('body,html'); depth++, item = item.parentElement) {
      const controls = controlNodes(item).filter(control => control.type !== 'hidden' && visible(control));
      if (controls.length !== 1 || controls[0] !== node) return '';
      const labels = [...item.querySelectorAll('label,[class]')].filter(label => {
        if (label.contains(node) || !visible(label)) return false;
        if (label.tagName === 'LABEL') return !label.control || label.control === node || node.contains(label.control);
        if ([...label.querySelectorAll('label')].some(child => child.control && child.control !== node)) return false;
        return [...label.classList].some(name => /(?:^|[-_])label(?:__text)?$/i.test(name)) && !label.querySelector('input,select,textarea');
      });
      const leaves = labels.filter(label => !labels.some(other => other !== label && label.contains(other)));
      if (leaves.length) return leaves.length === 1 ? labelText(leaves[0]) : '';
      if (item.matches('form,[role="form"],[role="dialog"]')) break;
    }
    return '';
  }
  function numericInput(node) {
    if(node.tagName !== 'INPUT') return false;
    if(node.type === 'number') return true;
    if(node.type !== 'text' && node.type !== 'search') return false;
    if(node.getAttribute('role') === 'spinbutton') return true;
    for(let parent=node,depth=0;parent && depth<6 && !parent.matches('form,body,html');parent=parent.parentElement,depth++) {
      if([...parent.classList].some(name=>/(?:^|[-_])input-number(?:$|[-_])/i.test(name))) return true;
    }
    return false;
  }
  function customControl(node) {
    if(numericInput(node)) return false;
    if (node.matches('[role="combobox"],[role="spinbutton"]') || node.closest('[role="combobox"],[aria-haspopup="listbox"],[aria-haspopup="tree"],[aria-haspopup="grid"]')) return true;
    if (node.tagName === 'SELECT') return false;
    for (let parent=node,depth=0; parent && depth<8 && !parent.matches('form,body,html,[role="form"]'); parent=parent.parentElement,depth++) {
      if ([...parent.classList].some(name => /(?:^|[-_])(?:select|picker|cascader|autocomplete|auto-complete|input-number)(?:$|[-_])/i.test(name))) return true;
    }
    return false;
  }
  function describe(node, scopes, overrides={}) {
    const label = overrides.label ?? labelOf(node);
    const choice=choiceInfo(node);
    const type = overrides.kind || choice?.kind || (numericInput(node) ? 'number' : node.tagName === 'TEXTAREA' ? 'textarea' : node.tagName === 'SELECT' ? 'select' : node.type || node.getAttribute('role') || (node.isContentEditable?'contenteditable':'unknown'));
    let supported = choice ? choice.supported : ['text', 'url', 'email', 'tel', 'search', 'number', 'textarea','group'].includes(type);
    let reason = choice?.reason || '';
    if(!supported && !reason)reason='控件类型暂无安全写入适配';
    if (!visible(node)) { supported = false; reason = '目标不可见'; }
    if ((!choice && customControl(node)) || node.closest('.el-date-editor')) { supported = false; reason = '自定义控件暂不支持'; }
    const sensitiveAutocomplete = String(node.autocomplete || '').split(/\s+/).some(token => /^(?:cc-[a-z-]+|one-time-code|current-password|new-password)$/i.test(token));
    if (type === 'password' || sensitiveAutocomplete || /密码|验证码|口令|信用卡|银行卡|安全码|password|captcha|credit.?card|card.?number|one.?time.?code|\bcvv\b|\bcvc\b/i.test(`${label} ${node.name}`)) { supported = false; reason = '敏感字段不自动填写'; }
    if (!label) { supported = false; reason = '没有明确字段标签'; }
    const scopeNode = node.closest('form,dialog,[role="dialog"],.el-dialog,.ant-modal') || node.form || node.closest(formSelector) || document;
    let scope = scopes.find(s => s.node === scopeNode);
    if (!scope) {
      const heading = scopeNode.querySelector?.('legend,h1,h2,h3,[role="heading"]')?.textContent?.trim();
      scope = { node: scopeNode, id: idOf(scopeNode), name: heading?.slice(0, 60) || `表单 ${scopes.length + 1}`, count: 0 };
      scopes.push(scope);
    }
    scope.count++;
    return {
      ...choice,
      id: idOf(node), label, scopeId: scope.id, kind: type,adapter:overrides.kind==='group'?'group':controlAdapter(node),visible:visible(node),labelSource:node.hasAttribute('aria-labelledby')?'aria-labelledby':node.labels?.length?'label':node.hasAttribute('aria-label')?'aria-label':label?'structure':'unresolved',
      // Matching needs occupancy, not the page's existing field contents.
      value: choice ? choice.value : type === 'password' || node.value !== '' ? '\u0001' : '', supported, reason, disabled: choice?.disabled || node.matches(':disabled') || !!node.closest('[aria-disabled="true"]'), readonly: choice ? choice.readonly === true : node.readOnly || node.getAttribute('aria-readonly') === 'true',
      min: node.min || node.getAttribute('aria-valuemin') || '', max: node.max || node.getAttribute('aria-valuemax') || '', step: node.step || '', maxLength: node.maxLength ?? -1,
      options: choice?.options,
    };
  }
  function collect() {
    const scopes = [];
    const roots=rootNodes();
    const nodes = roots.flatMap(controlNodes);
    if (nodes.length > 2000) throw Object.assign(new Error('页面控件超过 2000 个，无法安全扫描，请使用较小的表单页面'), { code: 'CONTROL_LIMIT' });
    const groups=findFieldGroups(nodes,{visible,labelText});
    const members=new Set(groups.flatMap(group=>group.members));
    const fields=[];
    for(const node of nodes) {
      const group=groups.find(group=>group.members[0]===node);
      if(group) {
        const field=describe(group.node,scopes,{label:group.label,kind:'group'});
        field.fields=group.fields.map(child=>describe(child.node,[],{label:child.label}));
        field.value=field.fields.some(child=>child.value && !['checkbox','switch'].includes(child.kind))?'\u0001':'';
        field.supported=field.supported && field.fields.every(child=>child.supported);
        if(!field.supported && !field.reason) field.reason='组合字段含不支持的控件';
        fields.push(field);
      }
      if(!members.has(node)) fields.push(describe(node,scopes));
    }
    for(const root of roots)for(const node of root.querySelectorAll(formSelector)){
      if(visible(node) && !scopes.some(scope=>scope.node===node) && node.querySelector('button[type="button"],[role="button"]'))scopes.push({node,id:idOf(node),name:node.querySelector('legend,h1,h2,h3,[role="heading"]')?.textContent?.trim().slice(0,60) || `表单 ${scopes.length+1}`,count:0});
    }
    return { scopes, fields, roots,coverage:scanCoverage({fields,roots,rawCandidates:roots.flatMap(candidateNodes).length}),nodes: new Map([...nodes,...groups.map(group=>group.node)].map(n => [idOf(n), n])) };
  }
  function sourceValue(field,nodes) {
    if(!field) return null;
    const node=nodes.get(field.id);
    if(!field.supported || !node?.isConnected) return null;
    if(field.kind==='group') {
      const fields=field.fields.map(child=>sourceValue(child,nodes));
      if(fields.some(child=>!child)) return null;
      return {label:field.label,kind:'group',value:'',fields,confirmed:true};
    }
    const state=readChoice(node);
    if(choiceInfo(node) && !state) return null;
    if(!state && !field.value) return null;
    if(state && !state.value && !state.values?.length && typeof state.checked!=='boolean') return null;
    const textLayout=!state?nativeTextLayout(node):undefined;
    return {label:field.label,...(state || {value:node.value}),confirmed:true,...(textLayout?{textLayout}:{})};
  }
  async function writeText(node,value) {
    const proto=node.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,'value').set;
    node.focus();
    setter.call(node,value);
    node.dispatchEvent(new InputEvent('input',{bubbles:true,composed:true,inputType:'insertText',data:value}));
    node.dispatchEvent(new Event('change',{bubbles:true,composed:true}));
    node.blur();
    await new Promise(resolve=>setTimeout(resolve,80));
    if(!node.isConnected || node.value!==value) throw new Error('页面未保留写入值，请检查');
    if(!node.validity.valid || node.getAttribute('aria-invalid')==='true') throw new Error(node.validationMessage || '页面校验未通过');
  }
  const fingerprint = field => JSON.stringify(field);
  function planFor(rows, fields, nodes, syncStates) {
    const resolved=prepareMultiRows(rows,fields,{allowDeferred:true});
    rows=resolved.rows;
    const targets=fields.map(field=>{
      if(field.kind!=='group') return field;
      const sources=rows.filter(row=>row.kind==='group' && exactName(row.label)===exactName(field.label));
      if(sources.length!==1 || !syncStates || !sources[0].fields.some(child=>['checkbox','switch'].includes(child.kind))) return field;
      return {...field,fields:field.fields.map(child=>{
        const matches=sources[0].fields.filter(row=>exactName(row.label)===exactName(child.label));
        const node=nodes.get(child.id);
        return {...child,sameValue:matches.length===1 && !!node && !choiceInfo(node) && child.value!=='' && node.value===matches[0].value};
      })};
    });
    return planMatches(rows,targets,{syncStates}).map((entry,index)=>({...entry,...(resolved.automatic.has(index)?{autoConfirmed:true}:{}),...(resolved.deferred.has(index)?{autoPending:true}: {})}));
  }
  function additionsFor(plan,rows,scope,syncStates,allowAdd){
    const additions=new Map();
    if(allowAdd!==true)return {plan,additions};
    return {plan:plan.map(entry=>{
      const row=rows[entry.index];
      if(entry.reason!=='没有同名字段' || !rowReady(row) || row.kind!=='group' || !validRows([row]) || rows.filter(peer=>exactName(peer.label)===exactName(row.label)).length!==1 || row.fields.some(child=>!rowReady(child) || child.checked!==undefined && !syncStates))return entry;
      const candidate=findAddEntry(scope,row.label,{visible,labelText});
      if(!candidate)return entry;
      if(additions.size>=maxAdditions)return {...entry,reason:`单次最多新增 ${maxAdditions} 行`};
      additions.set(entry.index,candidate);
      return {...entry,ready:true,create:true,reason:'将调用明确的添加入口，核对新增控件后填写'};
    }),additions};
  }
  function contextValid(token) {
    return session && token === session.token && session.url === location.href && session.document === document;
  }
  async function scan() {
    const sequence=++scanSequence,url=location.href,deadline=Date.now()+1500;
    session = null;
    let data,last='',repeats=0,stable=false;
    while(Date.now()<deadline){
      if(sequence!==scanSequence || location.href!==url || shelfRevoked)return {ok:false,error:'页面或扫描任务已变化，请重试'};
      data=collect();
      const busy=data.roots.some(root=>[...root.querySelectorAll('[aria-busy="true"]')].some(visible));
      const snapshot=JSON.stringify(data.fields);
      repeats=!busy && snapshot===last?repeats+1:0;last=snapshot;
      if(repeats>=2){stable=true;break;}
      await new Promise(resolve=>setTimeout(resolve,100));
    }
    if(sequence!==scanSequence || location.href!==url || shelfRevoked)return {ok:false,error:'页面或扫描任务已变化，请重试'};
    data.coverage.stable=stable;
    session = { ...data, document, url, token: newToken(), previews: new Map() };
    return { ok: true, token: session.token, url, title: document.title, fields: data.fields, scopes: data.scopes.map(({ id, name, count }) => ({ id, name, count })), frames:data.coverage.frames.length,coverage:data.coverage };
  }
  function inspect({rows,scopeId,syncStates,allowAdd}){
    const data=collect();
    const scopes=data.scopes.map(({id,name,count})=>({id,name,count}));
    const selected=scopes.some(s=>s.id===scopeId)?scopeId:scopes.length===1?scopes[0].id:null;
    const fields=data.fields.filter(f=>f.scopeId===selected);
    const resolvedRows=selected?prepareMultiRows(rows,fields).rows:rows;
    return {scopes,coverage:data.coverage,resolvedRows,plan:selected?additionsFor(planFor(rows,fields,data.nodes,syncStates),rows,data.scopes.find(scope=>scope.id===selected)?.node,syncStates,allowAdd).plan:[]};
  }
  function preview(message) {
    if (!contextValid(message.token)) return { ok: false, error: '页面已变化，请重新扫描' };
    if(session.coverage.stable!==true)return {ok:false,error:'表单仍在加载或变化，请稍后重新扫描'};
    if (!validRows(message.rows)) return { ok: false, error: '识别数据格式无效或超过限制' };
    if (!session.scopes.some(s => s.id === message.scopeId)) return { ok: false, error: '请选择有效表单' };
    const current = collect();
    const fields = current.fields.filter(f => f.scopeId === message.scopeId);
    const scope=session.scopes.find(scope=>scope.id===message.scopeId).node;
    const {plan,additions}=additionsFor(planFor(message.rows, fields,current.nodes,message.syncStates===true),message.rows,scope,message.syncStates===true,message.allowAdd);
    const previewId = newToken();
    session.previews.clear();
    session.previews.set(previewId, { rows: message.rows, plan, additions,scope,scopeId: message.scopeId, fields, nodes: current.nodes,syncStates:message.syncStates===true });
    return { ok: true, previewId, plan };
  }
  async function fill(message) {
    if(filling)return {ok:false,error:'正在填写，请稍候'};
    filling=true;shelf?.setFilling(true);
    try{return await performFill(message);}finally{filling=false;shelf?.setFilling(false);}
  }
  async function performFill(message) {
    if (!contextValid(message.token)) return { ok: false, error: '页面已变化，请重新扫描' };
    const saved = session.previews.get(message.previewId);
    if (!saved) return { ok: false, error: '预览已失效，请重新匹配' };
    session.previews.clear();
    const results = [];
    for(const [index,candidate]of saved.additions){
      try{
        if(!contextValid(message.token) || !saved.scope.isConnected)throw Error('页面已变化，已停止增项');
        const before=collect();
        if(before.fields.some(field=>field.scopeId===saved.scopeId && exactName(field.label)===exactName(saved.rows[index].label)))throw Error('同名控件已出现，请重新扫描');
        const latest=findAddEntry(saved.scope,saved.rows[index].label,{visible,labelText});
        if(!latest || latest.button!==candidate.button || latest.region!==candidate.region)throw Error('添加入口已变化，请重新扫描');
        const previous=new Set(before.nodes.values());
        const dialogs=()=>rootNodes().flatMap(root=>[...root.querySelectorAll('dialog,[role="dialog"],.el-dialog,.ant-modal')]).filter(visible);
        const oldDialogs=new Set(dialogs());
        candidate.button.click();
        let found=null,stable='',repeats=0;
        for(let attempt=0;attempt<25;attempt++){
          if(!contextValid(message.token) || !saved.scope.isConnected)throw Error('页面已变化，已停止增项');
          const current=collect();
          if(dialogs().some(node=>!oldDialogs.has(node)))throw Error('添加入口打开了新对话框，已停止填写');
          const added=current.fields.filter(field=>field.scopeId===saved.scopeId && !previous.has(current.nodes.get(field.id)));
          if(added.length){
            const entry=planFor(saved.rows,current.fields.filter(field=>field.scopeId===saved.scopeId),current.nodes,saved.syncStates)[index];
            const target=added.find(field=>field.id===entry?.targetId);
            if(added.length===1 && target?.kind==='group' && entry?.ready && candidate.region.contains(current.nodes.get(target.id))){
              const signature=fingerprint(target);repeats=signature===stable?repeats+1:0;stable=signature;
              if(repeats>=2){found={current,target,entry};break;}
            }
          }
          await new Promise(resolve=>setTimeout(resolve,60));
        }
        if(!found)throw Error('未确认唯一且完整的新增行，已停止填写；请检查页面');
        saved.plan[index]={...found.entry,created:true};saved.fields.push(found.target);
        for(const [id,node]of found.current.nodes)saved.nodes.set(id,node);
      }catch(error){
        return {ok:true,results:saved.plan.map(entry=>({...entry,status:entry.index===index?'failed':'skipped',reason:entry.index===index?error.message:'增项未完成，已停止本次填写'}))};
      }
    }
    for (const entry of saved.plan) {
      if (!entry.ready) { results.push({ ...entry, status: 'skipped' }); continue; }
      if (!contextValid(message.token)) { results.push({ ...entry, status: 'skipped', reason: '页面已跳转，已停止填写' }); break; }
      const node = saved.nodes.get(entry.targetId);
      const old = saved.fields.find(f => f.id === entry.targetId);
      const current = collect();
      const currentField = current.fields.find(f => f.id === entry.targetId);
      if (!node?.isConnected || !currentField || fingerprint(old) !== fingerprint(currentField)) {
        results.push({ ...entry, status: 'skipped', reason: '目标已变化，请重新扫描' }); continue;
      }
      const recheck = planFor(saved.rows, current.fields.filter(f => f.scopeId === saved.scopeId),current.nodes,saved.syncStates)[entry.index];
      if (!recheck?.ready || recheck.targetId !== entry.targetId) { results.push({ ...entry, status: 'skipped', reason: recheck?.reason || '匹配已变化' }); continue; }
      if(entry.kind==='group') {
        try {
          for(const child of entry.fields) {
            if(!contextValid(message.token)) throw new Error('页面已变化');
            const latest=collect();
            const group=latest.fields.find(field=>field.id===entry.targetId);
            const original=currentField.fields.find(field=>field.id===child.targetId);
            const actual=group?.fields.find(field=>field.id===child.targetId);
            const target=latest.nodes.get(child.targetId);
            if(!target?.isConnected || !actual || fingerprint(original)!==fingerprint(actual)) throw new Error('组合字段子项已变化，已停止后续填写');
            if(child.unchanged) {
              if(target.value!==child.value) throw new Error('组合字段原值已变化，已停止后续填写');
              continue;
            }
            if(choiceInfo(target)) await writeChoice(target,child);
            else await writeText(target,child.value);
          }
          const latest=collect();
          const actual=sourceValue(latest.fields.find(field=>field.id===entry.targetId),latest.nodes);
          if(!actual || actual.fields.some(field=>{
            const expected=entry.fields.find(child=>child.label===field.label);
            return expected && (expected.checked!==undefined?field.checked!==expected.checked:field.value!==expected.value);
          })) throw new Error('组合字段未保留写入结果');
          results.push({...entry,status:'filled',reason:'组合字段已写入并读回一致'});
        } catch(error) {results.push({...entry,status:'failed',reason:error.message || '组合字段填写失败'});}
        continue;
      }
      if(choiceInfo(node)) {
        try {
          const actual=await writeChoice(node,entry);
          if(!contextValid(message.token) || !node.isConnected) throw new Error('页面已变化');
          results.push({...entry,...(actual.values?{values:actual.values}:{}),status:'filled',reason:'已设置并读回一致'});
        } catch(error) {results.push({...entry,status:'failed',reason:error.message || '选择控件设置失败'});}
        continue;
      }
      const value = currentField.kind === 'select' ? currentField.options.find(o => o.text === entry.value).value : entry.value;
      const proto = node.tagName === 'SELECT' ? HTMLSelectElement.prototype : node.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
      try {
        setter.call(node, value);
        node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
        node.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
        await new Promise(resolve => setTimeout(resolve, 80));
        if (!node.isConnected || node.value !== value) results.push({ ...entry, status: 'failed', reason: '页面未保留写入值，请检查' });
        else if (!node.validity.valid || node.getAttribute('aria-invalid') === 'true') results.push({ ...entry, status: 'invalid', reason: node.validationMessage || '页面校验未通过' });
        else results.push({ ...entry, status: 'filled', reason: '已写入并读回一致' });
      } catch { results.push({ ...entry, status: 'failed', reason: '控件写入失败' }); }
    }
    return { ok: true, results:results.map(entry=>entry.created?{...entry,reason:`已新增一行；${entry.reason}`}:entry) };
  }
  function labelBounds(label) {
    const bounds=[];
    const descriptions=new Set((label.control?.getAttribute('aria-describedby') || '').split(/\s+/).filter(Boolean));
    const walker=document.createTreeWalker(label,NodeFilter.SHOW_TEXT);
    for(let textNode=walker.nextNode();textNode;textNode=walker.nextNode()) {
      if(!textNode.textContent.trim() || !visible(textNode.parentElement)) continue;
      let hint=textNode.parentElement;
      while(hint && hint!==label && !hint.matches(hintSelector) && !descriptions.has(hint.id)) hint=hint.parentElement;
      if(hint && hint!==label) continue;
      const range=document.createRange();range.selectNodeContents(textNode);
      bounds.push(...[...range.getClientRects()].filter(box=>box.width && box.height));
    }
    return bounds;
  }
  function stateGlyphs(node) {
    if(choiceInfo(node)?.kind!=='checkbox' || node.matches('input')) return [node];
    const glyphs=[...node.querySelectorAll('input[type="checkbox"],.ivu-checkbox,.el-checkbox__input,.ant-checkbox')].filter(visible);
    return glyphs.length ? glyphs : [node];
  }
  function sourceBounds(field,nodes) {
    const node=nodes.get(field.id);
    const boxes=field.kind==='group' ? field.fields.flatMap(child=>sourceBounds(child,nodes)) : stateGlyphs(node).map(item=>item.getBoundingClientRect());
    const labelOwners=field.kind==='group' ? [node] : [node,...node.querySelectorAll('input[type="checkbox"]')];
    const labels=[...new Set(labelOwners.flatMap(owner=>[
      ...(owner.labels || []),
      ...(owner.getAttribute('aria-labelledby') || '').trim().split(/\s+/).filter(Boolean).map(id=>owner.getRootNode().getElementById?.(id)).filter(Boolean),
    ]))].filter(visible);
    if(!labels.length) {
      for(let parent=node.parentElement,depth=0;parent && depth<8;parent=parent.parentElement,depth++) {
        const candidates=[...parent.querySelectorAll('label,legend,[class]')].filter(label=>visible(label) && labelText(label)===field.label && !label.contains(node));
        const leaves=candidates.filter(label=>!candidates.some(other=>other!==label && label.contains(other)));
        if(leaves.length) {labels.push(...leaves);break;}
        if(parent.matches('form,body,html')) break;
      }
    }
    boxes.push(...labels.flatMap(labelBounds));
    return boxes;
  }
  function sourceHintBounds(data) {
    const groupIds=new Set(data.fields.filter(field=>field.kind==='group').map(field=>field.id));
    const controls=[...data.nodes].filter(([id])=>!groupIds.has(id)).map(([,node])=>node);
    const captions=new Set();
    const descriptions=new Set();
    for(const control of controls) {
      for(const owner of [control,...control.querySelectorAll('input,textarea,select,[aria-describedby],[aria-labelledby],[aria-errormessage]')]) {
        for(const label of owner.labels || []) captions.add(label);
        for(const attribute of ['aria-labelledby','aria-describedby','aria-errormessage']) {
          for(const id of (owner.getAttribute(attribute) || '').split(/\s+/).filter(Boolean)) {
            const target=owner.getRootNode().getElementById?.(id);
            if(target) (attribute==='aria-labelledby'?captions:descriptions).add(target);
          }
        }
      }
    }
    const roots=rootNodes();
    for(const root of roots) {
      for(const node of root.querySelectorAll('label,legend,[class]')) {
        if(node.matches('label,legend') || [...node.classList].some(name=>/(?:^|[-_])label(?:__text)?$/i.test(name))) captions.add(node);
      }
      for(const node of root.querySelectorAll(hintSelector)) descriptions.add(node);
    }
    const captionNodes=[...captions];
    const rows=new Set();
    for(const control of controls) {
      for(let parent=control.parentElement,depth=0;parent && depth<8 && !parent.matches('form,body,html,[role="form"],[role="dialog"]');parent=parent.parentElement,depth++) {
        if(captionNodes.some(label=>parent.contains(label) && !label.contains(control) && !controls.some(node=>node.contains(label)))) {rows.add(parent);break;}
      }
    }
    const inlineDescriptions=[...descriptions].filter(hint=>!captions.has(hint) && !controls.some(control=>hint.contains(control)));
    const bounds=[],seen=new Set();
    // Only text decorations are removed. Controls and their captions remain
    // image evidence even when their actual value equals a help sentence.
    for(const container of new Set([...descriptions,...rows])) {
      const walker=document.createTreeWalker(container,NodeFilter.SHOW_TEXT);
      for(let text=walker.nextNode();text;text=walker.nextNode()) {
        if(seen.has(text) || !text.textContent.trim() || !visible(text.parentElement)) continue;
        seen.add(text);
        if(controls.some(control=>control.contains(text))) continue;
        if(captionNodes.some(label=>label.contains(text)) && !inlineDescriptions.some(hint=>hint.contains(text))) continue;
        const range=document.createRange();range.selectNodeContents(text);
        for(const rect of range.getClientRects()) if(rect.width && rect.height) bounds.push({x:rect.left-1,y:rect.top-1,width:rect.width+2,height:rect.height+2});
      }
    }
    return bounds;
  }
  function source(geometry=false) {
    const data = collect();
    const emptyControlBounds = geometry ? data.fields.flatMap(field=>field.kind==='group'?field.fields:[field]).flatMap(f => {
      const node=data.nodes.get(f.id);
      if (['checkbox','switch'].includes(f.kind) && f.supported && visible(node)) {
        const rect=node.getBoundingClientRect();
        return [{x:rect.left,y:rect.top,width:rect.width,height:rect.height}];
      }
      if (!['text','textarea','url','email','tel','search','number','select','combobox','multi-select','multi-combobox'].includes(f.kind) || f.value || !visible(node)) return [];
      const masks = ['combobox','multi-combobox'].includes(f.kind)
        ? [node,...node.querySelectorAll('[class*="placeholder"],input[placeholder]')].filter(mask=>mask.matches('[class*="placeholder"],input[placeholder]') && visible(mask))
        : [node];
      return masks.map(mask=>{
        const rect=mask.getBoundingClientRect();
        return {x:rect.left,y:rect.top,width:rect.width,height:rect.height};
      });
    }) : [];
    if(geometry) {
      emptyControlBounds.push(...sourceHintBounds(data));
      const counted=new Set();
      for(const node of data.nodes.values()) {
        if(!node.matches('input,textarea') || !visible(node) || node.maxLength<0) continue;
        for(let parent=node.parentElement,depth=0;parent && depth<4;parent=parent.parentElement,depth++) {
          if(parent.querySelectorAll('input:not([type="hidden"]),textarea,select,[role="combobox"]').length!==1) break;
          const candidates=parent.querySelectorAll('.ivu-input-word-count,.el-input__count,.el-textarea__count,.ant-input-show-count-suffix,.ant-input-data-count,.word-count,.character-count,.char-count');
          for(const counter of candidates) {
            const count=/^(\d+)\s*\/\s*(\d+)$/.exec(counter.textContent.trim());
            if(counted.has(counter) || !visible(counter) || !count || Number(count[1])!==node.value.length || Number(count[2])!==node.maxLength) continue;
            counted.add(counter);
            for(const rect of labelBounds(counter)) {
              if(!emptyControlBounds.some(mask=>mask.x<=rect.left && mask.y<=rect.top && mask.x+mask.width>=rect.right && mask.y+mask.height>=rect.bottom)) emptyControlBounds.push({x:rect.left,y:rect.top,width:rect.width,height:rect.height});
            }
          }
          if(parent.matches('form,body,html')) break;
        }
      }
    }
    const rows = data.fields.flatMap(f => {
      const node = data.nodes.get(f.id);
      const rect=node.getBoundingClientRect();
      if(!f.supported || rect.bottom<=0 || rect.top>=innerHeight || rect.right<=0 || rect.left>=innerWidth) return [];
      const row=sourceValue(f,data.nodes);
      if(!row) return [];
      if(geometry) {
        const boxes=sourceBounds(f,data.nodes);
        const left=Math.min(...boxes.map(box=>box.left)),top=Math.min(...boxes.map(box=>box.top));
        const right=Math.max(...boxes.map(box=>box.right)),bottom=Math.max(...boxes.map(box=>box.bottom));
        row.bounds={x:left,y:top,width:right-left,height:bottom-top};
      }
      return [row];
    });
    if (!validRows(rows)) return {ok:false,error:'截图内字段超过限制'};
    return {ok:true, rows, emptyControlBounds};
  }
  const dragType = 'application/x-local-screenshot-field';
  const plainDragKey=event=>/^local-screenshot:([a-f0-9-]{36})$/.exec(event.dataTransfer?.getData('text/plain') || '')?.[1];
  let dragHint=null;
  let highlight=null;
  function clearHighlight() {highlight?.remove();highlight=null;}
  function showHighlight(node) {
    clearHighlight();
    if(!node) return;
    const rect=node===document ? {left:3,top:3,width:innerWidth-6,height:innerHeight-6} : node.getBoundingClientRect();
    highlight=document.createElement('div');
    highlight.style.cssText=`all:initial;position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;pointer-events:none;z-index:2147483647;box-sizing:border-box;outline:3px solid #07966e;background:#07966e0a`;
    document.documentElement.append(highlight);
  }
  document.addEventListener('dragover', event => {
    if(shelfRevoked)return;
    const fallback=dragHint && dragHint.url===location.href && dragHint.expires>Date.now() && event.dataTransfer?.types.includes('text/plain') && !event.dataTransfer.types.includes('Files');
    if (!event.dataTransfer?.types.includes(dragType) && !fallback) return;
    event.preventDefault(); event.dataTransfer.dropEffect = 'copy';
    const element=event.composedPath().find(node=>node instanceof Element);
    showHighlight(element?.closest('form,[role="form"],[role="dialog"],.el-form,.ant-form') || null);
  }, true);
  document.addEventListener('dragleave',event=>{if(!event.relatedTarget)clearHighlight();},true);
  document.addEventListener('dragend',clearHighlight,true);
  document.addEventListener('drop', async event => {
    const plainKey=plainDragKey(event);
    if (!event.dataTransfer?.types.includes(dragType) && !plainKey) {clearHighlight();return;}
    // Prevent the browser's text-drop default even when the match is rejected.
    event.preventDefault(); event.stopImmediatePropagation();
    clearHighlight();
    let saved = drag; drag = null;
    if (!event.isTrusted || shelfRevoked) return;
    const key=event.dataTransfer.getData(dragType) || plainKey;
    dragHint=null;
    const url=location.href,path=event.composedPath();
    try {
      if(saved?.registration){await saved.registration;saved=null;}
      if(!saved || saved.expires<Date.now() || saved.url!==url || saved.key!==key) {
        const response=await chrome.runtime.sendMessage({type:'CLAIM_DRAG',key});
        if(!response?.ok) throw new Error(response?.error || '拖拽未生效，请重新拖动');
        saved=response.drag;
      }
      if(shelfRevoked)throw new Error('网站访问已撤销，请重新授权');
      if(url!==location.href) throw new Error('页面已切换，请重新拖拽');
      const data = await scan();
      if(!data.ok)throw Error(data.error);
      const node = path.find(n => session.nodes.has(idOf(n)));
      const field = node && data.fields.find(f => f.id === idOf(node));
      const batch = saved.index === -1;
      if (!batch && !field) throw new Error('请拖到输入框内');
      let scopeId = field?.scopeId;
      if (batch && !scopeId) {
        const scopeNode = path.find(n => n !== document && session.scopes.some(s=>s.node===n));
        scopeId = session.scopes.find(s=>s.node===scopeNode)?.id;
        if (!scopeId && data.scopes.length===1) scopeId=data.scopes[0].id;
        if (!scopeId) throw new Error('当前页有多个表单，请将截图拖到目标表单内部');
      }
      const plan = preview({token:data.token,scopeId,rows:saved.rows,syncStates:saved.syncStates,allowAdd:batch && saved.allowAdd===true});
      if (!plan.ok) throw new Error(plan.error);
      if (!batch) {
        const entry = plan.plan[saved.index];
        if (!entry?.ready || entry.targetId !== field.id) throw new Error(entry?.reason || '字段名称不完全一致');
        // A single-field drag writes only that row. A screenshot uses the full
        // same-name plan, constrained to the form under the pointer.
        const retained = session.previews.get(plan.previewId);
        retained.plan = retained.plan.filter(p => p.index === saved.index);
      }
      const result = await fill({token:data.token,previewId:plan.previewId});
      if(shelf)shelf.showResult(result.results);
      const count = result.results.filter(r=>r.status==='filled').length;
      const text = batch ? `已填写 ${count} 项，跳过 ${result.results.length-count} 项` : result.results[0]?.reason || '未填写';
      chrome.runtime.sendMessage({type:'DROP_RESULT',dragKey:key,text,results:result.results}).catch(() => {});
    } catch (error) { if(shelf){shelf.open(true);shelf.status(error.message || '拖拽未填写',true);}chrome.runtime.sendMessage({type:'DROP_RESULT',dragKey:key,text:error.message || '拖拽未填写'}).catch(() => {}); }
  }, true);
  chrome.runtime.onMessage.addListener((message, sender, respond) => {
    if (sender.id !== chrome.runtime.id || !['SCAN', 'PREVIEW', 'FILL', 'SOURCE', 'ARM_DRAG', 'DRAG_READY', 'ENABLE_RECEIVER', 'SHOW_SHELF', 'HIDE_SHELF', 'SHELF_ERROR', 'REVOKE_SHELF'].includes(message?.type)) return;
    Promise.resolve().then(() => {
      if(message.type==='REVOKE_SHELF'){shelfRevoked=true;scanSequence++;shelf?.destroy();shelf=null;session=null;drag=null;dragHint=null;clearHighlight();return {ok:true};}
      if(message.type==='ENABLE_RECEIVER'){shelfRevoked=false;if(!shelf)document.getElementById('local-screenshot-shelf')?.remove();return {ok:true};}
      if(message.type==='SHOW_SHELF'){shelfRevoked=false;const current=getShelf();if(message.expanded===true)current.open(true);return {ok:true};}
      if(shelfRevoked)return {ok:false,error:'网站访问已撤销，请重新授权'};
      if(message.type==='HIDE_SHELF'){if(shelf)shelf.host.style.visibility=message.hidden?'hidden':'';return {ok:true};}
      if(message.type==='SHELF_ERROR'){if(shelf){shelf.open(true);shelf.status(message.text,true);}return {ok:true};}
      if(message.type==='DRAG_READY') {
        if(!/^[a-f0-9-]{36}$/.test(message.key || '')) return {ok:false};
        dragHint={key:message.key,url:location.href,expires:Date.now()+60000};return {ok:true};
      }
      if (message.type === 'SOURCE') return source(message.geometry===true);
      if (message.type === 'ARM_DRAG') {
        if (!validRows(message.rows) || !message.rows.length || !Number.isInteger(message.index) || (message.index !== -1 && !message.rows[message.index]) || typeof message.key !== 'string') return {ok:false,error:'拖拽数据无效'};
        drag = {...message,url:location.href,expires:Date.now()+60000}; return {ok:true};
      }
      return message.type === 'SCAN' ? scan() : message.type === 'PREVIEW' ? preview(message) : fill(message);
    }).then(respond).catch(error => respond({ ok: false, error: error?.code === 'CONTROL_LIMIT' ? error.message : '页面处理失败，请重新扫描' }));
    return true;
  });
}
