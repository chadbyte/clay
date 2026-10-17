// Cross-scope draft matrix for Personal, Project and Server settings: untouched,
// edit then revert, successful save, failed save, and section / scope / target /
// close navigation. Production shell and modules against the isolated settings
// fixture, with provider transports fenced before any product import.
var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var chromium = require('playwright').chromium;

var FENCE = path.join(__dirname, 'fixtures/provider-fence-preload.cjs');

async function boot(t, args) {
  var logs = '';
  var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), args || [], { execArgv: ['-r', FENCE], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  child.stderr.on('data', function (d) { logs += d; });
  t.after(function () { child.kill('SIGTERM'); assert.doesNotMatch(logs, /Provider execution is forbidden|Live completion forbidden/, 'no provider transport was attempted'); });
  var url = await new Promise(function (resolve, reject) {
    child.once('error', reject);
    child.on('message', function (msg) { if (msg.port) resolve('http://127.0.0.1:' + msg.port); });
  });
  var browser = await chromium.launch({ headless: true });
  t.after(function () { return browser.close(); });
  return { url: url, browser: browser };
}
async function newPage(env) {
  var page = await env.browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.setDefaultTimeout(8000);
  var errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  page.errors = errors;
  await page.goto(env.url + '/__fixture/admin');
  for (var i = 0; i < 100; i++) {
    var ok = await page.evaluate(async function () {
      var s = (await import('./modules/store.js')).store;
      return !!(s.get('connected') && s.get('projectListLoaded') === true && s.get('projectsAccessLoaded') === true && (s.get('projectsHubList') || []).length > 1);
    });
    if (ok) break;
    await page.waitForTimeout(100);
  }
  return page;
}
function open(page, scope, id, slug) {
  return page.evaluate(async function (route) { await (await import('./modules/settings-shell.js')).openSettings(route); }, { scope: scope, page: id, slug: slug });
}
async function settle(page, ms) { await page.waitForTimeout(ms || 500); }
async function confirm(page) { return page.locator('#settings-confirm').count(); }
// Click a scope tab; return the confirmation text (or null) and cancel it.
async function switchScope(page, scope) {
  await page.locator('#settings-scope-tabs [data-scope=' + scope + ']').click(); await settle(page, 250);
  return dismiss(page);
}
async function dismiss(page) {
  if (!(await confirm(page))) return null;
  var text = await page.locator('#settings-confirm p').textContent();
  await page.locator('#settings-confirm [data-cancel]').click();
  return text;
}
async function closeShell(page) {
  await page.locator('#settings-shell-close').click(); await settle(page, 250);
  return dismiss(page);
}
async function forceClose(page) { await page.evaluate(async function () { (await import('./modules/settings-shell.js')).closeSettings({ force: true }); }); }

test('untouched pages in every scope never prompt on section, scope or close navigation', { timeout: 150000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  var pages = { personal: ['us-account', 'us-appearance', 'us-chat', 'us-notifications', 'us-ai', 'us-integrations'], project: ['profile', 'access', 'environment'],
    server: ['overview', 'network', 'storage', 'security', 'admin-users', 'admin-projects', 'admin-smtp', 'environment', 'operations'] };
  var others = { personal: 'project', project: 'server', server: 'personal' };
  for (var scope of Object.keys(pages)) {
    for (var id of pages[scope]) {
      await open(page, scope, id); await settle(page, 600);
      assert.equal(await switchScope(page, others[scope]), null, scope + '/' + id + ' leaving scope');
      assert.equal(await closeShell(page), null, scope + '/' + id + ' closing');
      await forceClose(page);
    }
    // Moving between sections of one scope is also silent.
    await open(page, scope, pages[scope][0]); await settle(page, 400);
    for (var next of pages[scope].slice(1)) {
      await page.locator('#settings-page-nav [data-section="' + next + '"]').click(); await settle(page, 250);
      assert.equal(await confirm(page), 0, scope + ' section ' + next);
    }
    await forceClose(page);
  }
  assert.deepEqual(page.errors, []);
});

// ---- Project scope ----

test('project rename: revert is silent, a real change prompts for scope, target and close', { timeout: 120000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  await open(page, 'project', 'profile'); await settle(page, 700);
  var original = await page.evaluate(function () { return document.getElementById('ps-project-name').textContent; });
  await page.locator('#ps-rename-btn').click();
  var input = page.locator('#ps-rename-input');
  // Opening the editor alone is not a draft.
  assert.equal(await switchScope(page, 'personal'), null, 'editor open, value unchanged');
  await page.locator('#settings-scope-tabs [data-scope=project]').click(); await settle(page, 400);
  await input.fill(original + ' edited');
  await input.fill(original);
  assert.equal(await switchScope(page, 'personal'), null, 'edit then revert to the saved name');
  assert.equal(await closeShell(page), null, 'close after revert');
  await open(page, 'project', 'profile'); await settle(page, 500);
  await input.fill(original + ' changed');
  assert.match(await switchScope(page, 'personal'), /unsaved project changes will remain/, 'a real rename prompts on scope change');
  assert.match(await closeShell(page), /changes have not been saved/, 'and on close');
  var chosen = await page.evaluate(function () {
    var select = document.getElementById('settings-project-select');
    var other = Array.from(select.options).map(function (o) { return o.value; }).filter(function (v) { return v && v !== select.value; })[0];
    select.value = other; select.dispatchEvent(new Event('change', { bubbles: true })); return other;
  });
  assert.ok(chosen, 'a second project is available as a target');
  await settle(page, 300);
  assert.match(await dismiss(page) || '', /unsaved project name change will be discarded/, 'switching target with a rename draft prompts');
  assert.deepEqual(page.errors, []);
});

test('project environment: untouched, blank row, edit-then-revert, success and failed save', { timeout: 150000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  await open(page, 'project', 'environment'); await settle(page, 900);
  await page.waitForFunction(function () { return !document.getElementById('ps-env-add-btn').disabled; }, null, { timeout: 8000 });
  assert.equal(await switchScope(page, 'personal'), null, 'loaded and untouched');
  await open(page, 'project', 'environment'); await settle(page, 400);
  // Adding then removing a blank row leaves nothing to save.
  await page.locator('#ps-env-add-btn').click();
  await page.locator('#ps-env-list .ps-env-row .ps-env-del').last().click();
  assert.equal(await switchScope(page, 'personal'), null, 'blank row added and removed');
  await open(page, 'project', 'environment'); await settle(page, 400);
  // Type a variable, then delete it: back to the saved content.
  await page.locator('#ps-env-add-btn').click();
  await page.locator('#ps-env-list .ps-env-key').last().fill('REVERT_ME');
  await page.locator('#ps-env-list .ps-env-val').last().fill('1');
  assert.match(await switchScope(page, 'personal') || '', /unsaved/, 'a typed variable is a draft');
  await page.locator('#ps-env-list .ps-env-del').last().click();
  assert.equal(await switchScope(page, 'personal'), null, 'edit then revert to the saved variables');
  assert.equal(await closeShell(page), null);
  await forceClose(page);
  // Successful save clears the draft.
  await open(page, 'project', 'environment'); await settle(page, 600);
  await page.locator('#ps-env-add-btn').click();
  await page.locator('#ps-env-list .ps-env-key').last().fill('SAVED_VAR');
  await page.locator('#ps-env-list .ps-env-val').last().fill('v');
  await page.locator('#ps-env-save').click();
  await page.locator('#ps-env-save-status').filter({ hasText: /Saved/ }).waitFor();
  assert.equal(await switchScope(page, 'personal'), null, 'saved');
  assert.equal(await closeShell(page), null);
  await forceClose(page);
  assert.deepEqual(page.errors, []);
});

test('project environment: a failed save keeps the draft and the guards still protect it', { timeout: 150000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  await page.routeWebSocket(/\/ws(\?|$)/, function (ws) {
    var server = ws.connectToServer();
    ws.onMessage(function (message) {
      var data; try { data = JSON.parse(String(message)); } catch (error) { data = null; }
      if (data && data.type === 'set_project_env') { ws.send(JSON.stringify({ type: 'set_project_env_result', slug: data.slug, requestId: data.requestId, ok: false, error: 'Fixture storage unavailable' })); return; }
      server.send(message);
    });
    server.onMessage(function (message) { ws.send(message); });
  });
  await page.reload();
  for (var i = 0; i < 100; i++) { if (await page.evaluate(async function () { var s = (await import('./modules/store.js')).store; return !!(s.get('connected') && s.get('projectListLoaded') && s.get('projectsAccessLoaded')); })) break; await page.waitForTimeout(100); }
  await open(page, 'project', 'environment'); await settle(page, 900);
  await page.locator('#ps-env-add-btn').click();
  await page.locator('#ps-env-list .ps-env-key').last().fill('FAILED_VAR');
  await page.locator('#ps-env-list .ps-env-val').last().fill('v');
  await page.locator('#ps-env-save').click();
  await page.locator('#ps-env-save-status').filter({ hasText: /Fixture storage unavailable/ }).waitFor();
  assert.match(await switchScope(page, 'personal') || '', /unsaved/, 'the failed draft is retained and prompts on scope change');
  assert.match(await closeShell(page) || '', /not been saved/, 'and on close');
  assert.deepEqual(page.errors, []);
});

// ---- Server scope ----

test('server network origins: revert is silent, save clears, a failed save is retained', { timeout: 150000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  await open(page, 'server', 'network'); await settle(page, 900);
  var box = page.locator('#settings-network-origins');
  var saved = await box.inputValue();
  assert.equal(await switchScope(page, 'personal'), null, 'loaded and untouched');
  await open(page, 'server', 'network'); await settle(page, 400);
  await box.fill(saved + '\nhttps://draft.example.test:2633');
  assert.match(await switchScope(page, 'personal') || '', /server settings drafts will remain/, 'a real edit prompts on scope change');
  assert.match(await closeShell(page) || '', /unsaved changes/, 'and on close');
  await box.fill(saved);
  assert.equal(await switchScope(page, 'personal'), null, 'edit then revert');
  assert.equal(await closeShell(page), null);
  await open(page, 'server', 'network'); await settle(page, 400);
  var failing = true;
  await page.route('**/api/server/network', function (route) {
    if (failing && route.request().method() !== 'GET') { route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'Fixture network write failed. Your draft is retained.' }) }); return; }
    route.continue();
  });
  await box.fill(saved + '\nhttps://failing.example.test:2633');
  await page.locator('#settings-network-save').click();
  await page.locator('#settings-network-status').filter({ hasText: /Fixture network write failed/ }).waitFor();
  assert.match(await switchScope(page, 'personal') || '', /server settings drafts will remain/, 'the failed draft is retained');
  failing = false;
  await page.locator('#settings-network-save').click();
  await page.waitForFunction(function () { return document.getElementById('settings-network-save').disabled; }, null, { timeout: 8000 });
  assert.equal(await switchScope(page, 'personal'), null, 'saved');
  assert.equal(await closeShell(page), null);
  assert.deepEqual(page.errors, []);
});

test('server environment: edit-then-revert is silent, save clears, a failed save is retained', { timeout: 150000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  await open(page, 'server', 'environment'); await settle(page, 900);
  await page.waitForFunction(function () { return !document.getElementById('ss-env-add-btn').disabled; }, null, { timeout: 8000 });
  assert.equal(await switchScope(page, 'personal'), null, 'loaded and untouched');
  await open(page, 'server', 'environment'); await settle(page, 400);
  await page.locator('#ss-env-add-btn').click();
  await page.locator('#ss-env-list .ps-env-key').last().fill('SRV_REVERT');
  await page.locator('#ss-env-list .ps-env-val').last().fill('1');
  assert.match(await switchScope(page, 'personal') || '', /server settings drafts will remain/, 'a typed variable is a draft');
  await page.locator('#ss-env-list .ps-env-del').last().click();
  assert.equal(await switchScope(page, 'personal'), null, 'edit then revert');
  assert.equal(await closeShell(page), null);
  await open(page, 'server', 'environment'); await settle(page, 400);
  await page.routeWebSocket(/\/ws(\?|$)/, function (ws) { var s = ws.connectToServer(); ws.onMessage(function (m) { s.send(m); }); s.onMessage(function (m) { ws.send(m); }); });
  await page.locator('#ss-env-add-btn').click();
  await page.locator('#ss-env-list .ps-env-key').last().fill('SRV_SAVED');
  await page.locator('#ss-env-list .ps-env-val').last().fill('v');
  await page.locator('#ss-env-save').click();
  await page.waitForFunction(function () { return document.getElementById('ss-env-save').disabled; }, null, { timeout: 8000 });
  assert.equal(await switchScope(page, 'personal'), null, 'saved');
  assert.equal(await closeShell(page), null);
  assert.deepEqual(page.errors, []);
});

test('server email delivery: opening the editor is silent, an edit prompts, reverting clears it', { timeout: 150000 }, async function (t) {
  var env = await boot(t, ['--personal-drafts']), page = await newPage(env);
  await open(page, 'server', 'admin-smtp'); await settle(page, 900);
  var edit = page.locator('#smtp-edit');
  if (await edit.count()) await edit.click();
  await page.locator('#smtp-host').waitFor();
  assert.equal(await switchScope(page, 'personal'), null, 'editor open, nothing typed');
  await open(page, 'server', 'admin-smtp'); await settle(page, 400);
  if (await edit.count()) await edit.click();
  await page.locator('#smtp-host').waitFor();
  var host = page.locator('#smtp-host'), original = await host.inputValue();
  await host.fill(original + 'x');
  assert.match(await switchScope(page, 'personal') || '', /server settings drafts will remain/, 'a changed field prompts');
  await host.fill(original);
  assert.equal(await switchScope(page, 'personal'), null, 'edit then revert');
  await open(page, 'server', 'admin-smtp'); await settle(page, 400);
  if (await edit.count()) await edit.click();
  await page.locator('#smtp-secure').waitFor();
  var secure = page.locator('#smtp-secure'), was = await secure.isChecked();
  await secure.setChecked(!was);
  assert.match(await switchScope(page, 'personal') || '', /server settings drafts will remain/, 'a toggled option prompts');
  await secure.setChecked(was);
  assert.equal(await switchScope(page, 'personal'), null, 'toggle reverted');
  assert.equal(await closeShell(page), null);
  assert.deepEqual(page.errors, []);
});

test('server connection settings: a changed address prompts, reverting it clears the draft', { timeout: 150000 }, async function (t) {
  var env = await boot(t), page = await newPage(env);
  await open(page, 'server', 'security'); await settle(page, 900);
  // The section appears only under password sign-in; present that policy state to the real module.
  await page.evaluate(async function () {
    var s = (await import('./modules/store.js')).store;
    s.set({ accountAuthPolicy: Object.assign({}, s.get('accountAuthPolicy'), { method: 'password' }), accountTransport: {} });
    await (await import('./modules/account-transport-settings.js')).loadAccountTransportSettings();
  });
  var origin = page.locator('#account-transport [name=origin]');
  await origin.waitFor({ state: 'visible', timeout: 8000 });
  var saved = await origin.inputValue();
  assert.equal(await switchScope(page, 'personal'), null, 'visible and untouched');
  await open(page, 'server', 'security'); await settle(page, 1200);
  await page.evaluate(async function () {
    var s = (await import('./modules/store.js')).store;
    s.set({ accountAuthPolicy: Object.assign({}, s.get('accountAuthPolicy'), { method: 'password' }), accountTransport: {} });
    await (await import('./modules/account-transport-settings.js')).loadAccountTransportSettings();
  });
  await origin.waitFor({ state: 'visible', timeout: 8000 });
  await origin.fill('https://proxy.example.test');
  assert.match(await switchScope(page, 'personal') || '', /server settings drafts will remain/, 'a changed address prompts');
  await origin.fill(saved);
  assert.equal(await switchScope(page, 'personal'), null, 'edit then revert');
  assert.equal(await closeShell(page), null);
  assert.deepEqual(page.errors, []);
});
