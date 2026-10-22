var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var chromium = require('playwright').chromium;
test('Driver Browser workbench shows and operates the actual Worker tab without switching conversations', { timeout: 60000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], {
    env: Object.assign({}, process.env, { CLAY_PANE_BROWSER: '1' }), stdio: ['ignore', 'pipe', 'pipe', 'ipc']
  });
  child.stdout.resume(); child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var info = await new Promise(function (resolve, reject) { child.once('message', resolve); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1600, height: 1000 } }), errors = [], base = 'http://127.0.0.1:' + info.port;
  page.on('pageerror', function (error) { errors.push(error.message); });
  if (!process.env.CLAY_BROWSER_WORKER_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(base + '/fixture/login');
  var data = await (await page.request.get(base + '/fixture/state')).json(), group = data.groups[0], driver = group.pair.driverId, worker = group.pair.workerId;
  async function tool(id, action, url) {
    var response = await page.request.post(base + '/fixture/browser-tool?id=' + id + '&action=' + action + (url ? '&url=' + encodeURIComponent(url) : ''));
    assert.equal(response.status(), 200); return response.json();
  }
  var opened = JSON.parse((await tool(worker, 'open', 'https://worker.example/task')).content[0].text);
  await page.locator('.session-item[data-session-id="' + driver + '"]').first().click();
  await page.waitForFunction(function (id) {
    var pane = document.querySelector('#split-host > .split-pane[data-session-id="' + id + '"]');
    return pane && !pane.querySelector('header').inert;
  }, driver);
  await page.locator('#shared-browser-btn').click();
  var panel = page.locator('#shared-browser-panel'), tabs = panel.getByRole('tab');
  await tabs.getByText('Worker #' + worker + ' · worker.example', { exact: true }).waitFor();
  assert.equal(await tabs.count(), 1, 'opening the workbench reuses the Worker tab instead of creating an empty browser');
  assert.equal(await panel.locator('[role="tab"][aria-selected="true"]').getAttribute('data-browser-id'), opened.id);
  assert.equal(await panel.getByRole('textbox', { name: 'Browser address', exact: true }).inputValue(), 'https://worker.example/task');
  await page.waitForFunction(function () { var empty = document.querySelector('#shared-browser-panel .shared-browser-empty'); return empty && empty.classList.contains('hidden'); });
  await panel.getByRole('button', { name: 'Pause Clay control', exact: true }).click();
  await panel.getByRole('button', { name: 'Resume shared control', exact: true }).waitFor();
  assert.equal((await tool(worker, 'navigate', 'https://blocked.example/')).isError, true, 'owner pause applies to the actual Worker runtime');
  await panel.getByRole('button', { name: 'Resume shared control', exact: true }).click();
  await panel.getByRole('button', { name: 'Pause Clay control', exact: true }).waitFor();
  assert.equal((await tool(worker, 'navigate', 'https://updated-worker.example/')).isError, undefined);
  await tabs.getByText('Worker #' + worker + ' · updated-worker.example', { exact: true }).waitFor();
  await tool(driver, 'open', 'https://driver.example/');
  await tabs.getByText('driver.example', { exact: true }).waitFor();
  assert.equal(await tabs.count(), 2);
  assert.equal(await panel.locator('[role="tab"][aria-selected="true"]').getAttribute('data-browser-id'), opened.id, 'background browser updates keep the selected tab');
  await tool(data.otherIds[0], 'open', 'https://unrelated.example/');
  assert.equal(await tabs.count(), 2, 'unrelated session browsers are not exposed');
  var driverStatus = JSON.parse((await tool(driver, 'status')).content[0].text);
  assert.equal(driverStatus.browsers.length, 1, 'Driver agent tool scope stays session-local');
  await tabs.getByText('driver.example', { exact: true }).click();
  await tabs.getByText('Worker #' + worker + ' · updated-worker.example', { exact: true }).click();
  await panel.getByRole('button', { name: 'Close browser tab 1', exact: true }).click();
  await page.waitForFunction(function () { return document.querySelectorAll('#shared-browser-panel [role="tab"]').length === 1; });
  assert.equal(JSON.parse((await tool(worker, 'status')).content[0].text).browsers.length, 0);
  assert.equal(await page.locator('#split-host > .split-pane[data-session-id="' + driver + '"]').count(), 1);
  assert.deepEqual(errors, []);
});
