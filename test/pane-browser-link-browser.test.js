// Real markdown, pane bridge, parent panel and authenticated service; no external browser navigation.
var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Browser chip opens the outer workbench from singleton and saved-view conversations', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '', CLAY_PANE_PRESENTATION: '1', CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [], opens = [];
  await require('./fixtures/source-module-runtime.cjs').install(page);
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) { socket.on('framesent', function (event) {
    var message; try { message = JSON.parse(String(event.payload)); } catch (error) { return; }
    if (message.type === 'shared_browser_open') opens.push({ pane: new URL(socket.url()).searchParams.get('pane'), url: message.url });
  }); });
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  var fixture = await (await page.request.get(base + '/fixture/state')).json();
  for (var surface of ['singleton', 'saved-view']) {
    if (surface === 'saved-view') await page.locator('[data-split-view-id="' + fixture.restoreView.id + '"] .split-view-group-open').click();
    await page.waitForFunction(function () {
      var frames = Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe'));
      return frames.length && frames.every(function (frame) { return frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready; });
    });
    var element = await page.locator('#split-host .split-pane:not(.split-pane-cached) iframe').first().elementHandle();
    var frame = await element.contentFrame(), url = base + '/preview-' + surface;
    await frame.evaluate(async function (url) {
      var router = await import('/p/reuse/modules/app-message-router.js');
      var state = (await import('/p/reuse/modules/store.js')).store;
      router.processMessage({ type: 'delta', text: '\n\n[Open prototype](browser:' + url + ')\n\n', paneActivation: state.get('paneCommittedBinding') });
      router.processMessage({ type: 'done', code: 0, paneActivation: state.get('paneCommittedBinding') });
    }, url);
    await frame.locator('.clay-browser-link[data-browser-url="' + url + '"]').click();
    await page.waitForFunction(function (expected) {
      var panel = document.getElementById('shared-browser-panel');
      return panel && panel.getBoundingClientRect().width > 0 && panel.querySelector('.shared-browser-address input').value === expected;
    }, url, { timeout: 5000 });
    assert.equal(await frame.locator('#shared-browser-panel').count(), 0, 'browser belongs to the outer workbench');
    assert.equal(opens.filter(function (message) { return message.url === url; }).length, 1, 'one request for the human click');
    assert.ok(opens.every(function (message) { return message.pane !== '1'; }), 'no hidden iframe browser request');
    await page.evaluate(async function () { (await import('/p/reuse/modules/shared-browser.js')).hideSharedBrowser(); });
  }
  assert.deepEqual(errors, []);
});
