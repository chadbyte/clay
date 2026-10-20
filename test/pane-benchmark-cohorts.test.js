var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
function fixture() {
  var sessions = [], views = [], frames = [], creates = [], clicks = [], ticks = [], socket = {}, state = { connected: true, myUserId: 'owner', currentSlug: 'reuse', projectSplitViewSocketGeneration: 1, projectSplitViewHydrated: true, projectSplitViews: views };
  [1, 4, 8].forEach(function (count) { for (var i = 0; i < count; i++) sessions.push({ id: count * 10 + i, title: 'Benchmark ' + count + ' pane ' + i, sessionOriginId: 'origin-' + count + '-' + i }); });
  function show(selected) {
    state.activeSessionId = selected[0].id; state.sessionOriginId = selected[0].sessionOriginId;
    frames = selected.map(function (session) { return { dataset: { sessionOriginId: session.sessionOriginId }, clayPane: { identity: function () { return { ready: true, binding: { sessionOriginId: session.sessionOriginId } }; } } }; });
  }
  var context = vm.createContext({ store: { get: function (key) { return state[key]; }, snap: function () { return state; } }, getCachedSessions: function () { return sessions; }, getWs: function () { return socket; },
    performance: { now: function () { return 0; } }, requestAnimationFrame: function (fn) { ticks.push(fn); },
    CustomEvent: function (type, options) { this.type = type; this.detail = options.detail; },
    document: { querySelectorAll: function (selector) {
      if (selector.indexOf('#split-host') === 0) return frames;
      return [{ getClientRects: function () { return [{}]; }, click: function () {
        clicks.push(selector);
        var match = selector.match(/data-session-id="(\d+)"/);
        if (match) { state.projectSplitViewActiveId = null; show([sessions.find(function (item) { return item.id === Number(match[1]); })]); }
        else { var id = selector.match(/data-split-view-id="([^"]+)"/)[1], view = views.find(function (item) { return item.id === id; }); state.projectSplitViewActiveId = id; show(view.sessions); }
      } }];
    }, dispatchEvent: function (event) {
      creates.push(event); var selected = event.detail.origins.map(function (origin) { return sessions.find(function (item) { return item.sessionOriginId === origin; }); });
      views.push({ id: 'v' + views.length, sessions: selected });
    } } });
  vm.runInContext(fs.readFileSync('test/fixtures/pane-benchmark-cohorts.js', 'utf8').replace(/^import .*;\n/gm, '').replace(/^export /gm, ''), context);
  return { context: context, creates: creates, clicks: clicks, state: state, sessions: sessions, ticks: ticks };
}
test('prepare 1/4/8 uses disjoint sessions and creates only missing saved cohorts', async function () {
  var f = fixture();
  for (var count of [1, 4, 8]) {
    var result = await f.context.prepareBenchmarkCohort(count); assert.equal(result.origins.length, count);
    assert.equal(f.state.activeSessionId, count * 10);
  }
  assert.equal(f.creates.length, 2); assert.equal(f.creates[0].type, 'clay-split-view-create');
  assert.equal(f.creates[0].detail.origins.length, 4); assert.equal(f.creates[1].detail.origins.length, 8);
  await f.context.prepareBenchmarkCohort(4); assert.equal(f.creates.length, 2);
  assert.match(f.clicks[f.clicks.length - 1], /data-split-view-surface="desktop"/);
});
test('opening an unprepared cohort refuses without mutations; prepared open uses actual sidebar click', async function () {
  var f = fixture(); assert.throws(function () { f.context.openBenchmarkCohort(8); }, /Prepare/); assert.equal(f.creates.length, 0);
  await f.context.prepareBenchmarkCohort(8); var before = f.clicks.length;
  f.context.openBenchmarkCohort(1); f.context.openBenchmarkCohort(8);
  assert.equal(f.clicks.length, before + 2); assert.equal(f.creates.length, 1);
});
test('preparation rejects invalid count, pending mutation and missing fixture seeds', async function () {
  var f = fixture(); await assert.rejects(f.context.prepareBenchmarkCohort(3), /Choose/);
  f.state.projectSplitViewPending = {}; await assert.rejects(f.context.prepareBenchmarkCohort(4), /current presentation/);
  f.state.projectSplitViewPending = null; f.sessions.length = 0;
  await assert.rejects(f.context.prepareBenchmarkCohort(8), /Restart the updated fixture/);
  assert.equal(f.creates.length, 0);
});
test('a changed owner during selection cancels preparation before creating any view', async function () {
  var f = fixture();
  f.context.document.querySelectorAll = function () { return [{ getClientRects: function () { return [{}]; }, click: function () {} }]; };
  var pending = f.context.prepareBenchmarkCohort(4);
  var rejected = assert.rejects(pending, /Cohort context changed/);
  assert.equal(f.ticks.length, 1); f.state.myUserId = 'foreign'; f.ticks.shift()(); await rejected;
  assert.equal(f.creates.length, 0);
});
