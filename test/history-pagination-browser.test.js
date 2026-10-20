var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

test('earlier history remains usable across pending activation and same-document reactivation', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
  await page.waitForFunction(function () {
    var frame = document.querySelector('#split-host .split-pane:not(.split-pane-cached) iframe');
    return frame && frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready;
  });
  var frame = await (await page.locator('#split-host .split-pane:not(.split-pane-cached) iframe').first().elementHandle()).contentFrame();
  var blocked = await frame.evaluate(async function () {
    var store = (await import('/p/reuse/modules/store.js')).store;
    var header = await import('/p/reuse/modules/app-header.js');
    var binding = store.get('paneCommittedBinding');
    store.set({ panePendingBinding: binding, paneReady: false, loadingMore: false });
    header.requestMoreHistory();
    var pending = store.get('loadingMore');
    store.set({ panePendingBinding: null, paneReady: true });
    return pending;
  });
  assert.equal(blocked, false, 'a blocked activation must not latch pagination as loading');
  await frame.evaluate(async function () {
    var store = (await import('/p/reuse/modules/store.js')).store;
    window.historyOriginalDocument = document;
    store.set({ loadingMore: true });
    window.frameElement.clayPane.activate(store.get('activeSessionId'), true);
  });
  await frame.waitForFunction(async function () {
    var store = (await import('/p/reuse/modules/store.js')).store;
    return store.get('paneReady') && !store.get('panePendingBinding');
  });
  assert.equal(await frame.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('loadingMore'); }), false);
  for (var pageIndex = 0; pageIndex < 8; pageIndex++) {
    var from = await frame.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('historyFrom'); });
    if (!from) break;
    await frame.locator('#messages').evaluate(function (messages) { messages.scrollTop = 0; });
    await frame.waitForFunction(async function (before) {
      var store = (await import('/p/reuse/modules/store.js')).store;
      return store.get('historyFrom') < before && !store.get('loadingMore');
    }, from);
  }
  await frame.waitForFunction(function () { return document.getElementById('messages').textContent.indexOf('entry 0.') >= 0; });
  assert.equal(await frame.locator('.history-sentinel').count(), 0, 'all earlier pages can load through the actual sentinel');
  assert.equal(await frame.evaluate(function () { return document === window.historyOriginalDocument; }), true);
  assert.match(await frame.locator('#messages').textContent(), /EXACT_TRANSCRIPT_/);
  assert.deepEqual(errors, []);
});
