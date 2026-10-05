var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
function fixture() {
  var state = { currentSlug: 'project', myUserId: 'owner', connected: true }, listeners = [], nodes = {}, renders = 0;
  var store = { get: function (key) { return state[key]; }, set: function (change) { var before = state; state = Object.assign({}, state, change); listeners.forEach(function (listener) { listener(state, before); }); }, subscribe: function (listener) { listeners.push(listener); } };
  function element() {
    var classes = new Set();
    return { classList: { add: function (name) { classes.add(name); }, remove: function (name) { classes.delete(name); }, contains: function (name) { return classes.has(name); } },
      setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return { addEventListener: function () {}, focus: function () {} }; } };
  }
  nodes['main-panels'] = { appendChild: function (node) { nodes[node.id] = node; } };
  var document = { getElementById: function (id) { return nodes[id]; }, createElement: element, addEventListener: function () {} };
  var socket = { readyState: 1 };
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/linear-panel.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  var module = new Function('store', 'document', 'getWs', 'registerRightWorkbench', 'releaseRightWorkbench', 'refreshIcons', source + '\nreturn { init: initLinearPanel, handle: handleLinearResult };')(store, document, function () { return socket; }, function () {}, function () {}, function () {});
  module.init();
  return { store: store, module: module, socket: socket, nodes: nodes };
}
test('Linear workbench clears pending private details on project, account or connection changes', function () {
  [{ currentSlug: 'other' }, { myUserId: 'other' }, { connected: false }].forEach(function (change) {
    var f = fixture(); f.store.set({ linearOpen: true, linearIssue: { title: 'Private' }, linearRequest: { id: 'pending' }, linearMatches: [{ sessionId: 1 }] });
    f.store.set(change);
    assert.equal(f.store.get('linearOpen'), false); assert.equal(f.store.get('linearIssue'), null); assert.equal(f.store.get('linearRequest'), null);
    assert.deepEqual(f.store.get('linearMatches'), []); assert.equal(f.nodes['linear-panel'].classList.contains('hidden'), true);
  });
});
test('late detail replies for a different project or request cannot change the visible issue', function () {
  var f = fixture(), original = { title: 'Current' };
  f.store.set({ linearOpen: true, linearIssue: original, linearRequest: { id: 'current', project: 'project', socket: f.socket } });
  f.module.handle({ requestId: 'old', projectSlug: 'project', action: 'linear_read', result: { issue: { title: 'Old' } } });
  f.module.handle({ requestId: 'current', projectSlug: 'other', action: 'linear_read', result: { issue: { title: 'Other' } } });
  assert.equal(f.store.get('linearIssue'), original);
});
