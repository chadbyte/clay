var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

test('authoritative switches retain upload/voice ownership and reused panes reject delayed UI actions', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage(), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await page.addInitScript(function () {
    window.SpeechRecognition = function () { window.fixtureRecognition = this; };
    window.SpeechRecognition.prototype.start = function () { if (this.onstart) this.onstart(); };
    window.SpeechRecognition.prototype.abort = function () {};
  });
  var origin = 'http://127.0.0.1:' + info.port;
  await page.goto(origin + '/fixture/login');
  await page.waitForFunction(function () { return typeof window.runPaneReuseBench === 'function'; });
  await page.evaluate(async function () { window.fixtureStore = (await import('/p/reuse/modules/store.js')).store; window.fixtureWsRef = await import('/p/reuse/modules/ws-ref.js'); });
  await page.waitForFunction(function () { return window.fixtureStore.get('connected'); });
  await page.locator('[aria-label="Pane performance fixture"]').evaluate(function (panel) { panel.remove(); });
  var data = await page.evaluate(async function () { return (await fetch('/fixture/state')).json(); });
  async function switchTo(id) { await page.request.post(origin + '/fixture/switch?id=' + id); }
  async function nativeReady(id) {
    await page.waitForFunction(function (id) {
      var state = window.fixtureStore;
      return state.get('activeSessionId') === id && !state.get('deferredSessionSwitch') && document.getElementById('messages').dataset.controlSessionId === String(id);
    }, id);
  }
  var a = data.standaloneId, b = data.otherIds[0], c = data.otherIds[1];
  await page.request.post(origin + '/fixture/running?id=' + a);
  await switchTo(a); await nativeReady(a);
  await page.evaluate(async function () {
    (await import('/p/reuse/modules/input.js')).restoreComposerDraft({ text: 'Source draft', start: 2, end: 8, direction: 'backward', delay: 120000,
      images: [{ mediaType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jvS8AAAAASUVORK5CYII=' }],
      pastes: [{ text: 'Source paste', preview: 'Source paste' }], files: [{ name: 'existing.txt', path: 'existing.txt' }] });
  });
  var upload;
  await page.route('**/api/upload', function (route) { upload = route; });
  var chooser = page.waitForEvent('filechooser'); await page.locator('#attach-file-btn').click();
  await (await chooser).setFiles({ name: 'held.txt', mimeType: 'text/plain', buffer: Buffer.from('Upload owned by A') });
  await page.waitForFunction(function () { return window.fixtureStore.get('composerUploadingCount') === 1; });
  await switchTo(b); await switchTo(c);
  await page.waitForFunction(function () { var pending = window.fixtureStore.get('deferredSessionSwitch'); return pending && pending.messages.filter(function (m) { return m.type === 'session_switched'; }).length === 2; });
  assert.equal(await page.locator('#input').inputValue(), 'Source draft');
  assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('activeSessionId'); }), a);
  await page.evaluate(async function () { window.oldFixtureSocket = (await import('/p/reuse/modules/ws-ref.js')).getWs(); window.oldFixtureSocket.close(); });
  await page.waitForFunction(function () {
    var socket = window.fixtureWsRef.getWs(), state = window.fixtureStore;
    return socket !== window.oldFixtureSocket && state.get('connected') && state.get('deferredSessionSwitch') && state.get('deferredSessionSwitch').socket === socket;
  });
  await page.locator('#send-btn').click(); // Refused without clearing the old draft.
  assert.equal(await page.locator('#input').inputValue(), 'Source draft');
  await page.request.post(origin + '/fixture/running?id=' + a); await page.request.post(origin + '/fixture/running?id=' + c);
  await page.locator('#generation-stop').click();
  var effects = await (await page.request.get(origin + '/fixture/state')).json();
  assert.deepEqual(effects.stopped, [a], 'Stop during the wait addresses the displayed source, never the hidden destination');
  await upload.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ name: 'held.txt', path: 'held.txt' }) });
  await nativeReady(c);
  assert.equal(await page.locator('#input').inputValue(), '');
  assert.equal(await page.locator('.file-chip-name').count(), 0);
  assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/input.js')).getScheduleDelay(); }), 0);
  await switchTo(a); await nativeReady(a);
  assert.equal(await page.locator('#input').inputValue(), 'Source draft');
  assert.equal(await page.locator('.file-chip-name').filter({ hasText: 'held.txt' }).count(), 1);
  assert.equal(await page.locator('.pasted-chip-preview').textContent(), 'Source paste');
  assert.equal(await page.locator('.image-preview-thumb').count(), 1);
  assert.deepEqual(await page.locator('#input').evaluate(function (input) { return [input.selectionStart, input.selectionEnd, input.selectionDirection]; }), [2, 8, 'backward']);
  assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/input.js')).getScheduleDelay(); }), 120000);

  chooser = page.waitForEvent('filechooser'); await page.locator('#attach-file-btn').click();
  await (await chooser).setFiles({ name: 'failed.txt', mimeType: 'text/plain', buffer: Buffer.from('Failed upload') });
  await page.waitForFunction(function () { return window.fixtureStore.get('composerUploadingCount') === 1; });
  await switchTo(b); await page.waitForSelector('#session-switch-wait');
  await upload.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
  await nativeReady(b);
  await page.getByText('Upload failed: failed.txt. Your draft is preserved.', { exact: true }).waitFor();
  await switchTo(a); await nativeReady(a);
  assert.equal(await page.locator('#input').inputValue(), 'Source draft');
  assert.equal(await page.locator('.file-chip-name').filter({ hasText: 'failed.txt' }).count(), 0);

  // The production speech lifecycle retains the source until completion.
  await page.evaluate(async function () { (await import('/p/reuse/modules/stt-controller.js')).startSTT('stt-btn', document.getElementById('input')); });
  await page.waitForFunction(function () { return !!window.fixtureStore.get('speechActive'); });
  await switchTo(b);
  await page.waitForSelector('#session-switch-wait');
  await page.evaluate(function () { window.fixtureRecognition.onresult({ results: [[{ transcript: 'voice from A' }]] }); });
  await page.locator('#stt-btn').click();
  await nativeReady(b);
  assert.equal(await page.locator('#input').inputValue(), '');
  await switchTo(a); await nativeReady(a);
  assert.equal(await page.locator('#input').inputValue(), 'Source draft voice from A');

  // A native chooser created for A cannot later attach its selection to B.
  chooser = page.waitForEvent('filechooser'); await page.locator('#attach-file-btn').click();
  var oldChooser = await chooser;
  await switchTo(b); await nativeReady(b);
  await oldChooser.setFiles({ name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('late') });
  assert.equal(await page.locator('.file-chip-name').count(), 0);
  assert.equal(await page.evaluate(async function () { return (await import('/p/reuse/modules/store.js')).store.get('composerUploadingCount'); }), 0);

  // Production pane events: rename cancellation and a stale paste Save callback.
  await page.request.post(origin + '/fixture/review?id=' + data.groups[0].pair.driverId);
  await page.request.post(origin + '/fixture/dialog?id=' + data.groups[0].pair.driverId);
  await page.evaluate(async function (group) { (await import('/p/reuse/modules/split-view.js')).openGroup(group); }, data.groups[0]);
  async function paneReady(id) {
    await page.waitForFunction(function (id) { var frame = document.querySelector('#split-host iframe[data-session-id="' + id + '"]'); return frame && frame.clayPane && frame.clayPane.identity() && frame.clayPane.identity().ready && !frame.dataset.requestedSessionId; }, id);
  }
  await paneReady(data.groups[0].pair.driverId);
  var element = page.locator('#split-host iframe').first(), frame = await (await element.elementHandle()).contentFrame();
  await frame.waitForSelector('.user-dialog-container .permission-allow');
  await frame.evaluate(function () {
    window.oldDialogButton = document.querySelector('.user-dialog-container .permission-allow');
    window.oldPermissionButton = document.querySelector('.permission-container:not(.user-dialog-container) .permission-allow, .mate-permission-allow');
  });
  await frame.evaluate(async function () { (await import('/p/reuse/modules/input.js')).restoreComposerDraft({ text: 'Pane A', pastes: [{ text: 'Paste A', preview: 'Paste A' }] }); });
  await frame.getByRole('button', { name: 'Edit pasted content' }).click();
  await frame.locator('#paste-modal-editor').fill('Delayed paste edit from A');
  await page.locator('.split-pane-title').first().click();
  await page.locator('.split-pane-rename-input').fill('Stale rename');
  await page.evaluate(async function (group) {
    window.oldRename = document.querySelector('.split-pane-rename-input');
    (await import('/p/reuse/modules/split-pane-renderer.js')).updatePaneContextChip(document.querySelector('.split-pane'), { pct: 78, model: 'old model' });
    (await import('/p/reuse/modules/split-view.js')).openGroup(group);
    window.oldRename.dispatchEvent(new FocusEvent('blur'));
    if (document.querySelector('.split-pane-context-label').textContent) throw new Error('Old context survived retarget');
  }, data.groups[1]);
  await paneReady(data.groups[1].pair.driverId);
  await frame.evaluate(async function () { (await import('/p/reuse/modules/input.js')).restoreComposerDraft({ text: 'Pane B', pastes: [{ text: 'Paste B', preview: 'Paste B' }] }); });
  await frame.locator('#paste-modal-save').click();
  await frame.evaluate(function () { window.oldDialogButton.click(); window.oldPermissionButton.click(); });
  assert.equal(await frame.locator('.pasted-chip-preview').textContent(), 'Paste B');
  assert.equal(await page.locator('.split-pane-title').first().textContent(), 'Driver 1');
  effects = await (await page.request.get(origin + '/fixture/state')).json();
  assert.equal(effects.sessions.find(function (session) { return session.id === data.groups[0].pair.driverId; }).title, 'Driver 0');
  assert.deepEqual(effects.dialogs, []); assert.deepEqual(effects.reviews, []);
  await page.evaluate(async function (group) { (await import('/p/reuse/modules/split-view.js')).openGroup(group); }, data.groups[0]);
  await paneReady(data.groups[0].pair.driverId);
  await frame.locator('.user-dialog-container .permission-allow').click();
  var deadline = Date.now() + 5000;
  do { effects = await (await page.request.get(origin + '/fixture/state')).json(); if (effects.dialogs.length) break; await page.waitForTimeout(20); } while (Date.now() < deadline);
  assert.equal(effects.dialogs[0].sessionId, data.groups[0].pair.driverId);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: '/tmp/clay-pane-session-safety.png' });
});
