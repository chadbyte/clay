var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
test('superseded folder animation cannot reverse a newer chevron click', function () {
  var state = { sessionFolderCollapseAnimations: { 'desktop:f': { token: 'new' } } }, attributes = {}, classes = new Set();
  var root = { isConnected: true, classList: { toggle: function (key, on) { if (on) classes.add(key); else classes.delete(key); } } };
  var body = { hidden: false, style: {}, inert: false, contains: function () { return false; }, getAnimations: function () { return []; },
    classList: { remove: function () {} }, setAttribute: function (key, value) { attributes[key] = value; }, removeAttribute: function (key) { delete attributes[key]; } };
  var toggle = { setAttribute: function (key, value) { attributes[key] = value; } };
  var api = vm.createContext({ store: { get: function (key) { return state[key]; }, set: function (change) { Object.assign(state, change); } }, document: { activeElement: null } });
  vm.runInContext(fs.readFileSync('lib/public/modules/session-folder-collapse.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), api);
  api.finish('desktop:f', 'old', root, body, toggle, false);
  assert.equal(body.hidden, false); assert.equal(state.sessionFolderCollapseAnimations['desktop:f'].token, 'new');
  api.finish('desktop:f', 'new', root, body, toggle, true);
  assert.equal(body.hidden, false); assert.equal(attributes['aria-expanded'], 'true'); assert.equal(state.sessionFolderCollapseAnimations['desktop:f'], undefined);
});
