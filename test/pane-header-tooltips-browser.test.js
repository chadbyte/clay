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
