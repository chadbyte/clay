var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), playwright = require('playwright');

test('cold Ask waits for the pane authenticated owner before exact-identity submission', async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/contextual-clay-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_CONTEXT_ACCESS_FIXTURE: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var output = '';
  child.stdout.on('data', function (value) { output += value; }); child.stderr.on('data', function (value) { output += value; });
  var info = await new Promise(function (resolve, reject) { var timer = setTimeout(function () { reject(new Error(output)); }, 15000); child.once('message', function (value) { clearTimeout(timer); resolve(value); }); });
  var browser = await playwright.chromium.launch(); t.after(async function () { await browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(10000);
  var origin = 'http://127.0.0.1:' + info.port, releaseOwner, ownerHeld;
  var held = new Promise(function (resolve) { ownerHeld = resolve; });
  var ownerGate = new Promise(function (resolve) { releaseOwner = resolve; });
  t.after(releaseOwner);
  await page.route('**/api/me', async function (route) {
    if (route.request().frame() !== page.mainFrame()) { ownerHeld(); await ownerGate; }
    await route.continue();
  });
  await page.goto(origin + '/fixture/login?to=alpha');
  await page.waitForFunction(function () { return !document.querySelector('.icon-strip-brand').disabled; });
  await page.evaluate(async function () { window.coldStore = (await import('/p/alpha/modules/store.js')).store; });
  await page.evaluate(function () { window.coldIdentities = []; var dispatch = EventTarget.prototype.dispatchEvent; EventTarget.prototype.dispatchEvent = function (event) { if (event.type === 'contextual-clay-ready') { var frame = document.querySelector('#contextual-clay iframe:not([hidden])'); if (frame && frame.conversation && window.coldIdentities.length < 4) window.coldIdentities.push(frame.conversation.identity()); } return dispatch.call(this, event); }; });
  assert.equal(await page.locator('#contextual-clay iframe').count(), 0, 'No prior Clay pane warms the authenticated owner');
  async function ask(text) {
    await page.getByRole('button', { name: 'Search or ask Clay', exact: true }).click();
    await page.locator('.cmd-palette-input').fill(text);
    await page.locator('.is-ask-clay').evaluate(function (node) { node.click(); node.click(); });
    await page.locator('.cmd-palette:not(.project-switcher)').waitFor({ state: 'hidden' });
  }
  async function receipt() {
    await page.waitForFunction(function () { return /^(acknowledged|error)$/.test(window.coldStore.get('contextualSearchAsk').status); });
    assert.equal(await page.evaluate(function () { return window.coldStore.get('contextualSearchAsk').status; }), 'acknowledged', JSON.stringify(await page.evaluate(function () { var r = window.coldStore.get('contextualSearchAsk'); return { events: window.coldIdentities, request: r, identity: document.querySelector('#contextual-clay iframe:not([hidden])').conversation.identity() }; })));
    return page.evaluate(function () { var value = window.coldStore.get('contextualSearchAsk'); var frame = document.querySelector('#contextual-clay iframe:not([hidden])'); return { request: { ownerId: value.ownerId, mateId: value.mateId, sessionId: value.sessionId, sessionOriginId: value.sessionOriginId }, identity: frame.conversation.identity() }; });
  }
  async function sessions() { return (await page.request.get(origin + '/fixture/contextual-asks')).json(); }
  await ask('Review this project in a fresh Clay conversation.');
  await held;
  var pane = page.frames().find(function (frame) { return frame.url().includes('contextual=1'); });
  await pane.evaluate(async function () { window.coldPaneStore = (await import('./modules/store.js')).store; });
  await pane.waitForFunction(function () { return window.coldPaneStore.get('contextualSessionReady') && window.coldPaneStore.get('connected'); });
  var before = await page.evaluate(function () { var request = window.coldStore.get('contextualSearchAsk'); var frame = document.querySelector('#contextual-clay iframe'); return { status: request.status, owner: request.ownerId, identity: frame.conversation.identity(), error: request.error }; });
  assert.equal(before.owner, 'owner'); assert.equal(before.identity.ownerId, null);
  assert.equal(before.status, 'opening', JSON.stringify(before));
  assert.equal(before.identity.ready, false, 'Replay completion alone cannot claim authenticated submission readiness');
  assert.equal((await sessions())[0].messages.filter(function (message) { return message.type === 'user_message'; }).length, 0);
  releaseOwner();
  var first = await receipt();
  Object.keys(first.request).forEach(function (key) { assert.equal(first.identity[key], first.request[key], key); });
  assert.equal(new URL(page.url()).pathname, '/p/alpha/');
  assert.equal(await page.locator('.search-clay-chat').count(), 0);
  await ask('Warm subsequent Ask'); var second = await receipt();
  assert.notEqual(second.request.sessionId, first.request.sessionId);
  for (var session of await sessions()) assert.equal(session.messages.filter(function (message) { return message.type === 'user_message'; }).length, 1);
});
