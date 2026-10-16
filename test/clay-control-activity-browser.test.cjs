var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
var child, browser, origin, page, frame, events;
test.before(async function () {
  child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  var output = ''; child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { output += data; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error(output)); }, 15000);
    child.once('message', function (data) { clearTimeout(timer); resolve(data); });
    child.once('exit', function () { clearTimeout(timer); reject(new Error(output)); });
  });
  origin = 'http://127.0.0.1:' + info.port; browser = await playwright.chromium.launch();
});
test.after(async function () { if (browser) await browser.close(); if (child) child.kill('SIGTERM'); });
test.beforeEach(async function () {
  page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(6000); events = [];
  page.on('websocket', function (ws) { ws.on('framereceived', function (event) {
    try { var data = JSON.parse(event.payload); if (data.type === 'clay_control_activity' || data.type === 'clay_navigation_apply') events.push(data); } catch (error) {}
  }); });
  await page.goto(origin + '/fixture/login?to=alpha');
  await page.locator('.icon-strip-brand:not([disabled])').waitFor(); await page.locator('.icon-strip-brand').click();
  frame = page.frameLocator('#contextual-clay iframe[data-canonical="true"]');
  await page.waitForFunction(function () { var f = document.querySelector('#contextual-clay iframe[data-canonical="true"]'); return f && f.conversation && f.conversation.identity().ready; });
  await page.request.get(origin + '/fixture/activity-reset');
  var header = page.locator('#contextual-clay > header');
  var box = await header.boundingBox();
  await page.mouse.move(box.x + 100, box.y + 15); await page.mouse.down(); await page.mouse.move(870, box.y + 15); await page.mouse.up();
});
test.afterEach(async function () { if (page) { await page.request.get(origin + '/fixture/activity-release'); await page.request.get(origin + '/fixture/activity-reset'); await page.close(); } });
async function propose(mode) {
  var pending = page.request.get(origin + '/fixture/activity?mode=' + mode);
  pending.catch(function () {});
  await frame.locator('.ask-user-container:not(.answered)').last().waitFor();
  await page.locator('#clay-control-activity').waitFor();
  return { pending: pending, review: frame.locator('.ask-user-container:not(.answered)').last() };
}
async function answer(proposal, choice, keyboard) {
  var option = proposal.review.getByRole('button', { name: choice || 'Apply exact change', exact: true });
  if (keyboard) { await option.focus(); await page.keyboard.press('Space'); }
  else await option.click();
  var submit = proposal.review.getByRole('button', { name: 'Submit', exact: true });
  if (keyboard) { await submit.focus(); await page.keyboard.press('Enter'); } else await submit.click();
}
async function phase(value) {
  await page.waitForFunction(async function (expected) { var m = await import('./modules/store.js'); var a = m.store.get('clayControlActivity'); return a && a.message.phase === expected; }, value);
}
async function geometry() {
  return page.evaluate(function () {
    var element = document.getElementById('clay-control-activity'), row = document.querySelector('.session-item[data-session-id]');
    var rect = element.getBoundingClientRect(), target = row ? row.getBoundingClientRect() : {left:0,right:0,top:0,bottom:0}, style = getComputedStyle(element);
    var identity = element.querySelector('.clay-control-identity'), name = element.querySelector('.clay-control-name');
    var bubble = element.querySelector('.clay-control-bubble').getBoundingClientRect();
    var composer = document.querySelector('#input-area').getBoundingClientRect();
    var panel = document.getElementById('contextual-clay').getBoundingClientRect();
    function box(r) { return { left: r.left, right: r.right, top: r.top, bottom: r.bottom }; }
    return { rect: box(rect), target: box(target), bubble: box(bubble), composer: box(composer), panel: box(panel),
      targeted: element.dataset.targeted, pointerEvents: style.pointerEvents, live: element.getAttribute('aria-live'),
      tipX: rect.left + parseFloat(style.getPropertyValue('--tip-x')), tipY: rect.top + parseFloat(style.getPropertyValue('--tip-y')),
      avatarBottom: element.querySelector('img').getBoundingClientRect().bottom,
      identity: box(identity.getBoundingClientRect()), name: name.textContent, grouped: identity.contains(element.querySelector('img')) && identity.contains(name),
      identityHeight: identity.getBoundingClientRect().height, nameWidth: name.clientWidth, nameOverflow: getComputedStyle(name).textOverflow,
      avatarAlt: element.querySelector('img').alt, statusCount: document.querySelectorAll('#clay-control-activity [role=status]').length,
      cursorTransform: getComputedStyle(element.querySelector('.clay-control-pointer')).transform };
  });
}
function disjoint(a, b) { return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom; }
test('real review/running/persisted events place the pointer on the exact visible session and follow layout', async function (t) {
  var p = await propose('hold'); await phase('review');
  var g = await geometry(); t.diagnostic(JSON.stringify(g));
  assert.equal(g.targeted, 'true'); assert.equal(g.pointerEvents, 'none'); assert.equal(g.live, 'polite');
  assert.ok(Math.abs(g.tipX - (g.target.right - 2)) < 1); assert.ok(Math.abs(g.tipY - (g.target.top + g.target.bottom) / 2) < 1);
  assert.equal(g.grouped, true); assert.equal(g.name, 'Clay'); assert.equal(g.identityHeight, 26);
  assert.equal(g.avatarAlt, ''); assert.equal(g.statusCount, 0); assert.ok(g.nameWidth > 20);
  assert.ok(g.bubble.top >= g.identity.bottom + 3); assert.ok(g.bubble.top >= g.avatarBottom); assert.ok(disjoint(g.rect, g.target)); assert.ok(disjoint(g.rect, g.composer)); assert.ok(disjoint(g.rect, g.panel));
  await page.locator('.session-item[data-session-id]').evaluate(function (row) { row.dataset.savedOrigin = row.dataset.controlSessionOrigin; row.dataset.controlSessionOrigin = 'replaced'; });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
  await page.locator('.session-item[data-session-id]').evaluate(function (row) { row.dataset.controlSessionOrigin = row.dataset.savedOrigin; });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'true'; });
  await page.evaluate(function () { var row = document.querySelector('.session-item[data-session-id]').getBoundingClientRect(); var cover = document.createElement('div'); cover.id = 'fixture-occlusion'; cover.style.cssText = 'position:fixed;z-index:500;left:' + row.left + 'px;top:' + row.top + 'px;width:' + row.width + 'px;height:' + row.height + 'px;background:var(--bg)'; document.body.appendChild(cover); });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
  await page.locator('#fixture-occlusion').evaluate(function (element) { element.remove(); });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'true'; });
  await page.evaluate(function () {
    var row = document.querySelector('.session-item[data-session-id]').getBoundingClientRect();
    var obstacle = document.createElement('div'); obstacle.id = 'fixture-placement'; obstacle.setAttribute('role', 'dialog');
    obstacle.style.cssText = 'position:fixed;left:' + (row.right + 4) + 'px;top:' + (row.top + row.height / 2 + 85) + 'px;width:250px;height:100px;'; document.body.appendChild(obstacle);
  });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').classList.contains('is-flipped'); });
  var flipped = await geometry(); assert.equal(flipped.targeted, 'true'); assert.match(flipped.cursorTransform, /-1/);
  assert.ok(flipped.bubble.top > flipped.identity.bottom); assert.ok(Math.abs(flipped.tipY - g.tipY) < 1); assert.ok(disjoint(flipped.rect, flipped.target));
  await page.screenshot({ path: '/tmp/clay-control-pill-flipped.png' });
  await page.locator('#fixture-placement').evaluate(function (element) { element.remove(); });
  await page.evaluate(function () {
    var row = document.querySelector('.session-item[data-session-id]'), marker = document.createElement('span'); marker.id = 'fixture-row-home';
    row.before(marker); document.body.appendChild(row); row.style.cssText = 'position:fixed;left:550px;top:350px;width:120px;z-index:150;';
  });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').classList.contains('is-reversed'); });
  var reversed = await geometry(); assert.equal(reversed.targeted, 'true'); assert.match(reversed.cursorTransform, /-1/);
  assert.ok(Math.abs(reversed.tipX - (reversed.target.left + 2)) < 1); assert.ok(Math.abs(reversed.identity.right - reversed.rect.right) < 1);
  assert.ok(reversed.bubble.top > reversed.identity.bottom); assert.ok(disjoint(reversed.rect, reversed.target));
  await page.screenshot({ path: '/tmp/clay-control-pill-reversed.png' });
  await page.evaluate(function () { var row = document.querySelector('.session-item[data-session-id]'); document.getElementById('fixture-row-home').replaceWith(row); row.removeAttribute('style'); });
  await answer(p); await phase('running');
  await page.screenshot({ path: '/tmp/clay-control-activity-desktop-light.png' });
  await page.locator('.session-item[data-session-id]').evaluate(function (row) { row.style.marginTop = '90px'; window.dispatchEvent(new Event('resize')); });
  await page.waitForTimeout(80); var moved = await geometry(); assert.ok(moved.tipY > g.tipY + 80);
  await page.locator('.session-item[data-session-id]').evaluate(function (row) { row.hidden = true; });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
  await page.locator('.session-item[data-session-id]').evaluate(function (row) { row.hidden = false; row.style.marginTop = '1600px'; window.dispatchEvent(new Event('scroll')); });
  await page.waitForTimeout(80); assert.equal((await geometry()).targeted, 'false');
  await page.locator('.session-item[data-session-id]').evaluate(function (row) { row.remove(); });
  await page.waitForTimeout(80); assert.equal((await geometry()).targeted, 'false');
  var released = await (await page.request.get(origin + '/fixture/activity-release')).json(); t.diagnostic(JSON.stringify(released));
  assert.equal(released.released, true); var result = await (await p.pending).json(); assert.equal(result.persisted, true); await phase('persisted');
});
test('real decline, persistence failure and uncertain provider response retain truthful outcomes', async function () {
  for (var mode of ['normal', 'fail', 'unknown']) {
    var p = await propose(mode); await answer(p, mode === 'normal' ? 'Keep unchanged' : null);
    var result = await (await p.pending).json();
    assert.equal(result.status, mode === 'normal' ? 'cancelled' : 'failed');
    await phase(mode === 'normal' ? 'cancelled' : mode === 'unknown' ? 'unknown' : 'failed');
  }
});
test('narrow light/dark and reduced motion retain a non-interactive status, keyboard reviews and writing', async function () {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  var p = await propose('hold'); await phase('review');
  assert.equal((await geometry()).targeted, 'false'); await answer(p, null, true); await phase('running');
  await page.screenshot({ path: '/tmp/clay-control-activity-narrow-light.png' });
  await page.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-dark'); });
  await frame.locator('body').evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-dark'); });
  await page.screenshot({ path: '/tmp/clay-control-activity-narrow-dark.png' });
  var g = await geometry(); assert.ok(g.rect.left >= 0 && g.rect.right <= 390); assert.ok(disjoint(g.rect, g.composer));
  assert.equal(await page.locator('#clay-control-activity img').evaluate(function (img) { return getComputedStyle(img).animationName; }), 'none');
  await frame.locator('#input').fill('A preserved keyboard draft');
  assert.equal(await frame.locator('#input').inputValue(), 'A preserved keyboard draft');
  await page.request.get(origin + '/fixture/activity-release'); await p.pending;
  await page.setViewportSize({ width: 1280, height: 800 }); await page.screenshot({ path: '/tmp/clay-control-activity-desktop-dark.png' });
});
test('Stop withdraws immediately and delayed replies cannot revive the activity', async function () {
  var p = await propose('hold'); await answer(p); await phase('running');
  await frame.locator('#input').fill('Keep this draft after Stop');
  await page.request.get(origin + '/fixture/stream');
  await frame.locator('#generation-stop:visible, #send-btn.stop:visible').first().click();
  await page.locator('#clay-control-activity').waitFor({ state: 'detached' });
  await page.request.get(origin + '/fixture/activity-release'); await p.pending;
  await page.waitForTimeout(350); assert.equal(await page.locator('#clay-control-activity').count(), 0);
});
test('a delayed older result cannot overwrite a newer reviewed activity', async function () {
  var first = await propose('hold'); await answer(first); await phase('running');
  var second = await propose('normal'); await phase('review'); await answer(second);
  assert.equal((await (await second.pending).json()).status, 'failed'); await phase('failed');
  var current = await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('clayControlActivity').message.id; });
  await page.request.get(origin + '/fixture/activity-release'); await first.pending;
  await page.waitForTimeout(150);
  assert.equal(await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('clayControlActivity').message.id; }), current);
  await phase('failed');
});
test('reviewed navigation separates service delivery and actual rendered conversation evidence', async function (t) {
  var pending = page.request.get(origin + '/fixture/propose?viewer=alpha&target=alpha'); pending.catch(function () {});
  var review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor();
  await phase('review'); await answer({ review: review }); var result = await (await pending).json();
  assert.equal(result.delivered, true); assert.equal(result.visible, 'unknown');
  await page.waitForTimeout(500); t.diagnostic(JSON.stringify(events.map(function (item) { return { domain: item.domain, phase: item.phase }; })));
  assert.ok(events.some(function (item) { return item.domain === 'screen' && item.phase === 'running'; }));
  assert.equal(events.some(function (item) { return item.domain === 'screen' && ['persisted', 'completed'].includes(item.phase); }), false);
  var observed = await (await page.request.get(origin + '/fixture/activity-navigation?deliveryId=' + result.deliveryId)).json();
  assert.equal(observed.visible, true); assert.equal(observed.renderStatus, 'rendered');
  assert.ok(events.some(function (item) { return item.domain === 'screen' && item.phase === 'rendered'; }));
});

test('delayed source packets cannot cross a same-ID source replacement, document reload or live Mate replacement', async function () {
  var p = await propose('normal'); await phase('review');
  var old = events.find(function (item) { return item.phase === 'review'; });
  await answer(p, 'Keep unchanged'); await p.pending;
  var originalLocalId = old.sourceSessionId;
  async function reopen() {
    await page.reload(); await page.locator('.icon-strip-brand:not([disabled])').waitFor(); await page.locator('.icon-strip-brand').click();
    frame = page.frameLocator('#contextual-clay iframe[data-canonical="true"]');
    await page.waitForFunction(function () { var f = document.querySelector('#contextual-clay iframe[data-canonical="true"]'); return f && f.conversation && f.conversation.identity().ready; });
  }
  async function replay(message) {
    await frame.locator('body').evaluate(function (body, packet) { window.parent.postMessage({ type: 'clay-control-presentation', message: packet }, location.origin); }, message);
    await page.waitForTimeout(100);
  }
  try {
    var priorViewer = old.recipientViewerRef;
    await page.locator('#contextual-clay iframe[data-canonical="true"]').evaluate(function (element) { element.contentWindow.location.reload(); });
    await page.waitForFunction(function (viewer) { var f = document.querySelector('#contextual-clay iframe[data-canonical="true"]'); return f && f.conversation && f.conversation.document === f.contentDocument && f.conversation.identity().ready && f.conversation.identity().viewerRef !== viewer; }, priorViewer);
    await replay(Object.assign({}, old, { order: Number.MAX_SAFE_INTEGER, sequence: Number.MAX_SAFE_INTEGER }));
    await phase('cancelled');
    var afterReload = await propose('normal'); await phase('review'); await answer(afterReload, 'Keep unchanged'); await afterReload.pending;
    var replaced = await (await page.request.get(origin + '/fixture/activity-source-replace')).json();
    assert.equal(replaced.localId, originalLocalId); assert.notEqual(replaced.origin, old.sourceSessionOriginId);
    await reopen(); await replay(old);
    assert.equal(await page.locator('#clay-control-activity').count(), 0, 'An unseen delayed packet from the old durable source cannot render');
    var fresh = await propose('normal'); await phase('review');
    var id = await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('clayControlActivity').message.id; });
    await replay(Object.assign({}, old, { order: Number.MAX_SAFE_INTEGER, sequence: Number.MAX_SAFE_INTEGER }));
    assert.equal(await page.evaluate(async function () { return (await import('./modules/store.js')).store.get('clayControlActivity').message.id; }), id, 'Identity rejection happens before receipt order changes');
    await answer(fresh, 'Keep unchanged'); await fresh.pending; await phase('cancelled');
    var beforeMate = events.filter(function (item) { return item.id === id; }).at(-1);
    await page.request.get(origin + '/fixture/activity-mate-replace'); await reopen(); await replay(beforeMate);
    assert.equal(await page.locator('#clay-control-activity').count(), 0);
    var next = await propose('normal'); await phase('review'); await answer(next, 'Keep unchanged'); await next.pending; await phase('cancelled');
    var live = events.filter(function (item) { return item.phase === 'review'; }).at(-1);
    assert.notEqual(live.sourceMateStamp, beforeMate.sourceMateStamp);
    // Preserve the live connection and origin to isolate the registry stamp guard.
    await replay(Object.assign({}, live, { sourceMateStamp: beforeMate.sourceMateStamp, order: Number.MAX_SAFE_INTEGER, sequence: Number.MAX_SAFE_INTEGER }));
    await phase('cancelled');
  } finally { await page.request.get(origin + '/fixture/activity-source-restore'); }
});

test('ordinary restricted navigation retains its real long Mate identity across compact themes and image failure', async function () {
  await page.locator('.icon-strip-project-mate').nth(1).click();
  var ordinary = page.frameLocator('#contextual-clay iframe[data-canonical="false"]').last();
  await ordinary.locator('#input-wrapper:not([inert])').waitFor();
  await page.waitForFunction(function () { var f = Array.from(document.querySelectorAll('#contextual-clay iframe[data-canonical="false"]')).find(function (item) { return !item.hidden; }); return f && f.conversation && f.conversation.identity().ready; });
  await page.locator('[data-clay-context]').filter({ hasText: 'Alpha integration · Next message' }).waitFor();
  await ordinary.locator('#input').fill('Review this selected conversation.'); await ordinary.locator('#send-btn').click();
  await ordinary.locator('#messages').getByText('Review this selected conversation.', { exact: true }).waitFor();
  await page.locator('[data-clay-context]').filter({ hasText: 'Alpha integration · Shared' }).waitFor();
  async function call(name, args) { return (await page.request.get(origin + '/fixture/context-tool?index=1&name=' + name + '&args=' + encodeURIComponent(JSON.stringify(args || {})))).json(); }
  var context = await call('read_current_context'); assert.equal(context.status, 'shared_snapshot');
  var nav = call('open_context_conversation', { contextRef: context.contextRef, requestId: 'pill-long-name', why: 'Open the reviewed conversation' });
  var review = ordinary.locator('.ask-user-container:not(.answered)').last(); await review.waitFor();
  await review.getByRole('button', { name: 'Apply exact change', exact: true }).click(); await review.getByRole('button', { name: 'Submit', exact: true }).click();
  assert.equal((await nav).delivered, true);
  await page.locator('#clay-control-activity .clay-control-identity').waitFor();
  var actor = await page.locator('#clay-control-activity .clay-control-name').textContent();
  assert.match(actor, /Release planning/);
  var avatar = await page.locator('#clay-control-activity img').getAttribute('src');
  assert.doesNotMatch(avatar, /lead-clay/);
  for (var variant of [{ width: 1280, theme: 'light' }, { width: 1280, theme: 'dark' }, { width: 390, theme: 'light' }, { width: 390, theme: 'dark' }]) {
    await page.setViewportSize({ width: variant.width, height: variant.width === 390 ? 844 : 800 });
    await page.evaluate(async function (theme) { (await import('./modules/theme.js')).applyTheme('clay-' + theme); }, variant.theme);
    await page.waitForTimeout(50);
    var g = await geometry(); assert.equal(g.name, actor); assert.equal(g.grouped, true); assert.equal(g.nameOverflow, 'ellipsis');
    assert.ok(g.nameWidth > 100); assert.ok(g.identity.right <= g.rect.right); assert.ok(g.bubble.top >= g.identity.bottom + 3);
    assert.ok(g.rect.left >= 0 && g.rect.right <= variant.width); assert.ok(disjoint(g.rect, g.composer));
    await page.screenshot({ path: '/tmp/clay-control-pill-ordinary-' + variant.width + '-' + variant.theme + '.png' });
  }
  await page.route('**/fixture/missing-avatar.png', function (route) { return route.abort(); });
  await page.locator('#clay-control-activity img').evaluate(function (image) { image.src = '/fixture/missing-avatar.png'; });
  await page.locator('#clay-control-activity img').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#clay-control-activity img').isVisible(), false);
  assert.equal(await page.locator('#clay-control-activity .clay-control-name').textContent(), actor);
  assert.equal(await page.locator('#clay-control-activity .clay-control-bubble').isVisible(), true);
});

async function objectProposal(kind) {
  var pending = page.request.get(origin + '/fixture/activity-object?kind=' + kind); pending.catch(function () {});
  var review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor(); await phase('review');
  return { pending: pending, review: review };
}
async function uncoverWorkbench() {
  await page.setViewportSize({ width: 1600, height: 900 });
  var handle = await page.locator('#contextual-clay > [data-clay-resize="s"]').boundingBox();
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2); await page.mouse.down(); await page.mouse.move(handle.x + handle.width / 2, handle.y - 280, { steps: 8 }); await page.mouse.up();
  var header = page.locator('#contextual-clay > header'), box = await header.boundingBox();
  await page.mouse.move(box.x + 45, box.y + 16); await page.mouse.down(); await page.mouse.move(160, 500, { steps: 8 }); await page.mouse.up();
  assert.ok((await header.boundingBox()).y > 400);
}
async function targetGeometry(kind) {
  for (var attempt = 0; attempt < 120; attempt++) {
  var value = await page.evaluate(async function (expected) {
    var state = (await import('./modules/store.js')).store;
    var targets = await import('./modules/clay-control-targets.js');
    var activity = state.get('clayControlActivity'), el = document.getElementById('clay-control-activity');
    if (!activity || !activity.message.target || activity.message.target.kind !== expected || !el || el.dataset.targeted !== 'true') return false;
    var target = targets.controlTarget(activity.message.target); if (!target || el.getAnimations().some(function (a) { return a.playState === 'running'; })) return false;
    var rect = target.getBoundingClientRect(), box = el.getBoundingClientRect(), style = getComputedStyle(el), reversed = el.classList.contains('is-reversed');
    var x = box.left + parseFloat(style.getPropertyValue('--tip-x')), y = box.top + parseFloat(style.getPropertyValue('--tip-y'));
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (Math.abs(x - (reversed ? rect.left + 2 : rect.right - 2)) >= 1 || Math.abs(y - (rect.top + rect.height / 2)) >= 1) return false;
    return { kind: activity.message.target.kind, x: x, y: y, left: rect.left, right: rect.right, middle: rect.top + rect.height / 2, reversed: reversed };
  }, kind);
  if (value) return value;
  await page.waitForTimeout(50);
  }
  await page.screenshot({ path: '/tmp/clay-object-failure.png' });

  throw new Error('The exact ' + kind + ' target did not acquire a visible pointer');
}
function exactTip(g) { assert.ok(Math.abs(g.x - (g.reversed ? g.left + 2 : g.right - 2)) < 1); assert.ok(Math.abs(g.y - g.middle) < 1); }

test('visible Mate and owned project rail adapters use real profile and assignment proposals', async function () {
  var p = await objectProposal('mate'); exactTip(await targetGeometry('mate'));
  await page.screenshot({ path: '/tmp/clay-control-adapter-mate.png' });
  await answer(p, 'Keep unchanged'); assert.equal((await (await p.pending).json()).status, 'cancelled');
  var result = await (await page.request.get(origin + '/fixture/activity-object?kind=assignment')).json(); assert.equal(result.status, 'proposed');
  exactTip(await targetGeometry('project'));
  await page.screenshot({ path: '/tmp/clay-control-adapter-project-assignment.png' });
  var card = frame.locator('[data-assignment-id]').last();
  await card.getByRole('button', { name: /Cancel|Decline|Keep/i }).click();
  await phase('cancelled');
});

test('file, Issue and Log adapters require the actual visible object revision', async function () {
  var seeded = await (await page.request.get(origin + '/fixture/activity-object?kind=seed')).json(); assert.ok(seeded.issue.ref, JSON.stringify(seeded));
  await uncoverWorkbench();
  for (var kind of ['file', 'issue', 'log']) {
    await page.evaluate(async function (item) {
      if (item === 'file') (await import('./modules/filebrowser.js')).openFile('activity-target.txt');
      if (item === 'issue') (await import('./modules/issues.js')).openIssues();
      if (item === 'log') (await import('./modules/project-logs.js')).openProjectLogs();
    }, kind);
    var visible = kind === 'file' ? '#file-viewer-path .current' : kind === 'issue' ? '.issue-row' : '.project-log-row';
    await page.locator(visible).first().waitFor();
    var p = await objectProposal(kind); exactTip(await targetGeometry(kind === 'file' ? 'file' : 'record'));
    await page.screenshot({ path: '/tmp/clay-control-adapter-' + kind + '.png' });
    if (kind === 'file') {
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
      await page.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-dark'); });
      await page.setViewportSize({ width: 390, height: 844 });
      await page.waitForFunction(function () { var e = document.getElementById('clay-control-activity'); return e && e.dataset.targeted === 'false' && e.classList.contains('is-inline'); });
      var visibleStatus = await page.locator('#clay-control-activity').evaluate(function (element) { var r = element.getBoundingClientRect(); var hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return hit && element.parentElement.contains(hit) && element.parentElement.id === 'file-viewer'; }); assert.equal(visibleStatus, true);
      var narrow = await geometry(); assert.equal(narrow.name, 'Clay'); assert.equal(narrow.grouped, true); assert.ok(narrow.rect.right <= 390); assert.ok(disjoint(narrow.rect, narrow.composer));
      await page.screenshot({ path: '/tmp/clay-control-adapter-file-narrow-dark-reduced.png' });
      await page.setViewportSize({ width: 1600, height: 900 });
      await page.emulateMedia({ reducedMotion: 'no-preference', colorScheme: 'light' });
      await page.evaluate(async function () { (await import('./modules/theme.js')).applyTheme('clay-light'); });
    }
    if (kind !== 'file') {
      await page.locator(visible).first().evaluate(function (row) { row.dataset.savedRevision = row.dataset.controlRevision; row.dataset.controlRevision = 'replaced'; });
      await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
      await page.locator(visible).first().evaluate(function (row) { row.dataset.controlRevision = row.dataset.savedRevision; });
      await targetGeometry('record');
    }
    await answer(p, 'Keep unchanged'); assert.equal((await (await p.pending).json()).status, 'cancelled');
  }
});

test('navigation receipt cannot confirm an invisible transcript or a different durable origin', async function () {
  await page.locator('#messages').evaluate(function (element) { element.style.visibility = 'hidden'; });
  var pending = page.request.get(origin + '/fixture/propose?viewer=alpha&target=alpha');
  var review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor(); await answer({ review: review });
  var delivery = await (await pending).json(); assert.equal(delivery.delivered, true);
  await page.waitForTimeout(5200);
  var receipt = await (await page.request.get(origin + '/fixture/activity-navigation?deliveryId=' + delivery.deliveryId)).json();
  assert.equal(receipt.visible, 'unknown'); assert.equal(receipt.renderStatus, 'unknown');
  assert.equal(events.some(function (event) { return event.phase === 'rendered'; }), false);
  await page.locator('#messages').evaluate(function (element) { element.style.visibility = ''; element.dataset.controlSessionOrigin = 'old-rendered-origin'; });
  pending = page.request.get(origin + '/fixture/propose?viewer=alpha&target=alpha');
  review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor(); await answer({ review: review });
  delivery = await (await pending).json(); await page.waitForTimeout(5200);
  receipt = await (await page.request.get(origin + '/fixture/activity-navigation?deliveryId=' + delivery.deliveryId)).json();
  assert.equal(receipt.visible, 'unknown'); assert.equal(receipt.renderStatus, 'unknown');
  assert.equal(events.some(function (event) { return event.phase === 'rendered'; }), false);
});

test('project schedule row adapter follows the final human creation and exact task revision', async function () {
  await uncoverWorkbench();
  var p = await objectProposal('schedule'); await answer(p);
  assert.equal((await (await p.pending).json()).status, 'proposed');
  await page.getByRole('button', { name: 'Create task', exact: true }).click();
  await page.locator('.scheduled-task-row[data-task-id]').first().waitFor().catch(async function (error) { console.log(await page.locator('#scheduled-tasks-panel').textContent()); throw error; });
  if (!(await page.locator('#contextual-clay').isVisible())) await page.locator('.icon-strip-brand').click();
  await uncoverWorkbench();
  p = await objectProposal('schedule'); exactTip(await targetGeometry('schedule'));
  await page.screenshot({ path: '/tmp/clay-control-adapter-schedule.png' });
  await page.locator('.scheduled-task-row').first().evaluate(function (row) { row.dataset.controlRevision = 'replacement-task-revision'; });
  await page.waitForFunction(function () { return document.getElementById('clay-control-activity').dataset.targeted === 'false'; });
  await answer(p, 'Keep unchanged'); assert.equal((await (await p.pending).json()).status, 'cancelled');
});

test('Git path and shell terminal adapters use authorised repository and terminal identities', async function () {
  await page.setViewportSize({ width: 1600, height: 900 });
  var p = await objectProposal('terminal_create'); await answer(p);
  var created = await (await p.pending).json(); assert.equal(created.runtimeEffect, 'shell_created');
  await page.evaluate(async function () { (await import('./modules/terminal.js')).openTerminal(); });
  await page.locator('.terminal-tab').first().waitFor().catch(async function (error) { await page.screenshot({path:'/tmp/clay-terminal-failure.png'}); console.log(await page.locator('#terminal-container').evaluate(function(e){return e.outerHTML.slice(0,1500);})); throw error; });
  var terminalHeader = await page.locator('#contextual-clay > header').boundingBox();
  await page.mouse.move(terminalHeader.x + 45, terminalHeader.y + 16); await page.mouse.down(); await page.mouse.move(160, 48, { steps: 8 }); await page.mouse.up();
  p = await objectProposal('terminal'); exactTip(await targetGeometry('terminal'));
  await page.screenshot({ path: '/tmp/clay-control-adapter-terminal.png' }); await answer(p, 'Keep unchanged'); await p.pending;
  await page.evaluate(async function () { (await import('./modules/terminal.js')).closeTerminal(); });
  await (await page.request.get(origin + '/fixture/activity-object?kind=git_seed')).json();
  await page.evaluate(async function () { await (await import('./modules/git-panel.js')).refreshGitSummary(); });
  await page.getByRole('button', { name: 'Close Clay conversation', exact: true }).click();
  await page.locator('#git-placard-more').click();
  await page.locator('.git-file-row').first().waitFor();
  await page.locator('.icon-strip-brand').click();
  await page.waitForTimeout(300);
  var box = await page.locator('#contextual-clay > header').boundingBox();
  await page.mouse.move(box.x + 100, box.y + 16); await page.mouse.down(); await page.mouse.move(1120, 100, { steps: 8 }); await page.mouse.up();
  assert.ok((await page.locator('#contextual-clay').boundingBox()).x > 500);
  await page.evaluate(async function () { await (await import('./modules/git-panel.js')).refreshGitStatus(); });
  p = await objectProposal('git'); exactTip(await targetGeometry('git'));
  await page.screenshot({ path: '/tmp/clay-control-adapter-git.png' }); await answer(p, 'Keep unchanged'); await p.pending;
});


test('render acknowledgement requires the reviewed visible entry and stops on a changed or hidden viewer', async function () {
  var pending = page.request.get(origin + '/fixture/propose?viewer=alpha&target=alpha&entry=0');
  var review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor(); await answer({ review: review });
  var delivery = await (await pending).json();
  await page.waitForFunction(function () { var e = document.getElementById('messages'); return e && e.dataset.controlHistoryRevision; });
  for (var attempt = 0; attempt < 50; attempt++) {
    var receipt = await (await page.request.get(origin + '/fixture/activity-navigation?deliveryId=' + delivery.deliveryId)).json();
    if (receipt.visible === true) break;
    await page.waitForTimeout(50);
  }
  assert.equal(receipt.visible, true); assert.equal(receipt.renderStatus, 'rendered');
  assert.ok(events.find(function (event) { return event.type === 'clay_navigation_apply' && event.target.entryIndex === 0 && event.target.historyRevision; }));
  for (var invalidation of ['hidden', 'disconnect', 'changed-route']) {
    await page.locator('#messages').evaluate(function (element) { element.style.visibility = 'hidden'; });
    pending = page.request.get(origin + '/fixture/propose?viewer=alpha&target=alpha');
    review = frame.locator('.ask-user-container:not(.answered)').last(); await review.waitFor(); await answer({ review: review });
    delivery = await (await pending).json();
    await page.waitForFunction(async function () { return !!(await import('./modules/store.js')).store.get('clayNavigationRendering'); });
    await page.evaluate(async function (change) {
      if (change === 'hidden') { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }
      if (change === 'disconnect') (await import('./modules/ws-ref.js')).getWs().close();
      if (change === 'changed-route') (await import('./modules/store.js')).store.set({ currentSlug: 'changed-view' });
    }, invalidation);
    await page.waitForTimeout(5200);
    receipt = await (await page.request.get(origin + '/fixture/activity-navigation?deliveryId=' + delivery.deliveryId)).json();
    assert.equal(receipt.visible, 'unknown', invalidation); assert.notEqual(receipt.renderStatus, 'rendered', invalidation);
    await page.goto(origin + '/fixture/login?to=alpha');
    await page.locator('.icon-strip-brand:not([disabled])').waitFor(); await page.locator('.icon-strip-brand').click();
    frame = page.frameLocator('#contextual-clay iframe[data-canonical="true"]');
    await page.waitForFunction(function () { var f = document.querySelector('#contextual-clay iframe'); return f && f.conversation && f.conversation.identity().ready; });
  }
});
