// In-process production activation/replay measurements, not browser or TCP timings.
var fs = require('node:fs'), os = require('node:os'), path = require('node:path'), Module = require('node:module');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pane-delivery-'));
os.homedir = function () { return root; };
process.env.CLAY_HOME = root; process.env.CLAY_CONFIG = path.join(root, 'daemon.json'); delete process.env.CLAY_DEV;
process.env.CODEX_HOME = path.join(root, '.codex'); process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
var cp = require('node:child_process');
['spawn', 'spawnSync', 'execFile', 'execFileSync', 'exec', 'execSync'].forEach(function (name) { cp[name] = function () { throw new Error('No child transports allowed'); }; });
fs.writeFileSync(path.join(root, 'users.json'), JSON.stringify({ multiUser: true, users: [{ id: 'owner', username: 'Owner', role: 'user' }], invites: [] }));
var test = require('node:test'), assert = require('node:assert/strict');
var users = require('../lib/users'), begin = require('../lib/pane-session-activation').begin;
var filename = path.resolve(__dirname, '../lib/sessions.js'), source = fs.readFileSync(filename, 'utf8');
var baseline = new Module(filename, module); baseline.filename = filename; baseline.paths = module.paths;
baseline._compile(source.replace('broadcastSessionList(!!(snapshotSend && targetWs && targetWs._clayPane));', 'broadcastSessionList();'), filename);
var optimized = require('../lib/sessions');
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
function cohort(factory, count, longTurn) {
  var dir = fs.mkdtempSync(path.join(root, 'case-')), clients = [], messages = [], visible = true;
  var access = { ownerId: 'owner', visibility: 'private' };
  function receive(ws, raw) { var message = JSON.parse(raw); messages.push({ socket: ws, message: message, bytes: Buffer.byteLength(raw) }); }
  var manager = factory({ cwd: path.join(dir, 'project'), sessionsBase: path.join(dir, 'sessions'), cliSessionsDir: path.join(dir, 'cli'),
    send: function () {}, sendTo: function (ws, message) { receive(ws, JSON.stringify(message)); },
    sendEach: function (callback) { clients.forEach(function (ws) { callback(ws, function (session) { return visible && users.canAccessSession(ws._clayUser.id, session, access); }); }); } });
  var sessions = [];
  for (var i = 0; i < 24; i++) {
    var session = manager.createSessionRaw({ ownerId: 'owner', vendor: i % 2 ? 'claude' : 'codex', effort: 'medium' });
    session.history = Array.from({ length: 3000 }, function (_, index) { return { type: (longTurn ? index === 0 : index % 50 === 0) ? 'user_message' : 'delta', text: 'Recorded entry ' + index + ' with representative prose and code.\n' }; });
    sessions.push(session);
  }
  for (var c = 0; c <= count; c++) {
    var ws = { readyState: 1, _clayPane: c > 0, _clayUser: users.findUserById('owner'), _clayActiveSession: sessions[0].localId, _clayUnread: {} };
    ws.send = function (raw) { receive(this, raw); }; clients.push(ws);
  }
  var ctx = { slug: 'fixture', sm: manager, usersModule: users, getProjectAccess: function () { return access; }, sendTo: function (ws, msg) { ws.send(JSON.stringify(msg)); } };
  function activate(offset) {
    messages.length = 0;
    var start = performance.now();
    for (var p = 1; p <= count; p++) {
      var ws = clients[p], session = sessions[p + offset];
      var activation = begin(ctx, ws, { id: session.localId, paneActivation: { requestId: 'request-' + offset + '-' + p, generation: (ws._clayPaneActivationGeneration || 0) + 1,
        projectSlug: 'fixture', viewerId: 'owner', ownerId: 'owner', sessionOriginId: session.sessionOriginId, role: 'driver', workerGeneration: null } });
      assert.ok(activation);
      manager.switchSession(session.localId, ws, null, activation.send, activation.validate); activation.finish();
    }
    var lists = messages.filter(function (item) { return item.message.type === 'session_list'; });
    var histories = messages.filter(function (item) { return item.message.type === 'pane_history_batch'; });
    return { ms: +(performance.now() - start).toFixed(3), lists: lists.length, listBytes: lists.reduce(function (sum, item) { return sum + item.bytes; }, 0),
      historyBatches: histories.length, historyEntries: histories.reduce(function (sum, item) { return sum + item.message.items.filter(function (entry) { return entry._historyIndex != null; }).length; }, 0),
      snapshotDone: messages.filter(function (item) { return item.message.type === 'pane_activation_snapshot_done'; }).length };
  }
  var first = activate(0), reuse = activate(8);
  messages.length = 0; visible = false; manager.broadcastSessionList(true);
  assert.equal(messages.filter(function (item) { return item.message.type === 'session_list'; }).length, count + 1, 'visibility change must disclose the fresh empty projection');
  assert.ok(messages.every(function (item) { return item.message.sessions.length === 0; }));
  messages.length = 0; manager.broadcastSessionList(); assert.equal(messages.length, count + 1, 'explicit refresh must not be deduplicated');
  return { first: first, reuse: reuse };
}
test('1/4/8 pane activation suppresses only identical authorized lists and preserves full replay', function () {
  var evidence = [];
  [false, true].forEach(function (longTurn) {
    [1, 4, 8].forEach(function (count) {
      var before = cohort(baseline.exports.createSessionManager, count, longTurn), after = cohort(optimized.createSessionManager, count, longTurn);
      ['first', 'reuse'].forEach(function (phase) {
        assert.equal(after[phase].historyEntries, before[phase].historyEntries);
        assert.equal(after[phase].historyBatches, before[phase].historyBatches);
        assert.equal(after[phase].snapshotDone, count);
        assert.equal(before[phase].lists, count * (count + 1));
        assert.equal(after[phase].lists, phase === 'first' ? 2 * count : count);
      });
      evidence.push({ panes: count, history: longTurn ? '3000-entry single turn' : '3000 entries, 50-entry turns', before: before, after: after });
    });
  });
  console.log('PANE_DELIVERY_EVIDENCE ' + JSON.stringify(evidence));
});
