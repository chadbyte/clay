var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

test('geometry fixture opens the exact saved view through its actionable button', function () {
  var source = fs.readFileSync(path.join(__dirname, 'fixtures/split-view-geometry-browser.js'), 'utf8');
  var helper = source.match(/function open\(id\) \{[\s\S]*?\n\}/);
  assert.ok(helper, 'Fixture open helper exists');
  var clicks = [];
  function row(id) {
    return { dataset: { splitViewId: id }, querySelector: function (selector) {
      if (selector === '.split-view-group-open') return { click: function () { clicks.push(id); } };
      if (selector === '.split-view-group-heading') return { click: function () { throw new Error('Heading is not an actionable open button'); } };
      throw new Error('Unexpected selector: ' + selector);
    } };
  }
  var context = vm.createContext({ assert: function (value, message) { assert.ok(value, message); },
    document: { querySelectorAll: function (selector) { assert.equal(selector, '.split-view-group'); return [row('A'), row('B')]; } } });
  vm.runInContext(helper[0], context);
  context.open('B'); context.open('A');
  assert.deepEqual(clicks, ['B', 'A']);
  assert.throws(function () { context.open('missing'); }, /Saved view row missing/);
  assert.deepEqual(clicks, ['B', 'A']);
});
