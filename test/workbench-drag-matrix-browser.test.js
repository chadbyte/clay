var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('every project workbench retains docked moves, resize and cancellation beside one session', { timeout: 180000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_FILES: '1', CLAY_PANE_WORKBENCH: '1', CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] {display:none;}' });
  var fixture = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('.session-item[data-session-id="' + fixture.standaloneId + '"]').first().click();
  await page.evaluate(async function () { window.matrixStore = (await import('/p/reuse/modules/store.js')).store; });
  async function settled() {
    await page.waitForFunction(function () { var s = window.matrixStore, r = s.get('savedWorkspaceRuntime'); return r && !r.restoring && !r.desired && !r.inflight && !r.presentationApplying && !s.get('projectSplitViewPending') && !s.get('projectSplitViewError'); });
    await page.waitForTimeout(120);
  }
  await settled();
  var definitions = await page.evaluate(async function () { var r = (await import('/p/reuse/modules/workbench-panels.js')).WORKBENCH_PANELS; return Object.keys(r).filter(function (name) { return ['debates', 'mate-knowledge'].indexOf(name) < 0; }).map(function (name) { return { name: name, id: r[name].id }; }); });
  definitions = [{ name: 'terminal', id: 'terminal-container' }, { name: 'browser', id: 'shared-browser-panel' }, { name: 'file', id: null }].concat(definitions);
  for (var definition of definitions) {
    t.diagnostic('Checking ' + definition.name);
    await page.evaluate(async function (name) {
      if (name === 'terminal') document.getElementById('terminal-sidebar-btn').click();
      else if (name === 'browser') document.getElementById('shared-browser-btn').click();
      else if (name === 'file') (await import('/p/reuse/modules/filebrowser.js')).openFile('a.md');
      else { var r = (await import('/p/reuse/modules/workbench-panels.js')).WORKBENCH_PANELS[name], api = await r.load(); api[r.open](); }
    }, definition.name);
    var panel = definition.id ? page.locator('#' + definition.id) : page.locator('.file-instance').last();
    await panel.waitFor({ state: 'visible' }); await panel.locator('.workbench-layout-toggle').waitFor(); await settled();
    await panel.locator('.workbench-layout-toggle').click(); await settled();
    assert.equal(await panel.getAttribute('data-workbench-placement'), 'docked', definition.name);
    var session = page.locator('#split-host > .split-pane:not(.split-pane-cached)').first();
    async function drag(side, cancel) {
      var handle = await panel.locator(':scope > header .split-pane-drag-space').boundingBox(), target = await session.boundingBox();
      assert.ok(handle && handle.width > 0, definition.name + ' has usable drag space');
      await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down();
      await page.mouse.move(target.x + (side === 'left' ? 8 : target.width - 8), target.y + target.height / 2, { steps: 8 });
      await page.waitForTimeout(100); if (cancel) await page.keyboard.press('Escape'); await page.mouse.up(); await settled(); await page.waitForTimeout(250);
    }
    await drag('left');
    assert.ok((await panel.boundingBox()).x < (await session.boundingBox()).x, definition.name + ' keeps the committed left position');
    var before = await page.evaluate(function () { return JSON.stringify(window.matrixStore.get('toolPaneWindowGeometry').tree); });
    await drag('right', true);
    assert.equal(await page.evaluate(function () { return JSON.stringify(window.matrixStore.get('toolPaneWindowGeometry').tree); }), before, definition.name + ' Escape preserves positions');
    var divider = page.locator('#split-host > .split-view-divider').first();
    await divider.focus(); await page.keyboard.press('ArrowRight'); await settled();
    var resized = await page.evaluate(function () { return JSON.stringify(window.matrixStore.get('toolPaneWindowGeometry').tree); });
    assert.notEqual(resized, before, definition.name + ' divider resize persists');
    var live = await (await page.request.get(base + '/fixture/state')).json();
    var workspace = await page.evaluate(function () { var s = window.matrixStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); });
    assert.deepEqual(live.savedViews.views.find(function (v) { return v.id === workspace.id; }).workspace.tree, workspace.workspace.tree, definition.name + ' server stored the final geometry');
    await panel.locator(':scope > header button[aria-label^="Close"]').last().click(); await settled();
    await panel.waitFor({ state: 'hidden' });
  }
  for (var restricted of ['debates', 'mate-knowledge']) {
    assert.equal(await page.evaluate(async function (name) { var r = (await import('/p/reuse/modules/workbench-panels.js')).WORKBENCH_PANELS[name], api = await r.load(); api[r.open](); var p = document.getElementById(r.id); return !!p && !p.classList.contains('hidden'); }, restricted), false);
  }
  assert.deepEqual(errors, []);
});
