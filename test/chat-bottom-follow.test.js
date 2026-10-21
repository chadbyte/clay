var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var state = {}, frames = [], handlers = {}, observer;
  var messages = { scrollTop: 400, scrollHeight: 800, clientHeight: 400, children: [], addEventListener: function (name, fn) { handlers[name] = fn; } };
  var context = vm.createContext({ store: { get: function (key) { return state[key]; }, set: function (change) { Object.assign(state, change); } },
    getMessagesEl: function () { return messages; }, getProjectAssistantPlaceholder: function () { return ''; },
    document: { getElementById: function () { return null; }, addEventListener: function () {} },
    ResizeObserver: function (callback) { observer = callback; this.observe = function () {}; },
    requestAnimationFrame: function (fn) { frames.push(fn); }, setTimeout: function () { return 1; }, clearTimeout: function () {} });
  vm.runInContext(fs.readFileSync('lib/public/modules/chat-render-runtime.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  return { api: context, messages: messages, state: state, input: handlers, resize: function () { observer(); }, frame: function () { frames.splice(0).forEach(function (fn) { fn(); }); } };
}
test('sent turn remains fully followed through large streamed growth and composer resize; manual scroll cancels it', function () {
  var f = fixture();
  f.state.paneLayoutScrollLock = { token: 'old-layout', scrollTop: 400 };
  f.api.forceScrollToBottom();
  assert.equal(f.state.paneLayoutScrollLock, null);
  f.messages.scrollHeight = 1500;
  f.api.scrollToBottom(); f.frame();
  assert.equal(f.messages.scrollTop, 1500, 'large first update must not be mistaken for user scrolling');
  f.messages.clientHeight = 200; f.messages.scrollHeight = 1700; f.resize();
  assert.equal(f.messages.scrollTop, 1700, 'composer resize retains the tail');
  f.input.wheel(); f.messages.scrollTop = 250; f.messages.scrollHeight = 1900;
  f.api.scrollToBottom(); f.frame();
  assert.equal(f.messages.scrollTop, 250, 'reading earlier messages remains under user control');
});
test('history replay and prepend do not force a new landing', function () {
  var f = fixture(); f.state.replayingHistory = true; f.api.forceScrollToBottom(); assert.equal(f.messages.scrollTop, 400);
  f.state.replayingHistory = false; f.api.setPrependAnchor({}); f.api.forceScrollToBottom(); assert.equal(f.messages.scrollTop, 400);
});
test('sent turn anchors follow below the turn, ignore late layout locks, and release on user scroll or turn end', function () {
  var f = fixture();
  var anchor = { parentNode: f.messages, getBoundingClientRect: function () { return { top: 1000 - f.messages.scrollTop }; } };
  f.messages.getBoundingClientRect = function () { return { top: 0 }; };
  f.messages.scrollHeight = 1200; f.messages.clientHeight = 400;
  f.state.paneLastUserScrollTop = 100;
  f.api.forceScrollToBottom(anchor);
  assert.equal(f.state.paneLastUserScrollTop, null, 'a sent turn supersedes the earlier reading position');
  assert.equal(f.api.beginPaneLayoutScrollLock('late', 100), false, 'late layout receipt does not lock a followed turn');
  assert.equal(f.state.paneLayoutScrollLock, undefined);
  f.messages.scrollHeight = 3000; f.api.scrollToBottom(); f.frame();
  assert.equal(f.messages.scrollTop, 992, 'long reply grows below the sent turn instead of pushing it out of view');
  f.api.releaseTurnAnchor(); f.api.disarmStickyBottom();
  assert.equal(f.api.beginPaneLayoutScrollLock('after', 100), true, 'ordinary layout receipts still lock after the turn');
});
test('a detached sent turn stops anchoring so a switched session follows its own tail', function () {
  var f = fixture();
  var anchor = { parentNode: f.messages, getBoundingClientRect: function () { return { top: 100 }; } };
  f.messages.getBoundingClientRect = function () { return { top: 0 }; };
  f.api.forceScrollToBottom(anchor); f.api.disarmStickyBottom();
  anchor.parentNode = null; f.messages.scrollTop = 780; f.messages.scrollHeight = 1000; f.messages.clientHeight = 200;
  f.api.scrollToBottom(); f.frame();
  assert.equal(f.messages.scrollTop, 1000, 'no stale anchor clamp after the transcript was replaced');
});
test('Latest returns to the true tail and clears the sent-turn anchor; pointer interaction releases it', function () {
  var f = fixture();
  var anchor = { parentNode: f.messages, getBoundingClientRect: function () { return { top: 1000 - f.messages.scrollTop }; } };
  f.messages.getBoundingClientRect = function () { return { top: 0 }; };
  f.messages.scrollHeight = 3000; f.messages.clientHeight = 400;
  f.api.forceScrollToBottom(anchor);
  assert.equal(f.messages.scrollTop, 992);
  f.api.forceScrollToBottom();
  assert.equal(f.messages.scrollTop, 3000, 'Latest pins to the real bottom');
  f.api.forceScrollToBottom(anchor); f.input.pointerdown(); f.messages.scrollTop = 500; f.messages.scrollHeight = 3400;
  f.api.scrollToBottom(); f.frame();
  assert.equal(f.messages.scrollTop, 500, 'dragging the scrollbar or clicking the transcript releases the anchor');
});
