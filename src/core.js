import {resolveMultiValue} from './multi-values.js';
import {rowSelected,rowReady} from './row-state.js';

export const exactName = value => String(value ?? '').trim();
const emptyPrompt = value => /^(?:请(?:输入|填写|选择|选取)|请输入|请选择)[^\n]{0,40}$/.test(value.trim());
const caption = value => value.replace(/^[*＊]\s*/, '').trim();

const stateKinds = new Set(['checkbox', 'switch']);
const multiKinds = new Set(['multi-select', 'multi-combobox']);
const choiceKinds = new Set(['select', 'combobox', 'radio', ...multiKinds, ...stateKinds]);
const rowKinds = new Set(['text', 'textarea', 'url', 'email', 'tel', 'search', 'number', 'group', ...choiceKinds]);
export function validRows(rows, depth = 0) {
  return Array.isArray(rows) && rows.length <= 200 && rows.every(row => {
    if (!row || typeof row.label !== 'string' || row.label.length > 300 || typeof row.value !== 'string' || row.value.length > 10000 || typeof row.confirmed !== 'boolean') return false;
    if(row.selected!==undefined && typeof row.selected!=='boolean' || row.review!==undefined && !['ready','pending','conflict'].includes(row.review))return false;
    if (row.kind !== undefined && !rowKinds.has(row.kind)) return false;
    if (row.checked !== undefined && (typeof row.checked !== 'boolean' || !stateKinds.has(row.kind))) return false;
    if (stateKinds.has(row.kind) && typeof row.checked !== 'boolean') return false;
    if (row.values !== undefined && (!multiKinds.has(row.kind) || !Array.isArray(row.values) || row.values.length > 200 || !row.values.every(value => typeof value === 'string' && value.trim() && value.length <= 10000) || new Set(row.values).size !== row.values.length || row.values.join('').length > 10000)) return false;
    if (multiKinds.has(row.kind) && !Array.isArray(row.values)) return false;
    if (row.kind === 'group') {
      if (depth || row.value !== '' || row.checked !== undefined || row.values !== undefined || !Array.isArray(row.fields) || row.fields.length < 2 || row.fields.length > 12 || !validRows(row.fields, depth + 1)) return false;
    } else if (row.fields !== undefined) return false;
    return true;
  });
}

function counts(items, key) {
  const map = new Map();
  for (const item of items) {
    const name = exactName(item[key]);
    map.set(name, (map.get(name) || 0) + 1);
  }
  return map;
}

export function valueProblem(target, value) {
  if (typeof value !== 'string' || !value.trim()) return '来源值为空';
  if (value.length > 10000) return '来源值过长';
  if (target.kind === 'number') {
    if (!/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > Number.MAX_SAFE_INTEGER || String(Number(value)) !== value) return '数字可能发生格式或精度变化';
    const n = Number(value);
    if (target.min !== '' && target.min != null && n < Number(target.min)) return '低于最小值';
    if (target.max !== '' && target.max != null && n > Number(target.max)) return '高于最大值';
    const step = target.step === 'any' ? null : Number(target.step || 1);
    const base = Number(target.min || 0);
    if (step && Math.abs((n - base) / step - Math.round((n - base) / step)) > 1e-8) return '不符合数字步长';
  }
  if (target.maxLength >= 0 && value.length > target.maxLength) return '超过目标长度限制';
  if (['select', 'multi-select', 'combobox', 'multi-combobox', 'radio'].includes(target.kind) && target.options) {
    // Count all matches, including disabled ones: duplicate captions are ambiguous.
    const options = (target.options || []).filter(o => o.text === value);
    if (options.length !== 1) return options.length ? '下拉选项重名' : '没有完全相同的下拉选项';
    if (options[0].disabled || options[0].value === '') return '下拉选项不可用';
    if ((target.options || []).filter(o => o.value === options[0].value).length !== 1) return '下拉选项值重复';
  }
  return '';
}

export function planMatches(rows, targets, { syncStates = false, allowUnchanged = false } = {}) {
  syncStates = syncStates === true;
  const sourceCounts = counts(rows, 'label');
  const targetCounts = counts(targets, 'label');
  return rows.map((row, index) => {
    const label = exactName(row.label);
    const matches = targets.filter(t => exactName(t.label) === label);
    const target = matches[0];
    let reason = '';
    let values = row.values;
    let resolveMultiText = false;
    let unchanged = false;
    if (!label) reason = '字段名称为空';
    else if (sourceCounts.get(label) !== 1) reason = '截图字段重名';
    else if (!matches.length) reason = '没有同名字段';
    else if (targetCounts.get(label) !== 1) reason = '目标字段重名';
    else if (!rowSelected(row)) reason = '未勾选此字段';
    else if (!rowReady(row)) reason = row.review==='conflict'?'来源值冲突，请核对后选择采用值':'来源内容待核对';
    else if (!target.supported) reason = target.reason || '暂不支持此控件';
    else if (target.disabled || target.readonly) reason = '目标只读或禁用';
    else if (!validRows([row])) reason = '来源数据类型无效';
    else if (row.kind === 'group' || target.kind === 'group') {
      if (row.kind !== 'group' || target.kind !== 'group') reason = '来源与目标字段结构不同';
      else {
        const children = planMatches(row.fields, target.fields || [], {syncStates,allowUnchanged:true});
        const failed = children.find(child => !child.ready);
        if (failed) reason = `${failed.label}：${failed.reason}`;
      }
    }
    else if (stateKinds.has(target.kind)) {
      if (!stateKinds.has(row.kind) || typeof row.checked !== 'boolean') reason = '需要明确的布尔状态来源';
      else if (!syncStates) reason = '尚未允许同步勾选状态';
    } else if (row.checked !== undefined) reason = '来源与目标控件类型不兼容';
    else if (multiKinds.has(target.kind)) {
      if (target.value !== '') reason = '目标已有内容';
      else if (!values && [undefined,'text','textarea'].includes(row.kind) && row.value.trim()) {
        if (target.options === undefined) resolveMultiText = true;
        else {
          const resolved = resolveMultiValue(row.value,target.options);
          values = resolved.values; reason = resolved.reason || '';
        }
      } else if (!multiKinds.has(row.kind) || !Array.isArray(values) || !values.length) reason = '多选需要明确的选项数组';
      if (!reason && values) reason = values.map(value => valueProblem(target, value)).find(Boolean) || '';
    } else if (row.values !== undefined) reason = '来源与目标控件类型不兼容';
    else if (target.value !== '' && !(target.kind === 'radio' && syncStates)) {
      if (allowUnchanged && target.sameValue === true && !choiceKinds.has(target.kind)) unchanged = true;
      else reason = '目标已有内容';
    }
    else reason = valueProblem(target, row.value);
    return { index, label, value: row.value, ...(row.kind === 'group' && target?.kind === 'group' ? {fields:planMatches(row.fields,target.fields || [],{syncStates,allowUnchanged:true})} : {}), ...(values !== undefined ? { values: [...values] } : {}), ...(resolveMultiText ? {resolveMultiText:true} : {}), ...(unchanged ? {unchanged:true} : {}), ...(row.checked !== undefined ? { checked: row.checked } : {}), kind: target?.kind, syncStates: syncStates === true, targetId: target?.id, ready: !reason, reason: reason || (unchanged ? '现有文字一致，保留原值' : resolveMultiText ? '展开目标选项后逐项精确核对' : '可填写') };
  });
}

function joinWords(words) {
  let result = '';
  for (let i = 0; i < words.length; i++) {
    const prev = words[i - 1];
    const current = words[i];
    const gap = prev ? current.bbox.x0 - prev.bbox.x1 : 0;
    const height = current.bbox.y1 - current.bbox.y0;
    const chineseBoundary = prev && gap <= height * .5 && /[\u3400-\u9fff]$/.test(prev.text) && /^[\u3400-\u9fff]/.test(current.text);
    if (prev && !chineseBoundary && gap > Math.max(3, height * 0.28)) result += ' ';
    result += current.text;
  }
  return result.trim();
}

function boxedText(words) {
  const first = words[0];
  if (first?.transcript && words.length === first.segmentWordCount && words.every(w => w.segment === first.segment)) return first.transcript.trim();
  return joinWords(words);
}

function extractBoxRows(lines, boxes) {
  const inside = (word, box) => {
    const x = (word.bbox.x0 + word.bbox.x1) / 2;
    const y = (word.bbox.y0 + word.bbox.y1) / 2;
    return x > box.left && x < box.right && y > box.top && y < box.bottom;
  };
  const rows = [];
  const consumed = new Set();
  // A detached trailing fraction is a counter only if it describes the exact
  // preceding value and sits at the input's right edge.
  const counters=new Set();
  for(const box of boxes) {
    const valueLines=lines.map(line=>line.words.filter(word=>inside(word,box)).sort((a,b)=>a.bbox.x0-b.bbox.x0)).filter(words=>words.length);
    const last=valueLines.at(-1);
    if(!last) continue;
    const glyph=Math.max(...last.map(word=>word.bbox.y1-word.bbox.y0));
    let start=last.length-1;
    while(start>0 && last[start].bbox.x0-last[start-1].bbox.x1<=Math.max(24,glyph*2)) start--;
    const trailing=last.slice(start);
    const count=/^(\d+)\s*\/\s*(\d+)$/.exec(trailing.map(word=>word.text).join(''));
    if(!count || box.right-trailing.at(-1).bbox.x1>glyph*2 || start===0) continue;
    const preceding=[...valueLines.slice(0,-1),last.slice(0,start)].map(boxedText).join('\n');
    if(preceding && Number(count[1])===preceding.length && Number(count[2])>=preceding.length) trailing.forEach(word=>counters.add(word));
  }
  lines=lines.map(line=>({...line,words:line.words.filter(word=>!counters.has(word))}));
  for (const box of boxes) {
    if (consumed.has(box)) continue;
    const valueLines = lines.map(line => line.words.filter(w => inside(w,box)).sort((a,b) => a.bbox.x0-b.bbox.x0)).filter(ws => ws.length);
    if (!valueLines.length) continue;
    const height = box.bottom-box.top;
    // Captions must sit outside all controls; values and help text stay separate.
    const external = lines.map(line => line.words.filter(w => !boxes.some(b => inside(w,b))).sort((a,b) => a.bbox.x0-b.bbox.x0)).filter(ws => ws.length);
    const left = external.map(ws => ws.filter(w => w.bbox.x1 < box.left && w.bbox.x1 >= box.left-Math.max(200,(box.right-box.left)*.5) && (w.bbox.y0+w.bbox.y1)/2 > box.top && (w.bbox.y0+w.bbox.y1)/2 < box.bottom)).filter(ws => ws.length);
    const above = external.map(ws => ws.filter(w => w.bbox.x0 >= box.left-height*.35 && w.bbox.x1 <= box.right)).filter(ws => {
      if (!ws.length) return false;
      const bottom = Math.max(...ws.map(w=>w.bbox.y1));
      const glyph = Math.max(...ws.map(w=>w.bbox.y1-w.bbox.y0));
      return bottom <= box.top && box.top-bottom <= Math.max(height*.6,glyph*1.3) && Math.abs(ws[0].bbox.x0-box.left) <= height*.35;
    }).sort((a,b) => Math.max(...b.map(w=>w.bbox.y1))-Math.max(...a.map(w=>w.bbox.y1)));
    let labelWords = left.length === 1 ? left[0] : left.length ? null : above[0];
    if (!labelWords) continue;
    for(let index=1;index<labelWords.length;index++) {
      const glyph=Math.max(labelWords[index].bbox.y1-labelWords[index].bbox.y0,labelWords[index-1].bbox.y1-labelWords[index-1].bbox.y0);
      if(labelWords[index].bbox.x0-labelWords[index-1].bbox.x1>glyph*2 && /^\d+\s*\/\s*\d+$/.test(labelWords.slice(0,index).map(word=>word.text).join(''))) {labelWords=labelWords.slice(index);break;}
    }
    if (labelWords.length > 1 && /^[*＊]$/.test(labelWords[0].text)) labelWords=labelWords.slice(1);
    const label = caption(boxedText(labelWords));
    const value = valueLines.map(boxedText).join('\n');
    if (!label || !value) continue;
    const all = [...labelWords,...valueLines.flat()];
    const confidence = Math.min(...all.map(w=>Number(w.confidence)||0));
    const separated = valueLines.some(line=>line.slice(1).some((word,index)=>word.bbox.x0-line[index].bbox.x1 > Math.max(16,(word.bbox.y1-word.bbox.y0)*.8)));
    const uncertain = confidence < 80 || valueLines.length > 1 || separated;
    const peers = boxes.filter(other => other !== box && !consumed.has(other) && other.left > box.right && other.left-box.right < height*2 && Math.abs(other.top-box.top) < height*.3 && Math.abs(other.bottom-box.bottom) < height*.3);
    if (peers.length === 1) {
      const peer = peers[0];
      const between = external.some(ws => ws.some(w => w.bbox.x0>box.right && w.bbox.x1<peer.left && (w.bbox.y0+w.bbox.y1)/2>peer.top && (w.bbox.y0+w.bbox.y1)/2<peer.bottom));
      const peerWords = lines.flatMap(line => line.words.filter(word=>inside(word,peer))).sort((a,b)=>a.bbox.x0-b.bbox.x0);
      if (!between && peerWords.length && valueLines.length===1) {
        const peerValue=boxedText(peerWords);
        if (!emptyPrompt(value) && !emptyPrompt(peerValue)) {
          const score=Math.min(confidence,...peerWords.map(w=>Number(w.confidence)||0));
          rows.push({label,kind:'group',value:'',fields:[{label:'key',value,confirmed:!uncertain},{label:'value',value:peerValue,confirmed:score>=80}],confidence:Math.round(score),confirmed:false,note:'左右输入框暂按 key / value 排列，请核对子项后确认当前值',bbox:{x0:Math.min(...all.map(w=>w.bbox.x0)),y0:box.top,x1:peer.right,y1:Math.max(box.bottom,peer.bottom)}});
          consumed.add(peer);
          continue;
        }
      }
    }
    rows.push({label,value,confidence:Math.round(confidence),confirmed:!uncertain,...(uncertain && confidence>=80?{confirmation:'multi-layout'}:{}),note:separated?'值含多个分隔文本块，请核对是否为多选项':valueLines.length>1?'多行内容，请核对':confidence<80?'识别可信度较低，请核对':'',bbox:{x0:Math.min(...all.map(w=>w.bbox.x0)),y0:Math.min(...all.map(w=>w.bbox.y0)),x1:Math.max(...all.map(w=>w.bbox.x1)),y1:Math.max(...all.map(w=>w.bbox.y1))}});
  }
  return rows;
}

export function extractRows(words, boxes = []) {
  const valid = words.filter(w => w.text?.trim() && w.bbox && Number.isFinite(w.bbox.x0)).sort((a, b) => a.bbox.y0 - b.bbox.y0 || a.bbox.x0 - b.bbox.x0);
  const lines = [];
  for (const w of valid) {
    const cy = (w.bbox.y0 + w.bbox.y1) / 2;
    const h = Math.max(1, w.bbox.y1 - w.bbox.y0);
    const line = lines.find(l => Math.abs(l.cy - cy) <= Math.min(l.h, h) * 0.55);
    if (line) { line.words.push(w); } else { lines.push({ cy, h, words: [w] }); }
  }
  if (boxes.length) {
    const boxed = extractBoxRows(lines,boxes);
    const occupied = [...boxes.map(b => ({x0:b.left,y0:b.top,x1:b.right,y1:b.bottom})),...boxed.map(r=>r.bbox)];
    const extras = extractRows(words).filter(row => {
      const b = row.bbox;
      if (occupied.some(a=>Math.min(a.x1,b.x1)>Math.max(a.x0,b.x0) && Math.min(a.y1,b.y1)>Math.max(a.y0,b.y0))) return false;
      const line = valid.filter(w=>(w.bbox.y0+w.bbox.y1)/2>=b.y0 && (w.bbox.y0+w.bbox.y1)/2<=b.y1 && w.bbox.x0>=b.x0 && w.bbox.x1<=b.x1).sort((a,c)=>a.bbox.x0-c.bbox.x0);
      const heights = line.map(w=>w.bbox.y1-w.bbox.y0).sort((a,c)=>a-c);
      const gap = Math.max(0,...line.slice(1).map((w,i)=>w.bbox.x0-line[i].bbox.x1));
      // Missing borders may still leave an unambiguous inline pair. Sentence
      // spacing alone is insufficient evidence in a boxed-form screenshot.
      if (heights.length<2) return false;
      const glyphHeight=heights[Math.floor(heights.length/2)];
      const valueStart=line.findIndex((_,index)=>joinWords(line.slice(index))===row.value);
      if(valueStart>0 && gap>=glyphHeight*3 && boxes.some(box=>line[valueStart].bbox.x0>=box.left && line[valueStart].bbox.x1<=box.right && gap<=(box.right-box.left)*.6)) return true;
      return valueStart>0 && boxes.some(box=>Math.abs(line[valueStart].bbox.x0-box.left)<=Math.max(24,glyphHeight*.75));
    });
    return [...boxed,...extras].filter(row=>!emptyPrompt(row.value)).sort((a,b)=>a.bbox.y0-b.bbox.y0 || a.bbox.x0-b.bbox.x0);
  }
  const rows = [];
  for (const line of lines) {
    const ws = line.words.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    if (ws.length > 2 && /^[*＊]$/.test(ws[0].text)) ws.shift();
    if (ws.length < 2) continue;
    const gaps = ws.slice(1).map((w, i) => ({ index: i + 1, size: w.bbox.x0 - ws[i].bbox.x1 }));
    const heights = ws.map(w => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b);
    const glyphHeight = heights[Math.floor(heights.length / 2)];
    const separators = gaps.filter(g => g.size > Math.max(16, glyphHeight * 0.8));
    if (!separators.length) continue;
    const split = separators.reduce((a, b) => b.size > a.size ? b : a);
    let left = ws.slice(0, split.index);
    if (left.length > 1 && /^[*＊]$/.test(left[0].text)) left = left.slice(1);
    const right = ws.slice(split.index);
    const label = caption(joinWords(left));
    const value = joinWords(right);
    if (!label || !value) continue;
    const confidence = Math.min(...[...left, ...right].map(w => Number(w.confidence) || 0));
    const uncertain = separators.length !== 1 || confidence < 80;
    rows.push({ label, value, confidence: Math.round(confidence), confirmed: !uncertain, note: separators.length !== 1 ? '多列间距不明确，请核对' : confidence < 80 ? '识别可信度较低，请核对' : '', bbox: { x0: ws[0].bbox.x0, y0: Math.min(...ws.map(w => w.bbox.y0)), x1: ws.at(-1).bbox.x1, y1: Math.max(...ws.map(w => w.bbox.y1)) } });
  }
  return rows.filter(row=>!emptyPrompt(row.value));
}

export function detectTextBands(pixels, width, height) {
  const active = [];
  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) if (pixels[(y * width + x) * 4] < 185) count++;
    if (count >= Math.max(6, width * 0.002) && count < width * 0.65) active.push(y);
  }
  const bands = [];
  for (const y of active) {
    const last = bands.at(-1);
    if (last && y - last.bottom <= 4) last.bottom = y;
    else bands.push({ top: y, bottom: y });
  }
  return bands.filter(b => b.bottom - b.top >= 5).map(b => ({ top: Math.max(0, b.top - 8), bottom: Math.min(height - 1, b.bottom + 8) }));
}

export function detectColumnSplit(pixels, width, height, band) {
  const occupied = [];
  const top = Math.max(0, band.top), bottom = Math.min(height - 1, band.bottom);
  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = top; y <= bottom; y++) if (pixels[(y * width + x) * 4] < 185) count++;
    if (count >= 2) occupied.push(x);
  }
  if (!occupied.length) return null;
  const gaps = [];
  const threshold = Math.max(16, (bottom - top - 16) * 0.7);
  for (let i = 1; i < occupied.length; i++) {
    if (occupied[i] - occupied[i - 1] > threshold) gaps.push({ before: occupied[i - 1], after: occupied[i], size: occupied[i] - occupied[i - 1] });
  }
  if (gaps.length !== 1) return null;
  const gap = gaps[0];
  return [{ left: Math.max(0, occupied[0] - 5), right: gap.before + 5 }, { left: gap.after - 5, right: Math.min(width - 1, occupied.at(-1) + 5) }];
}

export function detectInputBoxes(pixels, width, height) {
  const ink = (x,y) => pixels[(y*width+x)*4] < 242;
  const strokes = [];
  const minWidth = Math.max(60,width*.12);
  for (let y=0;y<height;y++) {
    let start=-1;
    for (let x=0;x<=width;x++) {
      if (x<width && ink(x,y)) { if(start<0) start=x; }
      else if (start>=0) { if(x-start>=minWidth) strokes.push({left:start,right:x-1,y}); start=-1; }
    }
  }
  const boxes=[];
  const tolerance=Math.max(3,Math.min(12,Math.round(width*.004)));
  // Pair horizontal borders only when both side borders and a light interior exist.
  for (let i=0;i<strokes.length;i++) {
    const top=strokes[i];
    for(let j=i+1;j<strokes.length;j++) {
      const bottom=strokes[j];
      const h=bottom.y-top.y;
      if(h<14) continue;
      if(h>Math.min(400,height*.5)) break;
      if(Math.abs(top.left-bottom.left)>tolerance || Math.abs(top.right-bottom.right)>tolerance || (top.right-top.left)/h<2) continue;
      const left=Math.min(top.left,bottom.left),right=Math.max(top.right,bottom.right);
      const clipped=right>=width-2;
      let clear=0;
      for(let sample=1;sample<=16;sample++) if(!ink(Math.round(left+(right-left)*sample/17),Math.round((top.y+bottom.y)/2))) clear++;
      if(clear<10) continue;
      let sides=0,total=0;
      for(let y=top.y+tolerance;y<=bottom.y-tolerance;y++) {
        let a=false,b=false;
        for(let d=-tolerance;d<=tolerance;d++) {
          if(left+d>=0 && left+d<width && ink(left+d,y)) a=true;
          if(right+d>=0 && right+d<width && ink(right+d,y)) b=true;
        }
        total++; if(a&&(b||clipped)) sides++;
      }
      if(!total || sides/total<.8) continue;
      if(!boxes.some(b=>Math.abs(b.left-left)<=tolerance && Math.abs(b.right-right)<=tolerance && Math.abs(b.top-top.y)<=tolerance && Math.abs(b.bottom-bottom.y)<=tolerance)) boxes.push({left,top:top.y,right,bottom:bottom.y,...(clipped?{clipped:true}:{})});
      break;
    }
  }
  const outlines=boxes.filter(box=>!boxes.some(other=>other!==box && Math.abs(other.left-box.left)<=tolerance && Math.abs(other.right-box.right)<=tolerance && other.top<=box.top && other.bottom>=box.bottom && other.bottom-other.top>box.bottom-box.top));
  return outlines.sort((a,b)=>a.top-b.top || a.left-b.left);
}
