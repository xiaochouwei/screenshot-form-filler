import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const browser = await chromium.launch({ headless: true, executablePath: process.env.TEST_CHROMIUM });
try {
  const page = await browser.newPage();
  await page.route('http://form-filler.test/**', route => route.fulfill({ body: '<!doctype html><title>Fixture</title>', contentType: 'text/html' }));
  await page.goto('http://form-filler.test/');
  await page.setContent(`<form id="main">
    <label for="name">名称</label><input id="name">
    <label for="url">地址</label><input id="url" type="url">
    <label for="existing">已有值</label><input id="existing" value="keep">
    <label for="ro">只读</label><input id="ro" readonly>
    <label for="agent">采集器</label><select id="agent"><option value="">请选择</option><option value="a">agent-a</option></select>
    <label for="optionlabel">选项标签</label><select id="optionlabel"><option value="">请选择</option><option value="v" label="Visible option">Internal text</option></select>
    <div class="el-form-item"><label class="el-form-item__label"><span class="required">*</span>采集间隔</label><input id="interval" type="number"></div>
    <label for="dup1">重名</label><input id="dup1"><label for="dup2">重名</label><input id="dup2">
    <label for="hidden">隐藏</label><input id="hidden" style="display:none">
    <div style="opacity:0"><label for="transparent">透明</label><input id="transparent"></div>
    <label for="zero">零尺寸</label><input id="zero" style="width:0;height:0;padding:0;border:0">
    <label for="clipped">裁剪隐藏</label><input id="clipped" style="clip-path:inset(100%)">
    <label for="cc">Card number</label><input id="cc" autocomplete="section-pay cc-number">
    <label for="csc">CSC</label><input id="csc" autocomplete="cc-csc">
    <label for="password">密码</label><input id="password" type="password">
    <label for="combo">自定义</label><input id="combo" role="combobox">
    <label for="reject">拒绝</label><input id="reject">
    <label for="stale">变化</label><input id="stale">
  </form><form id="other"><label for="othername">名称</label><input id="othername"></form>`);
  await page.evaluate(() => {
    globalThis.chrome = { runtime: { id: 'test-id', onMessage: { addListener: fn => { globalThis.handler = fn; } } } };
    document.querySelector('#reject').addEventListener('input', e => { e.target.value = ''; });
    globalThis.send = message => new Promise(resolve => handler(message, { id: 'test-id' }, resolve));
  });
  await page.addScriptTag({ content: await readFile(new URL('../dist/content.js', import.meta.url), 'utf8') });
  const scan = await page.evaluate(() => send({ type: 'SCAN' }));
  assert.equal(scan.ok, true);
  assert.equal(scan.scopes.length, 2);
  assert.equal(scan.fields.find(f => f.label === '选项标签').options[1].text, 'Visible option');
  await page.locator('#optionlabel').selectOption('v');
  const captured = await page.evaluate(() => send({type:'SOURCE'}));
  assert.equal(captured.rows.find(r => r.label === '选项标签').value,'Visible option');
  await page.locator('#optionlabel').selectOption('');
  const scopeId = scan.scopes[0].id;
  const row = (label, value) => ({ label, value, confirmed: true });
  const sources = [row('名称', '<b>融侨</b>'), row('地址', 'http://192.168.1.1:9090'), row('已有值', 'overwrite'), row('只读', 'bad'), row('采集器', 'agent-a'), row('采集间隔', '45'), row('重名', 'bad'), row('隐藏', 'bad'), row('透明', 'bad'), row('零尺寸', 'bad'), row('裁剪隐藏', 'bad'), row('Card number', '4111111111111111'), row('CSC', '123'), row('密码', 'bad'), row('自定义', 'bad'), row('拒绝', 'x'), row('变化', 'old')];
  const preview = await page.evaluate(({ token, scopeId, rows }) => send({ type: 'PREVIEW', token, scopeId, rows }), { token: scan.token, scopeId, rows: sources });
  assert.equal(preview.ok, true);
  assert.equal(preview.plan.filter(x => x.ready).length, 6);
  await page.evaluate(() => { const e = document.querySelector('#stale'); e.replaceWith(e.cloneNode()); });
  const result = await page.evaluate(({ token, previewId }) => send({ type: 'FILL', token, previewId }), { token: scan.token, previewId: preview.previewId });
  assert.equal(result.ok, true);
  const actual = await page.evaluate(() => Object.fromEntries([...document.querySelectorAll('input,select')].map(e => [e.id, e.value])));
  assert.equal(actual.name, '<b>融侨</b>');
  assert.equal(actual.othername, '');
  assert.equal(actual.existing, 'keep');
  assert.equal(actual.ro, '');
  assert.equal(actual.agent, 'a');
  assert.equal(actual.interval, '45');
  for (const id of ['dup1', 'dup2', 'hidden', 'transparent', 'zero', 'clipped', 'cc', 'csc', 'password', 'combo', 'stale']) assert.equal(actual[id], '', id);
  assert.equal(result.results.find(x => x.label === '拒绝').status, 'failed');
  assert.equal(result.results.find(x => x.label === '变化').status, 'skipped');
  const replay = await page.evaluate(({ token, previewId }) => send({ type: 'FILL', token, previewId }), { token: scan.token, previewId: preview.previewId });
  assert.equal(replay.ok, false);
  await page.evaluate(() => {
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < 2000; i++) fragment.append(document.createElement('input'));
    document.querySelector('#main').append(fragment);
  });
  const oversized = await page.evaluate(() => send({ type: 'SCAN' }));
  assert.equal(oversized.ok, false);
  assert.match(oversized.error, /2000/);
  console.log('PASS: real DOM scan, scoped exact matching, events, stale nodes, safe skips, one-use preview');
} finally { await browser.close(); }
