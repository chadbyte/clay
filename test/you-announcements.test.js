var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');

function fixture(reduced) {
  var data = { youActivity: {} };
  var timers = new Map();
  var elements = new Map();
  var counter = 0;
  function node() {
    var classes = new Set();
    return { textContent: '', scrollWidth: 10, classList: {
      add: function (name) { classes.add(name); }, remove: function (name) { classes.delete(name); },
      contains: function (name) { return classes.has(name); }, toggle: function () {},
    }, setAttribute: function () {}, replaceChildren: function () {}, appendChild: function () {}, append: function () {}, addEventListener: function () {}, matches: function () { return false; } };
  }
  function el(id) { if (!elements.has(id)) elements.set(id, node()); return elements.get(id); }
  var context = {
    store: { get: function (key) { return data[key]; }, set: function (values) { Object.assign(data, values); } },
    document: { getElementById: el, createElement: node },
    window: { matchMedia: function () { return { matches: !!reduced }; } },
    setTimeout: function (fn) { var id = ++counter; timers.set(id, fn); return id; },
    clearTimeout: function (id) { timers.delete(id); }, sendYou: function () { return 'request'; },
    registerTooltip: function () {}, openYou: function () {}, relativeTime: function () { return 'now'; },
  };
  vm.createContext(context);
  var source = fs.readFileSync('lib/public/modules/you-activity.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/export function/g, 'function');
  vm.runInContext(source, context);
  return { data: data, el: el, context: context, tick: function () { var first = timers.entries().next().value; assert.ok(first); timers.delete(first[0]); first[1](); }, drain: function () { var count = 0; while (timers.size && count++ < 500) this.tick(); assert.equal(timers.size, 0); } };
}
test('old activity stays silent; a new save types, queues subsequent saves, and returns to idle without changing branding', function () {
  var f = fixture(false);
  f.data.youActivity.requestId = 'history';
  f.context.handleYouActivity({ operation: 'you_activity', requestId: 'history', ok: true, result: { items: [], nextOffset: null } });
  assert.equal(f.el('you-activity').classList.contains('announcing'), false);
  var notice = { type: 'you_changed', activity: { id: 'new', summary: 'Prefers concise reviews.' } };
  f.context.handleYouActivity(notice);
  assert.equal(f.el('you-activity').classList.contains('announcing'), true);
  assert.equal(f.el('you-activity-text').textContent, 'Cl');
  f.context.handleYouActivity(notice);
  assert.equal((f.data.youActivity.queue || []).length, 0, 'duplicate notifications are silent');
  f.context.handleYouActivity({ type: 'you_changed', activity: { id: 'next', summary: 'Another preference.' } });
  assert.equal(f.data.youActivity.queue.length, 1);
  f.drain();
  assert.equal(f.el('you-activity').classList.contains('announcing'), false);
  assert.equal(f.el('you-activity-text').textContent, 'Clay remembered: Another preference.');
});
test('reduced motion presents the complete announcement immediately', function () {
  var f = fixture(true);
  f.context.handleYouActivity({ type: 'you_changed', activity: { id: 'new', summary: 'Prefers concise reviews.' } });
  assert.equal(f.el('you-activity-text').textContent, 'Clay remembered: Prefers concise reviews.');
  f.drain();
  assert.equal(f.data.youActivity.active, false);
});
test('owner deletion history is explicit, silent, and returns to the Me list', function () {
  var f = fixture(false);
  assert.equal(f.context.describe({ action: 'delete', title: 'Old preference' }), 'You deleted a memory from Me.');
  f.context.handleYouActivity({ type: 'you_changed', activity: { id: 'deleted', ref: 'you:old', deleted: true, title: 'Old preference' } });
  assert.equal(f.el('you-activity').classList.contains('announcing'), false);
  assert.equal(f.data.youActivity.requestId, 'request');
});

function menuBounds() {
  return ['.top-bar-brand-link', '.top-bar-star', '#cmd-palette-btn', '.top-bar-actions', '#top-bar'].map(function (selector) {
    var element = document.querySelector(selector), rect = element.getBoundingClientRect();
    return { selector: selector, x: rect.x, y: rect.y, width: rect.width, height: rect.height, display: getComputedStyle(element).display };
  });
}

['source', 'built'].forEach(function (runtime) {
  test('persisted memory speech overlay preserves menu geometry and history: ' + runtime, { timeout: 90000 }, async function (t) {
    var cp = require('node:child_process'), path = require('node:path');
    var child = cp.fork(path.join(__dirname, 'fixtures/you-activity-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
    var base = 'http://127.0.0.1:' + info.port;
    async function save(text, count) {
      var response = await fetch(base + '/__memory-fixture/save?count=' + (count || 1) + '&text=' + encodeURIComponent(text),
        { method: 'POST', headers: { Cookie: 'relay_auth_user=fixture-owner-token' } });
      assert.equal(response.status, 200); return response.json();
    }
    await save('Earlier disposable preference.', 24);
    var chromium = require('playwright').chromium, browser = await chromium.launch();
    t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'light', reducedMotion: 'reduce' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(), notices = [], errors = []; page.setDefaultTimeout(10000);
    await page.route('**/api/github-stars', function (route) { return route.fulfill({ json: { stars: 408 } }); });
    page.on('pageerror', function (error) { errors.push(error.message); });
    page.on('websocket', function (socket) { socket.on('framereceived', function (event) {
      var message; try { message = JSON.parse(String(event.payload)); } catch (error) { return; }
      if (message.type === 'you_changed') notices.push(message);
    }); });
    if (runtime === 'source') {
      await require('./fixtures/source-module-runtime.cjs').install(page);
      await page.route(/\/pane-assets\/style-[^/]+\.css(?:\?.*)?$/, function (route) {
        return route.fulfill({ contentType: 'text/css', body: '@import "../style.css";' });
      });
    }
    await page.goto(base + '/fixture/login?to=alpha');
    await page.waitForFunction(function () { return document.querySelectorAll('.you-activity-entry').length === 20; });
    await page.locator('#github-star-count').waitFor({ state: 'visible' });
    await page.evaluate(function () { return document.fonts.ready; });
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
    assert.equal(await page.locator('#you-activity').isVisible(), false, 'old saved activity stays silent');
    await page.clock.install();
    var before = await page.evaluate(menuBounds);
    var persisted = await save('Prefers concise review summaries.');
    await page.locator('#you-activity-toggle').waitFor({ state: 'visible' });
    assert.equal(await page.locator('#you-activity-text').textContent(), 'Clay remembered: Prefers concise review summaries.');
    assert.ok(notices.some(function (notice) { return notice.activity.id === persisted.items[0].id; }), 'announcement arrived through production WS after persistence');
    assert.deepEqual(await page.evaluate(menuBounds), before);
    assert.deepEqual(await page.locator('#you-activity').evaluate(function (element) {
      var style = getComputedStyle(element); return [style.position, style.zIndex, style.pointerEvents];
    }), ['absolute', '50', 'none']);
    assert.equal(await page.locator('#you-activity-toggle').getAttribute('title'), null);
    assert.equal(await page.locator('#you-activity-toggle').getAttribute('data-tip'), 'Clay remembered: Prefers concise review summaries.');
    await page.locator('#you-activity-toggle').hover();
    await page.clock.runFor(8000);
    assert.equal(await page.locator('#you-activity').isVisible(), true, 'pointer hover pauses expiry');
    await save('Keeps the next saved change queued.');
    await page.locator('#you-activity-toggle').click();
    await page.locator('#you-activity-more').waitFor({ state: 'visible' });
    await page.locator('#you-activity-more').click();
    await page.waitForFunction(function () { return document.querySelectorAll('.you-activity-entry').length >= 26; });
    assert.deepEqual(await page.evaluate(menuBounds), before, 'history opening/loading leaves every menu neighbor unchanged');
    var history = await page.locator('#you-activity-history').boundingBox();
    assert.ok(history.y >= 32 && history.x >= 0 && history.x + history.width <= 1280);
    await page.locator('#you-activity-close').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#you-activity-close').evaluate(function (element) {
      var rect = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2));
    }), true, 'history controls remain above the workspace/glass and hit-testable');
    await page.clock.runFor(9000);
    assert.equal(await page.locator('#you-activity').isVisible(), true, 'reading history pauses expiry');
    await page.locator('#you-activity-close').press('Escape');
    assert.equal(await page.locator('#you-activity-history').isVisible(), false);
    assert.equal(await page.locator('#you-activity-toggle').evaluate(function (element) { return element === document.activeElement; }), true);
    await page.clock.runFor(8000);
    assert.equal(await page.locator('#you-activity').isVisible(), true, 'keyboard focus pauses expiry');
    await page.locator('#you-activity-toggle').click();
    await page.locator('#top-bar').click({ position: { x: 1277, y: 2 } });
    assert.equal(await page.locator('#you-activity-history').isVisible(), false, 'outside click closes history');
    await page.locator('#server-settings-btn').focus(); await page.mouse.move(1000, 700);
    await page.clock.runFor(1100);
    assert.equal(await page.locator('#you-activity-text').textContent(), 'Clay remembered: Keeps the next saved change queued.');
    await page.clock.runFor(7000);
    assert.equal(await page.locator('#you-activity').isVisible(), false);
    assert.deepEqual(await page.evaluate(menuBounds), before, 'expiry restores the same geometry');
    for (var mode of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: mode });
      for (var width of [1280, 820, 390]) {
        await page.setViewportSize({ width: width, height: 800 });
        await page.clock.runFor(1000);
        await new Promise(function (resolve) { setTimeout(resolve, 200); });
        var bounds = await page.evaluate(menuBounds);
        await save(('Keeps detailed review notes readable. ').repeat(13));
        await page.waitForFunction(function () { return document.getElementById('you-activity-text').textContent.length > 400; });
        assert.deepEqual(await page.evaluate(menuBounds), bounds);
        assert.equal(await page.evaluate(function () { return document.documentElement.scrollWidth <= innerWidth; }), true);
        assert.equal(await page.locator('#you-activity').isVisible(), width > 768, 'existing mobile menu visibility is retained');
        if (width > 768) {
          var bubble = await page.locator('#you-activity-toggle').boundingBox();
          assert.ok(bubble.x >= 0 && bubble.x + bubble.width <= width);
          var search = await page.locator('#cmd-palette-btn').boundingBox();
          assert.ok(bubble.x + bubble.width <= search.x - 4, 'overlay does not cover the search control');
          await page.locator('#you-activity-toggle').click();
          await page.locator('#you-activity-close').press('Escape');
          await page.locator('#server-settings-btn').focus();
        }
        await page.mouse.move(width - 2, 700); await page.clock.runFor(7100);
      }
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto(base + '/p/' + info.sourceSlug + '/');
    await page.waitForFunction(function () { return document.querySelector('.you-activity-entry'); });
    await page.evaluate(function () { return document.fonts.ready; });
    await new Promise(function (resolve) { setTimeout(resolve, 500); });
    var native = await page.evaluate(menuBounds);
    await save('Preserves the native Clay menu too.');
    await page.locator('#you-activity-toggle').waitFor({ state: 'visible' });
    assert.deepEqual(await page.evaluate(menuBounds), native);
    assert.equal((await fetch(base + '/__memory-fixture/save', { method: 'POST', headers: { Cookie: 'relay_auth_user=fixture-foreign-token' } })).status, 403);
    assert.deepEqual(errors, []);
  });
});
