// Production render and CSS of the Worker update notice in the real app
// (HTTP, WebSocket, split panes; providers and Git commits fenced by the fixture).
// Outgoing pair_result_* messages are captured and dropped, so nothing is
// retried or dismissed on the server. Screenshots go to WBX_SHOT_DIR when set.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
var chromium = require('playwright').chromium;
var offline = require('./fixtures/offline-cdn-routes.cjs');
var COOKIE = { Cookie: 'relay_auth_user=pane-fixture-token' };
var LONG = 'A'.repeat(400) + ' ' + 'verylongunbrokenidentifier_'.repeat(20);

function items() {
  return [
    { id: 'one', state: 'uncertain', message: LONG, response: 'Completed result text\n' + LONG, hasCompletedResult: true, canRetry: true, confirmDuplicate: true, revision: 'rev-one' },
    { id: 'two', state: 'pending', message: 'Waiting for the Driver to accept the result.', response: 'second result', hasCompletedResult: true, canRetry: true, confirmDuplicate: false, revision: 'rev-two' },
    { id: 'three', state: 'blocked', message: 'Blocked until the Driver starts a turn.', hasCompletedResult: false, revision: 'rev-three' }
  ];
}

test('Worker update notice: compact collapsed state, keyboard disclosure, dismiss, retry and narrow split', { timeout: 120000 }, async function (t) {
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
  var shots = process.env.WBX_SHOT_DIR; if (shots) fs.mkdirSync(shots, { recursive: true });
  var errors = [], external = [];

  async function open(width, split) {
    var context = await browser.newContext({ viewport: { width: width, height: 800 }, reducedMotion: 'reduce' });
    await offline.install(context);
    context.on('request', function (request) { if (/^https?:/.test(request.url()) && !/^https?:\/\/(127\.0\.0\.1|localhost)[:/]/.test(request.url())) external.push(request.url()); });
    var page = await context.newPage();
    page.on('pageerror', function (error) { errors.push(error.message); });
    await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(origin + '/fixture/login');
    var fx = await (await fetch(origin + '/fixture/info', { headers: COOKIE })).json();
    await fetch(origin + '/fixture/switch?id=' + (split ? fx.driverId : fx.standaloneId), { method: 'POST', headers: COOKIE });
    if (split) {
      await page.waitForFunction(function () { return document.querySelectorAll('iframe.split-pane-frame').length === 2; }, null, { timeout: 20000 });
      await page.waitForFunction(function () { return Array.from(document.querySelectorAll('iframe.split-pane-frame')).every(function (f) { return f.contentDocument && f.contentDocument.body && f.contentDocument.body.classList.contains('pane-mode') && f.contentDocument.getElementById('messages'); }); }, null, { timeout: 20000 });
    }
    await page.waitForFunction(function () { return !!document.getElementById('messages') && window.lucide; }, null, { timeout: 20000 });
    await page.waitForFunction(function () {
      var frames = Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached) iframe'));
      return frames.length && frames.every(function (frame) { var live = frame.clayPane && frame.clayPane.identity(); return live && live.ready; });
    });
    if (!split) return (await page.locator('#split-host .split-pane:not(.split-pane-cached) iframe').elementHandle()).contentFrame();
    return page;
  }
  // Runs in a document (page or pane frame): drive the production module and capture sends.
  function setup(target) {
    return target.evaluate(async function () {
      var store = (await import('./modules/store.js')).store, mod = await import('./modules/pair-result-status.js'), ref = await import('./modules/ws-ref.js');
      var ws = ref.getWs(); window.__sent = []; var original = ws.send.bind(ws);
      ws.send = function (data) { var msg = JSON.parse(data); if (/^pair_result_/.test(msg.type)) { window.__sent.push(msg); return; } return original(data); };
      window.__mod = mod; window.__sid = store.get('activeSessionId'); return window.__sid;
    });
  }
  async function show(target, list) {
    await target.evaluate(function (list) { window.__mod.handlePairResultStatus({ sessionId: window.__sid, items: list }); }, list);
    if (list.length) await target.waitForFunction(function () { return document.querySelectorAll('#pair-result-status svg').length >= 3; }, null, { timeout: 10000 });
  }
  function metrics(target) {
    return target.evaluate(function () {
      var s = document.getElementById('pair-result-status'), r = s.getBoundingClientRect(), cs = getComputedStyle(s), app = document.getElementById('messages').getBoundingClientRect();
      var tray = s.querySelector('.pair-result-status-tray'), tr = tray.getBoundingClientRect(), bar = s.querySelector('.pair-result-status-bar').getBoundingClientRect();
      var bg = cs.backgroundColor.match(/[\d.]+/g).map(Number);
      return { h: r.height, w: r.width, left: r.left, right: r.right, messagesLeft: app.left, vw: window.innerWidth, container: document.getElementById('messages').parentElement.getBoundingClientRect().width,
        alpha: bg.length > 3 ? bg[3] : 1, borders: [cs.borderTopWidth, cs.borderRightWidth, cs.borderBottomWidth, cs.borderLeftWidth], radius: cs.borderTopLeftRadius,
        trayHidden: tray.hidden, trayTop: tr.top, barBottom: bar.bottom, trayH: tr.height, trayOverflowX: tray.scrollWidth - tray.clientWidth, sectionBottom: r.bottom,
        svgs: s.querySelectorAll('svg').length, live: s.querySelector('[role="status"]').textContent, nestedInteractive: s.querySelectorAll('button button, summary button, button summary, button a').length };
    });
  }
  async function theme(surface, mode) {
    var page = surface.page();
    // Use the product's own toggle; the persisted preference lives in the isolated fixture only.
    await page.evaluate(async function (mode) {
      if (!document.documentElement.classList.contains(mode + '-theme')) (await import('./modules/theme.js')).toggleDarkMode();
    }, mode);
    await page.waitForFunction(function (mode) { return document.documentElement.classList.contains(mode + '-theme'); }, mode);
  }

  // ---- Desktop single pending notice ---------------------------------------
  var page = await open(1280, false); await setup(page); await theme(page, 'dark');
  await show(page, [items()[1]]);
  var m = await metrics(page);
  assert.ok(m.h <= 34 && m.h >= 28, 'collapsed height is one compact row: ' + m.h);
  assert.ok(m.w < 300, 'content width, not full width: ' + m.w);
  assert.ok(Math.abs(m.left - m.messagesLeft - 16) < 1, 'aligned to the 16px conversation inset');
  assert.ok(m.alpha <= 0.06, 'no broad fill: ' + m.alpha);
  assert.equal(new Set(m.borders).size, 1, 'no left accent rail');
  assert.equal(m.live, 'Worker update'); assert.equal(m.trayHidden, true); assert.equal(m.nestedInteractive, 0);
  assert.ok(m.svgs >= 3, 'Lucide status, chevron and dismiss icons render');
  var tone = await page.evaluate(function () { return getComputedStyle(document.querySelector('.pair-result-status-icon')).color; });
  if (shots) { await page.page().screenshot({ path: path.join(shots, 'notice-dark-collapsed.png'), clip: { x: 300, y: 0, width: 700, height: 160 } }); }

  // ---- Multiple updates, restrained attention only for blocked/uncertain ------
  await show(page, items());
  m = await metrics(page);
  assert.equal(m.live, '3 Worker updates');
  var attention = await page.evaluate(function () { return getComputedStyle(document.querySelector('.pair-result-status-icon')).color; });
  assert.notEqual(attention, tone, 'uncertain/blocked icon uses the attention token, pending does not');

  // ---- Keyboard disclosure ----------------------------------------------------
  await page.locator('.pair-result-status-toggle').focus();
  await page.page().keyboard.press('Enter');
  m = await metrics(page);
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'true');
  assert.equal(m.trayHidden, false); assert.ok(m.trayTop >= m.barBottom - 0.5, 'tray anchored beneath the notice in flow');
  assert.ok(m.trayH <= 361, 'tray height bounded: ' + m.trayH); assert.equal(m.trayOverflowX, 0, 'long unbroken text wraps');
  assert.ok(m.w <= 640.5 && m.right - m.messagesLeft <= m.container - 16 + 1, 'expanded width bounded by the container');
  assert.equal(await page.evaluate(function () { return document.activeElement.className; }), 'pair-result-status-toggle');
  if (shots) { await page.page().screenshot({ path: path.join(shots, 'notice-dark-expanded.png'), clip: { x: 300, y: 0, width: 760, height: 520 } }); }
  await theme(page, 'light');
  if (shots) { await page.page().screenshot({ path: path.join(shots, 'notice-light-expanded.png'), clip: { x: 300, y: 0, width: 760, height: 520 } }); }
  await page.page().keyboard.press('Escape');
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'false');
  assert.equal(await page.evaluate(function () { return document.activeElement.className; }), 'pair-result-status-toggle', 'Escape returns focus to the toggle');
  if (shots) { await page.page().screenshot({ path: path.join(shots, 'notice-light-collapsed.png'), clip: { x: 300, y: 0, width: 700, height: 160 } }); }
  await page.page().keyboard.press('Space');
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'true', 'Space also toggles');

  // ---- Server refresh keeps the disclosure open; retained text; guards -------------
  await show(page, items());
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'true');
  assert.match(await page.locator('.pair-result-status-card pre').first().textContent(), /Completed result text/);

  // ---- Focused Review and open state: kept on same-session updates, reset on clear ------------
  await page.locator('.pair-result-status-toggle').focus();
  await show(page, items().map(function (item) { return Object.assign({}, item, { revision: item.revision + '-b', message: 'Updated: ' + item.message }); }));
  assert.equal(await page.evaluate(function () { return document.activeElement.className; }), 'pair-result-status-toggle', 'focused Review keeps focus across a server update');
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'true', 'open state kept on a same-session update');
  assert.equal(await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('pairResultTrayOpen'); }), true, 'open state lives in the store');
  assert.equal(await page.evaluate(function () { return window.__mod.handlePairResultStatus({ sessionId: window.__sid + 999, items: [] }); }), false);
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'true', 'a foreign session update is ignored');
  await page.evaluate(function () { window.__mod.clearPairResultStatus(); });
  assert.equal(await page.locator('#pair-result-status').count(), 0);
  assert.equal(await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('pairResultTrayOpen'); }), false, 'clear (session switch) resets the open state');
  await show(page, items());
  assert.equal(await page.locator('.pair-result-status-toggle').getAttribute('aria-expanded'), 'false', 'a new notice after clear starts collapsed');
  assert.equal(await page.locator('.pair-result-status-tray').isHidden(), true);

  // ---- Dismiss: separate button, exact revisions, server-authoritative -----------------
  await page.locator('.pair-result-status-dismiss').click();
  var sent = await page.evaluate(function () { return window.__sent.map(function (x) { return [x.type, x.id, x.revision]; }); });
  assert.deepEqual(sent, [['pair_result_dismiss', 'one', 'rev-one'], ['pair_result_dismiss', 'two', 'rev-two'], ['pair_result_dismiss', 'three', 'rev-three']]);
  assert.equal(await page.locator('#pair-result-status').count(), 1, 'notice stays until the server clears it');
  await show(page, []);
  assert.equal(await page.locator('#pair-result-status').count(), 0);

  // ---- Retry: duplicate-risk item needs the custom confirmation; plain retry does not ------
  await show(page, items());
  await page.locator('.pair-result-status-toggle').click();
  await page.evaluate(function () { window.__sent = []; });
  await page.locator('.pair-result-status-retry').nth(1).click();
  assert.deepEqual(await page.evaluate(function () { return window.__sent.map(function (x) { return [x.type, x.id, x.confirmDuplicate]; }); }), [['pair_result_retry', 'two', false]]);
  await page.evaluate(function () { window.__sent = []; });
  await page.locator('.pair-result-status-retry').nth(0).click();
  assert.equal(await page.evaluate(function () { return window.__sent.length; }), 0, 'nothing is sent before confirmation');
  var modalOnTop = await page.evaluate(function () { var modal = document.getElementById('confirm-modal'); var r = document.querySelector('.confirm-dialog').getBoundingClientRect(); var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !modal.classList.contains('hidden') && modal.contains(hit); });
  assert.ok(modalOnTop, 'custom confirmation sits above the notice');
  await page.locator('#confirm-ok').click();
  assert.deepEqual(await page.evaluate(function () { return window.__sent.map(function (x) { return [x.type, x.id, x.confirmDuplicate]; }); }), [['pair_result_retry', 'one', true]]);
  // Stale: the session changes while the confirmation is open.
  await page.evaluate(function () { window.__sent = []; });
  await page.locator('.pair-result-status-retry').nth(0).click();
  await page.evaluate(async function () { window.__mod.clearPairResultStatus(); });
  await page.locator('#confirm-ok').click();
  assert.equal(await page.evaluate(function () { return window.__sent.length; }), 0, 'stale source cannot send');
  await page.page().close();

  // ---- Narrow viewport ------------------------------------------------------------
  var narrow = await open(390, false); await setup(narrow); await show(narrow, items());
  m = await metrics(narrow);
  assert.ok(m.left >= m.messagesLeft + 8 - 1 && m.right <= m.vw - 8 + 1, 'narrow inset is 8px');
  assert.ok(m.h <= 38, 'narrow collapsed height with touch targets: ' + m.h);
  await narrow.locator('.pair-result-status-toggle').click();
  m = await metrics(narrow);
  assert.equal(m.trayOverflowX, 0); assert.ok(m.right <= m.vw - 8 + 1);
  var targets = await narrow.evaluate(function () { return Array.from(document.querySelectorAll('.pair-result-status-toggle, .pair-result-status-dismiss')).map(function (b) { var r = b.getBoundingClientRect(); return Math.min(r.width, r.height); }); });
  targets.forEach(function (size) { assert.ok(size >= 34, 'touch target ' + size); });
  if (shots) await narrow.page().screenshot({ path: path.join(shots, 'notice-narrow-expanded.png'), clip: { x: 0, y: 0, width: 390, height: 520 } });
  await narrow.page().close();

  // ---- Split pane at a narrow width (notice inside a pane document) ---------------------
  var split = await open(800, true);
  var pane = split.frames().find(function (f) { return f !== split.mainFrame() && /pane=1|paneMode|\/p\//.test(f.url()); }) || split.frames()[1];
  await setup(pane); await show(pane, items());
  var paneMetrics = await metrics(pane);
  assert.ok(paneMetrics.left >= paneMetrics.messagesLeft + 8 - 1 && paneMetrics.right <= paneMetrics.vw - 8 + 1, 'notice fits the narrow pane: ' + JSON.stringify(paneMetrics));
  assert.ok(paneMetrics.h <= 38);
  await pane.locator('.pair-result-status-toggle').click();
  paneMetrics = await metrics(pane);
  assert.equal(paneMetrics.trayOverflowX, 0); assert.ok(paneMetrics.right <= paneMetrics.vw - 8 + 1);
  if (shots) await split.screenshot({ path: path.join(shots, 'notice-split-narrow.png'), clip: { x: 300, y: 0, width: 500, height: 560 } });
  await split.close();
  assert.deepEqual(errors, []);
  // Every external request was answered locally or aborted by the routes: the test never needs the network.
  assert.ok(external.length > 0, 'the page did request its CDN scripts');
});
