var test = require('node:test');
var assert = require('node:assert/strict');
var cp = require('node:child_process');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var chromium = require('playwright').chromium;

test('queue pointer order survives row refresh, persists and controls real delivery', { timeout: 60000 }, async function (t) {
  var temp = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-queue-browser-'));
  var child = cp.spawn(process.execPath, [path.join(__dirname, 'fixtures/pending-message-ui-server.js')], { env: Object.assign({}, process.env, { HOME: temp, CLAY_HOME: temp }), stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(function () { child.kill('SIGTERM'); fs.rmSync(temp, { recursive: true, force: true }); });
  var url = await new Promise(function (resolve, reject) {
    var output = '';
    child.stdout.on('data', function (chunk) { output += chunk; var found = output.match(/PENDING_UI_URL=(\S+)/); if (found) resolve(found[1]); });
    child.once('error', reject);
    child.once('exit', function (code) { reject(new Error('Queue fixture exited: ' + code)); });
    child.stderr.resume();
  });
  var browser = await chromium.launch();
  t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1100, height: 800 }, hasTouch: true });
  var errors = [], mutations = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.on('websocket', function (socket) { socket.on('framesent', function (event) { var msg = JSON.parse(event.payload); if (msg.type === 'pending_message_reorder') mutations.push(msg); }); });
  await page.goto(url);
  await page.waitForFunction(function () { return window.fixtureStore && fixtureStore.get('connected'); });
  await page.click('#seed');
  await page.waitForFunction(function () { return document.querySelectorAll('[data-pending-id]').length === 3; });
  var ids = await page.locator('[data-pending-id]').evaluateAll(function (rows) { return rows.map(function (row) { return row.dataset.pendingId; }); });
  async function beginDrag(index) {
    var box = await page.locator('.pending-message-drag').nth(index).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
  }
  async function moveTo(index) {
    var box = await page.locator('[data-pending-id]').nth(index).boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 8 });
  }
  async function savedIds() {
    return page.evaluate(function () {
      return new Promise(function (resolve) {
        var ws = new WebSocket('ws://' + location.host);
        ws.onopen = function () { ws.send(JSON.stringify({ type: 'pending_message_get', projectSlug: 'fixture-project', sessionId: 41, requestId: 'verify' })); };
        ws.onmessage = function (event) { var msg = JSON.parse(event.data); if (msg.requestId === 'verify') { ws.close(); resolve(msg.result.items.filter(function (item) { return item.state === 'pending'; }).map(function (item) { return item.id; })); } };
      });
    });
  }
  await beginDrag(0);
  // Authoritative same-revision hydration replaces every row during an active gesture.
  await page.evaluate(function () { var queue = fixtureStore.get('pendingMessageQueue'); fixtureStore.set({ pendingMessageQueue: Object.assign({}, queue) }); });
  await moveTo(2);
  assert.equal(await page.locator('.is-drop-target.is-drop-after').count(), 1);
  await page.mouse.up();
  await page.waitForFunction(function (id) { return document.querySelector('[data-pending-id]').dataset.pendingId === id; }, ids[1]);
  assert.deepEqual(await savedIds(), [ids[1], ids[2], ids[0]]);
  assert.equal(mutations.length, 1);
  await page.reload();
  await page.waitForFunction(function () { return document.querySelectorAll('[data-pending-id]').length === 3; });
  assert.deepEqual(await page.locator('[data-pending-id]').evaluateAll(function (rows) { return rows.map(function (row) { return row.dataset.pendingId; }); }), [ids[1], ids[2], ids[0]]);
  await beginDrag(2); await moveTo(0); await page.keyboard.press('Escape'); await page.mouse.up();
  assert.equal(mutations.length, 1, 'Escape cancels without a mutation');
  await beginDrag(2); await moveTo(0);
  await page.evaluate(function () { var queue = fixtureStore.get('pendingMessageQueue'); fixtureStore.set({ pendingMessageQueue: Object.assign({}, queue, { revision: queue.revision + 1 }) }); });
  await page.mouse.up();
  assert.equal(mutations.length, 1, 'A changed revision cancels the old gesture');
  await page.reload(); await page.waitForFunction(function () { return document.querySelectorAll('[data-pending-id]').length === 3; });
  await page.locator('.pending-message-drag').nth(2).focus(); await page.keyboard.press('ArrowUp');
  await page.waitForFunction(function (id) { return document.querySelectorAll('[data-pending-id]')[1].dataset.pendingId === id; }, ids[0]);
  assert.deepEqual(await savedIds(), [ids[1], ids[0], ids[2]]);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(function () { document.documentElement.classList.add('light-theme'); });
  var touch = await page.context().newCDPSession(page);
  var start = await page.locator('.pending-message-drag').nth(2).boundingBox();
  var end = await page.locator('[data-pending-id]').nth(1).boundingBox();
  await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: start.x + 12, y: start.y + 12 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: end.x + 65, y: end.y + end.height / 2 }] });
  await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await page.waitForFunction(function (id) { return document.querySelectorAll('[data-pending-id]')[1].dataset.pendingId === id; }, ids[2]);
  assert.deepEqual(await savedIds(), [ids[1], ids[2], ids[0]]);
  assert.equal(await page.evaluate(function () { return document.documentElement.scrollWidth <= innerWidth; }), true);
  await page.setViewportSize({ width: 1100, height: 800 });
  var preview = await page.locator('.pending-message-preview').nth(2).boundingBox();
  await page.mouse.move(preview.x + 10, preview.y + 6); await page.mouse.down(); await moveTo(1); await page.mouse.up();
  await page.waitForFunction(function (id) { return document.querySelectorAll('[data-pending-id]')[1].dataset.pendingId === id; }, ids[0]);
  assert.deepEqual(await savedIds(), [ids[1], ids[0], ids[2]], 'The prompt body is also a drag target');
  await beginDrag(2); await moveTo(0);
  var beforeContextChange = mutations.length;
  await page.evaluate(function () { fixtureStore.set({ activeSessionId: 99 }); });
  await page.mouse.up();
  assert.equal(mutations.length, beforeContextChange, 'A switched session cannot receive the old drag');
  await page.reload(); await page.waitForFunction(function () { return document.querySelectorAll('[data-pending-id]').length === 3; });
  await page.locator('[data-pending-id="' + ids[0] + '"] [data-action="edit"]').click();
  await page.locator('.pending-message-editor').fill('Updated image prompt');
  await page.locator('[data-action="edit-save"]').click();
  await page.waitForFunction(function () { return !document.querySelector('.pending-message-editor'); });
  assert.equal(await page.locator('.pending-message-image-thumb').count(), 1);
  await page.click('#complete');
  await page.waitForFunction(function () { return fixtureRuntime.length === 1; });
  assert.equal(await page.evaluate(function () { return fixtureRuntime[0].text; }), 'Add a concise error state\n\nexample');
  await page.click('#complete');
  await page.waitForFunction(function () { return fixtureRuntime.length === 2; });
  assert.equal(await page.evaluate(function () { return fixtureRuntime[1].text; }), 'Updated image prompt');
  assert.equal(await page.evaluate(function () { return fixtureRuntime[1].imageCount; }), 1);
  await page.locator('[data-action="cancel"]').click();
  await page.waitForFunction(function () { return !document.querySelector('[data-pending-id]'); });
  assert.equal(await page.locator('#input').inputValue(), 'Main composer draft stays here');
  assert.deepEqual(errors, []);
});
