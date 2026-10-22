var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Worker history waits for upward input and a Browser dock moves beside a single Driver', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], requests = [], saves = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) { socket.on('framesent', function (event) {
    var msg; try { msg = JSON.parse(String(event.payload)); } catch (error) { return; }
    if (msg.type === 'split_worker_conversation_request') requests.push(msg);
    if (msg.type === 'project_split_view_update' && msg.workspace) saves.push(msg);
  }); });
  page.on('request', function (request) {
    if (request.method() === 'PUT' && request.url().includes('/api/user/workbench-layout')) { var data = request.postDataJSON(); if (data.layout) saves.push(data.layout); }
  });
  if (!process.env.CLAY_LOADING_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] {display:none;}' });
  var fixture = await (await page.request.get(base + '/fixture/state')).json(), driver = fixture.groups[0].pair.driverId;
  await page.locator('.session-item[data-session-id="' + driver + '"]').first().click();
  await page.waitForFunction(function () { var f = document.querySelector('#split-host > .split-pane iframe'); return f && f.clayPane && f.clayPane.identity() && f.clayPane.identity().ready; });
  // Force a short transcript viewport: opening and layout changes must stay idle.
  await page.addStyleTag({ content: '#split-view-worker-popover .split-view-worker-popover-body {height:30000px;max-height:none;flex:none;}' });
  await page.locator('.split-view-worker-chip').first().click();
  var popup = page.locator('#split-view-worker-popover'), body = popup.locator('.split-view-worker-popover-body');
  await popup.getByText('Scroll up for earlier messages', { exact: true }).waitFor();
  await page.waitForTimeout(500);
  assert.equal(requests.length, 1, 'opening underfilled content must not drain earlier history');
  await body.evaluate(function (el) { el.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(200);
  assert.equal(requests.length, 1, 'layout-generated scroll cannot load history');
  var count = await body.locator('.worker-readonly-message').count();
  await body.evaluate(function (el) { el.dispatchEvent(new WheelEvent('wheel', { deltaY: -80 })); });
  await page.waitForFunction(function (before) { return document.querySelectorAll('#split-view-worker-popover .worker-readonly-message').length > before; }, count);
  await page.waitForTimeout(400);
  assert.equal(requests.length, 2, 'one upward gesture loads exactly one page');
  await page.keyboard.press('Escape');
  await page.request.post(base + '/fixture/browser-tool?id=' + fixture.groups[0].pair.workerId + '&action=open&url=https%3A%2F%2Fworker.example%2F');
  await page.locator('#shared-browser-btn').click();
  var panel = page.locator('#shared-browser-panel');
  await panel.waitFor({ state: 'visible' });
  var toggle = panel.locator('.workbench-layout-toggle'); await toggle.waitFor();
  await page.waitForFunction(function () { var b = document.querySelector('#shared-browser-panel .workbench-layout-toggle'); return b && !b.disabled; });
  await toggle.click();
  await page.waitForFunction(function () { return document.querySelector('#shared-browser-panel[data-tool-window-id="tool-browser"]'); });
  await page.waitForTimeout(400);
  var session = page.locator('#split-host > .split-pane:not(.split-pane-cached)').first();
  async function drag(side, cancel) {
    var handle = await panel.locator('.split-pane-drag-space').first().boundingBox(), target = await session.boundingBox();
    assert.ok(handle && handle.width > 0);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
    await page.mouse.move(target.x + (side === 'left' ? 8 : target.width - 8), target.y + target.height / 2, { steps: 8 });
    await page.waitForTimeout(200);
    if (cancel) await page.keyboard.press('Escape');
    await page.mouse.up(); await page.waitForTimeout(650);
  }
  assert.equal(await session.count(), 1);
  assert.ok((await panel.boundingBox()).x > (await session.boundingBox()).x);
  var saveCount = saves.length;
  await drag('left');
  assert.ok((await panel.boundingBox()).x < (await session.boundingBox()).x, 'drop commits Browser to the left of the single session');
  assert.ok(saves.length > saveCount, 'single-session drop persists through the shared layout service');
  saveCount = saves.length;
  await drag('right', true);
  assert.equal(saves.length, saveCount, 'Escape cancels without persisting');
  assert.ok((await panel.boundingBox()).x < (await session.boundingBox()).x);
  await panel.getByRole('button', { name: 'Close browser pane', exact: true }).click();
  await page.locator('#shared-browser-btn').click();
  await page.waitForTimeout(350);
  assert.equal(await panel.getAttribute('data-workbench-placement'), 'overlay', 'reopening still requires explicit docking');
  await panel.locator('.workbench-layout-toggle').click();
  await page.waitForTimeout(400);
  assert.equal(await panel.getAttribute('data-workbench-placement'), 'docked');
  assert.deepEqual(errors, []);
});
