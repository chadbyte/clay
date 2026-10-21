var test = require('node:test'), assert = require('node:assert/strict');
var client = import('../lib/public/modules/tool-pane-tree.js'), layout = import('../lib/public/modules/split-view-layout-client.js');
test('mixed window trees keep all session and tool identities across moves and closed tools', async function () {
  var api = await client, geometry = await layout, base = geometry.preset(['one', 'two', 'three'], 'balanced');
  var tree = api.workspaceWindowTree(base, null, ['terminal', 'browser', 'file-viewer']);
  assert.equal(new Set(geometry.listIds(tree)).size, 6);
  for (var side of ['left', 'right', 'top', 'bottom', 'center']) {
    var next = api.insertWindow(tree, 'tool-terminal', 'two', side);
    assert.deepEqual(geometry.listIds(next).sort(), geometry.listIds(tree).sort());
    var restored = api.workspaceWindowTree(base, { base: base, tree: next }, ['terminal', 'browser', 'file-viewer']);
    assert.deepEqual(restored, next);
    var closed = api.workspaceWindowTree(base, { base: base, tree: next }, ['browser']);
    assert.deepEqual(geometry.listIds(closed).sort(), ['one', 'two', 'three', 'tool-browser'].sort());
  }
});
test('all eight sessions and three tool windows fit without bypassing the session view limit', async function () {
  var api = await client, geometry = await layout, base = geometry.preset(['a','b','c','d','e','f','g','h'], 'grid');
  var tree = api.workspaceWindowTree(base, null, ['terminal','browser','file-viewer']);
  var next = api.insertWindow(tree, 'tool-browser', 'a', 'top');
  assert.equal(geometry.listIds(next).length, 11);
  assert.equal(Object.keys(geometry.rectangles(next, 1800, 1000).panes).length, 11);
  assert.deepEqual(api.insertWindow(tree, 'tool-browser', 'tool-browser', 'left'), tree);
});
test('changed session layouts retain only accessible current windows and reattach tool slots', async function () {
  var api = await client, geometry = await layout;
  var base = geometry.preset(['one', 'two'], 'columns'), tree = api.workspaceWindowTree(base, null, ['terminal']);
  tree = api.insertWindow(tree, 'tool-terminal', 'one', 'left');
  var replacement = geometry.preset(['three', 'four'], 'rows');
  var next = api.workspaceWindowTree(replacement, { base: base, tree: tree }, ['terminal']);
  assert.deepEqual(geometry.listIds(next).sort(), ['three', 'four', 'tool-terminal'].sort());
});
