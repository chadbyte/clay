var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var vm = require('node:vm');

test('an older prepend response preserves the newer entry jump until its passage is loaded', function () {
  var state = { currentSlug: 'project', activeSessionId: 7, historyFrom: 100,
    pendingSessionEntryNavigation: { projectSlug: 'project', sessionId: 7, entryIndex: 20 } };
  var frames = [];
  var requests = [];
  var scrolled = [];
  var target = { dataset: { historyIndexes: '20,21' }, classList: { add: function () {}, remove: function () {} },
    scrollIntoView: function () { scrolled.push(20); } };
  var nodes = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (values) { Object.assign(state, values); } },
    getWs: function () { return { readyState: 1, send: function (raw) { requests.push(JSON.parse(raw)); } }; },
    document: { querySelectorAll: function (selector) { return selector.indexOf('data-history') >= 0 ? nodes : []; } },
    requestAnimationFrame: function (callback) { frames.push(callback); },
    disarmStickyBottom: function () {}, window: {}, setTimeout: function () {},
  };
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/command-palette.js'), 'utf8');
  vm.runInNewContext(source.replace(/^import .*$/gm, '').replace(/export /g, ''), context);
  context.handlePaletteHistoryPrepended();
  frames.shift()();
  assert.ok(state.pendingSessionEntryNavigation, 'the stale page must not clear the newer jump');
  assert.deepEqual(requests, [{ type: 'load_more_history', before: 100, target: 20 }]);
  state.historyFrom = 20;
  nodes = [target];
  context.handlePaletteHistoryPrepended();
  frames.shift()();
  assert.deepEqual(scrolled, [20]);
  assert.equal(state.pendingSessionEntryNavigation, null);
});

test('a prepend animation callback cannot jump after manual session navigation', function () {
  var state = { currentSlug: 'project', activeSessionId: 7, historyFrom: 0,
    pendingSessionEntryNavigation: { projectSlug: 'project', sessionId: 7, entryIndex: 20 } };
  var frame;
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (values) { Object.assign(state, values); } },
    requestAnimationFrame: function (callback) { frame = callback; },
    document: { querySelectorAll: function () { throw new Error('must not inspect another transcript'); } },
  };
  var source = fs.readFileSync(path.join(__dirname, '../lib/public/modules/command-palette.js'), 'utf8');
  vm.runInNewContext(source.replace(/^import .*$/gm, '').replace(/export /g, ''), context);
  context.handlePaletteHistoryPrepended();
  state.activeSessionId = 8;
  frame();
  assert.equal(state.pendingSessionEntryNavigation, null);
});
