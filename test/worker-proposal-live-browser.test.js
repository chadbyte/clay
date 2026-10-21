var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

async function exercise(t, automatic) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_FIXTURE_SYNTHETIC_TURN: '1', CLAY_PANE_FILES: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  if (process.env.CLAY_PANE_PACKAGED === '1') await page.route(/\/pane-assets\/app-[^/]+\.js(?:\?.*)?$/, function (route) {
    return route.request().frame().parentFrame() ? route.continue() : route.fallback();
  });
  await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('.session-item[data-session-id="' + data.standaloneId + '"]').click();
  await page.evaluate(async function () { window.proposalStore = (await import('/p/reuse/modules/store.js')).store; });
  await page.waitForFunction(function (id) {
    var s = window.proposalStore, run = s.get('savedWorkspaceRuntime'), f = document.querySelector('.split-pane-frame');
    var live = f && f.clayPane && f.clayPane.identity();
    return s.get('activeSessionId') === id && run && !run.restoring && !s.get('projectSplitViewPending') &&
      live && live.ready;
  }, data.standaloneId);
  await page.evaluate(async function () { (await import('/p/reuse/modules/filebrowser.js')).openFile('a.md'); });
  await page.getByText('ALPHA_FILE_CONTENT', { exact: true }).waitFor();
  if (!automatic) await page.locator('.file-instance .workbench-layout-toggle').click();
  await page.waitForFunction(function () { var r = window.proposalStore.get('savedWorkspaceRuntime'); return r && !r.desired && !r.inflight && !window.proposalStore.get('projectSplitViewPending'); });
  var viewId = await page.evaluate(function () { return window.proposalStore.get('projectSplitViewActiveId'); });
  var response = await page.request.post(base + '/fixture/worker-proposal?id=' + data.standaloneId + '&auto=' + (automatic ? '1' : '0'));
  assert.equal(response.status(), 200, await response.text());
  var frame = page.frameLocator('.split-pane-frame');
  if (!automatic) {
    await frame.locator('.worker-proposal-card[data-status="pending"]').waitFor();
    assert.equal(await page.getByText('ALPHA_FILE_CONTENT', { exact: true }).isVisible(), true, 'proposal keeps the workbench visible');
    await frame.getByRole('button', { name: 'Run with Split Worker', exact: true }).click();
  }
  await page.waitForFunction(function (id) {
    var s = window.proposalStore, f = document.querySelector('.split-pane-frame'), live = f && f.clayPane && f.clayPane.identity();
    return s.get('activeSessionId') === id && live && live.ready &&
      document.querySelector('.split-view-worker-chip') && f.contentDocument.querySelector('.worker-proposal-card[data-status="running"]') &&
      !f.contentDocument.getElementById('app').inert;
  }, data.standaloneId);
  assert.equal(await page.evaluate(function () { return window.proposalStore.get('projectSplitViewActiveId'); }), viewId);
  assert.equal(await page.getByText('ALPHA_FILE_CONTENT', { exact: true }).isVisible(), true, 'acceptance preserves the open workbench');
  assert.deepEqual(errors, []);
}
test('manual Worker acceptance updates the initiating pane without refresh', { timeout: 60000 }, function (t) { return exercise(t, false); });
test('YOLO Worker creation updates live UI and preserves the workspace', { timeout: 60000 }, function (t) { return exercise(t, true); });
