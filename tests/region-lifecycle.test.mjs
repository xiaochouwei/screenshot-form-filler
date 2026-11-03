import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import vm from 'node:vm';

test('an in-progress region survives a background worker restart and is accepted once', async () => {
  const storage = {};
  const tab = { id: 7, windowId: 9, url: 'https://example.test/form', active: true };
  let activeDocumentId = 'document-7';
  const bundle = (await build({ entryPoints: ['src/background.js'], bundle: true, write: false, platform: 'browser', format: 'iife' })).outputFiles[0].text;
  const boot = () => {
    const listeners = {};
    const tokens = [];
    let started;
    const startedPromise = new Promise(resolve => started = resolve);
    const event = key => ({ addListener: fn => { listeners[key] = fn; } });
    const chrome = {
      runtime: { id: 'extension', getURL: path => `chrome-extension://extension/${path}`, onInstalled: event('installed'), onStartup: event('startup'), onMessage: event('message') },
      action: { onClicked: event('action'), setBadgeText: async () => {}, setTitle: async () => {} },
      commands: { onCommand: event('command') },
      tabs: {
        query: async () => [tab], get: async () => tab, captureVisibleTab: async () => 'data:image/png;base64,AA==',
        sendMessage: async (_id, message) => {
          if (message.type === 'SOURCE') return { ok: true, rows: [] };
          if (message.type === 'START_REGION') { tokens.push(message.token); started(message.token); return { ok: true }; }
          return { ok: true };
        },
        onUpdated: event('updated'), onRemoved: event('removed'),
      },
      scripting: { executeScript: async () => [{ frameId: 0, documentId: activeDocumentId, result: { width: 900, height: 700, scrollX: 0, scrollY: 0, scale: 1 } }] },
      windows: { create: async () => ({ id: 11 }), get: async () => ({ id: 11, tabs: [] }), update: async () => {} },
      permissions: { onRemoved: event('permissionsRemoved'), onAdded:event('permissionsAdded') },
      sidePanel: { setPanelBehavior: async () => {} },
      storage: { local:{get:async()=>({captureLayout:'window'})}, session: {
        get: async key => key === null ? { ...storage } : { [key]: storage[key] },
        set: async values => Object.assign(storage, values),
        remove: async key => delete storage[key],
      } },
    };
    vm.runInNewContext(bundle, { chrome, crypto: globalThis.crypto, Date, console, setTimeout, clearTimeout, URL });
    const send = (message, documentId = activeDocumentId) => new Promise(resolve => {
      const sender = { id: 'extension', frameId: 0, tab, url: tab.url, documentId };
      if (!listeners.message(message, sender, resolve)) resolve({ unhandled: true });
    });
    return { listeners, send, startedPromise, tokens };
  };
  const first = boot();
  first.listeners.command('receive-screenshot', tab);
  const token = await first.startedPromise;
  const restarted = boot();
  const message = { type: 'REGION_CAPTURE', token, image: 'data:image/png;base64,AA==', rows: [] };
  const wrongDocument = await restarted.send(message, 'another-document');
  assert.equal(wrongDocument.ok, false, 'A different document cannot use the token');
  assert.match(wrongDocument.error, /页面已刷新/);
  tab.url = 'https://other.test/form';
  assert.match((await restarted.send(message)).error, /网站已切换/);
  tab.url = 'https://example.test/form?view=2';
  assert.equal((await restarted.send(message)).ok, true);
  assert.equal(storage.dockCapture.tabId, tab.id);
  const replay = await restarted.send(message);
  assert.equal(replay.ok, false, 'A capture token cannot be replayed');
  assert.match(replay.error, /记录已丢失/);
  restarted.listeners.command('receive-screenshot', tab);
  await restarted.startedPromise;
  await new Promise(resolve => setImmediate(resolve));
  const staleToken = restarted.tokens[0];
  tab.url = 'https://other.test/form';
  activeDocumentId = 'document-8';
  restarted.listeners.command('receive-screenshot', tab);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(restarted.tokens.length, 2, 'A new site in the same tab starts selection on the first shortcut');
  assert.notEqual(restarted.tokens[1], staleToken);
  assert.equal(storage['regionSelection-7'].url, tab.url);
});
