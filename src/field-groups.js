import {choiceInfo, choiceLabel} from './controls.js';

function slotName(node) {
  const names=[node.getAttribute('data-field'),node.name?.split(/[.\[\]]/).filter(Boolean).at(-1),node.getAttribute('aria-label'),node.placeholder];
  const roles=new Set(names.filter(Boolean).flatMap(name=>{
    const match=/^(?:请输入|请填写|输入|填写)?\s*(key|value|键|值|键名|键值)\s*$/i.exec(name.trim());
    return match ? [/^(?:key|键|键名)$/i.test(match[1])?'key':'value'] : [];
  }));
  return roles.size===1 ? [...roles][0] : '';
}

export function findFieldGroups(nodes, {visible, labelText}) {
  const groups=[];
  const textNodes=nodes.filter(node=>node.matches('input:not([type]),input[type="text"],input[type="search"],textarea') && visible(node) && !choiceInfo(node));
  for (const node of textNodes) {
    if (!slotName(node) || groups.some(group=>group.node.contains(node))) continue;
    for (let parent=node.parentElement,depth=0;parent && depth<8 && !parent.matches('form,body,html,[role="dialog"]');parent=parent.parentElement,depth++) {
      const members=nodes.filter(member=>parent.contains(member) && visible(member) && member.type!=='hidden');
      const texts=members.filter(member=>textNodes.includes(member));
      if (texts.length!==2 || members.some(member=>!texts.includes(member) && !['checkbox','switch'].includes(choiceInfo(member)?.kind))) continue;
      const key=texts.filter(member=>slotName(member)==='key'),value=texts.filter(member=>slotName(member)==='value');
      if(key.length!==1 || value.length!==1) continue;
      const flags=members.filter(member=>!texts.includes(member));
      const flagFields=flags.map(member=>({node:member,label:choiceLabel(member)}));
      if(flagFields.some(field=>!field.label) || new Set(flagFields.map(field=>field.label)).size!==flags.length) continue;
      const labels=[...parent.querySelectorAll('label,legend,[class]')].filter(label=>{
        if(!visible(label) || members.some(member=>label===member || label.contains(member) || member.contains(label))) return false;
        if(flagFields.some(field=>field.label===labelText(label))) return false;
        if(label.tagName==='LABEL' && label.control) return false;
        return label.matches('label,legend') || [...label.classList].some(name=>/(?:^|[-_])label(?:__text)?$/i.test(name));
      });
      const leaves=labels.filter(label=>!labels.some(other=>other!==label && label.contains(other)));
      if(leaves.length!==1 || !labelText(leaves[0])) continue;
      groups.push({node:parent,label:labelText(leaves[0]),fields:[{node:key[0],label:'key'},{node:value[0],label:'value'},...flagFields],members});
      break;
    }
  }
  return groups;
}
