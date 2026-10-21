var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Files legacy entrypoints and historical snapshots address independent panes', { timeout: 90000 }, async function (t) {
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
  await open('a.md'); await page.getByText('ALPHA_FILE_CONTENT', { exact: true }).waitFor();
  var a = page.locator('.file-instance').first(), aId = await a.getAttribute('id');
  await a.locator('.workbench-layout-toggle').click(); await settled();
  await a.getByRole('button', { name: 'Pin this file', exact: true }).click();
  await page.evaluate(async function () { window.fileApi = await import('/p/reuse/modules/filebrowser.js'); window.fileApi.presentMarkdownEdit({ path: 'b.md', content: '# Live edit\nLIVE_EDIT_SNAPSHOT' }); });
  await page.getByText('LIVE_EDIT_SNAPSHOT', { exact: true }).waitFor();
  var b = page.locator('.file-instance').nth(1), bId = await b.getAttribute('id');
  assert.match(await a.innerText(), /ALPHA_FILE_CONTENT/);
  await page.request.post(base + '/fixture/file-update?name=b.md'); await b.getByText('b.md_UPDATED', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'History', exact: true }).click();
  await b.getByRole('button', { name: 'View change', exact: true }).click();
  await b.getByRole('button', { name: 'Source', exact: true }).last().click();
  assert.match(await b.locator('.file-viewer-body').innerText(), /RECORDED_WRITE_CONTENT/);
  assert.doesNotMatch(await b.locator('.file-viewer-body').innerText(), /b.md_UPDATED/);
  await page.evaluate(function () { window.fileApi.openWorkingTreeDiff({ path: 'b.md', oldContent: 'BEFORE_REVIEW', newContent: 'AFTER_REVIEW', review: { index: 0, total: 2, next: function () { window.reviewClicked = true; } } }); });
  await b.getByText('AFTER_REVIEW', { exact: true }).waitFor();
  await b.getByRole('button', { name: 'Next file', exact: true }).click();
  assert.equal(await page.evaluate(function () { return window.reviewClicked; }), true);
  await b.getByRole('button', { name: 'Unified', exact: true }).click();
  assert.match(await b.innerText(), /BEFORE_REVIEW/);
  await page.evaluate(function () { window.fileApi.setFileViewerFullscreen(true); });
  assert.match(await b.getAttribute('class'), /panel-fullscreen/); assert.doesNotMatch(await a.getAttribute('class'), /panel-fullscreen/);
  await page.evaluate(function () { window.fileApi.setFileViewerFullscreen(false); window.fileApi.closeFileViewer(); });
  assert.equal(await page.locator('#' + bId).count(), 0); assert.equal(await page.locator('#' + aId).count(), 1);
  await page.evaluate(function () { window.fileApi.reopenFileViewer(); window.fileApi.refreshIfOpen('a.md'); });
  assert.equal(await page.locator('.file-instance').count(), 2);
  await page.evaluate(function () { window.fileApi.closeFileViewer(); });
  await page.request.post(base + '/fixture/file-update?name=a.md'); await a.getByText('a.md_UPDATED', { exact: true }).waitFor();
  await a.getByRole('button', { name: 'History', exact: true }).click();
  await a.getByRole('button', { name: 'View change', exact: true }).click();
  await a.getByRole('button', { name: 'Source', exact: true }).last().click();
  assert.match(await a.locator('.file-viewer-body').innerText(), /ALPHA_FILE_CONTENT/);
  assert.doesNotMatch(await a.locator('.file-viewer-body').innerText(), /a.md_UPDATED/);
  await page.evaluate(async function () {
    var panes = await import('/p/reuse/modules/file-pane-instances.js'), state = panes.filePaneState(window.fileTestStore.get('activeFilePaneId'));
    panes.updateFilePaneState(state.instanceId, { historyTarget: { kind: 'session', entry: { toolName: 'Write', source: 'session', content: 'RECORDED_WRITE' } }, historyMode: 'source' }); panes.repaintFilePane(state.instanceId);
  });
  assert.match(await a.locator('.file-viewer-body').innerText(), /RECORDED_WRITE/);
  assert.doesNotMatch(await a.locator('.file-viewer-body').innerText(), /a.md_UPDATED/);
  await page.evaluate(async function () {
    var panes = await import('/p/reuse/modules/file-pane-instances.js'), state = panes.filePaneState(window.fileTestStore.get('activeFilePaneId'));
    panes.updateFilePaneState(state.instanceId, { historyVisible: false, content: '# Heading\n[Jump](#heading)\n[Other](./b.md#updated)', resource: Object.assign({}, state.resource, { rendered: true }) }); panes.repaintFilePane(state.instanceId);
  });
  var url = page.url(); await a.getByRole('link', { name: 'Jump', exact: true }).click(); assert.equal(page.url(), url);
  await a.getByRole('button', { name: 'Open file ./b.md', exact: true }).click();
  await page.getByText('b.md_UPDATED', { exact: true }).waitFor();
  assert.equal(await a.locator('.tool-pane-title').innerText(), 'a.md'); assert.equal(await page.locator('.file-instance').count(), 2);
  assert.equal(await page.evaluate(function () { var s = window.fileTestStore, state = s.get('filePaneInstances')[s.get('activeFilePaneId')]; return state.heading; }), 'updated');
  assert.deepEqual(errors, []);
});
