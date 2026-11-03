import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import { build } from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(root, 'test-artifacts');
await mkdir(artifacts, { recursive: true });
const testExtension = path.join(root, '.test-extension');
await cp(path.join(root, 'dist'), testExtension, { recursive: true });
// The test harness grants localhost access because a headless test cannot click
// the browser toolbar to grant activeTab. Production manifest stays unchanged.
const manifest = JSON.parse(await readFile(path.join(testExtension, 'manifest.json'), 'utf8'));
manifest.host_permissions = ['http://127.0.0.1/*'];
await writeFile(path.join(testExtension, 'manifest.json'), JSON.stringify(manifest));
if (process.env.DEBUG_OCR) await build({ stdin: { contents: `import { localProvider, prepareImage } from './src/ocr.js'; globalThis.inspectOcr = async (base64) => {const blob = new Blob([Uint8Array.from(atob(base64), c=>c.charCodeAt(0))], {type:'image/png'}); const prepared = await prepareImage(blob); return localProvider.recognize(prepared.canvas); };`, resolveDir: root }, bundle: true, platform: 'browser', outfile: path.join(testExtension, 'inspect.js') });
const server = http.createServer(async (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(await readFile(path.join(root, 'src/demo.html')));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const port = server.address().port;
let context;
try {
  // Reusing a disk profile can run a cached unpacked service worker even after
  // its files change. Fresh profiles validate the delivered background bundle.
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TEST_CHROMIUM, headless: true, viewport: { width: 1200, height: 900 },
    args: [`--disable-extensions-except=${testExtension}`, `--load-extension=${testExtension}`],
  });
  let [worker] = context.serviceWorkers();
  if (!worker) worker = await context.waitForEvent('serviceworker', { timeout: 30000 });
  const extensionId = new URL(worker.url()).host;
  assert.equal(await worker.evaluate(()=>chrome.commands.onCommand.hasListeners()),true);
  const target = await context.newPage();
  await target.goto(`http://127.0.0.1:${port}/`);
  const fixtureScreenshot = path.join(artifacts, 'source.png');
  await target.locator('#source').screenshot({ path: fixtureScreenshot });
  const panel = await context.newPage();
  await panel.setViewportSize({ width: 380, height: 960 });
  const errors = [];
  const remote = [];
  panel.on('pageerror', e => errors.push(e.message));
  context.on('request', r => { if (/^https?:/.test(r.url()) && !r.url().startsWith('http://127.0.0.1:')) remote.push(r.url()); });
  await panel.goto(`chrome-extension://${extensionId}/panel.html`);
  if (process.env.DEBUG_OCR) {
    await panel.addScriptTag({ url: `chrome-extension://${extensionId}/inspect.js` });
    const debug = await panel.evaluate(base64 => inspectOcr(base64), (await readFile(process.env.SOURCE_SCREENSHOT || fixtureScreenshot)).toString('base64'));
    await writeFile(path.join(artifacts, 'ocr-debug.json'), JSON.stringify(debug, null, 2));
  }
  await context.setOffline(true);
  await panel.screenshot({ path: path.join(artifacts, 'panel-empty.png'), fullPage: true });
  await panel.locator('#file').setInputFiles(process.env.SOURCE_SCREENSHOT || fixtureScreenshot);
  await panel.waitForFunction(() => !document.getElementById('recognize').disabled);
  const imageTabPromise = context.waitForEvent('page');
  await panel.locator('#view').click();
  const imageTab = await imageTabPromise;
  await imageTab.waitForLoadState();
  assert.ok(await imageTab.locator('img').evaluate(node => node.naturalWidth > 0));
  await imageTab.close();
  // Import starts OCR automatically; no separate recognition click.
  await panel.waitForFunction(() => document.getElementById('cancel').hidden, { timeout: 120000 });
  const status = await panel.locator('#status').innerText();
  await writeFile(path.join(artifacts, 'ocr-raw.txt'), await panel.locator('#raw').inputValue());
  await panel.screenshot({ path: path.join(artifacts, 'panel-ocr.png'), fullPage: true });
  assert.ok((await panel.locator('.data-row').count()) >= 3, `OCR produced fewer than 3 fields: ${status}; errors=${errors.join(',')}`);
  const recognized = await panel.locator('.data-row').evaluateAll(nodes => nodes.map(n => ({ label: n.querySelector('.field-label').value, value: n.querySelector('.field-value').value, confirmed: n.querySelector('[type=checkbox]').checked })));
  await writeFile(path.join(artifacts, 'ocr-result.json'), JSON.stringify(recognized, null, 2));
  console.log('OCR rows:', recognized);
  await target.bringToFront();
  await panel.evaluate(() => document.getElementById('scan').click());
  await panel.waitForFunction(() => document.getElementById('scope').options.length > 1);
  const scopes = await panel.locator('#scope option').evaluateAll(nodes => nodes.map(n => ({ value: n.value, text: n.textContent })));
  const targetScope = scopes.find(s => /表单 2/.test(s.text));
  assert.ok(targetScope, JSON.stringify(scopes));
  await panel.selectOption('#scope', targetScope.value);
  // Confirm only rows whose transcription has been checked against the fixture.
  const expected = new Map([['名称', '融侨'], ['地址', 'http://192.168.33.199:9090'], ['采集器', 'rongqiao-192.168.33.199'], ['采集间隔', '45'], ['采集超时时间', '5']]);
  let confirmed = 0;
  for (let i = 0; i < recognized.length; i++) {
    if (expected.get(recognized[i].label) === recognized[i].value) {
      const entry=panel.locator('.data-row').nth(i);
      if(await entry.locator('.review-image').isVisible())await entry.locator('.review-image').click();
      await entry.locator('[type=checkbox]').check();confirmed++;
    }
  }
  assert.ok(confirmed >= 2, 'At least two accurately recognized fields are required');
  await target.bringToFront();
  await panel.evaluate(() => document.getElementById('match').click());
  await panel.waitForFunction(() => /[1-9]\d* 项可填写/.test(document.getElementById('summary').textContent) && !document.getElementById('match').disabled);
  await panel.screenshot({ path: path.join(artifacts, 'panel-preview.png'), fullPage: true });
  await panel.evaluate(() => document.getElementById('fill').click());
  await panel.waitForFunction(() => document.getElementById('status').textContent.includes('自行提交') || document.getElementById('status').classList.contains('error'));
  assert.ok((await panel.locator('#status').innerText()).includes('自行提交'),await panel.locator('#status').innerText());
  const values = await target.locator('#target input,#target select').evaluateAll(nodes => nodes.map(n => n.value));
  assert.ok(values.filter(Boolean).length >= 2, JSON.stringify(values));
  assert.equal(await target.locator('#existing').inputValue(), '已有内容不会覆盖');
  assert.equal(await target.locator('#different').inputValue(), '');
  await panel.screenshot({ path: path.join(artifacts, 'panel-filled.png'), fullPage: true });
  await target.screenshot({ path: path.join(artifacts, 'target-filled.png'), fullPage: true });
  const unmodifiedCount = values.filter(Boolean).length;
  // Exercise explicit human correction separately from the raw OCR assertions.
  await target.locator('#reset').click();
  const entries = [...expected.entries()];
  for (let i = 0; i < entries.length; i++) {
    if (await panel.locator('.data-row').count() <= i) await panel.locator('#add').click();
    const entry = panel.locator('.data-row').nth(i);
    await entry.locator('.field-label').fill(entries[i][0]);
    await entry.locator('.field-value').fill(entries[i][1]);
    await entry.locator('[type=checkbox]').check();
    await entry.getByRole('button',{name:'确认当前值',exact:true}).click();
  }
  await target.bringToFront();
  await panel.evaluate(() => document.getElementById('scan').click());
  await panel.waitForFunction(() => !document.getElementById('scope').disabled);
  const refreshed = await panel.locator('#scope option').evaluateAll(nodes => nodes.map(n => ({ value: n.value, text: n.textContent })));
  await panel.selectOption('#scope', refreshed.find(s => /表单 2/.test(s.text)).value);
  await panel.evaluate(() => document.getElementById('match').click());
  await panel.waitForFunction(() => document.getElementById('summary').textContent === '5 项可填写');
  await panel.screenshot({ path: path.join(artifacts, 'panel-reviewed.png') });
  await panel.evaluate(() => document.getElementById('fill').click());
  await panel.waitForFunction(() => document.getElementById('summary').textContent === '5 项已写入');
  assert.deepEqual(await target.locator('#target input,#target select').evaluateAll(nodes => nodes.map(n => n.value)), ['融侨', 'http://192.168.33.199:9090', 'rongqiao', '45', '5']);
  // Oversize/unsupported files must not erase the current session.
  await panel.locator('#file').setInputFiles({ name: 'invalid.txt', mimeType: 'text/plain', buffer: Buffer.from('not an image') });
  await panel.waitForFunction(() => document.getElementById('status').classList.contains('error'));
  assert.equal(await panel.locator('.data-row').count(), 5);
  await panel.setViewportSize({ width: 300, height: 780 });
  assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await panel.screenshot({ path: path.join(artifacts, 'panel-narrow.png'), fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, []);
  console.log(`PASS: offline extension OCR → preview → fill, ${unmodifiedCount} unchanged OCR fields; all 5 after explicit correction; invalid file rejected; no remote requests; no page errors; narrow layout fits`);
} finally { if (context) await context.close(); await new Promise(resolve => server.close(resolve)); }
