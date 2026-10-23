var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-worker-activity-'));
process.env.CLAY_HOME = path.join(root, '.clay'); process.env.CLAY_CONFIG = path.join(root, '.clay', 'daemon.json');
var createSessions = require('../lib/sessions').createSessionManager, provenance = require('../lib/session-provenance');
var activity = require('../lib/worker-activity'), attach = require('../lib/project-worker-conversation').attachProjectWorkerConversation;
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
var counter = 0;
function fixture() {
  var dir = path.join(root, String(++counter)); fs.mkdirSync(dir);
  var sm = createSessions({ cwd: dir, sessionsBase: path.join(dir, 'sessions'), cliSessionsDir: path.join(dir, 'cli'), send: function () {} });
  var driver = sm.createSession({ ownerId: 'owner' }), worker = sm.createSession({ ownerId: 'owner', vendor: 'codex' });
  provenance.markWorker(driver, worker, sm.sessions);
  var sent = [], owner = { id: 'owner' }, ws = { readyState: 1, allowed: true, _clayUser: owner }, clients = new Set([ws]);
  var service = attach({ sm: sm, clients: clients, usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === 'owner' ? owner : null; } },
    canAccessProject: function (socket) { return socket.allowed; }, canAccessSession: function (socket, session) { return socket._clayUser.id === session.ownerId; },
    sendTo: function (socket, message) { sent.push(message); } });
  var target = { parentSessionOriginId: driver.sessionOriginId, workerSessionOriginId: worker.sessionOriginId, generation: 1 };
  function subscribe(id) { service.handleMessage(ws, { type: 'split_worker_preview_request', requestId: id || 'request', targets: [target] }); }
  function release() { service.handleMessage(ws, { type: 'split_worker_preview_request', requestId: 'release', targets: [] }); }
  return { sm: sm, driver: driver, worker: worker, sent: sent, ws: ws, target: target, subscribe: subscribe, release: release, service: service };
}
function wait() { return new Promise(function (resolve) { setTimeout(resolve, 90); }); }
test('real recorded Worker tool output supplies a safe activity-only preview; replay never invents a timestamp', async function () {
  var f = fixture(); f.subscribe(); assert.equal(f.sent[0].activity, null); assert.equal(f.sent[0].preview, null);
  var before = Date.now();
  f.sm.sendAndRecord(f.worker, { type: 'tool_executing', id: 'tool', name: 'Bash', input: { command: 'secret-token' }, _ts: 1 });
  var observed = activity.project(f.worker); assert.ok(observed.timestamp >= before); assert.equal(observed.sequence, 1);
  await wait(); var message = f.sent.at(-1);
  assert.equal(message.live, true); assert.equal(message.preview, null); assert.equal(message.activity.summary, 'Running a command');
  assert.ok(message.observedAt >= observed.timestamp);
  assert.deepEqual(f.service.supervision(f.ws, f.driver.sessionOriginId).read().workers[0].recentActivity, observed);
  assert.equal(JSON.stringify(message).includes('secret-token'), false);
  f.subscribe('reconnect'); var snapshot = f.sent.at(-1); assert.equal(snapshot.live, false); assert.deepEqual(snapshot.activity, observed);
  f.sm.switchSession(f.worker.localId); assert.deepEqual(activity.project(f.worker), observed);
  f.sm.sendToSession(f.worker, { type: 'delta', text: 'Ephemeral or replayed' }); assert.deepEqual(activity.project(f.worker), observed);
  f.release();
});
test('only meaningful recorded output advances once; status snapshots and empty deltas do not', async function () {
  var f = fixture(); f.subscribe();
  ['config_state','done','thinking_stop','session_list','info'].forEach(function (type) { f.sm.sendAndRecord(f.worker, { type: type, text: 'status' }); });
  f.sm.sendAndRecord(f.worker, { type: 'delta', text: '' }); assert.equal(activity.project(f.worker), null);
  for (var i = 0; i < 15; i++) f.sm.sendAndRecord(f.worker, { type: 'delta', text: 'output' });
  await wait(); assert.equal(activity.project(f.worker).sequence, 15); assert.equal(f.sent.length, 2, 'coalesced transport');
  f.worker._subscribers.forEach(function (callback) { callback({ type: 'delta', text: 'same record notification' }); });
  await wait(); assert.equal(f.sent.length, 2); assert.equal(activity.project(f.worker).sequence, 15);
  f.worker._sdkQueryGeneration = 2; assert.equal(activity.project(f.worker), null);
  f.sm.sendAndRecord(f.worker, { type: 'tool_start', name: 'Read' }); await wait();
  assert.equal(f.sent.at(-1).activity.queryGeneration, 2); assert.equal(f.sent.at(-1).activity.sequence, 16); f.release();
});
test('delayed preview revalidates owner, access, generation and exact session object', async function () {
  for (var kind of ['owner','access','generation','replacement']) {
    var f = fixture(); f.subscribe();
    f.sm.sendAndRecord(f.worker, { type: 'thinking_start' });
    if (kind === 'owner') f.ws._clayUser = { id: 'foreign' };
    if (kind === 'access') f.ws.allowed = false;
    if (kind === 'generation') f.worker.sessionProvenance.generation++;
    if (kind === 'replacement') f.sm.sessions.set(f.worker.localId, Object.assign({}, f.worker));
    await wait(); assert.equal(f.sent.length, 1, kind); assert.equal(f.worker._subscribers.size, 0); f.release();
  }
});
test('freshly loaded history and unknown tool names cannot fabricate fresh activity or leak tool details', function () {
  var f = fixture(); f.worker.history.push({ type: 'delta', text: 'Old reply', _ts: 1000 }); f.subscribe();
  assert.equal(f.sent[0].preview.timestamp, 1000); assert.equal(f.sent[0].activity, null);
  assert.equal(activity.summary({ type: 'tool_start', name: 'secret tool arg' }), 'Using a tool');
  assert.equal(activity.summary({ type: 'tool_start', name: 'constructor' }), 'Using a tool');
  activity.observe(f.driver, { type: 'delta', text: 'Driver output' }); assert.equal(activity.project(f.driver), null); f.release();
});
