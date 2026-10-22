// Personal > Agent behavior in a real browser against the isolated fixture
// (own HOME/CLAY_HOME, no providers, no accounts unless --multi).
var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var chromium = require('playwright').chromium;
var schema = require('../lib/agent-behavior-schema');

function fixture(t, args) {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, 'fixtures/agent-behavior-server.cjs'), args || [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(function () { if (child.connected) child.send('close'); setTimeout(function () { child.kill('SIGTERM'); }, 1500).unref(); });
    child.once('error', reject);
    child.on('message', function (msg) { if (msg.port) resolve({ url: 'http://127.0.0.1:' + msg.port, entry: msg.url, port: msg.port }); });
  });
}
async function open(t, f, options) {
  options = options || {};
  var browser = await chromium.launch({ headless: true });
  t.after(function () { return browser.close(); });
  var context = await browser.newContext({ viewport: options.viewport || { width: 1280, height: 800 }, reducedMotion: options.motion || 'reduce', colorScheme: options.scheme || 'light' });
  var page = await context.newPage();
  page.setDefaultTimeout(8000);
  var errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  t.after(function () { assert.deepEqual(errors, []); });
  var gets = [];
  page.on('request', function (req) { if (req.url().endsWith('/api/user/agent-behavior') && req.method() === 'GET') gets.push(req.url()); });
  await page.goto(options.entry || f.entry);
  await page.waitForFunction(function () { return !!document.getElementById('settings-shell'); });
  page.gets = gets; page.context_ = context;
  return page;
}
async function openPage(page) {
  await page.evaluate(async function () { var m = await import('./modules/user-settings.js'); m.openUserSettings('us-agent'); });
  await page.waitForSelector('#us-agent-behavior .ab-layout');
}
function radio(page, id, value) { return page.locator('[data-setting="' + id + '"] [role="radio"][data-value="' + value + '"]'); }
function state(f) { return fetch(f.url + '/__fixture/state').then(function (r) { return r.json(); }); }

test('the page renders every catalog setting as a radiogroup with consequence and example, and no select', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  await openPage(page);
  var root = page.locator('#us-agent-behavior');
  assert.equal(await root.locator('select').count(), 0);
  var modes = schema.SETTINGS.filter(function (s) { return s.type === 'mode'; });
  assert.equal(await root.locator('[role="radiogroup"]').count(), modes.length);
  for (var i = 0; i < modes.length; i++) {
    var block = root.locator('[data-setting="' + modes[i].id + '"]').first();
    assert.equal(await block.locator('.ab-label').textContent(), modes[i].label);
    assert.equal(await block.locator('[role="radio"]').count(), 3);
    assert.equal((await block.locator('[role="radio"][aria-checked="true"]').getAttribute('data-value')), 'auto');
    assert.equal(await block.locator('.ab-consequence').first().textContent(), modes[i].modes.auto.consequence);
    assert.equal(await block.locator('.ab-example-text').first().textContent(), modes[i].modes.auto.example);
  }
  assert.equal(await root.locator('h3').count(), 4);
  assert.equal(await page.locator('nav[aria-label="Agent behavior sections"] a').count(), 4);
  var note = await root.locator('.ab-note').textContent();
  assert.match(note, /take effect from your next message/);
  assert.doesNotMatch(note, /technical check|canonical Clay/);
  // Desktop: section links live under the active item of the shell's left navigation.
  var placement = await page.evaluate(function () {
    var nav = document.querySelector('.ab-nav'); var item = document.querySelector('#settings-page-nav .settings-nav-item.active');
    return { inShell: !!nav.closest('#settings-page-nav'), after: item && item.nextElementSibling === nav, label: item && item.textContent, inContent: !!document.querySelector('#us-agent-behavior .ab-nav') };
  });
  assert.deepEqual(placement, { inShell: true, after: true, label: 'Agent behavior', inContent: false });
  var rowLayout = await page.evaluate(function () {
    var s = document.querySelector('[data-setting="meUse"]'); var l = s.querySelector('.ab-label').getBoundingClientRect(); var c = s.querySelector('.ab-seg').getBoundingClientRect();
    return { controlRight: c.left > l.left + 200, sameRow: Math.abs(c.top - l.top) < 24 };
  });
  assert.deepEqual(rowLayout, { controlRight: true, sameRow: true }, 'label and help sit left of the segmented control on desktop');
  assert.equal(await page.locator('[data-setting="issueLinkedNotes"] input[type="checkbox"]').isChecked(), true);
});

test('choosing a mode shows Saving until the PUT is acknowledged, updates the text and persists', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  await openPage(page);
  var release; var gate = new Promise(function (resolve) { release = resolve; });
  var body = null;
  await page.route('**/api/user/agent-behavior', async function (route) {
    if (route.request().method() === 'PUT') { body = route.request().postDataJSON(); await gate; }
    await route.continue();
  });
  await radio(page, 'sketch', 'request').click();
  var status = page.locator('[data-setting="sketch"] .ab-status');
  assert.equal((await status.textContent()), 'Saving...');
  assert.equal(await radio(page, 'sketch', 'request').getAttribute('aria-checked'), 'true');
  assert.equal(await page.locator('[data-setting="sketch"] .ab-consequence').textContent(), schema.SETTINGS.filter(function (s) { return s.id === 'sketch'; })[0].modes.request.consequence);
  assert.deepEqual(Object.keys(body.changes), ['sketch']);
  assert.equal((await state(f)).agentBehavior, null, 'nothing is persisted before the reply');
  release();
  await page.waitForFunction(function () { return document.querySelector('[data-setting="sketch"] .ab-status').textContent === 'Saved'; });
  assert.equal((await state(f)).agentBehavior.sketch, 'request');
});

test('a failed save reverts the control, shows an inline error with Retry, and Retry recovers', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  await openPage(page);
  await fetch(f.url + '/__fixture/fail');
  await radio(page, 'logs', 'off').click();
  var status = page.locator('[data-setting="logs"] .ab-status');
  await page.waitForSelector('[data-setting="logs"] .ab-retry');
  assert.match(await status.textContent(), /Could not save agent behavior/);
  assert.equal(await radio(page, 'logs', 'auto').getAttribute('aria-checked'), 'true', 'reverted to the acknowledged value');
  assert.equal(await radio(page, 'logs', 'off').getAttribute('aria-checked'), 'false');
  await fetch(f.url + '/__fixture/recover');
  await page.locator('[data-setting="logs"] .ab-retry').click();
  await page.waitForFunction(function () { return document.querySelector('[data-setting="logs"] .ab-status').textContent === 'Saved'; });
  assert.equal(await radio(page, 'logs', 'off').getAttribute('aria-checked'), 'true');
  assert.equal((await state(f)).agentBehavior.logs, 'off');
});

test('the linked-note checkbox is visibly inactive with a reason but keeps its saved choice', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  await openPage(page);
  var box = page.locator('[data-setting="issueLinkedNotes"]');
  assert.equal(await box.locator('.ab-inactive').isVisible(), false);
  await radio(page, 'notes', 'request').click();
  await page.waitForFunction(function () { return document.querySelector('[data-setting="notes"] .ab-status').textContent === 'Saved'; });
  assert.equal(await box.locator('.ab-inactive').isVisible(), true);
  assert.match(await box.locator('.ab-inactive').textContent(), /Sticky Notes is On request/);
  assert.equal(await box.locator('input').isChecked(), true);
  assert.equal(await box.evaluate(function (node) { return node.classList.contains('ab-inactive-setting'); }), true);
  await radio(page, 'notes', 'auto').click();
  await radio(page, 'issues', 'off').click();
  await page.waitForFunction(function () { return /Issues is Off/.test(document.querySelector('.ab-inactive').textContent); });
  await box.locator('input').click();
  await page.waitForFunction(function () { return document.querySelector('[data-setting="issueLinkedNotes"] .ab-status').textContent === 'Saved'; });
  assert.equal((await state(f)).agentBehavior.issueLinkedNotes, false);
});

test('the segmented control is a roving-tabindex radiogroup with arrow, Home and End keys', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  await openPage(page);
  var group = '[data-setting="meUse"] [role="radiogroup"]';
  assert.equal(await page.locator(group).getAttribute('aria-labelledby'), 'ab-l-meUse');
  assert.deepEqual(await page.locator(group + ' [role="radio"]').evaluateAll(function (nodes) { return nodes.map(function (n) { return n.tabIndex; }); }), [-1, -1, 0]);
  await radio(page, 'meUse', 'auto').focus();
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(function () { return document.activeElement.dataset.value; }), 'request');
  assert.equal(await radio(page, 'meUse', 'request').getAttribute('aria-checked'), 'true');
  assert.deepEqual(await page.locator(group + ' [role="radio"]').evaluateAll(function (nodes) { return nodes.map(function (n) { return n.tabIndex; }); }), [-1, 0, -1]);
  await page.keyboard.press('Home');
  assert.equal(await page.evaluate(function () { return document.activeElement.dataset.value; }), 'off');
  await page.keyboard.press('ArrowLeft');
  assert.equal(await page.evaluate(function () { return document.activeElement.dataset.value; }), 'auto', 'wraps around');
  await page.waitForFunction(function () { return document.querySelector('[data-setting="meUse"] .ab-status').textContent === 'Saved'; });
  assert.equal((await state(f)).agentBehavior.meUse, 'auto');
});

test('section links scroll to anchors, are the active link while scrolling and mark aria-current', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  await openPage(page);
  var current = function () { return page.locator('.ab-nav a[aria-current="location"]').getAttribute('data-section'); };
  assert.equal(await current(), 'memory');
  await page.locator('.ab-nav a[data-section="context"]').click();
  assert.equal(await current(), 'context');
  var top = await page.evaluate(function () {
    var scroller = document.querySelector('.settings-shell-content');
    return document.getElementById('ab-sec-context').getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });
  assert.ok(Math.abs(top) < 40, 'the section starts at the top of the scroll area: ' + top);
  assert.equal(await page.evaluate(function () { return document.activeElement.id; }), 'ab-h-context');
  assert.equal(await page.evaluate(function () { return location.hash; }), '', 'the app URL is untouched');
  await page.locator('.ab-nav a[data-section="tools"]').click();
  assert.equal(await current(), 'tools', 'the clicked link stays current even when the section cannot reach the top');
  await page.mouse.move(700, 400);
  await page.mouse.wheel(0, -20000);
  await page.waitForFunction(function () { return document.querySelector('.ab-nav a[aria-current]').dataset.section === 'memory'; });
  await page.mouse.wheel(0, 20000);
  await page.waitForFunction(function () { return document.querySelector('.ab-nav a[aria-current]').dataset.section === 'connections'; });
  await page.focus('.ab-nav a[data-section="memory"]');
  await page.keyboard.press('Enter');
  assert.equal(await current(), 'memory');
  assert.equal(await page.locator('.ab-nav a[aria-current]').count(), 1);
});

test('smooth scrolling is used unless reduced motion is requested', async function (t) {
  var f = await fixture(t); var page = await open(t, f, { motion: 'no-preference' });
  await openPage(page);
  await page.evaluate(function () { window.__behaviors = []; var original = Element.prototype.scrollIntoView; Element.prototype.scrollIntoView = function (o) { window.__behaviors.push(o && o.behavior); return original.call(this, o); }; });
  await page.locator('.ab-nav a[data-section="context"]').click();
  assert.deepEqual(await page.evaluate(function () { return window.__behaviors; }), ['smooth']);
  await page.waitForFunction(function () { return document.querySelector('.ab-nav a[aria-current]').dataset.section === 'context'; });
});

test('entering the page re-fetches and shows loading and load-error states with Retry', async function (t) {
  var f = await fixture(t); var page = await open(t, f);
  var fail = true;
  await page.route('**/api/user/agent-behavior', async function (route) {
    if (fail) { await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture storage unavailable' }) }); return; }
    await route.continue();
  });
  await openPage_(page);
  await page.waitForSelector('#us-agent-behavior .ab-load-error');
  assert.match(await page.locator('#us-agent-behavior .ab-load-error').textContent(), /Fixture storage unavailable/);
  // Re-activating the page already shown must not reload or rebuild it.
  var getsBefore = page.gets.length;
  var node = await page.locator('#us-agent-behavior .ab-retry').elementHandle();
  await page.evaluate(async function () { var m = await import('./modules/user-settings-layout.js'); m.loadUserSettingsExtras('us-agent'); });
  await page.waitForTimeout(300);
  assert.equal(page.gets.length, getsBefore, 'a repeated activation does not fetch again');
  assert.equal(await node.evaluate(function (n) { return n.isConnected; }), true, 'the Retry control is not rebuilt');
  fail = false;
  await page.locator('#us-agent-behavior .ab-retry').click();
  await page.waitForSelector('#us-agent-behavior .ab-layout');
  var before = page.gets.length;
  await page.locator('#settings-page-nav [data-section="us-account"]').click();
  await page.waitForFunction(function () { return !document.querySelector('#us-agent-behavior .ab-layout'); });
  await page.locator('#settings-page-nav [data-section="us-agent"]').click();
  await page.waitForSelector('#us-agent-behavior .ab-layout');
  assert.equal(page.gets.length, before + 1, 'each entry fetches again');
  assert.equal(await page.locator('#settings-page-nav [data-section="us-agent"]').getAttribute('aria-current'), 'page');
});
async function openPage_(page) {
  await page.evaluate(async function () { var m = await import('./modules/user-settings.js'); m.openUserSettings('us-agent'); });
}

test('a narrow viewport collapses the section list into a sticky horizontal row without page overflow', async function (t) {
  var f = await fixture(t); var page = await open(t, f, { viewport: { width: 390, height: 800 } });
  await openPage(page);
  assert.equal(await page.locator('.ab-layout').evaluate(function (n) { return n.classList.contains('ab-narrow'); }), true);
  var geometry = await page.evaluate(function () {
    var nav = document.querySelector('.ab-nav'); var items = Array.from(nav.querySelectorAll('a')).map(function (a) { return a.getBoundingClientRect().top; });
    return { position: getComputedStyle(nav).position, sameRow: items.every(function (y) { return Math.abs(y - items[0]) < 2; }), overflow: document.documentElement.scrollWidth > innerWidth, content: document.querySelector('.settings-shell-content').scrollWidth > document.querySelector('.settings-shell-content').clientWidth + 1 };
  });
  assert.deepEqual(geometry, { position: 'sticky', sameRow: true, overflow: false, content: false });
  await page.locator('.ab-nav a[data-section="tools"]').click();
  var offsets = await page.evaluate(function () {
    var s = document.querySelector('.settings-shell-content').getBoundingClientRect(); var n = document.querySelector('.ab-nav').getBoundingClientRect();
    return { navTop: n.top - s.top, navBottom: n.bottom - s.top, sectionTop: document.getElementById('ab-sec-tools').getBoundingClientRect().top - s.top };
  });
  assert.ok(offsets.navTop >= -1 && offsets.navTop < 4, 'the row stays pinned: ' + offsets.navTop);
  assert.ok(offsets.sectionTop >= offsets.navBottom - 4, 'the section heading is not hidden behind the row');
  var seg = await page.locator('[data-setting="meUse"] .ab-seg').boundingBox();
  assert.ok(seg.width > 300, 'the segmented control uses the full width on mobile');
  await radio(page, 'meUse', 'off').click();
  await page.waitForFunction(function () { return document.querySelector('[data-setting="meUse"] .ab-status').textContent === 'Saved'; });
});

test('multi-account servers keep each owner policy separate', async function (t) {
  var f = await fixture(t, ['--multi']);
  var alice = await open(t, f);
  await openPage(alice);
  await radio(alice, 'meUse', 'off').click();
  await alice.waitForFunction(function () { return document.querySelector('[data-setting="meUse"] .ab-status').textContent === 'Saved'; });
  var bob = await open(t, f, { entry: f.url + '/__fixture/bob' });
  await openPage(bob);
  assert.equal(await radio(bob, 'meUse', 'auto').getAttribute('aria-checked'), 'true');
  var s = await state(f);
  assert.equal(s.users.filter(function (u) { return u.id === 'alice'; })[0].agentBehavior.meUse, 'off');
  assert.equal(s.users.filter(function (u) { return u.id === 'bob'; })[0].agentBehavior, null);
});
