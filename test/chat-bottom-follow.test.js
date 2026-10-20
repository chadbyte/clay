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
