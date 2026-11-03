var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

async function appearance(page) {
  await page.locator('#user-account-trigger').click();
  await page.locator('.account-settings-button').click();
  await page.locator('#settings-page-nav [data-section="us-appearance"]').click();
}
async function saved(page) { await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor(); }
async function paint(page) {
  return page.locator('#layout').evaluate(function (el) {
    var style = getComputedStyle(el); return { image: style.backgroundImage, size: style.backgroundSize, repeat: style.backgroundRepeat, position: style.backgroundPosition };
  });
}

[{ id: 'clay-memphis', name: 'Clay Memphis' }, { id: 'clay-clouds', name: 'Clay Clouds' }, { id: 'clay-mates', name: 'Clay Mates' }, { id: 'clay-meadow', name: 'Clay Meadow' }, { id: 'clay-silicon', name: 'Clay Silicon' }, { id: 'clay-aqua', name: 'Clay Aqua' }, { id: 'clay-light', name: 'Clay Light' }, { id: 'clay-galaxy', name: 'Clay Galaxy' }, { id: 'clay-cove', name: 'Clay Cove' }].forEach(function (picture) {
  test(picture.name + ' source saves, seeds centered responsive cover and switches to and from tiles', { timeout: 30000 }, async function (t) {
    var child = cp.fork(path.join(__dirname, 'fixtures/server-settings-server.js'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve) { child.once('message', resolve); });
    var base = 'http://127.0.0.1:' + info.port, browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(); page.setDefaultTimeout(10000);
    await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(base + '/__fixture/admin'); await appearance(page);
    await page.getByRole('radio', { name: 'Classic Mac Dither', exact: true }).click(); await saved(page);
    assert.equal((await paint(page)).size, '4px 4px');
    var choice = page.getByRole('radio', { name: picture.name, exact: true });
    await choice.click(); await saved(page);
    assert.equal(await choice.getAttribute('aria-checked'), 'true');
    assert.equal(await page.getByRole('radio', { name: 'Workshop', exact: true }).count(), 0);
    var savedPicture = await (await page.request.get(base + '/api/user/appearance')).json();
    assert.equal(savedPicture.background, picture.id); assert.equal(savedPicture.backgroundColor, 'clay-gray');
    var dimensions = await choice.locator('.us-background-sample').evaluate(async function (el) {
      var image = new Image(); image.src = getComputedStyle(el).backgroundImage.slice(5, -2); await image.decode();
      return [image.naturalWidth, image.naturalHeight];
    });
    assert.deepEqual(dimensions, [1672, 941]);
    await page.route('**/api/user/appearance', function (route) { return route.request().method() === 'GET' ? route.fulfill({ status: 503, json: { error: 'Hold hydration' } }) : route.continue(); });
    await page.reload();
    assert.equal(await page.locator('html').getAttribute('data-workspace-background'), picture.id);
    for (var width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 844 });
      for (var scheme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: scheme });
        await page.waitForFunction(function (scheme) { return document.documentElement.classList.contains(scheme + '-theme'); }, scheme);
        var actual = await paint(page);
        assert.ok(actual.image.includes(picture.id + '.webp')); assert.equal(actual.size, 'cover');
        assert.equal(actual.repeat, 'no-repeat'); assert.equal(actual.position, '50% 50%');
      }
    }
    await page.unroute('**/api/user/appearance'); await page.setViewportSize({ width: 1280, height: 800 });
    await appearance(page); assert.equal(await choice.getAttribute('aria-checked'), 'true');
    await page.getByRole('radio', { name: 'Clay Embossed', exact: true }).click(); await saved(page);
    assert.equal((await paint(page)).size, '240px 180px'); assert.equal((await paint(page)).repeat, 'repeat');
    await choice.click(); await saved(page); assert.equal((await paint(page)).size, 'cover');
    await page.getByRole('radio', { name: 'Classic Mac Dither', exact: true }).click(); await saved(page);
    assert.equal((await paint(page)).size, '4px 4px'); assert.equal((await paint(page)).repeat, 'repeat');
    await choice.click(); await saved(page);
    await page.getByRole('radio', { name: 'Clay Gray', exact: true }).click(); await saved(page);
    assert.equal((await paint(page)).image, 'none');
  });
});
