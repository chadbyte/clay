var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var path = require('node:path');
var chromium = require('playwright').chromium;
var material = require('./fixtures/chrome-material-assertions.cjs');
var dockBounds = require('./fixtures/dock-bounds-assertions.cjs');
var toolbarMaterial = require('./fixtures/session-toolbar-material-assertions.cjs');

['source', 'compiled'].forEach(function (runtime) {
  test('top menu glass has a continuous workspace backing: ' + runtime, { timeout: 60000 }, async function (t) {
    var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
    var browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage();
    if (runtime === 'source') await installSourceRuntime(page);
    var base = 'http://127.0.0.1:' + info.port;
    await page.goto(base + '/fixture/login');
    for (var mode of ['light', 'dark']) {
      for (var background of ['plain', 'workshop']) {
        var response = await page.request.put(base + '/api/user/appearance', { headers: { 'X-Clay-Settings': '1' },
          data: { mode: mode, theme: 'clay-' + mode, background: background, backgroundColor: 'sky' } });
        assert.equal(response.status(), 200);
        await page.reload();
        await page.waitForFunction(function (mode) { return document.documentElement.classList.contains(mode + '-theme'); }, mode);
        await material.assertMaterial(page, '#top-bar');
        await material.assertMaterial(page, '#sidebar-column');
        await material.assertFixedControl(page, '#top-bar');
        assert.equal(await page.locator('#top-bar').evaluate(function (element) {
          var probe = document.createElement('button');
          probe.style.cssText = 'position:absolute;top:40px;left:500px;width:20px;height:20px;z-index:150';
          element.appendChild(probe);
          var rect = probe.getBoundingClientRect();
          var hit = document.elementFromPoint(rect.x + 10, rect.y + 10) === probe;
          probe.remove(); return hit;
        }), true, 'top-bar popovers remain hit-testable beyond the menu over workspace content');
        var backing = await page.evaluate(function () {
          var layout = getComputedStyle(document.getElementById('layout'));
          var body = getComputedStyle(document.getElementById('layout-body'));
          var top = document.getElementById('top-bar'), rect = top.getBoundingClientRect();
          return { image: layout.backgroundImage, color: layout.backgroundColor, size: layout.backgroundSize,
            position: layout.backgroundPosition, bodyImage: body.backgroundImage, bodyColor: body.backgroundColor,
            height: rect.height, x: rect.x, y: rect.y, width: rect.width, opacity: getComputedStyle(top).opacity };
        });
        assert.equal(backing.bodyImage, 'none');
        assert.equal(backing.bodyColor, 'rgba(0, 0, 0, 0)', 'no second paint obscures or misaligns the shared backing');
        assert.equal(backing.color, mode === 'light' ? 'rgb(203, 223, 233)' : 'rgb(46, 63, 75)');
        if (background === 'workshop') assert.match(backing.image, new RegExp('workshop-' + mode + '\\.webp'));
        else assert.equal(backing.image, 'none');
        assert.equal(backing.size, 'cover'); assert.equal(backing.position, '50% 50%');
        assert.deepEqual([backing.x, backing.y, backing.width, backing.height, backing.opacity], [0, 0, 1280, 32, '1']);
        var glass = await page.screenshot({ clip: { x: 2, y: 2, width: 3, height: 3 } });
        var opaque = await page.addStyleTag({ content: '#top-bar::before { background: var(--chrome-material-solid) !important; backdrop-filter: none !important; -webkit-backdrop-filter: none !important; }' });
        var solid = await page.screenshot({ clip: { x: 2, y: 2, width: 3, height: 3 } });
        await opaque.evaluate(function (element) { element.remove(); });
        assert.notDeepEqual(glass, solid, 'workspace backing actually contributes pixels through the menu glass');
      }
      var custom = { id: 'custom-menu', name: 'Menu review', light: '#a8cad5', dark: '#304858' };
      assert.equal((await page.request.put(base + '/api/user/appearance', { headers: { 'X-Clay-Settings': '1' },
        data: { background: 'plain', backgroundColor: custom.id, customBackgroundColors: [custom] } })).status(), 200);
      await page.reload();
      assert.equal(await page.locator('#layout').evaluate(function (element) { return getComputedStyle(element).backgroundColor; }),
        mode === 'light' ? 'rgb(168, 202, 213)' : 'rgb(48, 72, 88)', 'explicit saved custom colors still back the global menu');
      await material.assertMaterial(page, '#top-bar');
    }
    await material.assertTransparencyFallback(page, ['#top-bar']);
    await assertDockFallbacks(page);
    await page.locator('#project-logs-btn').click();
    await page.locator('#project-logs-fullscreen').click();
    await page.waitForFunction(function () { return document.getElementById('project-logs-panel').classList.contains('panel-fullscreen'); });
    await material.assertMaterial(page, '#top-bar');
    assert.equal((await page.locator('#top-bar').boundingBox()).height, 32);
    await page.locator('#project-logs-close').click();
    await page.locator('#server-settings-btn').focus();
    assert.equal(await page.locator('#server-settings-btn').evaluate(function (element) { return element === document.activeElement; }), true);
    for (var width of [1050, 820, 600]) {
      await page.setViewportSize({ width: width, height: 800 });
      assert.equal(await page.locator('#top-bar').isVisible(), width > 768);
      if (width > 768) assert.equal((await page.locator('#top-bar').boundingBox()).height, 32);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    for (var state of ['projects-shell', 'mate-workspace-active', 'pane-mode']) {
      await page.evaluate(function (state) { document.body.classList.add(state); }, state);
      if (state === 'pane-mode') assert.equal(await page.locator('#top-bar').isVisible(), false);
      else await material.assertMaterial(page, '#top-bar');
      await page.evaluate(function (state) { document.body.classList.remove(state); }, state);
    }
  });
});

async function installSourceRuntime(page) {
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.route(/\/pane-assets\/style-[^/]+\.css(?:\?.*)?$/, function (route) {
    var url = new URL(route.request().url());
    var stylesheet = url.pathname.replace(/pane-assets\/[^/]+$/, 'style.css');
    return route.fulfill({ contentType: 'text/css', body: '@import url(' + JSON.stringify(stylesheet) + ');' });
  });
}

function geometry() {
  var result = { overflow: document.documentElement.scrollWidth > innerWidth };
  ['top-bar', 'navigation-island', 'icon-strip', 'sidebar-column', 'main-area', 'user-island'].forEach(function (id) {
    var element = document.getElementById(id), rect = element.getBoundingClientRect(), style = getComputedStyle(element);
    result[id] = { x: rect.x, y: rect.y, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height,
      display: style.display, border: style.borderTopWidth, radius: style.borderTopLeftRadius };
  });
  var panes = Array.from(document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached)')).filter(function (pane) {
    return pane.getBoundingClientRect().width > 0 && getComputedStyle(pane).display !== 'none';
  });
  var surfaces = panes.length ? panes : [document.getElementById('main-column')];
  var bounds = surfaces.map(function (surface) { return surface.getBoundingClientRect(); });
  result.session = { x: Math.min.apply(null, bounds.map(function (r) { return r.left; })), y: Math.min.apply(null, bounds.map(function (r) { return r.top; })),
    right: Math.max.apply(null, bounds.map(function (r) { return r.right; })), bottom: Math.max.apply(null, bounds.map(function (r) { return r.bottom; })) };
  result.sessionBorders = surfaces.map(function (surface) { return getComputedStyle(surface).borderTopWidth; });
  result.paneCount = panes.length;
  result.canvasMargin = getComputedStyle(document.getElementById('main-panels')).margin;
  result.canvasShadow = getComputedStyle(document.getElementById('main-panels')).boxShadow;
  result.viewport = { width: innerWidth, height: innerHeight };
  return result;
}

test('top menu glass in native Mate and project shells', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  for (var runtime of ['source', 'compiled']) {
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage();
    if (runtime === 'source') await installSourceRuntime(page);
    var base = 'http://127.0.0.1:' + info.port;
    await page.goto(base + '/fixture/login?to=alpha');
    for (var slug of ['alpha', info.sourceSlug, info.ordinaryMates[0].slug]) {
      await page.goto(base + '/p/' + slug + '/');
      if (slug !== 'alpha') await page.locator('body.mate-workspace-active').waitFor();
      await material.assertMaterial(page, '#top-bar');
      assert.equal((await page.locator('#top-bar').boundingBox()).height, 32);
      assert.equal(await page.locator('#layout-body').evaluate(function (element) { return getComputedStyle(element).backgroundImage; }), 'none');
    }
    await context.close();
  }
});

function assertSurfaceRhythm(measure, label) {
  assert.equal(measure.session.y, measure['navigation-island'].y, label + ': visible surface shares the island top');
  assert.equal(measure.session.bottom, measure['navigation-island'].bottom, label + ': visible surface shares the island bottom');
  assert.equal(measure['icon-strip'].y, measure['sidebar-column'].y, label + ': rail and sidebar tops align');
  assert.equal(measure['icon-strip'].bottom, measure['sidebar-column'].bottom, label + ': rail and sidebar bottoms align');
  assert.equal(measure.session.x - measure['navigation-island'].right, 6, label + ': one shell gutter between surfaces');
  assert.equal(measure['sidebar-column'].x - measure['icon-strip'].right, measure['sidebar-column'].width ? 6 : 0, label + ': separate rail and sidebar islands keep a 6px gap');
  assert.equal(measure.viewport.width - measure.session.right, 6, label + ': one shell gutter at the right');
  assert.equal(measure.viewport.height - measure.session.bottom, 6, label + ': one shell gutter at the bottom');
  assert.equal(measure.session.y - measure['top-bar'].bottom, 6, label + ': one shell gutter below the top bar');
  assert.equal(measure['main-area'].border, '0px', label + ': no nested workspace frame');
  assert.ok(measure.sessionBorders.every(function (border) { return border === '1px'; }), label + ': visible surfaces own their single border');
}

async function assertDock(page, solid) {
  await material.assertMaterial(page, '#top-bar', solid);
  await material.assertMaterial(page, '#navigation-island > #icon-strip', solid);
  var face = await page.locator('#icon-strip').evaluate(function (element) {
    var style = getComputedStyle(element, '::before');
    var canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
    var paint = canvas.getContext('2d'); paint.fillStyle = style.backgroundColor; paint.fillRect(0, 0, 1, 1);
    return { alpha: paint.getImageData(0, 0, 1, 1).data[3] / 255, width: element.getBoundingClientRect().width,
      inset: [style.top, style.right, style.bottom, style.left],
      targets: Array.from(element.querySelectorAll('.icon-strip-item')).filter(function (item) { return item.getBoundingClientRect().width > 0; }).map(function (item) { return [item.getBoundingClientRect().width, item.getBoundingClientRect().height]; }) };
  });
  if (solid) assert.equal(face.alpha, 1, 'Dock fallback is actually opaque');
  else assert.ok(face.alpha > .72 && face.alpha < .76, 'Dock face has shared 74% material alpha');
  assert.equal(face.width, 72);
  await dockBounds.assertBounds(page);
  assert.ok(face.targets.length > 0 && face.targets.every(function (size) { return size[0] === 48 && size[1] === 48; }), 'Dock targets retain 48px geometry');
}

async function assertDockFallbacks(page) {
  var client = await page.context().newCDPSession(page);
  try {
    for (var feature of ['prefers-reduced-transparency', 'forced-colors']) {
      await client.send('Emulation.setEmulatedMedia', { features: [{ name: feature, value: feature === 'forced-colors' ? 'active' : 'reduce' }] });
      await assertDock(page, true);
    }
  } finally {
    await client.send('Emulation.setEmulatedMedia', { features: [] });
    await client.detach();
  }
  // Simulate an unsupported browser by excluding only backdrop @supports
  // branches in the actual loaded stylesheets, including source @imports.
  await page.evaluate(function () {
    var removed = []; window.__dockUnsupportedRules = removed;
    function exclude(sheet) {
      var rules; try { rules = sheet.cssRules; } catch (error) { return; }
      for (var i = rules.length - 1; i >= 0; i--) {
        var rule = rules[i];
        if (rule.styleSheet) exclude(rule.styleSheet);
        else if (rule.type === CSSRule.SUPPORTS_RULE && rule.conditionText.includes('backdrop-filter')) {
          removed.push({ sheet: sheet, index: i, text: rule.cssText }); sheet.deleteRule(i);
        } else if (rule.cssRules) exclude(rule);
      }
    }
    Array.from(document.styleSheets).forEach(exclude);
    if (!removed.length) throw new Error('No loaded backdrop support branch found');
  });
  try { await assertDock(page, true); }
  finally {
    await page.evaluate(function () {
      window.__dockUnsupportedRules.reverse().forEach(function (item) { item.sheet.insertRule(item.text, item.index); });
      delete window.__dockUnsupportedRules;
    });
  }
  await assertDock(page, false);
}

async function assertWallpaper(page, theme) {
  await page.locator('#user-account-trigger').click();
  await page.locator('.account-settings-button').click();
  if (await page.locator('#settings-page-select').isVisible()) await page.locator('#settings-page-select').selectOption('us-appearance');
  else await page.locator('#settings-page-nav [data-section="us-appearance"]').click();
  await page.getByRole('radio', { name: 'Workshop', exact: true }).click();
  await page.locator('#us-appearance-status').filter({ hasText: 'Saved.' }).waitFor();
  await page.locator('#settings-shell-close').click();
  await page.waitForFunction(function () { return document.documentElement.dataset.workspaceBackground === 'workshop'; });
  var selected = await page.locator('#layout').evaluate(function (element) {
    var style = getComputedStyle(element);
    return { image: style.backgroundImage, size: style.backgroundSize, position: style.backgroundPosition };
  });
  assert.match(selected.image, new RegExp('/workspace-art/workshop-' + theme + '\\.webp'));
  assert.equal(selected.size, 'cover');
  assert.equal(selected.position, '50% 50%');
  var url = selected.image.slice(5, -2);
  var response = await page.request.get(url);
  assert.equal(response.status(), 200);
  assert.match(response.headers()['content-type'], /image\/webp/);
  var bytes = await response.body();
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WEBP');
  assert.ok(bytes.length > 10000);
  var image = await page.evaluate(async function (url) {
    var bitmap = await createImageBitmap(await (await fetch(url)).blob());
    return { width: bitmap.width, height: bitmap.height };
  }, url);
  assert.deepEqual(image, { width: 1672, height: 941 });
  assert.equal(await page.locator('#main-column').evaluate(function (element) { return getComputedStyle(element).backgroundColor; }), 'rgba(0, 0, 0, 0)');
}

async function waitForPaneResize(page) {
  await page.waitForFunction(function () {
    var host = document.getElementById('split-host'), style = getComputedStyle(host), bounds = host.getBoundingClientRect();
    var panes = Array.from(host.querySelectorAll('.split-pane:not(.split-pane-cached)')).map(function (pane) { return pane.getBoundingClientRect(); }).filter(function (rect) { return rect.width > 0; });
    return panes.length && Math.max.apply(null, panes.map(function (rect) { return rect.right; })) === bounds.right - (parseFloat(style.paddingRight) || 0) &&
      Math.max.apply(null, panes.map(function (rect) { return rect.bottom; })) === bounds.bottom - (parseFloat(style.paddingBottom) || 0);
  });
}

async function checkNavigationReopen(page, label) {
  await page.locator('#sidebar-toggle-btn').click();
  await page.waitForFunction(function () { return document.getElementById('sidebar-column').getBoundingClientRect().width === 0; });
  if (await page.locator('#split-host.visible').count()) await waitForPaneResize(page);
  var opener = page.locator('#sidebar-shell-expand-btn');
  await opener.waitFor();
  await page.waitForFunction(function () { return document.activeElement.id === 'sidebar-shell-expand-btn'; });
  var nav = await page.locator('#navigation-island').boundingBox(), button = await opener.boundingBox();
  assert.ok(button.x >= nav.x && button.y >= nav.y && button.x + button.width <= nav.x + nav.width && button.y + button.height <= nav.y + nav.height, label + ': reopen is contained by navigation');
  assert.ok(button.y - nav.y < 100, label + ': reopen stays near the top of the rail');
  assert.equal(await opener.getAttribute('aria-label'), 'Open sidebar');
  assert.equal(await opener.getAttribute('aria-expanded'), 'false');
  assert.match(await opener.getAttribute('aria-controls'), /\bsidebar-column\b/);
  assert.equal(await page.locator('#sidebar-shell-expand-btn').count(), 1);
  assert.equal(await page.locator('#main-column #sidebar-expand-btn:visible, #main-column .split-pane-sidebar:visible').count(), 0, label + ': no duplicate session reopen control');
  assertSurfaceRhythm(await page.evaluate(geometry), label + ' collapsed');
  await dockBounds.assertShortRail(page);
  await opener.press('Enter');
  await page.waitForFunction(function () { return document.activeElement.id === 'sidebar-toggle-btn' && document.getElementById('sidebar-column').getBoundingClientRect().width > 0; });
  assert.equal(await opener.isVisible(), false);
  assert.equal(await page.locator('#sidebar-toggle-btn').getAttribute('aria-expanded'), 'true');
  await page.waitForFunction(function () { return !document.getElementById('sidebar-column').getAnimations().length; });
  if (await page.locator('#split-host.visible').count()) await waitForPaneResize(page);
  assertSurfaceRhythm(await page.evaluate(geometry), label + ' reopened');
}

// Measure while the mouse is held, with normal motion, so width easing cannot
// hide behind a final mouseup or reduced-motion override.
async function checkHeldResize(page, columnId, handleId, label) {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  assert.equal(await page.evaluate(function () { return matchMedia('(prefers-reduced-motion: reduce)').matches; }), false);
  for (var target of [192, 320, 240]) {
    var column = page.locator('#' + columnId);
    var handle = await page.locator('#' + handleId).boundingBox();
    var left = (await column.boundingBox()).x, dragY = handle.y + 10;
    await page.mouse.move(handle.x + 4, dragY);
    await page.mouse.down();
    for (var width of [Math.min(320, Math.max(192, target - 24)), target]) {
      await page.mouse.move(left + width, dragY, { steps: 2 });
      var live = await column.evaluate(function (element, handleId) {
        var style = getComputedStyle(element), rect = element.getBoundingClientRect();
        var nav = document.getElementById('navigation-island').getBoundingClientRect();
        var rail = document.getElementById('icon-strip').getBoundingClientRect();
        return { width: rect.width, duration: style.transitionDuration,
          dragging: document.getElementById(handleId).classList.contains('dragging'),
          innerGap: rect.left - rail.right, outerGap: document.getElementById('main-area').getBoundingClientRect().left - nav.right };
      }, handleId);
      assert.ok(live.dragging, label + ': real pointer holds the handle');
      assert.equal(live.duration, '0s', label + ': drag disables width easing');
      var minimum = await column.evaluate(function (element) { return parseFloat(getComputedStyle(element).minWidth) || 0; });
      assert.equal(live.width, Math.max(minimum, width), label + ': intermediate width immediately follows pointer within existing CSS bounds');
      assert.equal(live.innerGap, 6, label + ': inner gap stays stable');
      assert.equal(live.outerGap, 6, label + ': outer gap stays stable');
    }
    await page.mouse.up();
    assert.equal((await column.boundingBox()).width, Math.max(minimum, target), label + ': released width');
  }
  await page.emulateMedia({ reducedMotion: 'reduce' });
}

['source', 'compiled'].forEach(function (runtime) {
  test('navigation island production shell: ' + runtime, { timeout: 120000 }, async function (t) {
    // The fixture redirects os.homedir and all product storage before imports,
    // fences provider processes/completions and Git writes, and uses demo users.
    var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume();
    t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
    var browser = await chromium.launch();
    t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(), errors = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    if (runtime === 'source') await installSourceRuntime(page);
    var base = 'http://127.0.0.1:' + info.port;
    await page.goto(base + '/fixture/login');
    await page.locator('.session-item').first().waitFor();
    await page.locator('#sidebar-toggle-btn').waitFor();
    await page.locator('#split-host .split-pane').first().waitFor();
    var measure = await page.evaluate(geometry);
    assert.equal(measure.paneCount, 1);
    assertSurfaceRhythm(measure, runtime + ' standalone');
    await material.assertMaterial(page, '#navigation-island > #icon-strip');
    await material.assertMaterial(page, '#sidebar-column');
    await material.assertMaterial(page, '#split-host .split-pane-header');
    await material.assertFixedControl(page, '#navigation-island > #icon-strip');
    await material.assertFixedControl(page, '#sidebar-column');
    await material.assertFixedControl(page, '#split-host .split-pane-header');
    await material.assertTransparencyFallback(page, ['#navigation-island > #icon-strip', '#sidebar-column', '#split-host .split-pane-header']);
    var dock = await page.evaluate(function () {
      var rail = document.getElementById('icon-strip');
      var active = rail.querySelector('.icon-strip-item.active, .icon-strip-home.active');
      var face = getComputedStyle(rail, '::before');
      var marker = active && getComputedStyle(active.querySelector('.icon-strip-pill'));
      return { width: rail.getBoundingClientRect().width, faceBorder: face.borderTopWidth,
        faceRadius: face.borderTopLeftRadius, inset: [face.top, face.right, face.bottom, face.left],
        targets: Array.from(rail.querySelectorAll('.icon-strip-item')).filter(function (element) { return element.getBoundingClientRect().width > 0; }).map(function (element) { return [element.getBoundingClientRect().width, element.getBoundingClientRect().height]; }), active: !!active,
        markerVisible: !!marker && marker.opacity === '1' && marker.width === '12px' };
    });
    assert.equal(dock.width, 72, runtime + ': Dock keeps the existing rail footprint');
    assert.equal(dock.faceBorder, '1px');
    assert.equal(dock.faceRadius, '12px');
    await dockBounds.assertShortRail(page);
    assert.ok(dock.targets.length > 0);
    assert.ok(dock.targets.every(function (size) { return size[0] === 48 && size[1] === 48; }), 'Dock targets keep their 48px footprint');
    assert.ok(dock.active && dock.markerVisible, runtime + ': selected destination remains visibly marked');
    await checkNavigationReopen(page, runtime + ' standalone');
    await page.getByRole('button', { name: /^Open Split view Driver/ }).click();
    await page.waitForFunction(function () { return document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached)').length === 2; });
    measure = await page.evaluate(geometry);
    assertSurfaceRhythm(measure, runtime + ' split');
    await checkNavigationReopen(page, runtime + ' split');
    await page.locator('#sidebar .session-folder-unfiled .session-item').filter({ hasText: 'Standalone' }).first().click();
    await page.waitForFunction(function () { return document.querySelectorAll('#split-host .split-pane:not(.split-pane-cached)').length === 1; });
    measure = await page.evaluate(geometry);
    assert.equal(measure['top-bar'].x, 0);
    assert.equal(measure['top-bar'].width, 1280);
    assert.equal(measure['top-bar'].height, 32);
    assert.equal(measure['navigation-island'].y - measure['top-bar'].bottom, 6);
    assert.equal(measure['main-area'].x - measure['navigation-island'].right, 6);
    assert.equal(measure['navigation-island'].width, 318);
    assert.equal(measure['icon-strip'].width, 72);
    assert.equal(measure['sidebar-column'].width, 240);
    assert.equal(measure['sidebar-column'].x - measure['icon-strip'].right, 6);
    assert.equal(measure['navigation-island'].border, '0px');
    assert.equal(measure['navigation-island'].radius, '0px');
    var railStyle = await page.locator('#icon-strip').evaluate(function (element) {
      var style = getComputedStyle(element);
      return { background: style.backgroundColor, border: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
        radius: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius], shadow: style.boxShadow };
    });
    assert.equal(railStyle.background, 'rgba(0, 0, 0, 0)', 'Dock has no redundant outer background');
    assert.deepEqual(railStyle.border, ['0px', '0px', '0px', '0px'], 'Dock has no redundant outer border');
    assert.deepEqual(railStyle.radius, ['0px', '0px', '0px', '0px'], 'Dock has no redundant outer frame corners');
    assert.equal(railStyle.shadow, 'none', 'Dock has no redundant outer shadow');
    var sidebarStyle = await page.locator('#sidebar-column').evaluate(function (element) {
        var style = getComputedStyle(element);
        return { borders: [style.borderTopWidth, style.borderRightWidth, style.borderBottomWidth, style.borderLeftWidth],
          radii: [style.borderTopLeftRadius, style.borderTopRightRadius, style.borderBottomRightRadius, style.borderBottomLeftRadius] };
      });
    assert.deepEqual(sidebarStyle.borders, ['1px', '1px', '1px', '1px'], 'sidebar keeps its complete outline');
    assert.deepEqual(sidebarStyle.radii, ['12px', '12px', '12px', '12px'], 'sidebar keeps all four panel corners');
    assert.ok(measure['user-island'].bottom < measure['navigation-island'].bottom);
    assert.equal(measure.overflow, false);

    await checkHeldResize(page, 'sidebar-column', 'sidebar-resize-handle', runtime + ' project');

    await page.locator('#title-bar-project-dropdown').click();
    await page.locator('.project-ctx-menu').waitFor();
    var menu = await page.locator('.project-ctx-menu').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= 1280);
    await page.keyboard.press('Escape');
    await page.locator('.session-item').first().click({ button: 'right' });
    await page.locator('.session-ctx-menu').waitFor();
    assert.ok((await page.locator('.session-ctx-menu').boundingBox()).width > 0);
    await page.keyboard.press('Escape');
    await page.locator('#user-account-trigger').click();
    await page.locator('#account-popover').waitFor();
    await page.keyboard.press('Escape');

    await page.locator('#server-settings-btn').click();
    await page.locator('#settings-shell:not(.hidden)').waitFor();
    var settings = await page.locator('#settings-shell').boundingBox();
    assert.deepEqual(settings, { x: 0, y: 0, width: 1280, height: 800 });
    await page.locator('.settings-shell-close').click();

    // Exercise one real workbench through its existing overlay/dock controls.
    await page.getByRole('button', { name: 'Logs', exact: true }).click();
    var logs = page.locator('#project-logs-panel');
    await logs.waitFor();
    await material.assertMaterial(page, '#project-logs-panel > .tool-pane-header');
    await material.assertFixedControl(page, '#project-logs-panel > .tool-pane-header');
    await logs.locator('.workbench-layout-toggle').click();
    await page.waitForFunction(function () { return document.getElementById('project-logs-panel').dataset.workbenchPlacement === 'docked'; });
    measure = await page.evaluate(geometry);
    assert.equal(measure['main-area'].x - measure['navigation-island'].right, 6);
    await logs.locator('.workbench-layout-toggle').click();
    await page.waitForFunction(function () { return document.getElementById('project-logs-panel').dataset.workbenchPlacement === 'overlay'; });
    await page.locator('#project-logs-fullscreen').click();
    await page.waitForFunction(function () { return document.getElementById('project-logs-panel').classList.contains('panel-fullscreen'); });
    var expanded = await logs.boundingBox();
    assert.ok(expanded.y > measure['top-bar'].bottom);
    assert.ok(expanded.x > measure['navigation-island'].right);
    await page.locator('#project-logs-fullscreen').click();
    await page.locator('#project-logs-close').click();

    var transfer = await page.evaluateHandle(function () { return new DataTransfer(); });
    await page.locator('#sidebar .session-folder-unfiled .session-item').first().dispatchEvent('dragstart', { dataTransfer: transfer });
    await page.locator('#sidebar .session-folder-favorites').dispatchEvent('dragover', { dataTransfer: transfer });
    await page.locator('#sidebar .session-folder-favorites').dispatchEvent('drop', { dataTransfer: transfer });
    await page.locator('#sidebar .session-folder-favorites .session-item').first().waitFor();
    await page.getByRole('button', { name: 'New folder', exact: true }).click();
    await page.locator('#sidebar .session-folder-create-input').fill('Review');
    await page.locator('#sidebar .session-folder-create-input').press('Enter');
    var folder = page.locator('#sidebar .session-folder-folder .session-folder-toggle').filter({ hasText: 'Review' });
    await folder.waitFor();
    await folder.focus(); await folder.press('Shift+F10');
    await page.locator('.session-folder-menu').waitFor();
    var folderMenu = await page.locator('.session-folder-menu').boundingBox();
    assert.ok(folderMenu.x >= 0 && folderMenu.x + folderMenu.width <= 1280);
    await page.keyboard.press('Escape');
    assert.equal(await folder.evaluate(function (element) { return element === document.activeElement; }), true);

    await page.locator('#sidebar-toggle-btn').click();
    await page.waitForFunction(function () { return document.getElementById('sidebar-column').getBoundingClientRect().width === 0; });
    await waitForPaneResize(page);
    measure = await page.evaluate(geometry);
    assert.equal(measure['navigation-island'].width, 72);
    assert.equal(measure['sidebar-column'].x - measure['icon-strip'].right, 0);
    assert.equal(measure['main-area'].x - measure['navigation-island'].right, 6);
    assertSurfaceRhythm(measure, runtime + ' collapsed');
    await page.locator('#sidebar-shell-expand-btn').click();
    await page.waitForFunction(function () { return document.getElementById('sidebar-column').getBoundingClientRect().width === 240; });

    // Real embedded clients must remain flush; the parent owns outer chrome.
    await page.locator('#split-host iframe').first().waitFor();
    var frame = await (await page.locator('#split-host iframe').first().elementHandle()).contentFrame();
    await frame.locator('body.pane-mode').waitFor();
    assert.equal(await frame.locator('#sidebar-shell-expand-btn').count(), 0, 'embedded clients do not acquire a second rail control');
    var embedded = await frame.locator('body').evaluate(function () {
      var body = document.getElementById('layout-body'), main = document.getElementById('main-area');
      return { padding: getComputedStyle(body).padding, gap: getComputedStyle(body).gap,
        navigation: getComputedStyle(document.getElementById('navigation-island')).display,
        image: getComputedStyle(body).backgroundImage,
        x: main.getBoundingClientRect().x, y: main.getBoundingClientRect().y, border: getComputedStyle(main).borderTopWidth };
    });
    assert.equal(embedded.padding, '0px');
    assert.equal(embedded.image, 'none', 'embedded clients never repeat the wallpaper');
    assert.equal(embedded.navigation, 'none');
    assert.equal(embedded.x, 0); assert.equal(embedded.y, 0); assert.equal(embedded.border, '0px');

    for (var theme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForFunction(function (theme) { return document.documentElement.classList.contains(theme + '-theme'); }, theme);
      for (var width of [1280, 769, 768, 390]) {
        await page.setViewportSize({ width: width, height: 800 });
        await waitForPaneResize(page);
        measure = await page.evaluate(geometry);
        assert.equal(measure.overflow, false, theme + ' ' + width);
        if (width > 768) {
          await assertWallpaper(page, theme);
          await assertDock(page, false);
          if (width === 1280) { await assertDockFallbacks(page); await toolbarMaterial.assertToolbar(page, theme); }
          assert.equal(await page.locator('#main-panels').evaluate(function (element) { return getComputedStyle(element).backgroundColor; }), 'rgba(0, 0, 0, 0)');
          await material.assertMaterial(page, '#sidebar-column');
          await material.assertMaterial(page, '#split-host .split-pane-header');
          assert.equal(measure['navigation-island'].display, 'flex');
          assert.equal(measure['main-area'].x - measure['navigation-island'].right, 6);
          assertSurfaceRhythm(measure, runtime + ' ' + theme + ' ' + width);
        } else {
          assert.equal(measure['navigation-island'].display, 'contents');
          assert.equal(measure['icon-strip'].display, 'none');
          assert.equal(measure['sidebar-column'].display, 'none');
          assert.equal(measure['main-area'].x, 0);
          assert.equal(await page.locator('#sidebar-shell-expand-btn:visible').count(), 0);
          assert.ok(await page.locator('.split-pane-sidebar:visible').count() > 0, 'mobile pane navigation control remains available');
        }
      }
    }
    assert.deepEqual(errors, []);
  });
});

test('native Clay and mapped Mate workspaces retain separate navigation islands', { timeout: 90000 }, async function (t) {
  // This fixture seeds actual backing Mate projects and conversations; the
  // appearance fixture above intentionally has no native Mate conversation.
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  for (var runtime of ['source', 'compiled']) {
    var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    var page = await context.newPage(); page.setDefaultTimeout(10000);
    if (runtime === 'source') await installSourceRuntime(page);
    var base = 'http://127.0.0.1:' + info.port;
    await page.goto(base + '/fixture/login?to=alpha');
    await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
    await page.locator('.icon-strip-brand').click();
    await page.locator('#contextual-clay > header').waitFor();
    await material.assertMaterial(page, '#contextual-clay > header');
    await page.locator('#contextual-clay [data-clay-close]').click();
    for (var slug of [info.sourceSlug, info.ordinaryMates[0].slug]) {
      await page.goto(base + '/p/' + slug + '/');
      await page.locator('body.mate-workspace-active').waitFor();
      assert.equal(await page.locator('.split-view-workers:visible').count(), 0, 'Native Mate conversations have no Worker chip row');
      await material.assertMaterial(page, '#sidebar-column');
      await material.assertMaterial(page, '#main-column > .title-bar-content');
      var identity = await page.locator('#sidebar-column').evaluate(function (element) {
        var style = getComputedStyle(element);
        return { material: style.getPropertyValue('--chrome-material-solid').trim(), surround: style.getPropertyValue('--clay-surround').trim() };
      });
      assert.equal(identity.material, identity.surround, 'Mate glass retains its identity pigment');
      var measured = await page.evaluate(geometry);
      assert.equal(measured['navigation-island'].y - measured['top-bar'].bottom, 6);
      assert.equal(measured['main-area'].x - measured['navigation-island'].right, 6);
      assert.equal(measured.overflow, false);
      assertSurfaceRhythm(measured, runtime + ' ' + slug);
      await dockBounds.assertShortRail(page);
      assert.equal(measured.canvasMargin, '0px');
      assert.equal(measured.canvasShadow, 'none');
      assert.equal(await page.locator('#main-panels').evaluate(function (element) { return getComputedStyle(element).backgroundColor; }), 'rgba(0, 0, 0, 0)', 'Native canvas lets expanded tools reach the shell');
      await checkNavigationReopen(page, runtime + ' ' + slug);
      for (var theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(function (theme) { return document.documentElement.classList.contains(theme + '-theme'); }, theme);
        await assertWallpaper(page, theme);
        await toolbarMaterial.assertToolbar(page, theme);
        await material.assertMaterial(page, '#navigation-island > #icon-strip');
        await material.assertMaterial(page, '#main-column > .title-bar-content');
      }
    }
    {
      await page.evaluate(async function (input) {
        var mate = input.mate;
        // Native Mate workspaces use the project sidebar. Exercise the retained
        // Mate sidebar controller independently with its real pointer listeners.
        if (input.runtime === 'source') {
          (await import('./modules/mate-sidebar.js')).showMateSidebar(mate.id, mate);
        } else {
          document.getElementById('mate-sidebar-column').classList.remove('hidden');
        }
        document.getElementById('sidebar-column').classList.add('dm-mode');
        document.getElementById('sidebar-resize-handle').classList.add('dm-mode');
      }, { mate: info.ordinaryMates[0], runtime: runtime });
      await page.locator('#mate-sidebar-column:not(.hidden)').waitFor();
      await material.assertMaterial(page, '#mate-sidebar-column');
      await checkHeldResize(page, 'mate-sidebar-column', 'mate-sidebar-resize-handle', runtime + ' retained Mate sidebar');
    }
    await context.close();
  }
});
