var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var attach = require('../lib/workspace-assignment-service').attachWorkspaceAssignmentService;
var attachFollowUp = require('../lib/project-delegated-follow-up').attachDelegatedFollowUp;
var attachSession = require('../lib/project-delegated-session').attachDelegatedSession;

function ref(slug, session) { return 'session:' + slug + ':' + session.cliSessionId; }
function manager(session) {
  var listeners = new Map();
  return {
    sessions: new Map([[session.localId, session]]),
    subscribeSession: function (id, callback) {
      if (!listeners.has(id)) listeners.set(id, new Set());
      listeners.get(id).add(callback);
      return function () { listeners.get(id).delete(callback); };
    },
    sendAndRecord: function (target, event) {
      target.history.push(event);
      Array.from(listeners.get(target.localId) || []).forEach(function (callback) { callback(event); });
    },
    broadcastSessionList: function () {},
  };
}
function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-reviewed-queue-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var source = { localId: 1, cliSessionId: 'source', sessionOriginId: 'source-origin', ownerId: 'u1', _sdkQueryGeneration: 3, history: [] };
  var target = { localId: 4, cliSessionId: 'driver', sessionOriginId: 'driver-origin', ownerId: 'u1', sessionVisibility: 'private',
    vendor: 'claude', mode: 'gui', paired: true, history: [], isProcessing: true };
  var sourceManager = manager(source), targetManager = manager(target), calls = [], linuxUser = 'clay-u1';
  var sdk = {
    pushMessage: function (session, task) { calls.push(task); return true; },
    startQuery: function (session, task) { calls.push(task); return true; },
  };
  var targetProject = Object.assign({
    getStatus: function () { return { projectOwnerId: 'u1', title: 'Project' }; },
    getSessionManager: function () { return targetManager; },
  }, attachFollowUp({ sm: targetManager, isMultiUser: function () { return true; }, sessionRef: function (session) { return ref('target', session); },
    isPairedSession: function (session) { return session.paired; }, canResumeVendor: function () { return true; }, getSdk: function () { return sdk; },
    getLinuxUserForSession: function () { return linuxUser; } }));
  targetManager.createSessionRaw = function (options) { Object.assign(target, options); return target; };
  Object.assign(targetProject, attachSession({ sm: targetManager, resolveModel: function () { return { status: 'ready', vendor: 'claude', model: 'test' }; },
    getSdk: function () { return sdk; }, getLinuxUserForSession: function () { return linuxUser; } }));
  var projects = new Map([
    ['mate', { getStatus: function () { return { projectOwnerId: 'u1', isMate: true, mateId: 'canonical' }; }, getSessionManager: function () { return sourceManager; } }],
    ['target', targetProject],
  ]);
  var mate = { id: 'canonical', createdBy: 'u1', builtinKey: 'clay' };
  var ctx = { resolveMate: function () { return mate; }, storageDir: dir, getProjects: function () { return projects; }, isMultiUser: function () { return true; }, sessionRef: ref };
  var service = attach(ctx);
  var principal = { userId: 'u1', mateId: 'canonical', sourceProjectSlug: 'mate', sourceSessionId: 1, sourceSessionRef: ref('mate', source) };
  var ws = { _clayUser: { id: 'u1' }, _clayActiveSession: 1 };
  function respond(record, action) { return service.respond(ws, { assignmentId: record.assignmentId, action: action || 'approve', surface: 'project', sourceProjectSlug: 'mate', sourceSessionRef: ref('mate', source) }, 'mate'); }
  function propose(task) { return service.proposeFollowUp(principal, { projectSlug: 'target', targetSessionRef: ref('target', target), title: task, task: task }); }
  function finish(stopped) { target.isProcessing = false; target._lastTurnInterrupted = !!stopped; targetManager.sendAndRecord(target, { type: 'result' }); targetManager.sendAndRecord(target, { type: 'done' }); }
  return { service: service, ctx: ctx, dir: dir, source: source, target: target, sourceManager: sourceManager, targetManager: targetManager,
    targetProject: targetProject, projects: projects, calls: calls, sdk: sdk, principal: principal, ws: ws, respond: respond, propose: propose, finish: finish,
    mapUser: function (user) { linuxUser = user; }, mate: mate, revokeMate: function () { mate = null; } };
}
function flush() { return new Promise(function (resolve) { setImmediate(function () { setImmediate(resolve); }); }); }

test('active assignment updates require review, run FIFO at turn boundaries and never consume the old done', async function (t) {
  var f = fixture(t);
  var root = f.service.propose(f.principal, { projectSlug: 'target', title: 'Initial assignment', task: 'Read gold.csv' });
  await f.respond(root);
  f.targetManager.sendAndRecord(f.target, { type: 'session_id' });
  var first = f.propose('Use gold.xlsx instead'), second = f.propose('Also check totals');
  assert.deepEqual(f.calls, ['Read gold.csv']);
  assert.equal(first.parentAssignmentId, root.assignmentId);
  assert.equal((await f.respond(first)).status, 'queued');
  await f.respond(second);
  await f.respond(first);
  assert.equal(f.service.getStatus(f.principal, first.assignmentId).deliveryState, 'queued');
  f.finish();
  await flush();
  assert.deepEqual(f.calls, ['Read gold.csv', 'Use gold.xlsx instead']);
  assert.equal(f.service.getStatus(f.principal, root.assignmentId).status, 'completed');
  assert.equal(f.service.getStatus(f.principal, first.assignmentId).status, 'running');
  assert.equal(f.service.getStatus(f.principal, first.assignmentId).deliveryState, 'accepted');
  assert.equal(f.service.getStatus(f.principal, second.assignmentId).status, 'queued');
  f.finish(); await flush();
  assert.deepEqual(f.calls, ['Read gold.csv', 'Use gold.xlsx instead', 'Also check totals']);
  f.finish(); await flush();
  assert.equal(f.service.getStatus(f.principal, second.assignmentId).status, 'completed');
  assert.equal(f.target.history.filter(function (event) { return event.type === 'delegated_follow_up'; }).length, 2);
  assert.equal(f.target.history.some(function (event) { return event.type === 'user_message'; }), false);
});

test('cancelling the head wakes an idle queued successor and a new approval cannot overtake it', async function (t) {
  var f = fixture(t), first = f.propose('first'), second = f.propose('second');
  await f.respond(first); await f.respond(second);
  f.target.isProcessing = false;
  var third = f.propose('third'); await f.respond(third);
  await f.respond(first, 'cancel'); await flush();
  assert.deepEqual(f.calls, ['second']);
  assert.equal(f.service.getStatus(f.principal, first.assignmentId).deliveryState, 'not_sent');
  f.finish(); await flush(); assert.deepEqual(f.calls, ['second', 'third']);
});

test('queued updates are interrupted on restart without provider replay', async function (t) {
  var f = fixture(t), proposal = f.propose('update'); await f.respond(proposal);
  var restored = attach(f.ctx);
  var record = restored.getStatus(f.principal, proposal.assignmentId);
  assert.equal(record.status, 'interrupted'); assert.equal(record.deliveryState, 'not_sent');
  await flush(); assert.deepEqual(f.calls, []);
});

var changes = {
  'target Stop': function (f) { f.target.taskStopRequested = true; },
  'target interrupted': function (f) { f.target._lastTurnInterrupted = true; },
  'target deleted': function (f) { f.targetManager.sessions.delete(4); },
  'target replacement': function (f) { f.targetManager.sessions.set(4, Object.assign({}, f.target)); },
  'target origin': function (f) { f.target.sessionOriginId = 'replacement'; },
  'target owner': function (f) { f.target.ownerId = 'u2'; },
  'target Worker provenance': function (f) { f.target.sessionProvenance = { kind: 'worker', generation: 1 }; },
  'target Worker role': function (f) { f.target.sessionRole = 'worker'; },
  'OS mapping': function (f) { f.mapUser('clay-u2'); },
  'project replacement': function (f) { f.projects.set('target', Object.assign({}, f.targetProject)); },
  'project revoked': function (f) { f.projects.delete('target'); },
  'registry revocation': function (f) { f.revokeMate(); },
  'registry owner': function (f) { f.mate.createdBy = 'u2'; },
  'registry canonical identity': function (f) { f.mate.builtinKey = null; },
  'target directory': function (f) { f.targetProject.getStatus = function () { return { projectOwnerId: 'u1', path: '/changed' }; }; },
  'source privacy': function (f) { f.source.sessionVisibility = 'shared'; },
  'source project replacement': function (f) { f.projects.set('mate', Object.assign({}, f.projects.get('mate'))); },
  'source foreign input': function (f) { f.source._mentionInProgress = true; },
  'source abort': function (f) { f.source.abortController = { signal: { aborted: true } }; },
  'source Stop': function (f) { f.source.taskStopRequested = true; },
  'source replacement': function (f) { f.sourceManager.sessions.set(1, Object.assign({}, f.source)); },
  'source generation': function (f) { f.source._sdkQueryGeneration++; },
  'source origin': function (f) { f.source.sessionOriginId = 'changed'; },
  'source owner': function (f) { f.source.ownerId = 'u2'; },
};
Object.keys(changes).forEach(function (name) {
  test('queued delivery refuses changed ' + name, async function (t) {
    var f = fixture(t), proposal = f.propose('exact update'); await f.respond(proposal);
    changes[name](f);
    f.target.isProcessing = false;
    f.targetManager.sendAndRecord(f.target, { type: 'done' });
    await flush();
    assert.equal(f.service.records[0].status, 'interrupted'); assert.deepEqual(f.calls, []);
  });
});

test('source Stop cancels immediately; explicit target resume never replays interrupted work', async function (t) {
  var f = fixture(t), proposal = f.propose('queued'); await f.respond(proposal);
  f.source.taskStopRequested = true; f.sourceManager.sendAndRecord(f.source, { type: 'done' });
  assert.equal(f.service.records[0].status, 'interrupted');
  f.source.taskStopRequested = false; f.finish(); await flush(); assert.deepEqual(f.calls, []);
});

test('stale review, foreign owner and changed source view cannot approve', async function (t) {
  var f = fixture(t), proposal = f.propose('queued');
  f.ws._clayUser.id = 'u2'; await assert.rejects(f.respond(proposal), /stale|unavailable/);
  f.ws._clayUser.id = 'u1'; f.ws._clayActiveSession = 99; await assert.rejects(f.respond(proposal), /exact project/);
  f.ws._clayActiveSession = 1; f.mapUser('changed');
  assert.equal((await f.respond(proposal)).status, 'failed'); assert.deepEqual(f.calls, []);
});

test('failed durable queue write does not approve or dispatch instructions', async function (t) {
  var f = fixture(t), proposal = f.propose('queued'), storage = f.dir + '-saved';
  fs.renameSync(f.dir, storage); fs.writeFileSync(f.dir, 'not a directory');
  try { await assert.rejects(f.respond(proposal)); }
  finally { fs.unlinkSync(f.dir); fs.renameSync(storage, f.dir); }
  assert.equal(f.service.records[0].status, 'proposed'); assert.equal(f.service.records[0].decision, undefined);
  f.finish(); await flush(); assert.deepEqual(f.calls, []);
});

test('runtime refusal is failed with unknown delivery and never retried automatically', async function (t) {
  var f = fixture(t), proposal = f.propose('queued'); await f.respond(proposal);
  f.sdk.pushMessage = function () { f.calls.push('attempt'); throw new Error('runtime disconnected'); };
  f.finish(); await flush();
  var record = f.service.getStatus(f.principal, proposal.assignmentId);
  assert.equal(record.status, 'failed'); assert.equal(record.deliveryState, 'unknown');
  f.finish(); await flush(); assert.deepEqual(f.calls, ['attempt']);
});

test('delegated assignment updates reject foreign parent provenance', async function (t) {
  var f = fixture(t);
  var root = f.service.propose(f.principal, { projectSlug: 'target', title: 'Initial', task: 'Initial' });
  await f.respond(root); f.targetManager.sendAndRecord(f.target, { type: 'session_id' });
  f.target.assignment.sourceMateId = 'foreign-mate';
  assert.throws(function () { f.propose('Do not cross assignment ownership'); }, /Orchestrated/);
  assert.deepEqual(f.calls, ['Initial']);
});

test('pending updates are bounded and identical retries reuse their exact review', async function (t) {
  var f = fixture(t), first = f.propose('one');
  assert.equal(f.propose('one').assignmentId, first.assignmentId);
  for (var i = 1; i < 16; i++) f.propose('update ' + i);
  assert.throws(function () { f.propose('overflow'); }, /16 pending/);
  await f.respond(first, 'cancel');
  assert.equal(f.propose('room after cancellation').status, 'proposed');
  assert.deepEqual(f.calls, []);
});

test('approval revalidates after emitting starting and before the audit or provider effect', async function (t) {
  var f = fixture(t), proposal = f.propose('exactly reviewed');
  f.target.isProcessing = false;
  f.sourceManager.subscribeSession(1, function (event) {
    if (event.assignment && event.assignment.status === 'starting') f.mapUser('changed-during-status');
  });
  assert.equal((await f.respond(proposal)).status, 'failed');
  assert.deepEqual(f.calls, []);
  assert.equal(f.target.history.length, 0);
});

test('observed synchronous completion is accepted and cannot be relabelled running', async function (t) {
  var f = fixture(t), proposal = f.propose('fast completion');
  f.target.isProcessing = false;
  f.sdk.pushMessage = function () { f.calls.push('fast'); f.finish(); return true; };
  var result = await f.respond(proposal);
  assert.equal(result.status, 'completed'); assert.equal(result.deliveryState, 'accepted');
  assert.deepEqual(f.calls, ['fast']);
});

test('queue order follows human approval order, rather than proposal creation time', async function (t) {
  var f = fixture(t), earlyProposal = f.propose('approved second'), lateProposal = f.propose('approved first');
  await f.respond(lateProposal); await f.respond(earlyProposal);
  f.finish(); await flush(); assert.deepEqual(f.calls, ['approved first']);
  f.finish(); await flush(); assert.deepEqual(f.calls, ['approved first', 'approved second']);
});
