// Production app/HTTP/WS with isolated storage and provider execution fenced.
var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

test('singleton header settles permission receipts and follows only its bound pane model', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '', CLAY_PANE_HEADER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [], requests = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) { socket.on('framesent', function (event) {
    var message; try { message = JSON.parse(String(event.payload)); } catch (error) { return; }
    if (message.type === 'set_permission_mode') requests.push(message);
  }); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.waitForFunction(function () {
    var frame = document.querySelector('#split-host .split-pane:not(.split-pane-cached) iframe');
    return frame && frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready;
  });
  var pane = page.locator('#split-host .split-pane:not(.split-pane-cached)').first();
  var id = Number(await pane.getAttribute('data-session-id'));
  var saved = await (await page.request.get(base + '/fixture/state')).json();
  assert.equal(saved.sessions.find(function (session) { return session.id === id; }).model, null, 'list projection has no model while the bound child receives its configuration');
  await page.waitForFunction(function () { return document.querySelector('#split-host .split-view-model').textContent === 'fixture'; });
  assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('splitPanes'); }), null, 'actual singleton path');
  var documents = await pane.locator('iframe').elementHandle(), frame = await documents.contentFrame();
  var initial = await frame.evaluate(function () { window.headerOriginalDocument = document; return true; }); assert.equal(initial, true);
  for (var mode of ['bypassPermissions', 'default', 'bypassPermissions', 'default']) {
    await pane.locator('[data-permission-mode="' + mode + '"]').click();
    await page.waitForFunction(function (expected) {
      var control = document.querySelector('#split-host .split-pane:not(.split-pane-cached) .split-pane-full-access');
      var selected = control.querySelector('[data-permission-mode="' + expected + '"]');
      return control.getAttribute('aria-busy') === 'false' && selected.getAttribute('aria-pressed') === 'true' && !selected.disabled;
    }, mode, { timeout: 3000 });
    var state = await (await page.request.get(base + '/fixture/state')).json();
    assert.equal(state.sessions.find(function (session) { return session.id === id; }).permissionMode, mode);
  }
  assert.equal(requests.length, 4, 'one exact request per click, no automatic retry loop');
  assert.ok(requests.every(function (request) { return request.sessionId === id && request.projectSlug === 'reuse'; }));
  var changed = await frame.evaluate(async function () {
    var messages = await import('/p/reuse/modules/app-message-router.js');
    var state = (await import('/p/reuse/modules/store.js')).store;
    messages.processMessage({ type: 'model_info', sessionId: state.get('activeSessionId'), vendor: 'codex', models: ['fixture', 'fixture-live'], model: 'fixture', paneActivation: state.get('paneCommittedBinding') });
    messages.processMessage({ type: 'config_state', sessionId: state.get('activeSessionId'), vendor: 'codex', model: 'fixture-live', paneActivation: state.get('paneCommittedBinding') });
    return document === window.headerOriginalDocument;
  });
  assert.equal(changed, true, 'configuration refresh retains the real child document and composer');
  await page.waitForFunction(function () { return document.querySelector('#split-host .split-view-model').textContent === 'fixture-live'; });
  await page.setViewportSize({ width: 390, height: 800 });
  assert.equal(await pane.locator('.split-view-model').textContent(), 'fixture-live');
  await page.reload();
  await page.waitForFunction(function () {
    var control = document.querySelector('#split-host .split-pane:not(.split-pane-cached) .split-pane-full-access');
    return control && control.getAttribute('aria-busy') === 'false' && control.querySelector('[data-permission-mode="default"]').getAttribute('aria-pressed') === 'true';
  });
  assert.deepEqual(errors, []);
});
