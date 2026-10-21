var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('canonical shared-service updates reconcile Files and bounded tool observations', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1', CLAY_PANE_FILES: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1800, height: 1000 } }), errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('[data-split-view-id="' + data.restoreView.id + '"] .split-view-group-open').click();
  await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe').length === 2; });
  async function modules() { await page.evaluate(async function () { window.fileTestStore = (await import('/p/reuse/modules/store.js')).store; window.fileTestOpen = (await import('/p/reuse/modules/filebrowser.js')).openFile; }); }
  await modules();
  async function open(name) { await page.evaluate(function (name) { window.fileTestOpen(name); }, name); }
  async function settled() {
    await page.waitForFunction(function () { var s = window.fileTestStore, r = s.get('savedWorkspaceRuntime'); return r && !r.restoring && !r.desired && !r.inflight && !s.get('projectSplitViewPending'); });
    var error = await page.evaluate(function () { return window.fileTestStore.get('projectSplitViewError'); }); assert.ok(!error, error);
  }
  async function savedFiles() { return page.evaluate(function () { var s = window.fileTestStore, v = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return { panes: v.workspace.panes.filter(function (p) { return p.kind === 'file'; }), tree: v.workspace.tree }; }); }
  await page.evaluate(async function () { window.screenApi = await import('/p/reuse/modules/clay-split-view-screen.js'); });
  await open('a.md'); await page.getByText('ALPHA_FILE_CONTENT', { exact: true }).waitFor();
  var a = page.locator('.file-instance').first(), id = await a.getAttribute('data-file-instance');
  await a.locator('.workbench-layout-toggle').click(); await settled();
  var result = await (await page.request.post(base + '/fixture/workspace-file?view=' + data.restoreView.id + '&instance=' + id + '&action=pin')).json(); assert.equal(result.ok, true, JSON.stringify(result));
  await page.locator('#file-' + id).getByRole('button', { name: 'Follow file selection', exact: true }).waitFor(); await settled();
  var snap = await page.evaluate(function () { return window.screenApi.splitViewScreenSnapshot(); });
  assert.equal(snap.tools.length, 1); assert.equal(snap.tools[0].instanceId, id); assert.equal(snap.tools[0].visible, true); assert.equal(snap.tools[0].ready, true); assert.ok(snap.tools[0].geometry.width > 0);
  require('../lib/clay-split-view-render-proof').snapshotSchema.parse(snap);
  await open('b.md'); await page.getByText('BETA_FILE_CONTENT', { exact: true }).waitFor(); await settled();
  assert.equal(await page.locator('.file-instance').count(), 2);
  var bId = await page.locator('.file-instance').nth(1).getAttribute('data-file-instance');
  result = await (await page.request.post(base + '/fixture/workspace-file?view=' + data.restoreView.id + '&instance=' + id + '&action=close')).json(); assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForFunction(function (id) { return !document.getElementById('file-' + id); }, id);
  await page.locator('#file-' + bId).getByText('BETA_FILE_CONTENT', { exact: true }).waitFor(); await settled();
  assert.equal(await page.locator('.file-instance').count(), 1);
  snap = await page.evaluate(function () { return window.screenApi.splitViewScreenSnapshot(); }); assert.equal(snap.tools.length, 1); assert.equal(snap.tools[0].instanceId, bId);
  for (var action of ['one', 'zero']) {
    result = await (await page.request.post(base + '/fixture/workspace-file?view=' + data.restoreView.id + '&instance=' + bId + '&action=' + action)).json(); assert.equal(result.ok, true, JSON.stringify(result));
    await page.waitForFunction(function (count) { var s = window.fileTestStore, view = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return view.sessions.length === count; }, action === 'one' ? 1 : 0);
    await settled(); await page.locator('#file-' + bId).getByText('BETA_FILE_CONTENT', { exact: true }).waitFor();
    snap = await page.evaluate(function () { return window.screenApi.splitViewScreenSnapshot(); }); assert.equal(snap.tools.length, 1); assert.equal(snap.tools[0].ready, true);
    assert.equal(snap.panes.filter(function (p) { return p.visible; }).length, action === 'one' ? 1 : 0);
  }
  result = await (await page.request.post(base + '/fixture/workspace-file?view=' + data.restoreView.id + '&instance=' + bId + '&action=close')).json(); assert.equal(result.ok, true, JSON.stringify(result));
  await page.waitForFunction(function () { return document.querySelectorAll('.file-instance').length === 0; }); await settled();
  snap = await page.evaluate(function () { return window.screenApi.splitViewScreenSnapshot(); }); assert.equal(snap.tools.length, 0); assert.equal(snap.panes.filter(function (p) { return p.visible; }).length, 0);
  assert.deepEqual(errors, []);
});
