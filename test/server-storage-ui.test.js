var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var playwright = require('playwright');

test('storage keeps measuring between progress polls and settles on completion or failure', async function (t) {
  var browser = await playwright.chromium.launch();
  t.after(function () { return browser.close(); });
  var page = await browser.newPage();
  var html = fs.readFileSync(path.join(__dirname, '../lib/public/index.html'), 'utf8');
  var start = html.indexOf('<div class="server-settings-section" data-section="storage">');
  var end = html.indexOf('<div class="server-settings-section" data-section="security">', start);
  await page.setContent('<div id="server-settings">' + html.slice(start, end) + '</div>');
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../lib/public/modules/store.js'), 'utf8').replace(/export \{[^}]+\};?/g, '') });
  await page.addScriptTag({ content: fs.readFileSync(path.join(__dirname, '../lib/public/modules/server-storage-settings.js'), 'utf8').replace(/^import .*$/m, '').replace(/export /g, '') });
  await page.evaluate(function () {
    store.set({serverSettingsPage:'storage'});
    window.fetch = async function () { return {ok:true,json:async function () {return {scanning:true};}}; };
  });
  var button = page.locator('#settings-storage-refresh');
  for (var i = 0; i < 3; i++) {
    await page.evaluate(function () { return loadStorageUsage(); });
    assert.equal(await button.textContent(), 'Measuring…');
    assert.equal(await button.isDisabled(), true);
    assert.equal(await page.locator('#settings-storage-status').getAttribute('data-state'), 'pending');
  }
  await page.evaluate(async function () {
    window.fetch = async function () { return {ok:true,json:async function () {return {scanning:false, attribution:'project', users:[],totalBytes:0,unattributedBytes:0,unattributedFiles:0,roots:1,checkedAt:new Date().toISOString()};}}; };
    await loadStorageUsage();
  });
  assert.equal(await button.textContent(), 'Refresh usage');
  assert.equal(await button.isDisabled(), false);
  await page.evaluate(async function () {
    store.set({serverStorageScanning:true});
    window.fetch = async function () {throw new Error('Disconnected');};
    await loadStorageUsage();
  });
  assert.equal(await button.textContent(), 'Refresh usage');
  assert.equal(await button.isDisabled(), false);
  assert.match(await page.locator('#settings-storage-status').textContent(), /Disconnected/);
});
