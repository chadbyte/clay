// Production-path check of the top-bar usage popover over the real chat and
// split panes: real app, real stylesheet, real store and dismissal handlers.
// Usage data is delivered through the production reply handler (no providers).
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
var COOKIE = { Cookie: 'relay_auth_user=pane-fixture-token' };

test('usage popovers sit above the real chat and split panes and dismiss by Escape or outside click', { timeout: 120000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var logs = ''; child.stdout.on('data', function (d) { logs += d; }); child.stderr.on('data', function (d) { logs += d; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Fixture startup timeout: ' + logs)); }, 20000);
    child.once('message', function (value) { clearTimeout(timer); resolve(value); });
    child.once('exit', function (code) { clearTimeout(timer); reject(new Error('Fixture exited ' + code + ': ' + logs)); });
  });
  var origin = 'http://127.0.0.1:' + info.port;
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  // The isolated server has no provider usage; keep the injected figures stable
  // by withholding only the shell's usage refresh requests. All else is forwarded.
  await page.routeWebSocket(/\/ws(\?|$)/, function (ws) {
    var server = ws.connectToServer();
    ws.onMessage(function (message) { if (String(message).indexOf('"vendor_usage_get"') < 0) server.send(message); });
    server.onMessage(function (message) { ws.send(message); });
  });
  await page.goto(origin + '/fixture/login');
  var fx = await (await fetch(origin + '/fixture/info', { headers: COOKIE })).json();
  await fetch(origin + '/fixture/switch?id=' + fx.driverId, { method: 'POST', headers: COOKIE });
  await page.waitForFunction(function () { return document.querySelectorAll('iframe.split-pane-frame').length === 2; }, null, { timeout: 20000 });

  await page.evaluate(async function () {
    var store = (await import('./modules/store.js')).store, usage = await import('./modules/vendor-usage-overview.js');
    usage.handleVendorUsageOverview({ slug: store.get('currentSlug'), userId: store.get('myUserId') || null, serverNowMs: Date.now(), vendors: [
      { vendor: 'claude', installed: true, windows: [], lastObservedAtMs: null },
      { vendor: 'codex', installed: true, lastObservedAtMs: Date.now() - 60000, windows: [{ kind: 'snapshot', limitId: 'codex', key: 'primary', windowDurationMins: 300, usedPercent: 42, resetsAt: Date.now() + 7200000, observedAtMs: Date.now() - 60000, origin: 'live' }] }] });
  });
  var chip = page.locator('#top-bar .vendor-usage-chip[data-vendor="codex"]');
  await chip.waitFor({ timeout: 10000 });

  async function hit(selector) {
    return page.evaluate(function (sel) {
      var pop = document.querySelector(sel), r = pop.getBoundingClientRect(), bar = document.getElementById('top-bar').getBoundingClientRect();
      var el = document.elementFromPoint(r.left + 24, Math.max(r.top, bar.bottom + 4) + 6);
      return { visible: r.height > 0, overBelow: r.bottom > bar.bottom, inside: !!el && pop.contains(el), hit: el && (el.id || el.className || el.tagName) };
    }, selector);
  }
  async function open() { return page.evaluate(async function () { return (await import('./modules/store.js')).store.get('vendorUsageOpen'); }); }

  await chip.click();
  assert.equal(await open(), 'codex');
  await page.waitForSelector('.vendor-usage-popover', { timeout: 5000 });
  var single = await hit('.vendor-usage-popover'); assert.ok(single.visible && single.overBelow, 'popover overlaps the work area');
  assert.equal(single.inside, true, 'single popover above chat/split, hit ' + single.hit);
  await page.keyboard.press('Escape'); assert.equal(await open(), null, 'Escape dismisses');

  await chip.click(); assert.equal(await open(), 'codex');
  await page.mouse.click(500, 16); assert.equal(await open(), null, 'outside click on the shell top bar dismisses');
  await page.keyboard.press('Escape'); // the bar's centre also opens the command palette

  await page.locator('#top-bar .vendor-usage-list-chip').click();
  assert.equal(await open(), '__all');
  var list = await hit('.vendor-usage-list-popover'); assert.equal(list.inside, true, 'all-vendors popover above chat/split, hit ' + list.hit);
  // A click that lands inside a pane iframe is outside the group but never reaches the shell document.
  var frame = page.frames().filter(function (f) { return f.url().indexOf('session=' + fx.driverId) >= 0; })[0];
  await frame.locator('body').click({ position: { x: 20, y: 400 } });
  var afterFrameClick = await open();
  t.diagnostic('open popover after a click inside a pane iframe: ' + afterFrameClick);
  assert.equal(afterFrameClick, null, 'clicking inside a split pane dismisses the popover');
  assert.deepEqual(errors, []);
});
