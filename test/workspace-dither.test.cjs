var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

async function appearance(page) {
  await page.locator('#user-account-trigger').click();
  await page.locator('.account-settings-button').click();
  await page.locator('#settings-page-nav [data-section="us-appearance"]').click();
}
async function saved(page) { await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor(); }
async function pixels(page, dpr, x, y) {
  var png = await page.screenshot({ clip: { x: x, y: y, width: 16, height: 16 } });
  var result = await page.evaluate(async function (base64) {
    var image = new Image(); image.src = 'data:image/png;base64,' + base64; await image.decode();
    var canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight;
    var ctx = canvas.getContext('2d'); ctx.drawImage(image, 0, 0);
    return { width: canvas.width, height: canvas.height, data: Array.from(ctx.getImageData(0, 0, canvas.width, canvas.height).data) };
  }, png.toString('base64'));
  assert.equal(result.width, 16 * dpr); assert.equal(result.height, 16 * dpr);
  for (var row = 0; row < result.height; row++) {
    for (var column = 0; column < result.width; column++) {
      var value = (Math.floor(column / (2 * dpr)) + Math.floor(row / (2 * dpr))) % 2 ? 255 : 0;
      var index = (row * result.width + column) * 4;
      assert.deepEqual(result.data.slice(index, index + 4), [value, value, value, 255], 'exact checker square at device pixel ' + column + ',' + row);
    }
  }
}

test('Classic Mac Dither saves, seeds, switches and renders exact two-CSS-pixel squares at DPR 1 and 2 (source)', { timeout: 45000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/server-settings-server.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve) { child.once('message', resolve); });
  var base = 'http://127.0.0.1:' + info.port, browser = await chromium.launch(); t.after(function () { return browser.close(); });
  for (var dpr of [1, 2]) {
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: dpr });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(); page.setDefaultTimeout(10000);
    await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/__fixture/admin'); await appearance(page);
    var dither = page.getByRole('radio', { name: 'Classic Mac Dither', exact: true });
    await dither.click(); await saved(page);
    assert.equal(await dither.getAttribute('aria-checked'), 'true');
    assert.equal(await dither.locator('.us-background-sample').evaluate(function (el) { return getComputedStyle(el).backgroundSize; }), '4px 4px');
    assert.equal((await (await page.request.get(base + '/api/user/appearance')).json()).background, 'classic-mac-dither');
    await page.route('**/api/user/appearance', function (route) { return route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: 'Hold hydration' } }) : route.continue(); });
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-workspace-background'), 'classic-mac-dither');
    await page.unroute('**/api/user/appearance');
    await page.evaluate(async function () { var image = new Image(); image.src = '/workspace-art/classic-mac-dither.svg'; await image.decode(); });
    for (var width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 800 });
      for (var scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForFunction(function (scheme) { return document.documentElement.classList.contains(scheme + '-theme'); }, scheme);
        assert.equal(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundSize; }), '4px 4px');
        await pixels(page, dpr, width === 1280 ? 1000 : 320, width === 1280 ? 600 : 64);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 }); await appearance(page);
    await page.getByRole('radio', { name: 'Clay Embossed', exact: true }).click(); await saved(page);
    assert.equal(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundSize; }), '240px 180px');
    await page.getByRole('radio', { name: 'Clay Gray', exact: true }).click(); await saved(page);
    assert.equal(await page.locator('#layout').evaluate(function (el) { return getComputedStyle(el).backgroundImage; }), 'none');
    await context.close();
  }
});
