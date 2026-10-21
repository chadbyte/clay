var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var createManager = require('../lib/sessions').createSessionManager;
var attachDelete = require('../lib/project-session-delete').attachSessionDelete;
var attachActions = require('../lib/project-session-actions').attachSessionActions;
var attachRemoval = require('../lib/project-worker-removal').attachWorkerRemoval;
var provenance = require('../lib/session-provenance');
function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-worker-removal-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var replies = [], user = { id: 'owner', linuxUser: 'owner-os' }, permission = true;
  var sm = createManager({ cwd: path.join(dir, 'project'), sessionsBase: path.join(dir, 'sessions'), cliSessionsDir: path.join(dir, 'cli'), send: function () {}, sendTo: function () {} });
  var driver = sm.getActiveSession(); driver.ownerId = user.id;
  function worker() { var value = sm.createSessionRaw({ ownerId: user.id }); provenance.markWorker(driver, value, sm.sessions); sm.saveSessionFile(value); return value; }
  var first = worker(), sibling = worker(), ws = { readyState: 1, _clayUser: user, _clayActiveSession: driver.localId };
  var ctx = { sm: sm, clients: new Set([ws]), slug: 'fixture', osUsers: true,
    usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === user.id ? user : null; }, canAccessProject: function () { return true; }, canAccessSession: function (id, value) { return id === value.ownerId; }, getEffectivePermissions: function () { return { sessionDelete: permission }; } },
    getProjectAccess: function () { return {}; }, getLinuxUserForSession: function () { return 'owner-os'; }, getOsUserInfoForWs: function () { return {}; },
    sendTo: function (_, msg) { replies.push(msg); }, stopTitleWatcher: function () {}, sdk: {}, stopTimeoutMs: 30 };
  ctx.sessionDelete = attachDelete(ctx); ctx.actions = attachActions(ctx);
  var api = attachRemoval(ctx);
  var msg = { type: 'split_worker_remove', requestId: 'removal_1', action: 'request', projectSlug: 'fixture', ownerId: user.id,
    driverId: driver.localId, driverOriginId: driver.sessionOriginId, workerId: first.localId, workerOriginId: first.sessionOriginId, generation: first.sessionProvenance.generation };
  async function send(patch) {
    var count = replies.length; api.handleMessage(ws, Object.assign({}, msg, patch || {}));
    for (var i = 0; replies.length === count && i < 100; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
    return replies[replies.length - 1];
  }
  return { ctx: ctx, api: api, sm: sm, driver: driver, worker: first, sibling: sibling, ws: ws, msg: msg, send: send, replies: replies,
    deny: function () { permission = false; }, user: user };
}
test('idle removal uses production session deletion and retains Driver and siblings', async function (t) {
  var f = fixture(t), file = path.join(f.sm.sessionsDir, f.worker._sessionRecordId + '.jsonl');
  assert.equal(fs.existsSync(file), true);
  assert.equal((await f.send()).status, 'removed');
  assert.equal(f.sm.sessions.has(f.worker.localId), false); assert.equal(fs.existsSync(file), false);
  assert.equal(f.sm.sessions.get(f.sibling.localId), f.sibling); assert.equal(f.sm.sessions.get(f.driver.localId), f.driver);
  assert.equal((await f.send()).status, 'failed', 'duplicates cannot replay');
});
test('active removal requires server token; cancellation retains execution and session', async function (t) {
  var f = fixture(t); f.worker.isProcessing = true;
  var result = await f.send(); assert.equal(result.status, 'confirmation_required'); assert.ok(result.token);
  f.api.handleMessage(f.ws, Object.assign({}, f.msg, { action: 'cancel' }));
  assert.equal((await f.send({ action: 'confirm', token: result.token })).status, 'failed');
  assert.equal(f.worker.isProcessing, true); assert.equal(f.sm.sessions.has(f.worker.localId), true);
});
test('confirmed production Stop completes before exact removal', async function (t) {
  var f = fixture(t); f.worker.isProcessing = true;
  f.worker.abortController = { abort: function () { setTimeout(function () { f.worker.isProcessing = false; }, 2); } };
  var result = await f.send(); assert.equal(result.status, 'confirmation_required');
  assert.equal((await f.send({ action: 'confirm', token: result.token })).status, 'removed');
  assert.equal(f.worker._pendingMessageDrainPaused, true);
});
test('failed Stop and unknown Stop completion retain the session', async function (t) {
  for (var failure of ['throw', 'unknown']) {
    var f = fixture(t); f.worker.isProcessing = true;
    f.worker.abortController = { abort: function () { if (failure === 'throw') throw new Error('Stop failed'); } };
    var review = await f.send(); var result = await f.send({ action: 'confirm', token: review.token });
    assert.equal(result.status, 'failed'); assert.equal(f.sm.sessions.has(f.worker.localId), true);
  }
});
test('foreign, stale generation, project, OS mapping and revoked permission refuse deletion', async function (t) {
  for (var change of ['owner', 'generation', 'project', 'os', 'permission']) {
    var f = fixture(t), patch = {};
    if (change === 'owner') patch.ownerId = 'foreign';
    if (change === 'generation') patch.generation = f.msg.generation + 1;
    if (change === 'project') patch.projectSlug = 'foreign';
    if (change === 'os') f.user.linuxUser = 'changed';
    if (change === 'permission') f.deny();
    assert.equal((await f.send(patch)).status, 'failed', change); assert.equal(f.sm.sessions.has(f.worker.localId), true);
  }
});
test('disconnect, human Stop, replacement and cancellation during Stop never delete afterward', async function (t) {
  for (var change of ['disconnect', 'stop', 'replace', 'cancel', 'permission', 'os', 'source']) {
    var f = fixture(t); f.worker.isProcessing = true;
    f.worker.abortController = { abort: function () { setTimeout(function () {
      if (change === 'permission') f.deny();
      if (change === 'os') f.user.linuxUser = 'changed';
      if (change === 'source') f.ws._clayActiveSession = f.sibling.localId;
      if (change === 'disconnect') f.ws.readyState = 3;
      if (change === 'stop') f.worker._humanStopRevision++;
      if (change === 'replace') f.sm.sessions.set(f.worker.localId, Object.assign({}, f.worker));
      if (change === 'cancel') f.api.handleMessage(f.ws, Object.assign({}, f.msg, { action: 'cancel' }));
      f.worker.isProcessing = false;
    }, 2); } };
    var review = await f.send(); assert.equal((await f.send({ action: 'confirm', token: review.token })).status, 'failed', change);
    assert.equal(f.sm.sessions.has(f.worker.localId), true);
  }
});
test('failed deletion cannot produce a successful removal receipt', async function (t) {
  var f = fixture(t); f.ctx.sessionDelete.executeOwnedDeletion = function () { throw new Error('storage failure'); };
  assert.equal((await f.send()).status, 'failed'); assert.equal(f.sm.sessions.has(f.worker.localId), true);
});

test('actual record unlink failure retains the live session and durable record', async function (t) {
  var f = fixture(t), file = path.join(f.sm.sessionsDir, f.worker._sessionRecordId + '.jsonl');
  var unlink = fs.unlinkSync;
  fs.unlinkSync = function (name) { if (name === file) { var error = new Error('fixture disk denial'); error.code = 'EACCES'; throw error; } return unlink.apply(fs, arguments); };
  try { assert.equal((await f.send()).status, 'failed'); }
  finally { fs.unlinkSync = unlink; }
  assert.equal(f.sm.sessions.has(f.worker.localId), true); assert.equal(fs.existsSync(file), true);
});

test('current Worker removal updates production group membership while archived removal leaves peers unchanged', async function (t) {
  var f = fixture(t);
  var feature = require('../lib/multi-worker-feature').fromServerConfig({ multiWorkerRuntimeEnabled: true });
  var store = require('../lib/session-split-groups').createSplitGroupStore({ sessions: f.sm.sessions, sessionsDir: f.sm.sessionsDir, multiWorkerFeature: feature });
  var created = store.createOwned('owner', { members: [f.driver.localId, f.worker.localId], pair: { driverId: f.driver.localId, workerId: f.worker.localId } });
  assert.equal(created.ok, true);
  assert.equal(store.addWorker('owner', { groupId: created.group.id, driverId: f.driver.localId, driverOriginId: f.driver.sessionOriginId,
    newWorkerId: f.sibling.localId, newWorkerOriginId: f.sibling.sessionOriginId }, feature).ok, true);
  f.sm.setOnSessionDeleted(function (id) { store.dissolveBySession(id); });
  assert.equal((await f.send()).status, 'removed');
  assert.deepEqual(created.group.pair.workerIds, [f.sibling.localId]);
});

test('changed execution after review and duplicate confirmation cannot stop a replacement turn', async function (t) {
  var f = fixture(t); f.worker.isProcessing = true;
  var review = await f.send(); f.worker._pairDelegation = { taskId: 'replacement' };
  assert.equal((await f.send({ action: 'confirm', token: review.token })).status, 'failed');
  assert.equal(f.worker.taskStopRequested, undefined);
  assert.equal(f.sm.sessions.has(f.worker.localId), true);
});

test('duplicate in-flight confirmations request Stop once and never replay deletion', async function (t) {
  var f = fixture(t), stops = 0; f.worker.isProcessing = true;
  f.worker.abortController = { abort: function () { stops++; setTimeout(function () { f.worker.isProcessing = false; }, 2); } };
  var review = await f.send(), confirmation = Object.assign({}, f.msg, { action: 'confirm', token: review.token });
  f.api.handleMessage(f.ws, confirmation); f.api.handleMessage(f.ws, confirmation);
  for (var i = 0; f.replies.length < 2 && i < 100; i++) await new Promise(function (resolve) { setTimeout(resolve, 5); });
  assert.equal(f.replies[1].status, 'removed');
  // The existing deletion lifecycle aborts once more while releasing the idle runtime.
  assert.equal(stops, 2); assert.equal(f.replies.length, 2);
  assert.equal((await f.send(confirmation)).status, 'failed'); assert.equal(stops, 2);
});
