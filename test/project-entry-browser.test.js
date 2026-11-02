var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
async function fixture(t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1', CLAY_ENTRY_POLICY: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve) { child.once('message', resolve); }), browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), base = 'http://127.0.0.1:' + info.port, errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json();
  async function setup(age, running, visits) {
    await page.goto('about:blank');
    return (await page.request.get(base + '/fixture/entry?age=' + age + '&running=' + (running || []).join(',') + '&visits=' + (visits || []).join(','))).json();
  }
  async function enter() {
    await page.goto(base + '/fixture/login');
    await page.evaluate(async function () { window.entryStore = (await import('/p/reuse/modules/store.js')).store; });
    await page.waitForFunction(function () { return window.entryStore.get('projectSplitViewHydrated'); });
  }
  return { page: page, data: data, base: base, errors: errors, setup: setup, enter: enter };
}
async function selected(page, id) {
  await page.waitForFunction(function (id) { return window.entryStore.get('activeSessionId') === id && window.entryStore.get('sessionActivatedProjectSlug') === 'reuse'; }, id);
  await page.locator('#split-host > .split-pane:not(.split-pane-cached) iframe[data-session-id="' + id + '"]').waitFor();
}
test('project entry respects work-stop boundaries and personal running visit priority', { timeout: 60000 }, async function (t) {
  var f = await fixture(t), page = f.page, id = f.data.standaloneId, other = f.data.otherIds;
  await f.setup(86400000 - 60000, [other[0]], [id, other[0]]); await f.enter(); await selected(page, id);
  await f.setup(86400000, [other[0]], [id, other[0]]); await f.enter(); await selected(page, other[0]);
  await f.setup(86400001, [other[0], other[1]], [id, other[1], other[0]]); await f.enter(); await selected(page, other[1]);
  await f.setup(4 * 86400000, [id, other[0]], [id, other[0]]); await f.enter(); await selected(page, id);
  await page.request.get(f.base + '/fixture/entry?notify=1&age=' + (4 * 86400000) + '&running=' + other[0] + '&visits=' + other[0]);
  await page.waitForFunction(function (id) { var sessions = window.entryStore.get('paneBindingSessions') || []; return sessions.some(function (item) { return item.id === id && item.isProcessing; }); }, other[0]);
  assert.equal(await page.evaluate(function () { return window.entryStore.get('activeSessionId'); }), id, 'changing activity never navigates an already open conversation');
  assert.deepEqual(f.errors, []);
});
test('all stale sessions show centered picker; explicit reopen does not renew stopped work and creation remains available', { timeout: 60000 }, async function (t) {
  var f = await fixture(t), page = f.page, id = f.data.standaloneId;
  var initial = await f.setup(3 * 86400000, [], [id]);
  await f.enter();
  var picker = page.locator('#project-empty-canvas'); await picker.waitFor({ state: 'visible' });
  assert.equal(await page.locator('#split-host > .split-pane:not(.split-pane-cached) iframe').count(), 0);
  var box = await picker.boundingBox(), host = await page.locator('#split-host').boundingBox();
  assert.ok(Math.abs(box.x + box.width / 2 - host.x - host.width / 2) < 4);
  assert.ok(Math.abs(box.y + box.height / 2 - host.y - host.height / 2) < 24);
  var before = await (await page.request.get(f.base + '/fixture/entry?inspect=1')).json();
  assert.equal(before.sessionCount, initial.sessionCount, 'entry does not create a blank session');
  await page.locator('.session-item[data-session-id="' + id + '"]').first().click(); await selected(page, id);
  await page.reload(); await page.evaluate(async function () { window.entryStore = (await import('/p/reuse/modules/store.js')).store; });
  await picker.waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(function () { return window.entryStore.get('activeSessionId'); }), null, 'revisiting a stale stopped chat does not make it recent work');
  await picker.locator('[data-split-vendor]').first().click();
  await page.waitForFunction(function () { return !!window.entryStore.get('activeSessionId') && !window.entryStore.get('projectStartPicker'); });
  var after = await (await page.request.get(f.base + '/fixture/entry?inspect=1')).json();
  assert.equal(after.sessionCount, before.sessionCount + 1);
  assert.equal(after.stoppedAt, initial.stoppedAt, 'reopening never stamps the old work as newly stopped');
  assert.deepEqual(f.errors, []);
});

test('another account cannot inherit personal visit order even for a shared session', { timeout: 30000 }, async function (t) {
  var f = await fixture(t), page = f.page, id = f.data.standaloneId;
  await page.goto('about:blank');
  await page.request.get(f.base + '/fixture/entry?share=1&age=1000&visits=' + id);
  await page.goto(f.base + '/fixture/login?account=replacement');
  await page.evaluate(async function () { window.entryStore = (await import('/p/reuse/modules/store.js')).store; });
  await page.locator('#project-empty-canvas').waitFor({ state: 'visible' });
  assert.equal(await page.evaluate(function () { return window.entryStore.get('activeSessionId'); }), null);
  await page.evaluate(async function (id) { (await import('/p/reuse/modules/project-session-navigation.js')).openProjectSession('reuse', id); }, id);
  await page.waitForFunction(function (id) { return window.entryStore.get('activeSessionId') === id && !window.entryStore.get('projectEntryEmpty'); }, id);
  await page.reload();
  await page.evaluate(async function () { window.entryStore = (await import('/p/reuse/modules/store.js')).store; });
  await page.waitForFunction(function (id) { return window.entryStore.get('activeSessionId') === id; }, id);
  assert.deepEqual(f.errors, []);
});
