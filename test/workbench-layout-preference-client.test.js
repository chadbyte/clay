var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var requests = [], socket = {}, now = 1000;
  var context = vm.createContext({ Promise: Promise, AbortController: AbortController, setTimeout: setTimeout, clearTimeout: clearTimeout,
    Date: { now: function () { return now; } }, getWs: function () { return socket; },
    fetch: function (url, options) { return new Promise(function (resolve, reject) { requests.push({ url: url, options: options, resolve: function (data, status) {
      resolve({ ok: !status || status === 200, status: status || 200, json: function () { return Promise.resolve(data); } });
    }, reject: reject }); }); } });
  vm.runInContext(fs.readFileSync('lib/public/modules/store.js', 'utf8').replace(/^export .*$/gm, ''), context);
  vm.runInContext(fs.readFileSync('lib/public/modules/workbench-layout-preference.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, ''), context);
  context.createStore({ myUserId: 'a', connected: true, currentSlug: 'p', authIdentityLoaded: true, projectSplitViewSocketGeneration: 1 });
  return { api: context, requests: requests, value: function () { return context.store.get('workbenchLayoutPreference'); },
    socket: function () { socket = {}; }, age: function () { now += 31000; } };
}
async function read(f, mode, revision) {
  var promise = f.api.ensureWorkbenchLayoutPreference(); await Promise.resolve();
  f.requests[f.requests.length - 1].resolve({ accountId: 'a', mode: mode || 'overlay', revision: revision || 0 });
  assert.equal(await promise, true);
}
test('fresh reads deduplicate; mode changes only after persisted save; refresh sees another device', async function () {
  var f = fixture(), first = f.api.ensureWorkbenchLayoutPreference(), second = f.api.ensureWorkbenchLayoutPreference();
  assert.equal(first, second); await Promise.resolve(); assert.equal(f.requests.length, 1);
  assert.equal(f.requests[0].options.headers['X-Clay-Account-Id'], 'a');
  f.requests[0].resolve({ accountId: 'a', mode: 'overlay', revision: 0 }); await first;
  await f.api.ensureWorkbenchLayoutPreference(); assert.equal(f.requests.length, 1);
  var saved = f.api.saveWorkbenchLayoutMode('docked'); assert.equal(f.value().mode, 'overlay'); assert.equal(f.value().saving, true);
  assert.equal(await f.api.saveWorkbenchLayoutMode('overlay'), false);
  await Promise.resolve(); assert.deepEqual(JSON.parse(f.requests[1].options.body), { mode: 'docked', revision: 0 });
  f.requests[1].resolve({ accountId: 'a', mode: 'docked', revision: 1 }); assert.equal(await saved, true); assert.equal(f.value().mode, 'docked');
  f.age(); await read(f, 'overlay', 2); assert.equal(f.value().mode, 'overlay');
});
test('save failure and conflict preserve effective mode and require a fresh read before retry', async function () {
  var f = fixture(); await read(f, 'docked', 3);
  var pending = f.api.saveWorkbenchLayoutMode('overlay'); await Promise.resolve();
  f.requests[1].resolve({ error: 'changed elsewhere' }, 409); assert.equal(await pending, false);
  assert.equal(f.value().mode, 'docked'); assert.equal(f.value().ready, false); assert.match(f.value().error, /elsewhere/);
  assert.equal(await f.api.saveWorkbenchLayoutMode('overlay'), false);
  await read(f, 'overlay', 4);
  pending = f.api.saveWorkbenchLayoutMode('docked'); await Promise.resolve();
  f.requests[3].reject(new Error('Network unavailable')); assert.equal(await pending, false);
  assert.equal(f.value().mode, 'overlay'); assert.equal(f.value().saving, false);
});
test('account, project, reconnect generation and socket replacement reject late persisted replies', async function () {
  for (var change of ['account', 'project', 'connected', 'generation', 'socket']) {
    var f = fixture(); await read(f);
    var pending = f.api.saveWorkbenchLayoutMode('docked'); await Promise.resolve();
    if (change === 'account') f.api.store.set({ myUserId: 'b' });
    if (change === 'project') f.api.store.set({ currentSlug: 'q' });
    if (change === 'connected') { f.api.store.set({ connected: false }); f.api.store.set({ connected: true }); }
    if (change === 'generation') f.api.store.set({ projectSplitViewSocketGeneration: 2 });
    if (change === 'socket') f.socket();
    f.requests[1].resolve({ accountId: 'a', mode: 'docked', revision: 1 });
    assert.equal(await pending, false, change); assert.equal(f.value().mode, 'overlay', change); assert.equal(f.value().saving, false, change);
    assert.equal(f.value().accountId, change === 'account' ? 'b' : 'a');
  }
});
test('foreign, regressed and incorrect write receipts cannot publish state', async function () {
  for (var receipt of [{ accountId: 'b', mode: 'docked', revision: 4 }, { accountId: 'a', mode: 'docked', revision: 2 }, { accountId: 'a', mode: 'docked', revision: 5 }, { accountId: 'a', mode: 'overlay', revision: 4 }]) {
    var f = fixture(); await read(f, 'overlay', 3);
    var pending = f.api.saveWorkbenchLayoutMode('docked'); await Promise.resolve(); f.requests[1].resolve(receipt);
    assert.equal(await pending, false); assert.equal(f.value().mode, 'overlay'); assert.equal(f.value().revision, 3);
  }
});
test('loading failure permits intentional retry and pre-identity claims do not read', async function () {
  var f = fixture(); f.api.store.set({ authIdentityLoaded: false });
  assert.equal(await f.api.ensureWorkbenchLayoutPreference(), false); assert.equal(f.requests.length, 0);
  f.api.store.set({ authIdentityLoaded: true });
  var pending = f.api.ensureWorkbenchLayoutPreference(); await Promise.resolve(); f.requests[0].reject(new Error('offline'));
  assert.equal(await pending, false); assert.equal(f.value().mode, 'overlay'); assert.equal(f.value().loading, false);
  await read(f, 'docked', 1); assert.equal(f.value().mode, 'docked');
});
