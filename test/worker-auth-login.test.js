var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-worker-auth-'));
process.env.HOME = root;
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CODEX_HOME = path.join(root, '.codex');
require('./helpers/yoke-no-provider-processes.cjs');
var test = require('node:test');
var assert = require('node:assert/strict');
var registry = require('../lib/yoke/vendor-registry');
var users = require('../lib/users');
var createSessionManager = require('../lib/sessions').createSessionManager;
var processorFactory = require('../lib/sdk-message-processor').attachMessageProcessor;
var counter = 0;
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

function fixture(t, vendor, refreshTransport) {
  var owner = { id: 'alice', linuxUser: 'alice-linux' }, permitted = true, sent = [], terminals = [], browsers = [], refreshes = [];
  var info = { user: 'alice-linux', home: '/fixture/alice', uid: 1001, gid: 1001 };
  t.mock.method(users, 'isMultiUser', function () { return true; });
  t.mock.method(users, 'findUserById', function (id) { return id === owner.id ? owner : null; });
  var ws = { readyState: 1, _clayUser: owner }, clients = new Set([ws]), auth;
  function sendTo(peer, msg) { sent.push({ peer: peer, msg: msg }); }
  ws.send = function (data) { sendTo(ws, JSON.parse(data)); };
  var sm = createSessionManager({ cwd: root, sessionsBase: path.join(root, 'sessions-' + (++counter)),
    send: function () {}, sendEach: function (fn) { clients.forEach(function (peer) { fn(peer); }); },
    onAuthRequired: function (session, msg) { return auth.emit(session, msg); } });
  var driver = sm.createSessionRaw({ vendor: vendor === 'claude' ? 'codex' : 'claude', ownerId: owner.id });
  var worker = sm.createSessionRaw({ vendor: vendor || 'codex', ownerId: owner.id });
  require('../lib/session-provenance').markWorker(driver, worker, sm.sessions);
  worker._pairGeneration = worker.sessionProvenance.generation;
  worker._queryGeneration = 1;
  ws._clayActiveSession = driver.localId;
  var group = { id: 'pair', members: [driver.localId, worker.localId], pair: { driverId: driver.localId, workerId: worker.localId } };
  var access = { canAccessProject: function () { return permitted; }, hasPermission: function () { return permitted; } };
  var conversation = require('../lib/project-worker-conversation').attachProjectWorkerConversation({
    sm: sm, usersModule: users, clients: clients, osUsers: true, slug: 'fixture',
    canAccessProject: access.canAccessProject, canAccessSession: function (peer, session) { return peer._clayUser.id === session.ownerId; },
    getWorkerGroup: function () { return group; }, getLinuxUserForSession: function (session) { return session.ownerId === owner.id ? owner.linuxUser : null; },
    getOsUserInfoForWs: function () { return info; }, sendTo: sendTo });
  auth = require('../lib/project-worker-auth').attach({ sm: sm, clients: clients, slug: 'fixture', osUsers: true,
    currentPair: conversation.currentPair, requestAccess: access, getOsUserInfoForWs: function () { return info; }, sendTo: sendTo });
  var tm = { create: function (cols, rows, identity, peer, options) { var terminal = { id: terminals.length + 1, identity: identity, options: options, alive: true }; terminals.push(terminal); return terminal; },
    close: function (id) { terminals[id - 1].alive = false; }, has: function (id) { return terminals[id - 1].alive; }, list: function () { return []; }, attach: function () {} };
  var login = require('../lib/project-vendor-login').attachVendorLogin({ sm: sm, slug: 'fixture', clients: clients, tm: tm, osUsers: true,
    usersModule: users, requestAccess: access, workerAuth: auth, sendTo: sendTo, send: function () {},
    getLinuxUserForSession: function () { return owner.linuxUser; }, getOsUserInfoForWs: function () { return info; }, getOsUserInfoForLinuxUser: function () { return info; },
    refreshVendorAuthEverywhere: function (name, linuxUser) { refreshes.push([name, linuxUser]); return refreshTransport ? refreshTransport() : Promise.resolve(true); },
    createLoginBrowser: function (options) { var browser = { id: 'browser-' + browsers.length, env: {}, options: options,
      output: function () {}, attach: function () {}, input: function () {}, close: function () { this.closed = true; } }; browsers.push(browser); return browser; } });
  t.after(function () { login.destroy(); });
  var processor = processorFactory({ sm: sm, opts: {}, slug: 'fixture', onProcessingChanged: function () {}, onTurnDone: function () {} });
  function emit() { worker.isProcessing = true; processor.processSDKMessage(worker, { yokeType: 'auth_required' }); }
  function request() { var event = sent.filter(function (entry) { return entry.msg.type === 'worker_auth_required'; }).pop().msg;
    return Object.assign({}, event, { type: 'vendor_login_start', auto: true, mode: registry.publicInfo()[worker.vendor].browserLoginSupported ? 'browser' : 'terminal' }); }
  return { sm: sm, driver: driver, worker: worker, ws: ws, clients: clients, group: group, info: info, sent: sent,
    emit: emit, request: request, auth: auth, login: login, terminals: terminals, browsers: browsers, refreshes: refreshes,
    revoke: function () { permitted = false; } };
}

Object.keys(registry.VENDOR_REGISTRY).forEach(function (vendor) {
  test(vendor + ': live SDK auth opens the registered Worker login while another-provider Driver is active', function (t) {
    var f = fixture(t, vendor); f.emit();
    var request = f.request();
    assert.equal(request.vendor, vendor); assert.equal(request.sessionId, f.worker.localId);
    assert.equal(f.worker.isProcessing, false);
    assert.match(require('../lib/session-pair-history').errorSince(f.worker.history, 0), /needs provider sign-in/);
    assert.equal(f.worker.history.some(function (msg) { return msg.type === 'auth_required' || msg.type === 'worker_auth_required'; }), false);
    f.login.handleVendorLoginMessage(f.ws, request);
    f.login.handleVendorLoginMessage(f.ws, request);
    assert.equal(f.terminals.length, 1);
    assert.equal(f.terminals[0].identity.home, '/fixture/alice');
    assert.equal(f.terminals[0].options.initialInput, require('../lib/yoke/login-protocol').command(vendor, request.mode === 'browser') + '\n');
    assert.equal(f.ws._clayActiveSession, f.driver.localId);
  });
});

test('startup auth uses the same transient path; later delegated query gets a fresh receipt', function (t) {
  var f = fixture(t, 'codex');
  f.sm.sendAndRecord(f.worker, { type: 'auth_required', vendor: 'codex', loginCommand: 'codex login', canAutoLogin: true });
  var first = f.request();
  f.worker._queryGeneration++;
  f.emit();
  var next = f.request();
  assert.notEqual(first.workerAuthRequestId, next.workerAuthRequestId);
  f.login.handleVendorLoginMessage(f.ws, first); assert.equal(f.terminals.length, 0);
  f.login.handleVendorLoginMessage(f.ws, next); assert.equal(f.terminals.length, 1);
});

var mutations = {
  'replaced Worker': function (f) { f.sm.sessions.set(f.worker.localId, Object.assign({}, f.worker)); },
  'deleted Driver': function (f) { f.sm.sessions.delete(f.driver.localId); },
  'stale generation': function (f) { f.worker._pairGeneration++; },
  'changed roles': function (f) { f.group.pair.workerId = 999; },
  'foreign owner': function (f) { f.worker.ownerId = 'bob'; },
  'revoked permissions': function (f) { f.revoke(); },
  'changed mapped HOME': function (f) { f.info.home = '/fixture/changed'; },
  'changed OS mapping': function (f) { f.ws._clayUser.linuxUser = 'other'; },
  'changed selected context': function (f) { f.ws._clayActiveSession = 999; },
  'pane connection': function (f) { f.ws._clayPaneActivation = {}; },
  'offline': function (f) { f.ws.readyState = 3; },
  'human Stop': function (f) { f.worker._forceStopRevision = 1; },
  'Driver Stop': function (f) { f.driver._pairTurnControl = { humanStopped: true }; },
};
Object.keys(mutations).forEach(function (name) {
  test(name + ' refuses login start and asynchronous success', function (t) {
    var f = fixture(t, 'codex'); f.emit(); var request = f.request();
    mutations[name](f); f.login.handleVendorLoginMessage(f.ws, request); assert.equal(f.terminals.length, 0);
    var running = fixture(t, 'codex'); running.emit(); running.login.handleVendorLoginMessage(running.ws, running.request());
    mutations[name](running); running.terminals[0].options.onData('Successfully logged in.');
    assert.equal(running.terminals[0].alive, false); assert.deepEqual(running.refreshes, []);
  });
});

test('foreign, hidden, unassociated and stale Worker events never surface', function (t) {
  var f = fixture(t, 'codex');
  f.worker.hidden = true; f.emit(); assert.equal(f.sent.filter(function (e) { return e.msg.type === 'worker_auth_required'; }).length, 0);
  f.worker.hidden = false; f.group.pair.workerId = 999; f.worker._queryGeneration++; f.emit();
  assert.equal(f.sent.filter(function (e) { return e.msg.type === 'worker_auth_required'; }).length, 0);
});

test('cancel and success retain Worker history without replaying a task', async function (t) {
  var f = fixture(t, 'codex'); f.emit(); var request = f.request();
  f.login.handleVendorLoginMessage(f.ws, request);
  f.login.handleVendorLoginMessage(f.ws, { type: 'vendor_login_cancel', vendor: 'codex', browserId: f.browsers[0].id });
  assert.equal(f.terminals[0].alive, false); assert.deepEqual(f.refreshes, []);
  f.login.handleVendorLoginMessage(f.ws, request);
  f.terminals[1].options.onData('Successfully logged in.');
  f.terminals[1].options.onExit();
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(f.refreshes, [['codex', 'alice-linux']]);
  assert.equal(f.worker.isProcessing, false); assert.equal(f.sm.sessions.get(f.worker.localId), f.worker);
  assert.equal(f.worker.history.filter(function (msg) { return msg.type === 'error'; }).length, 1);
  assert.equal(f.sent.some(function (entry) { return entry.msg.type === 'auth_refreshed'; }), true);
});

test('production startup failure and resumed SDK query both route Worker authentication', async function (t) {
  var yoke = require('../lib/yoke');
  t.mock.method(yoke, 'checkAuth', function () { return { codex: false }; });
  t.mock.method(yoke, 'checkInstalled', function () { return { codex: true }; });
  t.mock.method(yoke, 'lazyCreateAdapter', function () { return Promise.resolve(null); });
  var f = fixture(t, 'codex');
  var bridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: root, slug: 'fixture', sessionManager: f.sm,
    adapters: {}, adapter: { vendor: 'claude' }, send: function () {}, onProcessingChanged: function () {} });
  f.worker.isProcessing = true;
  assert.equal(await bridge.startQuery(f.worker, 'first bounded task'), false);
  assert.equal(f.worker.isProcessing, false); assert.equal(f.worker._queryStarting, false);
  assert.equal(f.request().vendor, 'codex');
  var first = f.request().workerAuthRequestId;
  f.worker.cliSessionId = 'synthetic-resume';
  f.worker.isProcessing = true;
  assert.equal(await bridge.startQuery(f.worker, 'later delegated task'), false);
  assert.notEqual(f.request().workerAuthRequestId, first);
  assert.equal(f.worker.history.some(function (msg) { return msg.type === 'auth_required'; }), false);
});

test('missing installation remains an installation failure without a login request', async function (t) {
  var yoke = require('../lib/yoke');
  t.mock.method(yoke, 'checkAuth', function () { return { codex: false }; });
  t.mock.method(yoke, 'checkInstalled', function () { return { codex: false }; });
  t.mock.method(yoke, 'lazyCreateAdapter', function () { return Promise.resolve(null); });
  var f = fixture(t, 'codex');
  var bridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: root, sessionManager: f.sm,
    adapters: {}, adapter: { vendor: 'claude' }, send: function () {}, onProcessingChanged: function () {} });
  await bridge.startQuery(f.worker, 'task');
  assert.match(require('../lib/session-pair-history').errorSince(f.worker.history, 0), /not installed/);
  assert.equal(f.sent.some(function (e) { return e.msg.type === 'worker_auth_required'; }), false);
});

test('unsupported registered login reports unavailable without creating a terminal', function (t) {
  var f = fixture(t, 'codex'); f.emit(); var request = f.request();
  var original = registry.VENDOR_REGISTRY.codex;
  registry.VENDOR_REGISTRY.codex = Object.assign({}, original, { loginCommand: null, terminalLoginCommand: null, browserLoginCommand: null });
  try { f.login.handleVendorLoginMessage(f.ws, request); }
  finally { registry.VENDOR_REGISTRY.codex = original; }
  assert.equal(f.terminals.length, 0);
  assert.match(f.sent.filter(function (e) { return e.msg.type === 'vendor_login_error'; }).pop().msg.error, /unavailable/);
});

test('a reconnect and replayed transcript cannot recreate a live authentication receipt', function (t) {
  var f = fixture(t, 'codex'); f.emit(); var request = f.request();
  var peer = { readyState: 1, _clayUser: f.ws._clayUser, _clayActiveSession: f.driver.localId };
  f.clients.add(peer);
  f.login.handleVendorLoginMessage(peer, request); assert.equal(f.terminals.length, 0);
  assert.equal(f.worker.history.some(function (e) { return /auth_required/.test(e.type); }), false);
  f.login.handleVendorLoginMessage(f.ws, Object.assign({}, request, { vendor: 'claude' }));
  assert.equal(f.terminals.length, 0);
});

test('auth failure pauses queued Worker follow-ups through successful sign-in until explicit delegation', function (t) {
  var f = fixture(t, 'codex'); f.emit();
  var delivered = 0;
  var control = require('../lib/project-pair-task-control').attachPairTaskControl({
    turnControl: { blockedReason: function () { return null; } }, sendFollowup: function () { delivered++; return Promise.resolve({}); } });
  f.worker._pairFollowups = [{ status: 'queued', message: 'Next bounded task', taskId: 'next', workerId: f.worker.localId }];
  assert.equal(control.drain(f.driver, f.worker), false);
  assert.equal(delivered, 0);
  assert.equal(f.worker._pairFollowups.length, 1);
  f.worker._workerAuthRequired = false;
  assert.equal(control.drain(f.driver, f.worker), true);
  assert.equal(delivered, 1);
});

test('terminal fallback permits the real same-owner terminal socket while the originating Driver stays live', function (t) {
  var f = fixture(t, 'codex'); f.emit();
  f.login.handleVendorLoginMessage(f.ws, Object.assign({}, f.request(), { mode: 'terminal' }));
  var peer = { readyState: 1, _clayUser: f.ws._clayUser };
  assert.equal(f.login.handleVendorLoginMessage(peer, { type: 'term_attach', id: 1 }), false);
  f.revoke();
  assert.equal(f.login.handleVendorLoginMessage(peer, { type: 'term_input', id: 1, data: 'synthetic' }), true);
});

test('expired live receipt refuses sign-in without creating an effect', function (t) {
  var f = fixture(t, 'codex'); f.emit(); var request = f.request(), now = Date.now();
  t.mock.method(Date, 'now', function () { return now + 5 * 60 * 1000 + 1; });
  f.login.handleVendorLoginMessage(f.ws, request);
  assert.equal(f.terminals.length, 0);
});

test('refresh rejection reports failure and never announces successful recovery', async function (t) {
  var f = fixture(t, 'codex', function () { return Promise.reject(new Error('synthetic refresh failure')); });
  f.emit(); f.login.handleVendorLoginMessage(f.ws, f.request());
  f.terminals[0].options.onData('Successfully logged in.'); f.terminals[0].options.onExit();
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.terminals[0].alive, false);
  assert.equal(f.sent.some(function (e) { return e.msg.type === 'auth_refreshed'; }), false);
  assert.match(f.sent.filter(function (e) { return e.msg.type === 'vendor_login_error'; }).pop().msg.error, /refreshing the provider failed/);
});

test('revocation during asynchronous refresh refuses the success receipt', async function (t) {
  var finish;
  var f = fixture(t, 'codex', function () { return new Promise(function (resolve) { finish = resolve; }); });
  f.emit(); f.login.handleVendorLoginMessage(f.ws, f.request());
  f.terminals[0].options.onData('Successfully logged in.'); f.terminals[0].options.onExit();
  await new Promise(function (resolve) { setImmediate(resolve); });
  f.revoke(); finish(true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.terminals[0].alive, false);
  assert.equal(f.sent.some(function (e) { return e.msg.type === 'auth_refreshed'; }), false);
});

test('an independent registered provider uses its own login contract without a host-name branch', function (t) {
  registry.VENDOR_REGISTRY.synthetic = Object.assign({}, registry.VENDOR_REGISTRY.codex, { terminalLoginCommand: 'synthetic login', browserLoginCommand: null });
  try {
    var f = fixture(t, 'synthetic'); f.emit(); f.login.handleVendorLoginMessage(f.ws, f.request());
    assert.equal(f.terminals[0].options.initialInput, 'synthetic login\n');
  } finally { delete registry.VENDOR_REGISTRY.synthetic; }
});
