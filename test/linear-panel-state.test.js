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
      setAttribute: function () {}, addEventListener: function () {}, querySelector: function () { return { setAttribute: function () {}, removeAttribute: function () {}, addEventListener: function () {}, focus: function () {} }; } };
  }
  nodes['main-panels'] = { appendChild: function (node) { nodes[node.id] = node; } };
  var document = { getElementById: function (id) { return nodes[id]; }, createElement: element, addEventListener: function () {} };
  var socket = { readyState: 1 };
  var header = { hidden: true, attrs: {}, setAttribute: function (key, value) { this.attrs[key] = value; }, removeAttribute: function (key) { delete this.attrs[key]; } };
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/linear-panel.js'), 'utf8').replace(/^import .*;\n/gm, '').replace(/export /g, '');
  var module = new Function('store', 'document', 'getWs', 'registerRightWorkbench', 'releaseRightWorkbench', 'refreshIcons', 'linearIconMarkup', source + '\nreturn { init: initLinearPanel, handle: handleLinearResult, header: updateExternalLink, close: closeLinear, comments: chronologicalComments };')(store, document, function () { return socket; }, function () {}, function () {}, function () {}, function () { return '<svg></svg>'; });
  module.init();
  var titleNode = {}, idNode = {};
  var originalQuery = nodes['linear-panel'].querySelector;
  nodes['linear-panel'].querySelector = function (selector) { return selector === '[data-linear-external]' ? header : selector === '[data-linear-window-title]' ? titleNode : selector === '[data-linear-window-id]' ? idNode : originalQuery(selector); };
  return { store: store, module: module, socket: socket, nodes: nodes, header: header, titleNode: titleNode, idNode: idNode };
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
test('Linear workbench has no manual search form, Connection button or back-to-search UI', function () {
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/linear-panel.js'), 'utf8');
  ['<form', '<input', 'data-linear-settings', 'data-linear-back', "'linear_search'", 'linear-search'].forEach(function (needle) { assert.equal(source.indexOf(needle), -1, needle); });
  assert.match(source, /FORBID_ATTR: \['id', 'style'\]/);
  assert.match(source, /SAFE_CLASS/);
});

test('Linear titlebar link accepts only issue URLs and clears on close or empty state', function () {
  var f = fixture();
  f.module.header({ url: 'https://linear.app/acme/issue/ACM-1' });
  assert.equal(f.header.hidden, false);
  assert.equal(f.header.attrs.href, 'https://linear.app/acme/issue/ACM-1');
  f.module.header(null);
  assert.equal(f.header.hidden, true);
  assert.equal(f.header.attrs.href, undefined);
  f.module.header({ url: 'javascript:alert(1)' });
  assert.equal(f.header.hidden, true);
  assert.equal(f.header.attrs.href, undefined);
  f.module.header({ url: 'https://linear.app/acme/issue/ACM-2' });
  f.module.close();
  assert.equal(f.header.hidden, true);
  assert.equal(f.header.attrs.href, undefined);
});

test('Linear window header updates the identifier and title and clears previous issue text', function () {
  var f = fixture();
  f.module.header({ identifier: 'ACM-1', title: 'First issue', url: 'https://linear.app/acme/issue/ACM-1' });
  assert.equal(f.idNode.textContent, 'ACM-1');
  assert.equal(f.titleNode.textContent, 'First issue');
  f.module.header({ identifier: 'ACM-2', title: '<b>Literal title</b>', url: 'https://linear.app/acme/issue/ACM-2' });
  assert.equal(f.idNode.textContent, 'ACM-2');
  assert.equal(f.titleNode.textContent, '<b>Literal title</b>');
  f.module.header(null);
  assert.equal(f.idNode.textContent, '');
  assert.equal(f.titleNode.textContent, 'Linear');
});

test('Linear comments render oldest first across merged pages without mutating stored order', function () {
  var f = fixture();
  var comments = [
    { id: 'new', createdAt: '2026-10-06T02:00:00Z' },
    { id: 'old', createdAt: '2026-10-01T02:00:00Z' },
    { id: 'middle', createdAt: '2026-10-04T02:00:00Z' }
  ];
  assert.deepEqual(f.module.comments(comments).map(function (c) { return c.id; }), ['old', 'middle', 'new']);
  assert.equal(comments[0].id, 'new');
  assert.deepEqual(f.module.comments(null), []);
});
