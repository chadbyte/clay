var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
var chromium = require('playwright').chromium;
var material = require('./fixtures/chrome-material-assertions.cjs');

async function installSource(page) {
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.route(/\/pane-assets\/style-[^/]+\.css(?:\?.*)?$/, function (route) {
    var url = new URL(route.request().url());
    return route.fulfill({ contentType: 'text/css', body: '@import url(' + JSON.stringify(url.pathname.replace(/pane-assets\/[^/]+$/, 'style.css')) + ');' });
  });
}
async function settledBacking(panel) {
  await panel.evaluate(function (element) { return new Promise(function (resolve) {
    function check() {
      var header = element.querySelector(':scope > .tool-pane-header');
      var bottom = header.getBoundingClientRect().bottom - element.getBoundingClientRect().top - element.clientTop;
      if (bottom > 0 && Math.abs(parseFloat(getComputedStyle(element, '::before').top) - bottom) < .6) resolve();
      else requestAnimationFrame(check);
    }
    check();
  }); });
}
async function pixelDelta(page, first, second, rect) {
  return page.evaluate(async function (input) {
    async function pixels(data) {
      var decoded = atob(data), bytes = new Uint8Array(decoded.length);
      for (var i = 0; i < decoded.length; i++) bytes[i] = decoded.charCodeAt(i);
      var bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      var canvas = document.createElement('canvas'); canvas.width = bitmap.width; canvas.height = bitmap.height;
      var context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0); bitmap.close();
      return context.getImageData(input.rect.x, input.rect.y, input.rect.width, input.rect.height).data;
    }
    var a = await pixels(input.first), b = await pixels(input.second), total = 0;
    for (var i = 0; i < a.length; i += 4) total += Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    return total / (a.length / 4 * 3);
  }, { first: first.toString('base64'), second: second.toString('base64'), rect: rect });
}
async function captureProof(page, panel, floating, label, t) {
  var header = panel.locator(':scope > .tool-pane-header');
  var box = await header.boundingBox(), body = await panel.boundingBox();
  var crop = { x: Math.ceil(box.x + 4), y: Math.ceil(box.y + 2), width: Math.floor(box.width - 8), height: Math.floor(box.height - 4) };
  var bodyCrop = { x: Math.ceil(body.x + 12), y: Math.ceil(box.y + box.height + 90), width: 80, height: 35 };
  var before, after;
  if (floating) {
    // Change the real session header underneath the floating window. This is
    // underlying page content, not a duplicate wallpaper or tool-header fill.
    var underlay = page.locator('#split-host > .split-pane:not(.split-pane-cached) > .split-pane-header');
    await underlay.evaluateAll(function (elements) { elements.forEach(function (element) { element.style.setProperty('--chrome-material-solid', '#00ff00'); }); });
    before = await page.screenshot();
    await underlay.evaluateAll(function (elements) { elements.forEach(function (element) { element.style.setProperty('--chrome-material-solid', '#ff00ff'); }); });
    after = await page.screenshot();
    await underlay.evaluateAll(function (elements) { elements.forEach(function (element) { element.style.removeProperty('--chrome-material-solid'); }); });
  } else {
    before = await page.screenshot();
    var style = await page.addStyleTag({ content: '#layout-body { background-image: none !important; }' });
    after = await page.screenshot(); await style.evaluate(function (element) { element.remove(); });
  }
  var delta = await pixelDelta(page, before, after, crop), bodyDelta = await pixelDelta(page, before, after, bodyCrop);
  assert.ok(delta > .3, label + ': header samples ' + (floating ? 'underlying page' : 'actual shell wallpaper') + ', delta=' + delta);
  assert.ok(bodyDelta < .1, label + ': content stays opaque, delta=' + bodyDelta);
  t.diagnostic(label + ': header pixel delta=' + delta.toFixed(2) + ', body=' + bodyDelta.toFixed(2));
  if (process.env.CLAY_MATERIAL_SHOTS) {
    fs.mkdirSync(process.env.CLAY_MATERIAL_SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(process.env.CLAY_MATERIAL_SHOTS, label.replace(/ /g, '-') + '.png') });
  }
}

['source', 'compiled'].forEach(function (runtime) {
  test('all shared tool headers sample below their own shell: ' + runtime, { timeout: 180000 }, async function (t) {
    // Storage, providers, Git writes and updates are fenced before imports.
    var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill(); });
    var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
    var browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var context = await browser.newContext({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
    await require('./fixtures/offline-cdn-routes.cjs').install(context);
    // Drop external runtime starts on every parent/iframe transport, before app
    // imports. UI opening and exact resource reads still use production paths.
    await context.addInitScript(function () {
      var send = WebSocket.prototype.send;
      WebSocket.prototype.send = function (data) {
        var message; try { message = JSON.parse(data); } catch (error) {}
        if (message && /^(term_create|shared_browser_open)$/.test(message.type)) return;
        return send.apply(this, arguments);
      };
    });
    var page = await context.newPage(), errors = [], bundled = [];
    page.on('pageerror', function (error) { errors.push(error.message); });
    page.on('request', function (request) { if (/\/pane-assets\/(app-|style-)/.test(request.url())) bundled.push(request.url()); });
    if (runtime === 'source') await installSource(page);
    await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
    await page.getByRole('button', { name: /^Open Split view Driver/ }).click();
    await page.waitForFunction(function () { var frames = Array.from(document.querySelectorAll('#split-host > .split-pane:not(.split-pane-cached) iframe')); return frames.length === 2 && frames.every(function (frame) { var identity = frame.clayPane && frame.clayPane.identity(); return identity && identity.ready; }); });
    if (runtime === 'compiled') assert.ok(bundled.some(function (url) { return /style-/.test(url); }) && bundled.some(function (url) { return /app-/.test(url); }), 'actual packaged entries loaded');
    await page.evaluate(function () { window.__materialFrames = Array.from(document.querySelectorAll('#split-host iframe')).map(function (frame) { return { frame: frame, document: frame.contentDocument }; }); });
    var tools = [
      { name: 'logs', selector: '#project-logs-panel', open: async function () { await page.getByRole('button', { name: 'Logs', exact: true }).click(); }, expand: '#project-logs-fullscreen', close: '#project-logs-close' },
      { name: 'terminal', selector: '#terminal-container', open: async function () { await page.locator('#terminal-toggle-btn').click(); }, expand: '#terminal-fullscreen', close: '#terminal-close' },
      { name: 'browser', selector: '#shared-browser-panel', open: async function () { await page.locator('#shared-browser-toggle-btn').click(); }, expand: '[data-action="fullscreen"]', close: '[data-action="hide"]' },
      { name: 'files', selector: '.file-instance', open: async function () {
        await page.getByRole('button', { name: 'File browser', exact: true }).click();
        await page.locator('.file-tree-name').filter({ hasText: /^expansion.txt$/ }).first().dblclick();
      }, expand: 'button[aria-label="Expand file pane"]', close: 'button[aria-label="Close file pane"]' }
    ];
    for (var tool of tools) {
      await tool.open();
      if (tool.name === 'files') await page.locator('.file-instance:visible, #file-viewer:visible').first().waitFor();
      if (tool.name === 'files' && !await page.locator('.file-instance:visible').count()) {
        tool.selector = '#file-viewer'; tool.expand = '#file-viewer-fullscreen'; tool.close = '#file-viewer-close';
      }
      var panel = page.locator(tool.selector).first(); await panel.waitFor(); await settledBacking(panel);
      for (var theme of ['light', 'dark']) {
        await page.emulateMedia({ colorScheme: theme });
        await page.waitForFunction(function (theme) { return document.documentElement.classList.contains(theme + '-theme'); }, theme);
        await page.mouse.move(1, 1);
        for (var mode of ['overlay', 'docked', 'expanded']) {
          if (mode === 'docked') { await panel.locator('.workbench-layout-toggle').click(); await page.waitForFunction(function (selector) { return document.querySelector(selector).dataset.workbenchPlacement === 'docked'; }, tool.selector); }
          if (mode === 'expanded') { await panel.locator(tool.expand).click(); await page.waitForFunction(function (selector) { return document.querySelector(selector).classList.contains('panel-fullscreen'); }, tool.selector); }
          await settledBacking(panel);
          await material.assertPaneBacking(page, tool.selector);
          await material.assertMaterial(page, tool.selector + ' > .tool-pane-header');
          await material.assertFixedControl(page, tool.selector + ' > .tool-pane-header');
          await captureProof(page, panel, mode === 'overlay', runtime + ' ' + tool.name + ' ' + theme + ' ' + mode, t);
        }
        await panel.locator(tool.expand).click();
        await panel.locator('.workbench-layout-toggle').click();
        await page.waitForFunction(function (selector) { var panel = document.querySelector(selector); return !panel.classList.contains('panel-fullscreen') && panel.dataset.workbenchPlacement === 'overlay'; }, tool.selector);
      }
      // The backing follows actual height changes; controls remain in their
      // original DOM and fixed descendants still use the viewport.
      var header = panel.locator(':scope > .tool-pane-header');
      await header.evaluate(function (element) { element.style.height = '67px'; element.style.minHeight = '67px'; });
      await settledBacking(panel); await material.assertPaneBacking(page, tool.selector);
      await header.evaluate(function (element) { element.style.removeProperty('height'); element.style.removeProperty('min-height'); });
      if (tool.name === 'files' && tool.selector === '.file-instance') {
        await panel.getByRole('button', { name: 'More file actions', exact: true }).click();
        var menu = panel.getByRole('menu'); await menu.waitFor(); var menuBox = await menu.boundingBox(), panelBox = await panel.boundingBox();
        assert.ok(menuBox.x >= panelBox.x && menuBox.x + menuBox.width <= panelBox.x + panelBox.width);
        await page.keyboard.press('Escape'); await menu.waitFor({ state: 'hidden' });
      }
      await panel.locator(tool.close).click();
      assert.ok(await page.evaluate(function () { return window.__materialFrames.every(function (entry) { return entry.frame.isConnected && entry.frame.contentDocument === entry.document; }); }), tool.name + ': original iframes retained');
    }
    assert.deepEqual(errors, []);
  });
});
