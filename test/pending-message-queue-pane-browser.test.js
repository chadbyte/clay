var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;

test('real session composer supports pointer queue reordering', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { env: Object.assign({}, process.env, { CLAY_PANE_BENCH: '', CLAY_FIXTURE_SYNTHETIC_TURN: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  child.stderr.resume(); child.stdout.resume();
  t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (!process.env.CLAY_QUEUE_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  var url = 'http://127.0.0.1:' + info.port;
  await page.goto(url + '/fixture/login');
  var data = await (await page.request.get(url + '/fixture/state')).json();
  await page.request.post(url + '/fixture/switch?id=' + data.standaloneId);
  var host = page.locator('#split-host .split-pane-frame[data-session-id="' + data.standaloneId + '"]');
  await host.waitFor();
  var frame = await (await host.elementHandle()).contentFrame();
  await frame.locator('#input').waitFor({ state: 'visible' });
  await page.waitForFunction(function (id) { var f = document.querySelector('#split-host iframe[data-session-id="' + id + '"]'); var live = f && f.clayPane && f.clayPane.identity(); return live && live.ready; }, data.standaloneId);
  await frame.locator('#input').fill('Hold the synthetic turn');
  await frame.locator('#input').press('Enter');
  await frame.waitForFunction(function () { return document.getElementById('send-btn').classList.contains('stop'); });
  for (var i = 0; i < 3; i++) {
    await frame.locator('#input').fill('Queued message ' + i);
    await frame.locator('#input').press('Enter');
    await frame.waitForFunction(function (n) { return document.querySelectorAll('[data-pending-id]').length === n; }, i + 1);
  }
  var ids = await frame.locator('[data-pending-id]').evaluateAll(function (rows) { return rows.map(function (row) { return row.dataset.pendingId; }); });
  var start = await frame.locator('.pending-message-drag').first().boundingBox();
  var end = await frame.locator('[data-pending-id]').last().boundingBox();
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 });
  await page.mouse.up();
  await frame.waitForFunction(function (id) { return document.querySelector('[data-pending-id]').dataset.pendingId === id; }, ids[1], { timeout: 5000 });
  assert.deepEqual(await frame.locator('[data-pending-id]').evaluateAll(function (rows) { return rows.map(function (row) { return row.dataset.pendingId; }); }), [ids[1], ids[2], ids[0]]);
  // Reload obtains authoritative persisted order rather than optimistic DOM state.
  await page.reload();
  await host.waitFor();
  frame = await (await host.elementHandle()).contentFrame();
  await frame.waitForFunction(function () { return document.querySelectorAll('[data-pending-id]').length === 3; });
  assert.deepEqual(await frame.locator('[data-pending-id]').evaluateAll(function (rows) { return rows.map(function (row) { return row.dataset.pendingId; }); }), [ids[1], ids[2], ids[0]]);
  var body = await frame.locator('.pending-message-preview').last().boundingBox();
  end = await frame.locator('[data-pending-id]').first().boundingBox();
  await page.mouse.move(body.x + 10, body.y + 6); await page.mouse.down();
  await page.mouse.move(end.x + end.width / 2, end.y + end.height / 2, { steps: 12 }); await page.mouse.up();
  await frame.waitForFunction(function (id) { return document.querySelector('[data-pending-id]').dataset.pendingId === id; }, ids[0]);

});
