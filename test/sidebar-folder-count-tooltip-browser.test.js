var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var path = require('node:path');
var chromium = require('playwright').chromium;

test('folder and Favorites counts stay visible outside the scrollable sidebar', { timeout: 30000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_HIDE_BENCHMARK: '1' }),
    stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(function () { child.kill('SIGTERM'); });
  child.stdout.resume();
  child.stderr.resume();
  var info = await new Promise(function (resolve, reject) {
    child.once('message', resolve);
    child.once('error', reject);
    child.once('exit', function (code) { reject(new Error('Fixture exited with code ' + code)); });
  });
  var browser = await chromium.launch();
  t.after(function () { return browser.close(); });
  var origin = 'http://127.0.0.1:' + info.port;
  async function load(viewport) {
    var page = await browser.newPage({ viewport: viewport, reducedMotion: 'reduce' });
    page.setDefaultTimeout(5000);
    await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(origin + '/fixture/login');
    await page.evaluate(async function () {
      window.fixtureStore = (await import('/p/reuse/modules/store.js')).store;
    });
    await page.waitForFunction(function () {
      return window.fixtureStore.get('connected') && window.fixtureStore.get('projectSplitViewHydrated') &&
        window.fixtureStore.get('sessionFoldersSlug') === 'reuse';
    });
    return page;
  }

  function folderHeader(list, name) {
    return list.getByRole('button', { name: new RegExp('^(Expand|Collapse) ' + name + '\\.') });
  }
  async function assertTooltip(page, header, expected, below) {
    var tip = page.locator('#clay-tooltip.visible');
    var target = header.and(page.locator('[aria-describedby~="clay-tooltip"]'));
    await target.waitFor();
    await tip.getByText(expected, { exact: true }).waitFor();
    var geometry = await target.evaluate(function (button) {
      var el = document.getElementById('clay-tooltip');
      var headerBox = button.getBoundingClientRect();
      var bounds = el.getBoundingClientRect();
      // Temporarily enable hit testing to verify the tooltip isn't clipped or covered.
      el.style.pointerEvents = 'auto';
      var x = bounds.left + bounds.width / 2;
      var y = bounds.top + bounds.height / 2;
      var hits = [[bounds.left + 3, y], [bounds.right - 3, y], [x, bounds.top + 3], [x, bounds.bottom - 3]]
        .map(function (point) {
          var hit = document.elementFromPoint(point[0], point[1]);
          return hit && hit.id;
        });
      el.style.removeProperty('pointer-events');
      return {
        portaled: el.parentNode === document.body,
        inViewport: bounds.left >= 8 && bounds.right <= innerWidth - 8 && bounds.bottom <= innerHeight - 8 && bounds.top >= 8,
        below: bounds.top >= headerBox.bottom,
        above: bounds.bottom <= headerBox.top,
        hits: hits,
        visible: hits.every(function (id) { return id === el.id; }) && el.classList.contains('visible'),
      };
    });
    assert.ok(geometry.portaled && geometry.inViewport && geometry.visible &&
      (geometry.below || (!below && geometry.above)), JSON.stringify(geometry));
  }

  var page = await load({ width: 1280, height: 700 });
  var sidebar = page.locator('#session-list');
  var favorites = folderHeader(sidebar, 'Favorites');
  await favorites.hover();
  await assertTooltip(page, favorites, '0 Drivers · 0 Split Workers', true);
  assert.equal(await favorites.locator('.session-folder-count').textContent(), '0');
  await page.getByRole('button', { name: 'New folder', exact: true }).click();
  await page.getByPlaceholder('New folder', { exact: true }).fill('A');
  await page.getByRole('button', { name: 'Create folder', exact: true }).click();

  var folder = folderHeader(sidebar, 'A');
  await page.locator('#sidebar-column').evaluate(function (el) { el.style.width = '192px'; });
  await folder.locator('.session-folder-count').hover();
  await assertTooltip(page, folder, '0 Drivers · 0 Split Workers');
  var visibleTip = page.locator('#clay-tooltip.visible');
  await page.keyboard.press('Escape');
  await visibleTip.waitFor({ state: 'hidden' });
  await folder.focus();
  await assertTooltip(page, folder, '0 Drivers · 0 Split Workers');
  await page.keyboard.press('Enter');
  assert.equal(await folder.getAttribute('aria-expanded'), 'false');
  await visibleTip.waitFor({ state: 'hidden' });

  var state = await (await page.request.get(origin + '/fixture/state')).json();
  await page.evaluate(async function (driverId) {
    var ops = await import('/p/reuse/modules/session-folders.js');
    var folderId = ops.currentFolderState().folders.find(function (folder) { return folder.name === 'A'; }).id;
    ops.sendFolderOp({ op: 'place_session', sessionId: driverId, folderId: folderId });
    ops.sendFolderOp({ op: 'place_session', sessionId: driverId, folderId: 'favorites' });
    // Use real folder rows to make clipping and scrolling possible in the mobile sheet.
    for (var i = 1; i <= 8; i++) ops.sendFolderOp({ op: 'create_folder', name: 'Scroll fixture ' + i });
  }, state.groups[0].pair.driverId);
  await folderHeader(sidebar, 'Scroll fixture 8').waitFor();
  await favorites.getByText('1', { exact: true }).waitFor();
  await folder.hover();
  await assertTooltip(page, folder, '1 Driver · 1 Split Worker');
  await favorites.hover();
  await assertTooltip(page, favorites, '1 Driver · 1 Split Worker');

  var mobile = await load({ width: 320, height: 460 });
  await mobile.locator('#mob-tab-chat').click();
  var sheet = mobile.locator('#mobile-sheet');
  await sheet.locator('.mobile-sheet-content').evaluate(function (el) {
    return Promise.all(el.getAnimations().map(function (animation) { return animation.finished; }));
  });
  var mobileFavorites = folderHeader(sheet, 'Favorites');
  await mobileFavorites.hover();
  await assertTooltip(mobile, mobileFavorites, '1 Driver · 1 Split Worker');
  var mobileFolder = folderHeader(sheet, 'A');
  await mobileFolder.hover();
  await assertTooltip(mobile, mobileFolder, '1 Driver · 1 Split Worker');

  var scroller = sheet.locator('.mobile-sheet-list');
  var metrics = await scroller.evaluate(function (el) { return { top: el.scrollTop, max: el.scrollHeight - el.clientHeight }; });
  assert.ok(metrics.max > metrics.top, JSON.stringify(metrics));
  await mobile.mouse.wheel(0, 150);
  await mobile.waitForFunction(function (top) {
    return document.querySelector('#mobile-sheet .mobile-sheet-list').scrollTop > top;
  }, metrics.top, { timeout: 5000 });
  await mobile.locator('#clay-tooltip.visible').waitFor({ state: 'hidden' });
});
