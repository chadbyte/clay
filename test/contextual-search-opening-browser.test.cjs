var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');
test('delayed Ask keeps one body placeholder below capabilities with truthful Stop and recovery', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); }); var output = '';
  child.stdout.on('data', function (value) { output += value; }); child.stderr.on('data', function (value) { output += value; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: 'reduce' }); page.setDefaultTimeout(10000);
  var origin = 'http://127.0.0.1:' + info.port, releaseDocument, releaseOwner, documentHeld, ownerHeld;
  var documentGate = new Promise(function (resolve) { releaseDocument = resolve; }), ownerGate = new Promise(function (resolve) { releaseOwner = resolve; });
  var documentWaiting = new Promise(function (resolve) { documentHeld = resolve; }), ownerWaiting = new Promise(function (resolve) { ownerHeld = resolve; });
  t.after(releaseDocument); t.after(releaseOwner);
  await page.route('**/*', async function (route) {
    var request = route.request(), url = new URL(request.url());
    if (request.isNavigationRequest() && request.frame() !== page.mainFrame() && url.searchParams.get('contextual') === '1') { documentHeld(); await documentGate; }
    if (url.pathname === '/api/me' && request.frame() !== page.mainFrame()) { ownerHeld(); await ownerGate; }
    await route.continue();
  });
  await page.goto(origin + '/fixture/login?to=alpha', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  assert.equal(await page.locator('#connect-overlay').evaluate(function (element) { return getComputedStyle(element).display; }), 'flex', 'Native app connection presentation is unchanged');
  await page.evaluate(async function () {
    window.openingStore = (await import('/p/alpha/modules/store.js')).store;
    window.openingSocket = (await import('/p/alpha/modules/ws-ref.js')).getWs(); var ws = window.openingSocket, send = ws.send.bind(ws);
    window.openingReleaseCreation = send;
    ws.send = function (data) { if (JSON.parse(data).type === 'home_clay_ask') window.openingHeldCreation = data; else send(data); };
  });
  async function ask(text) {
    await page.getByRole('button', { name: 'Search or ask Clay', exact: true }).click(); await page.locator('.cmd-palette-input').fill(text); await page.locator('.is-ask-clay').click();
    await page.locator('.cmd-palette:not(.project-switcher)').waitFor({ state: 'hidden' });
  }
  var surface = page.locator('#contextual-clay'), status = surface.locator('[data-contextual-ask-status]');
  async function layout(label) {
    await status.waitFor();
    var capability = await surface.locator('.contextual-capabilities').boundingBox(), body = await surface.locator('.contextual-clay-body').boundingBox(), pending = await status.boundingBox();
    assert.ok(capability.y + capability.height <= body.y + 1); assert.ok(pending.y >= body.y);
    assert.equal(await surface.locator('header + [data-contextual-ask-status]').count(), 0);
    assert.equal(await surface.locator('[data-clay-loading]').isVisible(), false);
    assert.equal(await surface.locator('[role="status"]:visible').count(), 1);
    assert.match(await status.locator('[data-ask-question]').textContent(), /Keep this question/);
    assert.equal(await status.locator('[data-ask-stop]').isVisible(), true);
    await page.screenshot({ path: '/tmp/contextual-opening-' + label + '.png', animations: 'disabled' });
    return { top: body.y, height: body.height };
  }
  await ask('Keep this question while Clay starts.');
  assert.equal(await page.evaluate(function () { return window.openingStore.get('contextualSearchAsk').status; }), 'creating');
  var original = await layout('creating-desktop-light');
  var help = page.getByLabel('What this Mate can see', { exact: true }); await help.click();
  assert.equal(await surface.locator('.contextual-clay-context p').evaluate(function (element) { var box = element.getBoundingClientRect(); return element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)); }), true, 'Help remains above the pending body');
  await help.press('Escape'); assert.equal(await surface.isVisible(), true);
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-dark'); }); await layout('creating-desktop-dark');
  await page.setViewportSize({ width: 390, height: 844 }); await layout('creating-narrow-dark');
  await page.evaluate(async function () { (await import('/p/alpha/modules/theme.js')).applyTheme('clay-light'); }); await layout('creating-narrow-light');
  await page.setViewportSize({ width: 1280, height: 800 });
  await status.locator('[data-ask-stop]').press('Enter'); assert.equal(await status.locator('[data-ask-retry]').evaluate(function (button) { return button === document.activeElement; }), true); assert.match(await status.textContent(), /Stopped before submission/);
  await page.evaluate(function () { window.openingReleaseCreation(window.openingHeldCreation); window.openingSocket.send = window.openingReleaseCreation; });
  async function sessions() { return (await page.request.get(origin + '/fixture/contextual-asks')).json(); }
  await page.waitForFunction(async function (origin) { return (await (await fetch(origin + '/fixture/contextual-asks')).json()).length === 1; }, origin);
  assert.equal((await sessions())[0].messages.filter(function (item) { return item.type === 'user_message'; }).length, 0);
  await status.locator('[data-ask-retry]').click(); await documentWaiting;
  assert.equal(await page.evaluate(function () { return window.openingStore.get('contextualSearchAsk').status; }), 'opening');
  assert.deepEqual(await layout('opening-document'), original, 'Creation and document loading keep the body geometry');
  await status.locator('[data-ask-stop]').click(); releaseDocument(); await ownerWaiting;
  var pane = page.frames().find(function (item) { return item.url().includes('contextual=1'); });
  await pane.evaluate(async function () { window.openingPaneStore = (await import('./modules/store.js')).store; });
  await pane.waitForFunction(function () { return window.openingPaneStore.get('contextualSessionReady'); });
  assert.equal(await pane.locator('#connect-overlay').isVisible(), false, 'Contextual initialisation never shows the native logo splash');
  assert.equal(await pane.locator('#input-wrapper').evaluate(function (element) { return element.inert; }), true, 'Account readiness keeps the composer inert');
  assert.match(await status.textContent(), /Stopped before submission/);
  await status.locator('[data-ask-retry]').click();
  await page.waitForFunction(function () { return window.openingStore.get('contextualSearchAsk').status === 'opening'; });
  await layout('opening-account');
  await status.locator('[data-ask-stop]').click(); releaseOwner();
  await pane.waitForFunction(function () { return window.openingPaneStore.get('myUserId') === 'owner' && window.openingPaneStore.get('connected'); });
  assert.equal((await sessions())[0].messages.filter(function (item) { return item.type === 'user_message'; }).length, 0);
  await pane.evaluate(async function () { var ws = (await import('./modules/ws-ref.js')).getWs(), send = ws.send.bind(ws); window.openingDelivery = []; ws.send = function (data) { if (JSON.parse(data).type === 'message') window.openingDelivery.push(data); else send(data); }; });
  await status.locator('[data-ask-retry]').click();
  await page.waitForFunction(function () { return window.openingStore.get('contextualSearchAsk').status === 'sent'; });
  assert.match(await status.textContent(), /Delivery is not confirmed/); await layout('awaiting-confirmation');
  await status.locator('[data-ask-stop]').click();
  assert.match(await status.textContent(), /Automatic delivery is paused/);
  assert.equal(await status.locator('[data-ask-retry]').isVisible(), false); assert.equal(await status.locator('[data-ask-inspect]').isVisible(), true);
  assert.equal((await sessions())[0].messages.filter(function (item) { return item.type === 'user_message'; }).length, 0);
  await status.locator('[data-ask-inspect]').click();
  await page.waitForFunction(function (slug) { return window.openingStore.get('currentSlug') === slug && window.openingStore.get('contextualWorkspace').stage === 'workspace'; }, info.sourceSlug);
  assert.equal((await sessions())[0].messages.filter(function (item) { return item.type === 'user_message'; }).length, 0, 'Inspection does not replay uncertain delivery');
  await page.locator('#contextual-workspace-back').click(); await page.waitForURL('**/p/alpha/');
  await page.context().setOffline(true); await page.evaluate(function () { window.openingSocket.close(); });
  await page.waitForFunction(function () { return !window.openingStore.get('connected'); });
  await ask('Final confirmed question after explicit retry.');
  assert.match(await status.textContent(), /Reconnect, then retry/); assert.equal(await status.locator('[data-ask-retry]').isVisible(), true);
  await page.screenshot({ path: '/tmp/contextual-opening-offline-error.png', animations: 'disabled' });
  await page.context().setOffline(false); await page.waitForFunction(function () { return window.openingStore.get('connected'); });
  assert.equal((await sessions()).length, 1, 'Reconnect does not replay stopped creation or delivery');
  await status.locator('[data-ask-retry]').click();
  await page.waitForFunction(function () { return window.openingStore.get('contextualSearchAsk').status === 'acknowledged'; });
  assert.equal(await status.isVisible(), false);
  var final = page.frameLocator('#contextual-clay iframe:visible');
  assert.equal(await final.locator('#messages').getByText('Final confirmed question after explicit retry.', { exact: true }).count(), 1);
  assert.equal((await sessions())[1].messages.filter(function (item) { return item.type === 'user_message'; }).length, 1);
  assert.equal(await final.locator('.bubble-paste').count(), 0, 'Typed automatic metadata stays separate from pastes');
  var finalId = await page.evaluate(function () { return window.openingStore.get('contextualSearchAsk').sessionId; });
  await page.request.get(origin + '/fixture/ask-stream?session=' + finalId);
  await final.locator('#messages').getByText('NEW_ASK_STREAM_IN_PANE', { exact: false }).waitFor();
  await final.locator('#send-btn.stop').click();
  assert.equal(await status.isVisible(), false, 'Stopping confirmed work keeps the actual transcript visible');
  assert.equal(await final.locator('#messages').getByText('Final confirmed question after explicit retry.', { exact: true }).count(), 1);
  await page.screenshot({ path: '/tmp/contextual-opening-confirmed.png', animations: 'disabled' });
});
