var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
function fixture() {
  var state = { currentMsgEl: { querySelector: function () { return {}; } }, currentFullText: '' };
  var frames = new Map(), nextId = 1, rendered = [];
  var context = {
    store: { get: function (key) { return state[key]; }, set: function (patch) { Object.assign(state, patch); }, snap: function () { return state; } },
    requestAnimationFrame: function (fn) { var id = nextId++; frames.set(id, fn); return id; },
    cancelAnimationFrame: function (id) { frames.delete(id); },
    setTimeout: function () { return 1; }, clearTimeout: function () {},
    renderAssistantBubbleText: function (el, text) { rendered.push(text); },
    scrollToBottom: function () {}, enhanceAssistantBubble: function () {},
  };
  var source = fs.readFileSync('lib/public/modules/app-rendering.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export \{.*;\n/gm, '').replace(/export /g, '');
  vm.runInNewContext(source, context);
  return { state: state, context: context, frames: frames, rendered: rendered, frame: function () {
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
  var f = fixture(); f.state.replayingHistory = true;
  f.context.appendDelta('first'); f.context.appendDelta(' latest');
  assert.equal(f.frames.size, 0); assert.equal(f.state.currentFullText, 'first latest');
  f.context.flushStreamBuffer(); assert.deepEqual(f.rendered, ['first latest']);
});
test('session snapshot reset discards old pending text and frame callbacks', function () {
  var f = fixture(); f.context.appendDelta('old'); f.context.resetStreamBuffer();
  f.state.currentFullText = ''; f.context.appendDelta('new'); f.frame();
  assert.deepEqual(f.rendered, ['new']); assert.equal(f.frames.size, 0);
});
