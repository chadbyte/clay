var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
var child, browser, origin, sourceSlug, ordinaryMates, page, frame, events, requests;
test.before(async function () {
  child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  var output = ''; child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { output += data; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  sourceSlug = info.sourceSlug; ordinaryMates = info.ordinaryMates; origin = 'http://127.0.0.1:' + info.port; browser = await playwright.chromium.launch();
});
test.after(async function () { if (browser) await browser.close(); if (child) child.kill('SIGTERM'); });
async function openClay() {
  await page.locator('.icon-strip-brand:not([disabled])').waitFor(); await page.locator('.icon-strip-brand').click(); frame = page.frameLocator('#contextual-clay iframe[data-canonical="true"]');
  await page.waitForFunction(function () { var f = document.querySelector('#contextual-clay iframe[data-canonical="true"]'); return f && f.conversation && f.conversation.identity().ready; });
}
test.beforeEach(async function () {
  page = await browser.newPage({ viewport: { width: 1800, height: 1000 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(8000); events = []; requests = [];
  page.on('websocket', function (ws) { ws.on('framesent', function (event) { try { requests.push({ url: ws.url(), message: JSON.parse(event.payload) }); } catch (error) {} }); ws.on('framereceived', function (event) { try { var message = JSON.parse(event.payload); if (message.type === 'clay_control_activity') events.push(message); } catch (error) {} }); });
  page.on('pageerror', function (error) { console.log('Page error:', error.stack); });
  await page.goto(origin + '/fixture/login?to=alpha'); await openClay(); await page.request.get(origin + '/fixture/activity-reset');
});
test.afterEach(async function () { if (page) { await page.request.get(origin + '/fixture/activity-reset'); await page.request.get(origin + '/fixture/activity-source-restore'); await page.close(); } });
async function request(kind) { var pending = page.request.get(origin + '/fixture/activity-object?kind=' + kind); pending.catch(function () {}); return pending; }
async function proposal(kind) { var pending = request(kind); pending.catch(function () {}); var review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor(); return { pending: pending, review: review }; }
async function answer(p, approve) { await p.review.getByRole('button', { name: approve ? 'Apply exact change' : 'Keep unchanged', exact: true }).click(); await p.review.getByRole('button', { name: 'Submit', exact: true }).click(); return (await (await p.pending).json()); }
async function until(fn, expected) { for (var i = 0; i < 140; i++) { var result = await page.evaluate(fn, expected); if (result) return result; await page.waitForTimeout(40); } var screenshot = '/tmp/clay-remaining-failure-' + process.pid + '.png'; await page.screenshot({ path: screenshot }); console.log(JSON.stringify({ screenshot: screenshot, geometry: await page.evaluate(function () { return window.clayTargetGeometry; }) })); throw new Error('Expected production presentation did not arrive: ' + expected); }
async function target(kind) {
  return until(async function (kind) {
    var store = (await import('./modules/store.js')).store, activity = store.get('clayControlActivity');
    if (!activity || !activity.message.target || activity.message.target.kind !== kind) return false;
    var node = (await import('./modules/clay-control-targets.js')).controlTarget(activity.message.target), status = document.getElementById('clay-control-activity');
    if (!node || !status) return false;
    var rect = node.getBoundingClientRect(), box = status.getBoundingClientRect(), style = getComputedStyle(status);
    if (status.dataset.targeted === 'true') {
      var x = box.left + parseFloat(style.getPropertyValue('--tip-x')), y = box.top + parseFloat(style.getPropertyValue('--tip-y'));
      window.clayTargetGeometry = { actual: { x: x, y: y }, expected: { x: status.classList.contains('is-reversed') ? rect.left + 2 : rect.right - 2, y: rect.top + rect.height / 2 }, target: rect.toJSON(), status: box.toJSON(), reversed: status.classList.contains('is-reversed') };
      if (Math.abs(x - (status.classList.contains('is-reversed') ? rect.left + 2 : rect.right - 2)) >= 1 || Math.abs(y - (rect.top + rect.height / 2)) >= 1) return false;
    }
    return { target: activity.message.target, visible: true, targeted: status.dataset.targeted, rect: rect.toJSON() };
  }, kind);
}
async function phase(value) { return until(async function (value) { var activity = (await import('./modules/store.js')).store.get('clayControlActivity'); return activity && activity.message.phase === value; }, value); }

for (var repeat of [1, 2, 3]) {
  (function (attempt) {
    test('notification tip follows real CSS transition during review, repeat ' + attempt, async function () {
      await page.addStyleTag({ content: '.notif-banner { transition-duration: 2s !important; opacity: 1 !important; }' });
      var seeded = await (await request('notification_seed')).json(), banner = page.locator('.notif-banner[data-notif-id="' + seeded.id + '"]');
      await banner.waitFor({ state: 'attached' });
      await banner.evaluate(function (node) {
        node.getAnimations().forEach(function (animation) { animation.finish(); });
        node.style.setProperty('transition', 'none', 'important'); node.classList.remove('show'); getComputedStyle(node).transform;
        node.style.removeProperty('transition'); getComputedStyle(node).transform; node.classList.add('show');
        window.notificationMotion = node.getAnimations().find(function (animation) { return animation.transitionProperty === 'transform'; });
      });
      await page.waitForFunction(function () { var motion = window.notificationMotion; return motion && motion.playState === 'running' && motion.currentTime >= 900 && motion.currentTime < 1500; });
      var p = await proposal('notification'), samples = [];
      for (var sample = 0; sample < 3; sample++) {
        assert.equal((await target('notifications')).targeted, 'true');
        samples.push(await page.evaluate(function () { return { time: window.notificationMotion.currentTime, state: window.notificationMotion.playState, geometry: window.clayTargetGeometry }; }));
        await page.waitForTimeout(60);
      }
      assert.equal(samples[0].state, 'running'); assert.ok(samples[0].time < 2000);
      await page.evaluate(async function () { await window.notificationMotion.finished; });
      assert.equal((await target('notifications')).targeted, 'true');
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('clayControlActivity').frame; }), null);
      console.log(JSON.stringify({ notificationTransitionRepeat: attempt, samples: samples, settled: await page.evaluate(function () { return window.clayTargetGeometry; }) }));
      assert.equal((await answer(p, true)).persisted, true); await phase('persisted');
    });
  })(repeat);
}

test('owned notification presentation binds the actual banner revision and observes dismissal', async function () {
  var seeded = await (await request('notification_seed')).json(); assert.ok(seeded.id);
  var banner = page.locator('.notif-banner[data-notif-id="' + seeded.id + '"]'); await banner.waitFor();
  var p = await proposal('notification'), geometry = await target('notifications'); assert.equal(geometry.targeted, 'true');
  await banner.evaluate(async function (node) { var motion = node.animate([{ transform: 'translateY(0)' }, { transform: 'translateY(80px)' }], { duration: 250, fill: 'forwards' }); await motion.finished; });
  geometry = await target('notifications'); assert.equal(geometry.targeted, 'true');
  await banner.evaluate(function (node) { node.style.paddingBottom = (parseFloat(getComputedStyle(node).paddingBottom) + 20) + 'px'; });
  geometry = await target('notifications'); assert.equal(geometry.targeted, 'true');
  console.log(JSON.stringify({ notificationTipAfterMotionAndResize: await page.evaluate(function () { return window.clayTargetGeometry; }) }));
  await page.screenshot({ path: '/tmp/clay-control-notification.png' });
  await banner.evaluate(function (node) { node.dataset.saved = node.dataset.controlRevision; node.dataset.controlRevision = 'replaced'; });
  await until(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
  await banner.evaluate(function (node) { node.dataset.controlRevision = node.dataset.saved; });
  assert.equal((await answer(p, true)).persisted, true); await phase('persisted');
  await page.locator('.notif-banner[data-notif-id="' + seeded.id + '"]').waitFor({ state: 'detached' });
});

test('Knowledge document, database and record adapters use live authoritative revisions', async function () {
  var seeded = await (await request('knowledge_seed')).json(); assert.ok(seeded.slug, JSON.stringify(seeded));
  await page.goto(origin + '/p/' + seeded.slug + '/'); await openClay();
  await page.evaluate(async function () { (await import('./modules/mate-knowledge-workbench.js')).openKnowledgeWorkbench(); });
  await page.locator('.knowledge-file-row').first().waitFor();
  for (var kind of ['knowledge_document', 'knowledge_database', 'knowledge_record']) {
    if (kind !== 'knowledge_document') { await page.locator('.knowledge-file-row[data-open-document="local:' + seeded.database.id + '"]').click(); await page.locator('[data-db-record]').first().waitFor(); if (!(await page.locator('#contextual-clay').isVisible())) await openClay(); }
    var p = await proposal(kind), geometry = await target('knowledge'); assert.equal(geometry.targeted, 'true', kind);
    await page.screenshot({ path: '/tmp/clay-control-' + kind + '.png' });
    if (kind === 'knowledge_record') {
      await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ reducedMotion: 'reduce' });
      await page.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-dark'); });
      await until(function () { var el = document.getElementById('clay-control-activity'); return el && el.classList.contains('is-inline') && el.dataset.targeted === 'false' && el.parentElement.id === 'mate-knowledge-workbench'; });
      await page.screenshot({ path: '/tmp/clay-control-knowledge-narrow-dark-reduced.png' });
      await page.setViewportSize({ width: 1800, height: 1000 }); await page.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-light'); });
      assert.equal((await target('knowledge')).targeted, 'true');
    }
    if (kind === 'knowledge_record') {
      await page.locator('[data-db-record]').first().evaluate(function (node) { node.dataset.saved = node.dataset.controlRevision; node.dataset.controlRevision = 'replaced'; });
      await until(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
      await page.locator('[data-db-record]').first().evaluate(function (node) { node.dataset.controlRevision = node.dataset.saved; });
    }
    assert.equal((await answer(p, false)).status, 'cancelled');
  }
});

test('private Mate schedules map their real logical revision onto the actual pending queue', async function () {
  var seeded = await (await request('knowledge_seed')).json(); await page.goto(origin + '/p/' + seeded.slug + '/'); await openClay();
  var p = await proposal('mate_schedule'); assert.equal((await answer(p, true)).persisted, true);
  await page.locator('.pending-message-chip[data-control-schedule-id]').first().waitFor();
  p = await proposal('mate_schedule'); var geometry = await target('schedule'); assert.equal(geometry.target.revision.length > 0, true);
  await page.screenshot({ path: '/tmp/clay-control-private-mate-schedule.png' });
  assert.equal((await answer(p, false)).status, 'cancelled');
});

test('real document and sketch renderers acknowledge the exact visible source and revision', async function () {
  for (var kind of ['document', 'sketch']) {
    var result = await (await request(kind)).json(); assert.equal(result.ready, true, JSON.stringify(result));
    await phase('rendered');
    var geometry = await target('surface'); assert.equal(geometry.target.surface, kind);
    assert.equal(events.some(function (event) { return event.domain === 'studio' && event.phase === 'delivered'; }), true);
    await page.screenshot({ path: '/tmp/clay-control-studio-' + kind + '.png' });
  }
});

test('hidden content cannot acknowledge or revive older Studio rendering', async function () {
  await page.addStyleTag({ content: '#file-viewer-body { visibility: hidden !important; }' });
  assert.equal((await (await request('document')).json()).ready, true); await phase('delivered');
  await page.waitForTimeout(5200); await phase('render_unknown');
  assert.equal(events.some(function (event) { return event.domain === 'studio' && event.phase === 'rendered'; }), false);
});


test('partially onscreen document content can still confirm visible rendering', async function () {
  await page.addStyleTag({ content: '#file-viewer { transform: translateX(100px) !important; }' });
  assert.equal((await (await request('document')).json()).ready, true); await phase('rendered');
  assert.equal(await page.locator('#file-viewer-body').evaluate(function (node) { var rect = node.getBoundingClientRect(); return rect.right > innerWidth && rect.left < innerWidth; }), true);
});

for (var surface of ['document', 'sketch', 'browser']) {
  (function (kind) {
    test('transparent ancestor cannot confirm actual ' + kind + ' rendering or revive after expiry', async function () {
      if (kind === 'browser') {
        await page.goto(origin + '/p/' + sourceSlug + '/');
        await page.evaluate(async function (slug) { (await import('./modules/command-palette.js')).navigateToSession({ projectSlug: slug, sessionId: 2 }); }, sourceSlug);
        await page.waitForFunction(async function () { var s = (await import('./modules/store.js')).store; return s.get('connected') && s.get('activeSessionId') === 2; });
      }
      var selector = kind === 'document' ? '#file-viewer' : kind === 'sketch' ? '#wireframe-panel' : '#shared-browser-panel';
      var hidden = await page.addStyleTag({ content: selector + ' { opacity: 0 !important; }' });
      var action = kind;
      assert.notEqual((await (await request(action)).json()).isError, true);
      await page.locator(selector).waitFor({ state: 'attached' });
      var content = kind === 'document' ? '#file-viewer-body' : kind === 'sketch' ? '#wireframe-panel .wireframe-workbench-canvas' : '#shared-browser-panel canvas';
      await page.locator(content).waitFor({ state: 'attached' });
      assert.equal(await page.locator(content).evaluate(function (node) { return Number(getComputedStyle(node).opacity) > 0; }), true);
      assert.equal(await page.locator(selector).evaluate(function (node) { return Number(getComputedStyle(node).opacity); }), 0);
      await phase('render_unknown');
      assert.equal(events.some(function (event) { return event.domain === 'studio' && event.phase === 'rendered'; }), false);
      await hidden.evaluate(function (node) { node.remove(); });
      await page.waitForTimeout(150); await phase('render_unknown');
      assert.equal(events.some(function (event) { return event.domain === 'studio' && event.phase === 'rendered'; }), false);
      assert.notEqual((await (await request(action)).json()).isError, true);
      await phase('rendered');
      if (kind === 'browser') {
        assert.equal(await page.locator('#shared-browser-panel canvas').evaluate(function (canvas) { return canvas.width > 0 && canvas.getContext('2d').getImageData(0, 0, 1, 1).data.length === 4; }), true);
        await page.screenshot({ path: '/tmp/clay-control-studio-browser.png' });
      }
    });
  })(surface);
}

test('hidden ancestor cannot confirm a document whose child overrides visibility', async function () {
  var hidden = await page.addStyleTag({ content: '#file-viewer { visibility: hidden !important; } #file-viewer-body { visibility: visible !important; }' });
  assert.equal((await (await request('document')).json()).ready, true);
  await page.locator('#file-viewer-body').waitFor({ state: 'attached' });
  assert.equal(await page.locator('#file-viewer-body').evaluate(function (node) { return getComputedStyle(node).visibility; }), 'visible');
  await phase('render_unknown');
  assert.equal(events.some(function (event) { return event.domain === 'studio' && event.phase === 'rendered'; }), false);
  await hidden.evaluate(function (node) { node.remove(); });
  await page.waitForTimeout(150); await phase('render_unknown');
  assert.equal((await (await request('document')).json()).ready, true); await phase('rendered');
});


test('delayed Studio packets cannot cross a same-ID durable source replacement and frame reload', async function () {
  var nativeFrame = page.frames().find(function (item) { return item.url().includes(sourceSlug) && item !== page.mainFrame(); });
  await nativeFrame.evaluate(async function () {
    var socket = (await import('./modules/ws-ref.js')).getWs(), receive = socket.onmessage;
    socket.onmessage = function (event) {
      var message = JSON.parse(event.data);
      if (message.type === 'markdown_edit_present' && message.controlPresentation) {
        var store = window.parent; var evidence = message.controlPresentation;
        store.heldStudio = { message: message, studioSource: { ownerId: evidence.ownerId, slug: evidence.sourceSlug, sessionId: evidence.sourceSessionId, origin: evidence.sourceSessionOriginId, runtime: evidence.runtimeId, connected: true } };
        store.heldStudioSource = window; return;
      }
      receive(event);
    };
  });
  assert.equal((await (await request('document')).json()).ready, true);
  await page.waitForFunction(function () { return !!window.heldStudio; });
  var oldPacket = await page.evaluate(function () { return window.heldStudio; });
  await page.request.get(origin + '/fixture/activity-source-replace');
  await page.reload(); await openClay();
  assert.equal((await (await request('document')).json()).ready, true); await phase('rendered');
  var before = await page.locator('#file-viewer-body').textContent();
  var current = events.filter(function (event) { return event.phase === 'rendered'; }).at(-1).id;
  await page.evaluate(function (packet) { window.dispatchEvent(new MessageEvent('message', { origin: location.origin, source: document.querySelector('#contextual-clay iframe').contentWindow, data: Object.assign({ type: 'clay-pane-present-markdown' }, packet) })); }, oldPacket);
  await page.waitForTimeout(150);
  assert.equal(await page.locator('#file-viewer-body').textContent(), before);
  assert.equal(events.filter(function (event) { return event.phase === 'rendered'; }).at(-1).id, current);
  await page.request.get(origin + '/fixture/activity-source-restore');
});

test('late sketch rendering and failed rendering cannot replace newer confirmed document activity', async function () {
  var held;
  await page.route('**/api/wireframe/render', async function (route) { var response = await route.fetch(); held = { route: route, response: response }; });
  assert.equal((await (await request('sketch')).json()).ready, true);
  for (var i = 0; i < 100 && !held; i++) await page.waitForTimeout(25);
  assert.ok(held);
  assert.equal((await (await request('document')).json()).ready, true); await phase('rendered');
  var current = events.filter(function (event) { return event.phase === 'rendered'; }).at(-1).id;
  await held.route.fulfill({ response: held.response }); await page.waitForTimeout(150);
  assert.equal(events.filter(function (event) { return event.phase === 'rendered'; }).at(-1).id, current);
  await page.unroute('**/api/wireframe/render');
  await page.route('**/api/wireframe/render', function (route) { return route.abort(); });
  assert.equal((await (await request('sketch')).json()).ready, true); await phase('render_unknown');
});

test('multi-file Git presentation validates every exact path revision before using the repository surface', async function () {
  await (await request('git_seed')).json();
  await page.getByRole('button', { name: 'Close Clay conversation', exact: true }).click();
  await page.evaluate(async function () { await (await import('./modules/git-panel.js')).refreshGitSummary(); });
  await page.locator('#git-placard-more').click(); await page.locator('.git-file-row').first().waitFor(); await openClay();
  var box = await page.locator('#contextual-clay > header').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 15); await page.mouse.down(); await page.mouse.move(1120, 100, { steps: 8 }); await page.mouse.up();
  await page.evaluate(async function () { await (await import('./modules/git-panel.js')).refreshGitStatus(); });
  var p = await proposal('git_multi'), value = await target('git-set'); assert.equal(value.target.files.length, 2);
  await page.screenshot({ path: '/tmp/clay-control-git-set.png' }); assert.equal((await answer(p, false)).status, 'cancelled');
});


test('forwarded document follow and refresh stay on the real source connection and never read the parent project', async function () {
  assert.equal((await (await request('document')).json()).ready, true); await phase('rendered');
  await (await request('document_update')).json();
  await page.locator('#file-viewer-body').getByText('SOURCE_DOCUMENT_UPDATED', { exact: true }).waitFor();
  await page.locator('#file-viewer-refresh').click();
  for (var i = 0; i < 100 && !requests.some(function (item) { return item.message.type === 'fs_read' && item.message.path === 'activity.md' && item.message.projectSlug === sourceSlug; }); i++) await page.waitForTimeout(20);
  assert.equal(requests.some(function (item) { return item.message.type === 'fs_read' && item.message.path === 'activity.md' && item.message.projectSlug === sourceSlug; }), true);
  assert.equal(requests.some(function (item) { return item.message.type === 'fs_read' && item.message.path === 'activity.md' && item.message.projectSlug === 'alpha'; }), false);
  await page.waitForTimeout(100);
  await page.locator('#file-viewer-body').getByText('SOURCE_DOCUMENT_UPDATED', { exact: true }).waitFor();
  assert.equal((await page.locator('#file-viewer-body').textContent()).includes('WRONG_PROJECT_CONTENT'), false);
  await page.locator('#file-viewer-close').click();
  await page.waitForTimeout(100);
  assert.equal(await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('studioDocumentView'); }), null);
});


test('ordinary Mate document forwarding retains its own source and cannot inject canonical activity', async function () {
  await page.locator('.icon-strip-project-mate[data-mate-id="' + ordinaryMates[0].id + '"]').click();
  await page.waitForFunction(function () { var f = document.querySelector('#contextual-clay iframe:not([hidden])[data-canonical="false"]'); return f && f.conversation && f.conversation.identity().ready; });
  var result = await (await request('ordinary_document')).json(); assert.notEqual(result.isError, true, JSON.stringify(result));
  await page.locator('#file-viewer-body').getByText('ORDINARY_SOURCE_DOCUMENT', { exact: true }).waitFor();
  assert.equal(events.some(function (event) { return event.domain === 'studio'; }), false);
  var source = await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('studioDocumentView').descriptor.sourceSlug; });
  assert.equal(source, ordinaryMates[0].slug);
});


test('a delayed parent-project read cannot overwrite a forwarded same-name source document', async function () {
  await (await request('document_parent_seed')).json();
  await page.evaluate(async function () {
    var socket = (await import('./modules/ws-ref.js')).getWs(), receive = socket.onmessage;
    socket.onmessage = function (event) { var message = JSON.parse(event.data); if (message.type === 'fs_read_result' && message.path === 'activity.md') { window.heldParentRead = event; return; } receive(event); };
    window.releaseParentRead = function () { socket.onmessage = receive; receive(window.heldParentRead); };
    (await import('./modules/filebrowser.js')).openFile('activity.md');
  });
  await page.waitForFunction(function () { return !!window.heldParentRead; });
  assert.equal((await (await request('document')).json()).ready, true); await phase('rendered');
  var before = await page.locator('#file-viewer-body').textContent(); await page.evaluate(function () { window.releaseParentRead(); });
  await page.waitForTimeout(100); assert.equal(await page.locator('#file-viewer-body').textContent(), before); assert.equal(before.includes('WRONG_PROJECT_CONTENT'), false);
});
