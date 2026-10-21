var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), chromium = require('playwright').chromium;
test('Sketch diagrams render after hard reload and older-history prepend instead of reverting to fenced source', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_SKETCH_HISTORY: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] }); child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve) { child.once('message', resolve); }), browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_SKETCH_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login'); var data = await (await page.request.get('http://127.0.0.1:' + info.port + '/fixture/state')).json();
  await page.locator('.session-item[data-session-id="' + data.standaloneId + '"]').first().click();
  async function host() {
    await page.waitForFunction(function (id) { return Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe')).some(function (frame) { var live = frame.clayPane && frame.clayPane.identity(); return live && live.ready && live.sessionId === id; }); }, data.standaloneId);
    return (await page.locator('#split-host > .split-pane:not(.split-pane-cached) iframe[data-session-id="' + data.standaloneId + '"]').elementHandle()).contentFrame();
  }
  for (var iteration = 0; iteration < 2; iteration++) {
    var frame = await host(); await frame.locator('.wireframe-card .wireframe-canvas img').waitFor();
    for (var pageIndex = 0; pageIndex < 6; pageIndex++) {
      if (await frame.locator('pre code.language-clay-sketch').filter({ hasText: 'Sketch 101' }).count()) break;
      await frame.evaluate(function () { var button = document.querySelector('.load-more-btn'); if (button) button.click(); });
      await frame.waitForFunction(function () { var button = document.querySelector('.load-more-btn'); return !button || !button.classList.contains('loading'); });
    }
    var older = frame.locator('.wireframe-card').filter({ hasText: 'Sketch 101' }); await older.locator('.wireframe-canvas img').waitFor();
    assert.equal(await older.locator('details').getAttribute('open'), null);
    assert.equal(await older.locator('code.language-clay-sketch').count(), 1, 'readable source stays available under the collapsed disclosure');
    if (!iteration) { var cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true }); await page.reload(); }
  }
  assert.deepEqual(errors, []);
});
