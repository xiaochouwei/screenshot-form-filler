import { chromium } from 'playwright';
import { cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const extension = path.join(root, '.mixed-source-extension');
await cp(path.join(root, 'dist'), extension, { recursive: true });
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
await writeFile(path.join(extension, 'manifest.json'), JSON.stringify(manifest));
const image = `data:image/png;base64,${(await readFile(path.join(root, 'tests/fixtures/stacked-form.png'))).toString('base64')}`;
let context;
try {
  context = await chromium.launchPersistentContext('', {
    executablePath: process.env.TEST_CHROMIUM, headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  await worker.evaluate(image => chrome.storage.session.set({ dockCapture: {
    id: crypto.randomUUID(), tabId: 1, windowId: 1, image,
    rows: [
      { label: '同步开关', value: '', kind: 'switch', checked: true, confirmed: true },
      { label: '项目名称', value: '网页原值', confirmed: true },
    ],
    expiresAt: Date.now() + 120000,
  } }), image);
  const panel = await context.newPage();
  await context.setOffline(true);
  await panel.goto(`chrome-extension://${new URL(worker.url()).host}/panel.html?mode=dock`);
  try {
    await panel.waitForFunction(() => document.getElementById('cancel').hidden && document.querySelectorAll('.data-row').length >= 4, null, { timeout: 30000 });
  } catch (error) {
    const state = await panel.evaluate(() => ({ status: document.getElementById('status').textContent, rows: document.querySelectorAll('.data-row').length }));
    throw new Error(`Mixed source remained incomplete: ${JSON.stringify(state)}`, { cause: error });
  }
  const rows = await panel.locator('.data-row').evaluateAll(nodes => nodes.map(node => ({
    label: node.querySelector('.field-label').value,
    value: node.querySelector('.field-value').value,
  })));
  await panel.locator('#workspace-details').evaluate(node=>node.open=true);
  assert.ok(rows.some(row => row.label === '同步开关' && row.value === 'true'), JSON.stringify(rows));
  assert.deepEqual(rows.filter(row => row.label === '项目名称').map(row => row.value), ['包头']);
  const index=rows.findIndex(row=>row.label==='项目名称');
  assert.equal(await panel.locator('.data-row').nth(index).locator('[aria-label^="参与填写"]').isChecked(),true,'New conflicts retain participation but not authorization');
  assert.match(await panel.locator('.data-row').nth(index).locator('.row-review').innerText(),/冲突/);
  await panel.locator('.data-row').nth(index).getByRole('button',{name:'采用网页原值'}).click();
  assert.equal(await panel.locator('.data-row').nth(index).locator('.field-value').inputValue(),'网页原值');
  assert.equal(await panel.locator('.data-row').nth(index).locator('[aria-label^="参与填写"]').isChecked(),true,'Choosing a captured web value makes that field transferable');
  assert.equal(await panel.locator('.data-row').nth(index).getByRole('button',{name:'采用网页原值'}).count(),0,'Resolved conflict does not keep the alternative action');
  assert.ok(rows.some(row => row.label === 'Prometheus URL' && row.value === 'http://10.0.0.21:30090'), JSON.stringify(rows));
  console.log('PASS: screenshot stays primary, source conflicts require review, DOM switch supplements OCR, explicit source selection works');
} finally { await context?.close(); }
