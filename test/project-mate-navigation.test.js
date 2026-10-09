var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');
var root = path.join(__dirname, '..');

function filterFunctions() {
  var source = fs.readFileSync(path.join(root, 'lib/public/modules/project-mate-navigation.js'), 'utf8');
  var start = source.indexOf('var FILTER_MODES');
  var end = source.indexOf('function applyProjectMateFilter');
  var context = {};
  vm.runInNewContext(source.slice(start, end).replace(/export function/g, 'function'), context);
  return context;
}

test('project and Mate filter cycles clockwise without resetting its accumulated rotation', function () {
  var filter = filterFunctions();
  var state = { mode: 'all', turns: 0 };
  var expected = ['projects', 'mates', 'all', 'projects', 'mates', 'all'];
  for (var i = 0; i < expected.length; i++) {
    state = filter.advanceProjectMateFilter(state.mode, state.turns);
    assert.equal(state.mode, expected[i]);
    assert.equal(state.turns, i + 1);
  }
  assert.equal(state.turns * 120, 720);
  assert.equal(filter.normalizeProjectMateFilterMode('invalid'), 'all');
});

test('project and Mate filter keeps a growing scroll region between fixed rail controls', function () {
  var css = fs.readFileSync(path.join(root, 'lib/public/css/icon-strip.css'), 'utf8');
  var html = fs.readFileSync(path.join(root, 'lib/public/index.html'), 'utf8');
  var app = fs.readFileSync(path.join(root, 'lib/public/app.js'), 'utf8');
  var navigation = fs.readFileSync(path.join(root, 'lib/public/modules/project-mate-navigation.js'), 'utf8');
  var mateSection = css.match(/\.icon-strip-mate-section\s*\{([^}]*)\}/);
  assert.match(css, /\.icon-strip-projects\s*\{[^}]*flex:\s*1 1 0;[^}]*min-height:\s*0;[^}]*overflow-y:\s*auto;/s);
  assert.ok(mateSection);
  assert.match(mateSection[1], /flex:\s*0 0 auto/);
  assert.doesNotMatch(mateSection[1], /position:\s*absolute/);
  assert.ok(html.indexOf('id="icon-strip-add"') < html.indexOf('id="icon-strip-mate-section"'));
  assert.match(css, /@media \(max-width: 768px\)[\s\S]*#icon-strip\s*\{\s*display:\s*none;/);
  assert.match(app, /projectMateFilterActivated:\s*false/);
  assert.doesNotMatch(navigation, /var filterActivated/);
  assert.match(navigation, /store\.get\('projectMateFilterActivated'\)/);
});

test('project-level Mates include non-favorites and exclude archived identities', function () {
  var source = fs.readFileSync(path.join(root, 'lib/public/modules/project-mate-navigation.js'), 'utf8');
  var context = {};
  vm.runInNewContext(source.slice(source.indexOf('export function navigationMates'), source.indexOf('export function isMateWorkspace')).replace('export function', 'function'), context);
  var mates = [{ id: 'ordinary', createdAt: 1 }, { id: 'archived', archived: true }, null, { id: 'clay', builtinKey: 'clay', createdAt: 2 }];
  assert.equal(JSON.stringify(context.navigationMates(mates).map(function (mate) { return mate.id; })), '["clay","ordinary"]');
  assert.equal(mates[0].id, 'ordinary');
});

function workspaceNavigation(state) {
  var source = fs.readFileSync(path.join(root, 'lib/public/modules/project-mate-navigation.js'), 'utf8');
  var calls = [];
  var context = {
    store: { get: function (key) { return state[key]; } },
    closeTerminal: function () { calls.push('terminal'); },
    closeFileViewer: function () { calls.push('files'); },
    switchProject: function (slug) { calls.push(slug); state.currentSlug = slug; }
  };
  vm.runInNewContext(source.slice(source.indexOf('export function navigationMates'), source.indexOf('function createMateIcon')).replace(/export function/g, 'function'), context);
  return { context: context, calls: calls };
}

test('Mate navigation uses its project and closes the previous filesystem panels only when switching', function () {
  var state = { currentSlug: 'ordinary', cachedMatesList: [{ id: 'designer' }, { id: 'archived', archived: true }] };
  var harness = workspaceNavigation(state);
  harness.context.openMateWorkspace('designer');
  assert.deepEqual(harness.calls, ['terminal', 'files', 'mate-designer']);
  harness.context.openMateWorkspace('designer');
  assert.deepEqual(harness.calls, ['terminal', 'files', 'mate-designer', 'mate-designer']);
  harness.context.openMateWorkspace('archived');
  harness.context.openMateWorkspace('missing');
  assert.equal(harness.calls.length, 4);
});

test('Mate workspace detection supports project metadata before identities load without matching ordinary projects', function () {
  var harness = workspaceNavigation({});
  assert.equal(harness.context.isMateWorkspace({ currentSlug: 'mate-designer', projectsHubList: [{ slug: 'mate-designer', isMate: true }] }), true);
  assert.equal(harness.context.isMateWorkspace({ currentSlug: 'mate-designer', cachedMatesList: [{ id: 'designer' }] }), true);
  assert.equal(harness.context.isMateWorkspace({ currentSlug: 'mate-sample', projectsHubList: [{ slug: 'mate-sample', isMate: false }] }), false);
  assert.equal(harness.context.isMateWorkspace({ currentSlug: 'ordinary', cachedMatesList: [{ id: 'designer' }] }), false);
});

test('rail add choice routes Mate creation through project chat and preserves the existing project modal', function () {
  var html = fs.readFileSync(path.join(root, 'lib/public/index.html'), 'utf8');
  var sidebar = fs.readFileSync(path.join(root, 'lib/public/modules/sidebar-projects.js'), 'utf8');
  var workspace = fs.readFileSync(path.join(root, 'lib/public/modules/project-mate-creation-workspace.js'), 'utf8');
  assert.match(html, /id="icon-strip-add"[^>]*aria-label="Add a Mate or project"[^>]*aria-haspopup="dialog"/);
  assert.match(sidebar, /openProjectCreateChoice\(addBtn,[\s\S]*openAddProjectModal\(\)/);
  assert.match(workspace, /openMateWorkspace\(clay\.id\)/);
  assert.match(workspace, /type: 'home_mate_creation_plan'/);
  assert.match(workspace, /type: 'switch_session', id: msg\.localId/);
  assert.match(workspace, /type: 'home_mate_session_open'/);
  assert.doesNotMatch(workspace, /showHomeHub|home-hub/);
});
