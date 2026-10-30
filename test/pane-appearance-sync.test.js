// A theme switch in the app shell must reach live split panes immediately, in
// both directions, using the persisted server preference. Real app, HTTP and
// WebSocket services with isolated storage and fenced providers.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
var COOKIE = { Cookie: 'relay_auth_user=pane-fixture-token' };

async function fixtureReadiness(page, driverId) {
  return page.evaluate(async function (id) {
    var state = (await import('./modules/store.js')).store.snap(), socket = (await import('./modules/ws-ref.js')).getWs();
    return { socket: socket && socket.readyState, connected: state.connected, owner: state.myUserId,
      project: state.activeProjectSlug, activated: state.sessionActivatedProjectSlug, sessions: state.sessionListProjectSlug,
      viewsHydrated: state.projectSplitViewHydrated, activeSession: state.activeSessionId,
      driverKnown: (state.paneBindingSessions || []).some(function (session) { return session.id === id; }),
      frames: document.querySelectorAll('iframe.split-pane-frame').length };
  }, driverId);
}
async function switchFixtureDriver(page, origin, fx, t) {
  var before = await fixtureReadiness(page, fx.driverId);
  // HTTP document load does not acknowledge the authenticated project socket,
  // session list or saved-View subscription. The fixture switch targets live sockets only.
  var refs = await page.evaluateHandle(async function () {
    return { store: (await import('./modules/store.js')).store, getWs: (await import('./modules/ws-ref.js')).getWs };
  });
  try {
    // Resolve imports once; the polling predicate must synchronously read live state.
    await page.waitForFunction(function (input) {
      var id = input.driverId, state = input.refs.store.snap(), socket = input.refs.getWs();
      var driver = (state.paneBindingSessions || []).find(function (session) { return session.id === id && session.ownerId === 'owner'; });
      return socket && socket.readyState === 1 && state.connected && state.authIdentityLoaded && state.myUserId === 'owner' &&
        state.currentSlug === 'reuse' && state.activeProjectSlug === 'reuse' && state.sessionActivatedProjectSlug === 'reuse' &&
        state.sessionListProjectSlug === 'reuse' && state.splitGroupsProjectSlug === 'reuse' && state.projectSplitViewHydrated &&
        state.projectSplitViewRequestSocket === socket && state.projectSplitViewRequestOwnerId === 'owner' &&
        state.projectSplitViewRequestSlug === 'reuse' && state.projectSplitViewRequestGeneration === state.projectSplitViewSocketGeneration &&
        driver && (state.projectSplitViews || []).some(function (view) {
          return view.sessions.some(function (session) { return session.id === id && session.sessionOriginId === driver.sessionOriginId; });
        });
    }, { refs: refs, driverId: fx.driverId }, { timeout: 20000 });
  } catch (error) {
    error.message += '\nProject readiness: ' + JSON.stringify(await fixtureReadiness(page, fx.driverId));
    throw error;
  } finally { await refs.dispose(); }
  t.diagnostic(JSON.stringify({ beforeSwitchReadiness: before, ready: await fixtureReadiness(page, fx.driverId) }));
  var response = await fetch(origin + '/fixture/switch?id=' + fx.driverId, { method: 'POST', headers: COOKIE });
  assert.equal(response.status, 200);
}

test('shell theme switches reach existing and new pane frames without saving from frames', { timeout: 120000 }, async function (t) {
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
  var page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.emulateMedia({ colorScheme: 'light' });
  var errors = [], saves = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('request', function (request) { if (request.method() === 'PUT' && request.url().indexOf('/api/user/appearance') >= 0) saves.push(request.frame().url()); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(origin + '/fixture/login');
  var fx = await (await fetch(origin + '/fixture/info', { headers: COOKIE })).json();
  await switchFixtureDriver(page, origin, fx, t);
  await page.waitForFunction(function () { return document.querySelectorAll('iframe.split-pane-frame').length === 2; }, null, { timeout: 20000 });

  function state() {
    return page.evaluate(function () {
      function read(d) { var h = d.documentElement; return { dark: h.classList.contains('dark-theme'), light: h.classList.contains('light-theme'), bg: getComputedStyle(h).getPropertyValue('--bg').trim() }; }
      return { parent: read(document), frames: Array.from(document.querySelectorAll('iframe')).map(function (f) { return read(f.contentDocument); }) };
    });
  }
  async function settle(mode) {
    await page.waitForFunction(function (want) {
      return Array.from(document.querySelectorAll('iframe')).every(function (f) { return f.contentDocument && f.contentDocument.documentElement && f.contentDocument.documentElement.classList.contains(want + '-theme'); });
    }, mode, { timeout: 5000 });
    var s = await state();
    s.frames.forEach(function (f) { assert.equal(f.bg, s.parent.bg, 'frame matches the shell ' + mode + ' palette'); });
  }
  await page.waitForFunction(function () {
    return Array.from(document.querySelectorAll('iframe')).every(function (f) { return f.contentDocument && f.contentDocument.documentElement && f.contentDocument.documentElement.classList.contains('light-theme') && f.contentDocument.body && f.contentDocument.body.classList.contains('pane-mode'); });
  }, null, { timeout: 20000 });
  var toggle = function () { return page.evaluate(async function () { (await import('./modules/theme.js')).toggleDarkMode(); }); };

  await toggle(); await settle('dark');
  await toggle(); await settle('light');
  await toggle(); await settle('dark');

  // A frame added while the shell is dark loads dark, then follows the next switch.
  await page.evaluate(function (id) {
    var frame = document.createElement('iframe'); frame.className = 'split-pane-frame'; frame.id = 'late-frame';
    frame.src = '/p/reuse/?pane=1&session=' + id; document.body.appendChild(frame);
  }, fx.workerId);
  await page.waitForFunction(function () { var f = document.getElementById('late-frame'); return f.contentDocument && f.contentDocument.body && f.contentDocument.body.classList.contains('pane-mode') && f.contentDocument.documentElement.classList.contains('dark-theme'); }, null, { timeout: 20000 });
  await toggle(); await settle('light');

  // Messages from a sibling frame or for a different owner are ignored.
  var snapshot = { themeId: 'clay-dark', userId: null, preference: { configured: true, theme: 'clay-dark', mode: 'dark', lightTheme: null, darkTheme: null } };
  // Saved View routing can replace a pane URL; use the mounted sibling frame.
  var sender = await (await page.locator('#split-host iframe.split-pane-frame').first().elementHandle()).contentFrame();
  assert.ok(sender, 'the mounted sibling frame is available');
  await sender.evaluate(function (value) { window.parent.frames[1].postMessage({ type: 'clay-appearance', snapshot: value }, location.origin); window.parent.frames[0].postMessage({ type: 'clay-appearance', snapshot: value }, location.origin); }, snapshot);
  snapshot.userId = 'someone-else';
  await page.evaluate(function (value) { Array.from(document.querySelectorAll('iframe.split-pane-frame')).forEach(function (f) { f.contentWindow.postMessage({ type: 'clay-appearance', snapshot: value }, location.origin); }); }, snapshot);
  await new Promise(function (resolve) { setTimeout(resolve, 500); });
  var ignored = await page.evaluate(function () { return Array.from(document.querySelectorAll('iframe.split-pane-frame')).map(function (f) { return f.contentDocument.documentElement.classList.contains('light-theme'); }); });
  assert.deepEqual(ignored, [true, true, true]);
  assert.deepEqual(saves.filter(function (url) { return url.indexOf('pane=1') >= 0; }), [], 'frames never save appearance');
  assert.deepEqual(errors, []);
});

// ---- precedence, strict contract, custom palettes, system mode, contextual window ----

async function bootApp(t) {
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
  var page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  await page.emulateMedia({ colorScheme: 'light' });
  var errors = [], puts = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  t.after(function () { assert.deepEqual(errors, []); });
  page.on('request', function (request) { if (request.method() === 'PUT' && request.url().indexOf('/api/user/appearance') >= 0) puts.push(request.frame().url()); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(origin + '/fixture/login');
  var fx = await (await fetch(origin + '/fixture/info', { headers: COOKIE })).json();
  await switchFixtureDriver(page, origin, fx, t);
  await page.waitForFunction(function () { return document.querySelectorAll('iframe.split-pane-frame').length === 2; }, null, { timeout: 20000 });
  await page.waitForFunction(function () {
    return Array.from(document.querySelectorAll('iframe')).every(function (f) { return f.contentDocument.body && f.contentDocument.body.classList.contains('pane-mode') && f.contentDocument.documentElement.classList.contains('light-theme'); });
  }, null, { timeout: 20000 });
  return { page: page, origin: origin, fx: fx, puts: puts };
}
function themeCall(page, name, args) {
  return page.evaluate(async function (payload) { var m = await import('./modules/theme.js'); m[payload.name].apply(null, payload.args); }, { name: name, args: args });
}
async function bgs(page) {
  return page.evaluate(function () {
    function bg(d) { return getComputedStyle(d.documentElement).getPropertyValue('--bg').trim().toUpperCase(); }
    return { parent: bg(document), frames: Array.from(document.querySelectorAll('iframe')).map(function (f) { return bg(f.contentDocument); }) };
  });
}
async function expectBg(page, want, label) {
  var last;
  for (var i = 0; i < 100; i++) {
    last = await bgs(page);
    if (last.parent === want && last.frames.every(function (v) { return v === want; })) return;
    await page.waitForTimeout(50);
  }
  assert.fail(label + ': expected every frame to show ' + want + ', saw ' + JSON.stringify(last));
}

test('a stale pane GET that resolves after the parent snapshot cannot overwrite the live view', { timeout: 120000 }, async function (t) {
  var app = await bootApp(t), page = app.page, held = [];
  await themeCall(page, 'selectAppearanceMode', ['light']);
  for (var attempt = 0; attempt < 100; attempt++) {
    var saved = await page.evaluate(async function () { var s = (await import('./modules/store.js')).store; return !s.get('appearanceDraft') && (s.get('appearancePreference') || {}).mode === 'light'; });
    if (saved) break;
    await page.waitForTimeout(50);
  }
  var stale = { configured: true, theme: 'clay-light', mode: 'light', lightTheme: 'clay-light', darkTheme: 'clay-dark' };
  await page.route('**/api/user/appearance', function (route) {
    var frameUrl = route.request().frame().url();
    if (route.request().method() === 'GET' && frameUrl.indexOf('pane=1') >= 0 && frameUrl.indexOf('late=1') >= 0) { held.push(route); return; }
    route.continue();
  });
  await page.evaluate(function (id) {
    var frame = document.createElement('iframe'); frame.className = 'split-pane-frame'; frame.id = 'late-frame';
    frame.src = '/p/reuse/?pane=1&late=1&session=' + id; document.body.appendChild(frame);
  }, app.fx.workerId);
  for (var i = 0; i < 200 && !held.length; i++) await page.waitForTimeout(50);
  assert.equal(held.length, 1, 'the new pane GET is in flight');
  await themeCall(page, 'toggleDarkMode', []);   // the parent save is pending; the old server answer is still on its way
  await page.waitForFunction(function () { var f = document.getElementById('late-frame'); return f.contentDocument.documentElement.classList.contains('dark-theme'); }, null, { timeout: 10000 });
  await held[0].fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stale) });
  await page.waitForTimeout(800);
  assert.equal(await page.evaluate(function () { var h = document.getElementById('late-frame').contentDocument.documentElement; return h.classList.contains('dark-theme') && !h.classList.contains('light-theme'); }), true, 'the late stale GET did not revert the frame');
  assert.deepEqual(app.puts.filter(function (url) { return url.indexOf('pane=1') >= 0; }), [], 'no pane frame saved anything');
});

test('snapshots are accepted only with the exact shape and owner', { timeout: 120000 }, async function (t) {
  var app = await bootApp(t), page = app.page;
  var owner = await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('myUserId') || null; });
  var target = await (await page.locator('iframe.split-pane-frame').first().elementHandle()).contentFrame();
  function good(extra) {
    var base = { themeId: 'clay-dark', userId: owner, preference: { configured: true, theme: 'clay-dark', mode: 'dark', lightTheme: null, darkTheme: null } };
    return Object.assign(base, extra || {});
  }
  function send(snapshot) {
    return page.evaluate(function (value) { document.querySelector('iframe.split-pane-frame').contentWindow.postMessage({ type: 'clay-appearance', snapshot: value }, location.origin); }, snapshot);
  }
  async function isDark() { return target.evaluate(function () { return document.documentElement.classList.contains('dark-theme'); }); }
  var withPref = function (patch) { return good({ preference: Object.assign({ configured: true, theme: 'clay-dark', mode: 'dark', lightTheme: null, darkTheme: null }, patch) }); };
  var bad = [
    ['themeId missing', (function () { var s = good(); delete s.themeId; return s; })()],
    ['themeId not a string', good({ themeId: 5 })],
    ['themeId undefined coerced', good({ themeId: undefined })],
    ['userId missing', (function () { var s = good(); delete s.userId; return s; })()],
    ['userId a number', good({ userId: 7 })],
    ['null userId into a known owner', good({ userId: null })],
    ['other owner', good({ userId: 'someone-else' })],
    ['background color invalid', withPref({ backgroundColor: 'url(evil)' })],
    ['background color object', withPref({ backgroundColor: {} })],
    ['missing custom selection', withPref({ backgroundColor: 'custom-missing', customBackgroundColors: [] })],
    ['custom CSS value', withPref({ backgroundColor: 'custom-bad', customBackgroundColors: [{ id: 'custom-bad', name: 'Bad', light: 'url(evil)', dark: '#112233' }] })],
    ['duplicate custom identity', withPref({ customBackgroundColors: [{ id: 'custom-a', name: 'A', light: '#112233', dark: '#223344' }, { id: 'custom-a', name: 'B', light: '#112233', dark: '#223344' }] })],
    ['mode invalid', withPref({ mode: 'purple' })],
    ['configured missing', withPref({ configured: undefined })],
    ['theme a number', withPref({ theme: 5 })],
    ['lightTheme undefined', withPref({ lightTheme: undefined })],
    ['darkTheme an object', withPref({ darkTheme: {} })],
  ];
  assert.ok(owner, 'the fixture owner is known in the shell');
  for (var item of bad) {
    await send(item[1]); await page.waitForTimeout(200);
    assert.equal(await isDark(), false, item[0] + ' must be ignored');
  }
  await send(good()); await page.waitForFunction(function () { return document.querySelector('iframe.split-pane-frame').contentDocument.documentElement.classList.contains('dark-theme'); }, null, { timeout: 5000 });
  assert.equal(await isDark(), true, 'the exact snapshot for the known owner applies');
  // Identity not yet known in the frame (init/solo): a well-formed snapshot applies; once known, null no longer does.
  await target.evaluate(async function () { (await import('./modules/store.js')).store.set({ myUserId: null }); });
  await send(good({ userId: null, themeId: 'clay-light', preference: { configured: true, theme: 'clay-light', mode: 'light', lightTheme: null, darkTheme: null } }));
  await page.waitForFunction(function () { return document.querySelector('iframe.split-pane-frame').contentDocument.documentElement.classList.contains('light-theme'); }, null, { timeout: 5000 });
  await target.evaluate(async function (id) { (await import('./modules/store.js')).store.set({ myUserId: id }); }, owner);
  await send(good({ userId: null })); await page.waitForTimeout(250);
  assert.equal(await isDark(), false, 'after the owner is known a null-owner snapshot is rejected');
});

test('custom palettes and system mode stay in step in existing and new frames without extra saves', { timeout: 120000 }, async function (t) {
  var app = await bootApp(t), page = app.page;
  await themeCall(page, 'selectAppearanceTheme', ['light', 'fixture-day']);
  await themeCall(page, 'selectAppearanceTheme', ['dark', 'fixture-night']);
  await themeCall(page, 'selectAppearanceMode', ['light']);
  await expectBg(page, '#FFF4E0', 'custom light');
  await themeCall(page, 'selectAppearanceMode', ['dark']);
  await expectBg(page, '#102030', 'custom dark');
  await page.evaluate(function (id) {
    var frame = document.createElement('iframe'); frame.className = 'split-pane-frame'; frame.id = 'late-frame';
    frame.src = '/p/reuse/?pane=1&session=' + id; document.body.appendChild(frame);
  }, app.fx.workerId);
  await page.waitForFunction(function () { var f = document.getElementById('late-frame'); return f.contentDocument.body && f.contentDocument.body.classList.contains('pane-mode'); }, null, { timeout: 20000 });
  await expectBg(page, '#102030', 'new frame loads with the custom dark palette');
  await themeCall(page, 'selectAppearanceMode', ['system']);
  await expectBg(page, '#FFF4E0', 'system mode under a light OS follows the light custom palette');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expectBg(page, '#102030', 'system mode follows the OS change in every frame');
  await page.emulateMedia({ colorScheme: 'light' });
  await expectBg(page, '#FFF4E0', 'and back');
  assert.deepEqual(app.puts.filter(function (url) { return url.indexOf('pane=1') >= 0; }), [], 'no pane frame saved anything');
  assert.ok(app.puts.length >= 3, 'only the shell saved (' + app.puts.length + ' PUTs)');
});

test('the contextual Clay window follows the shell theme in both directions without saving', { timeout: 120000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = ''; child.stdout.on('data', function (d) { output += d; }); child.stderr.on('data', function (d) { output += d; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 20000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(15000);
  await page.emulateMedia({ colorScheme: 'light' });
  var puts = [], errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  t.after(function () { assert.deepEqual(errors, []); });
  page.on('request', function (request) { if (request.method() === 'PUT' && request.url().indexOf('/api/user/appearance') >= 0) puts.push(request.frame().url()); });
  await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.locator('.icon-strip-brand').click();
  await page.waitForFunction(function () { var pane = document.querySelector('#contextual-clay iframe:not([hidden])'); return pane && pane.conversation && pane.conversation.identity().ready; });
  var pane = function () { return page.evaluate(function () { var h = document.querySelector('#contextual-clay iframe:not([hidden])').contentDocument.documentElement; return { dark: h.classList.contains('dark-theme'), light: h.classList.contains('light-theme'), bg: getComputedStyle(h).getPropertyValue('--bg').trim(), parent: getComputedStyle(document.documentElement).getPropertyValue('--bg').trim() }; }); };
  async function settle(mode) {
    for (var i = 0; i < 100; i++) { var state = await pane(); if (state[mode] && state.bg === state.parent) return state; await page.waitForTimeout(50); }
    assert.fail('contextual window did not reach ' + mode + ': ' + JSON.stringify(await pane()));
  }
  await settle('light');
  await themeCall(page, 'toggleDarkMode', []); await settle('dark');
  await themeCall(page, 'toggleDarkMode', []); await settle('light');
  assert.deepEqual(puts.filter(function (url) { return url.indexOf('contextual=1') >= 0 || url.indexOf('pane=1') >= 0; }), [], 'the contextual window never saves');
  assert.ok(puts.length >= 2);
});
