// Leaving Personal settings must prompt only for a real draft. Production
// shell and Personal modules against the isolated settings fixture (own HOME,
// CLAY_HOME and users; no live accounts or providers).
var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var chromium = require('playwright').chromium;

var PAGES = ['us-account', 'us-integrations', 'us-providers', 'us-notifications', 'us-appearance', 'us-agent'];

async function fixture(t, args) {
  // Provider transports are fenced before any product import (the AI page would otherwise start model discovery).
  var logs = '';
  var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), args || [], { execArgv: ['-r', path.join(__dirname, 'fixtures/provider-fence-preload.cjs')], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.on('data', function (d) { logs += d; });
  t.after(function () { child.kill('SIGTERM'); assert.doesNotMatch(logs, /Provider execution is forbidden|Live completion forbidden/, 'no provider transport was attempted'); });
  var url = await new Promise(function (resolve, reject) {
    child.once('error', reject);
    child.on('message', function (msg) { if (msg.port) resolve('http://127.0.0.1:' + msg.port); });
  });
  var browser = await chromium.launch({ headless: true });
  t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(8000);
  var errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  t.after(function () { assert.deepEqual(errors, []); });
  await page.goto(url + '/__fixture/admin');
  await page.waitForFunction(async function () {
    var store = (await import('./modules/store.js')).store;
    return store.get('connected') && store.get('myUserId') && store.get('projectListLoaded') === true && store.get('projectsAccessLoaded') === true;
  });
  return { page: page, url: url };
}
function openPersonal(page, id) {
  return page.evaluate(async function (target) { await (await import('./modules/settings-shell.js')).openSettings({ scope: 'personal', page: target }); }, id);
}
async function keys(page) {
  return page.evaluate(async function () {
    var store = (await import('./modules/store.js')).store, out = {};
    ['personalEmailDirty', 'personalLinearDirty', 'userVoiceDirty', 'notificationDraft', 'appearanceDraft', 'userTerminalDirty', 'userProfileDirty', 'defaultAiDraftDirty', 'userAllowDirty'].forEach(function (k) { if (store.get(k)) out[k] = store.get(k); });
    return JSON.stringify(out);
  });
}
async function dialogs(page) { return page.getByRole('button', { name: 'Keep draft and leave', exact: true }).count(); }
async function toProject(page) { await page.locator('#settings-scope-tabs [data-scope=project]').click(); }
async function toPersonal(page) { await page.locator('#settings-scope-tabs [data-scope=personal]').click(); }

test('untouched Personal pages never prompt when moving to Project and back, before or after an appearance toggle', { timeout: 120000 }, async function (t) {
  for (var args of [[], ['--personal-drafts']]) {
    var f = await fixture(t, args), page = f.page;
    for (var round = 0; round < 2; round++) {
      if (round === 1) {
        await page.evaluate(async function () { var theme = await import('./modules/theme.js'); theme.toggleDarkMode(); theme.toggleDarkMode(); theme.toggleDarkMode(); });
        // waitForFunction does not await promises, so poll the store explicitly.
        for (var attempt = 0; attempt < 100 && JSON.parse(await keys(page)).appearanceDraft; attempt++) await page.waitForTimeout(50);
        assert.equal(JSON.parse(await keys(page)).appearanceDraft, undefined, 'the toggle save settled');
      }
      for (var id of PAGES) {
        await openPersonal(page, id);
        await page.locator('#settings-page-nav [data-section="' + id + '"].active, #settings-page-nav [data-section="' + id + '"][aria-current]').first().waitFor({ state: 'attached' }).catch(function () {});
        await toProject(page);
        var found = await dialogs(page); if (found) t.diagnostic('dirty keys: ' + await keys(page));
        assert.equal(found, 0, id + ' untouched (' + args.join(' ') + ' round ' + round + ') must not prompt');
        await page.locator('#ps-empty, #settings-project-select').first().waitFor({ state: 'attached' });
        await toPersonal(page);
        assert.equal(await dialogs(page), 0, 'returning to Personal must not prompt');
      }
    }
  }
});

test('a value left in the hidden Linear key field is not a draft, while an open editor with a typed key is', { timeout: 60000 }, async function (t) {
  var f = await fixture(t), page = f.page;
  await openPersonal(page, 'us-integrations');
  // Browser autofill or form restore writes into the hidden field without an editor.
  await page.evaluate(function () { var key = document.getElementById('us-linear-key'); key.value = 'autofilled-secret'; key.dispatchEvent(new Event('input', { bubbles: true })); });
  await toProject(page);
  assert.equal(await dialogs(page), 0, 'hidden autofilled key must not prompt');
  await toPersonal(page);
  await openPersonal(page, 'us-integrations');
  await page.locator('#us-linear-add').click();
  await page.locator('#us-linear-key').fill('typed-key');
  await toProject(page);
  assert.equal(await dialogs(page), 1, 'a typed key in the open editor still prompts');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.locator('#us-linear-key').inputValue(), 'typed-key', 'the draft is retained');
});

test('genuine profile and terminal drafts still prompt and are retained', { timeout: 60000 }, async function (t) {
  var f = await fixture(t, ['--personal-drafts']), page = f.page;
  await openPersonal(page, 'us-account');
  await page.locator('#us-profile-edit').click();
  await page.locator('#us-profile-name').fill('Edited but unsaved');
  await toProject(page);
  assert.equal(await dialogs(page), 1);
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.locator('#us-profile-name').inputValue(), 'Edited but unsaved');
  await page.locator('#us-profile-name').fill('Alex Fixture');
  await openPersonal(page, 'us-appearance');
  await page.locator('#us-terminal-size').fill('20');
  await toProject(page);
  assert.equal(await dialogs(page), 1, 'an uncommitted terminal size prompts');
});
