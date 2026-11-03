import {resolveMultiValue} from './multi-values.js';

const OCCUPIED = '\u0001';
const frameworkSelector = '.ivu-select,.el-select,.ant-select';
const checkboxWrapperSelector = '.ivu-checkbox-wrapper,.el-checkbox,.ant-checkbox-wrapper';
const switchSelector = '.ivu-switch,.el-switch,.ant-switch';
const groupSelector = '[role="radiogroup"],fieldset';
const candidates = `input,textarea,select,${frameworkSelector},${checkboxWrapperSelector},${switchSelector},[role="textbox"],[role="spinbutton"],[role="slider"],[contenteditable]:not([contenteditable="false"]),[role="combobox"],[role="listbox"],[role="checkbox"],[role="switch"],[role="radio"],[role="radiogroup"],fieldset`;
const popupSelector = '[role="listbox"],.ivu-select-dropdown,.el-select-dropdown,.ant-select-dropdown';
const text = node => (node?.textContent || '').trim();
const has = (node, selector) => node?.matches?.(selector);
const disabled = node => !!node && (node.matches(':disabled,[aria-disabled="true"],.is-disabled,.ivu-select-disabled,.ant-select-disabled,.ivu-select-item-disabled,.ant-select-item-option-disabled,.ivu-checkbox-wrapper-disabled,.ivu-checkbox-disabled,.ant-checkbox-wrapper-disabled,.ant-checkbox-disabled,.ivu-switch-disabled,.ant-switch-disabled') || !!node.closest('[inert],[aria-disabled="true"]'));
const readonly = node => node.readOnly === true || node.getAttribute('aria-readonly') === 'true';
const visible = node => {
  if (!node) return false;
  for (let current=node; current; current=current.parentElement || current.getRootNode()?.host) {
    if (current.matches('[hidden],[aria-hidden="true"],[inert]')) return false;
    const style=getComputedStyle(current);
    if (style.display==='none' || ['hidden','collapse'].includes(style.visibility) || style.opacity==='0' || style.contentVisibility==='hidden' || style.clipPath!=='none' || style.clip!=='auto') return false;
  }
  return [...node.getClientRects()].some(rect => rect.width && rect.height);
};
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

function accessibleLabel(node) {
  const ids = node.getAttribute('aria-labelledby')?.trim().split(/\s+/);
  if (ids?.length) {
    const elements = ids.map(id => node.getRootNode().getElementById?.(id));
    return elements.every(element=>element && text(element)) ? elements.map(text).join(' ') : '';
  }
  const labels = [...(node.labels || [])].map(text).filter(Boolean);
  if (labels.length) return labels.every(label => label === labels[0]) ? labels[0] : '';
  return node.getAttribute('aria-label')?.trim() || '';
}

function stateWrapperName(node) {
  if (has(node, 'input') || !has(node, `${checkboxWrapperSelector},${switchSelector},[role="checkbox"],[role="switch"]`)) return null;
  const inputs = [...node.querySelectorAll('input[type="checkbox"]')];
  const names = [];
  let invalid = false;
  for (const control of [node, ...(inputs.length === 1 ? inputs : [])]) {
    const aria = control.getAttribute('aria-label')?.trim();
    if (aria) names.push(aria);
    const references = control.getAttribute('aria-labelledby')?.trim();
    if (references) {
      const labels = references.split(/\s+/).map(id => control.getRootNode().getElementById?.(id));
      if (labels.some(label => !label || !text(label))) invalid = true;
      else names.push(labels.map(text).join(' '));
    }
    if (control !== node) for (const label of control.labels || []) {
      // A wrapper's own caption is fallback text, not an independent field name.
      if (!node.contains(label) && !label.contains(node) && text(label)) names.push(text(label));
    }
  }
  return { name: names[0] || '', conflict: invalid || new Set(names).size > 1 };
}

function radioMembers(node) {
  if (!has(node, groupSelector)) return [];
  return [...node.querySelectorAll('input[type="radio"],[role="radio"]')].filter(member => member.closest(groupSelector) === node && !(member.getAttribute('role') === 'radio' && member.querySelector('input[type="radio"]')));
}

function representative(node) {
  // Hidden/password fields remain separate so the scanner can reject them.
  if (has(node, 'input[type="hidden"],input[type="password"]')) return node;
  const framework = node.closest(frameworkSelector);
  if (framework) return framework;
  const stateWrapper = node.closest(`${switchSelector},${checkboxWrapperSelector}`);
  if (stateWrapper && (has(node, `input[type="checkbox"],${switchSelector},${checkboxWrapperSelector},[role="checkbox"],[role="switch"]`))) return stateWrapper;
  const semantic=node.closest('[role="textbox"],[role="spinbutton"],[role="slider"],[contenteditable]:not([contenteditable="false"])');
  if(semantic && !semantic.matches('input,textarea,select'))return semantic;
  if (has(node, 'input[type="radio"],[role="radio"]')) return node.closest(groupSelector) || node;
  const wrapper = node.closest('[role="combobox"],[role="checkbox"],[role="switch"]');
  if (wrapper && wrapper !== node && !has(wrapper, 'input,select')) return wrapper;
  return node;
}

export function controlNodes(root) {
  const nodes = candidateNodes(root);
  return [...new Set(nodes.filter(node => !has(node,'input[type="button"],input[type="submit"],input[type="reset"],input[type="image"]') && (!has(node, 'fieldset') || radioMembers(node).length)).map(representative))].filter(node => {
    if (!has(node, '[role="listbox"]')) return true;
    if (node.closest(frameworkSelector)) return false;
    const id = node.id;
    return !id || !nodes.some(owner => owner !== node && ['aria-controls', 'aria-owns'].some(attr => owner.getAttribute(attr)?.split(/\s+/).includes(id)));
  });
}

export function candidateNodes(root){
  const nodes=[...root.querySelectorAll(candidates)];
  if(root.matches?.(candidates))nodes.unshift(root);
  return nodes;
}

export function controlAdapter(node){
  for(const name of ['ivu','el','ant'])if(node.matches(`.${name}-select,.${name}-checkbox,.${name}-checkbox-wrapper,.${name}-switch`))return name;
  if(node.matches('input,textarea,select'))return 'html';
  return node.hasAttribute('role')?'aria':'unadapted';
}

export function choiceLabel(node) {
  const wrapperName = stateWrapperName(node);
  if (wrapperName?.conflict) return '';
  if (wrapperName?.name) return wrapperName.name;
  const explicit = accessibleLabel(node);
  if (explicit) return explicit;
  if (has(node, `${switchSelector},[role="switch"]`)) return '';
  if (has(node, groupSelector) && radioMembers(node).length) return text([...node.children].find(child => child.tagName === 'LEGEND'));
  if (has(node, `input[type="checkbox"],[role="checkbox"],${checkboxWrapperSelector}`)) {
    const label = node.closest(`label,${checkboxWrapperSelector}`);
    return label ? text(label) : '';
  }
  return '';
}

function linkedPopups(node) {
  const controls = [node, ...node.querySelectorAll('[aria-controls],[aria-owns]')];
  const result = new Set();
  for (const control of controls) for (const attr of ['aria-controls', 'aria-owns']) {
    for (const id of (control.getAttribute(attr) || '').split(/\s+/).filter(Boolean)) {
      const linked = control.getRootNode().getElementById?.(id);
      if (linked && (has(linked, popupSelector) || linked.querySelector('[role="option"]'))) result.add(linked);
    }
  }
  if (has(node, '[role="listbox"]')) result.add(node);
  for (const popup of node.querySelectorAll(popupSelector)) result.add(popup);
  // ARIA listbox can sit inside a framework popup: use the outer owner only once.
  return [...result].filter(popup => ![...result].some(other => other !== popup && other.contains(popup)));
}

function optionNodes(popup) {
  return [...popup.querySelectorAll('[role="option"],.ivu-select-item,.el-select-dropdown__item,.ant-select-item-option')].filter(option => !option.parentElement.closest('[role="option"],.ivu-select-item,.el-select-dropdown__item,.ant-select-item-option'));
}
function optionText(option) {
  return option.getAttribute('aria-label')?.trim() || text(option.querySelector('.ant-select-item-option-content')) || text(option);
}
function optionSelected(option) {
  return option.getAttribute('aria-selected') === 'true' || option.matches('.ivu-select-item-selected,.is-selected,.selected,.ant-select-item-option-selected');
}
function optionsOf(popup) {
  return optionNodes(popup).map((option, index) => ({ text: optionText(option), value: String(index), disabled: disabled(option) }));
}
function customSnapshot(node) {
  const framework = has(node, frameworkSelector);
  const popups = linkedPopups(node);
  const selectedOptions = popups.length === 1 ? optionNodes(popups[0]).filter(optionSelected).map(optionText) : [];
  let multi = node.getAttribute('aria-multiselectable') === 'true' || node.matches('.ivu-select-multiple,.ant-select-multiple') || !!node.querySelector('.el-select__tags,.el-select__selection .el-tag');
  if (popups.length === 1 && popups[0].getAttribute('aria-multiselectable') === 'true') multi = true;
  let values = [];
  if (has(node, '.ivu-select')) values = [...node.querySelectorAll(multi ? '.ivu-tag-text' : '.ivu-select-selected-value')].filter(visible).map(text).filter(Boolean);
  else if (has(node, '.ant-select')) values = [...node.querySelectorAll('.ant-select-selection-item')].filter(visible).map(item => text(item.querySelector('.ant-select-selection-item-content')) || item.getAttribute('title')?.trim() || text(item)).filter(Boolean);
  else if (has(node, '.el-select')) {
    values = [...node.querySelectorAll(multi ? '.el-tag__content' : '.el-select__selected-item:not(.is-transparent):not(.is-hidden)')].filter(item => visible(item) && !item.querySelector('input')).map(text).filter(Boolean);
    if (!multi && !values.length) {
      const input = node.querySelector('input.el-input__inner[readonly]');
      if (input?.value) values = [input.value];
    }
  } else values = selectedOptions;
  if (!values.length && selectedOptions.length) values = selectedOptions;
  const ownInput = has(node, 'input') ? node : node.querySelector('input');
  if (!framework && !multi && ownInput?.readOnly && ownInput.value) values = [ownInput.value];
  const searchPending = !!ownInput?.value && !values.length;
  const explicitSelection = popups.length === 1 && optionNodes(popups[0]).length > 0 && optionNodes(popups[0]).every(option => ['true', 'false'].includes(option.getAttribute('aria-selected')));
  const unsupported = popups.length > 1 || (!framework && !explicitSelection && !(ownInput?.readOnly && !multi)) || (!multi && values.length > 1);
  return { kind: multi ? 'multi-combobox' : 'combobox', value: values.length || searchPending ? OCCUPIED : '', values, supported: !unsupported, reason: unsupported ? '选项结构或当前状态不明确' : '', ...(popups.length === 1 && optionNodes(popups[0]).length ? { options: optionsOf(popups[0]) } : {}) };
}

export function choiceInfo(node) {
  const flags = { disabled: disabled(node) || has(node,frameworkSelector) && [...node.querySelectorAll('input')].some(disabled), readonly: readonly(node) };
  if (has(node, 'select')) return { ...flags, kind: node.multiple ? 'multi-select' : 'select', value: [...node.selectedOptions].some(option => option.value !== '') ? OCCUPIED : '', supported: true, options: [...node.options].map(option => ({ text: option.label.trim(), value: option.value, disabled: option.disabled || option.parentElement?.disabled === true })) };
  if (has(node, `input[type="checkbox"],[role="checkbox"],[role="switch"],${checkboxWrapperSelector},${switchSelector}`)) {
    const inputs = has(node, 'input[type="checkbox"]') ? [node] : [...node.querySelectorAll('input[type="checkbox"]')];
    const input = inputs[0];
    const isSwitch = has(node, `${switchSelector},[role="switch"]`);
    const aria = node.getAttribute('aria-checked');
    const classState = has(node, switchSelector) ? node.matches('.ivu-switch-checked,.el-switch.is-checked,.ant-switch-checked') : undefined;
    const checked = input ? input.checked : ['true', 'false'].includes(aria) ? aria === 'true' : classState;
    const mixed = input?.indeterminate || aria === 'mixed' || node.matches('.is-indeterminate,.ivu-checkbox-indeterminate,.ant-checkbox-indeterminate') || !!node.querySelector('.is-indeterminate,.ivu-checkbox-indeterminate,.ant-checkbox-indeterminate,[aria-checked="mixed"]');
    const namingConflict = stateWrapperName(node)?.conflict;
    const supported = inputs.length <= 1 && typeof checked === 'boolean' && !mixed && !namingConflict && (aria === null || ['true', 'false'].includes(aria) && (aria === 'true') === checked) && (classState === undefined || classState === checked);
    const disabledChild = !!node.querySelector('.ivu-checkbox-disabled,.ant-checkbox-disabled,.el-checkbox__input.is-disabled');
    return { ...flags, disabled: flags.disabled || disabled(input) || disabledChild, readonly: flags.readonly || readonly(input || node), kind: isSwitch ? 'switch' : 'checkbox', value: OCCUPIED, checked, supported, reason: supported ? '' : namingConflict ? '控件明确标签冲突或无效' : '勾选状态不明确' };
  }
  if (has(node, groupSelector) || has(node, 'input[type="radio"],[role="radio"]')) {
    const members = radioMembers(node);
    if (!members.length) return has(node, 'fieldset') ? null : { ...flags, kind: 'radio', value: OCCUPIED, supported: false, reason: '单选组边界不明确' };
    const native = members.filter(member => has(member, 'input'));
    const names = new Set(native.map(member => member.name));
    const selected = members.filter(member => has(member, 'input') ? member.checked : member.getAttribute('aria-checked') === 'true');
    const outside = native.some(member => [...member.getRootNode().querySelectorAll('input[type="radio"]')].some(other => other !== member && other.name === member.name && other.form === member.form && !members.includes(other)));
    const supported = selected.length <= 1 && (!native.length || (native.length === members.length && names.size === 1 && !names.has('') && !outside)) && members.every(member => has(member, 'input') || ['true', 'false'].includes(member.getAttribute('aria-checked')));
    return { ...flags, kind: 'radio', value: selected.length ? OCCUPIED : '', supported, reason: supported ? '' : '单选组结构不明确', options: members.map((member, index) => ({ text: accessibleLabel(member) || (has(member, 'input') ? '' : text(member)), value: String(index), disabled: disabled(member) })) };
  }
  if (has(node, `${frameworkSelector},[role="combobox"],[role="listbox"]`)) return { ...flags, readonly: node.getAttribute('aria-readonly') === 'true', ...customSnapshot(node) };
  return null;
}

export function readChoice(node) {
  const info = choiceInfo(node);
  if (!info?.supported) return null;
  if (['checkbox', 'switch'].includes(info.kind)) return { kind: info.kind, value: '', checked: info.checked };
  if (info.kind === 'radio') {
    const member = radioMembers(node).find(member => has(member, 'input') ? member.checked : member.getAttribute('aria-checked') === 'true');
    const value = member && (accessibleLabel(member) || (has(member, 'input') ? '' : text(member)));
    return value ? { kind: info.kind, value } : null;
  }
  const values = has(node, 'select') ? [...node.selectedOptions].filter(option => option.value !== '').map(option => option.label.trim()) : customSnapshot(node).values;
  if (!values.length || values.some(value => !value) || new Set(values).size !== values.length) return null;
  return info.kind.startsWith('multi-') ? { kind: info.kind, value: values.join('\n'), values } : { kind: info.kind, value: values[0] };
}

function uniqueOptions(options, desired) {
  return desired.map(value => {
    const matches = options.filter(option => option.text === value);
    if (matches.length !== 1 || matches[0].disabled || matches[0].value === '' || options.filter(option => option.value === matches[0].value).length !== 1) throw new Error('没有唯一且可用的同名选项');
    return matches[0];
  });
}
function assertWritable(node, info) {
  if (!node.isConnected || !info?.supported || info.disabled || info.readonly || !visible(node)) throw new Error('控件不可写或状态不明确');
}
function clickChoice(node) {
  const button = node.closest('button');
  if ((button?.form && button.type !== 'button') || node.closest('a[href]') || has(node, 'input[type="submit"],input[type="reset"],input[type="image"]')) throw new Error('控件点击可能触发表单动作');
  node.click();
}
function hasPopupReference(node) {
  return [node, ...node.querySelectorAll('[aria-controls],[aria-owns]')].some(control => ['aria-controls', 'aria-owns'].some(attr => control.getAttribute(attr)?.trim()));
}
function newFrameworkPopups(node, existing) {
  const selector = has(node, '.ivu-select') ? '.ivu-select-dropdown' : has(node, '.el-select') ? '.el-select-dropdown' : '.ant-select-dropdown';
  return [...node.getRootNode().querySelectorAll(selector)].filter(popup => visible(popup) && !existing.some(old => old === popup || old.contains(popup) || popup.contains(old)));
}
function popupStillOwned(node, binding) {
  if (!node.isConnected || !binding.popup.isConnected) return false;
  const linked = linkedPopups(node).filter(visible);
  if (linked.length) return linked.length === 1 && linked[0] === binding.popup;
  if (!binding.existing || hasPopupReference(node)) return false;
  const fresh = newFrameworkPopups(node, binding.existing);
  return fresh.length === 1 && fresh[0] === binding.popup;
}
async function popupAfterOpen(node) {
  const url=location.href;
  const existing = [...node.getRootNode().querySelectorAll(popupSelector)].filter(visible);
  let popups = linkedPopups(node).filter(visible);
  if (popups.length === 1) return { popup: popups[0] };
  if (popups.length > 1) throw new Error('下拉选项归属不明确');
  if (!hasPopupReference(node) && (node.matches('.ivu-select-visible,.ant-select-open,[aria-expanded="true"]') || node.querySelector('[aria-expanded="true"]'))) throw new Error('下拉框已展开但缺少关联信息，请收起后重试');
  let trigger = has(node, frameworkSelector) ? node.querySelector('.ivu-select-selection,.el-select__wrapper,.el-input,.ant-select-selector') : node;
  if (!trigger || disabled(trigger)) throw new Error('没有明确的下拉触发控件');
  clickChoice(trigger);
  const deadline=Date.now()+2500;
  let previous=null;
  while(Date.now()<deadline) {
    await wait(50);
    if(location.href!==url)throw new Error('页面已变化，已停止等待下拉框');
    assertWritable(node,choiceInfo(node));
    popups = linkedPopups(node).filter(visible);
    let binding;
    if (!popups.length && has(node, frameworkSelector) && !hasPopupReference(node)) {
      popups = newFrameworkPopups(node, existing);
      if (popups.length === 1) binding={popup:popups[0],existing};
    }
    if(popups.length>1)throw new Error('出现多个下拉选项面板，无法确定归属');
    if(popups.length===1){
      if(previous===popups[0])return binding || {popup:popups[0]};
      previous=popups[0];
    }else previous=null;
  }
  if(node.matches('[aria-expanded="false"]') || node.querySelector('[aria-expanded="false"]'))throw new Error('下拉框未展开或展开超时，请检查后重试');
  throw new Error('下拉框展开超时或无法确认选项面板归属');
}

export async function writeChoice(node, entry) {
  let info = choiceInfo(node);
  assertWritable(node, info);
  const originalKind = info.kind;
  if (entry.kind && entry.kind !== info.kind) throw new Error('控件类型已变化');
  const state = ['checkbox', 'switch'].includes(info.kind);
  const multi = info.kind.startsWith('multi-');
  if (state && (entry.syncStates !== true || typeof entry.checked !== 'boolean')) throw new Error('未允许同步明确的勾选状态');
  if (!state && info.value !== '' && !(info.kind === 'radio' && entry.syncStates === true)) throw new Error('目标已有内容');
  let desired = multi ? entry.values : [entry.value];
  const deferred = multi && entry.resolveMultiText === true && desired === undefined;
  if (deferred && (typeof entry.value !== 'string' || !entry.value.trim() || entry.value.length>10000)) throw new Error('来源选项格式不明确');
  if (!state && !deferred && (!Array.isArray(desired) || !desired.length || desired.length > 200 || desired.some(value => typeof value !== 'string' || !value.trim() || value.length > 10000) || new Set(desired).size !== desired.length)) throw new Error('来源选项格式不明确');
  if (state) {
    if (info.checked !== entry.checked) clickChoice(node);
  } else if (info.kind === 'radio') {
    const [option] = uniqueOptions(info.options, desired);
    clickChoice(radioMembers(node)[Number(option.value)]);
  } else if (has(node, 'select')) {
    const options = uniqueOptions(info.options, desired);
    const selected = new Set(options.map(option => option.value));
    if (multi) for (const option of node.options) Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'selected').set.call(option, selected.has(option.value));
    else Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(node, options[0].value);
    node.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    node.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
  } else {
    let binding = await popupAfterOpen(node);
    info = choiceInfo(node);
    assertWritable(node, info);
    if (info.value !== '') throw new Error('打开下拉后目标状态已变化');
    const url=location.href,deadline=Date.now()+3000;
    let stableOptions='',ready=false,reason='选项加载超时';
    while(Date.now()<deadline){
      if(location.href!==url)throw new Error('页面已变化，已停止等待下拉选项');
      if (!visible(binding.popup) || !popupStillOwned(node,binding)) throw new Error('下拉选项归属已变化或面板已关闭');
      info=choiceInfo(node);
      assertWritable(node,info);
      if (info.kind!==originalKind || info.value!=='') throw new Error('加载选项后目标状态已变化');
      const loading=[node,binding.popup].some(owner=>owner.matches('[aria-busy="true"]') || [...owner.querySelectorAll('[aria-busy="true"]')].some(visible));
      const options=optionsOf(binding.popup);
      let values=desired;
      try {
        if(loading || !options.length)throw new Error('下拉选项仍在加载');
        if(deferred){const resolved=resolveMultiValue(entry.value,options);if(!resolved.values)throw new Error(resolved.reason);values=resolved.values;}
        uniqueOptions(options,values);
        const snapshot=JSON.stringify(options);
        if(snapshot===stableOptions){desired=values;ready=true;break;}
        stableOptions=snapshot;
      }catch(error){stableOptions='';reason=error.message;}
      await wait(60);
    }
    if(!ready)throw new Error(`等待下拉选项超时：${reason}`);
    uniqueOptions(optionsOf(binding.popup), desired);
    for (let index = 0; index < desired.length; index++) {
      info=choiceInfo(node);
      assertWritable(node,info);
      if (info.kind!==originalKind) throw new Error('控件类型已变化');
      if (multi && (info.values.length!==index || !desired.slice(0,index).every(value=>info.values.includes(value)))) throw new Error('多选状态已变化，已停止后续选择，请检查已选项');
      if (!visible(binding.popup)) binding = await popupAfterOpen(node);
      assertWritable(node,choiceInfo(node));
      if (!popupStillOwned(node, binding)) throw new Error('下拉选项归属已变化');
      const popup = binding.popup;
      const options = optionNodes(popup);
      const [selected] = uniqueOptions(optionsOf(popup), [desired[index]]);
      const option = options[Number(selected.value)];
      if (!visible(option) || !option.isConnected) throw new Error('选项不可见或已变化');
      if (!optionSelected(option)) clickChoice(option);
      await wait(90);
      if (!node.isConnected) throw new Error('目标已被页面替换');
    }
  }
  await wait(120);
  const finalInfo = choiceInfo(node);
  const actual = readChoice(node);
  if (!node.isConnected || !finalInfo?.supported || node.getAttribute('aria-invalid') === 'true' || node.validity?.valid === false) throw new Error('写入后页面校验未通过');
  const matches = state ? actual?.checked === entry.checked : multi ? actual?.values?.length === desired.length && desired.every(value => actual.values.includes(value)) : actual?.value === entry.value;
  if (!matches) throw new Error('页面未保留写入状态');
  return actual;
}
