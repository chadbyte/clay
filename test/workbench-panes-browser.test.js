var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
var material = require('./fixtures/chrome-material-assertions.cjs');
// Real authenticated app; fixture isolates storage and forbids provider execution.
test('all workbenches share pane chrome, docking, moves and saved View restoration', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1800, height: 1100 } }), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  var fixture = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('[data-split-view-id="' + fixture.restoreView.id + '"] .split-view-group-open').click();
  await page.waitForFunction(function () { var frames = Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe')); return frames.length === 2 && frames.every(function (f) { return f.clayPane && f.clayPane.identity() && f.clayPane.identity().ready; }); });
  await page.evaluate(async function () { window.workbenchStore = (await import('/p/reuse/modules/store.js')).store; });
  async function settled() {
    await page.waitForFunction(function () { var s = window.workbenchStore, run = s.get('savedWorkspaceRuntime'); return run && !run.restoring && !run.desired && !run.inflight && !s.get('projectSplitViewPending') && !s.get('projectSplitViewError'); });
  }
  async function open(name) { await page.evaluate(async function (name) { var r = (await import('/p/reuse/modules/workbench-panels.js')).WORKBENCH_PANELS[name], api = await r.load(); api[r.open](); }, name); }
  var definitions = [{ name: 'project-logs', id: 'project-logs-panel' }, { name: 'mcp-skills', id: 'mcp-skills-workbench' }, { name: 'scheduled-tasks', id: 'scheduled-tasks-panel' }];
  for (var definition of definitions) {
    await open(definition.name);
    var panel = page.locator('#' + definition.id);
    await panel.waitFor({ state: 'visible' });
    await panel.locator('.workbench-layout-toggle').waitFor();
    await material.assertPaneBacking(page, '#' + definition.id);
    assert.equal(await panel.getAttribute('data-workbench-placement'), 'overlay');
    assert.equal(await panel.locator(':scope > .tool-pane-header').evaluate(function (header) { return getComputedStyle(header).height; }), '33px');
    if (definition.name === 'scheduled-tasks') {
      assert.equal(await panel.locator(':scope > header [data-action="new"]').count(), 0, 'content actions stay out of pane chrome');
      var create = panel.locator('.scheduled-tasks-toolbar [data-action="new"]');
      assert.ok((await create.boundingBox()).width > 45, 'New keeps its label width');
      await panel.getByRole('button', { name: 'More task creation options' }).click();
      await panel.getByRole('menuitem', { name: 'Manual creation' }).waitFor({ state: 'visible' });
      await page.keyboard.press('Escape');
      await panel.getByRole('menuitem', { name: 'Manual creation' }).waitFor({ state: 'hidden' });
    }
    await panel.locator('.workbench-layout-toggle').click();
    await page.waitForFunction(function (id) { var el = document.getElementById(id); return el.dataset.toolWindowId && getComputedStyle(el).position === 'absolute'; }, definition.id);
    await settled();
  }
  assert.equal(await page.locator('.workbench-pane-shell.tool-pane-window:not(.hidden)').count(), 3);
  var observation = await page.evaluate(async function () { return (await import('/p/reuse/modules/clay-split-view-screen.js')).splitViewScreenSnapshot(); });
  require('../lib/clay-split-view-render-proof').snapshotSchema.parse(observation);
  assert.equal(observation.tools.filter(function (tool) { return tool.kind === 'workbench' && tool.ready && tool.visible; }).length, 3);
  // Drag a workbench beside a session using the same pointer controller.
  var logs = page.locator('#project-logs-panel'), handle = await logs.locator('.split-pane-drag-space').boundingBox(), target = await page.locator('#split-host > .split-pane').first().boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
  await page.mouse.move(target.x + 8, target.y + target.height / 2, { steps: 8 }); await page.waitForTimeout(300);
  assert.equal(await logs.evaluate(function (el) { return getComputedStyle(el).opacity; }), '0.72');
  await page.mouse.up(); await settled();
  var saved = await page.evaluate(function () { var s = window.workbenchStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).workspace; });
  assert.deepEqual(saved.panes.filter(function (p) { return p.kind === 'workbench' && p.open; }).map(function (p) { return p.resource.name; }).sort(), definitions.map(function (d) { return d.name; }).sort());
  var cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload();
  await page.evaluate(async function () { window.workbenchStore = (await import('/p/reuse/modules/store.js')).store; });
  await page.waitForFunction(function (defs) { return defs.every(function (d) { var p = document.getElementById(d.id); return p && !p.classList.contains('hidden') && p.dataset.toolWindowId; }); }, definitions);
  await settled();
  assert.deepEqual(await page.evaluate(function () { var s = window.workbenchStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).workspace; }), saved);
  await logs.getByRole('button', { name: /fullscreen/i }).click();
  await settled();
  await page.reload();
  await page.evaluate(async function () { window.workbenchStore = (await import('/p/reuse/modules/store.js')).store; });
  await page.waitForFunction(function () { var panel = document.getElementById('project-logs-panel'); return panel && panel.classList.contains('panel-fullscreen'); });
  assert.equal(await logs.evaluate(function (el) { return getComputedStyle(el).borderRadius; }), '9px');
  await logs.getByRole('button', { name: /fullscreen/i }).click(); await settled();
  for (var name of ['you', 'linear', 'notes-browser', 'wireframe', 'issues']) {
    await open(name);
    var id = await page.evaluate(async function (name) { return (await import('/p/reuse/modules/workbench-panels.js')).WORKBENCH_PANELS[name].id; }, name);
    var overlay = page.locator('#' + id); await overlay.waitFor({ state: 'visible' });
    await overlay.locator(':scope > .tool-pane-header .workbench-layout-toggle').waitFor();
    if (name === 'issues') {
      assert.equal(await overlay.locator(':scope > header [data-open-linear]').count(), 0);
      var linear = overlay.locator('.issues-filters [data-open-linear]');
      assert.ok((await linear.boundingBox()).width > 45, 'Linear is a readable content navigation control');
      await linear.click(); await page.locator('#linear-panel').waitFor({ state: 'visible' }); await open('issues');
    }
    if (name === 'wireframe') assert.equal(await overlay.locator('[data-save]').isDisabled(), true, 'an empty restored Sketch shell cannot save absent source');
    assert.equal(await overlay.getAttribute('data-workbench-placement'), 'overlay', name);
    assert.equal(await overlay.locator(':scope > .tool-pane-header').evaluate(function (el) { return getComputedStyle(el).height; }), '33px', name);
  }
  for (var restricted of ['debates', 'mate-knowledge']) {
    await open(restricted);
    assert.equal(await page.evaluate(async function (name) { var d = (await import('/p/reuse/modules/workbench-panels.js')).WORKBENCH_PANELS[name], p = document.getElementById(d.id); return !!p && !p.classList.contains('hidden'); }, restricted), false, 'Mate-only access stays enforced');
  }
  await page.screenshot({ path: '/tmp/clay-workbench-panes.png' });
  assert.equal(await page.locator('.workbench-pane-shell.tool-pane-window:not(.hidden)').count(), 3, 'new overlays preserve every dock');
  await logs.getByRole('button', { name: /Close Logs/i }).click(); await settled();
  assert.equal(await page.locator('#scheduled-tasks-panel').isVisible(), true);
  await open('notes-browser'); var notes = page.locator('#notes-browser'); await notes.locator('.workbench-layout-toggle').click(); await settled();
  await open('issues'); await page.locator('#issues-panel input[type="search"]').focus(); await page.keyboard.press('Escape');
  await page.locator('#issues-panel').waitFor({ state: 'hidden' }); assert.equal(await notes.isVisible(), true, 'Escape belongs to the focused pane and preserves other docks');
  await page.evaluate(async function () { (await import('/p/reuse/modules/theme.js')).applyTheme('clay-dark'); });
  await page.setViewportSize({ width: 760, height: 900 }); await open('linear');
  var narrow = page.locator('#linear-panel'); await narrow.waitFor({ state: 'visible' });
  assert.equal(await narrow.locator('.workbench-layout-toggle').isVisible(), false, 'narrow workbenches preserve the existing single foreground surface');
  assert.equal(await narrow.locator(':scope > .tool-pane-header').evaluate(function (el) { return getComputedStyle(el).height; }), '33px');
  await page.screenshot({ path: '/tmp/clay-workbench-panes-narrow.png' });
  assert.deepEqual(errors, []);
});
