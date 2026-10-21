var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

test('automatic saved view restore starts each original pane once and commits ready history without a second click', { timeout: 45000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_PRESENTATION: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = '';
  child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { output += data; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Fixture startup: ' + output)); }, 15000);
    child.once('message', function (value) { clearTimeout(timer); resolve(value); });
  });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = [], messages = [], navigations = [], hostHistoryDone = 0;
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) {
    if (new URL(socket.url()).searchParams.get('pane') !== '1') {
      socket.on('framereceived', function (frame) { if (JSON.parse(String(frame.payload)).type === 'history_done') hostHistoryDone++; });
      return;
    }
    socket.on('framesent', function (frame) {
      var value = JSON.parse(String(frame.payload));
      if (value.type === 'switch_session') messages.push({ id: value.id, correlated: !!value.paneActivation });
    });
  });
  page.on('framenavigated', function (frame) {
    if (new URL(frame.url() || 'about:blank').searchParams.get('pane') === '1') navigations.push(frame.url());
  });
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login');
  var data = await (await page.request.get('http://127.0.0.1:' + info.port + '/fixture/state')).json();
  var group = data.restoreView;
  assert.ok(group, 'fixture created a real saved presentation view');
  await page.locator('[data-split-view-id="' + group.id + '"] .split-view-group-open').first().click();
  async function ready() {
    await page.waitForFunction(function (group) {
      var frames = Array.from(document.querySelectorAll('#split-host.visible .split-pane-frame'));
      return frames.length === group.members.length && group.members.every(function (id) {
        var frame = frames.find(function (item) { return Number(item.dataset.sessionId) === id; });
        var live = frame && frame.clayPane && frame.clayPane.identity(), doc = frame && frame.contentDocument;
        if (!live || !live.ready || live.sessionId !== id || frame.dataset.requestedSessionId || !doc) return false;
        var transcript = doc.getElementById('messages'), input = doc.getElementById('input');
        if (doc.getElementById('app').inert || doc.documentElement.dataset.paneReady !== 'true' || transcript.dataset.controlSessionId !== String(id) || !transcript.textContent.includes('EXACT_TRANSCRIPT_' + id)) return false;
        return !input.disabled && !input.readOnly && !doc.body.classList.contains('worker-pane-locked');
      });
    }, group, { timeout: 20000 });
  }
  await ready();
  assert.equal(await page.locator('.split-view-worker-pill').count(), 1, 'linked Worker remains a pill instead of an editable pane');
  messages = []; navigations = [];
  var releaseIdentity, identityRequested = false, beforeHistory = hostHistoryDone;
  var identityGate = new Promise(function (resolve) { releaseIdentity = resolve; });
  t.after(function () { releaseIdentity(); });
  await page.route('**/api/me', async function (route) {
    if (route.request().frame() !== page.mainFrame()) return route.continue();
    identityRequested = true; await identityGate; return route.continue();
  });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function (id) { return document.querySelector('#messages').textContent.includes('EXACT_TRANSCRIPT_' + id); }, group.pair.driverId);
  assert.ok(identityRequested && hostHistoryDone > beforeHistory, 'session hydration can complete before owner identity');
  releaseIdentity();
  // No sidebar action after late identity: server presence must restore the saved view.
  await ready();
  assert.equal(navigations.length, 2, 'each initial pane document navigates once: ' + JSON.stringify(navigations));
  assert.equal(messages.length, 2, 'one correlated activation per initial pane; no legacy replay');
  assert.ok(messages.every(function (message) { return message.correlated; }));
  assert.deepEqual(messages.map(function (message) { return message.id; }).sort(), group.members.slice().sort());
  await page.evaluate(function () {
    window.restoredPanes = Array.from(document.querySelectorAll('#split-host iframe')).map(function (frame) { return { frame: frame, document: frame.contentDocument }; });
  });
  await page.locator('[data-split-view-id="' + group.id + '"] .split-view-group-open').first().click();
  await ready();
  assert.equal(await page.evaluate(function () { return window.restoredPanes.every(function (entry) { return entry.frame.isConnected && entry.frame.contentDocument === entry.document; }); }), true);
  var identityChange = await page.evaluate(async function () {
    var state = (await import('/p/reuse/modules/store.js')).store;
    var restore = (await import('/p/reuse/modules/split-view.js')).maybeRestoreSplitGroup;
    var previous = state.snap(), frames = window.restoredPanes.map(function (entry) { return entry.frame; });
    if (previous.myUserId !== 'owner' || !previous.authIdentityLoaded || !previous.projectSplitViewActiveId) throw new Error('Expected authoritative hydrated owner store');
    state.set({ authIdentityLoaded: false });
    state.set({ myUserId: 'replacement-owner' });
    state.set({ authIdentityLoaded: true });
    var cleared = !state.get('projectSplitViewActiveId') && state.get('sessionActivatedProjectSlug') === null && state.get('paneBindingSessions').length === 0;
    var invalidated = frames.every(function (frame) { var live = frame.clayPane.identity(); return !frame.isConnected && !live.ready; });
    // Delayed snapshots from the old authenticated connection cannot reopen it.
    state.set({ activeSessionId: previous.activeSessionId, sessionActivatedProjectSlug: previous.sessionActivatedProjectSlug,
      sessionListProjectSlug: previous.sessionListProjectSlug, splitGroupsProjectSlug: previous.splitGroupsProjectSlug,
      splitGroups: previous.splitGroups, paneBindingSessions: previous.paneBindingSessions });
    restore(); await Promise.resolve();
    return { cleared: cleared, invalidated: invalidated, restored: !!state.get('projectSplitViewActiveId'), frames: document.querySelectorAll('#split-host iframe').length,
      nativeHidden: document.getElementById('app').classList.contains('split-native-hidden'), hostVisible: document.getElementById('split-host').classList.contains('visible') };
  });
  assert.deepEqual(identityChange, { cleared: true, invalidated: true, restored: false, frames: 0, nativeHidden: false, hostVisible: false }, 'replacement identity invalidates old ready bindings and refuses old-socket restoration');
  await page.goto('http://127.0.0.1:' + info.port + '/fixture/login?account=replacement');
  var replacement = await (await page.request.get('http://127.0.0.1:' + info.port + '/api/me')).json();
  assert.equal(replacement.user.id, 'replacement-owner', 'the browser is authenticated as the actual replacement account');
  assert.equal(await page.locator('#split-host iframe').count(), 0);
  assert.doesNotMatch(await page.locator('body').textContent(), /EXACT_TRANSCRIPT_/);
  assert.deepEqual(errors, []);
});
