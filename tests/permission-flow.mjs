import { chromium } from 'playwright';
import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';
import http from 'node:http';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.permission-extension');
await cp(path.join(root, 'dist'), extension, { recursive: true });
const server = http.createServer((_, response) => {
  response.setHeader('Content-Type', 'text/html;charset=utf-8');
  response.end('<form><label for="name">名称</label><input id="name"></form>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let context;
try {
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TEST_CHROMIUM,
    headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const id = new URL(worker.url()).host;
  const target = await context.newPage();
  await target.goto(`http://127.0.0.1:${server.address().port}/`);
  await worker.evaluate(() => chrome.storage.local.set({ savedCapture: {
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=',
    sourceHash: '', rows: [{ label: '名称', value: '示例', confirmed: true }], info: '测试截图',
  } }));
  const dockEvent=context.waitForEvent('page');
  await worker.evaluate(url=>chrome.windows.create({url,type:'popup',width:390,height:650}),`chrome-extension://${id}/panel.html?mode=dock`);
  const dock=await dockEvent;await dock.waitForLoadState();
  await dock.waitForFunction(() => document.querySelectorAll('.data-row').length === 1);
  await dock.waitForFunction(() => document.getElementById('receiver-status').textContent.includes('未连接'));
  assert.equal(await dock.locator('#dropzone').getAttribute('draggable'), 'false', 'Do not advertise drag when no target is connected');
  assert.equal(await dock.locator('#connect-current').isVisible(),true,'Current-site connection is available without opening settings');
  await dock.locator('#settings-toggle').click();
  assert.equal(await dock.locator('#enable-websites').isVisible(), true, 'One-time site access must be discoverable');
  await mkdir(path.join(root, 'test-artifacts'), {recursive:true});
  await dock.setViewportSize({width:360,height:540});
  await dock.screenshot({path:path.join(root,'test-artifacts/permission-dock.png'),fullPage:true});
  assert.equal((await worker.evaluate(() => chrome.permissions.getAll())).origins.length, 0);
  assert.equal(await target.locator('#name').inputValue(), '');
  await dock.evaluate(() => {
    chrome.permissions.request = async request => { window.requestedOrigins = request.origins; return false; };
  });
  await dock.locator('#enable-websites').click();
  await dock.waitForFunction(() => document.getElementById('status').textContent.includes('未获得网站访问权限'));
  assert.deepEqual(await dock.evaluate(() => window.requestedOrigins), ['http://*/*', 'https://*/*']);
  assert.equal(await dock.locator('#dropzone').getAttribute('draggable'), 'false');
  await dock.locator('#workspace-details').evaluate(details => details.open = true);
  await dock.locator('.row-kind').selectOption('state');
  assert.equal(await dock.locator('.field-value').evaluate(node => node.tagName), 'SELECT');
  assert.equal(await dock.locator('.data-row input[type=checkbox]').isChecked(), true, 'Type conversion retains participation but requires separate review');
  assert.match(await dock.locator('.row-review').innerText(),/待核对/);
  await dock.locator('.field-value').selectOption('true');
  await dock.locator('.data-row input[type=checkbox]').check();
  await dock.getByRole('button',{name:'确认当前值',exact:true}).click();
  await dock.waitForFunction(async () => {const row=(await chrome.storage.local.get('savedCapture')).savedCapture?.rows[0];return row?.checked===true && row.confirmed;});
  const stateRow = await dock.evaluate(async () => (await chrome.storage.local.get('savedCapture')).savedCapture.rows[0]);
  assert.equal(stateRow.kind, 'switch');
  assert.equal(stateRow.confirmed, true);
  await dock.locator('.row-kind').selectOption('multi');
  await dock.locator('.field-value').fill('值班主\n值班备');
  await dock.locator('.data-row input[type=checkbox]').check();
  await dock.getByRole('button',{name:'确认当前值',exact:true}).click();
  await dock.waitForFunction(async () => {const row=(await chrome.storage.local.get('savedCapture')).savedCapture?.rows[0];return row?.values?.length===2 && row.confirmed;});
  const multiRow = await dock.evaluate(async () => (await chrome.storage.local.get('savedCapture')).savedCapture.rows[0]);
  assert.deepEqual(multiRow.values, ['值班主', '值班备']);
  assert.equal(multiRow.kind, 'multi-select');
  assert.equal(multiRow.confirmed, true);
  const targetTab=await worker.evaluate(async url=>(await chrome.tabs.query({url}))[0],target.url());
  const setup=await context.newPage();await setup.goto(`chrome-extension://${id}/setup.html?tab=${targetTab.id}`);
  await setup.waitForFunction(()=>document.getElementById('site').textContent==='127.0.0.1');
  assert.equal(await setup.locator('#capture-layout').inputValue(),'sidepanel');
  await setup.locator('#capture-layout').selectOption('window');
  assert.equal(await setup.evaluate(async()=>(await chrome.storage.local.get('captureLayout')).captureLayout),'window');
  await setup.locator('#capture-layout').selectOption('sidepanel');
  await setup.evaluate(()=>{chrome.permissions.request=async options=>{window.setupOrigins=options.origins;return false;};});
  await setup.locator('#grant-site').click();
  await setup.waitForFunction(()=>document.getElementById('setup-status').textContent.includes('未授权'));
  assert.deepEqual(await setup.evaluate(()=>window.setupOrigins),['http://127.0.0.1/*']);
  assert.equal((await worker.evaluate(()=>chrome.permissions.getAll())).origins.length,0);
  await setup.screenshot({path:path.join(root,'test-artifacts/shelf-setup.png')});
  console.log('PASS: production permissions start disconnected, prevent silent drag, request one-time browser origins on click, and remain blocked if refused');
} finally {
  await context?.close();
  await new Promise(resolve => server.close(resolve));
}
