var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Linear uses shared workbench controls, document density and overlay/dock/fullscreen geometry', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_LINEAR_LINKS: '1', CLAY_PANE_LINEAR_DETAIL: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_LINEAR_PATTERN_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] {display:none;}' });
  var fixture = await (await page.request.get(base + '/fixture/state')).json(), id = fixture.standaloneId;
  var row = page.locator('.session-item[data-session-id="' + id + '"]').first(); await row.click();
  await page.waitForFunction(function () { var f = document.querySelector('#split-host > .split-pane iframe'), live = f && f.clayPane && f.clayPane.identity(); return live && live.ready; });
  await row.locator('.session-linear-link').click();
  var panel = page.locator('#linear-panel'), header = panel.locator(':scope > header');
  await panel.locator('.issue-doc-title').getByText('Fixture linked issue', { exact: true }).waitFor();
  var wide = header.getByRole('button', { name: 'Widen Linear', exact: true }), full = header.getByRole('button', { name: 'Toggle Linear fullscreen', exact: true });
  assert.equal(await wide.count(), 1); assert.equal(await full.count(), 1);
  assert.equal(await header.evaluate(function (el) { return getComputedStyle(el).height; }), '33px');
  assert.equal(await panel.locator('[data-linear-window-title]').evaluate(function (el) { return getComputedStyle(el).fontSize; }), '11px');
  await page.waitForFunction(function () { return Array.from(document.querySelectorAll('#linear-panel > header button')).every(function (el) { return el.getAttribute('data-tip') && !el.hasAttribute('title'); }); });
  assert.equal(await full.evaluate(function (el) { return getComputedStyle(el).width; }), '24px');
  assert.equal(await panel.locator('.workbench-related-link').first().evaluate(function (el) { return getComputedStyle(el).borderRadius; }), '6px');
  assert.deepEqual(await panel.locator('.issue-comment').evaluate(function (el) { var s = getComputedStyle(el); return [s.paddingTop, s.paddingLeft, s.borderRadius]; }), ['10px', '12px', '9px']);
  assert.equal(await panel.locator('.issue-comment strong').getByText('Verified', { exact: true }).count(), 1);
  if (!process.env.CLAY_LINEAR_PATTERN_COMPILED) {
    for (var theme of ['clay-light', 'clay-dark']) {
      await page.evaluate(async function (theme) { (await import('/p/reuse/modules/theme.js')).applyTheme(theme); }, theme);
      await page.screenshot({ path: '/tmp/clay-linear-pattern-' + theme + '.png' });
    }
  }
  var original = await panel.boundingBox(); await wide.click(); await page.waitForTimeout(300);
  assert.ok((await panel.boundingBox()).width > original.width * 1.3);
  await full.click(); await page.waitForTimeout(300);
  assert.equal(await full.getAttribute('aria-pressed'), 'true');
  assert.equal(await panel.evaluate(function (el) { return getComputedStyle(el).borderRadius; }), '9px');
  var main = await page.locator('#main-panels').boundingBox(), expanded = await panel.boundingBox();
  assert.ok(Math.abs(expanded.x - main.x - 7) < 2 && Math.abs(expanded.width - main.width + 14) < 2);
  await full.click(); await page.waitForTimeout(300);
  assert.equal(await wide.getAttribute('aria-pressed'), 'true');
  await header.locator('.workbench-layout-toggle').click();
  await page.waitForFunction(function () { return document.getElementById('linear-panel').dataset.toolWindowId === 'tool-linear'; });
  assert.equal(await wide.isVisible(), false, 'docked width belongs to the divider');
  var handle = await header.locator('.split-pane-drag-space').boundingBox(), session = page.locator('#split-host > .split-pane:not(.split-pane-cached)').first(), target = await session.boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 8 }); await page.mouse.up(); await page.waitForTimeout(650);
  assert.ok((await panel.boundingBox()).x < (await session.boundingBox()).x);
  await full.click(); await page.waitForTimeout(300); await full.click(); await page.waitForTimeout(350);
  assert.equal(await full.getAttribute('aria-pressed'), 'false');
  assert.ok((await panel.boundingBox()).x < (await session.boundingBox()).x, 'fullscreen restores the dock position');
  await header.locator('.workbench-layout-toggle').click(); await page.waitForTimeout(300);
  await page.setViewportSize({ width: 760, height: 900 });
  assert.equal(await wide.isVisible(), false); assert.equal(await full.isVisible(), false);
  assert.equal(await header.locator('.workbench-layout-toggle').isVisible(), false);
  await page.keyboard.press('Escape'); await panel.waitFor({ state: 'hidden' });
  assert.deepEqual(errors, []);
});
