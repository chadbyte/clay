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
    pendingSessionEntryNavigation: { projectSlug: 'project', sessionId: 7, entryIndex: 20, awaitingTarget: true } };
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

test('cross-project citation waits for initial identity and passage without a duplicate session replay', function () {
  var state = { currentSlug: 'beta', activeSessionId: null, historyFrom: 0 };
  var frames = [], selected = [], scrolled = [], nodes = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (next) { Object.assign(state, next); } },
    document: { querySelectorAll: function (selector) { return selector.indexOf('data-history') >= 0 ? nodes : []; } },
    requestAnimationFrame: function (callback) { frames.push(callback); }, disarmStickyBottom: function () {},
    window: {}, setTimeout: function () {},
  };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/command-palette.js'), 'utf8').replace(/^import .*$/gm, '').replace(/export /g, ''), context);
  context.ctx = { currentSlug: function () { return 'beta'; }, selectSession: function (id) { selected.push(id); } };
  context.pendingNav = { slug: 'beta', sessionId: 2, entryIndex: 0 };
  context.handlePaletteSessionSwitch();
  assert.ok(context.pendingNav, 'session_list cannot consume navigation before initial session_switched');
  assert.deepEqual(selected, []);
  state.activeSessionId = 1;
  context.handlePaletteSessionSwitch();
  assert.ok(context.pendingNav, 'session_list with a previous session ID cannot request a premature switch');
  assert.deepEqual(selected, []);
  state.activeSessionId = 2;
  context.handlePaletteSessionSwitch(true);
  while (frames.length) frames.shift()();
  assert.ok(state.pendingSessionEntryNavigation, 'an early paint with no passage cannot consume the jump');
  assert.deepEqual(selected, [], 'the connection already selected the intended destination');
  nodes = [{ dataset: { historyIndexes: '0' }, classList: { add: function () {}, remove: function () {} }, scrollIntoView: function () { scrolled.push(0); } }];
  context.handlePaletteHistoryDone();
  assert.deepEqual(scrolled, [0]); assert.equal(state.pendingSessionEntryNavigation, null);
});


test('entry feedback survives exact-origin replay only within its original lifetime', function () {
  var state = { currentSlug: 'project', activeSessionId: 7, sessionOriginId: 'origin-seven', historyFrom: 0,
    pendingSessionEntryNavigation: { projectSlug: 'project', sessionId: 7, entryIndex: 0 } };
  var now = 1000, scrolled = [], targets = [], timers = [];
  function target(name) {
    return { dataset: { historyIndexes: '0' }, classList: { add: function () {}, remove: function () {} },
      scrollIntoView: function () { scrolled.push(name); } };
  }
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (next) { Object.assign(state, next); } },
    document: { querySelectorAll: function (selector) { return selector.indexOf('data-history') >= 0 ? targets : []; } },
    disarmStickyBottom: function () {}, window: {}, Date: { now: function () { return now; } },
    setTimeout: function (callback, delay) { timers.push({ callback: callback, delay: delay }); },
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/public/modules/command-palette.js'), 'utf8')
    .replace(/^import .*$/gm, '').replace(/export /g, ''), context);
  targets = [target('first')]; context.handlePaletteHistoryDone();
  assert.equal(state.pendingSessionEntryNavigation, null);
  var receipt = state.sessionEntryHighlight;
  now += 100; targets = [target('replayed')]; context.handlePaletteHistoryDone();
  assert.deepEqual(scrolled, ['first', 'replayed']);
  assert.equal(state.sessionEntryHighlight, receipt);
  assert.equal(timers[1].delay, 1700, 'replay cannot extend feedback lifetime');
  state.sessionOriginId = 'replacement'; context.handlePaletteHistoryDone();
  assert.equal(scrolled.length, 2, 'replaced local IDs cannot inherit feedback');
  state.sessionOriginId = 'origin-seven'; now = receipt.expiresAt; context.handlePaletteHistoryDone();
  assert.equal(scrolled.length, 2, 'expired feedback cannot resume');
  now = 1100; state.activeSessionId = 8; context.handlePaletteSessionSwitch();
  assert.equal(state.sessionEntryHighlight, null, 'manual navigation cancels the retained target');
  state.activeSessionId = 7;
  state.pendingSessionEntryNavigation = { projectSlug: 'project', sessionId: 7, entryIndex: 0 };
  context.handlePaletteHistoryDone();
  var newer = state.sessionEntryHighlight;
  timers[1].callback();
  assert.equal(state.sessionEntryHighlight, newer, 'an old feedback timer cannot clear a newer jump on the same element');
});
