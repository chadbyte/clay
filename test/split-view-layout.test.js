var test = require('node:test');
var assert = require('node:assert/strict');
var layout = require('../lib/split-view-layout');
var workspace = require('../lib/project-view-workspace');
function view(origins) {
  return { id: 'view-1', name: 'View', revision: 1, layout: 'balanced', tree: layout.createPreset(origins, 'balanced'),
    activeSessionOriginId: origins[0] || null, sessionRefs: origins.map(function (origin) { return { originId: origin, ownerId: 'alice', linuxUser: null }; }) };
}
test('View shape accepts precisely zero through eight sessions with matching tree and active identity', function () {
  for (var count = 0; count <= 8; count++) {
    var origins = Array.from({ length: count }, function (_, i) { return 'origin-' + i; }), candidate = view(origins);
    assert.equal(layout.validateViewShape(candidate).ok, true);
    assert.equal(workspace.validate(workspace.legacy(candidate), candidate).ok, true);
  }
  var empty = view([]); empty.activeSessionOriginId = 'missing'; assert.equal(layout.validateViewShape(empty).ok, false);
  empty.activeSessionOriginId = null; empty.tree = { id: 'missing' }; assert.equal(layout.validateViewShape(empty).ok, false);
  var single = view(['one']); single.tree = null; assert.equal(layout.validateViewShape(single).ok, false);
  single.tree = { id: 'one' }; single.activeSessionOriginId = null; assert.equal(layout.validateViewShape(single).ok, false);
  assert.equal(layout.validateTree({ id: 'one' }, ['one', 'one']).ok, false);
  assert.equal(layout.validateTree([], []).ok, false);
  assert.throws(function () { layout.createPreset(Array.from({ length: 9 }, function (_, i) { return 's' + i; }), 'balanced'); });
});
test('workspace file descriptors use canonical project-relative paths without touching the filesystem', function () {
  ['../secret', '/tmp/secret', './file', 'a//b', 'a/../b', 'a\\b', 'https://host/path', 'file\u0000.txt', '', 'a/'].forEach(function (name) {
    assert.equal(workspace.validFilePath(name), false, name);
  });
  ['src/index.js', 'a space/한국어.md', '.claude/config.json', 'missing-file.md'].forEach(function (name) { assert.equal(workspace.validFilePath(name), true); });
});
