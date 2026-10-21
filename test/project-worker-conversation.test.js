"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var provenance = require("../lib/session-provenance");
var attach = require("../lib/project-worker-conversation").attachProjectWorkerConversation;

function fixture() {
  var sessions = new Map(), sent = [], owner = { id: "alice", linuxUser: "alice-linux" };
  var driver = { localId: 1, sessionOriginId: "driver-origin", ownerId: "alice", linuxUser: "alice-linux", history: [] };
  var worker = { localId: 2, sessionOriginId: "worker-origin", ownerId: "alice", linuxUser: "alice-linux", history: [
    { type: "user_message", text: "Question" }, { type: "delta", text: "Answer" }, { type: "tool_start", toolName: "Read" },
    { type: "tool_result", content: "private tool output" }, { type: "done" },
  ] };
  provenance.markWorker(driver, worker, sessions); sessions.set(driver.localId, driver); sessions.set(worker.localId, worker);
  var ws = { readyState: 1, _clayUser: owner, allowed: true };
  var ctx = { sm: { sessions: sessions, subscribeSession: function (id, callback) { var session = sessions.get(id); if (!session._subscribers) session._subscribers = new Set(); session._subscribers.add(callback); return function () { session._subscribers.delete(callback); }; } }, usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === "alice" ? owner : null; } },
    isMate: false, osUsers: true, slug: "alpha", clients: new Set([ws]),
    canAccessProject: function (socket) { return socket.allowed; }, canAccessSession: function (socket, session) { return socket._clayUser.id === session.ownerId; },
    getLinuxUserForSession: function (session) { return session.linuxUser; }, getOsUserInfoForWs: function (socket) { return socket._clayUser ? { username: socket._clayUser.linuxUser } : null; },
    sendTo: function (socket, message) { sent.push(message); socket.last = message; } };
  return { ctx: ctx, ws: ws, driver: driver, worker: worker, sessions: sessions, sent: sent, handle: attach(ctx).handleMessage };
}
function message(overrides) { return Object.assign({ type: "split_worker_conversation_request", requestId: "read-1",
  parentSessionOriginId: "driver-origin", workerSessionOriginId: "worker-origin", generation: 1 }, overrides || {}); }

test("read-only Worker conversation requires exact owner, parent origin and generation", function () {
  var f = fixture();
  assert.equal(f.handle(f.ws, message()), true);
  assert.equal(f.ws.last.type, "split_worker_conversation");
  assert.equal(f.ws.last.error, undefined);
  assert.deepEqual(f.ws.last.messages.map(function (item) { return item.role; }), ["user", "assistant", "tool", "tool"]);
  assert.equal(f.ws.last.messages[2].text, "Used Read");
  assert.equal(f.ws.last.messages[3].text, "private tool output");
  assert.equal(f.ws.last.messages[3].recordType, "tool_result");
  f.handle(f.ws, message({ requestId: "stale", generation: 2 }));
  assert.match(f.ws.last.error, /no longer available/);
  f.handle(f.ws, message({ requestId: "foreign", parentSessionOriginId: "other-origin" }));
  assert.match(f.ws.last.error, /no longer available/);
});

test("read-only Worker conversation refuses foreign owner and replaced session identities", function () {
  var f = fixture();
  var foreign = { readyState: 1, _clayUser: { id: "bob" }, allowed: true };
  f.handle(foreign, message());
  assert.match(foreign.last.error, /no longer available/);
  var unregistered = { readyState: 1, _clayUser: { id: "alice" }, allowed: true };
  f.handle(unregistered, message());
  assert.match(unregistered.last.error, /no longer available/);
  f.sessions.set(f.worker.localId, Object.assign({}, f.worker, { sessionOriginId: "replacement-origin" }));
  f.handle(f.ws, message());
  assert.match(f.ws.last.error, /no longer available/);
});

test("ambiguous Worker or Driver origins are rejected at any duplicate count", function () {
  [2, 3].forEach(function (count) {
    var f = fixture();
    for (var i = 1; i < count; i++) f.sessions.set(10 + i, Object.assign({}, f.worker, { localId: 10 + i }));
    f.handle(f.ws, message());
    assert.match(f.ws.last.error, /no longer available/);
  });
  [2, 3].forEach(function (count) {
    var f = fixture();
    for (var i = 1; i < count; i++) f.sessions.set(20 + i, Object.assign({}, f.driver, { localId: 20 + i }));
    f.handle(f.ws, message());
    assert.match(f.ws.last.error, /no longer available/);
  });
});

test("bounded transcript pages do not send a Worker switch or control operation", function () {
  var f = fixture();
  for (var i = 0; i < 135; i++) f.worker.history.push({ type: "user_message", text: "Entry " + i });
  f.handle(f.ws, message({ before: f.worker.history.length }));
  assert.equal(f.ws.last.messages.length, 120);
  assert.equal(f.ws.last.hasMore, true);
  var next = f.ws.last.nextBefore;
  f.handle(f.ws, message({ before: next }));
  assert.equal(f.ws.last.messages.length, 19);
  assert.equal(f.ws.last.hasMore, false);
  assert.equal(f.sent.some(function (item) { return item.type === "switch_session" || item.type === "split_worker_close"; }), false);
});

test("long messages and adjacent assistant deltas page losslessly within bounded responses", function () {
  var f = fixture(), longText = "L".repeat(40000), deltaA = "A".repeat(12000), deltaB = "B".repeat(12000);
  f.worker.history = [{ type: "user_message", text: longText }, { type: "delta", text: deltaA }, { type: "delta", text: deltaB },
    { type: "tool_use", name: "Search" }, { type: "result", text: "Result" }, { type: "assistant_message", content: "Final" }, { type: "done" }];
  var cursor = f.worker.history.length, gathered = [];
  do {
    f.handle(f.ws, message({ before: cursor }));
    assert.ok(JSON.stringify(f.ws.last).length < 80000, "response should remain bounded");
    gathered = f.ws.last.messages.concat(gathered);
    cursor = f.ws.last.nextBefore;
  } while (f.ws.last.hasMore);
  var userText = gathered.filter(function (item) { return item.role === "user"; }).map(function (item) { return item.text; }).join("");
  var assistantText = gathered.filter(function (item) { return item.role === "assistant"; }).map(function (item) { return item.text; }).join("");
  assert.equal(userText, longText);
  assert.equal(assistantText, deltaA + deltaB + "ResultFinal");
  assert.ok(gathered.some(function (item) { return item.role === "tool" && item.text === "Used Search"; }));
});

test('recorded content blocks and tool output retain exact types and page fragment positions', function () {
  var f = fixture(), text = '**Result**\n\n- item\n\n```js\nvar value = 1;\n```';
  f.worker.history = [{ type: 'user_message', content: [{ type: 'text', text: 'Explain' }] },
    { type: 'delta', text: text.slice(0, 12) }, { type: 'delta', text: text.slice(12) },
    { type: 'tool_result', content: [{ type: 'text', text: '<script>never execute</script>' }], is_error: true }];
  f.handle(f.ws, message());
  assert.equal(f.ws.last.messages[0].text, 'Explain');
  assert.equal(f.ws.last.messages[1].recordType, 'delta');
  assert.equal(f.ws.last.messages[2].recordIndex, 2);
  assert.equal(f.ws.last.messages[3].isError, true);
  assert.equal(f.ws.last.messages[3].text, '<script>never execute</script>');
  assert.equal(f.ws.last.messages[3].start, 0);
  assert.equal(f.ws.last.messages[3].end, f.ws.last.messages[3].text.length);
});


test('Worker page replies echo the exact requested cursor on success and refusal', function () {
  var f = fixture(), cursor = { index: 1, offset: 2 };
  f.handle(f.ws, message({ before: cursor }));
  assert.deepEqual(f.ws.last.pageBefore, cursor);
  f.handle(f.ws, message({ generation: 99, before: cursor }));
  assert.ok(f.ws.last.error); assert.deepEqual(f.ws.last.pageBefore, cursor);
  f.handle(f.ws, message()); assert.equal(f.ws.last.pageBefore, null);
});

test('recorded tool metadata is exact, bounded, page-budgeted and does not expose input objects', function () {
  var f = fixture();
  f.worker.history = [];
  for (var i = 0; i < 120; i++) f.worker.history.push({ type: 'tool_result', id: 'i'.repeat(160), name: 'n'.repeat(300), content: 'x'.repeat(900), input: { secret: 'not projected' } });
  f.handle(f.ws, message());
  assert.ok(f.ws.last.messages.reduce(function (total, item) { return total + item.text.length + (item.toolName || '').length + (item.toolId || '').length; }, 0) <= 64000);
  assert.ok(f.ws.last.messages.every(function (item) { return item.text.length <= 8000 && item.toolName.length === 120 && item.toolId.length === 160 && !item.input; }));
  f.worker.history = [{ type: 'tool_start', id: 'oversize'.repeat(100), name: 'Read' }, { type: 'tool_use', id: 'exact', name: 'Bash' }, { type: 'tool_result', tool_use_id: 'exact', content: 'returned' }];
  f.handle(f.ws, message());
  assert.equal(f.ws.last.messages[0].toolId, null, 'oversized IDs must not be truncated into collisions');
  assert.equal(f.ws.last.messages[1].toolId, 'exact'); assert.equal(f.ws.last.messages[2].toolId, 'exact');
  assert.equal(f.ws.last.messages[2].toolName, null, 'nameless results must remain nameless on the wire');
});


test('supervision reuses exact Worker owner and OS checks across asynchronous reads without exposing task text', function () {
  for (var change of ['driver-os', 'worker-os', 'generation', 'replaced', 'revoked', 'group', 'delegation']) {
    var f = fixture(), group = { id: 'group', members: [1, 2], pair: { driverId: 1, workerId: 2 } };
    f.ctx.getWorkerGroup = function () { return group; };
    var reader = attach(f.ctx).supervision(f.ws, f.driver.sessionOriginId);
    assert.equal(reader.read().workers[0].association, 'current');
    if (change === 'driver-os') f.driver.linuxUser = 'other';
    if (change === 'worker-os') f.worker.linuxUser = 'other';
    if (change === 'generation') f.worker.sessionProvenance.generation++;
    if (change === 'replaced') f.sessions.set(2, Object.assign({}, f.worker));
    if (change === 'revoked') f.ws.allowed = false;
    if (change === 'group') group.pair.driverId = 2;
    if (change === 'delegation') f.worker._pairDelegation = { workerSessionId: 2, generation: 99 };
    assert.throws(function () { reader.read(); }, /changed|unavailable/, change);
  }
});
test('supervision bounds linked generations and preserves explicit truncation', function () {
  var f = fixture();
  for (var i = 3; i < 104; i++) {
    var worker = { localId: i, sessionOriginId: 'worker-' + i, ownerId: 'alice', linuxUser: 'alice-linux', isProcessing: false };
    provenance.markWorker(f.driver, worker, f.sessions); f.sessions.set(i, worker);
  }
  f.ctx.getWorkerGroup = function () { return { id: 'current', members: [1, 103], pair: { driverId: 1, workerId: 103 } }; };
  var result = attach(f.ctx).supervision(f.ws, f.driver.sessionOriginId).read();
  assert.equal(result.workers.length, 100); assert.equal(result.truncated, true);
  assert.equal(result.workers[0].association, 'current'); assert.equal(result.workers[0].id, 103);
  assert.equal(result.workers[1].association, 'archived');
});

test('live Worker subscriptions coalesce recorded activity and revalidate owner/generation before delivery', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var f = fixture();
  f.handle(f.ws, message({ watch: true }));
  assert.equal(f.worker._subscribers.size, 1);
  f.worker.isProcessing = true;
  f.worker._subscribers.forEach(function (notify) { notify(); notify(); });
  t.mock.timers.tick(32);
  assert.equal(f.sent.filter(function (item) { return item.type === 'split_worker_conversation_changed'; }).length, 1);
  assert.equal(f.ws.last.subscriptionId, 'read-1');
  assert.equal(f.ws.last.isProcessing, true);
  assert.equal(f.ws.last.messages, undefined, 'notification never copies tool inputs or transcript');
  f.worker._subscribers.forEach(function (notify) { notify(); });
  f.ws.allowed = false;
  t.mock.timers.tick(32);
  assert.equal(f.worker._subscribers.size, 0, 'revoked observer is released');
  assert.equal(f.sent.length, 2, 'no late delivery after revocation');
});

test('reopening a Worker replaces the watch and stale unsubscribe cannot cancel its new receipt', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var f = fixture();
  f.handle(f.ws, message({ watch: true }));
  f.handle(f.ws, message({ watch: true, requestId: 'read-2' }));
  assert.equal(f.worker._subscribers.size, 1);
  f.handle(f.ws, message({ watch: false }));
  assert.equal(f.worker._subscribers.size, 1);
  f.worker._subscribers.forEach(function (notify) { notify(); });
  f.handle(f.ws, message({ watch: false, requestId: 'read-2' }));
  t.mock.timers.tick(32);
  assert.equal(f.worker._subscribers.size, 0);
  assert.equal(f.sent.length, 2, 'closing cancels pending notification');
});

test('forward Worker activity pages retain every event across a burst beyond the page limit', function () {
  var f = fixture(); f.worker.history = [];
  for (var i = 0; i < 300; i++) f.worker.history.push({ type: 'delta', text: 'event-' + i });
  var cursor = { index: 0, offset: 0 }, seen = [];
  do {
    f.handle(f.ws, message({ after: cursor }));
    assert.equal(f.ws.last.error, undefined);
    assert.ok(f.ws.last.messages.length <= 120);
    f.ws.last.messages.forEach(function (row) { seen.push(row.text); });
    var last = f.ws.last.messages[f.ws.last.messages.length - 1]; cursor = { index: last.recordIndex, offset: last.end };
  } while (f.ws.last.moreRecent);
  assert.equal(seen.length, 300); assert.equal(new Set(seen).size, 300);
  f.handle(f.ws, message({ after: { index: -1, offset: 0 } })); assert.match(f.ws.last.error, /cursor/);
});

test('Worker previews deliver initial latest text without replaying it and live text while the viewer is closed', async function () {
  var f = fixture();
  var request = { type: 'split_worker_preview_request', requestId: 'preview-1', targets: [message()] };
  f.handle(f.ws, request);
  assert.equal(f.ws.last.type, 'split_worker_message_preview'); assert.equal(f.ws.last.live, false); assert.equal(f.ws.last.preview.text, 'Answer');
  f.worker.vendor = 'codex';
  f.worker.history.push({ type: 'delta', text: 'New message', _ts: 1792500000000 });
  f.worker._subscribers.forEach(function (cb) { cb({ type: 'delta', text: 'New message' }); });
  await new Promise(function (resolve) { setTimeout(resolve, 85); });
  assert.equal(f.ws.last.preview.text, 'New message'); assert.equal(f.ws.last.live, true);
  assert.equal(f.ws.last.preview.vendor, 'codex'); assert.equal(f.ws.last.preview.timestamp, 1792500000000);
  var id = f.ws.last.preview.id;
  f.worker.history.push({ type: 'delta', text: ' continuation' }); f.worker._subscribers.forEach(function (cb) { cb({ type: 'delta' }); });
  await new Promise(function (resolve) { setTimeout(resolve, 85); });
  assert.equal(f.ws.last.preview.id, id); assert.equal(f.ws.last.preview.text, 'New message continuation');
  assert.equal(f.ws.last.preview.timestamp, 1792500000000, 'streaming retains the message start time');
  f.handle(f.ws, { type: 'split_worker_preview_request', requestId: 'clear', targets: [] }); assert.equal(f.worker._subscribers.size, 0);
});
test('Worker previews revalidate owner, provenance and access before delayed delivery and bound subscriptions', async function () {
  var f = fixture(); f.handle(f.ws, { type: 'split_worker_preview_request', requestId: 'preview', targets: [message()] });
  var count = f.sent.length; f.worker.history.push({ type: 'delta', text: 'private new text' }); f.worker._subscribers.forEach(function (cb) { cb({ type: 'delta' }); }); f.ws.allowed = false;
  await new Promise(function (resolve) { setTimeout(resolve, 85); }); assert.equal(f.sent.length, count); assert.equal(f.worker._subscribers.size, 0);
  f = fixture(); f.handle(f.ws, { type: 'split_worker_preview_request', requestId: 'over-limit', targets: Array(33).fill(message()) }); assert.equal(f.sent.length, 0);
  f.handle(f.ws, { type: 'split_worker_preview_request', requestId: 'foreign', targets: [message({ generation: 2 })] }); assert.equal(f.sent.length, 0);
});
