var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
test('held provider responses retain exact Mate identity from waiting through thoughts and streams', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); var output = '';
  child.stdout.on('data', function (value) { output += value; }); child.stderr.on('data', function (value) { output += value; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(15000);
  var origin = 'http://127.0.0.1:' + info.port;
  await page.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  var targets = info.ordinaryMates.concat([{ id: info.sourceSlug.slice(5), name: 'Clay', slug: info.sourceSlug, sessionId: info.sourceSessionId }]);
  for (var target of targets) {
    await page.locator(target.name === 'Clay' ? '.icon-strip-brand' : '.icon-strip-project-mate[data-mate-id="' + target.id + '"]').click();
    var surfaceFrame = page.frameLocator('#contextual-clay iframe:visible');
    await page.waitForFunction(function (id) { var frame = document.querySelector('#contextual-clay iframe[data-mate-id="' + id + '"]'); return frame && frame.conversation && frame.conversation.identity().ready; }, target.id);
    var pane = page.frames().find(function (frame) { return frame.url().includes(target.slug); });
    var expected = await pane.evaluate(async function () { var store = (await import('./modules/store.js')).store; return (await import('./modules/project-chat-identity.js')).resolveProjectAssistantIdentity(store.snap()); });
    await pane.evaluate(function () {
      window.identitySamples = [];
      function sample() { document.querySelectorAll('.activity-inline-avatar, .mate-pre-thinking .dm-bubble-avatar, .thinking-item .dm-bubble-avatar, .msg-assistant .dm-bubble-avatar').forEach(function (image) { window.identitySamples.push(image.getAttribute('src')); }); }
      new MutationObserver(sample).observe(document.getElementById('messages'), { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    });
    if (target.id === targets[0].id) await pane.evaluate(async function () {
      var store = (await import('./modules/store.js')).store, ws = (await import('./modules/ws-ref.js')).getWs(), receive = ws.onmessage;
      ws.onmessage = function (event) { if (JSON.parse(event.data).type === 'mate_list') window.identityHeldMetadata = event; else receive(event); };
      window.identityReleaseMetadata = function () { ws.onmessage = receive; receive(window.identityHeldMetadata); };
      store.set({ cachedMatesList: [] }); ws.send(JSON.stringify({ type: 'mate_list' }));
    });
    await surfaceFrame.locator('#input').fill('CONTEXTUAL_HOLD_FOR_QUEUE identity ' + target.name); await surfaceFrame.locator('#send-btn').click();
    await surfaceFrame.locator('.activity-inline-avatar').waitFor();
    if (target.id === targets[0].id) {
      assert.match(await surfaceFrame.locator('.activity-inline-avatar').getAttribute('src'), /^data:image\/svg/);
      await pane.waitForFunction(function () { return !!window.identityHeldMetadata; });
      await pane.evaluate(function () { window.identityReleaseMetadata(); });
    }
    assert.equal(await surfaceFrame.locator('.activity-inline-avatar').getAttribute('src'), expected.avatarUrl);
    assert.equal(await surfaceFrame.locator('.activity-inline').getAttribute('data-session-mate-id'), target.id);
    assert.equal(await surfaceFrame.locator('.activity-inline').getAttribute('role'), 'status');
    assert.ok((await surfaceFrame.locator('.activity-inline').getAttribute('aria-label')).startsWith(expected.name + ' · '));
    await page.screenshot({ path: '/tmp/mate-response-' + target.name.split(' ')[0] + '-waiting.png', animations: 'disabled' });
    await page.locator('[data-clay-expand]').click();
    await page.waitForFunction(function (target) { return location.pathname === '/p/' + target.slug + '/' && document.querySelector('.activity-inline-avatar'); }, target);
    assert.equal(await page.locator('.activity-inline-avatar').getAttribute('src'), expected.avatarUrl);
    await page.request.get(origin + '/fixture/response-phase?slug=' + target.slug + '&session=' + target.sessionId + '&phase=thinking');
    await page.locator('.thinking-item:not(.mate-pre-thinking) .dm-bubble-avatar').last().waitFor();
    assert.equal(await page.locator('.thinking-item:not(.mate-pre-thinking) .dm-bubble-avatar').last().getAttribute('src'), expected.avatarUrl);
    await page.request.get(origin + '/fixture/response-phase?slug=' + target.slug + '&session=' + target.sessionId + '&phase=stream&surface=native');
    await page.waitForFunction(function (marker) { var rows = document.querySelectorAll('#messages .msg-assistant .md-content'); return rows.length && rows[rows.length - 1].textContent.trim().endsWith(marker); }, 'IDENTITY_STREAM_' + target.sessionId + '_native');
    assert.equal(await page.locator('.msg-assistant .dm-bubble-avatar').last().getAttribute('src'), expected.avatarUrl);
    await page.setViewportSize({ width: 390, height: 844 }); await page.screenshot({ path: '/tmp/mate-response-' + target.name.split(' ')[0] + '-native-narrow.png', animations: 'disabled' });
    await page.locator('#contextual-workspace-back').click(); await page.waitForURL('**/p/alpha/'); await page.setViewportSize({ width: 1280, height: 800 });
    await page.locator(target.name === 'Clay' ? '.icon-strip-brand' : '.icon-strip-project-mate[data-mate-id="' + target.id + '"]').click();
    await page.request.get(origin + '/fixture/response-phase?slug=' + target.slug + '&session=' + target.sessionId + '&phase=thinking');
    await surfaceFrame.locator('.thinking-item:not(.mate-pre-thinking) .dm-bubble-avatar').last().waitFor();
    assert.equal(await surfaceFrame.locator('.thinking-item:not(.mate-pre-thinking) .dm-bubble-avatar').last().getAttribute('src'), expected.avatarUrl);
    await page.request.get(origin + '/fixture/response-phase?slug=' + target.slug + '&session=' + target.sessionId + '&phase=stream');
    await pane.waitForFunction(function (marker) { var rows = document.querySelectorAll('#messages .msg-assistant .md-content'); return rows.length && rows[rows.length - 1].textContent.trim().endsWith(marker); }, 'IDENTITY_STREAM_' + target.sessionId);
    assert.equal(await surfaceFrame.locator('.msg-assistant .dm-bubble-avatar').last().getAttribute('src'), expected.avatarUrl);
    assert.equal((await pane.evaluate(function () { return window.identitySamples; })).some(function (src) { return /vendor|claude|codex/.test(src) && !/mate-avatars/.test(src); }), false, 'No initial or intermediate provider avatar');
    await surfaceFrame.locator('#send-btn.stop').click(); await page.request.get(origin + '/fixture/release-model');
    if (await page.locator('#contextual-clay').isVisible()) await page.locator('[data-clay-close]').click();
  }
  await page.locator('#input').fill('CONTEXTUAL_HOLD_FOR_QUEUE project vendor'); await page.locator('#send-btn').click();
  await page.locator('.activity-inline-avatar').waitFor();
  assert.match(await page.locator('.activity-inline-avatar').getAttribute('src'), /claude|vendor/);
  assert.equal(await page.locator('.activity-inline').getAttribute('data-session-mate-id'), null);
  await page.locator('#send-btn.stop').click(); await page.request.get(origin + '/fixture/release-model');
});
