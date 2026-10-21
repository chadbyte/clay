var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture(failure) {
  var state = { connected: true, currentSlug: 'reuse', myUserId: 'owner', projectSplitViewSocketGeneration: 1 }, socket = {}, active = 8, time = 0;
  var frames = Array.from({ length: 8 }, function (_, index) {
    var binding = { sessionOriginId: 'origin-' + index, generation: 1 }, ready = true;
    var input = { value: '', disabled: false, dispatchEvent: function () {}, setSelectionRange: function (start, end) { this.selectionStart = start; this.selectionEnd = end; }, getBoundingClientRect: function () { return { width: 100 }; } };
    var messages = { dataset: { controlSessionOrigin: binding.sessionOriginId }, textContent: 'History entry\n'.repeat(2173), childElementCount: 2173, scrollHeight: 50000, clientHeight: 400, scrollTop: 0 };
    var doc = { getElementById: function (id) { return id === 'input' ? input : messages; } }, source = { Event: function () {} };
    return { isConnected: true, src: 'pane-' + index, dataset: { sessionOriginId: binding.sessionOriginId }, contentDocument: doc, contentWindow: source,
      clayPane: { source: source, document: doc, identity: function () { return { ready: ready, binding: binding }; } },
      suspend: function () { ready = false; }, restore: function () { ready = true; binding.generation++; } };
  });
  var context = vm.createContext({ store: { snap: function () { return Object.assign({}, state); } }, getWs: function () { return socket; },
    performance: { now: function () { return time++; } }, requestAnimationFrame: function (fn) { queueMicrotask(fn); }, window: {},
    document: { querySelectorAll: function (selector) {
      if (selector.indexOf('split-pane-cached') >= 0) return frames.slice(1).map(function (frame) { return { hidden: true, inert: true, style: { display: 'none' }, querySelector: function () { return frame; } }; });
      return frames.slice(0, active);
    } }, openBenchmarkCohort: function (count) {
      active = count;
      if (count === 1) frames.slice(1).forEach(function (frame) { frame.suspend(); });
      else {
        frames.forEach(function (frame) { frame.restore(); });
        if (failure === 'history') frames[5].contentDocument.getElementById('messages').textContent = 'Truncated history';
        if (failure === 'generation') frames[4].clayPane.identity().binding.generation = 1;
        if (failure === 'document') frames[2].contentDocument = Object.assign({}, frames[2].contentDocument);
        if (failure === 'context') state.myUserId = 'other';
      }
    } });
  vm.runInContext(fs.readFileSync('test/fixtures/pane-context-reuse-browser.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  return context;
}
test('native retention fixture checks all eight long transcripts and fresh generations after warm reopen', async function () {
  var result = await fixture().checkPaneContextReuse();
  assert.equal(result.contextsPreserved, true); assert.equal(result.historiesPreserved, true);
  assert.equal(result.transcripts.length, 8); assert.equal(result.activePanes, 8);
  assert.equal(result.draftAndSelectionPreserved, true); assert.equal(result.scrollPreserved, true);
  result.transcripts.forEach(function (entry) { assert.equal(entry.childrenAfter, 2173); assert.equal(entry.freshlyActivated, true); });
});
['history', 'generation', 'document', 'context'].forEach(function (failure) {
  test('native retention fixture rejects ' + failure + ' loss rather than reporting a fast reopen', async function () {
    await assert.rejects(fixture(failure).checkPaneContextReuse(), /retention check failed|context changed|readiness exceeded/i);
  });
});
