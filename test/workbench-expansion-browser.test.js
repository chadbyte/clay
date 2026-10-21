'use strict';
// Isolate every user-level path before any import. The fixture only serves static
// production CSS/markup, so no account, provider, PTY, daemon or network is used.
var nodeOs = require('node:os');
var nodeFs = require('node:fs');
var nodePath = require('node:path');
var sandbox = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'clay-wbx-'));
// Resolve Playwright's platform default from the real home before isolating HOME.
// An explicit PLAYWRIGHT_BROWSERS_PATH (for example from the runner) always wins.
if (!process.env.PLAYWRIGHT_BROWSERS_PATH) {
  var realHome = nodeOs.homedir();
  process.env.PLAYWRIGHT_BROWSERS_PATH = process.platform === 'darwin' ? nodePath.join(realHome, 'Library', 'Caches', 'ms-playwright')
    : process.platform === 'win32' ? nodePath.join(process.env.LOCALAPPDATA || nodePath.join(realHome, 'AppData', 'Local'), 'ms-playwright')
    : nodePath.join(realHome, '.cache', 'ms-playwright');
}
['HOME', 'USERPROFILE', 'CLAY_HOME', 'CODEX_HOME', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME'].forEach(function (key) { process.env[key] = nodePath.join(sandbox, key); });
process.env.CLAY_CONFIG = nodePath.join(sandbox, 'CLAY_HOME', 'daemon.json');

var test = require('node:test');
var assert = require('node:assert/strict');
var playwright = require('playwright');
var fixture = require('./fixtures/workbench-expansion-fixture.cjs');

var PANELS = ['browser', 'terminal', 'files'];

async function open(page, port, theme, panel, split) {
  await page.goto('http://127.0.0.1:' + port + '/?theme=' + theme + '&split=' + split + '&panel=' + panel + '&full=1');
  await page.waitForFunction(function () { return document.documentElement.dataset.fixtureReady === '1'; });
}

function measure(name) {
  var rect = window.fixture.panels[name].getBoundingClientRect();
  var title = document.querySelector('.title-bar-content').getBoundingClientRect();
  var main = document.getElementById('main-panels').getBoundingClientRect();
  return { panel: [rect.left, rect.top, rect.width, rect.height], title: [title.left, title.top, title.width, title.height], main: [main.left, main.top, main.width, main.height] };
}

async function hidden(page, name) {
  return page.evaluate(function (name) {
    var panel = window.fixture.panels[name]; var rect = panel.getBoundingClientRect(); var leaks = [];
    Array.from(document.querySelectorAll('#fixture-chat-button, #split-host button, #split-host header, #split-host iframe')).forEach(function (el) {
      var r = el.getBoundingClientRect(); var style = getComputedStyle(el); var host = el.closest('#split-host');
      var painted = style.visibility === 'visible' && style.display !== 'none' && r.width > 0 && r.height > 0;
      var inside = r.right > rect.left && r.left < rect.right && r.bottom > rect.top && r.top < rect.bottom;
      if (painted && inside) leaks.push('painted ' + (el.className || el.id));
      var hit = document.elementFromPoint(Math.min(Math.max(r.left + r.width / 2, rect.left + 1), rect.right - 1), Math.min(Math.max(r.top + r.height / 2, rect.top + 1), rect.bottom - 1));
      if (hit && (el === hit || el.contains(hit))) leaks.push('hittable ' + (el.className || el.id));
      if (host && getComputedStyle(host).pointerEvents !== 'none') leaks.push('split host intercepts pointer');
    });
    // Grid hit-test over the top bands where the leaked pane headers painted.
    for (var y = rect.top + 2; y < rect.top + 90; y += 6) for (var x = rect.left + 2; x < rect.left + 700; x += 12) {
      var top = document.elementFromPoint(x, y);
      if (top && !panel.contains(top) && !top.closest('.title-bar-content')) leaks.push('foreign hit ' + (top.className || top.id || top.tagName) + ' @' + x + ',' + y);
    }
    return leaks;
  }, name);
}

test('Browser, Terminal and Files expand into one region below the session title', async function (t) {
  var info = await fixture.start(0);
  var browser = await playwright.chromium.launch();
  t.after(async function () { await browser.close(); info.server.close(); nodeFs.rmSync(sandbox, { recursive: true, force: true }); });
  var errors = [];
  for (var theme of ['dark', 'light']) for (var split of [0, 2]) {
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
    page.on('pageerror', function (error) { errors.push(error.message); });
    var rects = {};
    for (var name of PANELS) {
      var label = theme + ' split=' + split + ' ' + name;
      await open(page, info.port, theme, name, split);
      rects[name] = await page.evaluate(measure, name);
      var m = rects[name];
      assert.equal(m.panel[1], m.title[1] + m.title[3], label + ': starts directly below the session title');
      assert.equal(m.panel[0], m.title[0], label + ': shares the title left edge');
      assert.equal(m.panel[2], m.title[2], label + ': shares the title width');
      assert.deepEqual(m.panel, m.main, label + ': fills the main panel region exactly');
      assert.ok(m.title[3] > 0, label + ': title bar is laid out');
      // Title text and the right tools remain visible and receive the pointer.
      var titleHit = await page.evaluate(function () {
        var el = document.getElementById('header-title'); var r = el.getBoundingClientRect();
        var top = document.elementFromPoint(r.left + Math.min(20, r.width / 2), r.top + r.height / 2);
        var tool = document.getElementById('terminal-toggle-btn'); var tr = tool.getBoundingClientRect();
        var toolTop = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
        return { title: !!top && el.contains(top), text: el.textContent, tool: !!toolTop && tool.contains(toolTop) };
      });
      assert.ok(titleHit.title, label + ': chat title is hit-testable');
      assert.equal(titleHit.text, 'Clone Orca for Competitive Analysis');
      assert.ok(titleHit.tool, label + ': right tools stay hit-testable');
      assert.deepEqual(await hidden(page, name), [], label + ': underlying chat and status controls neither paint nor receive clicks');
    }
    assert.deepEqual(rects.terminal.panel, rects.browser.panel, theme + ' split=' + split + ': Terminal bounds equal Browser');
    assert.deepEqual(rects.files.panel, rects.browser.panel, theme + ' split=' + split + ': Files bounds equal Browser');

    // Modal precedence: a confirm dialog above each expanded surface.
    for (var modalName of PANELS) {
      await open(page, info.port, theme, modalName, split);
      var modalHit = await page.evaluate(function (name) {
        var modal = document.getElementById('confirm-modal'); modal.classList.remove('hidden');
        var r = window.fixture.panels[name].getBoundingClientRect();
        var top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return !!top && modal.contains(top);
      }, modalName);
      assert.ok(modalHit, theme + ' split=' + split + ' ' + modalName + ': modal stays above the expanded surface');
    }

    // Collapse restores the chat title, chat and status controls (and the split layer).
    await open(page, info.port, theme, 'browser', split);
    var restored = await page.evaluate(function (withSplit) {
      window.fixture.show('none');
      var result = { title: getComputedStyle(document.querySelector('.title-bar-content')).display !== 'none' };
      var chat = document.getElementById(withSplit ? 'split-host' : 'app');
      result.chat = getComputedStyle(chat).display !== 'none';
      var control = withSplit ? document.querySelector('#split-host .split-pane-close') : document.getElementById('fixture-chat-button');
      var r = control.getBoundingClientRect(); var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      result.visible = getComputedStyle(control).visibility === 'visible' && r.width > 0;
      result.hittable = !!hit && control.contains(hit);
      result.position = withSplit ? getComputedStyle(document.getElementById('split-host')).position : 'n/a';
      return result;
    }, split === 2);
    assert.deepEqual(restored.title && restored.chat && restored.visible && restored.hittable, true, theme + ' split=' + split + ': collapse restores ' + JSON.stringify(restored));
    if (split === 2) assert.equal(restored.position, 'relative', 'collapse returns the split host to flow');
    await page.close();
  }

  // Narrow screens keep their existing overlay behaviour (rules are desktop-only).
  var narrow = await browser.newPage({ viewport: { width: 800, height: 700 }, reducedMotion: 'reduce' });
  for (var narrowName of ['files', 'terminal']) {
    await open(narrow, info.port, 'dark', narrowName, 2);
    var overlay = await narrow.evaluate(function (name) {
      var r = window.fixture.panels[name].getBoundingClientRect(); var s = getComputedStyle(window.fixture.panels[name]);
      return { position: s.position, rect: [r.left, r.top, r.width, r.height], splitPosition: getComputedStyle(document.getElementById('split-host')).position };
    }, narrowName);
    assert.equal(overlay.position, 'fixed', narrowName + ': narrow overlay unchanged');
    assert.deepEqual(overlay.rect, [0, 0, 800, 700], narrowName + ': narrow overlay covers the viewport');
    assert.equal(overlay.splitPosition, 'relative', narrowName + ': narrow split layer is not repositioned');
  }
  assert.deepEqual(errors, []);
});

test('split frames keep document identity and size across expansion and collapse, and nothing leaks paint', async function (t) {
  var info = await fixture.start(0);
  var browser = await playwright.chromium.launch();
  t.after(async function () { await browser.close(); info.server.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:' + info.port + '/?theme=light&split=2&panel=none');
  await page.waitForFunction(function () { return document.documentElement.dataset.fixtureReady === '1'; });
  function frames() {
    return page.evaluate(function () {
      return Array.from(document.querySelectorAll('#split-host iframe')).map(function (f) {
        var r = f.getBoundingClientRect(); return { marker: f.contentWindow.__wbxMarker, same: f === window.__wbxFrames[Number(f.dataset.index)], size: [r.width, r.height] };
      });
    });
  }
  await page.evaluate(function () {
    window.__wbxFrames = Array.from(document.querySelectorAll('#split-host iframe'));
    window.__wbxFrames.forEach(function (f, i) { f.dataset.index = String(i); f.contentWindow.__wbxMarker = 'doc-' + i; });
  });
  var before = await frames();
  assert.equal(before.length, 2); assert.ok(before.every(function (f) { return f.size[0] > 100 && f.size[1] > 100; }));
  for (var name of PANELS) {
    await page.evaluate(function (n) { window.fixture.show(n, { full: true }); }, name);
    var during = await frames();
    assert.deepEqual(during, before.map(function (f, i) { return { marker: 'doc-' + i, same: true, size: f.size }; }), name + ': frame documents and sizes unchanged while expanded');
    // Descendants that force visibility (pending permission spinner) must not paint over the surface.
    var spinner = await page.evaluate(function () { var r = document.querySelector('#split-host .permission-spinner').getBoundingClientRect(); return { x: r.left - 4, y: r.top - 4, width: r.width + 8, height: r.height + 8 }; });
    var painted = await page.screenshot({ clip: spinner });
    await page.evaluate(function () { document.getElementById('split-host').style.display = 'none'; });
    var reference = await page.screenshot({ clip: spinner });
    await page.evaluate(function () { document.getElementById('split-host').style.display = ''; });
    assert.ok(painted.equals(reference), name + ': pending spinner under the host does not paint');
    await page.evaluate(function () { window.fixture.show('none'); });
    var after = await frames();
    assert.deepEqual(after, before.map(function (f, i) { return { marker: 'doc-' + i, same: true, size: f.size }; }), name + ': frame documents and sizes unchanged after collapse');
  }
});
