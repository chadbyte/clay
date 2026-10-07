var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

function source(name) {
  return fs.readFileSync(path.join(__dirname, '../lib/public/modules/', name + '.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/^export \{.*$/gm, '').replace(/export function /g, 'function ');
}
function fixture() {
  var state = { currentSlug: 'one', myUserId: 'owner', basePath: '/p/one/', skillsUi: {
    activeTab: 'installed', currentView: 'list', installedSkills: {}, skillsData: {}, searchCache: {}, searchQuery: '', discoverySort: 'all'
  } };
  var element = { classList: { toggle: function () {} }, setAttribute: function () {}, querySelector: function () { return element; }, querySelectorAll: function () { return []; }, focus: function () {}, value: '' };
  var requests = [], rendered = [];
  var context = vm.createContext({
    document: { getElementById: function () { return element; } },
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); } },
    fetch: function (url) { return new Promise(function (resolve, reject) { requests.push({ url: url, resolve: function (value) { resolve({ ok: true, json: function () { return Promise.resolve(value); } }); }, reject: reject }); }); },
    renderSkillList: function (rows) { rendered.push({ kind: 'list', rows: rows }); },
    renderSkillFeedback: function (message) { rendered.push({ kind: 'feedback', message: message }); },
    renderDetail: function (data) { rendered.push({ kind: 'detail', data: data }); },
    clearTimeout: clearTimeout
  });
  vm.runInContext(source('skills-state') + '\n' + source('skills'), context);
  return { context: context, state: state, requests: requests, rendered: rendered, element: element };
}
function settle() { return new Promise(function (resolve) { setImmediate(resolve); }); }

test('Skills ignores an inventory response after switching to Discover', async function () {
  var f = fixture(); f.context.loadList(); f.context.selectTab('discover');
  assert.equal(f.requests[0].url, '/p/one/api/installed-skills');
  f.requests[1].resolve({ skills: [{ name: 'Latest' }] }); await settle();
  f.requests[0].resolve({ installed: { stale: { scope: 'global' } } }); await settle();
  assert.equal(f.rendered.at(-1).rows[0].name, 'Latest');
  assert.equal(f.state.skillsUi.installedSkills.stale, undefined);
});
test('Skills ignores detail responses after returning to the library', async function () {
  var f = fixture(); f.state.skillsUi.inventoryLoaded = true;
  f.context.openSkill({ name: 'Example', source: 'team/skills' }, false); f.context.showList();
  f.requests[0].resolve({ name: 'Stale detail' }); await settle();
  assert.equal(f.rendered.at(-1).kind, 'list');
});
test('Skills ignores inventory responses from a previous project', async function () {
  var f = fixture(); f.context.loadList(); f.state.currentSlug = 'two';
  f.requests[0].resolve({ installed: { private: { scope: 'project' } } }); await settle();
  assert.equal(f.state.skillsUi.installedSkills.private, undefined);
});
test('Skills latest search wins when responses arrive out of order', async function () {
  var f = fixture(); Object.assign(f.state.skillsUi, { activeTab: 'discover', searchQuery: 'old' });
  f.context.loadList(); f.state.skillsUi.searchQuery = 'new'; f.context.loadList();
  f.requests[1].resolve({ skills: [{ name: 'New result' }] }); await settle();
  f.requests[0].resolve({ skills: [{ name: 'Old result' }] }); await settle();
  assert.equal(f.rendered.at(-1).rows[0].name, 'New result');
});
test('Installed search matches descriptions and escapes untrusted skill names', function () {
  var f = fixture(); Object.assign(f.state.skillsUi, { searchQuery: 'interface', installedSkills: {
    '<img onerror=bad()>': { scope: 'project', description: 'Create interfaces' }, unrelated: { scope: 'global', description: 'Write releases' }
  } });
  f.context.escapeHtml = function (value) { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); };
  f.context.iconHtml = function () { return ''; }; f.context.refreshIcons = function () {};
  vm.runInContext(source('skills-list-view'), f.context);
  f.context.renderSkillList([], function () {}, function () {});
  assert.match(f.element.innerHTML, /&lt;img onerror=bad\(\)&gt;/);
  assert.doesNotMatch(f.element.innerHTML, /unrelated|<img/);
});

test('Opening a skill cancels a pending debounced search', function () {
  var f = fixture(), cancelled;
  f.state.skillsUi.searchTimer = 42;
  f.context.clearTimeout = function (timer) { cancelled = timer; };
  f.context.openSkill({ name: 'Example', source: 'team/skills' }, false);
  assert.equal(cancelled, 42);
  assert.equal(f.state.skillsUi.currentView, 'detail');
});
