var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var chromium = require('playwright').chromium;
function fixture(t) {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), [], {stdio: ['ignore','ignore','pipe','ipc']});
    t.after(function () { child.kill('SIGTERM'); }); child.once('error', reject);
    child.on('message', function (msg) { if (msg.port) resolve('http://127.0.0.1:' + msg.port); });
  });
}
async function open(page) {
  await page.waitForFunction(async function () { var module = await import('/modules/store.js'); return module.store.get('connected') && module.store.get('myUserId'); });
  await page.locator('#title-bar-project-dropdown').click();
  await page.getByRole('menuitem', {name: 'Project Settings', exact: true}).click();
}
test('project modal separates access, preserves drafts on failure and saves scoped environment', {timeout: 60000}, async function (t) {
  var url = await fixture(t); var browser = await chromium.launch({headless: true}); t.after(function () { return browser.close(); });
  var page = await browser.newPage({viewport: {width: 1280, height: 800}}); page.setDefaultTimeout(8000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); });
  await page.goto(url + '/__fixture/admin'); await open(page);
  assert.deepEqual(await page.locator('#project-settings .settings-nav-item').allTextContents(), ['General', 'Access', 'Environment']);
  assert.equal(await page.locator('#ps-model-list, #ps-instructions-editor').count(), 0);
  assert.equal(await page.locator('#project-settings').evaluate(function (el) { return el.parentElement === document.body; }), true);
  await page.locator('#project-settings [data-section="access"].settings-nav-item').click();
  assert.equal(await page.locator('#ps-session-visibility-default-field').isVisible(), true);
  assert.equal(await page.locator('#ps-transfer-form, #ps-transfer-btn').count(), 0);
  assert.equal(await page.locator('#ps-session-visibility-default-inherited-hint').isVisible(), false);
  await page.locator('#project-settings [data-section="environment"].settings-nav-item').click();
  await page.locator('#ps-env-add-btn:not(:disabled)').waitFor(); await page.locator('#ps-env-add-btn').click();
  await page.locator('.ps-env-key').fill('PROJECT_TEST'); await page.locator('.ps-env-val').fill('example-value');
  assert.equal(await page.locator('.ps-env-val').getAttribute('type'), 'password');
  await page.locator('#project-settings [data-section="profile"].settings-nav-item').click();
  await page.locator('#project-settings [data-section="environment"].settings-nav-item').click();
  assert.equal(await page.locator('.ps-env-val').inputValue(), 'example-value');
  await page.locator('#project-settings-close').click(); await page.getByRole('button', {name: 'Keep editing', exact: true}).click();
  assert.equal(await page.locator('.ps-env-key').inputValue(), 'PROJECT_TEST');
  await fetch(url + '/__fixture/fail'); await page.locator('#ps-env-save').click();
  await page.locator('#ps-env-save-status').filter({hasText: 'Simulated disk failure'}).waitFor();
  assert.equal(await page.locator('.ps-env-val').inputValue(), 'example-value');
  await fetch(url + '/__fixture/recover'); await page.locator('#ps-env-save').click(); await page.locator('#ps-env-save-status').filter({hasText: 'Saved.'}).waitFor();
  await page.locator('#project-settings-close').click();
  await page.reload(); await open(page); await page.locator('#project-settings [data-section="environment"].settings-nav-item').click();
  await page.locator('.ps-env-val').waitFor();
  assert.equal(await page.locator('.ps-env-val').inputValue(), 'example-value');
  await page.getByRole('button', {name: 'Show variable value', exact: true}).click();
  assert.equal(await page.locator('.ps-env-val').getAttribute('type'), 'text');
  await page.setViewportSize({width: 390, height: 844});
  assert.equal(await page.locator('#ps-nav-dropdown').evaluate(function (el) { return el.getBoundingClientRect().right <= el.closest('.ps-modal').getBoundingClientRect().right - 10; }), true);
  assert.deepEqual(await page.locator('#ps-nav-dropdown option').allTextContents(), ['General', 'Access', 'Environment']);
  await page.locator('#ps-nav-dropdown').selectOption('profile');
  assert.equal(await page.locator('#ps-project-name').isVisible(), true);
  assert.equal(await page.locator('.ps-modal').evaluate(function (el) { return el.scrollWidth <= el.clientWidth; }), true);
  await page.locator('#project-settings-close').focus(); await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#project-settings').evaluate(function (el) { return el.contains(document.activeElement); }), true);
  await page.keyboard.press('Escape'); assert.equal(await page.locator('#project-settings').isVisible(), false);
  assert.deepEqual(errors, []);
});
