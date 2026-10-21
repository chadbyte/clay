// Actual authenticated app, native pointer gestures, layout persistence and live pane documents.
var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path'), chromium = require('playwright').chromium;
test('title text renames while header whitespace previews and commits animated pane layouts', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env,
    { CLAY_PANE_PRESENTATION: '1', CLAY_PANE_DRAG: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); child.stdout.resume(); child.stderr.resume();
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1800, height: 1000 } }), errors = [], updates = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) { socket.on('framesent', function (event) {
    var message; try { message = JSON.parse(String(event.payload)); } catch (error) { return; }
    if (message.type === 'project_split_view_update') updates.push(message);
  }); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.addStyleTag({ content: 'aside[aria-label="Pane performance fixture"] { display:none; }' });
  var fixture = await (await page.request.get(base + '/fixture/state')).json();
  await page.locator('[data-split-view-id="' + fixture.restoreView.id + '"] .split-view-group-open').click();
  await page.waitForFunction(function () {
    var panes = document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)');
    return panes.length === 3 && Array.from(panes).every(function (pane) { var frame = pane.querySelector('iframe'); return frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready; });
  });
  var panes = page.locator('#split-host > .split-pane:not(.split-pane-cached)'), first = panes.nth(0), second = panes.nth(1);
  await first.locator('.split-pane-title').click();
  await first.locator('.split-pane-rename-input').waitFor({ state: 'visible' });
  await page.keyboard.press('Escape');
  var blank = first.locator('.split-pane-drag-space');
  assert.ok((await blank.boundingBox()).width >= 12);
  await blank.click(); assert.equal(await first.locator('.split-pane-rename-input').count(), 0, 'blank click does not rename');
  await page.evaluate(function () {
    window.dragOriginal = Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)')).map(function (pane) {
      var frame = pane.querySelector('iframe'); return { pane: pane, frame: frame, doc: frame.contentDocument, binding: frame.clayPane.identity().binding };
    });
  });
  var firstFrame = await (await first.locator('iframe').elementHandle()).contentFrame();
  await page.evaluate(function () { return Promise.all(window.dragOriginal.map(function (entry) { return entry.doc.fonts.ready; })); });
  await firstFrame.locator('#input').fill('Keep this unsent draft through rearrangement');
  await firstFrame.locator('#messages').hover();
  await page.mouse.wheel(0, -5000);
  await firstFrame.waitForFunction(function () { var m = document.getElementById('messages'); return m.scrollTop < m.scrollHeight - m.clientHeight - 100; });
  await page.waitForTimeout(200);
  await firstFrame.evaluate(function () { window.dragScrollTop = document.getElementById('messages').scrollTop; });
  async function currentTree() { return page.evaluate(async function () { var s = (await import('/p/reuse/modules/store.js')).store; return s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).tree; }); }
  async function begin(target, side) {
    var handle = await blank.boundingBox(), box = await target.boundingBox();
    var x = box.x + (side === 'left' ? 8 : side === 'right' ? box.width - 8 : box.width / 2);
    var y = box.y + (side === 'top' ? 8 : side === 'bottom' ? box.height - 8 : box.height / 2);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
    await page.mouse.down(); await page.mouse.move(x, y, { steps: 8 });
    return { x: x, y: y };
  }
  var original = await currentTree(), originalRect = await second.boundingBox(), count = updates.length;
  var point = await begin(second, 'center');
  var preview = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('projectSplitViewPreviewTree'); });
  assert.equal(await first.evaluate(function (el) { return getComputedStyle(el).opacity; }), '0.72', 'only the source pane fades while dragging');
  assert.equal(await second.evaluate(function (el) { return getComputedStyle(el).opacity; }), '1');
  assert.deepEqual(await first.evaluate(function (el) { var tint=getComputedStyle(el, '::after'); return {content:tint.content,events:tint.pointerEvents}; }), {content:'""',events:'none'}, 'source tint covers the pane without intercepting input');
  assert.equal(await second.evaluate(function (el) { return getComputedStyle(el, '::after').content; }), 'none', 'other panes are not tinted');
  assert.ok(preview && JSON.stringify(preview) !== JSON.stringify(original), 'actual geometry previews before a mutation');
  assert.equal(updates.length, count, 'pointer movement never persists a layout');
  var duration = await first.evaluate(function (el) { return getComputedStyle(el).transitionDuration; });
  assert.ok(duration.split(',').some(function (value) { return parseFloat(value) >= .2; }), 'pane travel is visibly animated');
  await page.waitForTimeout(340);
  await page.screenshot({ path: '/tmp/clay-pane-drag-tint.png' });
  var moved = await second.boundingBox(); assert.ok(Math.abs(moved.x - originalRect.x) > 100, 'other mounted pane moves out of the way');
  await page.mouse.move(point.x + 1, point.y + 1);
  assert.deepEqual(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('projectSplitViewPreviewTree'); }), preview, 'moving panes do not change the hit target');
  await page.keyboard.press('Escape'); await page.mouse.up(); await page.waitForTimeout(360);
  assert.equal(await first.evaluate(function (el) { return getComputedStyle(el).opacity; }), '1', 'cancellation restores opacity');
  assert.equal(await first.evaluate(function (el) { return getComputedStyle(el, '::after').content; }), 'none', 'cancellation removes the tint');
  assert.deepEqual(await currentTree(), original); assert.equal(updates.length, count);
  assert.ok(Math.abs((await second.boundingBox()).x - originalRect.x) < 2, 'cancel animates back');
  await begin(second, 'center');
  var expected = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('projectSplitViewPreviewTree'); });
  await page.mouse.up();
  await page.waitForFunction(async function (tree) { var s = (await import('/p/reuse/modules/store.js')).store; var v = s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }); return !s.get('projectSplitViewPending') && JSON.stringify(v.tree) === JSON.stringify(tree); }, expected);
  assert.equal(await first.evaluate(function (el) { return getComputedStyle(el).opacity; }), '1', 'drop restores opacity');
  assert.equal(await first.evaluate(function (el) { return getComputedStyle(el, '::after').content; }), 'none', 'drop removes the tint');
  assert.equal(updates.length, count + 1); assert.deepEqual(await currentTree(), expected);
  await page.waitForTimeout(350);
  await begin(second, 'bottom');
  expected = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('projectSplitViewPreviewTree'); });
  assert.ok(expected, 'edge placement also previews the full tree');
  await page.mouse.up();
  await page.waitForFunction(async function (tree) { var s = (await import('/p/reuse/modules/store.js')).store; return !s.get('projectSplitViewPending') && JSON.stringify(s.get('projectSplitViews').find(function (v) { return v.id === s.get('projectSplitViewActiveId'); }).tree) === JSON.stringify(tree); }, expected);
  await page.waitForTimeout(350);
  assert.equal(await firstFrame.locator('#input').inputValue(), 'Keep this unsent draft through rearrangement');
  assert.equal(await page.evaluate(function () { return window.dragOriginal.every(function (entry) { return entry.pane.isConnected && entry.frame.contentDocument === entry.doc && entry.frame.clayPane.identity().binding === entry.binding; }); }), true);
  assert.ok(await firstFrame.evaluate(function () { return Math.abs(document.getElementById('messages').scrollTop - window.dragScrollTop) < 5; }), 'reading position survives resizing: ' + JSON.stringify(await firstFrame.evaluate(function () { return import('/p/reuse/modules/chat-render-runtime.js').then(async function (m) { var s=(await import('/p/reuse/modules/store.js')).store; return { before: window.dragScrollTop, after: document.getElementById('messages').scrollTop, sticky: m.getStickyBottom(), last: s.get('paneLastUserScrollTop'), lock: s.get('paneLayoutScrollLock') }; }); })));
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.evaluate(async function () { (await import('/p/reuse/modules/theme.js')).applyTheme('clay-dark'); });
  await begin(second, 'center');
  assert.ok((await first.evaluate(function (el) { return getComputedStyle(el).transitionDuration; })).split(',').every(function (value) { return parseFloat(value) === 0; }));
  await page.keyboard.press('Escape'); await page.mouse.up();
  await page.reload();
  await page.waitForFunction(function () { return document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached)').length === 3; });
  assert.deepEqual(await currentTree(), expected, 'the committed layout survives reload');
  assert.deepEqual(errors, []);
});
