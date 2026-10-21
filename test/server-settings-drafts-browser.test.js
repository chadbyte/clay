// Real settings shell and server pages; all storage/provider imports are isolated by the fixture.
var test = require('node:test'), assert = require('node:assert/strict');
var cp = require('node:child_process'), path = require('node:path'), chromium = require('playwright').chromium;
test('untouched Server settings and reverted controls leave without draft warnings', { timeout: 90000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/server-settings-server.js'), [], { execArgv: ['-r', path.join(__dirname, 'fixtures/provider-fence-preload.cjs')], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
  var url = await new Promise(function (resolve, reject) { child.on('message', function (msg) { if (msg.port) resolve('http://127.0.0.1:' + msg.port); }); child.once('error', reject); });
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  if (!process.env.CLAY_SETTINGS_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
  await page.goto(url + '/__fixture/admin');
  async function openServer(id) {
    if (!await page.locator('#settings-shell').isVisible()) await page.locator('#server-settings-btn').click();
    await page.locator('#settings-scope-tabs [data-scope=server]').click();
    await page.locator('#settings-page-nav [data-section="' + id + '"]').click();
  }
  for (var id of ['overview', 'network', 'storage', 'security', 'admin-users', 'admin-projects', 'admin-smtp', 'environment', 'operations']) {
    await openServer(id);
    await page.waitForTimeout(250);
    await page.locator('#settings-scope-tabs [data-scope=personal]').click();
    assert.equal(await page.locator('#settings-confirm').count(), 0, id + ': untouched page must leave silently');
  }
  await openServer('storage');
  var trigger = page.locator('#settings-image-retention + .settings-picker .settings-picker-trigger');
  await trigger.click();
  await page.locator('#settings-image-retention-menu [aria-selected=true]').click();
  await page.locator('#settings-scope-tabs [data-scope=personal]').click();
  assert.equal(await page.locator('#settings-confirm').count(), 0, 'choosing the already selected retention value is not a change');

  async function openStorage() {
    await openServer('storage');
    await page.waitForFunction(function () { return !document.getElementById('settings-image-retention').disabled; });
  }
  async function chooseRetention(label) { await trigger.click(); await page.locator('#settings-image-retention-menu').getByRole('option', { name: label, exact: true }).click(); }
  async function leave(expectPrompt) {
    await page.locator('#settings-scope-tabs [data-scope=personal]').click();
    assert.equal(await page.locator('#settings-confirm').count(), expectPrompt ? 1 : 0);
    if (expectPrompt) await page.locator('#settings-confirm [data-cancel]').click();
  }
  await openStorage();
  await page.locator('#settings-image-retention').dispatchEvent('change');
  await leave(false);
  await openStorage(); await chooseRetention('14 days'); await leave(true);
  await chooseRetention('7 days'); await leave(false);
  await openStorage(); await chooseRetention('14 days');
  await page.locator('#settings-image-retention-save').click();
  await page.locator('#settings-image-retention-status').filter({ hasText: /^Saved/ }).waitFor();
  assert.equal((await (await page.request.get(url + '/__fixture/state')).json()).imageRetentionDays, 14);
  await chooseRetention('7 days'); await leave(true);
  await chooseRetention('14 days'); await leave(false);
  await openStorage(); await chooseRetention('30 days');
  await page.request.post(url + '/__fixture/fail');
  await page.locator('#settings-image-retention-save').click();
  await page.locator('#settings-image-retention-status').filter({ hasText: /Simulated disk failure/ }).waitFor();
  await leave(true); await chooseRetention('14 days'); await leave(false);
  await page.request.post(url + '/__fixture/recover');
  await openServer('operations');
  var channel = page.locator('#settings-update-channel');
  await page.locator('label:has(#settings-update-channel)').click(); assert.equal(await channel.isChecked(), true); await leave(true);
  await page.locator('label:has(#settings-update-channel)').click(); assert.equal(await channel.isChecked(), false); await leave(false);
  await page.request.post(url + '/__fixture/mac');
  await openServer('operations');
  await page.waitForFunction(function () { return !document.getElementById('settings-keep-awake').disabled; });
  await page.locator('label:has(#settings-keep-awake)').click(); await leave(true);
  await page.locator('label:has(#settings-keep-awake)').click(); await leave(false);
  await page.locator('#settings-shell-close').click();
  assert.equal(await page.locator('#settings-confirm').count(), 0, 'closing after reverting all changes is silent');

});

test('Personal to Server to Project then Escape is silent without edits in account and solo dev mode', { timeout: 60000 }, async function (t) {
  for (var args of [[], ['--solo']]) {
    var child = cp.fork(path.join(__dirname, 'fixtures/server-settings-server.js'), args, { env: Object.assign({}, process.env, { CLAY_DEV: '1' }), execArgv: ['-r', path.join(__dirname, 'fixtures/provider-fence-preload.cjs')], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    child.stderr.resume(); t.after(function () { child.kill('SIGTERM'); });
    var url = await new Promise(function (resolve, reject) { child.on('message', function (msg) { if (msg.port) resolve('http://127.0.0.1:' + msg.port); }); child.once('error', reject); });
    var browser = await chromium.launch(); t.after(function () { return browser.close(); });
    var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    if (!process.env.CLAY_SETTINGS_COMPILED) await require('./fixtures/source-module-runtime.cjs').install(page);
    await page.goto(url + (args.length ? '/p/sample/' : '/__fixture/admin'));
    await page.locator('#server-settings-btn').click();
    for (var round = 0; round < 3; round++) {
      await page.locator('#settings-scope-tabs [data-scope=personal]').click();
      await page.locator('#settings-scope-tabs [data-scope=server]').click();
      await page.waitForFunction(function () { return !document.getElementById('settings-image-retention').disabled; });
      await page.locator('#settings-scope-tabs [data-scope=project]').click();
      assert.equal(await page.locator('#settings-confirm').count(), 0, 'scope warning, mode=' + (args.length ? 'solo' : 'accounts'));
      await page.keyboard.press('Escape');
      assert.equal(await page.locator('#settings-confirm').count(), 0, 'Escape warning, mode=' + (args.length ? 'solo' : 'accounts'));
      assert.equal(await page.locator('#settings-shell').isVisible(), false);
      if (round < 2) await page.locator('#server-settings-btn').click();
    }
    await browser.close(); child.kill('SIGTERM');
  }
});
