var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path'), chromium = require('playwright').chromium;
test('agent Browser and outer dock share the exact secondary pane tab and human controls', { timeout: 45000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BROWSER: '1', CLAY_PANE_PRESENTATION: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] { display: none; }' });
  var fixture = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('[data-split-view-id="' + fixture.restoreView.id + '"] .split-view-group-open').click();
  await page.waitForFunction(function () {
    var frames = Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe'));
    return frames.length === 2 && frames.every(function (frame) { return frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready; });
  });
  var ids = await page.evaluate(async function () {
    var state = (await import('/p/reuse/modules/store.js')).store;
    return { parent: state.get('activeSessionId'), panes: Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe')).map(function (frame) { return frame.clayPane.identity().sessionId; }) };
  });
  var target = ids.panes.find(function (id) { return id !== ids.parent; });
  assert.ok(target, 'use a conversation different from the outer app selection');
  async function tool(action, url) {
    var response = await page.request.post(base + '/fixture/browser-tool?id=' + target + '&action=' + action + (url ? '&url=' + encodeURIComponent(url) : ''));
    var result = await response.json(); assert.equal(result.isError, undefined); return JSON.parse(result.content[0].text);
  }
  var opened = await tool('open', base + '/agent-owned');
  await page.waitForFunction(function (url) { var panel = document.getElementById('shared-browser-panel'); return panel && panel.getBoundingClientRect().width > 0 && panel.querySelector('form input').value === url; }, base + '/agent-owned', { timeout: 5000 });
  assert.equal(await page.locator('#shared-browser-toggle-btn .shared-browser-count').textContent(), '1');
  var uiId = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('sharedBrowser').id; });
  assert.equal(uiId, opened.id, 'the exact agent-created tab is presented to the human');
  await page.waitForFunction(async function () { return (await import('/p/reuse/modules/store.js')).store.get('sharedBrowserUi').hasFrame; });
  await page.getByRole('textbox', { name: 'Browser address', exact: true }).fill(base + '/human-navigated');
  await page.getByRole('button', { name: 'Open address', exact: true }).click();
  await page.waitForFunction(function (url) { return import('/p/reuse/modules/store.js').then(function (m) { return m.store.get('sharedBrowser').url === url; }); }, base + '/human-navigated');
  assert.equal((await tool('status')).browsers[0].url, base + '/human-navigated');
  await page.getByRole('button', { name: 'Pause Clay control', exact: true }).click();
  var status = await tool('status');
  assert.equal(status.browsers[0].control, 'user');
  await page.getByRole('button', { name: 'Resume shared control', exact: true }).click();
  await page.getByRole('button', { name: 'New browser tab', exact: true }).click();
  await page.waitForFunction(function () { return document.querySelector('.shared-browser-count').textContent === '2'; });
  assert.equal((await tool('status')).browsers.length, 2, 'human-created tabs belong to the same agent session');
  await page.locator('#shared-browser-toggle-btn').click();
  await page.locator('#shared-browser-toggle-btn').click();
  assert.equal((await tool('status')).browsers.length, 2, 'hide/reopen retains the same tabs');
  var parent = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('activeSessionId'); });
  assert.equal(parent, ids.parent, 'browser presentation never switches the outer conversation');
  assert.deepEqual(errors, []);
});
