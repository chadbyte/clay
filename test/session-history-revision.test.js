'use strict';
var fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var fixtureRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-history-revisions-'));
process.env.HOME = fixtureRoot;
process.env.CLAY_HOME = path.join(fixtureRoot, '.clay');
process.env.CLAY_CONFIG = path.join(process.env.CLAY_HOME, 'daemon.json');
process.env.CODEX_HOME = path.join(fixtureRoot, '.codex');
process.env.SUDO_USER = '';
process.env.SUDO_HOME = '';
var test = require('node:test'), assert = require('node:assert/strict');
var history = require('../lib/session-history');
var createSessionManager = require('../lib/sessions').createSessionManager;
var attachHistoryActions = require('../lib/project-session-history-actions').attachSessionHistoryActions;
var attachSessions = require('../lib/project-sessions').attachSessions;
test.after(function () { fs.rmSync(fixtureRoot, { recursive: true, force: true }); });
function fixture(t) {
  var root = fs.mkdtempSync(path.join(fixtureRoot, 'case-')), sent = [];
  var options = { cwd: path.join(root, 'project'), sessionsBase: path.join(root, 'sessions'), cliSessionsDir: path.join(root, 'cli'),
    send: function (message) { sent.push(JSON.parse(JSON.stringify(message))); },
    sendTo: function (_, message) { sent.push(JSON.parse(JSON.stringify(message))); } };
  var sm = createSessionManager(options), session = sm.createSessionRaw({ vendor: 'codex' });
  return { sm: sm, session: session, options: options, sent: sent, root: root };
}
function replay(f, transform) {
  f.sent.length = 0; f.sm.replayHistory(f.session, undefined, {}, transform);
  return f.sent.find(function (message) { return message.type === 'history_done'; }).controlHistoryRevision;
}
test('production recording copies inputs and repeated replay reads share the exact stable revision', function (t) {
  var f = fixture(t), event = { type: 'tool_result', id: 'tool', content: [{ text: 'before' }], input: { options: ['one'] } };
  var initial = history.revision(f.session);
  f.sm.sendAndRecord(f.session, event);
  var recorded = history.revision(f.session);
  assert.notEqual(recorded, initial);
  event.content[0].text = 'escape'; event.input.options.push('escape');
  assert.equal(f.session.history[0].content[0].text, 'before');
  assert.deepEqual(f.session.history[0].input.options, ['one']);
  assert.throws(function () { f.session.history[0].content[0].text = 'escape'; }, TypeError);
  assert.throws(function () { f.session.history[0] = event; }, /mutation service/);
  assert.throws(function () { Object.defineProperty(f.session.history, '0', { value: event }); }, /mutation service/);
  var crypto = require('node:crypto'), createHash = crypto.createHash, hashes = 0;
  crypto.createHash = function () { hashes++; return createHash.apply(crypto, arguments); };
  try { for (var i = 0; i < 4; i++) assert.equal(replay(f), recorded); }
  finally { crypto.createHash = createHash; }
  assert.equal(hashes, 0, 'unchanged production replay never hashes transcript content');
  assert.equal(history.revision(f.session), recorded);
});
test('nested tool output updates and same-length replacement invalidate revisions without mutable aliases', function (t) {
  var f = fixture(t);
  history.append(f.session, { type: 'tool_result', id: 'tool', content: [{ text: 'same' }] });
  var reference = f.session.history[0], before = history.snapshot(f.session);
  history.update(f.session, 0, function (draft) { draft.content[0].text = 'edit'; });
  assert.equal(reference.content[0].text, 'edit', 'retained record views observe authoritative edits');
  assert.equal(before.history[0].content[0].text, 'same', 'replay snapshots retain immutable prior values');
  assert.notEqual(replay(f), before.revision);
  var changed = history.revision(f.session);
  history.editRecord(reference, function () {});
  assert.equal(history.revision(f.session), changed, 'a semantic no-op edit keeps its revision');
  var replacement = [{ type: 'tool_result', id: 'tool', content: [{ text: 'swap' }] }];
  f.session.history = replacement;
  assert.notEqual(history.revision(f.session), changed);
  replacement[0].content[0].text = 'lost'; replacement.push({ type: 'delta', text: 'lost' });
  assert.equal(f.session.history.length, 1); assert.equal(f.session.history[0].content[0].text, 'swap');
  assert.throws(function () { history.editRecord(reference, function (draft) { draft.content = 'stale'; }); }, /replaced or removed/);
});
test('reentrant replay transforms retain one snapshot and callbacks cannot overwrite intervening edits', function (t) {
  var f = fixture(t);
  history.replace(f.session, [{ type: 'user_message', text: 'start' }, { type: 'delta', text: 'old' }]);
  var before = history.revision(f.session), changed = false;
  assert.equal(replay(f, function (entry) {
    if (!changed) { changed = true; history.update(f.session, 1, function (draft) { draft.text = 'new'; }); }
    return entry;
  }), before);
  assert.equal(f.sent.find(function (entry) { return entry.type === 'delta'; }).text, 'old');
  assert.notEqual(before, history.revision(f.session));
  assert.throws(function () {
    history.update(f.session, 1, function (draft) { history.append(f.session, { type: 'done' }); draft.text = 'stale'; });
  }, /history changed/);
  assert.equal(f.session.history[1].text, 'new');
});
test('stale asynchronous receipts, retired sessions and deletion/recreation cannot share mutation authority', async function (t) {
  var f = fixture(t), stale = history.revision(f.session);
  await Promise.resolve(); history.append(f.session, { type: 'user_message', text: 'new input' });
  assert.throws(function () { history.replace(f.session, [], stale); }, /history changed/);
  var replacement = Object.assign({}, f.session);
  f.sm.sessions.set(f.session.localId, replacement);
  assert.throws(function () { history.append(f.session, { type: 'delta', text: 'wrong identity' }); }, /identity was replaced/);
  assert.equal(f.sm.saveSessionFile(f.session), false);
  f.sm.sessions.set(f.session.localId, f.session);
  assert.equal(f.sm.saveSessionFile(f.session), true);
  var old = f.session, oldRevision = history.revision(old);
  f.sm.deleteSessionQuiet(old.localId);
  assert.throws(function () { history.append(old, { type: 'delta', text: 'late' }); }, /retired/);
  assert.equal(f.sm.sendAndRecord(old, { type: 'delta', text: 'late' }), false);
  assert.equal(f.sm.saveSessionFile(old), false);
  var recreated = f.sm.createSessionRaw({ vendor: 'codex' });
  recreated.sessionOriginId = old.sessionOriginId;
  assert.notEqual(history.revision(recreated), oldRevision);
});
test('save/reload produces a fresh epoch with identical durable transcript contents', function (t) {
  var f = fixture(t);
  f.sm.sendAndRecord(f.session, { type: 'user_message', text: 'persisted' });
  assert.equal(f.sm.saveSessionFile(f.session), true);
  var before = history.snapshot(f.session), restarted = createSessionManager(f.options);
  var restored = Array.from(restarted.sessions.values()).find(function (session) { return session.sessionOriginId === f.session.sessionOriginId; });
  assert.ok(restored);
  assert.deepEqual(history.snapshot(restored).history, before.history);
  assert.notEqual(history.revision(restored), before.revision);
});
test('production fork and rewind isolate history ownership and reject mutation while provider work awaits', async function (t) {
  var f = fixture(t), source = f.session;
  history.replace(source, [{ type: 'user_message', text: 'first' }, { type: 'delta', text: 'answer' },
    { type: 'user_message', text: 'second' }, { type: 'message_uuid', uuid: 'u2', messageType: 'user' }]);
  source.messageUUIDs = [{ uuid: 'u2', type: 'user', historyIndex: 3, turnId: 'turn2' }];
  var sdk = { forkSession: async function () { return { useLocalHistory: true, sessionId: 'forked', localHistoryEndIndex: 2 }; },
    rollbackConversation: async function () {} };
  var actions = attachHistoryActions({ sm: f.sm, sdk: sdk, cwd: f.options.cwd, slug: 'fixture',
    cancelPendingAskUser: function () {}, onProcessingChanged: function () {} });
  var fork = await actions.fork(source, 'u2', null, function () {}), revision = history.revision(source);
  assert.equal(fork.history.length, 2);
  assert.notEqual(history.revision(fork), revision);
  history.update(fork, 0, function (draft) { draft.text = 'fork only'; });
  assert.equal(source.history[0].text, 'first');
  await actions.rewind(source, 'u2', 'chat', null, function () {});
  assert.notEqual(history.revision(source), revision);
  assert.equal(source.history[0].text, 'first');
  assert.equal(source.history.some(function (entry) { return entry.text === 'second'; }), false);
  var resolveFork;
  sdk.forkSession = function () { return new Promise(function (resolve) { resolveFork = resolve; }); };
  var pending = actions.fork(source, 'u2', null, function () {});
  history.update(source, 0, function (draft) { draft.text = 'concurrent'; });
  resolveFork({ useLocalHistory: true, sessionId: 'stale-provider-fork' });
  await assert.rejects(pending, /source conversation changed/);
  history.replace(source, [{ type: 'user_message', text: 'first' }, { type: 'user_message', text: 'second' },
    { type: 'message_uuid', uuid: 'u2', messageType: 'user' }]);
  source.messageUUIDs = [{ uuid: 'u2', type: 'user', historyIndex: 2, turnId: 'turn2' }];
  var resolveRollback;
  sdk.rollbackConversation = function () { return new Promise(function (resolve) { resolveRollback = resolve; }); };
  var pendingRewind = actions.rewind(source, 'u2', 'chat', null, function () {});
  history.update(source, 0, function (draft) { draft.text = 'changed while reverting'; });
  resolveRollback();
  await assert.rejects(pendingRewind, /source conversation changed/);
  assert.equal(source.history.length, 3, 'concurrent work is never truncated');
  assert.equal(source._rewindInProgress, false);
});
test('production GUI hydration replaces same-length native history and severs reader-owned references', function (t) {
  var f = fixture(t), session = f.session, cli = require('../lib/yoke/cli-sessions');
  var priorMtime = cli.cliSessionFileMtime, priorRead = cli.readCliSessionHistorySync, clock = 1;
  var incoming = [{ type: 'user_message', text: 'native one' }];
  cli.cliSessionFileMtime = function () { return clock; };
  cli.readCliSessionHistorySync = function () { return incoming; };
  try {
    session.mode = 'tui'; session.cliSessionId = 'synthetic-native'; session.vendor = 'claude';
    var handler = attachSessions({ cwd: f.options.cwd, opts: {}, sm: f.sm, sdk: {}, clients: new Set(),
      tm: { has: function () { return false; } } });
    handler.resolveSessionForView(session, {});
    var first = history.revision(session);
    incoming[0].text = 'external mutation';
    assert.equal(session.history[0].text, 'native one');
    clock++; incoming = [{ type: 'user_message', text: 'native two' }];
    handler.resolveSessionForView(session, {});
    assert.equal(session.history.length, 1); assert.equal(session.history[0].text, 'native two');
    assert.notEqual(history.revision(session), first);
  } finally {
    if (session._titleWatcherStop) session._titleWatcherStop();
    cli.cliSessionFileMtime = priorMtime; cli.readCliSessionHistorySync = priorRead;
  }
});
test('durable append rollback advances the authority and removes only its own exact entry', function (t) {
  var f = fixture(t); assert.equal(f.sm.saveSessionFile(f.session), true);
  var before = history.revision(f.session), append = fs.appendFileSync;
  fs.appendFileSync = function () { throw new Error('Synthetic append failure'); };
  try { assert.equal(f.sm.sendAndRecordDurably(f.session, { type: 'delta', text: 'undurable' }), false); }
  finally { fs.appendFileSync = append; }
  assert.equal(f.session.history.length, 0);
  assert.notEqual(history.revision(f.session), before);
  var owned = history.append(f.session, { type: 'delta', text: 'owned' });
  history.append(f.session, { type: 'delta', text: 'later' });
  assert.equal(history.removeLast(f.session, owned), false);
  assert.equal(f.session.history[1].text, 'later');
});
