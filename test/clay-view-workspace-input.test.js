var test = require('node:test'), assert = require('node:assert/strict');
var input = require('../lib/clay-split-view-input'), workspace = require('../lib/clay-view-workspace-input');
var empty = { version: 1, panes: [], tree: null, activePaneId: null };
function operation() { return { action: 'split_view', change: 'create', viewerRef: 'window', projectSlug: 'project', accountId: 'owner', expectedRevision: 1, name: 'Empty', layout: 'columns', sessionOrigins: [], activeSessionOriginId: null, tree: null, workspace: empty }; }
test('typed canonical composition supports empty and single sessions with exact bounded identities', function () {
  assert.equal(input.operationSchema.safeParse(operation()).success, true);
  var single = Object.assign(operation(), { workspace: undefined, sessionOrigins: ['a'], activeSessionOriginId: 'a', tree: { id: 'a' } });
  assert.equal(input.operationSchema.safeParse(single).success, true);
  assert.equal(input.operationSchema.safeParse(Object.assign(operation(), { accountId: undefined })).success, false);
  assert.equal(input.operationSchema.safeParse(Object.assign(operation(), { workspace: Object.assign({}, empty, { version: 2 }) })).success, false);
  var tree = { id: 'a' }; for (var i = 0; i < 25; i++) tree = { axis: 'horizontal', ratio: .5, left: tree, right: { id: 'b' } };
  assert.equal(input.operationSchema.safeParse(Object.assign(single, { tree: tree })).success, false);
});
test('canonical workspace changes reject new/foreign resources and stale atomic move target', function () {
  var file = { instanceId: 'file', kind: 'file', open: true, placement: 'docked', resource: { path: 'docs/a.md', mode: 'pin', rendered: true } };
  var value = { version: 1, panes: [file], tree: { id: 'file' }, activePaneId: 'file' }, view = { id: 'target', revision: 2, workspace: value };
  var op = Object.assign(operation(), { workspace: value });
  assert.throws(function () { workspace.validateOperation(op, { views: [] }, null); }, /resources/);
  assert.doesNotThrow(function () { workspace.validateOperation(op, { views: [view] }, view); });
  var foreign = JSON.parse(JSON.stringify(value)); foreign.panes[0].resource.path = 'foreign.md';
  assert.throws(function () { workspace.validateOperation(Object.assign({}, op, { workspace: foreign }), { views: [view] }, view); }, /resources/);
  assert.throws(function () { workspace.validateOperation({ change: 'move', targetViewId: 'target', expectedTargetViewRevision: 1 }, { views: [view] }, view); }, /revision/);
});
test('workspace review describes exact readable binding targets and bounded deltas', function () {
  var panes = []; for (var i = 0; i < 8; i++) panes.push({ instanceId: 'file-' + i, kind: 'file', open: false, placement: 'overlay', resource: { path: 'docs/' + 'long'.repeat(10) + i + '.md', mode: 'follow', rendered: true } });
  var prior = { version: 1, panes: panes, tree: null, activePaneId: null }, next = JSON.parse(JSON.stringify(prior)); next.panes.forEach(function (p) { p.resource.mode = 'pin'; });
  var op = Object.assign(operation(), { workspace: next }); assert.ok(JSON.stringify(op).length > 1500);
  var review = workspace.reviewText(op, { workspace: prior }); assert.ok(review.length < 1800); assert.match(review, /file-7/); assert.match(review, /pin/); assert.match(review, /docs\//);
});

test('canonical reviewed workspace edits include registered workbenches without arbitrary panel dispatch', function () {
  var pane = { instanceId: 'logs', kind: 'workbench', open: true, placement: 'docked', resource: { name: 'project-logs' } };
  var value = { version: 1, panes: [pane], tree: { id: 'logs' }, activePaneId: 'logs' };
  var view = { id: 'target', revision: 2, workspace: value }, op = Object.assign(operation(), { workspace: value });
  assert.equal(input.operationSchema.safeParse(op).success, true);
  assert.doesNotThrow(function () { workspace.validateOperation(op, { views: [] }, null); });
  assert.doesNotThrow(function () { workspace.validateOperation(op, { views: [view] }, view); });
  var changed = JSON.parse(JSON.stringify(value)); changed.panes[0].resource.name = 'scheduled-tasks';
  assert.throws(function () { workspace.validateOperation(Object.assign({}, op, { workspace: changed }), { views: [view] }, view); }, /resources|identity|binding/i);
  changed.panes[0].resource.name = 'settings';
  assert.equal(input.operationSchema.safeParse(Object.assign({}, op, { workspace: changed })).success, false);
});
