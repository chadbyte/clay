// Real authenticated app, terminal manager, file reads and browser service.
// PTY and browser navigation are inert transports; no shell/provider starts.
var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('docked tools remain mounted below independent overlays with matching pane surfaces', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '', CLAY_PANE_BROWSER: '1', CLAY_PANE_WORKBENCH: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
  });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' }), errors = [], detached = 0, backgroundOutput = 0, receiveBackground;
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) { socket.on('framereceived', function (event) {
    try { var message = JSON.parse(String(event.payload)); if (message.type === 'term_output' && message.data === 'BACKGROUND_TERMINAL_OUTPUT') { backgroundOutput++; if (receiveBackground) receiveBackground(); } } catch (error) {}
  }); socket.on('framesent', function (event) {
    try { if (JSON.parse(String(event.payload)).type === 'term_detach') detached++; } catch (error) {}
  }); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  var base = 'http://127.0.0.1:' + info.port;
  await page.goto(base + '/fixture/login');
  await page.waitForFunction(function () { var f = document.querySelector('#split-host iframe'); return f && f.clayPane && f.clayPane.identity() && f.clayPane.identity().ready; });
  await page.locator('#terminal-sidebar-btn').click();
  await page.waitForSelector('#terminal-container .xterm-helper-textarea', { state: 'attached' });
  assert.equal(await page.locator('#terminal-container').isVisible(), true);
  await page.waitForFunction(function () { var b = document.querySelector('#terminal-container .workbench-layout-toggle'); return b && !b.disabled; });
  await page.locator('#terminal-container .workbench-layout-toggle').click();
  await page.waitForFunction(function () { return document.getElementById('terminal-container').dataset.workbenchPlacement === 'docked'; });
  await page.evaluate(function () {
    window.dockedTerminal = document.querySelector('#terminal-container .xterm');
    window.retainedChat = document.querySelector('#split-host iframe').contentDocument;
    window.dockedTerminal.dataset.fixtureRetained = 'yes';
  });
  async function geometry() {
    return page.evaluate(function () { return ['#split-host', '#terminal-container'].map(function (selector) {
      var r = document.querySelector(selector).getBoundingClientRect(); return [r.x, r.y, r.width, r.height];
    }); });
  }
  await page.waitForFunction(function () { return document.getElementById('terminal-container').dataset.toolWindowId === 'tool-terminal'; });
  await page.waitForTimeout(350);
  var beforeOverlay = await geometry(), beforeDetach = detached;
  await page.locator('#shared-browser-btn').click();
  await page.waitForSelector('#shared-browser-panel:not(.hidden)');
  assert.deepEqual(await geometry(), beforeOverlay, 'overlay does not move the dock or conversation');
  assert.equal(await page.locator('#shared-browser-panel').getAttribute('data-workbench-placement'), 'overlay');
  assert.equal(await page.locator('#terminal-container').isVisible(), true);
  assert.equal(detached, beforeDetach, 'opening Browser does not detach the docked PTY');
  var backgroundReceipt = new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('No live background terminal output')); }, 5000);
    t.after(function () { clearTimeout(timer); });
    receiveBackground = function () { clearTimeout(timer); resolve(); };
  });
  await page.request.post(base + '/fixture/terminal-output');
  await backgroundReceipt;
  assert.equal(backgroundOutput, 1, 'live terminal output still arrives while Browser overlays it');
  await page.evaluate(async function () { (await import('/p/reuse/modules/filebrowser.js')).openFile('workbench.md'); });
  await page.waitForFunction(function () { return document.querySelector('#file-viewer-body').textContent.includes('PERSISTENT_FILE_CONTENT'); });
  assert.equal(await page.locator('#shared-browser-panel').isVisible(), false, 'Files replaces only the foreground overlay');
  assert.equal(await page.locator('#terminal-container').isVisible(), true);
  assert.deepEqual(await geometry(), beforeOverlay);
  await page.locator('#file-viewer .workbench-layout-toggle').click();
  await page.waitForFunction(function () { return document.getElementById('file-viewer').dataset.workbenchPlacement === 'docked'; });
  var docks = await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('rightWorkbenchDockedOwners'); });
  assert.deepEqual(docks, ['terminal', 'file-viewer']);
  for (var theme of ['clay-light', 'clay-dark']) {
    await page.evaluate(async function (theme) { (await import('/p/reuse/modules/theme.js')).applyTheme(theme); }, theme);
    var colors = await page.evaluate(function () {
      var bg = getComputedStyle(document.querySelector('#split-host .split-pane')).backgroundColor;
      return { bg: bg, terminal: getComputedStyle(document.getElementById('terminal-body')).backgroundColor,
        viewport: getComputedStyle(document.querySelector('#terminal-container .xterm-viewport')).backgroundColor,
        file: getComputedStyle(document.getElementById('file-viewer')).backgroundColor,
        header: getComputedStyle(document.querySelector('.file-viewer-tabbar')).backgroundColor,
        retained: window.dockedTerminal === document.querySelector('#terminal-container .xterm'),
        document: window.retainedChat === document.querySelector('#split-host iframe').contentDocument };
    });
    assert.equal(colors.terminal, 'rgb(20, 20, 18)'); assert.equal(colors.viewport, colors.terminal, 'Terminal stays dark in ' + theme); assert.equal(colors.file, colors.bg); assert.equal(colors.header, colors.bg);
    assert.equal(colors.retained, true); assert.equal(colors.document, true);
  }
  await page.waitForTimeout(350);
  var twoDocks = await geometry(); await page.locator('#shared-browser-btn').click();
  await page.waitForSelector('#shared-browser-panel:not(.hidden)'); assert.deepEqual(await geometry(), twoDocks);
  await page.locator('#shared-browser-panel .workbench-layout-toggle').click();
  await page.waitForFunction(function () { return document.getElementById('shared-browser-panel').dataset.workbenchPlacement === 'docked'; });
  var browserSurface = await page.evaluate(function () { return {
    pane: getComputedStyle(document.querySelector('#split-host .split-pane')).backgroundColor,
    viewport: getComputedStyle(document.querySelector('.shared-browser-viewport')).backgroundColor,
    overflow: document.getElementById('main-panels').scrollWidth > document.getElementById('main-panels').clientWidth,
  }; });
  assert.equal(browserSurface.viewport, browserSurface.pane); assert.equal(browserSurface.overflow, false);
  await page.waitForFunction(function () { return document.getElementById('shared-browser-panel').dataset.toolWindowId === 'tool-browser'; });
  assert.equal(await page.locator('#shared-browser-panel [data-action="wide"]').isVisible(), false, 'pane dividers replace fixed-panel widening');
  await page.locator('#shared-browser-panel [data-action="hide"]').click();
  assert.equal(await page.locator('#terminal-container').isVisible(), true); assert.equal(await page.locator('#file-viewer').isVisible(), true);
  var stats = await (await page.request.get(base + '/fixture/state')).json();
  assert.equal(stats.terminalStats.length, 1); assert.equal(stats.terminalStats[0].killed, false);
  // Saved dock mode must never dock a newly opened or reopened tool.
  await page.locator('#terminal-close').click();
  await page.locator('#terminal-sidebar-btn').click();
  await page.waitForFunction(function () { return document.getElementById('terminal-container').dataset.workbenchPlacement === 'overlay'; });
  assert.equal(await page.locator('#terminal-container').getAttribute('data-tool-window-id'), null);
  assert.deepEqual(errors, []);
});
