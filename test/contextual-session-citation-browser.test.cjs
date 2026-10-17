var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
test('assistant citations render safely through stream/history and resolve exact opaque targets from pane and native workspace', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); var output = '';
  child.stdout.on('data', function (value) { output += value; }); child.stderr.on('data', function (value) { output += value; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
  var origin = 'http://127.0.0.1:' + info.port, errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  var betaRequests = [], betaSwitches = [];
  page.on('websocket', function (socket) {
    if (new URL(socket.url()).pathname !== '/p/beta/ws') return;
    socket.on('framesent', function (frame) {
      var message = JSON.parse(String(frame.payload));
      if (message.type === 'switch_session') betaRequests.push(message.id);
    });
    socket.on('framereceived', function (frame) {
      var message = JSON.parse(String(frame.payload));
      if (message.type === 'session_switched') betaSwitches.push(message.id);
    });
  });
  await page.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; }); await page.locator('.icon-strip-brand').click();
  var pane = page.frameLocator('#contextual-clay iframe[data-canonical="true"]'); await pane.locator('#messages').getByText('Isolated canonical integration conversation.', { exact: true }).waitFor();
  var refs = await (await page.request.get(origin + '/fixture/session-citation')).json();
  var citation = pane.locator('.clayos-session-link[data-session-ref="' + refs.alphaRef + '"]').filter({ hasText: 'Oct 16' });
  await citation.waitFor();
  assert.equal(await citation.locator('small').textContent(), 'Oct 16');
  assert.equal(await pane.locator('pre code').filter({ hasText: 'fenced example' }).count(), 1);
  assert.equal(await pane.locator('code').filter({ hasText: 'call(' }).count(), 1);
  var windowFrame = page.frames().find(function (frame) { return frame.url().includes(info.sourceSlug); });
  var literals = await windowFrame.evaluate(async function (ref) {
    var renderer = await import('./modules/chat-bubble-renderer.js');
    var row = renderer.createAssistantBubble({}); document.getElementById('messages').appendChild(row);
    renderer.renderAssistantBubbleText(row, '`[clayos/' + ref + ' — literal canonical sample]`\n\n`var citation = "[clay-landing/' + ref + ' — literal mixed code]"`\n\n```js\n[clay-landing/' + ref + ' — fenced]\n```\n\n[clayos/session:short — malformed] [clayos/' + ref + '#entry-1.5 — invalid] [clayos/' + ref + '#entry-9007199254740992 — unsafe index]\n\n[<img src=x onerror=alert(1)>](' + ref + '#entry-0)');
    var result = { literalCodes: row.querySelectorAll('code').length, pills: row.querySelectorAll('.clayos-session-link').length, imageHandlers: row.querySelectorAll('[onerror]').length, entry: row.querySelector('.clayos-session-link').dataset.sessionEntryIndex };
    row.remove(); return result;
  }, refs.alphaRef);
  assert.deepEqual(literals, { literalCodes: 3, pills: 1, imageHandlers: 0, entry: '0' });
  for (var field of ['sessionOriginId', 'mateStamp', 'mateId']) {
    await page.evaluate(async function (field) {
      var socket = (await import('./modules/ws-ref.js')).getWs(), send = socket.send;
      socket.send = function (raw) {
        var request = JSON.parse(raw);
        if (request.type === 'home_clay_session_resolve') { request.contextualSource[field] = 'spoofed'; socket.send = send; return send.call(socket, JSON.stringify(request)); }
        return send.call(socket, raw);
      };
    }, field);
    await citation.click(); await citation.locator('..').locator('.is-error').waitFor();
    assert.equal(new URL(page.url()).pathname, '/p/alpha/');
  }
  for (var deniedRef of [refs.foreignRef, refs.hiddenRef, 'session:AAAAAAAAAAAAAAAAAAAAAAAA']) {
    var denied = pane.locator('.clayos-session-link[data-session-ref="' + deniedRef + '"]'); await denied.click(); await denied.locator('..').locator('.is-error[data-session-ref="' + deniedRef + '"]').waitFor();
    assert.equal(new URL(page.url()).pathname, '/p/alpha/'); assert.equal(await page.locator('#contextual-clay').isVisible(), true);
  }
  await page.screenshot({ path: '/tmp/clay-session-citation-popover.png' });
  await citation.click(); await pane.locator('.clayos-session-link.is-loading').waitFor({ state: 'detached' });
  assert.equal(await page.locator('#contextual-clay').isVisible(), true, 'Citation navigation keeps the source window open');
  assert.equal(new URL(page.url()).pathname, '/p/alpha/');
  await page.evaluate(async function () {
    var socket = (await import('./modules/ws-ref.js')).getWs(), receive = socket.onmessage;
    socket.onmessage = function (event) { if (JSON.parse(event.data).type === 'home_clay_session_target') { window.heldCitationReply = event; return; } receive(event); };
    window.releaseCitationReply = function () { socket.onmessage = receive; receive(window.heldCitationReply); };
  });
  await citation.click(); await page.waitForFunction(function () { return !!window.heldCitationReply; });
  await page.getByRole('link', { name: 'BI', exact: true }).click(); await page.waitForURL('**/p/beta/');
  await page.evaluate(function () { window.releaseCitationReply(); }); await citation.locator('..').locator('.is-error').waitFor({ state: 'attached' });
  assert.equal(new URL(page.url()).pathname, '/p/beta/');
  await page.locator('[data-clay-expand]').click(); await page.waitForURL('**/p/' + info.sourceSlug + '/');
  var nativeLink = page.locator('#messages .clayos-session-link[data-session-ref="' + refs.betaRef + '"]'); await nativeLink.waitFor();
  assert.equal(await nativeLink.getAttribute('data-session-entry-index'), '0');
  await page.screenshot({ path: '/tmp/clay-session-citation-native.png' });
  var requestsBeforeCitation = betaRequests.length, switchesBeforeCitation = betaSwitches.length;
  await nativeLink.click(); await page.waitForURL('**/p/beta/'); await page.locator('#messages').getByText('BETA_RENDERED_DESTINATION', { exact: true }).waitFor();
  await page.locator('#messages .session-entry-target').waitFor();
  assert.deepEqual(betaRequests.slice(requestsBeforeCitation), [], 'the initial destination identity must not request a duplicate replay');
  assert.equal(betaSwitches.length - switchesBeforeCitation, 1, 'native citation receives one authoritative initial replay');
  // A same-target authoritative replay must not consume the citation feedback.
  await page.evaluate(async function () {
    var state = (await import('/p/alpha/modules/store.js')).store;
    var socket = (await import('/p/alpha/modules/ws-ref.js')).getWs();
    window.citationReplayEpoch = state.get('sessionActionEpoch');
    socket.send(JSON.stringify({ type: 'switch_session', id: state.get('activeSessionId') }));
  });
  await page.waitForFunction(async function () {
    var state = (await import('/p/alpha/modules/store.js')).store;
    return state.get('sessionActionEpoch') > window.citationReplayEpoch
      && document.querySelector('#messages').textContent.includes('BETA_RENDERED_DESTINATION')
      && !state.get('replayingHistory');
  });
  await page.locator('#messages .session-entry-target').waitFor();
  assert.deepEqual(errors, []);
});
