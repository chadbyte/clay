var test = require('node:test'), assert = require('node:assert/strict');
var validator = require('../lib/workbench-window-layout'), workspace = require('../lib/project-view-workspace');
function layout(ids) {
  var base = { id: 'session-one' }, tree = base;
  ids.forEach(function (id) { tree = { axis: 'horizontal', ratio: .5, left: { id: id }, right: tree }; });
  return { key: '["project","owner","session-one"]', base: base, tree: tree };
}
test('every registered workbench and per-file pane accepts display-only saved coordinates', function () {
  var names = ['terminal', 'browser', 'file-viewer'].concat(workspace.workbenchNames).map(function (name) { return 'tool-' + name; });
  names.push('tool-file-pane-11111111-1111-4111-8111-111111111111');
  names.forEach(function (name) { assert.equal(validator.validLayout(layout([name])), true, name); });
  assert.equal(validator.validLayout(layout(names)), true, 'mixed workbenches remain within the shared 24-window bound');
});
test('unknown tools, duplicate windows, missing sessions and oversized trees remain rejected', function () {
  ['tool-unknown', 'tool-file-', 'tool-file-/secret', 'tool-file-' + 'x'.repeat(128)].forEach(function (id) { assert.equal(validator.validLayout(layout([id])), false, id); });
  assert.equal(validator.validLayout(layout(['tool-browser', 'tool-browser'])), false);
  var value = layout(['tool-browser']); value.base = { id: 'foreign-session' };
  assert.equal(validator.validLayout(value), false);
  assert.equal(validator.validLayout(layout(Array.from({ length: 17 }, function (_, i) { return 'tool-file-pane-' + i; }))), false, 'tool count stays within the shared workspace limit');
  assert.equal(validator.validLayout(layout(Array.from({ length: 24 }, function (_, i) { return 'tool-file-pane-' + i; }))), false);
});

test('client docking registry and server coordinate validator agree on every workbench', async function () {
  var client = await import('../lib/public/modules/workbench-panels.js');
  assert.deepEqual(Object.keys(client.WORKBENCH_PANELS).sort(), workspace.workbenchNames.slice().sort());
});
