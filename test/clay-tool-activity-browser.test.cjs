var test = require('node:test');
var assert = require('node:assert/strict');
var path = require('node:path');
var childProcess = require('node:child_process');
var chromium = require('playwright').chromium;

test('production Clay activity rows preserve identity, truthful results, raw disclosure and replay across surfaces', { timeout: 60000 }, async function () {
  var server = childProcess.fork(path.join(__dirname, 'fixtures/clay-tool-activity-browser-server.cjs'), [], { silent: true });
  var browser;
  try {
    var url = await new Promise(function (resolve, reject) { server.once('message', function (message) { resolve(message.url); }); server.once('error', reject); });
    browser = await chromium.launch({ headless: true });
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    var errors = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    for (var mode of ['desktop', 'narrow', 'dark', 'pane']) {
      await page.setViewportSize((mode === 'narrow' || mode === 'dark') ? { width: 390, height: 844 } : { width: 1280, height: 800 });
      await page.goto(url + (mode === 'pane' ? '/?pane=1&session=101' : '/'));
      await page.waitForFunction(function () { return typeof window.runClayActivityChecks === 'function'; });
      if (mode === 'dark') await page.locator('#activity-dark').click();
      var report = await page.evaluate(function () { return window.runClayActivityChecks(); });
      assert.equal(report.status, 'passed');
      assert.equal(report.checks, 128);
      assert.deepEqual(report.errors, []);
      console.log(mode + ' ' + JSON.stringify(report));
    }
    var terminal = await page.evaluate(function () { return window.runClayTerminalChecks(); });
    assert.deepEqual(terminal, { cases: 7, activeReplay: true, errors: [] });
    console.log('terminal ' + JSON.stringify(terminal));
    var large = await page.evaluate(function () {
      window.showClayActivityFixture('project', false);
      // Reuse an exact existing call: full opaque evidence must survive the compact projection.
      var raw = 'Synthetic large result ' + 'x'.repeat(1024 * 1024) + ' END_OF_COMPLETE_RESULT';
      return import('/modules/app-message-router.js').then(function (router) {
        router.processMessage({ type: 'tool_result', id: 'log', content: raw, is_error: false });
        var item = document.querySelector('[data-tool-id="log"]');
        var before = item.querySelectorAll('pre').length;
        item.querySelector('.tool-header').click();
        return { before: before, output: item.querySelector('.clay-tool-evidence pre:last-child').textContent === raw, phase: item.dataset.activityPhase };
      });
    });
    assert.deepEqual(large, { before: 0, output: true, phase: 'returned' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(function () { window.showClayActivityFixture('clay', false); });
    var header = page.locator('#messages .tool-group-header').first();
    await header.focus();
    await page.keyboard.press('Enter');
    var row = page.locator('[data-tool-id="observation"] .tool-header');
    await row.focus();
    await page.keyboard.press('Space');
    assert.equal(await row.getAttribute('aria-expanded'), 'true');
    assert.ok((await page.locator('[data-tool-id="observation"] .clay-tool-evidence').innerText()).includes('Synthetic private evidence'));
    await row.click();
    assert.equal(await row.getAttribute('aria-expanded'), 'false');
    assert.deepEqual(errors, []);
  } finally {
    if (browser) await browser.close();
    var exited = new Promise(function (resolve) { server.once('exit', resolve); });
    server.kill('SIGTERM');
    await exited;
  }
});
