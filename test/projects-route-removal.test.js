// The standalone Projects list page is gone. A legacy /projects link resolves to
// the authorised workspace through the root route; with no ordinary projects the
// in-app welcome remains. Real server, routes and client; isolated storage and
// fenced providers; no live URL or account is contacted.
var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path'), fs = require('node:fs');
var pathToFileURL = require('node:url').pathToFileURL;
var chromium = require('playwright').chromium;
var COOKIE = { Cookie: 'relay_auth_user=pane-fixture-token' };
var ROOT = path.join(__dirname, '..');

async function start(t, mode) {
  var child = cp.fork(path.join(__dirname, 'fixtures/projects-route-server.cjs'), [mode], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var logs = ''; child.stdout.on('data', function (d) { logs += d; }); child.stderr.on('data', function (d) { logs += d; });
  var info = await new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error('Fixture startup timeout: ' + logs)); }, 20000);
    child.once('message', function (value) { clearTimeout(timer); resolve(value); });
    child.once('exit', function (code) { clearTimeout(timer); reject(new Error('Fixture exited ' + code + ': ' + logs)); });
  });
  return 'http://127.0.0.1:' + info.port;
}
async function login(t, origin) {
  var browser = await chromium.launch(); t.after(function () { return browser.close(); });
  var context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await context.addCookies([{ name: 'relay_auth_user', value: 'pane-fixture-token', url: origin }]);
  var page = await context.newPage(), errors = [];
  page.on('pageerror', function (error) { errors.push(error.message); });
  t.after(function () { assert.deepEqual(errors, []); });
  return page;
}

test('boot treats /projects like the root: a server-selected project wins, otherwise the zero-project welcome', async function () {
  var boot = await import(pathToFileURL(path.join(ROOT, 'lib/public/modules/home-surface-boot.js')).href);
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/projects', currentSlug: 'alpha', projectsLoaded: true }), 'project');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/projects/', currentSlug: null, projectsLoaded: false }), 'wait');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/projects', currentSlug: null, projectsLoaded: true }), 'projects');
});

test('hub markup is only loading or the zero-project welcome; it never renders a project list or add-project menu', async function () {
  var view = await import(pathToFileURL(path.join(ROOT, 'lib/public/modules/projects-hub-view.js')).href);
  var populated = view.projectsHubContent({ projectListLoaded: true, projectsHubList: [{ slug: 'alpha', title: 'Alpha' }], projectsAccessLoaded: true, connected: true });
  assert.doesNotMatch(populated, /projects-list|data-project-slug|data-projects-mode|Add a project|Getting started|href="\/projects"/);
  var zero = view.projectsHubContent({ projectListLoaded: true, projectsHubList: [], projectsAccessLoaded: true, connected: true, permissions: { createProject: true } });
  assert.match(zero, /data-projects-action="create-project"/); assert.match(zero, /WELCOME TO/);
  assert.doesNotMatch(zero, /revisit this guide|projects-list/);
  var loading = view.projectsHubContent({ projectListLoaded: false, projectsHubList: [] });
  assert.match(loading, /Loading your workspace/);
});

test('populated: /projects redirects once to the root, which serves the project workspace; no list page appears', { timeout: 90000 }, async function (t) {
  var origin = await start(t, 'populated');
  var first = await fetch(origin + '/projects', { headers: COOKIE, redirect: 'manual' });
  assert.equal(first.status, 302); assert.equal(first.headers.get('location'), '/');
  var second = await fetch(origin + '/projects/', { headers: COOKIE, redirect: 'manual' });
  assert.equal(second.status, 302); assert.equal(second.headers.get('location'), '/');
  var root = await fetch(origin + '/', { headers: COOKIE, redirect: 'manual' });
  assert.equal(root.status, 200); assert.match(await root.text(), /id="projects-hub"/);
  var anonymous = await fetch(origin + '/projects', { redirect: 'manual' });
  assert.equal(anonymous.status, 200, 'an unauthenticated legacy link shows sign-in, never the workspace');

  var page = await login(t, origin);
  await page.goto(origin + '/projects');
  await page.waitForURL(/\/p\/reuse\/$/, { timeout: 20000 });
  await page.waitForFunction(async function () { var s = (await import('./modules/store.js')).store; return s.get('connected') && s.get('projectListLoaded') === true; });
  assert.equal(await page.evaluate(function () { return document.body.classList.contains('projects-active') || !document.getElementById('projects-hub').classList.contains('hidden'); }), false, 'the standalone page is not shown');
  assert.equal(await page.locator('.projects-list, .projects-setup-actions').count(), 0);
});

test('zero projects: /projects lands on the in-app welcome at the root, creation is offered, nothing is fabricated', { timeout: 90000 }, async function (t) {
  var origin = await start(t, 'zero');
  var redirect = await fetch(origin + '/projects', { headers: COOKIE, redirect: 'manual' });
  assert.equal(redirect.status, 302); assert.equal(redirect.headers.get('location'), '/');
  var page = await login(t, origin), hops = 0;
  page.on('framenavigated', function (frame) { if (frame === page.mainFrame()) hops++; });
  await page.goto(origin + '/projects');
  await page.locator('.projects-welcome').waitFor({ timeout: 20000 });
  assert.equal(new URL(page.url()).pathname, '/');
  assert.equal(await page.evaluate(function () { return document.body.classList.contains('projects-shell'); }), true, 'welcome renders inside the app shell');
  await page.waitForFunction(async function () { return !!(await import('./modules/store.js')).store.get('projectsAccessLoaded'); });
  var projects = await page.evaluate(async function () { return ((await import('./modules/store.js')).store.get('projectsHubList') || []).length; });
  assert.equal(projects, 0, 'no project is invented');
  assert.ok(hops < 4, 'no redirect loop (' + hops + ' navigations)');
  await page.getByRole('button', { name: /Start a project/ }).click();
  await page.waitForFunction(async function () { var view = ((await import('./modules/store.js')).store.get('projectStart') || {}).view; return view !== null && view !== undefined; }, null, { timeout: 10000 }).catch(async function () { throw new Error('modal state ' + JSON.stringify(await page.evaluate(async function () { var s = (await import('./modules/store.js')).store; return { ps: s.get('projectStart'), ws: s.get('connected'), perms: s.get('permissions'), loaded: s.get('projectsAccessLoaded'), pending: s.get('pendingHomeProjectSlug') }; }))); });
  assert.equal(await page.locator('.project-start-dialog').isVisible(), true, 'the project start dialog is shown');
});
