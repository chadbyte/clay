var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Browser integrates Chrome-style tabs into shared pane chrome with stable controls and keyboard focus', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1', CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1440, height: 950 } }), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_BROWSER_HEADER_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login'); var data = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('.session-item[data-session-id="' + data.standaloneId + '"]').first().click();
  await page.waitForFunction(function () { var header = document.querySelector('#split-host > .split-pane:not(.split-pane-cached) > header'); return header && !header.inert; });
  await page.locator('#shared-browser-btn').click();
  var panel = page.locator('#shared-browser-panel'), header = panel.locator(':scope > .tool-pane-header'), tabs = header.getByRole('tab');
  await tabs.first().waitFor();
  assert.equal(await header.locator('.split-view-model:visible, .tool-pane-title:visible').count(), 0, 'no duplicate Browser pill/title');
  assert.equal(await panel.locator(':scope > .shared-browser-tabs').count(), 0, 'tab strip belongs to shared header');
  assert.equal(await header.evaluate(function (el) { return getComputedStyle(el).height; }), '33px');
  var address = panel.getByRole('textbox', { name: 'Browser address', exact: true });
  await address.fill('https://first.example/a'); await address.press('Enter');
  await page.waitForFunction(function () { return document.querySelector('#shared-browser-panel [role="tab"] .shared-browser-tab-label').textContent === 'first.example'; });
  await header.getByRole('button', { name: 'New browser tab', exact: true }).click();
  await page.waitForFunction(function () { return document.querySelectorAll('#shared-browser-panel [role="tab"]').length === 2; });
  await address.fill('https://second.example/a-long-page'); await address.press('Enter');
  await tabs.nth(1).getByText('second.example', { exact: true }).waitFor();
  await tabs.nth(1).focus(); await page.keyboard.press('ArrowLeft');
  await page.waitForFunction(function () { var selected = document.querySelector('#shared-browser-panel [role="tab"][aria-selected="true"]'); return selected && selected.textContent === 'first.example' && document.activeElement === selected; });
  await page.keyboard.press('End');
  await page.waitForFunction(function () { var selected = document.querySelector('#shared-browser-panel [role="tab"][aria-selected="true"]'); return selected && selected.textContent === 'second.example' && document.activeElement === selected; });
  assert.equal(await address.inputValue(), 'https://second.example/a-long-page');
  await page.evaluate(function () { document.querySelector('#shared-browser-panel [data-action="control"]').click(); });
  await page.waitForFunction(function () { var tab = document.querySelector('#shared-browser-panel [role="tab"][aria-selected="true"]'); return tab && tab.getAttribute('aria-label').includes('Only you') && document.activeElement === tab; });
  for (var theme of ['clay-light', 'clay-dark']) {
    var toggle = page.getByRole('button', { name: theme === 'clay-light' ? 'Switch to light mode' : 'Switch to dark mode', exact: true });
    if (await toggle.count()) await toggle.click();
    await page.waitForFunction(function (light) { return document.documentElement.classList.contains(light ? 'light-theme' : 'dark-theme'); }, theme === 'clay-light');
    for (var width of [620, 350]) {
      await panel.evaluate(function (el, value) { el.style.setProperty('width', value + 'px', 'important'); el.style.setProperty('min-width', '0', 'important'); el.style.setProperty('max-width', value + 'px', 'important'); }, width);
      var metrics = await panel.evaluate(function (el) {
        var header = el.querySelector('.tool-pane-header'), rect = header.getBoundingClientRect(), selected = header.querySelector('.shared-browser-tab:has([aria-selected="true"])');
        var actions = header.querySelector('.shared-browser-window').getBoundingClientRect(), add = header.querySelector('.shared-browser-new-tab').getBoundingClientRect();
        return { height: rect.height, overflow: header.scrollWidth > header.clientWidth, actionsVisible: actions.right <= rect.right && actions.left >= rect.left, addVisible: add.right <= actions.left, joined: getComputedStyle(selected).backgroundColor === getComputedStyle(el.querySelector('form')).backgroundColor, nativeTitles: header.querySelectorAll('[title]').length };
      });
      assert.deepEqual(metrics, { height: 33, overflow: false, actionsVisible: true, addVisible: true, joined: true, nativeTitles: 0 }, theme + ' at ' + width);
    }
  }
  for (var count = 3; count <= 4; count++) {
    await header.getByRole('button', { name: 'New browser tab', exact: true }).click();
    await page.waitForFunction(function (size) { return document.querySelectorAll('#shared-browser-panel [role="tab"]').length === size; }, count);
  }
  var overflow = await header.evaluate(function (el) {
    var strip = el.querySelector('.shared-browser-tab-list'), active = strip.querySelector('[aria-selected="true"]').getBoundingClientRect(), bounds = strip.getBoundingClientRect();
    return { scrollable: strip.scrollWidth > strip.clientWidth, activeVisible: active.left >= bounds.left - 1 && active.right <= bounds.right + 1, controlsFit: el.scrollWidth === el.clientWidth, left: active.left - bounds.left, right: active.right - bounds.right, width: bounds.width };
  });
  assert.equal(overflow.scrollable && overflow.activeVisible && overflow.controlsFit, true, JSON.stringify(overflow));
  await panel.locator('.workbench-layout-toggle').click();
  await page.waitForFunction(function () { return document.querySelector('#shared-browser-panel').dataset.workbenchPlacement === 'docked'; });
  assert.equal(await header.locator('.shared-browser-tabs').count(), 1);
  await panel.getByRole('button', { name: 'Close browser tab 1', exact: true }).click();
  await page.waitForFunction(function () { return document.querySelectorAll('#shared-browser-panel [role="tab"]').length === 3; });
  assert.equal(await tabs.first().innerText(), 'second.example');
  assert.deepEqual(errors, []);
});
