var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var pathToFileURL = require('node:url').pathToFileURL;
var preferences = require('../lib/users-home-surface-preferences').attachHomeSurfacePreferences;
var root = path.join(__dirname, '..');
function moduleUrl(name) { return pathToFileURL(path.join(root, 'lib/public/modules', name + '.js')).href; }

test('onboarding and Projects preferences persist per user across partial writes', function () {
  var data = { users: [{ id: 'alice' }, { id: 'bob' }] };
  var deps = { loadUsers: function () { return data; }, saveUsers: function (next) { data = JSON.parse(JSON.stringify(next)); } };
  var first = preferences(deps);
  first.setHomeSurfacePreference('alice', { surface: 'projects', onboardingStep: 'project', activeSessionByMate: { clay: 'session-1' } });
  var restored = preferences(deps);
  restored.setHomeSurfacePreference('alice', { sidebarCollapsed: true });
  assert.equal(restored.getHomeSurfacePreference('alice').onboardingStep, 'project');
  assert.equal(restored.getHomeSurfacePreference('alice').surface, 'projects');
  assert.deepEqual(restored.getHomeSurfacePreference('alice').activeSessionByMate, { clay: 'session-1' });
  assert.equal(restored.getHomeSurfacePreference('bob').onboardingStep, undefined);
  restored.setHomeSurfacePreference('alice', { onboardingStep: 'complete' });
  assert.equal(preferences(deps).getHomeSurfacePreference('alice').onboardingStep, 'complete');
  assert.equal(restored.setHomeSurfacePreference('bob', { onboardingStep: '<bad>' }).preference.onboardingStep, undefined);
});

test('first-run routing distinguishes loading, Projects deep links, and legacy Home preferences', async function () {
  var boot = await import(moduleUrl('home-surface-boot'));
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/', surfaceLoaded: true, projectsLoaded: false }), 'wait');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/', surfaceLoaded: true, projectsLoaded: true }), 'projects');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/projects', currentSlug: 'existing' }), 'projects');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/projects/', currentSlug: null }), 'projects');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/', surface: 'home', surfaceLoaded: true, projectsLoaded: true, dockLoaded: true }), 'projects');
  assert.equal(boot.resolveHomeBootDestination({ pathname: '/p/existing/', currentSlug: 'existing' }), 'project');
});

test('the Projects welcome and list render from actual availability and access', async function () {
  var view = await import(moduleUrl('projects-hub-view'));
  var state = { projectListLoaded: false, homeSurfaceLoaded: true, projectsAccessLoaded: true, connected: true, onboardingStep: 'welcome', projectsHubList: [] };
  assert.match(view.projectsHubContent(state), /Loading your workspace/);
  assert.doesNotMatch(view.projectsHubContent(state), /Where the minds work together/);
  state.projectListLoaded = true;
  assert.match(view.projectsHubContent(state), /Start a project/);
  state.onboardingStep = 'project';
  var setup = view.projectsHubContent(state);
  assert.match(setup, /data-projects-action="create-project"/);
  assert.doesNotMatch(setup, /Start with a project|data-projects-mode/);
  assert.match(view.projectsHubContent(Object.assign({}, state, { onboardingStep: "complete" })), /Where the minds work together/);
  state.permissions = { createProject: false };
  assert.doesNotMatch(view.projectsHubContent(state), /data-projects-mode/);
  assert.match(view.projectsHubContent(state), /data-projects-action="create-project" disabled/);
  state.projectsHubList = [{ slug: 'mate-clay', isMate: true }, { slug: 'demo', title: '<script>bad</script>', path: '/tmp/demo' }];
  var list = view.projectsHubContent(state);
  assert.match(list, /data-project-slug="demo"/);
  assert.doesNotMatch(list, /data-project-slug="mate-clay"|<script>/);
  assert.match(list, /&lt;script&gt;/);
  state.connected = false;
  assert.match(view.projectsHubContent(state), /data-project-slug="demo" disabled/);
});

test('stale preference replies cannot rewind local onboarding progress', async function () {
  var storeModule = await import(moduleUrl('store'));
  var surface = await import(moduleUrl('home-surface'));
  var ws = await import(moduleUrl('ws-ref'));
  var sent = [];
  storeModule.createStore({ homeSurfaceLoaded: true, onboardingStep: 'welcome' });
  ws.setWs({ readyState: 1, send: function (text) { sent.push(JSON.parse(text)); } });
  surface.updateHomeSurfacePreference({ onboardingStep: 'project' });
  surface.handleHomeSurfaceState({ preference: { onboardingStep: 'welcome' } });
  assert.equal(storeModule.store.get('onboardingStep'), 'project');
  assert.equal(sent[sent.length - 1].preference.onboardingStep, 'project');
  surface.handleHomeSurfaceState({ preference: { onboardingStep: 'project' } });
  assert.equal(storeModule.store.get('onboardingIntent'), null);
  ws.setWs(null);
});

test('zero-project welcome renders inside the app shell without a duplicate header; populated Projects keeps its own', async function () {
  var view = await import(moduleUrl('projects-hub-view'));
  var empty = { projectListLoaded: true, projectsAccessLoaded: true, connected: true, onboardingStep: 'welcome', projectsHubList: [{ slug: 'mate-clay', isMate: true }] };
  assert.equal(view.isShellWelcome(empty), true);
  var shell = view.projectsHubContent(empty);
  assert.match(shell, /projects-eyebrow">WELCOME TO<\/div>/);
  assert.match(shell, /<h1[^>]*><span class="projects-wordmark" role="img" aria-label="Clay Studio"><\/span><\/h1>/);
  assert.match(shell, /Where the minds work together<\/p>/);
  assert.match(shell, /Work together on a project\./);
  assert.match(shell, /Create your own specialist\./);
  assert.doesNotMatch(shell, /A place for|Bring a project\./);
  assert.doesNotMatch(shell, /projects-header|projects-brand|data-projects-action="settings"/);
  assert.equal(view.isShellWelcome(Object.assign({}, empty, { projectListLoaded: false })), false);
  var loading = view.projectsHubContent(Object.assign({}, empty, { projectListLoaded: false }));
  assert.match(loading, /projects-header/);
  var populated = Object.assign({}, empty, { projectsHubList: [{ slug: 'demo', title: 'Demo' }] });
  assert.equal(view.isShellWelcome(populated), false);
  assert.match(view.projectsHubContent(populated), /projects-header[\s\S]*data-project-slug="demo"/);
  var css = require('node:fs').readFileSync(path.join(root, 'lib/public/css/projects-hub.css'), 'utf8');
  assert.match(css, /body\.projects-active:not\(\.projects-shell\) #top-bar/);
  assert.doesNotMatch(css, /body\.projects-shell #top-bar|body\.projects-shell #icon-strip/);
});

test('welcome gives Projects and Mates their own CTAs; the Mate CTA waits for Clay and a connection', async function () {
  var view = await import(moduleUrl('projects-hub-view'));
  var base = { projectListLoaded: true, projectsAccessLoaded: true, connected: true, onboardingStep: 'welcome', projectsHubList: [], cachedMatesList: [{ id: 'm1', builtinKey: 'clay' }] };
  var html = view.projectsHubContent(base);
  assert.match(html, /data-projects-action="create-project"[^>]*>Start a project/);
  assert.match(view.projectsHubContent(Object.assign({}, base, { connected: false })), /data-projects-action="create-project" disabled/);
  assert.match(view.projectsHubContent(Object.assign({}, base, { permissions: { createProject: false } })), /data-projects-action="create-project" disabled/);
  assert.match(html, /data-projects-action="mate"(?![^>]*disabled)[^>]*>Create a Mate/);
  assert.equal((html.match(/projects-intro-action/g) || []).length, 2);
  assert.match(view.projectsHubContent(Object.assign({}, base, { cachedMatesList: [] })), /data-projects-action="mate" disabled/);
  assert.match(view.projectsHubContent(Object.assign({}, base, { connected: false })), /data-projects-action="mate" disabled/);
  assert.equal(view.clayMateReady({ cachedMatesList: [{ builtinKey: 'other' }] }), false);
  var setup = view.projectsHubContent(Object.assign({}, base, { onboardingStep: 'project' }));
  assert.match(setup, /data-projects-action="mate"/);
});
