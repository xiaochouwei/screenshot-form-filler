import { chromium } from 'playwright';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.scan-target-extension');
await cp(path.join(root, 'dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify({ ...manifest, host_permissions: ['<all_urls>'] }));
const server = http.createServer((req, res) => {
  res.setHeader('Content-Type', 'text/html;charset=utf-8');
  const phone = req.url === '/phone';
  res.end(`<title>${phone ? '电话规则' : 'Alertmanager'}</title><form><label for="name">名称</label><input id="name"><label for="priority">优先级</label><input id="priority"></form>`);
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TEST_CHROMIUM, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const base = `http://127.0.0.1:${server.address().port}`;
  const alert = await context.newPage();
  await alert.goto(`${base}/alert`);
  const phoneEvent = context.waitForEvent('page');
  await worker.evaluate(url => chrome.windows.create({ url, focused: true }), `${base}/phone`);
  const phone = await phoneEvent;
  await phone.waitForLoadState();
  const phoneTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), phone.url());
  const alertTab = await worker.evaluate(async url => (await chrome.tabs.query({})).find(t => t.url === url), alert.url());
  await worker.evaluate(id => chrome.windows.update(id, { focused: true }), phoneTab.windowId);
  const dockEvent = context.waitForEvent('page');
  await worker.evaluate(url => chrome.windows.create({ url, type: 'popup', width: 390, height: 570, focused: true }), `chrome-extension://${new URL(worker.url()).host}/panel.html?mode=dock`);
  const dock = await dockEvent;
  await dock.waitForURL(/panel.html\?mode=dock/);
  await dock.waitForFunction(() => document.getElementById('receiver').options.length > 2);
  const lastNormal = await dock.evaluate(() => chrome.windows.getLastFocused({ windowTypes: ['normal'] }));
  assert.equal(lastNormal.id, phoneTab.windowId, 'Browser must remember the last focused normal window after the dock takes focus');
  await dock.locator('#settings-toggle').click();
  await dock.locator('#receiver').selectOption(String(alertTab.id));
  await dock.locator('#workspace-details').evaluate(node => node.open = true);
  await dock.locator('#scan').click();
  await dock.waitForFunction(() => document.getElementById('status').textContent === '页面扫描完成' || document.getElementById('status').classList.contains('error'));
  assert.equal(await dock.locator('#page-title').innerText(), '电话规则', await dock.locator('#status').innerText());
  assert.equal(await dock.locator('#receiver').inputValue(), String(alertTab.id), 'Changing the scan target must not silently change the receiver selection');
  await dock.locator('#add').click();
  const row = dock.locator('.data-row').last();
  await row.locator('.field-label').fill('名称');
  await row.locator('.field-value').fill('电话规则值');
  await row.locator('[type=checkbox]').check();
  await row.getByRole('button',{name:'确认当前值',exact:true}).click();
  await dock.locator('#receiver').selectOption(String(phoneTab.id));
  await dock.locator('#receiver').selectOption(String(alertTab.id));
  await worker.evaluate(({ windowId, url }) => chrome.tabs.create({ windowId, url, active: true }), { windowId: alertTab.windowId, url: `${base}/alert` });
  assert.equal(await dock.locator('#page-title').innerText(), '电话规则', 'Activating a tab in another window must keep the scanned target');
  await dock.locator('#fill').click();
  await dock.waitForFunction(() => document.getElementById('summary').textContent === '1 项已写入' || document.getElementById('status').classList.contains('error'));
  assert.equal(await phone.locator('#name').inputValue(), '电话规则值', await dock.locator('#status').innerText());
  assert.equal(await alert.locator('#name').inputValue(), '');
  console.log('PASS: dock scans and fills the last focused normal page, independent of receiver dropdown');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
