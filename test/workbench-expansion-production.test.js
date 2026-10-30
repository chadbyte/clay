// Real production app (HTTP, WebSocket, split panes) with isolated storage and
// fenced providers: the actual Terminal, Files and Browser fullscreen handlers
// must expand below the shell top bar, keep the split frames alive, and restore.
// No PTY, provider or shared-browser worker is started. Files uses an actual
// independent pane reading a disposable fixture file through the normal service.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
var COOKIE = { Cookie: 'relay_auth_user=pane-fixture-token' };
var material = require('./fixtures/chrome-material-assertions.cjs');

test('production fullscreen handlers share one region and keep split frames', { timeout: 120000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/appearance-pane-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var logs = ''; child.stdout.on('data', function (d) { logs += d; }); child.stderr.on('data', function (d) { logs += d; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Fixture startup timeout: ' + logs)); }, 20000);
    child.once('message', function (value) { clearTimeout(timer); resolve(value); });
    child.once('exit', function (code) { clearTimeout(timer); reject(new Error('Fixture exited ' + code + ': ' + logs)); });
  });
  var origin = 'http://127.0.0.1:' + info.port;
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1400, height: 900 }, reducedMotion: 'reduce' });
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  // The Browser state injection must use the same module graph as the app.
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(origin + '/fixture/login');
  var fx = await (await fetch(origin + '/fixture/info', { headers: COOKIE })).json();
  await fetch(origin + '/fixture/switch?id=' + fx.driverId, { method: 'POST', headers: COOKIE });
  await page.waitForFunction(function () { return document.querySelectorAll('iframe.split-pane-frame').length === 2; }, null, { timeout: 20000 });
  await page.waitForFunction(function () {
    return !!document.querySelector('.split-view-worker-pill') && Array.from(document.querySelectorAll('iframe.split-pane-frame')).every(function (f) {
      var live = f.clayPane && f.clayPane.identity();
      return live && live.ready && !f.dataset.requestedSessionId && f.contentDocument && f.contentDocument.body.classList.contains('pane-mode');
    });
  }, null, { timeout: 20000 });
  await page.evaluate(function () {
    window.__frames = Array.from(document.querySelectorAll('iframe.split-pane-frame'));
    window.__docs = window.__frames.map(function (f) { return f.contentDocument; });
    window.__frames.forEach(function (f, i) { f.contentWindow.__mark = 'doc-' + i; });
  });

  function snapshot() {
    return page.evaluate(function () {
      var host = document.getElementById('split-host');
      return Array.from(document.querySelectorAll('iframe.split-pane-frame')).map(function (f, i) {
        var r = f.getBoundingClientRect();
        return { sameElement: f === window.__frames[i], sameDocument: f.contentDocument === window.__docs[i], mark: f.contentWindow.__mark, size: [Math.round(r.width), Math.round(r.height)], hostPosition: getComputedStyle(host).position };
      });
    });
  }
  var base = await snapshot();
  assert.equal(base.length, 2); assert.ok(base.every(function (f) { return f.size[0] > 100 && f.sameDocument; }));
  function sizes(list) { return list.map(function (f) { return f.size; }); }

  var tools = [
    { name: 'terminal', selector: '#terminal-container', button: '#terminal-fullscreen', prepare: function () { document.getElementById('terminal-container').classList.remove('hidden'); } },
    { name: 'files', selector: '.file-instance', button: '.file-instance button[aria-label="Expand file pane"]', prepare: async function () {
      (await import('./modules/filebrowser.js')).openFile('expansion.txt');
    } },
    // The production state message creates and opens the panel without sending 'open', so no browser worker starts.
    { name: 'browser', selector: '#shared-browser-panel', button: '#shared-browser-panel [data-action="fullscreen"]', prepare: async function () {
      var store = (await import('./modules/store.js')).store; var mod = await import('./modules/shared-browser.js');
      var transport = await import('./modules/pane-browser-transport.js');
      transport.ensureBrowserPaneSource();
      // Match the selected real pane; this test begins at the state receiver,
      // while the ordinary bridge/authorization suites cover message admission.
      mod.handleSharedBrowserMessage({ type: 'shared_browser_state', sessionId: transport.browserPaneSessionId() || store.get('activeSessionId'), present: true, browsers: [] }, true);
    } }
  ];
  var bounds = {};
  for (var tool of tools) {
    await page.evaluate(tool.prepare);
    if (tool.name === 'files') await page.locator('.file-instance .file-viewer-body').getByText('Isolated file pane expansion fixture.', { exact: true }).waitFor();
    await material.assertPaneBacking(page, tool.selector);
    await material.assertMaterial(page, tool.selector + ' > .tool-pane-header');
    await material.assertFixedControl(page, tool.selector + ' > .tool-pane-header');
    await page.locator(tool.button).click();
    var during = await page.evaluate(function (tool) {
      var panel = document.querySelector(tool.selector); var r = panel.getBoundingClientRect();
      var title = document.getElementById('top-bar'); var tr = title.getBoundingClientRect();
      var main = document.getElementById('main-panels').getBoundingClientRect();
      var workspace = document.getElementById('main-column'), wr = workspace.getBoundingClientRect();
      var titleEl = document.getElementById('cmd-palette-btn'); var te = titleEl.getBoundingClientRect();
      var hit = document.elementFromPoint(te.left + Math.min(10, te.width / 2), te.top + te.height / 2);
      var leaks = [];
      for (var y = r.top + 2; y < r.top + 120; y += 6) for (var x = r.left + 2; x < r.left + 800; x += 12) {
        var top = document.elementFromPoint(x, y); if (top && !panel.contains(top) && top.id !== 'sidebar-resize-handle') leaks.push((top.className || top.id || top.tagName) + '@' + x + ',' + y);
      }
      return { full: panel.classList.contains('panel-fullscreen'), rect: [r.left, r.top, r.width, r.height], main: [main.left, main.top, main.width, main.height], workspace: [wr.left + workspace.clientLeft, wr.top + workspace.clientTop, workspace.clientWidth, workspace.clientHeight], titleBottom: tr.bottom, titleShown: getComputedStyle(title).display !== 'none', titleHit: !!hit && titleEl.contains(hit), leaks: leaks.slice(0, 5) };
    }, { selector: tool.selector });
    assert.ok(during.full, tool.name + ': real handler entered fullscreen');
    assert.ok(during.titleShown && during.titleHit, tool.name + ': shell search remains visible and hit-testable');
    assert.ok(during.main[1] > during.titleBottom, tool.name + ': workspace clears the shell top bar');
    assert.deepEqual(during.main, during.workspace, tool.name + ': expanded workspace fills the actual working-column interior');
    assert.deepEqual(during.rect, [during.main[0] + 7, during.main[1] + 7, during.main[2] - 14, during.main[3] - 14], tool.name + ': fills the workspace with the shared seven-pixel pane inset');
    assert.deepEqual(during.leaks, [], tool.name + ': no underlying element receives the pointer in the expanded surface');
    bounds[tool.name] = during.rect;
    var mid = await snapshot();
    mid.forEach(function (f, i) { assert.ok(f.sameElement && f.sameDocument && f.mark === 'doc-' + i, tool.name + ': split frame ' + i + ' identity retained while expanded'); });
    assert.deepEqual(sizes(mid), sizes(base), tool.name + ': split frame sizes unchanged while expanded');
    await page.locator(tool.button).click();
    if (tool.name === 'files') await page.locator('.file-instance button[aria-label="Close file pane"]').click();
    else await page.evaluate(function (tool) { document.querySelector(tool.selector).classList.add('hidden'); }, { selector: tool.selector });
    var after = await snapshot();
    after.forEach(function (f, i) { assert.ok(f.sameElement && f.sameDocument && f.mark === 'doc-' + i && f.hostPosition === 'relative', tool.name + ': split frame ' + i + ' retained and host back in flow after collapse'); });
    assert.deepEqual(sizes(after), sizes(base), tool.name + ': split frame sizes restored');
    assert.equal(await page.evaluate(function () { var c = document.querySelector('#split-host .split-pane-close'); var r = c.getBoundingClientRect(); var h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && c.contains(h); }), true, tool.name + ': split controls hittable after collapse');
  }
  assert.deepEqual(bounds.files, bounds.terminal); assert.deepEqual(bounds.browser, bounds.terminal);
  assert.deepEqual(errors, []);
});
