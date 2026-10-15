var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
function fixture() {
  var historyIndexes = [];
  var currentMsgEl = { dataset: {}, querySelector: function () { return {}; } };
  var state = { currentMsgEl: currentMsgEl, currentFullText: '' };
  var frames = new Map(), nextId = 1, rendered = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); }, snap: function () { return state; } },
    requestAnimationFrame: function (fn) { var id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: function (id) { frames.delete(id); },
    setTimeout: function () { return 1; }, clearTimeout: function () {},
    renderAssistantBubbleText: function (el, text) { rendered.push(text); },
    scrollToBottom: function () {}, enhanceAssistantBubble: function () {},
    addHistoryIndex: function (el, historyIndex) {
      var indexes = Array.isArray(historyIndex) ? historyIndex : [historyIndex];
      indexes.forEach(function (index) {
        if (!Number.isSafeInteger(index) || index < 0) return;
        if (historyIndexes.indexOf(index) === -1) historyIndexes.push(index);
      });
      el.dataset.historyIndexes = historyIndexes.join(',');
    },
  };
  var source = fs.readFileSync('lib/public/modules/app-rendering.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replace(/export /g, '');
  vm.runInNewContext(source, context);
  return { state: state, context: context, frames: frames, rendered: rendered, historyIndexes: historyIndexes, frame: function () {
    var pending = Array.from(frames.values()); frames.clear(); pending.forEach(function (fn) { fn(); });
  } };
}
test('one visible frame catches up every delta accumulated while frames were suspended', function () {
  var f = fixture(), expected = '';
  for (var i = 0; i < 2000; i++) { var text = 'chunk ' + i + '\n'; expected += text; f.context.appendDelta(text); }
  assert.equal(f.frames.size, 1);
  f.frame();
  assert.equal(f.state.currentFullText, expected);
  assert.deepEqual(f.rendered, [expected]);
  assert.equal(f.frames.size, 0);
  f.context.appendDelta('latest'); f.frame();
  assert.equal(f.state.currentFullText, expected + 'latest');
});
test('history snapshots accumulate without animated frames and render when finalized', function () {
  var f = fixture(); f.state.replayingHistory = true; f.state.currentHistoryIndex = 16466;
  f.context.appendDelta('first'); f.context.appendDelta(' latest');
  assert.equal(f.frames.size, 0); assert.equal(f.state.currentFullText, 'first latest');
  assert.deepEqual(f.historyIndexes, [16466], 'history replay attributes the assistant block to its cited entry');
  f.context.flushStreamBuffer(); assert.deepEqual(f.rendered, ['first latest']);
});
test('batched history attributes all cited token indexes to the assistant block', function () {
  var f = fixture();
  f.state.replayingHistory = true;
  f.state.currentHistoryIndexes = [16466, 16467];
  f.context.appendDelta('batched answer');
  assert.deepEqual(f.historyIndexes, [16466, 16467]);
});
test('session snapshot reset discards old pending text and frame callbacks', function () {
  var f = fixture(); f.context.appendDelta('old'); f.context.resetStreamBuffer();
  f.state.currentFullText = ''; f.context.appendDelta('new'); f.frame();
  assert.deepEqual(f.rendered, ['new']); assert.equal(f.frames.size, 0);
});

test('provider activity phases reuse neutral shared shimmer and clean up across transitions', function () {
  var css = fs.readFileSync('lib/public/css/messages.css', 'utf8');
  var shimmer = css.match(/\.thinking-live \.thinking-label,\s*\.activity-inline \.activity-text\.activity-state-label \{([^}]+)\}/);
  assert.ok(shimmer, 'phase labels share the real thinking-summary shimmer rule');
  assert.match(shimmer[1], /var\(--text-muted\)/);
  assert.match(shimmer[1], /animation: thinking-summary-shimmer/);
  assert.match(css, /prefers-reduced-motion: reduce[\s\S]*?\.activity-text\.activity-state-label \{[^}]*animation: none;[^}]*-webkit-text-fill-color: currentColor;/);
  ['claude', 'codex', 'muse'].forEach(function (vendor) {
    var client = require('./helpers/project-stream-client.cjs').create();
    client.context.store.set({ currentVendor: vendor });
    var labels = { waiting: 'Waiting for provider', running: 'Working', background: 'Background work pending' };
    var row;
    Object.keys(labels).forEach(function (phase) {
      client.context.setActivity(phase);
      var current = client.context.getActivityEl();
      if (row) assert.equal(current, row, 'phase transitions retain the same activity row');
      row = current;
      assert.ok(row.classList.contains('activity-inline'));
      var label = row.querySelector('.activity-state-label');
      assert.ok(label.classList.contains('activity-text'));
      assert.equal(label.textContent, labels[phase]);
      assert.equal(row.querySelectorAll('.activity-text').length, 1);
    });
    client.context.setActivity('thinking');
    assert.equal(row.querySelector('.activity-state-label'), null, 'legacy activity removes the phase label');
    client.context.setActivity('waiting');
    client.context.setActivity(null);
    assert.equal(client.context.getActivityEl(), null);
    assert.equal(row.parentNode, null);
    assert.deepEqual(client.errors, []);
  });
});
