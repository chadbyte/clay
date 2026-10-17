var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');

test('Clay and Mate windows retain conversations through navigation and refresh the exact current context', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = ''; child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { output += data; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
  var origin = 'http://127.0.0.1:' + info.port, errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  await page.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.evaluate(async function () { window.lifecycleStore = (await import('./modules/store.js')).store; });
  var destination = await (await page.request.get(origin + '/fixture/state')).json();
  var targets = [{ id: info.sourceSlug.slice(5), slug: info.sourceSlug, name: 'Clay' }, info.ordinaryMates[0]];
  function surface() { return page.locator('#contextual-clay'); }
  function frame() { return page.frameLocator('#contextual-clay iframe:visible'); }
  async function ready() { await page.waitForFunction(function () { var pane = document.querySelector('#contextual-clay iframe:not([hidden])'); return pane && pane.conversation && pane.conversation.identity().ready; }); }
  async function current() { return page.evaluate(function () { var prepared = window.lifecycleStore.get('contextualPrepared'); return { requestId: prepared.requestId, ref: prepared.contextRef, status: prepared.status, snapshot: JSON.parse(document.getElementById('contextual-clay').dataset.screenReference) }; }); }
  async function select(slug, session) { await page.evaluate(async function (target) { (await import('/p/alpha/modules/project-session-navigation.js')).openProjectSession(target.slug, target.session); }, { slug: slug, session: session }); await page.waitForFunction(function (target) { return window.lifecycleStore.get('currentSlug') === target.slug && window.lifecycleStore.get('activeSessionId') === target.session && !window.lifecycleStore.get('replayingHistory') && window.lifecycleStore.get('sessionActivatedProjectSlug') === target.slug; }, { slug: slug, session: session }); }
  async function restricted(name, args) { return (await page.request.get(origin + '/fixture/context-tool?name=' + name + '&args=' + encodeURIComponent(JSON.stringify(args || {})))).json(); }
  for (var target of targets) {
    await select('alpha', destination.alphaSessionId);
    var trigger = page.locator(target.name === 'Clay' ? '.icon-strip-brand' : '.icon-strip-project-mate[data-mate-id="' + target.id + '"]');
    await trigger.click(); await ready();
    var paneWindow = page.frames().find(function (item) { return item.url().includes(target.slug); });
    await paneWindow.evaluate(function () { window.lifecycleRenderer = 'retained'; });
    if (target.name !== 'Clay') {
      await page.locator('[data-context-status]').filter({ hasText: 'Next message' }).waitFor();
      await frame().locator('#input').fill('Share this exact Alpha conversation.'); await frame().locator('#send-btn').click();
      await page.locator('[data-context-status]').filter({ hasText: 'Shared' }).waitFor();
      var shared = await restricted('read_current_context'); assert.equal(shared.status, 'shared_snapshot');
    }
    var draft = target.name + ' retained draft'; await frame().locator('#input').fill(draft);
    var first = await current();
    await page.mouse.click(1100, 650);
    assert.equal(await surface().isVisible(), true, 'Outside click keeps ' + target.name + ' open');
    await page.locator('#input').focus(); await page.keyboard.press('Escape');
    assert.equal(await surface().isVisible(), true, 'Escape in the background belongs to the background');
    await page.getByRole('link', { name: 'BI', exact: true }).click(); await page.waitForURL('**/p/beta/');
    await page.locator('#messages').getByText('BETA_RENDERED_DESTINATION', { exact: true }).waitFor();
    await page.locator('[data-context-project]').filter({ hasText: 'Beta' }).waitFor();
    assert.equal(await surface().isVisible(), true);
    assert.equal(await frame().locator('#input').inputValue(), draft);
    assert.equal(await paneWindow.evaluate(function () { return window.lifecycleRenderer; }), 'retained');
    var beta = await current(); assert.notEqual(beta.requestId, first.requestId); assert.equal(beta.snapshot.projectSlug, 'beta'); assert.equal(beta.snapshot.sessionId, destination.betaSessionId);
    if (target.name !== 'Clay') { assert.equal((await restricted('read_selected_context', { contextRef: shared.contextRef })).status, 'failed', 'Old query loses access after navigation'); }
    // Create and select through the same production session service used by the sidebar.
    await page.evaluate(async function () { (await import('/p/alpha/modules/sidebar-sessions.js')).startNewSession('claude'); });
    await page.waitForFunction(function (old) { return window.lifecycleStore.get('activeSessionId') !== old && !window.lifecycleStore.get('replayingHistory'); }, destination.betaSessionId);
    var next = await current(); assert.notEqual(next.requestId, beta.requestId); assert.notEqual(next.snapshot.sessionId, beta.snapshot.sessionId);
    assert.equal(await surface().isVisible(), true); assert.equal(await frame().locator('#input').inputValue(), draft);
    // Hold a real preparation reply, change to Home, then release the stale reply.
    await page.evaluate(async function () {
      var socket = (await import('/p/alpha/modules/ws-ref.js')).getWs(), receive = socket.onmessage;
      window.heldPreparation = null;
      socket.onmessage = function (event) { if (JSON.parse(event.data).type === 'mate_context_prepared' && !window.heldPreparation) { window.heldPreparation = event; return; } receive(event); };
      window.releasePreparation = function () { socket.onmessage = receive; receive(window.heldPreparation); };
    });
    await select('beta', destination.betaSessionId);
    await page.waitForFunction(function () { return !!window.heldPreparation; });
    await page.evaluate(async function () { (await import('/p/alpha/modules/projects-hub.js')).showProjectsHub(); });
    await page.waitForURL(origin + '/projects');
    var home = await current(); assert.equal(home.snapshot.screen, 'Home'); assert.equal(home.snapshot.projectTitle, 'Projects'); assert.equal(home.snapshot.sessionId, null); assert.equal(home.snapshot.projectSlug, null); assert.equal(home.snapshot.conversationTitle, null);
    await page.evaluate(function () { window.releasePreparation(); });
    assert.equal((await current()).requestId, home.requestId, 'Stale preparation cannot replace Home context');
    if (target.name === 'Clay') {
      var sentSnapshot = await paneWindow.evaluate(async function () { return (await import('./modules/contextual-clay-session.js')).contextualScreenReference(); });
      assert.equal(sentSnapshot.screen, 'Home');
      assert.equal(sentSnapshot.projectTitle, 'Projects');
    }
    assert.equal(!!(await current()).ref, false);
    assert.notEqual(await page.evaluate(function () { return JSON.parse(window.heldPreparation.data).requestId; }), home.requestId);
    assert.equal(await surface().isVisible(), true); assert.equal(await frame().locator('#input').inputValue(), draft);
    await select('alpha', destination.alphaSessionId);
    await page.locator('[data-context-project]').filter({ hasText: 'Alpha' }).waitFor();
    for (var width of [1280, 390]) {
      await page.setViewportSize({ width: width, height: 844 });
      var label = page.getByRole('button', { name: 'New chat', exact: true });
      assert.equal((await label.innerText()).trim(), 'New chat'); assert.equal(await label.locator('span').isVisible(), true);
      var labelBox = await label.boundingBox(), shellBox = await surface().boundingBox();
      assert.ok(labelBox.x >= shellBox.x && labelBox.x + labelBox.width <= shellBox.x + shellBox.width);
      assert.equal(await surface().evaluate(function (el) { return el.scrollWidth <= el.clientWidth; }), true);
      await page.screenshot({ path: '/tmp/contextual-window-' + target.name + '-' + width + '.png', animations: 'disabled' });
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await frame().locator('#input').press('Escape'); assert.equal(await surface().isVisible(), false);
    await trigger.click(); await ready(); assert.equal(await frame().locator('#input').inputValue(), draft);
    await page.locator('[data-clay-close]').click(); assert.equal(await surface().isVisible(), false);
    await trigger.click(); await ready(); await trigger.click(); await page.waitForURL('**/p/' + target.slug + '/');
    await page.waitForFunction(function () { return document.body.classList.contains('contextual-clay-native') && !document.getElementById('input-wrapper').inert; });
    assert.equal(await surface().isVisible(), false); assert.equal(await page.locator('#input').inputValue(), draft);
    await page.locator('#contextual-workspace-back').click(); await page.waitForURL('**/p/alpha/');
    await page.waitForFunction(function () { return !window.lifecycleStore.get('contextualWorkspace'); });
    await trigger.click(); await ready();
    await page.evaluate(function (id) { window.lifecycleMates = window.lifecycleStore.get('cachedMatesList'); window.lifecycleStore.set({ cachedMatesList: window.lifecycleMates.filter(function (mate) { return mate.id !== id; }) }); }, target.id);
    assert.equal(await surface().isVisible(), false); assert.equal(await page.locator('#contextual-clay iframe[data-mate-id="' + target.id + '"]').count(), 0, 'Deleted identity tears down the renderer');
    await page.evaluate(function () { window.lifecycleStore.set({ cachedMatesList: window.lifecycleMates }); });
  }
  // The canonical brand returns from its own native route; ordinary Mate icons can lend a direct native composer.
  for (var nativeTarget of targets.filter(function (item) { return item.name !== 'Clay'; })) {
    var direct = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); direct.setDefaultTimeout(10000);
    await direct.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
    await direct.goto(origin + '/p/' + nativeTarget.slug + '/', { waitUntil: 'domcontentloaded' });
    await direct.evaluate(async function () { window.directLifecycleStore = (await import('./modules/store.js')).store; });
    await direct.waitForFunction(function () { return window.directLifecycleStore.get('activeSessionId') && !window.directLifecycleStore.get('replayingHistory'); });
    var nativeDraft = 'Direct native draft for ' + nativeTarget.name;
    await direct.locator('#input').fill(nativeDraft);
    var nativeTrigger = direct.locator(nativeTarget.name === 'Clay' ? '.icon-strip-brand' : '.icon-strip-project-mate[data-mate-id="' + nativeTarget.id + '"]');
    await nativeTrigger.click();
    var directPane = direct.frameLocator('#contextual-clay iframe:visible');
    await directPane.locator('#input-wrapper:not([inert])').waitFor();
    await direct.waitForFunction(function (draft) { var pane = document.querySelector('#contextual-clay iframe:not([hidden])'); return pane && pane.contentDocument.getElementById('input').value === draft; }, nativeDraft);
    await direct.getByRole('link', { name: 'BI', exact: true }).click(); await direct.waitForURL('**/p/beta/');
    await direct.locator('#messages').getByText('BETA_RENDERED_DESTINATION', { exact: true }).waitFor();
    assert.equal(await direct.locator('#contextual-clay').isVisible(), true);
    assert.equal(await directPane.locator('#input').inputValue(), nativeDraft, 'The pane retains its draft after leaving its direct native origin');
    assert.equal(await directPane.locator('#input').getAttribute('readonly'), null);
    assert.notEqual(await direct.locator('#input').inputValue(), nativeDraft, 'The destination composer never receives another Mate draft');
    assert.equal(await direct.evaluate(function () { return window.directLifecycleStore.get('contextualNativeOrigin'); }), null);
    await direct.locator('[data-clay-expand]').click(); await direct.waitForURL('**/p/' + nativeTarget.slug + '/');
    await direct.waitForFunction(function () { return document.body.classList.contains('contextual-clay-native') && !document.getElementById('input-wrapper').inert; });
    assert.equal(await direct.locator('#input').inputValue(), nativeDraft);
    var other = targets.find(function (item) { return item.id !== nativeTarget.id; });
    await direct.locator(other.name === 'Clay' ? '.icon-strip-brand' : '.icon-strip-project-mate[data-mate-id="' + other.id + '"]').click();
    await directPane.locator('#input-wrapper:not([inert])').waitFor();
    await directPane.locator('#input').fill('Other floating writer');
    await direct.getByRole('link', { name: 'BI', exact: true }).click(); await direct.waitForURL('**/p/beta/');
    await direct.locator('#messages').getByText('BETA_RENDERED_DESTINATION', { exact: true }).waitFor();
    assert.equal(await direct.locator('#contextual-clay').isVisible(), true, 'Leaving a full-screen Mate preserves another open floating conversation');
    assert.equal(await directPane.locator('#input').inputValue(), 'Other floating writer');
    await direct.evaluate(function () { window.directLifecycleStore.set({ myUserId: 'foreign' }); });
    assert.equal(await direct.locator('#contextual-clay').isVisible(), false);
    assert.equal(await direct.locator('#contextual-clay iframe').count(), 0, 'Owner change tears down every private pane');
    await direct.close();
  }
  assert.deepEqual(errors, []);
});
