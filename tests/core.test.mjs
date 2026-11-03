import test from 'node:test';
import assert from 'node:assert/strict';
import { planMatches, extractRows, detectTextBands, detectColumnSplit, detectInputBoxes } from '../src/core.js';

const field = (label, extra = {}) => ({ id: label, label, kind: 'text', value: '', supported: true, ...extra });
const row = (label, value, extra = {}) => ({ label, value, confirmed: true, ...extra });

test('only exact names match, preserving punctuation, units and case', () => {
  const sources = [row(' 地址 ', 'a'), row('URL', 'b'), row('间隔', '45')];
  const result = planMatches(sources, [field('地址'), field('url'), field('间隔（秒）')]);
  assert.equal(result.filter(x => x.ready).length, 1);
  assert.equal(result[0].targetId, '地址');
});

test('duplicates in either source or target cannot fill', () => {
  assert.equal(planMatches([row('名称', 'a'), row('名称', 'b')], [field('名称')]).some(x => x.ready), false);
  assert.equal(planMatches([row('名称', 'a')], [field('名称'), field('名称', { id: '2' })]).some(x => x.ready), false);
});

test('nonempty, readonly, unsupported and unconfirmed rows are skipped', () => {
  for (const extra of [{ value: 'existing' }, { disabled: true }, { readonly: true }, { supported: false }]) {
    assert.equal(planMatches([row('名称', 'x')], [field('名称', extra)])[0].ready, false);
  }
  assert.equal(planMatches([row('名称', 'x', { confirmed: false })], [field('名称')])[0].ready, false);
});

test('select requires exactly one enabled option with identical text', () => {
  const src = [row('采集器', 'agent-a')];
  const target = field('采集器', { kind: 'select', options: [{ text: 'agent-a', value: '1', disabled: false }] });
  assert.equal(planMatches(src, [target])[0].ready, true);
  assert.equal(planMatches([row('采集器', 'Agent-a')], [target])[0].ready, false);
  assert.equal(planMatches(src, [{ ...target, options: [...target.options, { text: 'agent-a', value: '2' }] }])[0].ready, false);
  assert.equal(planMatches(src, [{ ...target, options: [{ text: 'agent-a', value: '1', disabled: true }] }])[0].ready, false);
});

test('number inputs reject lossy representations and constraints', () => {
  for (const value of ['001', '1e3', '1,000', '9007199254740993', '45秒']) {
    assert.equal(planMatches([row('间隔', value)], [field('间隔', { kind: 'number' })])[0].ready, false, value);
  }
  assert.equal(planMatches([row('间隔', '45')], [field('间隔', { kind: 'number', min: '1', max: '60', step: '1' })])[0].ready, true);
  assert.equal(planMatches([row('间隔', '61')], [field('间隔', { kind: 'number', max: '60' })])[0].ready, false);
});

test('values preserve whitespace and markup as plain data', () => {
  const value = ' <img src=x onerror=alert(1)> ';
  assert.equal(planMatches([row('备注', value)], [field('备注')])[0].value, value);
});

const word = (text, x0, y0, x1, y1, confidence = 96) => ({ text, bbox: { x0, y0, x1, y1 }, confidence });
test('boxed OCR excludes a detached verified character counter and preserves literal fractions', () => {
  const box={left:100,top:10,right:600,bottom:45};
  const label=word('服务',20,20,60,35);
  const value=word('parking-pay',110,20,220,35);
  const counter=word('11/256',550,20,590,35);
  assert.deepEqual(extractRows([label,value,counter],[box]).map(r=>[r.label,r.value,r.confirmed]),[['服务','parking-pay',true]]);
  const split=[word('11',545,20,560,35),word('/',562,20,568,35),word('256',570,20,593,35)];
  assert.equal(extractRows([label,value,...split],[box])[0].value,'parking-pay');
  const literal=word('11/256',110,20,160,35);
  assert.equal(extractRows([label,literal],[box])[0].value,'11/256');
  assert.equal(extractRows([label,value,word('11/256',225,20,270,35)],[box])[0].value,'parking-pay 11/256');
  assert.equal(extractRows([label,value,word('18/256',550,20,590,35)],[box])[0].confirmed,false,'Unverified counters must stay unconfirmed');
});

test('adjacent form label excludes a distant previous counter without deleting label spaces',()=>{
  const words=[word('18/256',700,20,740,35),word('描述',800,20,840,35),word('parking-pay 11/256',870,20,1000,35),word('18/256',1330,20,1370,35)];
  const rows=extractRows(words,[{left:860,top:10,right:1380,bottom:45}]);
  assert.deepEqual(rows.map(r=>[r.label,r.value]),[['描述','parking-pay 11/256']]);
  const spaced=[word('Prometheus',650,20,735,35),word('URL',745,20,775,35),word('example',870,20,930,35)];
  assert.equal(extractRows(spaced,[{left:860,top:10,right:1380,bottom:45}])[0].label,'Prometheus URL');
});
test('pairs labels above input boxes and excludes headings and helper copy', () => {
  const words = [word('基本信息',20,0,90,15), word('项目名称',20,40,90,55), word('包头',30,72,60,87), word('Prometheus',20,120,95,133),word('URL',102,120,125,133),word('http://10.0.0.21:30090',30,152,240,167),word('仅支持HTTP，',20,190,110,203),word('不能包含密码',145,190,235,203),word('日志清理',20,235,75,248),word('URL',81,235,105,248),word('http://10.0.0.18:31180/',30,270,240,285)];
  const boxes=[{left:20,top:65,right:500,bottom:100},{left:20,top:145,right:500,bottom:180},{left:20,top:260,right:500,bottom:295}];
  assert.deepEqual(extractRows(words,boxes).map(r=>[r.label,r.value]),[['项目名称','包头'],['Prometheus URL','http://10.0.0.21:30090'],['日志清理 URL','http://10.0.0.18:31180/']]);
  const noLabel=extractRows(words.filter(w=>!['日志清理','URL'].includes(w.text) || w.bbox.y0!==235),boxes);
  assert.equal(noLabel.length,2,'Distant helper copy must not become an input label');
});

test('detects complete input outlines without treating a divider as a box', () => {
  const width=600,height=260,pixels=new Uint8ClampedArray(width*height*4).fill(255);
  const ink=(x,y)=>{const i=(y*width+x)*4; pixels[i]=pixels[i+1]=pixels[i+2]=165;};
  for (const [top,bottom] of [[60,100],[170,210]]) {
    for (let x=20;x<=570;x++) {ink(x,top);ink(x,bottom);}
    for (let y=top;y<=bottom;y++) {ink(20,y);ink(570,y);}
  }
  for (let x=0;x<width;x++) ink(x,10);
  const boxes=detectInputBoxes(pixels,width,height);
  assert.equal(boxes.length,2);
  assert.deepEqual(boxes.map(b=>[b.top,b.bottom]),[[60,100],[170,210]]);
  assert.equal(detectInputBoxes(new Uint8ClampedArray(width*height*4).fill(120),width,height).length,0,'A filled background is not an input outline');
});

test('a detected box does not discard other clear inline fields in a mixed layout', () => {
  const words=[word('名称',20,20,50,35),word('融侨',120,20,150,35),word('间隔',20,80,50,95),word('45',120,80,140,95)];
  assert.deepEqual(extractRows(words,[{left:100,top:10,right:300,bottom:45}]).map(r=>[r.label,r.value]),[['名称','融侨'],['间隔','45']]);
  const mixed=[word('项目名称',20,10,80,25),word('包头',30,45,60,60),word('间隔',20,110,50,125),word('45',120,110,140,125)];
  assert.deepEqual(extractRows(mixed,[{left:20,top:35,right:300,bottom:75}]).map(r=>[r.label,r.value]),[['项目名称','包头'],['间隔','45']]);
});

test('boxed screenshots do not promote distant unboxed help into values',()=>{
  const words=[word('路径',20,20,50,35),word('/api/*',110,20,160,35),word('参数',20,80,50,95),word('按所选条件决定行为',800,80,960,95),word('间隔',20,140,50,155),word('45',110,140,130,155)];
  assert.deepEqual(extractRows(words,[{left:100,top:10,right:600,bottom:45}]).map(row=>[row.label,row.value]),[['路径','/api/*'],['间隔','45']]);
});

test('a boxed row does not discard nearby unboxed values aligned with its input column', () => {
  const words=[
    word('*',240,75,250,100),word('名称',270,61,350,109),word('样例',405,70,490,105),
    word('Prometheus',150,408,370,455),word('生产实例',408,408,590,455),
    word('优先级',183,785,340,822),word('20',403,785,442,822),
    word('匹配规则',197,947,370,990),word('severity',403,947,520,990),
  ];
  const boxes=[{left:386,top:930,right:2448,bottom:1023}];
  assert.deepEqual(extractRows(words,boxes).map(row=>[row.label,row.value]),[
    ['名称','样例'],['Prometheus','生产实例'],['优先级','20'],['匹配规则','severity'],
  ]);
});

test('extracts clear two-column rows and preserves URL tokens', () => {
  const words = [word('*', 10, 10, 14, 22), word('名称', 20, 10, 50, 22), word('融侨', 100, 10, 130, 22), word('地址', 20, 50, 50, 62), word('http://192.168.1.1:9090', 100, 50, 300, 62)];
  const rows = extractRows(words);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, '名称');
  assert.equal(rows[1].value, 'http://192.168.1.1:9090');
});

test('real screenshot label/value gap may be less than the glyph height', () => {
  const words = [word('采集', 75, 574, 154, 624), word('间隔', 153, 578, 213, 613), word('45', 274, 587, 313, 616)];
  assert.equal(extractRows(words)[0]?.label, '采集间隔');
  assert.equal(extractRows(words)[0]?.value, '45');
});

test('OCR extraction retains uncertainty metadata for low-confidence and multi-column text', () => {
  const words = [word('名称', 0, 0, 30, 15), word('低可信', 90, 0, 140, 15, 30)];
  assert.equal(extractRows(words)[0].confirmed, false);
  assert.equal(extractRows([word('名称', 0, 0, 30, 15), word('a', 100, 0, 110, 15), word('其他', 200, 0, 230, 15), word('b', 300, 0, 310, 15)])[0].confirmed, false);
  assert.equal(extractRows([word('孤立文字', 0, 0, 60, 15)]).length, 0);
});

test('OCR skips common empty-field prompts but keeps entered values', () => {
  const words = [
    word('参数', 0, 0, 30, 15), word('请输入参数名', 90, 0, 170, 15),
    word('服务', 0, 40, 30, 55), word('h5', 90, 40, 115, 55),
  ];
  assert.deepEqual(extractRows(words).map(row => [row.label, row.value]), [['服务', 'h5']]);
});

test('text band detection ignores horizontal borders and retains a single digit row', () => {
  const width = 200, height = 100;
  const pixels = new Uint8ClampedArray(width * height * 4).fill(255);
  const ink = (x, y) => { const i = (y * width + x) * 4; pixels[i] = pixels[i + 1] = pixels[i + 2] = 40; };
  for (let x = 0; x < width; x++) ink(x, 5);
  for (const top of [20, 65]) for (let y = top; y < top + 10; y++) for (let x = 30; x < 40; x++) ink(x, y);
  const bands = detectTextBands(pixels, width, height);
  assert.equal(bands.length, 2);
  assert.ok(bands[0].top <= 20 && bands[0].bottom >= 29);
  assert.ok(bands[1].top <= 65 && bands[1].bottom >= 74);
});

test('separates a clear label/value gap before OCR without inventing a split', () => {
  const width = 200, height = 30;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let y = 5; y < 25; y++) for (const [a, b] of [[10, 40], [75, 130]]) for (let x = a; x < b; x++) data[(y * width + x) * 4] = 100;
  const split = detectColumnSplit(data, width, height, { top: 0, bottom: 29 });
  assert.equal(split.length, 2);
  assert.ok(split[0].left <= 10 && split[0].right >= 39);
  assert.ok(split[1].left <= 75 && split[1].right >= 129);
  assert.equal(detectColumnSplit(new Uint8ClampedArray(width * height * 4).fill(255), width, height, { top: 0, bottom: 29 }), null);
});
