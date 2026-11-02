// Real production app (HTTP, WebSocket, split panes) with isolated storage and
// fenced providers. Browser, Terminal and sticky-note visibility controls sit in
// the top bar beside Notifications and Settings on desktop and return, as the
// same nodes, to the title bar on mobile. Outgoing terminal and browser start
// messages are captured and dropped, so no PTY or browser worker is created.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
var chromium = require('playwright').chromium;
var COOKIE = { Cookie: 'relay_auth_user=pane-fixture-token' };
var IDS = ['shared-browser-toggle-btn', 'terminal-toggle-btn', 'sticky-notes-toggle-btn'];

test('top bar workbench controls: desktop order, handlers, mobile fallback and split panes', { timeout: 120000 }, async function (t) {
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
  var shots = process.env.WBX_SHOT_DIR; if (shots) fs.mkdirSync(shots, { recursive: true });
  var errors = [];

  async function boot(theme, width) {
    var page = await browser.newPage({ viewport: { width: width, height: 900 }, reducedMotion: 'reduce', colorScheme: theme });
    page.on('pageerror', function (error) { errors.push(error.message); });
    await page.goto(origin + '/fixture/login');
    return page;
  }
  async function ready(page, withSplit) {
    var fx = await (await fetch(origin + '/fixture/info', { headers: COOKIE })).json();
    await fetch(origin + '/fixture/switch?id=' + fx.driverId, { method: 'POST', headers: COOKIE });
    if (withSplit) {
      await page.waitForFunction(function () { return document.querySelectorAll('iframe.split-pane-frame').length === 2; }, null, { timeout: 20000 });
      await page.waitForFunction(function () {
        return Array.from(document.querySelectorAll('iframe.split-pane-frame')).every(function (f) { return f.contentDocument && f.contentDocument.body && f.contentDocument.body.classList.contains('pane-mode') && f.contentDocument.getElementById('terminal-toggle-btn'); });
      }, null, { timeout: 20000 });
    }
    await page.waitForFunction(function () { var b = document.getElementById('shared-browser-toggle-btn'); return b && !b.disabled; }, null, { timeout: 20000 });
  }
  async function addOpenNoteForControlTest(page) {
    await page.evaluate(async function () {
      var stickyNotes = await import('./modules/sticky-notes.js');
      stickyNotes.handleNotesList({ notes: [{ id: 'topbar-control-fixture', state: 'open', text: 'Control fixture', x: 60, y: 60, w: 240, h: 180, zIndex: 1, color: 'purple', opacity: 0.64 }] });
    });
    await page.waitForFunction(function () { var button = document.getElementById('sticky-notes-toggle-btn'); return button && !button.hidden; });
  }

  // ---- Desktop, dark, with split panes -------------------------------------
  var page = await boot('dark', 1280);
  await ready(page, true);
  await addOpenNoteForControlTest(page);
  var desktop = await page.evaluate(function (ids) {
    var actions = document.querySelector('#top-bar .top-bar-actions');
    var children = Array.from(actions.children).map(function (el) { return el.id; });
    var data = { children: children, counts: ids.map(function (id) { return document.querySelectorAll('#' + id).length; }), inTitle: ids.filter(function (id) { return !!document.querySelector('.title-bar-content #' + id); }), boxes: {} };
    ids.concat(['notif-center-btn', 'server-settings-btn']).forEach(function (id) {
      var el = document.getElementById(id); var r = el.getBoundingClientRect(); var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      var cs = getComputedStyle(el);
      data.boxes[id] = { x: r.left, y: r.top, w: r.width, h: r.height, shown: cs.display !== 'none', hit: !!hit && el.contains(hit), pad: cs.paddingTop, border: cs.borderTopWidth, radius: cs.borderTopLeftRadius, icon: el.querySelector('.lucide') ? el.querySelector('.lucide').getBoundingClientRect().width : 0 };
    });
    window.__nodes = ids.map(function (id) { return document.getElementById(id); });
    return data;
  }, IDS);
  assert.deepEqual(desktop.counts, [1, 1, 1], 'no duplicate IDs');
  assert.deepEqual(desktop.inTitle, [], 'desktop title bar no longer holds the controls');
  var tail = desktop.children.slice(-5);
  assert.deepEqual(tail, ['shared-browser-toggle-btn', 'terminal-toggle-btn', 'sticky-notes-toggle-btn', 'notif-center-btn', 'server-settings-btn'], 'desktop order: Browser, Terminal, Sticky, Notifications, Settings');
  IDS.concat(['notif-center-btn', 'server-settings-btn']).forEach(function (id) {
    var b = desktop.boxes[id]; assert.ok(b.shown && b.hit, id + ' visible and hit-testable in the top bar');
    assert.equal(b.pad, '3px', id + ' uses the compact top-bar padding'); assert.equal(b.border, '0px', id + ' has no border like its neighbours');
    assert.equal(b.radius, '6px'); assert.equal(b.icon, 14, id + ' icon size');
    assert.ok(b.y < 40, id + ' sits in the top bar');
  });
  for (var i = 0; i < 4; i++) {
    var a = desktop.boxes[IDS.concat(['notif-center-btn', 'server-settings-btn'])[i]], c = desktop.boxes[IDS.concat(['notif-center-btn', 'server-settings-btn'])[i + 1]];
    assert.ok(a.x + a.w <= c.x + 0.5, 'buttons do not overlap');
  }
  if (shots) await page.screenshot({ path: path.join(shots, 'topbar-dark-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 120 } });

  // ---- Real handlers; start messages captured and dropped --------------------
  await page.evaluate(async function () {
    var ref = await import('./modules/ws-ref.js'); var ws = ref.getWs(); window.__sent = []; var original = ws.send.bind(ws);
    ws.send = function (data) { var msg = JSON.parse(data); if (/^term_create|^shared_browser_open/.test(msg.type)) { window.__sent.push(msg.type); return; } return original(data); };
  });
  await page.locator('#sticky-notes-toggle-btn').click();
  var sticky = await page.evaluate(function () { var b = document.getElementById('sticky-notes-toggle-btn'); return [b.getAttribute('aria-pressed'), b.title, b.getAttribute('aria-label')]; });
  assert.deepEqual(sticky, ['true', 'Show sticky notes (1)', 'Show sticky notes (1)'], 'sticky handler toggles pressed/title and announces the count');
  var noteBadge = page.locator('#sticky-notes-toggle-btn .sticky-notes-count');
  assert.equal(await noteBadge.isVisible(), true);
  assert.equal(await noteBadge.textContent(), '1');
  assert.equal(await noteBadge.evaluate(function (el) { return getComputedStyle(el).backgroundColor; }), 'rgb(250, 204, 21)');
  await page.locator('#sticky-notes-toggle-btn').click();
  assert.equal(await page.locator('#sticky-notes-toggle-btn').getAttribute('aria-pressed'), 'false');
  assert.equal(await noteBadge.isVisible(), false);
  await page.locator('#terminal-toggle-btn').click();
  await page.waitForFunction(function () { return window.__sent.indexOf('term_create') >= 0; });
  assert.equal(await page.evaluate(function () { return !document.getElementById('terminal-container').classList.contains('hidden'); }), true, 'terminal handler opens the panel');
  await page.locator('#shared-browser-toggle-btn').click();
  await page.waitForFunction(function () { return window.__sent.indexOf('shared_browser_open') >= 0; });
  assert.equal(await page.locator('#shared-browser-toggle-btn').getAttribute('aria-expanded'), 'true', 'browser handler opens and sets aria-expanded');
  // Same nodes throughout.
  assert.equal(await page.evaluate(function (ids) { return ids.every(function (id, n) { return document.getElementById(id) === window.__nodes[n]; }); }, IDS), true);
  // Existing unavailable behaviour: disabled while disconnected, with the same title.
  var offline = await page.evaluate(async function () {
    var store = (await import('./modules/store.js')).store; var prev = store.get('connected');
    store.set({ connected: false }); var b = document.getElementById('shared-browser-toggle-btn');
    var res = { disabled: b.disabled, title: b.title }; store.set({ connected: prev }); return res;
  });
  assert.equal(offline.disabled, true); assert.match(offline.title, /Connecting/);

  // ---- Split panes: pane documents keep their (hidden) title bars, parent owns one set --
  var frames = await page.evaluate(function (ids) {
    return Array.from(document.querySelectorAll('iframe.split-pane-frame')).map(function (f) {
      var d = f.contentDocument; var top = d.getElementById('top-bar'); var title = d.querySelector('.title-bar-content');
      return { paneMode: d.body.classList.contains('pane-mode'), topHidden: getComputedStyle(top).display === 'none', titleHidden: getComputedStyle(title).display === 'none', visible: ids.filter(function (id) { var el = d.getElementById(id); return el && el.getClientRects().length > 0; }) };
    });
  }, IDS);
  frames.forEach(function (f) { assert.ok(f.paneMode && f.topHidden && f.titleHidden, 'pane chrome stays hidden'); assert.deepEqual(f.visible, [], 'pane documents show no duplicate controls (unchanged: parent shell owns them)'); });
  var parentStillHit = await page.evaluate(function () { var el = document.getElementById('sticky-notes-toggle-btn'); var r = el.getBoundingClientRect(); var h = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return !!h && el.contains(h); });
  assert.ok(parentStillHit, 'with split panes open the parent controls stay operable');

  // ---- Intermediate widths: the search trigger never overlaps either side group ----
  var report = [];
  async function crowd(width, heavy) {
    await page.setViewportSize({ width: width, height: 900 });
    await page.evaluate(function (heavy) {
      var actions = document.querySelector('#top-bar .top-bar-actions');
      var old = document.getElementById('wbx-chips'); if (old) old.remove();
      document.getElementById('skip-perms-pill').classList.toggle('hidden', !heavy);
      document.getElementById('client-count').classList.toggle('hidden', !heavy);
      document.getElementById('update-pill-wrap').classList.toggle('hidden', !heavy);
      document.getElementById('update-version').textContent = 'v9.9.9';
      if (!heavy) return;
      // Same structure as vendor-usage-overview.js: vendor items first, the all-vendors item last.
      var group = document.createElement('div'); group.className = 'vendor-usage-overview'; group.id = 'wbx-chips';
      ['Claude 84%', 'Codex 61%', 'Copilot 12%', 'All'].forEach(function (text) {
        var item = document.createElement('span'); item.className = 'vendor-usage-item';
        var b = document.createElement('button'); b.className = 'top-bar-pill vendor-usage-chip pill-dim'; b.textContent = text; item.appendChild(b); group.appendChild(item);
      });
      actions.insertBefore(group, document.getElementById('skip-perms-pill'));
    }, heavy);
    await page.waitForFunction(function () { return new Promise(function (r) { requestAnimationFrame(function () { requestAnimationFrame(function () { r(true); }); }); }); });
    return page.evaluate(function (width) {
      var bar = document.getElementById('top-bar'); var rect = function (el) { var r = el.getBoundingClientRect(); return { l: Math.round(r.left * 10) / 10, r: Math.round(r.right * 10) / 10 }; };
      var search = document.getElementById('cmd-palette-btn'); var actions = document.querySelector('#top-bar .top-bar-actions');
      var buttons = ['terminal-toggle-btn', 'sticky-notes-toggle-btn', 'notif-center-btn', 'server-settings-btn'].concat(width >= 1024 ? ['shared-browser-toggle-btn'] : []).map(function (id) { var el = document.getElementById(id); var r = el.getBoundingClientRect(); return { id: id, shown: getComputedStyle(el).display !== 'none' && r.width > 0, inside: r.left >= 0 && r.right <= window.innerWidth }; });
      return { width: width, icon: bar.classList.contains('search-icon'), compact: bar.className.replace(/\s+/g, ' '), search: rect(search), act: rect(actions), left: rect(document.querySelector('.top-bar-left-pills')),
        label: search.getAttribute('aria-label'), buttons: buttons, overflow: [getComputedStyle(bar).overflow, getComputedStyle(actions).overflow], chips: Array.from(document.querySelectorAll('#wbx-chips .vendor-usage-item')).map(function (el) { return getComputedStyle(el).display !== 'none'; }) };
    }, width);
  }
  for (var width of [769, 800, 980, 1024, 1280]) {
    for (var heavy of [false, true]) {
      var m = await crowd(width, heavy); report.push({ w: width, heavy: heavy, icon: m.icon, cls: m.compact, search: m.search, left: m.left.r, act: m.act.l, chips: m.chips.join(',') });
      if (shots && (width === 769 || width === 1024)) await page.screenshot({ path: path.join(shots, 'topbar-dark-' + width + (heavy ? '-heavy' : '-normal') + '.png'), clip: { x: 0, y: 0, width: width, height: 40 } });
      var label = width + (heavy ? ' heavy' : ' normal') + ' ' + JSON.stringify(m);
      assert.ok(m.search.l >= m.left.r + 4 - 0.5, 'search clears the left group at ' + label);
      assert.ok(m.search.r <= m.act.l - 4 + 0.5, 'search clears the actions at ' + label);
      m.buttons.forEach(function (b) { assert.ok(b.shown && b.inside, b.id + ' stays shown and unclipped at ' + label); });
      assert.equal(m.label, 'Search or ask Clay');
      assert.ok(m.overflow.indexOf('hidden') < 0 && m.overflow.indexOf('clip') < 0, 'no clipping container (popovers stay visible)');
      if (!m.icon) assert.ok(Math.abs((m.search.l + m.search.r) / 2 - width / 2) < 1.5, 'full search stays centred at ' + label);
      if (!heavy && width >= 1024) assert.equal(m.icon, false, 'normal desktop keeps the full search');
    }
  }
  console.log('top bar report ' + JSON.stringify(report));
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.evaluate(function () { var g = document.getElementById('wbx-chips'); if (g) g.remove(); });
  await page.locator('#cmd-palette-btn').click();
  assert.equal(await page.evaluate(function () { return !!document.querySelector('.cmd-palette:not(.hidden)'); }), true, 'search trigger keeps its handler');
  await page.keyboard.press('Escape');
  await page.evaluate(async function () { var m = await import('./modules/command-palette.js'); if (m.isCommandPaletteOpen()) m.closeCommandPalette(); });
  await page.close();

  // ---- Light theme screenshot ----------------------------------------------
  var light = await boot('light', 1280); await ready(light, false);
  await light.evaluate(function () { document.documentElement.className = document.documentElement.className.replace('dark-theme', '').trim() + ' light-theme'; });
  if (shots) await light.screenshot({ path: path.join(shots, 'topbar-light-1280.png'), clip: { x: 0, y: 0, width: 1280, height: 120 } });
  await light.close();

  // ---- Ownership: visibility per product state equals the pre-relocation baseline ----
  // Baseline (browser, terminal, sticky) measured on d041781a with the same state simulation.
  var BASELINE = {
    1280: { normal: 'hit,hit,hit', workspace: 'hit,hidden,hit', dm: 'hit,hidden,hit', shell: 'hidden,hidden,hidden', titlehidden: 'hidden,hidden,hidden', pane: 'hidden,hidden,hidden' },
    700: { normal: 'hidden,hit,hit', workspace: 'hidden,hidden,hit', dm: 'hidden,hidden,hit', shell: 'hidden,hidden,hidden', titlehidden: 'hidden,hidden,hidden', pane: 'hidden,hidden,hidden' }
  };
  var STATES = {
    normal: function () {},
    workspace: function () { document.body.classList.add('mate-workspace-active'); },
    dm: function () { document.body.classList.add('mate-dm-active'); document.querySelector('.title-bar-content').classList.add('mate-dm-active'); document.getElementById('terminal-toggle-btn').style.display = 'none'; },
    shell: function () { document.body.classList.add('projects-shell'); },
    titlehidden: function () { document.querySelector('.title-bar-content').classList.add('hidden'); },
    pane: function () { document.body.classList.add('pane-mode'); }
  };
  for (var ownWidth of [1280, 700]) {
    var own = await boot('dark', ownWidth); await ready(own, false); await addOpenNoteForControlTest(own);
    for (var stateName of Object.keys(STATES)) {
      await own.evaluate(function () {
        document.body.className = document.body.className.split(' ').filter(function (c) { return !/^(mate-workspace-active|mate-dm-active|projects-shell|pane-mode)$/.test(c); }).join(' ');
        document.querySelector('.title-bar-content').classList.remove('hidden', 'mate-dm-active'); document.getElementById('terminal-toggle-btn').style.display = '';
      });
      await own.evaluate(STATES[stateName]);
      var seen = await own.evaluate(function (ids) {
        return ids.map(function (id) {
          var el = document.getElementById(id); var b = el.getBoundingClientRect(); var cs = getComputedStyle(el);
          var vis = cs.display !== 'none' && cs.visibility !== 'hidden' && b.width > 0 && !!el.getClientRects().length; if (!vis) return 'hidden';
          var h = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2); return h && el.contains(h) ? 'hit' : 'covered';
        }).join(',');
      }, IDS);
      assert.equal(seen, BASELINE[ownWidth][stateName], 'controls available exactly where they were before: ' + ownWidth + ' ' + stateName);
      // Exactly one owner per control at all times.
      assert.deepEqual(await own.evaluate(function (ids) { return ids.map(function (id) { return document.querySelectorAll('#' + id).length; }); }, IDS), [1, 1, 1]);
    }
    await own.close();
  }

  // ---- Mobile: same nodes return to the title bar --------------------------
  var mobile = await boot('dark', 700); await ready(mobile, false).catch(function () {});
  await addOpenNoteForControlTest(mobile);
  await mobile.waitForFunction(function () { return !!document.querySelector('.title-bar-content #terminal-toggle-btn'); });
  var narrow = await mobile.evaluate(function (ids) {
    var out = { counts: ids.map(function (id) { return document.querySelectorAll('#' + id).length; }), topBar: getComputedStyle(document.getElementById('top-bar')).display, boxes: {} };
    ids.forEach(function (id) { var el = document.getElementById(id); var r = el.getBoundingClientRect(); var hit = r.width ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null; out.boxes[id] = { inStatus: !!el.closest('.title-bar-content .status'), shown: getComputedStyle(el).display !== 'none', hit: !!hit && el.contains(hit) }; });
    return out;
  }, IDS);
  assert.deepEqual(narrow.counts, [1, 1, 1]); assert.equal(narrow.topBar, 'none');
  IDS.forEach(function (id) { assert.ok(narrow.boxes[id].inStatus, id + ' back in the title status area'); });
  ['terminal-toggle-btn', 'sticky-notes-toggle-btn'].forEach(function (id) { assert.ok(narrow.boxes[id].shown && narrow.boxes[id].hit, id + ' operable on mobile'); });
  assert.equal(narrow.boxes['shared-browser-toggle-btn'].shown, false, 'Browser stays desktop-only below 1024px (unchanged)');
  await mobile.locator('#sticky-notes-toggle-btn').click();
  assert.equal(await mobile.locator('#sticky-notes-toggle-btn').getAttribute('aria-pressed'), 'true', 'sticky handler still bound after relocation');
  if (shots) await mobile.screenshot({ path: path.join(shots, 'title-mobile-dark-700.png'), clip: { x: 0, y: 0, width: 700, height: 120 } });
  // Growing back to desktop restores the top bar group, same nodes.
  await mobile.evaluate(function () { window.__n = document.getElementById('terminal-toggle-btn'); });
  await mobile.setViewportSize({ width: 1280, height: 900 });
  await mobile.waitForFunction(function () { return !!document.querySelector('#top-bar .top-bar-actions #terminal-toggle-btn'); });
  assert.equal(await mobile.evaluate(function () { return document.getElementById('terminal-toggle-btn') === window.__n; }), true);
  assert.deepEqual(errors, []);
});
