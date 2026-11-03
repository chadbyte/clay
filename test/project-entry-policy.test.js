var test = require('node:test'), assert = require('node:assert/strict');
var policy = require('../lib/project-entry-policy');
var now = 1800000000000, day = 86400000;
function session(id, age, extra) { return Object.assign({ localId: id, sessionOriginId: 'origin-' + id, ownerId: 'owner', isProcessing: false, createdAt: now - 10 * day, workStoppedAt: now - age, history: [] }, extra || {}); }
function visits(items) { return items.map(function (item, i) { return { originId: item.sessionOriginId, visitedAt: now - i }; }); }
test('last visit wins at 23h59m but expires exactly at 24h and beyond', function () {
  var last = session(1, day - 60000), running = session(2, 4 * day, { isProcessing: true });
  assert.equal(policy.choose([last, running], visits([last, running]), now), last);
  [day, day + 1, 2 * day].forEach(function (age) {
    last.workStoppedAt = now - age;
    assert.equal(policy.choose([last, running], visits([last, running]), now), running);
    assert.equal(policy.choose([last], visits([last]), now), null);
  });
});
test('running last visit wins regardless of age; running fallback follows personal visit order', function () {
  var stale = session(1, 3 * day), a = session(2, 5 * day, { isProcessing: true }), b = session(3, 6 * day, { _queryStarting: true });
  assert.equal(policy.choose([stale, a, b], visits([stale, b, a]), now), b);
  assert.equal(policy.choose([stale, a, b], visits([a, b]), now), a);
  assert.equal(policy.choose([stale, a, b], visits([b, a]), now), b);
  assert.equal(policy.choose([stale], [], now), null);
  assert.equal(policy.choose([b, a], [], now), a, 'unvisited running ties use stable origin order');
});
test('opening an old chat cannot refresh stopped work; historical fallback ignores mtime and view activity', function () {
  var old = session(1, 3 * day, { lastActivity: now, lastActivityAt: now });
  assert.equal(policy.observe(old, now), false);
  assert.equal(policy.choose([old], visits([old]), now), null);
  delete old.workStoppedAt;
  old.history = [{ type: 'done', _ts: now - 2 * day }, { type: 'system', _ts: now }];
  assert.equal(policy.stoppedAt(old), now - 2 * day);
  old.history = [{ type: 'done' }];
  assert.equal(policy.stoppedAt(old), old.createdAt);
  old.workTimestampUnknown = true;
  assert.equal(policy.stoppedAt(old), null);
  old.workTimestampUnknown = false;
  old.isProcessing = true; policy.observe(old, now);
  old.isProcessing = false; assert.equal(policy.observe(old, now + 10), true);
  assert.equal(old.workStoppedAt, now + 10);
});
test('authoritative approvals, questions, admitted queues and user background work count; idle processes and paused queues do not', function () {
  ['pendingPermissions', 'pendingAskUser', 'pendingUserDialogs', 'pendingElicitations'].forEach(function (key) {
    var fields = {}; fields[key] = { request: {} };
    assert.equal(policy.working(session(1, day * 4, fields)), true, key);
  });
  assert.equal(policy.working(session(1, 0, { _queuedTurnCount: 1 })), true);
  assert.equal(policy.working(session(1, 0, { _pendingMessageClaimId: 'claim' })), true);
  assert.equal(policy.working(session(1, 0, { queryInstance: {} })), false);
  assert.equal(policy.working(session(1, 0, { _queuedTurnCount: 1, _pendingMessageDrainPaused: true })), false);
  assert.equal(policy.working(session(1, 0, { activeBackgroundTasks: [{ task_id: 'user' }] })), true);
  assert.equal(policy.working(session(1, 0, { activeBackgroundTasks: [{ task_id: 'ambient', ambient: true }] })), false);
});
test('owned Workers contribute activity and stop time without becoming entry targets or crossing ownership', function () {
  var root = session(1, day * 5), worker = session(2, day * 4, { isProcessing: true, hidden: true, sessionProvenance: { kind: 'worker', parentSessionOriginId: root.sessionOriginId, generation: 1 } });
  assert.equal(policy.choose([root, worker], visits([root]), now), root);
  worker.isProcessing = false; worker.workStoppedAt = now - 100;
  assert.equal(policy.choose([root, worker], visits([root]), now), root);
  worker.ownerId = 'foreign';
  assert.equal(policy.choose([root, worker], visits([root]), now), null);
  assert.equal(policy.choose([worker], visits([worker]), now), null);
  assert.equal(policy.choose([Object.assign({}, root, { hidden: true })], visits([root]), now), null);
});
