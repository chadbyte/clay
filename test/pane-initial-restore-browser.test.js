var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

test('automatic pair restore starts each original pane once and commits ready history without a second click', { timeout: 45000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
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
  var group = data.groups[0];
  await page.locator('.session-item[data-session-id="' + group.pair.driverId + '"]').click();
  async function ready() {
    await page.waitForFunction(function (group) {
      var frames = Array.from(document.querySelectorAll('#split-host.visible .split-pane-frame'));
      return frames.length === group.members.length && group.members.every(function (id) {
        var frame = frames.find(function (item) { return Number(item.dataset.sessionId) === id; });
        var live = frame && frame.clayPane && frame.clayPane.identity(), doc = frame && frame.contentDocument;
        if (!live || !live.ready || live.sessionId !== id || frame.dataset.requestedSessionId || !doc) return false;
        var transcript = doc.getElementById('messages'), input = doc.getElementById('input');
        if (doc.getElementById('app').inert || doc.documentElement.dataset.paneReady !== 'true' || transcript.dataset.controlSessionId !== String(id) || !transcript.textContent.includes('EXACT_TRANSCRIPT_' + id)) return false;
        return id === group.pair.driverId ? !input.disabled && !input.readOnly : doc.body.classList.contains('worker-pane-locked');
      });
    }, group, { timeout: 20000 });
  }
  await ready();
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
  // No sidebar action after late identity: server presence must restore the pair.
  await ready();
  assert.equal(navigations.length, 2, 'each initial pane document navigates once');
  assert.equal(messages.length, 2, 'one correlated activation per initial pane; no legacy replay');
  assert.ok(messages.every(function (message) { return message.correlated; }));
  assert.deepEqual(messages.map(function (message) { return message.id; }).sort(), group.members.slice().sort());
  await page.evaluate(function () {
    window.restoredPanes = Array.from(document.querySelectorAll('#split-host iframe')).map(function (frame) { return { frame: frame, document: frame.contentDocument }; });
  });
  await page.locator('.session-item[data-session-id="' + group.pair.driverId + '"]').click();
  await ready();
  assert.equal(await page.evaluate(function () { return window.restoredPanes.every(function (entry) { return entry.frame.isConnected && entry.frame.contentDocument === entry.document; }); }), true);
  assert.deepEqual(errors, []);
});
