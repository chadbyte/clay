var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
// Isolate configuration, registry and persistence before importing product code.
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pane-activation-'));
process.env.CLAY_HOME = root;
process.env.CLAY_CONFIG = path.join(root, 'daemon.json');
delete process.env.CLAY_DEV;
fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify({ multiUser: true, users: [
  { id: 'owner', username: 'Owner', role: 'user' },
  { id: 'foreign', username: 'Foreign', role: 'user' },
], invites: [] }));
var test = require('node:test');
var assert = require('node:assert/strict');
var users = require('../lib/users');
var createSessionManager = require('../lib/sessions').createSessionManager;
var attachSessions = require('../lib/project-sessions').attachSessions;
var begin = require('../lib/pane-session-activation').begin;
var provenance = require('../lib/session-provenance');
var WebSocket = require('ws');
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });

function fixture(t) {
  var dir = fs.mkdtempSync(path.join(root, 'case-'));
  var sent = [];
  var access = { slug: 'fixture', ownerId: 'owner', visibility: 'private', allowedUsers: [] };
  var clients = new Set();
  function sendTo(ws, msg) {
    var copy = JSON.parse(JSON.stringify(msg));
    if (copy.type === 'pane_history_batch') copy.items.forEach(function (item) { sent.push(Object.assign({}, item, { paneActivation: copy.paneActivation })); });
    else sent.push(copy);
    if (typeof ws.send === 'function' && ws.readyState === 1) ws.send(JSON.stringify(copy));
  }
  var sm = createSessionManager({ cwd: path.join(dir, 'project'), sessionsBase: path.join(dir, 'sessions'),
    cliSessionsDir: path.join(dir, 'cli'), send: function () {}, sendTo: sendTo,
    sendEach: function (fn) { clients.forEach(function (ws) {
      fn(ws, function (session) { return users.canAccessSession(ws._clayUser.id, session, access); });
    }); } });
  var sessions = [];
  for (var i = 0; i < 5; i++) {
    var session = sm.createSessionRaw({ ownerId: 'owner', vendor: 'codex', effort: 'medium' });
    session.history = [{ type: 'user_message', text: 'Unseen session ' + i }, { type: 'delta', text: 'Unique transcript ' + i }];
    sessions.push(session);
  }
  provenance.markWorker(sessions[0], sessions[1], sm.sessions);
  provenance.markWorker(sessions[2], sessions[3], sm.sessions);
  var ws = { readyState: 1, send: function () {}, _clayPane: true, _clayUser: users.findUserById('owner'), _clayActiveSession: sessions[0].localId };
  clients.add(ws);
  var context = { cwd: dir, slug: 'fixture', sm: sm, sdk: {}, clients: clients, opts: {}, usersModule: users,
    getProjectAccess: function () { return access; }, send: function () {}, sendTo: sendTo,
    getSessionForWs: function (socket) { return sm.sessions.get(socket._clayActiveSession); },
    hydrateImageRefs: function (item) { return item; }, broadcastPresence: function () {},
    loadContextSources: function (slug, id) { return [{ path: 'context-' + id }]; },
    userPresence: { setPresence: function () {}, sessionIdForPersistence: function (session) { return session.localId; } } };
  var handler = attachSessions(context).handleSessionsMessage;
  function request(session, generation) {
    return { type: 'switch_session', id: session.localId, paneActivation: {
      requestId: 'activation-' + generation, generation: generation, projectSlug: 'fixture', viewerId: 'owner', ownerId: 'owner',
      sessionOriginId: session.sessionOriginId, role: provenance.isWorker(session) ? 'worker' : 'driver',
      workerGeneration: provenance.isWorker(session) ? session.sessionProvenance.generation : null,
    } };
  }
  return { ws: ws, sm: sm, sessions: sessions, sent: sent, context: context, clients: clients,
    access: access, handler: handler, request: request };
}

test('authenticated existing switch path retargets two pairs and a standalone with a complete correlated snapshot', function (t) {
  var f = fixture(t);
  f.sessions[3].isProcessing = true;
  f.sessions[3].pendingPermissions.review = { requestId: 'review', toolName: 'Read', toolInput: { path: '/fixture' } };
  f.sessions[3].pendingAskUser.question = { input: { questions: [{ question: 'Exact pending question', options: [] }] } };
  f.sessions[3].pendingElicitations = { form: { request: { serverName: 'Fixture', message: 'Exact pending form' } } };
  f.sessions[3].pendingUserDialogs = { dialog: { request: { dialogKind: 'review', payload: { title: 'Exact pending dialog' } } } };
  f.sm.addOnSessionViewed(function (session, ws, send) { send({ type: 'scheduled_messages', sessionId: session.localId, items: [] }); });
  f.sessions.forEach(function (session, i) {
    f.sent.length = 0;
    assert.equal(f.handler(f.ws, f.request(session, i + 1)), true);
    assert.equal(f.ws._clayActiveSession, session.localId);
    assert.equal(f.sent[0].type, 'pane_activation_started');
    assert.equal(f.sent[f.sent.length - 1].type, 'pane_activation_snapshot_done');
    var snapshot = f.sent.filter(function (item) { return item.paneActivation; });
    snapshot.forEach(function (item) { assert.deepEqual(item.paneActivation, f.ws._clayPaneActivation); });
    assert.equal(snapshot.find(function (item) { return item.type === 'session_switched'; }).id, session.localId);
    assert.equal(snapshot.find(function (item) { return item.type === 'user_message'; }).text, 'Unseen session ' + i);
    var order = snapshot.map(function (item) { return item.type; });
    assert.ok(order.indexOf('history_done') < order.indexOf('scheduled_messages'));
    assert.ok(order.indexOf('context_sources_state') < order.indexOf('pane_activation_snapshot_done'));
    if (i === 3) {
      assert.ok(order.indexOf('history_done') < order.indexOf('permission_request_pending'));
      assert.ok(order.indexOf('status') < order.indexOf('pane_activation_snapshot_done'));
      ['ask_user_pending', 'elicitation_request', 'user_dialog_request'].forEach(function (type) {
        assert.ok(order.indexOf('history_done') < order.indexOf(type));
        assert.ok(order.indexOf(type) < order.indexOf('pane_activation_snapshot_done'));
      });
      assert.equal(session.isProcessing, true, 'view selection never stops the provider');
      assert.ok(session.pendingPermissions.review, 'view selection never answers a review');
    }
  });
});

test('forged identity, stale generation and unavailable targets fail before activation or replay', function (t) {
  var mutations = [
    function (f, m) { m.paneActivation.projectSlug = 'foreign'; },
    function (f, m) { m.paneActivation.viewerId = 'foreign'; },
    function (f, m) { m.paneActivation.ownerId = 'foreign'; },
    function (f, m) { m.paneActivation.sessionOriginId = 'replaced'; },
    function (f, m) { m.paneActivation.role = 'driver'; },
    function (f, m) { m.paneActivation.workerGeneration++; },
    function (f, m) { m.paneActivation.generation = 0; },
    function (f, m) { m.paneActivation.generation = 1.5; },
    function (f, m) { m.paneActivation.requestId = 'x'.repeat(97); },
    function (f) { f.ws._clayPaneActivationGeneration = 1; },
    function (f) { f.ws._clayPane = false; },
    function (f) { f.ws._clayContextual = true; },
    function (f) { f.context.isMate = true; },
    function (f) { f.sessions[1].isMate = true; },
    function (f) { f.sessions[1].runtimeMode = 'tui'; },
    function (f) { f.sessions[1].tuiSuspended = true; },
    function (f) { f.sessions[1].ownerId = 'foreign'; },
    function (f) { f.ws._clayUser = users.findUserById('foreign'); },
    function (f) { f.ws._clayUser = null; },
    function (f) { f.ws._clayAuthCheck = function () { return false; }; },
    function (f) { f.sm.sessions.delete(f.sessions[1].localId); },
    function (f, m) { m.paneActivation = null; },
  ];
  mutations.forEach(function (mutate, index) {
    var f = fixture(t), msg = f.request(f.sessions[1], 1), before = f.ws._clayActiveSession;
    mutate(f, msg);
    assert.equal(f.handler(f.ws, msg), true, 'case ' + index);
    assert.equal(f.ws._clayActiveSession, before, 'no selection mutation in case ' + index);
    assert.deepEqual(f.sent.map(function (item) { return item.type; }), ['pane_activation_rejected'], 'no history disclosure in case ' + index);
  });
});

test('captured A/B snapshot senders cannot send after C, standalone navigation, revocation, replacement or disconnect', function (t) {
  var mutations = [
    function (f) { f.handler(f.ws, f.request(f.sessions[4], 3)); },
    function (f) { f.handler(f.ws, { type: 'switch_session', id: f.sessions[4].localId }); },
    function (f) { f.sm.switchSession(f.sessions[4].localId, f.ws); },
    function (f) { f.access.ownerId = 'foreign'; },
    function (f) { f.ws._clayUser = users.findUserById('foreign'); },
    function (f) { f.ws.readyState = 3; },
    function (f) { f.ws._clayAuthCheck = function () { return false; }; },
    function (f) { f.sm.sessions.set(f.sessions[2].localId, Object.assign({}, f.sessions[2])); },
    function (f) { f.sessions[2].sessionOriginId = 'replacement-origin'; },
    function (f) { f.sessions[2].ownerId = 'foreign'; },
  ];
  mutations.forEach(function (mutate) {
    var f = fixture(t);
    var a = begin(f.context, f.ws, f.request(f.sessions[0], 1));
    var b = begin(f.context, f.ws, f.request(f.sessions[2], 2));
    f.ws._clayActiveSession = f.sessions[2].localId;
    mutate(f); f.sent.length = 0;
    a.send({ type: 'delta', text: 'stale A' }); a.finish();
    b.send({ type: 'delta', text: 'stale B' }); b.finish();
    assert.deepEqual(f.sent, []);
  });
});

test('correlated replay keeps complete long turns, the 300-entry initial target and 100-entry pagination', function (t) {
  var f = fixture(t), target = f.sessions[2];
  target.history = Array.from({ length: 650 }, function (_, i) { return { type: i % 5 === 0 ? 'user_message' : 'delta', text: 'Entry ' + i }; });
  f.handler(f.ws, f.request(target, 1));
  assert.equal(f.sent.find(function (msg) { return msg.type === 'history_meta'; }).from, 350);
  assert.equal(f.sent.filter(function (msg) { return Number.isInteger(msg._historyIndex); }).length, 300);
  assert.equal(f.sm.HISTORY_PAGE_SIZE, 100);
  target.history.forEach(function (msg, i) { if (i) msg.type = 'delta'; });
  f.sent.length = 0; f.handler(f.ws, f.request(target, 2));
  assert.equal(f.sent.find(function (msg) { return msg.type === 'history_meta'; }).from, 0);
  assert.equal(f.sent.filter(function (msg) { return Number.isInteger(msg._historyIndex); }).length, 650);
});

test('bounded replay envelopes revalidate live access, auth and exact target before every disclosure', function (t) {
  [function (f) { f.access.ownerId = 'foreign'; },
    function (f) { f.ws._clayAuthCheck = function () { return false; }; },
    function (f) { f.sessions[2].sessionOriginId = 'replaced'; },
    function (f) { f.ws._clayPaneActivation = null; },
  ].forEach(function (invalidate) {
    var f = fixture(t), target = f.sessions[2], wire = [], original = f.context.sendTo;
    target.history = Array.from({ length: 501 }, function (_, index) { return { type: index ? 'delta' : 'user_message', text: 'entry ' + index }; });
    f.context.sendTo = function (ws, message) {
      wire.push(message); original(ws, message);
      if (message.type === 'pane_history_batch') invalidate(f);
    };
    f.handler(f.ws, f.request(target, 1));
    var batches = wire.filter(function (message) { return message.type === 'pane_history_batch'; });
    assert.equal(batches.length, 1, 'revocation after the first batch suppresses every later batch');
    assert.equal(batches[0].items.length, 100);
    assert.equal(batches[0].items[0].type, 'history_meta');
    assert.equal(batches[0].items[99]._historyIndex, 98);
    assert.ok(!wire.some(function (message) { return message.type === 'history_done' || message.type === 'pane_activation_snapshot_done'; }));
  });
});

test('Worker provenance changes and authorization revocation during hydration suppress snapshot completion', function (t) {
  [function (f) { f.sessions[1].sessionProvenance.generation++; },
    function (f) { f.access.ownerId = 'foreign'; },
    function (f) { f.ws._clayAuthCheck = function () { return false; }; },
  ].forEach(function (invalidate) {
    var f = fixture(t);
    f.sm.addOnSessionViewed(function () { invalidate(f); });
    f.handler(f.ws, f.request(f.sessions[1], 1));
    assert.ok(f.sent.some(function (msg) { return msg.type === 'history_done'; }));
    assert.ok(!f.sent.some(function (msg) { return msg.type === 'pane_activation_snapshot_done'; }));
  });
});

test('late mode changes during final hydration refuse activation before changing the authoritative socket target', function (t) {
  var f = fixture(t), before = f.ws._clayActiveSession;
  f.sm.setSessionHydrator(function (session) { session.runtimeMode = 'tui'; });
  f.handler(f.ws, f.request(f.sessions[2], 1));
  assert.equal(f.ws._clayActiveSession, before);
  assert.ok(f.sent.some(function (msg) { return msg.type === 'pane_activation_rejected'; }));
  assert.ok(!f.sent.some(function (msg) { return msg.type === 'pane_activation_snapshot_done' || msg.type === 'session_switched'; }));
});

test('parent replacement invalidates an existing Worker activation even with an identical origin', function (t) {
  var f = fixture(t), activation = begin(f.context, f.ws, f.request(f.sessions[1], 1));
  f.ws._clayActiveSession = f.sessions[1].localId;
  f.sm.sessions.set(f.sessions[0].localId, Object.assign({}, f.sessions[0]));
  f.sent.length = 0; activation.send({ type: 'delta', text: 'stale parent' }); activation.finish();
  assert.deepEqual(f.sent, []);
});

test('normal standalone switch remains untagged and retains its existing navigation path', function (t) {
  var f = fixture(t); f.ws._clayPane = false;
  assert.equal(f.handler(f.ws, { type: 'switch_session', id: f.sessions[4].localId }), true);
  assert.equal(f.ws._clayActiveSession, f.sessions[4].localId);
  assert.ok(f.sent.some(function (item) { return item.type === 'history_done'; }));
  assert.ok(f.sent.every(function (item) { return !item.paneActivation && !/^pane_activation_/.test(item.type); }));
});

test('a real WebSocket retains the same connection across 35 authenticated uncached target activations', { timeout: 15000 }, async function (t) {
  var f = fixture(t), socket;
  var server = new WebSocket.Server({ port: 0, host: '127.0.0.1' });
  t.after(function () { server.clients.forEach(function (client) { client.terminate(); }); server.close(); if (socket) socket.terminate(); });
  await new Promise(function (resolve) { server.once('listening', resolve); });
  var connections = 0;
  server.on('connection', function (ws) {
    connections++;
    // Transport authenticates a fixture-only principal; product ACL/provenance
    // checks and the session manager remain the actual implementation.
    ws._clayUser = users.findUserById('owner'); ws._clayPane = true;
    ws.on('message', function (data) { f.handler(ws, JSON.parse(data)); });
  });
  socket = new WebSocket('ws://127.0.0.1:' + server.address().port);
  await new Promise(function (resolve, reject) { socket.once('open', resolve); socket.once('error', reject); });
  for (var i = 1; i <= 35; i++) {
    var target = f.sessions[i % f.sessions.length];
    target.history.push({ type: 'delta', text: 'Previously unseen update ' + i });
    var messages = await new Promise(function (resolve, reject) {
      var received = [];
      var timer = setTimeout(function () { reject(new Error('Activation did not finish')); }, 2000);
      function receive(data) {
        var msg = JSON.parse(data);
        if (msg.type === 'pane_history_batch') msg.items.forEach(function (item) { received.push(Object.assign({}, item, { paneActivation: msg.paneActivation })); });
        else received.push(msg);
        if (msg.type === 'pane_activation_snapshot_done') { clearTimeout(timer); socket.off('message', receive); resolve(received); }
      }
      socket.on('message', receive); socket.send(JSON.stringify(f.request(target, i)));
    });
    assert.equal(messages[messages.length - 1].paneActivation.sessionId, target.localId);
    assert.ok(messages.some(function (msg) { return msg.text === 'Previously unseen update ' + i; }));
  }
  assert.equal(connections, 1, 'no socket replacement or cache-only shortcut');
});
