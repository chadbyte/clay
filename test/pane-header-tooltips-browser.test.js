var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), chromium = require('playwright').chromium;
test('session and lazy workbench header icons use accessible JS tooltips and remove native titles', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve) { child.once('message', resolve); }), browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_TOOLTIP_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login'); var data = await (await page.request.get('http://127.0.0.1:' + info.port + '/fixture/state')).json();
  await page.locator('.session-item[data-session-id="' + data.standaloneId + '"]').first().click();
  var header = page.locator('#split-host > .split-pane:not(.split-pane-cached) .split-pane-header').first(), infoButton = header.getByRole('button', { name: 'Session information', exact: true });
  await page.waitForFunction(function () { var header = document.querySelector('#split-host > .split-pane:not(.split-pane-cached) .split-pane-header'); return header && !header.inert && header.querySelectorAll('button[aria-label]').length && Array.from(header.querySelectorAll('button[aria-label]')).every(function (button) { return button.getAttribute('data-tip') && !button.hasAttribute('title'); }); });
  await infoButton.hover(); var tooltip = page.locator('#clay-tooltip.visible'); await tooltip.waitFor(); assert.equal(await tooltip.innerText(), 'Session information');
  assert.match(await infoButton.getAttribute('aria-describedby'), /clay-tooltip/);
  await page.keyboard.press('Escape'); await page.locator('#clay-tooltip.visible').waitFor({ state: 'hidden' });
  await page.mouse.move(1, 1); await infoButton.focus(); await tooltip.waitFor(); assert.equal(await tooltip.innerText(), 'Session information');
  var permissionTips = [
    ['default', 'Ask before tool actions that need permission. Previously allowed actions can run without asking again.'],
    ['bypassPermissions', 'Run tools, file changes and commands without asking for permission. Clay access restrictions still apply.']
  ];
  await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'hidden' });
  for (var i = 0; i < permissionTips.length; i++) {
    var permissionButton = header.locator('[data-permission-mode="' + permissionTips[i][0] + '"]');
    await permissionButton.evaluate(function (button) { button.setAttribute('aria-label', button.getAttribute('aria-label')); });
    await page.mouse.move(1, 1); await permissionButton.hover(); await tooltip.waitFor();
    assert.equal(await tooltip.innerText(), permissionTips[i][1], 'header synchronization preserves the explanation rather than replacing it with the accessible name');
    assert.equal(await permissionButton.getAttribute('title'), null);
    await page.keyboard.press('Escape'); await tooltip.waitFor({ state: 'hidden' });
  }
  await page.getByRole('button', { name: 'Logs', exact: true }).click();
  var logs = page.locator('#project-logs-panel'); await logs.locator(':scope > header .workbench-layout-toggle').waitFor();
  await page.waitForFunction(function () { var header = document.querySelector('#project-logs-panel > header'); return header && !header.querySelector('[title]') && Array.from(header.querySelectorAll('button')).every(function (button) { return button.getAttribute('data-tip') && button.getAttribute('aria-label'); }); });
  var dock = logs.locator('.workbench-layout-toggle'); await dock.hover(); await tooltip.waitFor(); assert.equal(await tooltip.innerText(), 'Dock workbench beside sessions');
  await dock.click();
  await page.waitForFunction(function () { var button = document.querySelector('#project-logs-panel .workbench-layout-toggle'); return button && button.dataset.tip === 'Float workbench over sessions' && !button.hasAttribute('title'); });
  await page.mouse.move(1, 1); await dock.hover(); await tooltip.waitFor(); assert.equal(await tooltip.innerText(), 'Float workbench over sessions');
  await logs.getByRole('button', { name: 'Close Logs', exact: true }).click(); await page.locator('#clay-tooltip.visible').waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});

test('top tray uses live JS tooltips for static and inserted controls without native titles', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve) { child.once('message', resolve); }), browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_TOOLTIP_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
  var tray = page.locator('#top-bar .top-bar-actions');
  await page.waitForFunction(function () { var root = document.querySelector('#top-bar .top-bar-actions'); return root && root.querySelector('.vendor-usage-chip') && !root.querySelector('[title]') && Array.from(root.querySelectorAll('button')).every(function (button) { return button.getAttribute('data-tip') && button.getAttribute('aria-label'); }); });
  var tip = page.locator('#clay-tooltip.visible');
  for (var selector of ['.vendor-usage-chip', '#shared-browser-toggle-btn', '#terminal-toggle-btn', '#notif-center-btn', '#server-settings-btn']) {
    var button = tray.locator(selector).first(); await button.hover(); await tip.waitFor();
    assert.equal(await tip.innerText(), await button.getAttribute('data-tip')); assert.equal(await button.getAttribute('title'), null);
    await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' }); await page.mouse.move(1, 1);
  }
  var settings = tray.locator('#server-settings-btn'); await settings.focus(); await tip.waitFor(); assert.equal(await tip.innerText(), 'Settings');
  await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' });
  await page.evaluate(function () {
    var tray = document.querySelector('#top-bar .top-bar-actions'), item = document.createElement('a');
    item.id = 'fixture-tray-usage'; item.href = '#'; item.title = 'Usage 19%'; item.textContent = '19%'; tray.prepend(item);
  });
  var usage = tray.locator('#fixture-tray-usage');
  await page.waitForFunction(function () { var item = document.getElementById('fixture-tray-usage'); return item.dataset.tip === 'Usage 19%' && !item.hasAttribute('title'); });
  await usage.evaluate(function (item) { item.title = 'Usage 23%'; });
  await page.waitForFunction(function () { var item = document.getElementById('fixture-tray-usage'); return item.dataset.tip === 'Usage 23%' && item.getAttribute('aria-label') === 'Usage 23%' && !item.hasAttribute('title'); });
  await usage.hover(); await tip.waitFor(); assert.equal(await tip.innerText(), 'Usage 23%');
  await usage.evaluate(function (item) { item.remove(); }); await tip.waitFor({ state: 'hidden' });
  assert.equal(await tray.locator('[title]').count(), 0); assert.deepEqual(errors, []);
});

[false, true].forEach(function (compiled) {
  test('session information follows the title in single panes and named Views (' + (compiled ? 'built' : 'source') + ')', { timeout: 60000 }, async function (t) {
    var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve) { child.once('message', resolve); }), browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var page = await browser.newPage({ viewport: { width: 1600, height: 900 } }), base = 'http://127.0.0.1:' + info.port, errors = [], assets = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    page.on('response', function (response) { if (/\/pane-assets\/app-.*\.js/.test(response.url())) assets.push(response.status()); });
    if (!compiled) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/fixture/login');
    var data = await (await page.request.get(base + '/fixture/state')).json();
    await page.locator('.session-item[data-session-id="' + data.standaloneId + '"]').first().click();
    var paneSelector = '#split-host > .split-pane[data-session-id="' + data.standaloneId + '"]:not(.split-pane-cached)';
    var pane = page.locator(paneSelector), header = pane.locator('.split-pane-header');
    async function ready() {
      await page.waitForFunction(function (selector) {
        var pane = document.querySelector(selector), header = pane && pane.querySelector('.split-pane-header'), frame = pane && pane.querySelector('iframe'), live = frame && frame.clayPane && frame.clayPane.identity();
        return header && !header.inert && header.querySelector('.split-pane-info[data-tip]') && live && live.ready && live.sessionId === Number(pane.dataset.sessionId) && !frame.dataset.requestedSessionId;
      }, paneSelector);
    }
    async function adjacency(label) {
      await ready();
      var geometry = await header.evaluate(function (el) {
        var title = el.querySelector('.split-pane-title'), info = el.querySelector('.split-pane-info'), a = title.getBoundingClientRect(), b = info.getBoundingClientRect();
        return { next: title.nextElementSibling === info, gap: b.left - a.right, center: Math.abs((a.top + a.bottom - b.top - b.bottom) / 2), width: b.width, height: el.getBoundingClientRect().height, truncated: title.scrollWidth > title.clientWidth, native: !!info.closest('[title]') };
      });
      assert.equal(geometry.next, true, label + ' DOM order'); assert.equal(geometry.native, false, label + ' native-title ancestors');
      assert.ok(geometry.gap >= 0 && geometry.gap <= 6, label + ' adjacent title gap: ' + JSON.stringify(geometry));
      assert.ok(geometry.center <= 1, label + ' same title row: ' + JSON.stringify(geometry)); assert.equal(geometry.width, 20);
      if (process.env.CLAY_HEADER_CAPTURES) await page.screenshot({ path: path.join(process.env.CLAY_HEADER_CAPTURES, (compiled ? 'built-' : 'source-') + label.replace(/[^a-z]+/gi, '-') + '.png') });
      return geometry;
    }
    assert.equal((await adjacency('single short title')).height, 33);
    assert.equal(await page.locator('#header-title').evaluate(function (title) { return title.nextElementSibling.id; }), 'header-info-btn', 'native header keeps the same title/info order');
    var infoButton = header.locator('.split-pane-info');
    await infoButton.focus(); await page.keyboard.press('Tab');
    assert.equal(await header.evaluate(function (el) { return el.querySelector('.split-pane-full-access').contains(document.activeElement); }), true, 'Tab reaches permission controls after information');
    await page.keyboard.press('Shift+Tab'); assert.equal(await infoButton.evaluate(function (el) { return document.activeElement === el; }), true);
    await infoButton.hover(); var tip = page.locator('#clay-tooltip.visible'); await tip.waitFor(); assert.equal(await tip.innerText(), 'Session information');
    await page.keyboard.press('Escape'); await tip.waitFor({ state: 'hidden' });
    await page.mouse.move(1, 1); await infoButton.blur(); await infoButton.focus(); await tip.waitFor(); assert.equal(await tip.innerText(), 'Session information');
    async function inspectInfo() {
      var sessionId = await pane.getAttribute('data-session-id');
      await infoButton.click(); var popup = page.locator('#split-pane-info-popover'); await popup.waitFor();
      assert.equal(await popup.locator('.info-row').filter({ hasText: 'Local ID' }).locator('.info-value').innerText(), sessionId);
      var anchor = await infoButton.boundingBox(), box = await popup.boundingBox(); assert.ok(Math.abs(box.y - anchor.y - anchor.height - 6) <= 1, 'popover remains anchored below information');
      assert.ok(box.x >= 8 && box.x + box.width <= (await page.viewportSize()).width - 7, 'popover fits viewport');
      await page.keyboard.press('Escape'); await popup.waitFor({ state: 'detached' }); assert.equal(await infoButton.evaluate(function (el) { return document.activeElement === el; }), true);
    }
    await inspectInfo();
    var longTitle = 'A long session title that must truncate while information stays beside it in a narrow named View';
    await header.locator('.split-pane-title').click(); var rename = header.locator('.split-pane-rename-input'); await rename.fill(longTitle); await rename.press('Enter');
    await header.locator('.split-pane-title').getByText(longTitle, { exact: true }).waitFor();
    await adjacency('single long title');
    await page.setViewportSize({ width: 390, height: 850 }); assert.equal((await adjacency('single narrow title')).truncated, true); await inspectInfo();
    await page.setViewportSize({ width: 1600, height: 900 });
    await page.locator('[data-split-view-id="' + data.restoreView.id + '"] .split-view-group-open').click();
    await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length === 2; });
    paneSelector = '#split-host > .split-pane[data-session-id="' + data.restoreView.members[0] + '"]:not(.split-pane-cached)';
    pane = page.locator(paneSelector); header = pane.locator('.split-pane-header'); infoButton = header.locator('.split-pane-info');
    await adjacency('named View short title'); await inspectInfo();
    await header.locator('.split-pane-title').click(); rename = header.locator('.split-pane-rename-input'); await rename.fill(longTitle); await rename.press('Enter');
    await header.locator('.split-pane-title').getByText(longTitle, { exact: true }).waitFor();
    assert.equal((await adjacency('named View long title')).truncated, true);
    await page.setViewportSize({ width: 1000, height: 850 }); await adjacency('named View narrow title'); await inspectInfo();
    assert.deepEqual(errors, []); if (compiled) assert.ok(assets.some(function (status) { return status === 200; }) && assets.every(function (status) { return status === 200 || status === 304; }), 'actual built pane entries were served');
  });
});
