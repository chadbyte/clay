var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Clay and Mate popovers cap legacy sizes and pointer/keyboard resize at reading width plus gutters', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, reducedMotion: 'reduce' }), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  var base = 'http://127.0.0.1:' + info.port, endpoint = base + '/api/user/contextual-clay-geometry';
  await page.goto(base + '/fixture/login?to=alpha');
  var identities = [{ selector: '.icon-strip-brand', frame: '[data-canonical="true"]', text: 'Isolated canonical integration conversation.' },
    { selector: '.icon-strip-project-mate[data-mate-id="' + info.ordinaryMates[0].id + '"]', frame: '[data-mate-id="' + info.ordinaryMates[0].id + '"]', text: 'ORDINARY_MATE_0_PRIVATE_HISTORY' }];
  for (var identity of identities) {
    assert.equal((await page.request.put(endpoint, { headers: { 'X-Clay-Settings': '1' }, data: { left: 220, top: 60, width: 1500, height: 740 } })).status(), 200);
    await page.reload(); await page.waitForFunction(function () { var button = document.querySelector('.icon-strip-brand'); return button && !button.disabled; });
    await page.locator(identity.selector).click();
    var shell = page.locator('#contextual-clay'), frame = page.frameLocator('#contextual-clay iframe' + identity.frame);
    await frame.locator('#messages').getByText(identity.text, { exact: false }).waitFor(); await frame.locator('#input-wrapper:not([inert])').waitFor();
    await page.waitForFunction(function () { return Math.round(document.getElementById('contextual-clay').getBoundingClientRect().width) === 940; });
    assert.equal((await (await page.request.get(endpoint)).json()).geometry.width, 1500, 'Reading an oversized preference does not rewrite it');
    var input = frame.locator('#input'); await input.fill('Keep this draft while resizing.');
    var reading = await frame.locator('#input-wrapper').boundingBox(); assert.equal(Math.round(reading.width), 860, 'Existing reading measure stays unchanged');
    var handle = shell.locator('[data-clay-resize="e"]'), box = await handle.boundingBox();
    var shrink = page.waitForResponse(function (response) { return response.url() === endpoint && response.request().method() === 'PUT'; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(box.x - 160, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await shrink;
    assert.ok((await shell.boundingBox()).width < 800);
    box = await handle.boundingBox();
    var expand = page.waitForResponse(function (response) { return response.url() === endpoint && response.request().method() === 'PUT'; });
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2); await page.mouse.down(); await page.mouse.move(1700, box.y + box.height / 2, { steps: 5 }); await page.mouse.up(); await expand;
    assert.equal(Math.round((await shell.boundingBox()).width), 940);
    var keyboard = page.waitForResponse(function (response) { return response.url() === endpoint && response.request().method() === 'PUT'; });
    await handle.focus(); await page.keyboard.press('Shift+ArrowRight'); await keyboard;
    assert.equal(Math.round((await shell.boundingBox()).width), 940); assert.equal((await (await page.request.get(endpoint)).json()).geometry.width, 940);
    assert.equal(await input.inputValue(), 'Keep this draft while resizing.');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(function () { return document.getElementById('contextual-clay').getBoundingClientRect().width <= 374; });
    assert.equal(await handle.isVisible(), false);
    await page.setViewportSize({ width: 1800, height: 1000 });
    await page.waitForFunction(function () { return Math.round(document.getElementById('contextual-clay').getBoundingClientRect().width) === 940; });
    assert.equal(await input.inputValue(), 'Keep this draft while resizing.');
  }
  assert.deepEqual(errors, []);
});
