var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
function fixture() {
  var context = vm.createContext({ document: {} });
  vm.runInContext(fs.readFileSync('lib/public/modules/split-view-worker-scroll.js', 'utf8').replace(/^export function /gm, 'function '), context);
  return context;
}
test('scroll pages serialize requests, stop at end, fill a short viewport and retry only intentionally', function () {
  var api = fixture(), state = { status: 'ready', hasMore: true, nextBefore: { index: 120, offset: 0 } };
  var body = { scrollTop: 400, scrollHeight: 800, clientHeight: 400 };
  assert.equal(api.shouldLoadWorkerPage(state, body, true), false, 'opening at latest must not drain earlier pages');
  body.scrollTop = 40; assert.equal(api.shouldLoadWorkerPage(state, body, true), true);
  state.inFlight = true; assert.equal(api.shouldLoadWorkerPage(state, body, true), false);
  state.inFlight = false; state.status = 'error'; body.scrollHeight = 200;
  assert.equal(api.shouldLoadWorkerPage(state, body, false), false);
  assert.equal(api.shouldLoadWorkerPage(state, body, true), true);
  state.status = 'ready'; assert.equal(api.shouldLoadWorkerPage(state, body, false), true);
  state.hasMore = false; assert.equal(api.shouldLoadWorkerPage(state, body, true), false);
});
test('cursor continuation must strictly advance and reject invalid or repeated positions', function () {
  var api = fixture(), before = { index: 120, offset: 8000 };
  assert.equal(api.workerCursorAdvances(before, { index: 120, offset: 4000 }), true);
  assert.equal(api.workerCursorAdvances(before, { index: 119, offset: 9000 }), true);
  assert.equal(api.workerCursorAdvances(before, before), false);
  assert.equal(api.workerCursorAdvances(before, { index: 121, offset: 0 }), false);
  assert.equal(api.workerCursorKey({ index: -1, offset: 0 }), null);
});
test('anchor fallback preserves the visible part of a merged record, not its old top', function () {
  var api = fixture(), bottom = 240;
  var article = { dataset: { recordIndex: '121' }, getBoundingClientRect: function () { return { bottom: bottom }; }, querySelector: function () { return { textContent: 'merged text' }; } };
  var body = { scrollTop: 30, scrollHeight: 800, getBoundingClientRect: function () { return { top: 10 }; }, querySelectorAll: function () { return [article]; } };
  var anchor = api.captureWorkerAnchor(body);
  bottom += 310; body.scrollHeight += 310;
  api.restoreWorkerAnchor(body, anchor);
  assert.equal(body.scrollTop, 340);
});
