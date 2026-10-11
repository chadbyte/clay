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

test('the Projects welcome, setup and list render from actual availability and access', async function () {
  var view = await import(moduleUrl('projects-hub-view'));
  var state = { projectListLoaded: false, homeSurfaceLoaded: true, projectsAccessLoaded: true, connected: true, onboardingStep: 'welcome', projectsHubList: [] };
  assert.match(view.projectsHubContent(state), /Loading your workspace/);
  assert.doesNotMatch(view.projectsHubContent(state), /A place for/);
  state.projectListLoaded = true;
  assert.match(view.projectsHubContent(state), /Set up your first project/);
  state.onboardingStep = 'project';
  var setup = view.projectsHubContent(state);
  assert.match(setup, /data-projects-mode="existing"/);
  assert.match(setup, /data-projects-mode="create"/);
  assert.match(setup, /data-projects-mode="clone"/);
  state.permissions = { createProject: false };
  assert.doesNotMatch(view.projectsHubContent(state), /data-projects-mode/);
  assert.match(view.projectsHubContent(state), /Ask an administrator/);
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
