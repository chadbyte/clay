var assert = require('node:assert/strict');
function settle() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  var events = f.events;
  function activity() { return events.filter(function (item) { return item.type === 'clay_control_activity'; }); }
  function phases(id) { return activity().filter(function (item) { return item.id === id; }).map(function (item) { return item.phase; }); }
  var foreignEvents = [], unrelatedEvents = [], closedEvents = [];
  var foreign = { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId, send: function (data) { foreignEvents.push(JSON.parse(data)); } };
  var unrelated = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: 999, send: function (data) { unrelatedEvents.push(JSON.parse(data)); } };
  var revoked = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: f.sourceSession.localId, _clayAuthCheck: function () { return false; }, send: function (data) { closedEvents.push(JSON.parse(data)); } };
  f.source.clients.add(foreign); f.source.clients.add(unrelated); f.source.clients.add(revoked);
  var p = await f.propose('rename', 'Reviewed pointer name');
  var first = activity().at(-1); assert.equal(first.phase, 'review'); assert.equal(first.target.kind, 'session');
  assert.equal(first.sourceSessionOriginId, f.sourceSession.sessionOriginId);
  assert.equal(first.sourceMateStamp, JSON.stringify([f.clay.id, f.clay.createdBy || null, f.clay.createdAt || null, f.clay.builtinKey || null]));
  assert.equal(first.sourceQueryGeneration, 8);
  assert.equal(first.target.sessionId, f.session.localId); assert.equal(first.mateId, f.clay.id);
  assert.equal(f.answer(p, foreign), false); assert.deepEqual(phases(first.id), ['review']);
  f.answer(p); assert.equal((await p.promise).status, 'completed');
  assert.equal(f.session.title, 'Reviewed pointer name'); assert.deepEqual(phases(first.id), ['review', 'running', 'completed']);
  assert.ok(activity().every(function (item) { return item.ownerId === 'owner' && !Object.hasOwn(item, 'why') && !Object.hasOwn(item, 'error'); }));
  var count = activity().length; await f.call('control_project_session', p.args); assert.equal(activity().length, count, 'Identical receipt retries never replay animation');
  p = await f.propose('rename', 'Declined name'); var declined = activity().at(-1);
  f.answer(p, f.ws, 'Keep unchanged'); await p.promise;
  assert.deepEqual(phases(declined.id), ['review', 'cancelled']); assert.equal(f.session.title, 'Reviewed pointer name');
  p = await f.propose('rename', 'Stale reviewed name'); var stale = activity().at(-1), title = f.session.title;
  f.session.title = 'Changed during review';
  await new Promise(function (resolve) { setTimeout(resolve, 300); });
  assert.equal(phases(stale.id).at(-1), 'clear', 'An exact revision change withdraws the pointer while review is pending');
  assert.equal(f.answer(p), false);
  f.sourceSession.pendingAskUser[p.id].respond.cancel('Stale review'); await p.promise; f.session.title = title;
  var save = f.target.sm.saveSessionFile;
  p = await f.propose('rename', 'Cannot save'); var failed = activity().at(-1);
  f.target.sm.saveSessionFile = function () { return false; };
  f.answer(p); assert.equal((await p.promise).status, 'failed'); f.target.sm.saveSessionFile = save;
  assert.deepEqual(phases(failed.id), ['review', 'running', 'failed']);
  // The real model service reports a rejected external transport as uncertain.
  f.session.queryInstance = { setModel: async function () { throw new Error('Isolated provider rejection'); } };
  p = await f.propose('model', 'fixture-model'); var uncertain = activity().at(-1); f.answer(p);
  var result = await p.promise; assert.equal(result.runtimeEffect, 'unknown'); assert.equal(activity().at(-1).phase, 'unknown');
  delete f.session.queryInstance;
  var release;
  f.session.queryInstance = { setModel: function () { return new Promise(function (resolve) { release = resolve; }); } };
  p = await f.propose('model', 'fixture-model'); var delayed = activity().at(-1); f.answer(p); await settle();
  assert.equal(activity().at(-1).phase, 'running');
  var overlap = await f.propose('rename', 'Independent reviewed name'), later = activity().at(-1);
  assert.ok(later.order > delayed.order); f.answer(overlap); await overlap.promise;
  release(); await p.promise;
  assert.ok(phases(delayed.id).includes('persisted'), JSON.stringify(phases(delayed.id)));
  assert.equal(phases(later.id).at(-1), 'failed', 'The existing busy guard refuses overlapping effects');
  delete f.session.queryInstance;
  for (var transition of ['abort', 'generation', 'target-replaced', 'project-revoked', 'source-foreign', 'source-replaced', 'source-revoked', 'source-local-id-replaced', 'source-origin-replaced', 'mate-same-id-replaced', 'viewer-disconnect']) {
    f.sourceSession.abortController = new AbortController(); f.sourceSession.taskStopRequested = false; f.sourceSession._sdkQueryGeneration = 8;
    f.session.queryInstance = { setModel: function () { return new Promise(function (resolve) { release = resolve; }); } };
    p = await f.propose('model', 'fixture-model'); var pending = activity().at(-1); f.answer(p); await settle();
    if (transition === 'abort') f.sourceSession.abortController.abort();
    if (transition === 'generation') f.sourceSession._sdkQueryGeneration = 9;
    if (transition === 'target-replaced') f.target.sm.sessions.set(f.session.localId, Object.assign({}, f.session));
    if (transition === 'project-revoked') f.revoke();
    if (transition === 'source-foreign') f.sourceSession._mcpForeignInput = true;
    var registry, originalOrigin = f.sourceSession.sessionOriginId;
    if (transition === 'source-local-id-replaced') f.source.sm.sessions.set(f.sourceSession.localId, Object.assign({}, f.sourceSession, { sessionOriginId: 'replacement-origin' }));
    if (transition === 'source-origin-replaced') f.sourceSession.sessionOriginId = 'replacement-origin';
    if (transition === 'mate-same-id-replaced') {
      registry = f.mates.loadMates(f.mateCtx);
      f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.map(function (mate) { return mate.id === f.clay.id ? Object.assign({}, mate, { createdAt: 'replacement-stamp' }) : mate; }) }));
    }
    if (transition === 'source-replaced') f.projects.set('clay-source', Object.create(f.source));
    if (transition === 'source-revoked') { registry = f.mates.loadMates(f.mateCtx); f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.filter(function (mate) { return mate.id !== f.clay.id; }) })); }
    if (transition === 'viewer-disconnect') f.ws.readyState = 3;
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    var before = activity().length; release(); await p.promise;
    assert.equal(activity().slice(before).some(function (item) { return item.id === pending.id && ['persisted', 'completed'].includes(item.phase); }), false, transition);
    f.projects.set('clay-source', f.source);
    f.source.sm.sessions.set(f.sourceSession.localId, f.sourceSession); f.sourceSession.sessionOriginId = originalOrigin;
    if (registry) f.mates.saveMates(f.mateCtx, registry);
    f.target.sm.sessions.set(f.session.localId, f.session); f.restore(); f.ws.readyState = 1;
    f.sourceSession._mcpForeignInput = false; f.sourceSession._sdkQueryGeneration = 8; f.sourceSession.abortController = new AbortController(); delete f.session.queryInstance;
  }
  var inspected = await f.inspect();
  var stopped = await f.call('control_project_session', { targetToken: inspected.targetToken, action: 'stop', why: 'Pause the isolated Driver queue', requestId: 'stop-presentation' });
  assert.equal(stopped.queuePaused, true); assert.equal(activity().at(-1).phase, 'completed');
  p = await f.propose('delete'); var deletion = activity().at(-1); f.answer(p);
  var deleted = await p.promise; assert.equal(deleted.status, 'completed'); assert.equal(f.target.sm.sessions.has(f.session.localId), false);
  assert.equal(phases(deletion.id).at(-1), 'completed'); assert.equal(activity().at(-1).target, null, 'Observed deletion completes without a stale target');
  assert.equal(foreignEvents.some(function (item) { return item.type === 'clay_control_activity'; }), false);
  assert.equal(unrelatedEvents.some(function (item) { return item.type === 'clay_control_activity'; }), false);
  assert.equal(closedEvents.some(function (item) { return item.type === 'clay_control_activity'; }), false);
  console.log('Presentation production review, persistence, uncertainty, overlap, Stop and exclusion checks passed');
}
module.exports = { run: run };
