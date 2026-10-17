var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
test('all Mate headers create and open authoritative saved conversations while preserving draft ownership', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); var output = '';
  child.stdout.on('data', function (value) { output += value; }); child.stderr.on('data', function (value) { output += value; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' });
  var page = await context.newPage(); page.setDefaultTimeout(15000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  var origin = 'http://127.0.0.1:' + info.port;
  await page.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.evaluate(async function () { window.sessionStore = (await import('./modules/store.js')).store; window.sessionWs = (await import('./modules/ws-ref.js')).getWs; });
  await page.locator('#input').fill('Background project draft');
  function pane() { return page.frameLocator('#contextual-clay iframe:visible'); }
  async function ready() { try { await page.waitForFunction(function () { var frame = document.querySelector('#contextual-clay iframe:not([hidden])'); return frame && frame.conversation && frame.conversation.identity().ready; }); } catch (error) { console.log(await page.evaluate(function () { return JSON.stringify({ state: window.sessionStore.get('contextualClay'), origin: window.sessionStore.get('contextualNativeOrigin'), route: location.pathname, frames: Array.from(document.querySelectorAll('#contextual-clay iframe')).map(function (f) { return { src: f.src, hidden: f.hidden, identity: f.conversation && f.conversation.identity() }; }) }); })); throw error; } }
  async function history() { var previous = await page.evaluate(function () { var request = window.sessionStore.get('contextualConversationHistory'); return request && request.requestId; }); await page.locator('[data-mate-history] summary').click(); await page.waitForFunction(function (id) { var request = window.sessionStore.get('contextualConversationHistory'); return request && request.requestId !== id && request.status === 'done'; }, previous); await page.locator('[data-mate-session-list] button').first().waitFor(); }
  async function choose(id) { await page.locator('[data-mate-session-list] button[data-session-id="' + id + '"]').click(); await page.waitForFunction(function (selected) { return window.sessionStore.get('contextualClay').sessionId === selected && window.sessionStore.get('contextualConversationRequest').status === 'done'; }, id); await page.locator('[data-mate-history]:not([open])').waitFor(); await ready(); }
  async function currentId() { return page.evaluate(function () { return window.sessionStore.get('contextualClay').sessionId; }); }
  var targets = [{ id: info.sourceSlug.slice(5), slug: info.sourceSlug, name: 'Clay', sessionId: info.sourceSessionId }].concat(info.ordinaryMates);
  for (var target of targets) {
    await page.locator(target.name === 'Clay' ? '.icon-strip-brand' : '.icon-strip-project-mate[data-mate-id="' + target.id + '"]').click(); await ready();
    var original = await currentId(), saved = info.savedConversations.find(function (item) { return item.mateId === target.id; });
    await pane().locator('#input').fill(target.name + ' retained draft');
    await pane().locator('#contextual-attach-btn').click();
    var chooser = page.waitForEvent('filechooser'); await pane().locator('#attach-file-btn').click();
    await (await chooser).setFiles({ name: 'retained.txt', mimeType: 'text/plain', buffer: Buffer.from('Retained attachment') });
    await pane().locator('#image-preview-bar').getByText('retained.txt', { exact: true }).waitFor();
    var reviewRequest = null, reviewId = null;
    if (target.name !== 'Clay') {
      reviewRequest = page.request.get(origin + '/fixture/ordinary-question?index=' + info.ordinaryMates.findIndex(function (mate) { return mate.id === target.id; }));
      await pane().locator('.ask-user-container:not(.answered)').waitFor();
      reviewId = await pane().locator('.ask-user-container:not(.answered)').getAttribute('data-tool-id');
    }
    await history();
    assert.equal(await page.getByText('FOREIGN_PRIVATE_CONVERSATION', { exact: true }).count(), 0);
    assert.equal(await page.locator('[data-mate-session-list] button[aria-current="true"]').count(), 1);
    await choose(saved.sessionId);
    await pane().locator('#messages').getByText('HISTORY_NOT_PREVIOUSLY_MOUNTED', { exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/p/alpha/'); assert.equal(await page.locator('#input').inputValue(), 'Background project draft');
    await history(); await choose(original);
    assert.equal(await pane().locator('#input').inputValue(), target.name + ' retained draft');
    assert.equal(await pane().locator('#image-preview-bar').getByText('retained.txt', { exact: true }).count(), 1);
    await page.locator('[data-mate-new]').evaluate(function (button) { button.click(); button.click(); });
    await page.waitForFunction(function (id) { return window.sessionStore.get('contextualClay').sessionId !== id && window.sessionStore.get('contextualConversationRequest').status === 'done'; }, original); await ready();
    var fresh = await currentId(); assert.notEqual(fresh, original);
    await page.request.get(origin + '/fixture/response-phase?slug=' + target.slug + '&session=' + original + '&phase=stream');
    assert.equal(await pane().locator('#input').inputValue(), ''); assert.equal(await pane().locator('#messages .msg-user').count(), 0);
    await history(); assert.equal(await page.locator('[data-mate-session-list] button').count(), 3); await choose(original);
    assert.equal(await pane().locator('#input').inputValue(), target.name + ' retained draft');
    await pane().locator('#messages').getByText('IDENTITY_STREAM_' + original, { exact: false }).waitFor();
    if (reviewRequest) {
      var review = pane().locator('.ask-user-container:not(.answered)');
      assert.equal(await review.getAttribute('data-tool-id'), reviewId);
      await review.getByText('Tests', { exact: true }).click(); await review.locator('.ask-user-submit').click(); await reviewRequest;
    }
    await page.locator('[data-clay-close]').click();
  }
  assert.equal((await (await page.request.get(origin + '/fixture/model-inputs')).json()).length, 0, 'Blank chats do not execute a provider');
  // Saved history survives reload and includes sessions that were never mounted.
  await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.evaluate(async function () { window.sessionStore = (await import('./modules/store.js')).store; window.sessionWs = (await import('./modules/ws-ref.js')).getWs; });
  await page.locator('.icon-strip-brand').click(); await ready(); await history(); assert.equal(await page.locator('[data-mate-session-list] button').count(), 3);
  await page.locator('[data-mate-history] summary').focus(); await page.keyboard.press('ArrowDown');
  assert.equal(await page.locator('[data-mate-session-list] button:focus').count(), 1);
  await page.keyboard.press('Escape'); await page.locator('[data-mate-history]:not([open])').waitFor(); assert.equal(await page.locator('#contextual-clay:visible').count(), 1);
  // Native exact-session background lends the writer when selected from history.
  await page.locator('[data-clay-expand]').click(); await page.waitForURL('**/p/' + info.sourceSlug + '/');
  await page.waitForFunction(function () { return window.sessionStore.get('contextualWorkspace') && window.sessionStore.get('contextualWorkspace').stage === 'workspace'; });
  var canonicalNativeId = await page.evaluate(function () { return window.sessionStore.get('activeSessionId'); });
  await page.locator('#input').fill('Canonical native background retained');
  await page.getByRole('button', { name: 'Search or ask Clay', exact: true }).click();
  await page.locator('.cmd-palette-input').fill('Start the history continuity check'); await page.locator('.is-ask-clay').click();
  await page.waitForFunction(function () { var request = window.sessionStore.get('contextualSearchAsk'); return request && request.status === 'acknowledged'; });
  await history(); await choose(canonicalNativeId);
  assert.equal(await pane().locator('#input').inputValue(), 'Canonical native background retained');
  assert.equal(await page.locator('#input-wrapper').evaluate(function (node) { return node.inert; }), true);
  await page.locator('[data-clay-expand]').click();
  assert.equal(new URL(page.url()).pathname, '/p/' + info.sourceSlug + '/');
  assert.equal(await page.locator('#input').inputValue(), 'Canonical native background retained');
  assert.equal(await page.evaluate(function () { return window.sessionStore.get('activeSessionId'); }), canonicalNativeId);
  var mainPage = page;
  page = await mainPage.context().newPage(); page.setDefaultTimeout(15000);
  await page.goto(origin + '/p/' + info.ordinaryMates[0].slug + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.evaluate(async function () { window.sessionStore = (await import('./modules/store.js')).store; window.sessionWs = (await import('./modules/ws-ref.js')).getWs; });
  await page.waitForFunction(function () { return window.sessionStore.get('activeSessionId') && window.sessionStore.get('sessionOriginId') && window.sessionStore.get('connected'); });
  await page.locator('#input').fill('Native current session draft');
  var nativeId = await page.evaluate(function () { return window.sessionStore.get('activeSessionId'); });
  await page.locator('.icon-strip-project-mate[data-mate-id="' + info.ordinaryMates[0].id + '"]').click(); await ready();
  await page.locator('[data-mate-new]').click(); await page.waitForFunction(function () { return window.sessionStore.get('contextualConversationRequest').status === 'done'; }); await ready();
  assert.equal(await page.locator('#input').inputValue(), 'Native current session draft');
  assert.equal(await page.locator('#input').evaluate(function (input) { return !!input.closest('[inert]'); }), false);
  await history(); await choose(nativeId);
  assert.equal(await pane().locator('#input').inputValue(), 'Native current session draft');
  assert.equal(await page.locator('#input').evaluate(function (input) { return !!input.closest('[inert]'); }), true);
  await page.locator('[data-clay-close]').click(); assert.equal(await page.locator('#input').inputValue(), 'Native current session draft');
  assert.equal(await page.locator('#input').evaluate(function (input) { return !!input.closest('[inert]'); }), false);
  await page.locator('.icon-strip-project-mate[data-mate-id="' + info.ordinaryMates[0].id + '"]').click(); await ready(); await page.locator('[data-clay-expand]').click();
  assert.equal(await page.locator('#input').inputValue(), 'Native current session draft');
  await page.close(); page = mainPage;
  await page.locator('#contextual-workspace-back').click(); await page.waitForURL('**/p/alpha/');
  await page.locator('.icon-strip-project-mate[data-mate-id="' + targets[1].id + '"]').click(); await ready();
  await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' }); await history();
  await page.screenshot({ path: '/tmp/mate-conversations-narrow-dark.png' });
  var geometry = await page.locator('[data-mate-history] > div').boundingBox(); assert.ok(geometry.x >= 0 && geometry.x + geometry.width <= 390);
  await page.keyboard.press('Escape'); await page.emulateMedia({ colorScheme: 'light' }); await history(); await page.screenshot({ path: '/tmp/mate-conversations-narrow-light.png' }); await page.keyboard.press('Escape');
  await page.setViewportSize({ width: 1280, height: 800 }); await history(); await page.screenshot({ path: '/tmp/mate-conversations-desktop-light.png' }); await page.keyboard.press('Escape');
  await page.emulateMedia({ colorScheme: 'dark' }); await history(); await page.screenshot({ path: '/tmp/mate-conversations-desktop-dark.png' }); await page.keyboard.press('Escape');
  // Offline activation retains exact selected session and draft; reconnect does not create.
  var before = await currentId(); await page.context().setOffline(true); await page.waitForFunction(function () { return !window.sessionStore.get('connected'); });
  await page.locator('[data-mate-new]').click(); await page.locator('[data-conversation-notice]').getByText('Reconnect to load or start a conversation.').waitFor();
  assert.equal(await currentId(), before); await page.context().setOffline(false); await page.waitForFunction(function () { return window.sessionStore.get('connected'); });
  assert.equal(await currentId(), before);
  await history(); var priorCount = await page.locator('[data-mate-session-list] button').count(); await page.keyboard.press('Escape');
  await page.evaluate(function () {
    var socket = window.sessionWs(), receive = socket.onmessage;
    socket.onmessage = function (event) {
      var message = JSON.parse(event.data), request = window.sessionStore.get('contextualConversationRequest');
      if (message.type === 'contextual_mate_sessions_result' && request && request.kind === 'new' && request.requestId === message.requestId && message.ok) { window.lostCreationReceipt = message; socket.onmessage = receive; socket.close(); return; }
      receive(event);
    };
  });
  await page.locator('[data-mate-new]').click();
  await page.waitForFunction(function () { return window.lostCreationReceipt && window.sessionStore.get('connected') && window.sessionStore.get('contextualConversationRequest').status === 'error'; });
  assert.equal(await currentId(), before);
  await page.locator('[data-conversation-notice] button').click();
  await page.waitForFunction(function () { return window.sessionStore.get('contextualConversationRequest').status === 'done'; }); await ready();
  assert.equal(await currentId(), await page.evaluate(function () { return window.lostCreationReceipt.sessionId; }));
  await history(); assert.equal(await page.locator('[data-mate-session-list] button').count(), priorCount + 1);
  var selectedBeforeDelete = await currentId();
  await page.request.get(origin + '/fixture/remove-saved-conversation?mate=' + targets[1].id);
  await page.locator('[data-mate-session-list] button[data-session-id="3"]').click();
  await page.locator('[data-conversation-notice]').getByText('This conversation is no longer available.', { exact: true }).waitFor();
  assert.equal(await currentId(), selectedBeforeDelete); await page.keyboard.press('Escape');
  var foreignDenied = await page.evaluate(async function (id) {
    var socket = window.sessionWs(), mate = window.sessionStore.get('cachedMatesList').find(function (item) { return item.id === id; });
    var requestId = 'mate-conversations-' + crypto.randomUUID();
    return new Promise(function (resolve) {
      function receive(event) { var message = JSON.parse(event.data); if (message.requestId === requestId) { socket.removeEventListener('message', receive); resolve(message); } }
      socket.addEventListener('message', receive);
      socket.send(JSON.stringify({ type: 'home_mate_session_open', presentation: 'contextual', requestId: requestId, mateId: id, mateStamp: JSON.stringify([mate.id, mate.createdBy || null, mate.createdAt || null, mate.builtinKey || null]), sessionId: 'local:4', sessionOriginId: 'foreign' }));
    });
  }, targets[1].id);
  assert.equal(foreignDenied.ok, false); assert.equal(await currentId(), selectedBeforeDelete);
  // Hold the real list request to inspect loading; then use real empty storage.
  await page.evaluate(function () {
    var socket = window.sessionWs(), send = socket.send;
    socket.send = function (raw) { if (JSON.parse(raw).type === 'home_mate_sessions_list') { window.heldHistoryRequest = raw; return; } return send.call(socket, raw); };
    window.releaseHistoryRequest = function () { socket.send = send; send.call(socket, window.heldHistoryRequest); };
  });
  await page.locator('[data-mate-history] summary').click();
  await page.locator('[data-mate-session-list]').getByText('Loading conversations…', { exact: true }).waitFor();
  await page.evaluate(function () { window.releaseHistoryRequest(); }); await page.locator('[data-mate-session-list] button').first().waitFor(); await page.keyboard.press('Escape');
  await page.request.get(origin + '/fixture/clear-owned-conversations?mate=' + targets[1].id);
  await page.locator('[data-mate-history] summary').click(); await page.locator('[data-mate-session-list]').getByText('No saved conversations yet.', { exact: true }).waitFor();
  assert.equal(await page.getByText('FOREIGN_PRIVATE_CONVERSATION', { exact: true }).count(), 0);
  await page.keyboard.press('Escape');
  assert.deepEqual(errors, []);
});
