var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
async function fixture(t, compiled) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve) { child.once('message', resolve); }), browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1440, height: 900 } }), base = 'http://127.0.0.1:' + info.port, errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  if (!compiled) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json();
  // Test-only imports inspect source state without invoking a second compiled app.
  if (!compiled) await page.evaluate(async function () { window.pickerStore = (await import('/p/reuse/modules/store.js')).store; });
  return { page: page, data: data, errors: errors, base: base };
}
async function settled(page) {
  await page.waitForFunction(function () { var frames = Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe')); return frames.length > 0 && frames.every(function (frame) { var live = frame.clayPane && frame.clayPane.identity(); return live && live.ready; }); });
  await page.waitForFunction(function () { var s = window.pickerStore, v = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }), run = s.get('savedWorkspaceRuntime'); return v && document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe').length === v.sessions.length && !s.get('projectSplitViewPending') && !s.get('projectSplitViewError') && run && !run.restoring && !run.desired && !run.inflight; }, null, { timeout: 10000 }).catch(async function (error) { throw new Error(error.message + ' State: ' + JSON.stringify(await page.evaluate(function () { var s = window.pickerStore; return { error: s.get('projectSplitViewError'), pending: s.get('projectSplitViewPending'), run: s.get('savedWorkspaceRuntime') }; }))); });
}
test('directional picker inserts recent/search sessions and installed-vendor creations at the exact pane', { timeout: 90000 }, async function (t) {
  var f = await fixture(t), page = f.page, data = f.data;
  await page.locator('.session-item[data-session-id="' + data.standaloneId + '"]').first().click();
  await settled(page);
  var original = await page.evaluate(function () { var s = window.pickerStore; return { view: s.get('projectSplitViewActiveId'), origin: s.get('sessionOriginId') }; });
  var header = page.locator('#split-host > .split-pane:not(.split-pane-cached)').first(), trigger = header.getByRole('button', { name: 'Split view options', exact: true });
  var originalBox = await header.boundingBox();
  await header.locator('iframe').evaluate(function (frame) { window.originalSplitFrame = frame; window.originalSplitDocument = frame.contentDocument; });
  var initialRevision = await page.evaluate(function () { var s = window.pickerStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).revision; });
  await trigger.click(); var picker = page.locator('#split-view-create-menu');
  assert.equal(await picker.locator('[data-split-side]').count(), 4);
  await page.waitForFunction(function () { return document.querySelectorAll('#split-view-create-menu [data-split-side] svg').length === 4; });
  assert.equal(await picker.locator('[data-split-side] svg').count(), 4);
  await page.keyboard.press('ArrowDown'); await page.keyboard.press('Enter');
  assert.equal(await picker.locator('.split-view-arrange-header, [data-split-close]').count(), 0, 'The empty-pane picker has no title or close button');
  var empty = page.locator('.split-session-empty-pane'); await empty.waitFor();
  assert.equal(await empty.getAttribute('data-side'), 'left');
  assert.equal(await header.locator('iframe').evaluate(function (frame) { return frame === window.originalSplitFrame && frame.contentDocument === window.originalSplitDocument; }), true);
  assert.ok((await header.boundingBox()).width < originalBox.width * .6);
  assert.equal(await page.evaluate(function () { var s = window.pickerStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).revision; }), initialRevision, 'Reserving space does not persist a fake session');
  assert.equal(await picker.locator('[data-split-back]').count(), 0, 'The session picker starts directly with search');
  await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' }); await empty.waitFor({ state: 'detached' });
  assert.ok(Math.abs((await header.boundingBox()).width - originalBox.width) < 2);
  for (var cancelledSide of ['Top', 'Bottom']) {
    await trigger.click(); await picker.getByRole('button', { name: 'Add ' + cancelledSide + ' Split', exact: true }).click(); await empty.waitFor();
    var sourceBounds = await header.boundingBox(), reservedBounds = await empty.boundingBox(), popupBounds = await picker.boundingBox();
    assert.ok(sourceBounds.height < originalBox.height * .6);
    assert.ok(cancelledSide === 'Top' ? reservedBounds.y < sourceBounds.y : reservedBounds.y > sourceBounds.y);
    assert.ok(popupBounds.x >= reservedBounds.x && popupBounds.x + popupBounds.width <= reservedBounds.x + reservedBounds.width + 1);
    assert.ok(popupBounds.y >= reservedBounds.y && popupBounds.y + popupBounds.height <= reservedBounds.y + reservedBounds.height + 1);
    assert.equal(await empty.locator(':scope > header, [data-split-cancel-empty]').count(), 0);
    await page.keyboard.press('Escape'); await empty.waitFor({ state: 'detached' });
  }
  await trigger.click(); await picker.getByRole('button', { name: 'Add Right Split', exact: true }).click();
  await empty.waitFor();
  assert.equal(await empty.getAttribute('data-side'), 'right');
  var emptyBox = await empty.boundingBox(), pickerBox = await picker.boundingBox();
  assert.ok(emptyBox.x > (await header.boundingBox()).x);
  assert.ok(Math.abs(pickerBox.x + pickerBox.width / 2 - emptyBox.x - emptyBox.width / 2) < 3, 'Picker is centered inside the reserved pane');
  assert.equal(await empty.locator('#split-view-create-menu').count(), 1);
  assert.equal(await page.locator('#split-host > .split-pane:not(.split-pane-cached) iframe').count(), 1);
  await picker.getByRole('searchbox', { name: 'Search sessions' }).fill('Other standalone');
  assert.equal(await picker.locator('[data-split-session]').count(), 1);
  await page.keyboard.press('Enter'); await picker.waitFor({ state: 'hidden' }); await settled(page);
  var tree = await page.evaluate(function () { var s = window.pickerStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).tree; });
  assert.equal(tree.axis, 'horizontal'); assert.equal(tree.left.id, original.origin);
  var otherOrigin = tree.right.id;
  await empty.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(function () { return window.originalSplitFrame.isConnected && window.originalSplitFrame.contentDocument === window.originalSplitDocument; }), true);
  // Existing multi-pane Arrange keeps its layout controls; Choose sessions opens this same picker.
  await trigger.click(); await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Choose sessions', exact: true }).click();
  await picker.getByRole('button', { name: 'Add Top Split', exact: true }).click();
  await picker.locator('[data-split-vendor]').first().waitFor();
  var vendors = await page.evaluate(function () { return window.pickerStore.get('sessionCreateOptions').vendors.filter(function (v) { return v.installed; }).map(function (v) { return v.id; }).sort(); });
  assert.deepEqual((await picker.locator('[data-split-vendor]').evaluateAll(function (items) { return items.map(function (item) { return item.dataset.splitVendor; }).sort(); })), vendors);
  assert.equal(await picker.locator('[data-split-vendor] img').count(), vendors.length);
  await picker.locator('[data-split-vendor]').first().click(); await picker.waitFor({ state: 'hidden' });
  await page.waitForFunction(function () { var s = window.pickerStore, v = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return v && v.sessions.length === 3; }); await settled(page);
  var saved = await page.evaluate(function () { var s = window.pickerStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); });
  assert.equal(saved.id, original.view); assert.equal(saved.tree.axis, 'horizontal'); assert.equal(saved.tree.left.axis, 'vertical'); assert.equal(saved.tree.left.right.id, original.origin); assert.equal(saved.tree.right.id, otherOrigin);
  await trigger.click(); await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Focus selected session', exact: true }).click();
  await trigger.click(); await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Choose sessions', exact: true }).click();
  await picker.getByRole('button', { name: 'Add Right Split', exact: true }).click(); await empty.waitFor();
  assert.equal(await page.evaluate(function () { return window.pickerStore.get('projectSplitViewFocusedOrigin'); }), null);
  await page.keyboard.press('Escape'); await empty.waitFor({ state: 'detached' });
  assert.equal(await page.evaluate(function () { return window.pickerStore.get('projectSplitViewFocusedOrigin'); }), original.origin);
  await trigger.click(); await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Restore layout', exact: true }).click();
  var cdp = await page.context().newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  await page.reload(); await page.evaluate(async function () { window.pickerStore = (await import('/p/reuse/modules/store.js')).store; }); await settled(page);
  assert.deepEqual(await page.evaluate(function () { var s = window.pickerStore; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).tree; }), saved.tree);
  for (var side of ['Left', 'Bottom']) {
    var currentTrigger = page.locator('#split-host > .split-pane:not(.split-pane-cached)').filter({ has: page.locator('iframe[data-session-origin-id="' + original.origin + '"]') }).getByRole('button', { name: 'Split view options', exact: true });
    await currentTrigger.click(); await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Choose sessions', exact: true }).click();
    await picker.getByRole('button', { name: 'Add ' + side + ' Split', exact: true }).click();
    await picker.locator('[data-split-vendor]').first().waitFor(); await picker.locator('[data-split-vendor]').first().click();
    await page.waitForFunction(function (count) { var s = window.pickerStore, v = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return v && v.sessions.length === count; }, side === 'Left' ? 4 : 5); await settled(page);
    var branch = await page.evaluate(function (origin) { var s = window.pickerStore, v = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); function parent(node) { if (!node || node.id) return null; if (node.left.id === origin || node.right.id === origin) return node; return parent(node.left) || parent(node.right); } return parent(v.tree); }, original.origin);
    assert.equal(branch.axis, side === 'Left' ? 'horizontal' : 'vertical'); assert.equal(side === 'Left' ? branch.right.id : branch.left.id, original.origin);
  }
  await page.setViewportSize({ width: 760, height: 850 });
  await page.locator('#split-host .split-pane:not(.split-pane-cached) [data-action="arrange"]').first().click();
  await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Choose sessions', exact: true }).click();
  await picker.getByRole('button', { name: 'Add Bottom Split', exact: true }).click();
  var box = await picker.boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 760);
  await page.setViewportSize({ width: 1100, height: 850 });
  await empty.waitFor();
  var resizedEmpty = await empty.boundingBox(), resizedPicker = await picker.boundingBox();
  assert.ok(resizedPicker.x >= resizedEmpty.x && resizedPicker.x + resizedPicker.width <= resizedEmpty.x + resizedEmpty.width + 1);
  assert.equal(await empty.locator('#split-view-create-menu').count(), 1, 'Viewport changes keep the picker in its reserved pane');
  await page.keyboard.press('Escape'); await picker.waitFor({ state: 'hidden' }); await empty.waitFor({ state: 'detached' });
  assert.deepEqual(f.errors, []);
});

test('Sketch uses shared overlay/dock windows, retains docks behind overlays and restores its shell', { timeout: 90000 }, async function (t) {
  var f = await fixture(t), page = f.page;
  await page.locator('[data-split-view-id="' + f.data.restoreView.id + '"] .split-view-group-open').click(); await settled(page);
  await page.evaluate(async function () { (await import('/p/reuse/modules/wireframe-workbench.js')).openWireframe({ id: 'dock-check', title: 'Dock check', source: '@startsalt\n{ [Example] }\n@endsalt' }); });
  var panel = page.locator('#wireframe-panel'); await panel.locator('.workbench-layout-toggle').waitFor(); await panel.locator('.wireframe-workbench-canvas img').waitFor();
  assert.equal(await panel.getAttribute('data-workbench-placement'), 'overlay');
  await panel.locator('.workbench-layout-toggle').click(); await settled(page);
  await page.waitForFunction(function () { var panel = document.getElementById('wireframe-panel'); return panel && panel.dataset.toolWindowId; });
  assert.equal(await panel.locator(':scope > header').evaluate(function (el) { return getComputedStyle(el).height; }), '33px');
  var identity = await panel.getAttribute('data-tool-window-id');
  await page.evaluate(async function () { (await import('/p/reuse/modules/project-logs.js')).openProjectLogs(); });
  await page.locator('#project-logs-panel').waitFor({ state: 'visible' }); assert.equal(await panel.isVisible(), true); assert.equal(await panel.getAttribute('data-workbench-placement'), 'docked'); await settled(page);
  await page.reload(); await page.evaluate(async function () { window.pickerStore = (await import('/p/reuse/modules/store.js')).store; }); await settled(page);
  await panel.locator('.workbench-layout-toggle').waitFor(); assert.equal(await panel.getAttribute('data-tool-window-id'), identity);
  assert.equal(await panel.locator('[data-save]').isDisabled(), true, 'unsaved sketch source is not reconstructed from a layout descriptor');
  await page.locator('#project-logs-panel').getByRole('button', { name: 'Close Logs', exact: true }).click(); await settled(page);
  await panel.getByRole('button', { name: 'Toggle fullscreen', exact: true }).click(); await settled(page);
  assert.equal(await panel.evaluate(function (el) { return el.classList.contains('panel-fullscreen'); }), true);
  await panel.getByRole('button', { name: 'Toggle fullscreen', exact: true }).click(); await settled(page);
  await panel.getByRole('button', { name: 'Close clay-sketch', exact: true }).click(); await settled(page);
  await page.evaluate(async function () { (await import('/p/reuse/modules/wireframe-workbench.js')).restoreWireframeWorkbench(); });
  await panel.locator('.workbench-layout-toggle').waitFor(); assert.equal(await panel.getAttribute('data-workbench-placement'), 'overlay');
  assert.deepEqual(f.errors, []);
});


test('packaged app opens the four-direction picker, creates a split session and restores it', { timeout: 90000 }, async function (t) {
  var f = await fixture(t, true), page = f.page;
  await page.locator('.session-item[data-session-id="' + f.data.standaloneId + '"]').first().click();
  var panes = page.locator('#split-host > .split-pane:not(.split-pane-cached)');
  await panes.first().getByRole('button', { name: 'Split view options', exact: true }).click();
  var picker = page.locator('#split-view-create-menu'); await picker.locator('[data-split-side="right"]').click();
  await picker.getByRole('searchbox', { name: 'Search sessions' }).fill('Other standalone');
  await picker.locator('[data-split-session]').click();
  await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length === 2; });
  await panes.first().getByRole('button', { name: 'Split view options', exact: true }).click();
  await page.locator('#split-view-arrange-menu').getByRole('button', { name: 'Choose sessions', exact: true }).click();
  await picker.locator('[data-split-side="bottom"]').click(); await picker.locator('[data-split-vendor]').first().click();
  await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length === 3; });
  var ids = await panes.locator('iframe').evaluateAll(function (items) { return items.map(function (f) { return f.dataset.sessionOriginId; }).sort(); });
  await page.reload(); await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length === 3; });
  assert.deepEqual(await panes.locator('iframe').evaluateAll(function (items) { return items.map(function (f) { return f.dataset.sessionOriginId; }).sort(); }), ids);
  assert.deepEqual(f.errors, []);
});
