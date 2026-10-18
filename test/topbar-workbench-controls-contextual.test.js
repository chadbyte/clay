// Contextual Clay window: the parent shell owns the top-bar workbench controls,
// the contextual iframe exposes no duplicate. Real authenticated app on the
// isolated integration fixture (providers fenced there); no PTY or browser is started.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var playwright = require('playwright');
var IDS = ['shared-browser-toggle-btn', 'terminal-toggle-btn', 'sticky-notes-toggle-btn'];

test('contextual Clay iframe shows no duplicate workbench controls and the parent keeps one set', { timeout: 120000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = ''; child.stdout.on('data', function (v) { output += v; }); child.stderr.on('data', function (v) { output += v; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 20000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 900 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(15000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login?to=alpha');
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.locator('.icon-strip-brand').click();
  var frame = page.frameLocator('#contextual-clay iframe');
  await frame.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  var context = page.frames().find(function (item) { return item.url().includes('contextual=1'); });
  var inside = await context.evaluate(function (ids) {
    var top = document.getElementById('top-bar'), title = document.querySelector('.title-bar-content');
    return { body: document.body.className, topHidden: !top || getComputedStyle(top).display === 'none', titleHidden: !title || getComputedStyle(title).display === 'none',
      visible: ids.filter(function (id) { var el = document.getElementById(id); return el && el.getClientRects().length > 0; }) };
  }, IDS);
  assert.ok(/pane-mode/.test(inside.body) && inside.topHidden && inside.titleHidden, 'contextual document keeps its chrome hidden: ' + JSON.stringify(inside));
  assert.deepEqual(inside.visible, [], 'no duplicate visible controls in the contextual iframe');
  var parent = await page.evaluate(function (ids) {
    return ids.map(function (id) {
      var el = document.getElementById(id); var r = el.getBoundingClientRect(); var hit = r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
      return { id: id, count: document.querySelectorAll('#' + id).length, inBar: !!el.closest('#top-bar .top-bar-actions'), shown: r.width > 0 };
    });
  }, IDS);
  parent.forEach(function (p) { assert.equal(p.count, 1); assert.ok(p.inBar, p.id + ' stays in the parent top bar'); });
  assert.ok(parent.filter(function (p) { return p.id !== 'shared-browser-toggle-btn'; }).every(function (p) { return p.shown; }), 'terminal and sticky visible in the parent');
  assert.deepEqual(errors, []);
});
