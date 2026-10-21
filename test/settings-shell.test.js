// Unified settings shell: pure routing/target model plus browser acceptance
// against the isolated settings fixture (own HOME/CLAY_HOME, no real accounts).
var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;
var WebSocket = require('ws');
var chromium = require('playwright').chromium;

var MODULES = path.join(__dirname, '../lib/public/modules');
function load(name) { return import(pathToFileURL(path.join(MODULES, name)).href); }

// ---------- pure model ----------

test('access follows the authoritative role rules including a solo owner', async function () {
  var registry = await load('settings-shell-registry.js');
  assert.deepEqual(registry.accessFromMe({ multiUser: true, user: { role: 'admin' } }, null), { server: true, multiUser: true, project: true });
  assert.equal(registry.accessFromMe({ multiUser: true, user: { role: 'user' } }, null).server, false);
  assert.equal(registry.accessFromMe({ multiUser: true }, null).server, false);
  assert.deepEqual(registry.accessFromMe({ multiUser: false }, null), { server: true, multiUser: false, project: true });
  assert.equal(registry.accessFromMe(null, null).server, false);
  assert.equal(registry.accessFromMe({ multiUser: false }, { projectSettings: false }).project, false);
});

test('legacy destinations resolve to an exact scoped page and unavailable scopes fall back to Personal', async function () {
  var r = await load('settings-shell-registry.js');
  var admin = { server: true, multiUser: true, project: true };
  var solo = { server: true, multiUser: false, project: true };
  var member = { server: false, multiUser: true, project: true };
  assert.equal(r.resolveRoute({ scope: 'personal', page: 'us-mates' }, member).page, 'us-chat');
  assert.equal(r.resolveRoute({ scope: 'personal', page: 'us-experimental' }, member).page, 'us-chat');
  assert.equal(r.resolveRoute({ scope: 'personal', page: 'us-connections' }, member).page, 'us-integrations');
  assert.equal(r.resolveRoute({ scope: 'personal', page: 'us-email' }, member).page, 'us-integrations');
  assert.equal(r.resolveRoute({ scope: 'personal', page: 'us-logout' }, member).page, 'us-account');
  assert.equal(r.resolveRoute({ scope: 'personal' }, member).page, 'us-account');
  assert.equal(r.resolveRoute({ scope: 'server', page: 'admin-invites' }, admin).page, 'admin-users');
  assert.equal(r.resolveRoute({ scope: 'server', page: 'admin-users' }, solo).page, 'overview', 'multi-user pages never appear on a solo server');
  var denied = r.resolveRoute({ scope: 'server', page: 'network' }, member);
  assert.equal(denied.scope, 'personal'); assert.equal(denied.page, 'us-account'); assert.equal(denied.redirected, true);
  assert.equal(r.resolveRoute({ scope: 'project', page: 'environment', slug: 'a' }, member).slug, 'a');
  assert.equal(r.resolveRoute({ scope: 'project' }, { server: false, multiUser: false, project: false }).scope, 'personal');
  assert.equal(r.resolveRoute({ scope: 'project', page: 'nope' }, admin).page, 'profile');
  assert.deepEqual(r.pagesForScope('server', solo).map(function (p) { return p.id; }), ['overview', 'network', 'storage', 'security', 'environment', 'operations']);
  assert.equal(r.pagesForScope('server', admin).length, 9);
});

test('project choices list the open workspace first, only authorised projects, never mates', async function () {
  var t = await load('settings-project-target.js');
  var projects = [{ slug: 'b', title: 'Beta' }, { slug: 'a', project: 'Alpha' }, { slug: 'mate-x', isMate: true }, { slug: 'c' }];
  var choices = t.listSettingsProjects(projects, 'a', null);
  assert.deepEqual(choices.map(function (c) { return c.slug; }), ['a', 'b', 'c']);
  assert.equal(choices[0].isCurrent, true); assert.equal(choices[0].label, 'Alpha');
  assert.equal(t.optionLabel(choices[0]), 'Alpha (open workspace)');
  assert.deepEqual(t.listSettingsProjects(projects, 'mate-x', null).map(function (c) { return c.slug; }), ['b', 'a', 'c'], 'a mate workspace is not a project target');
  assert.deepEqual(t.listSettingsProjects(projects, 'a', { projectSettings: false }), []);
  assert.deepEqual(t.listSettingsProjects(null, 'a', null), []);
  assert.equal(t.resolveTargetSlug('b', choices), 'b');
  assert.equal(t.resolveTargetSlug('revoked', choices), 'a', 'a revoked slug falls back to the open workspace');
  assert.equal(t.resolveTargetSlug('x', []), null);
});

test('target binding rejects stale async replies', async function () {
  var t = await load('settings-project-target.js');
  var binding = t.createTargetBinding();
  var first = binding.bind('a');
  assert.equal(binding.isCurrent(first, 'a'), true);
  var second = binding.bind('b');
  assert.equal(binding.isCurrent(first, 'a'), false);
  assert.equal(binding.isCurrent(second, 'a'), false, 'slug must also match');
  assert.equal(binding.isCurrent(second, 'b'), true);
  binding.invalidate();
  assert.equal(binding.isCurrent(second, 'b'), false);
});

// ---------- browser acceptance ----------

function fixture(t, args) {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), args || [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(function () { if (child.connected) child.send('close'); setTimeout(function () { child.kill('SIGTERM'); }, 1500).unref(); });
    child.once('error', reject);
    child.on('message', function (msg) { if (msg.port) resolve({ url: 'http://127.0.0.1:' + msg.port, port: msg.port }); });
  });
}
async function ready(page, minimumProjects) {
  // waitForFunction does not await promises, so poll the module store explicitly.
  for (var attempt = 0; attempt < 200; attempt++) {
    var ok = await page.evaluate(async function (minimum) {
      var m = await import('./modules/store.js');
      return !!(m.store.get('connected') && m.store.get('projectListLoaded') === true && m.store.get('projectsAccessLoaded') === true &&
        (m.store.get('projectsHubList') || []).filter(function (p) { return !p.isMate; }).length >= minimum);
    }, minimumProjects === undefined ? 1 : minimumProjects);
    if (ok) return;
    await new Promise(function (resolve) { setTimeout(resolve, 100); });
  }
  throw new Error('The app did not finish loading its project list.');
}
async function launch(t, f, identity, viewport, minimumProjects) {
  var browser = await chromium.launch({ headless: true });
  t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: viewport || { width: 1280, height: 800 } });
  page.setDefaultTimeout(8000);
  var errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  t.after(function () { assert.deepEqual(errors, []); });
  await page.goto(f.url + '/__fixture/' + identity);
  await ready(page, minimumProjects);
  return page;
}
function storeGet(page, key) {
  return page.evaluate(async function (name) { var m = await import('./modules/store.js'); return m.store.get(name); }, key);
}
function storeSet(page, partial) {
  return page.evaluate(async function (values) { var m = await import('./modules/store.js'); m.store.set(values); }, partial);
}
function dropProject(page, slug) {
  return page.evaluate(async function (target) {
    var m = await import('./modules/store.js');
    m.store.set({ projectsHubList: m.store.get('projectsHubList').filter(function (p) { return p.slug !== target; }) });
  }, slug);
}
function shellRoute(page, route) {
  return page.evaluate(async function (value) { var m = await import('./modules/settings-shell.js'); await m.openSettings(value); }, route);
}
async function tabs(page) { return page.locator('#settings-scope-tabs button').allTextContents(); }
async function pages(page) { return page.locator('#settings-page-nav button').allTextContents(); }
async function active(page) { return page.evaluate(function () {
  var pane = document.querySelector('#settings-shell-content > .settings-pane:not(.hidden)');
  var section = pane && pane.querySelector('.us-section.active, .ps-section.active, .server-settings-section.active');
  return { pane: pane && pane.id, section: section && section.dataset.section };
}); }
async function pickProject(page, label) {
  var trigger = page.locator('#settings-project-picker .settings-picker-trigger');
  if (await trigger.isVisible()) { await trigger.click(); await page.getByRole('option', { name: label, exact: true }).click(); }
  else await page.locator('#settings-project-select').selectOption({ label: label });
}
function rawSocket(t, f, identity, slug) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket('ws://127.0.0.1:' + f.port + '/p/' + slug + '/ws', { headers: { Cookie: 'relay_auth_user=network-' + identity } });
    t.after(function () { ws.close(); }); ws.once('open', function () { resolve(ws); }); ws.once('error', reject);
  });
}
function request(ws, data, type) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Missing ' + type)); }, 5000);
    ws.on('message', function receive(raw) { var m = JSON.parse(raw); if (m.type !== type) return; clearTimeout(timer); ws.off('message', receive); resolve(m); });
    ws.send(JSON.stringify(data));
  });
}
async function fixtureState(f) { return (await fetch(f.url + '/__fixture/state')).json(); }
// Intercept the workspace socket. `rewrite(data, forward, hold)` may keep, alter or hold server messages.
async function interceptSocket(page, rewrite) {
  await page.routeWebSocket('**/p/sample/ws', function (socket) {
    var server = socket.connectToServer();
    socket.onMessage(function (message) { server.send(message); });
    server.onMessage(function (message) {
      var data; try { data = JSON.parse(String(message)); } catch (e) { socket.send(message); return; }
      rewrite(data, message, function (value) { socket.send(value); });
    });
  });
}
async function sleep(ms) { await new Promise(function (resolve) { setTimeout(resolve, ms); }); }

test('administrator: one gear opens all three scopes; Server pages include administration; no settings dialog', { timeout: 60000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin');
  assert.equal(await page.locator('#server-settings-btn').isVisible(), true);
  await page.locator('#server-settings-btn').click();
  await page.locator('#settings-scope-tabs [data-scope=server]').waitFor();
  assert.deepEqual(await tabs(page), ['Personal', 'Project', 'Server']);
  assert.deepEqual(await active(page), { pane: 'user-settings', section: 'us-account' });
  await page.locator('#settings-scope-tabs [data-scope=server]').click();
  assert.deepEqual(await pages(page), ['Overview', 'Network', 'Storage', 'Access & security', 'Users', 'Project access', 'Email delivery', 'Environment', 'Operations']);
  assert.deepEqual(await active(page), { pane: 'server-settings', section: 'overview' });
  assert.equal(await page.locator('#settings-server-name').evaluate(function (el) { return el.hidden; }), false);
  // A full-screen region, never a dialog; destructive confirmations are the only overlays.
  assert.equal(await page.locator('#settings-shell').getAttribute('role'), 'region');
  assert.equal(await page.locator('#settings-shell [role=dialog], #settings-shell [aria-modal=true]').count(), 0);
  var box = await page.locator('#settings-shell').boundingBox();
  assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 1280, 800]);
  await page.locator('#settings-page-nav [data-section="admin-users"]').click();
  await page.locator('#admin-users-body').getByRole('button', { name: /Add user/ }).click();
  assert.equal(await page.locator('.admin-modal-overlay').count(), 0, 'admin editors open inline');
  assert.equal(await page.locator('.admin-subview').count(), 1);
  assert.equal(await page.locator('.admin-subview').evaluate(function (el) { return el.closest('#settings-shell-content') !== null && getComputedStyle(el).position === 'static'; }), true);
  await page.keyboard.press('Escape');
  assert.equal(await page.locator('.admin-subview').count(), 0, 'Escape closes only the subview');
  assert.equal(await page.locator('#settings-shell').isVisible(), true);
  await page.locator('#settings-shell-close').click();
  assert.equal(await page.locator('#settings-shell').isVisible(), false);
  assert.equal(await page.evaluate(function () { return document.activeElement.id; }), 'server-settings-btn');
  assert.equal(await page.evaluate(function () { return Array.from(document.body.children).filter(function (el) { return el.inert; }).length; }), 0, 'background is interactive again');
});

test('member: gear is available, Server and unpermitted Project scopes are not offered, deep links explain the fallback', { timeout: 60000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'member');
  assert.equal(await page.locator('#server-settings-btn').isVisible(), true, 'personal settings need the gear for everyone');
  await page.locator('#server-settings-btn').click();
  await page.locator('#settings-scope-tabs button').first().waitFor();
  assert.deepEqual(await tabs(page), ['Personal'], 'default members have neither projectSettings nor administrator rights');
  await shellRoute(page, { scope: 'server', page: 'network' });
  assert.deepEqual(await active(page), { pane: 'user-settings', section: 'us-account' });
  assert.match(await page.locator('#settings-shell-status').textContent(), /require an administrator/);
  await shellRoute(page, { scope: 'project', slug: 'sample' });
  assert.match(await page.locator('#settings-shell-status').textContent(), /not available/);
  assert.equal(await page.locator('#server-settings').evaluate(function (el) { return el.classList.contains('hidden'); }), true);
});

test('solo server: the owner reaches Server settings without multi-user pages', { timeout: 60000 }, async function (t) {
  var f = await fixture(t, ['--solo']); var page = await launch(t, f, 'admin');
  await page.locator('#server-settings-btn').click();
  await page.locator('#settings-scope-tabs [data-scope=server]').waitFor();
  assert.deepEqual(await tabs(page), ['Personal', 'Project', 'Server']);
  await page.locator('#settings-scope-tabs [data-scope=server]').click();
  assert.deepEqual(await pages(page), ['Overview', 'Network', 'Storage', 'Access & security', 'Environment', 'Operations']);
  await shellRoute(page, { scope: 'server', page: 'admin-users' });
  assert.deepEqual(await active(page), { pane: 'server-settings', section: 'overview' });
});

test('every legacy destination is reachable inside the shell with no settings modal', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin');
  var cases = [
    [{ scope: 'personal', page: 'us-mates' }, 'user-settings', 'us-chat'], [{ scope: 'personal', page: 'us-experimental' }, 'user-settings', 'us-chat'],
    [{ scope: 'personal', page: 'us-connections' }, 'user-settings', 'us-integrations'], [{ scope: 'personal', page: 'us-email' }, 'user-settings', 'us-integrations'],
    [{ scope: 'personal', page: 'us-notifications' }, 'user-settings', 'us-notifications'], [{ scope: 'personal', page: 'us-ai' }, 'user-settings', 'us-ai'],
    [{ scope: 'personal', page: 'us-appearance' }, 'user-settings', 'us-appearance'],
    [{ scope: 'project', page: 'access', slug: 'sample' }, 'project-settings', 'access'], [{ scope: 'project', page: 'environment', slug: 'sample' }, 'project-settings', 'environment'],
    [{ scope: 'server', page: 'admin-invites' }, 'server-settings', 'admin-users'], [{ scope: 'server', page: 'admin-smtp' }, 'server-settings', 'admin-smtp'],
    [{ scope: 'server', page: 'storage' }, 'server-settings', 'storage'], [{ scope: 'server', page: 'operations' }, 'server-settings', 'operations']
  ];
  await shellRoute(page, { scope: 'personal' });
  for (var i = 0; i < cases.length; i++) {
    await shellRoute(page, cases[i][0]);
    assert.deepEqual(await active(page), { pane: cases[i][1], section: cases[i][2] }, JSON.stringify(cases[i][0]));
    assert.equal(await page.locator('.admin-modal-overlay, .email-setup-overlay, .avatar-positioner-overlay').count(), 0);
  }
  assert.equal((await storeGet(page, 'settingsLastRoute')).scope, 'server');
  // Entry points that existed before: user-island gear and the project context menu.
  await page.locator('#settings-shell-close').click();
  await page.locator('#user-account-trigger').click();
  await page.locator('.account-settings-button').click();
  assert.deepEqual(await active(page), { pane: 'user-settings', section: 'us-account' });
  await page.locator('#settings-shell-close').click();
  await page.locator('#title-bar-project-dropdown').click();
  await page.getByRole('menuitem', { name: 'Project Settings', exact: true }).click();
  assert.deepEqual(await active(page), { pane: 'project-settings', section: 'profile' });
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'sample');
});

test('focused project A first; switching to B changes only the settings target and saves only B', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin', undefined, 2);
  assert.equal(await storeGet(page, 'currentSlug'), 'sample');
  await shellRoute(page, { scope: 'project', page: 'environment', slug: 'sample' });
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'sample');
  var options = await page.locator('#settings-project-select option').allTextContents();
  assert.equal(options[0], 'Sample (open workspace)');
  assert.ok(options.indexOf('Public sample') > 0);
  await page.locator('#ps-env-add-btn:not(:disabled)').waitFor();
  await pickProject(page, 'Public sample');
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'public-sample');
  assert.equal(await storeGet(page, 'projectSettingsSlug'), 'public-sample');
  assert.equal(await storeGet(page, 'currentSlug'), 'sample', 'workspace is untouched');
  assert.match(page.url(), /\/p\/sample\//);
  await page.locator('#ps-env-add-btn:not(:disabled)').waitFor();
  await page.locator('#ps-env-add-btn').click();
  await page.locator('.ps-env-key').fill('ONLY_B'); await page.locator('.ps-env-val').fill('b-value');
  await page.locator('#ps-env-save').click();
  await page.locator('#ps-env-save-status').filter({ hasText: 'Saved.' }).waitFor();
  var state = await fixtureState(f);
  assert.match(state.projectEnv['public-sample'], /ONLY_B/);
  assert.equal(state.projectEnv.sample, undefined, 'project A was not written');
  await pickProject(page, 'Sample (open workspace)');
  await page.locator('#ps-env-add-btn:not(:disabled)').waitFor();
  assert.equal(await page.locator('.ps-env-key').count(), 0, 'A shows its own (empty) environment');
  await page.locator('#settings-shell-close').click();
  assert.equal(await storeGet(page, 'currentSlug'), 'sample', 'close returns to the prior workspace');
  assert.match(page.url(), /\/p\/sample\//);
});

test('the session-visibility default is edited for the selected project only, and the server re-authorises that exact slug', { timeout: 90000 }, async function (t) {
  var f = await fixture(t, ['--private-project']); var page = await launch(t, f, 'admin', undefined, 2);
  var sent = [];
  page.on('websocket', function (socket) { socket.on('framesent', function (frame) { try { var data = JSON.parse(String(frame.payload)); if (data.type === 'set_project_session_visibility_default') sent.push(data); } catch (e) {} }); });
  await page.reload(); await ready(page, 3);
  await shellRoute(page, { scope: 'project', page: 'access', slug: 'public-sample' });
  await page.locator('#ps-session-visibility-default-field').waitFor({ state: 'visible' });
  assert.equal(await storeGet(page, 'currentSlug'), 'sample');
  assert.equal(await page.locator('#ps-session-visibility-default').isDisabled(), false, 'a non-open project is editable');
  await page.locator('#ps-session-visibility-default').selectOption('shared', { force: true });
  for (var wait = 0; wait < 60 && !(await fixtureState(f)).projectSessionVisibility; wait++) await sleep(100);
  var state = await fixtureState(f);
  assert.deepEqual(state.projectSessionVisibility, { 'public-sample': 'shared' }, 'only the selected project changed');
  assert.equal(sent.length, 1); assert.equal(sent[0].slug, 'public-sample');
  // A/B isolation: the open workspace A is unchanged and B's value is not reflected on A.
  await pickProject(page, 'Sample (open workspace)');
  assert.equal(await page.locator('#ps-session-visibility-default').inputValue(), 'private');
  assert.equal((await fixtureState(f)).projectSessionVisibility.sample, undefined);
  // The server independently authorises each named target.
  var admin = await rawSocket(t, f, 'admin', 'sample');
  var ok = await request(admin, { type: 'set_project_session_visibility_default', slug: 'private-admin', visibility: 'shared', requestId: 'a1' }, 'set_project_session_visibility_default_result');
  assert.equal(ok.ok, true); assert.equal(ok.slug, 'private-admin'); assert.equal(ok.requestId, 'a1');
  var member = await rawSocket(t, f, 'member', 'sample');
  var notOwner = await request(member, { type: 'set_project_session_visibility_default', slug: 'sample', visibility: 'shared', requestId: 'm1' }, 'set_project_session_visibility_default_result');
  assert.equal(notOwner.ok, false); assert.match(notOwner.error, /not permitted/);
  var inaccessible = await request(member, { type: 'set_project_session_visibility_default', slug: 'private-admin', visibility: 'private', requestId: 'm2' }, 'set_project_session_visibility_default_result');
  assert.equal(inaccessible.ok, false); assert.match(inaccessible.error, /not permitted/);
  var mate = await request(admin, { type: 'set_project_session_visibility_default', slug: 'mate-x', visibility: 'shared', requestId: 'a2' }, 'set_project_session_visibility_default_result');
  assert.equal(mate.ok, false);
  assert.deepEqual((await fixtureState(f)).projectSessionVisibility, { 'public-sample': 'shared', 'private-admin': 'shared' });
});

test('the server authorises the exact rename and icon target and echoes the request id', { timeout: 60000 }, async function (t) {
  var f = await fixture(t, ['--private-project']);
  var member = await rawSocket(t, f, 'member', 'sample');
  var denied = await request(member, { type: 'set_project_title', slug: 'private-admin', title: 'Hijacked', requestId: 'denied-title' }, 'set_project_title_result');
  assert.equal(denied.ok, false); assert.equal(denied.slug, 'private-admin'); assert.equal(denied.requestId, 'denied-title'); assert.match(denied.error, /not permitted/);
  var deniedIcon = await request(member, { type: 'set_project_icon', slug: 'private-admin', icon: '🔥', requestId: 'denied-icon' }, 'set_project_icon_result');
  assert.equal(deniedIcon.ok, false); assert.equal(deniedIcon.requestId, 'denied-icon');
  var state = await fixtureState(f);
  assert.equal(state.projectTitles, undefined, 'no title was written'); assert.equal(state.projectIcons, undefined, 'no icon was written');
  var allowed = await request(member, { type: 'set_project_title', slug: 'sample', title: 'Renamed by member', requestId: 'ok-title' }, 'set_project_title_result');
  assert.equal(allowed.ok, true); assert.equal(allowed.slug, 'sample'); assert.equal(allowed.requestId, 'ok-title');
  assert.equal((await fixtureState(f)).projectTitles.sample, 'Renamed by member');
  var admin = await rawSocket(t, f, 'admin', 'sample');
  assert.equal((await request(admin, { type: 'set_project_icon', slug: 'private-admin', icon: '🔒', requestId: 'admin-icon' }, 'set_project_icon_result')).ok, true);
  assert.equal((await fixtureState(f)).projectIcons['private-admin'], '🔒');
});

test('rename replies bind to the exact project: a failed reply reverts only the project it belongs to', { timeout: 90000 }, async function (t) {
  var f = await fixture(t);
  var browser = await chromium.launch({ headless: true }); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); }); t.after(function () { assert.deepEqual(errors, []); });
  var held = []; var holding = false;
  await interceptSocket(page, function (data, raw, send) {
    if (data.type === 'set_project_title_result') { var failed = JSON.stringify(Object.assign({}, data, { ok: false, error: 'Simulated failure' })); if (holding) held.push(function () { send(failed); }); else send(failed); return; }
    send(raw);
  });
  await page.goto(f.url + '/__fixture/admin'); await ready(page, 2);
  await shellRoute(page, { scope: 'project', page: 'profile', slug: 'sample' });
  await page.locator('#ps-rename-btn').click(); await page.locator('#ps-rename-input').fill('Attempted name'); await page.locator('#ps-rename-save').click();
  await page.locator('#ps-project-name').filter({ hasText: 'Sample' }).waitFor();
  assert.equal(await page.locator('#ps-project-name').textContent(), 'Sample', 'failed rename reverted');
  // Held reply: switch to B before the failure for A arrives; B's name must not change.
  holding = true;
  await page.locator('#ps-rename-btn').click(); await page.locator('#ps-rename-input').fill('Second attempt'); await page.locator('#ps-rename-save').click();
  assert.equal(await page.locator('#ps-project-name').textContent(), 'Second attempt');
  await pickProject(page, 'Public sample');
  await page.locator('#ps-project-name').filter({ hasText: 'Public sample' }).waitFor();
  holding = false;
  assert.equal(held.length, 1, 'the failure reply for A is held');
  held.forEach(function (deliver) { deliver(); });
  await sleep(300);
  assert.equal(await page.locator('#ps-project-name').textContent(), 'Public sample', 'a late reply for A never edits B');
});

test('a late reply for the previous project never lands in the newly selected project', { timeout: 90000 }, async function (t) {
  var f = await fixture(t);
  var seed = await rawSocket(t, f, 'admin', 'sample');
  assert.equal((await request(seed, { type: 'set_project_env', slug: 'public-sample', envrc: 'export FROM_B=b-value', requestId: 'seed-b' }, 'set_project_env_result')).ok, true);
  assert.equal((await request(seed, { type: 'set_project_env', slug: 'sample', envrc: 'export FROM_A=a-value', requestId: 'seed-a' }, 'set_project_env_result')).ok, true);
  var browser = await chromium.launch({ headless: true }); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); }); t.after(function () { assert.deepEqual(errors, []); });
  var held = null; var release = null;
  await interceptSocket(page, function (data, raw, send) {
    if (data.type === 'project_env_result' && data.slug === 'sample' && !held) { held = raw; release = function () { send(held); }; return; }
    send(raw);
  });
  await page.goto(f.url + '/__fixture/admin'); await ready(page, 2);
  await shellRoute(page, { scope: 'project', page: 'environment', slug: 'sample' });
  for (var wait = 0; wait < 100 && !held; wait++) await sleep(50);
  assert.ok(held, 'the reply for A is being held');
  await pickProject(page, 'Public sample');
  await page.locator('.ps-env-key').first().waitFor();
  assert.equal(await page.locator('.ps-env-key').first().inputValue(), 'FROM_B');
  release();
  await sleep(400);
  assert.deepEqual(await page.locator('.ps-env-key').evaluateAll(function (els) { return els.map(function (el) { return el.value; }); }), ['FROM_B'], 'stale A reply ignored');
});

test('revoked or removed project: edits stop, the reason is shown and nothing is silently retargeted', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin', undefined, 2);
  await shellRoute(page, { scope: 'project', page: 'profile', slug: 'public-sample' });
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'public-sample');
  await dropProject(page, 'public-sample');
  await page.locator('#ps-empty').waitFor({ state: 'visible' });
  assert.match(await page.locator('#ps-empty-text').textContent(), /no longer available/);
  assert.match(await page.locator('#settings-shell-status').textContent(), /no longer available/);
  assert.equal(await storeGet(page, 'projectSettingsSlug'), null);
  assert.equal(await page.locator('#ps-rename-btn').isVisible(), false);
  assert.equal(await storeGet(page, 'currentSlug'), 'sample');
  // Revoking the permission itself removes the Project scope and returns to Personal.
  await storeSet(page, { permissions: { projectSettings: false } });
  await page.locator('#settings-scope-tabs [data-scope=project]').waitFor({ state: 'detached' });
  assert.deepEqual(await active(page), { pane: 'user-settings', section: 'us-account' });
});

test('no-project case: Project scope explains itself and Personal still works', { timeout: 60000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin');
  // The live fixture still owns projects and can push its list at any turn after a store
  // write, which used to repopulate the list between the write and the route. Write the
  // empty authoritative list and read the resulting view in the same turn, before any
  // network event can be delivered; Personal navigation is then checked normally.
  var empty = await page.evaluate(async function () {
    var m = await import('./modules/store.js'); var shell = await import('./modules/settings-shell.js');
    m.store.set({ projectsHubList: [], projectListLoaded: true });
    var opened = shell.openSettings({ scope: 'project' });
    var snapshot = { visible: !document.getElementById('ps-empty').hidden, text: document.getElementById('ps-empty-text').textContent,
      disabled: document.getElementById('settings-project-select').disabled };
    await opened;
    return snapshot;
  });
  assert.equal(empty.visible, true);
  assert.match(empty.text, /do not have a project/);
  assert.equal(empty.disabled, true);
  await page.locator('#settings-scope-tabs [data-scope=personal]').click();
  assert.deepEqual(await active(page), { pane: 'user-settings', section: 'us-account' });
});

test('an unloaded project list is shown as loading, never as empty, and resolves the requested target when it arrives', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin', undefined, 2);
  var list = await storeGet(page, 'projectsHubList');
  // A live server project push can legitimately resolve the waiting state at any
  // turn after the store write, so the loading view is read synchronously in the
  // same turn that opens the route, before any network event can be delivered.
  var loading = await page.evaluate(async function (route) {
    var m = await import('./modules/store.js'); var shell = await import('./modules/settings-shell.js');
    m.store.set({ projectsHubList: [], projectListLoaded: false });
    var opened = shell.openSettings(route);
    var snapshot = { heading: document.querySelector('#ps-empty h2').textContent, text: document.getElementById('ps-empty-text').textContent,
      disabled: document.getElementById('settings-project-select').disabled, bound: m.store.get('projectSettingsSlug') };
    await opened;
    return snapshot;
  }, { scope: 'project', page: 'environment', slug: 'public-sample' });
  assert.equal(loading.heading, 'Loading projects');
  assert.match(loading.text, /Loading your projects/);
  assert.doesNotMatch(loading.text, /do not have a project/);
  assert.equal(loading.disabled, true);
  assert.equal(loading.bound === 'public-sample', false, 'nothing is bound before the list is authoritative');
  await storeSet(page, { projectsHubList: list, projectListLoaded: true });
  await page.locator('#ps-empty').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'public-sample');
  assert.equal(await storeGet(page, 'projectSettingsSlug'), 'public-sample');
  assert.equal((await active(page)).section, 'environment');
});

test('opening settings refreshes permissions from the server and flags an offline, possibly stale list', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin');
  await storeSet(page, { permissions: { projectSettings: false } });
  await page.locator('#server-settings-btn').click();
  await page.locator('#settings-scope-tabs [data-scope=project]').waitFor();
  assert.equal((await storeGet(page, 'permissions')).projectSettings, true, 'stale boot permissions are replaced by the fresh server answer');
  await page.locator('#settings-scope-tabs [data-scope=project]').click();
  // The live socket restores `connected` itself, so read the note in the same turn.
  var note = await page.evaluate(async function () {
    var m = await import('./modules/store.js'); m.store.set({ connected: false });
    var status = document.getElementById('settings-shell-status'); return [status.hidden, status.textContent];
  });
  assert.equal(note[0], false); assert.match(note[1], /Offline/);
  await page.locator('#settings-shell-status').waitFor({ state: 'hidden' });
});

test('drafts are protected across scope changes, project switches and close; guards can be cancelled', { timeout: 90000 }, async function (t) {
  var f = await fixture(t, ['--personal-drafts']); var page = await launch(t, f, 'admin', undefined, 2);
  await shellRoute(page, { scope: 'personal', page: 'us-account' });
  await page.locator('#us-profile-edit').click();
  await page.locator('#us-profile-name').fill('Unsaved personal name');
  await page.locator('#settings-scope-tabs [data-scope=project]').click();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal((await active(page)).pane, 'user-settings', 'cancel stays put');
  await page.locator('#settings-scope-tabs [data-scope=project]').click();
  await page.getByRole('button', { name: 'Keep draft and leave', exact: true }).click();
  assert.equal((await active(page)).pane, 'project-settings');
  await page.locator('#settings-page-nav [data-section="environment"]').click();
  await page.locator('#ps-env-add-btn:not(:disabled)').click();
  await page.locator('.ps-env-key').fill('DRAFT_A');
  await pickProject(page, 'Public sample');
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'sample', 'a cancelled switch keeps the selector on A');
  await pickProject(page, 'Public sample');
  await page.getByRole('button', { name: 'Keep draft and leave', exact: true }).click();
  assert.equal(await storeGet(page, 'projectSettingsSlug'), 'public-sample');
  assert.equal(await page.locator('.ps-env-key').count(), 0);
  await pickProject(page, 'Sample (open workspace)');
  assert.equal(await page.locator('.ps-env-key').inputValue(), 'DRAFT_A', 'the draft for A returns');
  await page.locator('#settings-shell-close').click();
  assert.match(await page.locator('#settings-confirm').textContent(), /unsaved changes in another settings area|have not been saved/);
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.locator('#settings-shell').isVisible(), true);
  await page.locator('#settings-shell-close').click();
  await page.locator('#settings-confirm [data-confirm]').click();
  assert.equal(await page.locator('#settings-shell').isVisible(), false);
});

test('an in-flight environment save blocks switching target so the result cannot be misattributed', { timeout: 90000 }, async function (t) {
  var f = await fixture(t);
  var browser = await chromium.launch({ headless: true }); t.after(function () { return browser.close(); });
  var page = await browser.newPage({ viewport: { width: 1280, height: 800 } }); page.setDefaultTimeout(8000);
  var errors = []; page.on('pageerror', function (error) { errors.push(error.message); }); t.after(function () { assert.deepEqual(errors, []); });
  var held = null; var releaseSave = null;
  await interceptSocket(page, function (data, raw, send) {
    if (data.type === 'set_project_env_result' && !held) { held = raw; releaseSave = function () { send(held); }; return; }
    send(raw);
  });
  await page.goto(f.url + '/__fixture/admin'); await ready(page, 2);
  await shellRoute(page, { scope: 'project', page: 'environment', slug: 'sample' });
  await page.locator('#ps-env-add-btn:not(:disabled)').click();
  await page.locator('.ps-env-key').fill('SAVING_A'); await page.locator('.ps-env-val').fill('x');
  await page.locator('#ps-env-save').click();
  await page.locator('#ps-env-save-status').filter({ hasText: 'Saving' }).waitFor();
  await pickProject(page, 'Public sample');
  assert.equal(await storeGet(page, 'projectSettingsSlug'), 'sample', 'switch refused while saving');
  assert.equal(await page.locator('#settings-project-select').inputValue(), 'sample');
  releaseSave();
  await page.locator('#ps-env-save-status').filter({ hasText: 'Saved.' }).waitFor();
  await pickProject(page, 'Public sample');
  assert.equal(await storeGet(page, 'projectSettingsSlug'), 'public-sample');
});

test('narrow, light and dark: shell fits, tabs and selectors are usable, focus is visible', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin', { width: 390, height: 844 }, 2);
  await shellRoute(page, { scope: 'project', slug: 'sample' });
  var overflow = await page.evaluate(function () { var s = document.getElementById('settings-shell'); var c = document.getElementById('settings-shell-content'); return [s.scrollWidth, s.clientWidth, c.scrollWidth, c.clientWidth]; });
  assert.ok(overflow[0] <= overflow[1] && overflow[2] <= overflow[3], 'no horizontal overflow ' + overflow);
  assert.equal(await page.locator('#settings-scope-tabs button').count(), 3);
  assert.equal(await page.locator('#settings-page-select').isVisible(), true);
  assert.equal(await page.locator('#settings-project-select').isVisible(), true, 'native project selector on touch widths');
  await page.locator('#settings-page-select').selectOption('access');
  assert.equal((await active(page)).section, 'access');
  var colours = [];
  for (var theme of ['clay-light', 'clay-dark']) {
    await page.evaluate(async function (id) { var m = await import('./modules/theme.js'); m.applyTheme(id); }, theme);
    colours.push(await page.evaluate(function () { var s = getComputedStyle(document.getElementById('settings-shell')); return [s.backgroundColor, s.color]; }));
  }
  assert.notDeepEqual(colours[0], colours[1], 'themes are applied to the shell');
  assert.notEqual(colours[0][0], colours[0][1]); assert.notEqual(colours[1][0], colours[1][1]);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('#settings-scope-tabs [data-scope=personal]').focus();
  await page.keyboard.press('Tab');
  var outline = await page.evaluate(function () { return getComputedStyle(document.activeElement).outlineStyle; });
  assert.notEqual(outline, 'none', 'keyboard focus is visible');
  await page.locator('#settings-scope-tabs [data-scope=project]').click();
  await page.locator('#settings-page-nav [data-section="profile"]').focus();
  await page.keyboard.press('ArrowDown');
  assert.equal(await page.evaluate(function () { return document.activeElement.dataset.section; }), 'access');
});

test('admin editors and the avatar crop are inline subviews; destructive confirmations stay custom dialogs', { timeout: 90000 }, async function (t) {
  var f = await fixture(t, ['--personal-drafts']); var page = await launch(t, f, 'admin');
  await shellRoute(page, { scope: 'server', page: 'admin-users' });
  await page.locator('#admin-users-body .admin-perms-btn').first().waitFor();
  var permissions = page.locator('#admin-users-body .admin-perms-btn').first();
  await permissions.click();
  await page.locator('.admin-subview').waitFor();
  assert.equal(await page.locator('.admin-modal-overlay').count(), 0);
  assert.match(await page.locator('.admin-subview h3').textContent(), /Permissions/);
  assert.equal(await page.locator('#admin-users-body').isVisible(), false, 'the list is replaced while the editor is open');
  assert.equal(await page.locator('.admin-subview [role=region]').count() + await page.locator('.admin-subview .admin-modal[role=region]').count() > 0, true);
  await page.locator('.admin-subview .admin-modal-cancel').click();
  assert.equal(await page.locator('.admin-subview').count(), 0);
  assert.equal(await page.locator('#admin-users-body').isVisible(), true);
  // A dirty editor asks before discarding, using the custom confirmation.
  await page.locator('#admin-users-body').getByRole('button', { name: /Add user/ }).click();
  await page.locator('#admin-new-username').fill('typed-but-unsaved');
  await page.keyboard.press('Escape');
  await page.locator('#settings-confirm').waitFor();
  await page.getByRole('button', { name: 'Keep editing', exact: true }).click();
  assert.equal(await page.locator('.admin-subview').count(), 1, 'cancelling the confirmation keeps the draft');
  await page.keyboard.press('Escape');
  await page.locator('#settings-confirm [data-confirm]').click();
  assert.equal(await page.locator('.admin-subview').count(), 0);
  // Destructive actions remain overlay confirmations.
  await page.locator('#admin-users-body .admin-remove-btn:not(.admin-reset-pin-btn):not(.admin-perms-btn)').first().click();
  await page.locator('.admin-modal-overlay .admin-modal-confirm-danger').waitFor();
  assert.equal(await page.locator('.admin-modal-overlay .admin-modal').getAttribute('role'), 'dialog');
  await page.locator('.admin-modal-overlay .admin-modal-cancel').click();
  assert.equal(await page.locator('.admin-modal-overlay').count(), 0);
  // Project access editor.
  await page.locator('#settings-page-nav [data-section="admin-projects"]').click();
  await page.locator('.admin-manage-users-btn[data-slug="sample"]').click();
  await page.locator('.admin-subview').waitFor();
  assert.match(await page.locator('.admin-subview h3').textContent(), /Manage Access: sample/);
  await page.locator('.admin-subview .admin-modal-cancel').click();
  assert.equal(await page.locator('.admin-subview').count(), 0);
  // Avatar crop inline in Personal > Account.
  await shellRoute(page, { scope: 'personal', page: 'us-account' });
  await page.locator('#user-settings input[type=file]').setInputFiles(path.join(__dirname, '../lib/public/clay-studio-symbol.png'));
  await page.locator('.avatar-positioner-inline').waitFor();
  assert.equal(await page.locator('.avatar-positioner-overlay').count(), 0);
  assert.equal(await page.locator('.avatar-positioner-inline').evaluate(function (el) { return el.closest('#user-settings') !== null; }), true);
  await page.locator('.avatar-positioner-btn-cancel').click();
  assert.equal(await page.locator('.avatar-positioner-inline').count(), 0);
  assert.equal(await page.locator('#us-profile-edit').isVisible(), true, 'the account page is restored');
});

test('access verification fails closed and a stale answer cannot poison live state', { timeout: 90000 }, async function (t) {
  var f = await fixture(t); var page = await launch(t, f, 'admin');
  var poison = { multiUser: true, user: { id: 'admin', role: 'admin' }, permissions: { projectSettings: true, poison: true } };
  var mode = 'reject'; var held = [];
  await page.route('**/api/me', function (route) {
    if (mode === 'reject') return route.abort();
    if (mode === 'hold') { held.push(route); return; }
    return route.continue();
  });
  // 1. A failed verification never leaves Server reachable, even for a Server deep link.
  await storeSet(page, { adminMe: { before: true } });
  await shellRoute(page, { scope: 'server', page: 'network' });
  assert.deepEqual(await tabs(page), ['Personal', 'Project']);
  assert.deepEqual(await active(page), { pane: 'user-settings', section: 'us-account' });
  assert.match(await page.locator('#settings-shell-status').textContent(), /Could not verify/);
  assert.equal(await page.locator('#server-settings').evaluate(function (el) { return el.classList.contains('hidden'); }), true);
  assert.deepEqual(await storeGet(page, 'adminMe'), { before: true }, 'a failed verification writes nothing');
  await page.locator('#settings-shell-close').click();
  // 2. An answer that arrives after close/reopen is ignored: no store writes, no scopes.
  mode = 'hold';
  var first = shellRoute(page, { scope: 'personal' });
  for (var i = 0; i < 50 && !held.length; i++) await sleep(50);
  assert.equal(held.length, 1);
  await page.locator('#settings-shell-close').click();
  mode = 'pass';
  await shellRoute(page, { scope: 'personal' });
  await page.locator('#settings-scope-tabs [data-scope=server]').waitFor();
  var before = await storeGet(page, 'permissions');
  await held[0].fulfill({ json: poison });
  await first;
  await sleep(200);
  assert.deepEqual(await storeGet(page, 'permissions'), before, 'stale completion did not touch permissions');
  assert.equal((await storeGet(page, 'adminMe')).permissions && (await storeGet(page, 'adminMe')).permissions.poison, undefined);
  // 3. A different signed-in user invalidates a pending answer.
  await page.locator('#settings-shell-close').click();
  mode = 'hold'; held.length = 0;
  var second = shellRoute(page, { scope: 'server' });
  for (i = 0; i < 50 && !held.length; i++) await sleep(50);
  var adminMeBefore = await storeGet(page, 'adminMe');
  await storeSet(page, { myUserId: 'someone-else' });
  await held[0].fulfill({ json: poison });
  await second;
  await sleep(200);
  assert.equal(await page.locator('#settings-shell').isVisible(), false, 'a user switch closes settings');
  assert.deepEqual(await storeGet(page, 'adminMe'), adminMeBefore, 'the stale answer was not stored');
});
