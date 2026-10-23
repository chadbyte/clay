var test = require('node:test');
var assert = require('node:assert/strict');
var force = require('../lib/sdk-force-stop').createForceStop;
var actions = require('../lib/project-session-actions').attachSessionActions;

function supportedHandle(extra) { return Object.assign({ forceStop: function () { return Promise.resolve({ status: 'terminated', scope: 'query-runtime' }); } }, extra || {}); }

function fixture() {
  var events = [], calls = [], session = { localId: 2, vendor: 'antigravity', queryInstance: supportedHandle(), sessionOriginId: 'target', isProcessing: false, _awaitingTurnResult: true, _queryStarting: false, _queuedTurnCount: 3, pendingPush: [{ text: 'queued' }], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sibling = { localId: 3, isProcessing: true };
  var sm = { sessions: new Map([[2, session], [3, sibling]]), broadcastSessionList: function () { calls.push('broadcast'); } };
  var sdk = { forceStopSession: force({ provider: function () { return 'antigravity'; }, sm: sm, record: function (target, msg) { events.push(msg); }, changed: function () { calls.push('changed'); } }) };
  var service = actions({ sm: sm, sdk: sdk, onHumanPairStop: function () { calls.push('barrier'); }, onPendingQueuePause: function () { calls.push('pause'); } });
  return { session: session, sibling: sibling, sm: sm, events: events, calls: calls, service: service };
}

test('force stop clears every admission blocker even when processing is false, preserving siblings and history', async function () {
  var f = fixture(), history = [{ type: 'user_message', text: 'saved' }]; f.session.history = history;
  f.session.queryInstance = supportedHandle({ forceStop: function () { f.calls.push('terminate'); return { status: 'terminated', scope: 'query-runtime' }; } });
  var result = await f.service.forceStop(f.session);
  assert.equal(result.runtimeEffect, 'connection_retired');
  assert.equal(result.providerStop, 'terminated');
  assert.deepEqual(f.calls.slice(0, 3), ['pause', 'barrier', 'changed']);
  assert.equal(f.session.queryInstance, null); assert.equal(f.session._queryStarting, false);
  assert.equal(f.session._awaitingTurnResult, false); assert.equal(f.session._queuedTurnCount, 0);
  assert.deepEqual(f.session.pendingPush, []); assert.equal(f.session._pendingMessageDrainPaused, true);
  assert.equal(f.session.taskStopRequested, true); assert.equal(f.sibling.isProcessing, true);
  assert.equal(f.session.history, history);
  assert.equal(f.events.at(-1).type, 'done');
});

test('a rejecting termination reports uncertainty after retiring locally', async function () {
  var f = fixture();
  f.session.queryInstance = supportedHandle({ forceStop: function () { return Promise.reject(new Error('refused')); } });
  var result = await f.service.forceStop(f.session);
  assert.equal(result.status, 'failed'); assert.equal(result.providerStop, 'unconfirmed');
  assert.equal(result.externalEffects, 'unconfirmed'); assert.equal(f.session.queryInstance, null);
  assert.ok(f.events.some(function (event) { return /could not be confirmed/.test(event.text || ''); }));
});

test('ordinary Stop reaches outstanding results without a processing flag or AbortController', async function () {
  var f = fixture(); f.session._queryStarting = false;
  f.session.queryInstance = { abort: function () { f.calls.push('abort'); } };
  assert.equal(f.service.stop(f.session).status, 'queued');
  assert.ok(f.calls.includes('abort')); assert.equal(f.session.taskStopRequested, true);
});

test('force stop rejects deleted and replaced targets', async function () {
  var f = fixture(); f.sm.sessions.set(2, { localId: 2 });
  await assert.rejects(f.service.forceStop(f.session), /replaced/);
  assert.deepEqual(f.events, []);
});

test('human force stop refuses stale origins, foreign access and stale Worker generations', async function () {
  var f = fixture(), count = 0;
  f.session.ownerId = 'owner';
  f.session.sessionProvenance = { kind: 'worker', generation: 2, parentSessionOriginId: 'driver' };
  var attached = require('../lib/project-sessions').attachSessions({ sm: f.sm, sdk: { forceStopSession: function () { count++; } }, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function () { return true; }, canAccessSession: function (id) { return id === 'owner'; } },
    getSessionForWs: function () { return f.session; }, getProjectAccess: function () { return {}; } });
  var message = { type: 'force_stop', sessionId: 2, sessionOriginId: 'target', workerGeneration: 2, parentSessionOriginId: 'driver' };
  attached.handleSessionsMessage({ _clayUser: { id: 'foreign' } }, message);
  attached.handleSessionsMessage({ _clayUser: { id: 'owner' } }, Object.assign({}, message, { sessionOriginId: 'old' }));
  attached.handleSessionsMessage({ _clayUser: { id: 'owner' } }, Object.assign({}, message, { workerGeneration: 1 }));
  assert.equal(count, 0);
  attached.handleSessionsMessage({ _clayUser: { id: 'owner' } }, message);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(count, 1);
});

function addOwnedWorker(f, id, generation, hidden, owner) {
  var worker = { localId: id, vendor: 'antigravity', sessionOriginId: 'worker-' + id, ownerId: owner || null, hidden: !!hidden,
    sessionProvenance: { kind: 'worker', parentSessionOriginId: f.session.sessionOriginId, generation: generation },
    isProcessing: true, _queryStarting: false, _awaitingTurnResult: true,
    queryInstance: supportedHandle({ forceStop: function () { f.calls.push('terminate-' + id); return { status: 'terminated', scope: 'query-runtime' }; } }) };
  f.sm.sessions.set(id, worker); return worker;
}

test('Driver force stop retires all owned Worker generations and pauses their queues while retaining sessions', async function () {
  var f = fixture();
  var current = addOwnedWorker(f, 4, 2), previous = addOwnedWorker(f, 5, 1, true), foreign = addOwnedWorker(f, 6, 3, false, 'other-owner');
  var result = await f.service.forceStop(f.session);
  assert.equal(result.status, 'completed'); assert.equal(result.workerCount, 2);
  assert.deepEqual(result.sessions.map(function (item) { return item.sessionId; }), [2, 4, 5]);
  [current, previous].forEach(function (worker) {
    assert.equal(worker.queryInstance, null); assert.equal(worker.isProcessing, false); assert.equal(worker._queryStarting, false);
    assert.equal(worker.taskStopRequested, true); assert.equal(worker._pendingMessageDrainPaused, true);
    assert.ok(f.calls.includes('terminate-' + worker.localId)); assert.equal(f.sm.sessions.get(worker.localId), worker);
  });
  assert.equal(foreign.isProcessing, true); assert.equal(f.sibling.isProcessing, true);
});

test('force stop of one Worker does not expand to its Driver or sibling Workers', async function () {
  var f = fixture(), worker = addOwnedWorker(f, 4, 1), sibling = addOwnedWorker(f, 5, 2);
  var result = await f.service.forceStop(worker);
  assert.equal(result.workerCount, 0); assert.equal(sibling.isProcessing, true);
  assert.equal(f.session._forceStopRevision, undefined); assert.equal(worker.queryInstance, null);
});

test('all owned Workers are authorized before any force-stop effect', async function () {
  var f = fixture(); addOwnedWorker(f, 4, 1); addOwnedWorker(f, 5, 2);
  var service = actions({ sm: f.sm, sdk: { forceStopSession: function () { throw new Error('must not run'); } },
    usersModule: { isMultiUser: function () { return true; }, canAccessSession: function (id, target) { return target.localId !== 5; } } });
  await assert.rejects(service.forceStop(f.session, { id: 'owner' }), /accessible/);
  assert.equal(f.session._humanStopRevision, undefined); assert.deepEqual(f.calls, []);
});

test('a failed Worker force-stop is reported without skipping the other Workers', async function () {
  var f = fixture(); addOwnedWorker(f, 4, 1); var other = addOwnedWorker(f, 5, 2);
  var retire = force({ provider: function () { return 'antigravity'; }, sm: f.sm, record: function () {}, changed: function () {} });
  var service = actions({ sm: f.sm, sdk: { forceStopSession: function (target) { if (target.localId === 4) throw new Error('cannot close'); return retire(target); } } });
  var result = await service.forceStop(f.session);
  assert.equal(result.status, 'failed'); assert.equal(result.outcome, 'partial');
  assert.equal(result.sessions[1].error, 'cannot close'); assert.equal(other.queryInstance, null);
});

test('unsupported mixed-vendor Worker gates the entire cascade before queue pauses or termination', async function () {
  var f = fixture(), unsupported = addOwnedWorker(f, 4, 1); unsupported.vendor = 'codex';
  assert.equal(require('../lib/session-force-stop-support').describe(f.sm, f.session).supported, false);
  await assert.rejects(f.service.forceStop(f.session), /not yet supported.*owned Worker/);
  assert.deepEqual(f.calls, []); assert.equal(f.session._forceStopRevision, undefined);
  assert.equal(unsupported.taskStopRequested, undefined); assert.ok(f.session.queryInstance);
});
test('unknown vendors, missing handle methods and startup refuse before any local retirement', async function () {
  for (var type of ['unknown', 'missing', 'starting']) {
    var f = fixture();
    if (type === 'unknown') f.session.vendor = 'unknown';
    if (type === 'missing') f.session.queryInstance = { abort: function () { throw new Error('must not abort'); } };
    if (type === 'starting') f.session._queryStarting = true;
    await assert.rejects(f.service.forceStop(f.session), /Force termination/);
    assert.deepEqual(f.calls, []); assert.equal(f.session._forceStopRevision, undefined);
  }
});
test('unsupported direct SDK and authenticated human force requests cannot bypass the server gate', async function () {
  var f = fixture(); f.session.vendor = 'unknown';
  var sdk = { forceStopSession: force({ sm: f.sm, provider: function () { return 'unknown'; }, record: function () { throw new Error('no records expected'); }, changed: function () {} }) };
  await assert.rejects(sdk.forceStopSession(f.session), /not yet supported/);
  var errors = []; f.sm.sendToSession = function (session, message) { errors.push(message); };
  var attached = require('../lib/project-sessions').attachSessions({ sm: f.sm, sdk: sdk, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function () { return false; } }, getSessionForWs: function () { return f.session; } });
  attached.handleSessionsMessage({}, { type: 'force_stop', sessionId: 2, sessionOriginId: 'target' });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.match(errors[0].text, /not yet supported/); assert.deepEqual(f.calls, []);
});
test('a late termination receipt cannot retire or publish completion over a newer generation', async function () {
  var f = fixture(), settle;
  f.session.queryInstance = supportedHandle({ forceStop: function () { return new Promise(function (resolve) { settle = resolve; }); } });
  var pending = f.service.forceStop(f.session), newHandle = supportedHandle();
  f.session.queryInstance = newHandle; f.session._forceStopRevision++; f.session.isProcessing = true;
  settle({ status: 'terminated', scope: 'query-runtime' });
  var result = await pending;
  assert.equal(result.status, 'failed'); assert.equal(f.session.queryInstance, newHandle); assert.equal(f.session.isProcessing, true);
  assert.equal(f.events.some(function (message) { return message.type === 'done'; }), false);
});
test('a foreign viewer with read access cannot force terminate an owned session', async function () {
  var f = fixture(); f.session.ownerId = 'owner';
  var service = actions({ sm: f.sm, sdk: { forceStopSession: function () { throw new Error('must not run'); } },
    usersModule: { isMultiUser: function () { return true; }, canAccessSession: function () { return true; } } });
  await assert.rejects(service.forceStop(f.session, { id: 'viewer' }), /accessible/);
  assert.equal(f.session._forceStopRevision, undefined); assert.deepEqual(f.calls, []);
});
