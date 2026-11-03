var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
// Isolate all configuration before loading the presence/session services.
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-entry-visits-'));
os.homedir = function () { return root; };
process.env.CLAY_HOME = path.join(root, '.clay');
process.env.CLAY_CONFIG = path.join(root, '.clay', 'daemon.json');
process.env.CODEX_HOME = path.join(root, '.codex');
process.env.CLAUDE_CONFIG_DIR = path.join(root, '.claude');
var presence = require('../lib/user-presence');
var policy = require('../lib/project-entry-policy');
test('visits persist by exact user/project and durable origin, prune removed sessions and stay bounded', async function () {
  var sessions = Array.from({ length: 105 }, function (_, i) { return { localId: i + 1, sessionOriginId: 'origin-' + i }; });
  sessions.forEach(function (session) { presence.recordVisit('alpha', 'alice', session, sessions); });
  presence.recordVisit('alpha', 'bob', sessions[0], sessions);
  presence.recordVisit('beta', 'alice', sessions[1], sessions);
  presence.setPresence('alpha', 'alice', 105, null);
  presence.setMateDm('alpha', 'alice', null);
  assert.equal(presence.getVisits('alpha', 'alice', sessions).length, 100);
  assert.equal(presence.getVisits('alpha', 'alice', sessions)[0].originId, 'origin-104');
  assert.equal(presence.getVisits('alpha', 'bob', sessions)[0].originId, 'origin-0');
  assert.equal(presence.getVisits('beta', 'alice', sessions)[0].originId, 'origin-1');
  presence.recordVisit('alpha', 'alice', sessions[3], [sessions[3]]);
  assert.equal(presence.getVisits('alpha', 'alice', sessions).length, 1);
  await new Promise(function (resolve) { setTimeout(resolve, 250); });
  delete require.cache[require.resolve('../lib/user-presence')];
  var reloaded = require('../lib/user-presence');
  assert.equal(reloaded.getVisits('alpha', 'alice', sessions)[0].originId, 'origin-3');
  assert.equal(reloaded.getVisits('alpha', 'bob', sessions)[0].originId, 'origin-0');
  assert.equal(reloaded.getVisits('beta', 'bob', sessions).length, 0);
});
test('legacy fallback resolves only exact durable provider identity, never guesses renumbered local ids', function () {
  var sessions = [{ localId: 1, sessionOriginId: 'safe', cliSessionId: 'provider-safe' }];
  presence.setPresence('legacy', 'alice', 1, null);
  assert.deepEqual(presence.getVisits('legacy', 'alice', sessions), []);
  presence.setPresence('legacy', 'alice', 'provider-safe', null);
  assert.equal(presence.getVisits('legacy', 'alice', sessions)[0].originId, 'safe');
});
test('production session persistence preserves work-stop time across replay, metadata saves and restart', function () {
  var create = require('../lib/sessions').createSessionManager;
  var cwd = path.join(root, 'project'); fs.mkdirSync(cwd, { recursive: true });
  function manager() { return create({ createInitialSession: false, cwd: cwd, sessionsBase: path.join(root, 'sessions'), cliSessionsDir: path.join(root, 'empty-cli'), send: function () {} }); }
  var sm = manager();
  assert.equal(sm.sessions.size, 0, 'ordinary project startup can remain empty');
  var session = sm.createSessionRaw({}), stopped;
  session.isProcessing = true; sm.observeWorkActivity();
  session.isProcessing = false; sm.observeWorkActivity(); stopped = session.workStoppedAt;
  assert.ok(stopped > 0);
  session._entryWorkActive = true; // A delayed observer must not make a read stamp inactivity.
  sm.switchSession(session.localId, { readyState: 1 });
  sm.saveSessionFile(session); sm.broadcastSessionList();
  assert.equal(session.workStoppedAt, stopped);
  var restored = manager();
  var same = Array.from(restored.sessions.values()).find(function (item) { return item.sessionOriginId === session.sessionOriginId; });
  assert.equal(same.workStoppedAt, stopped);
  assert.equal(policy.stoppedAt(same), stopped);
  session._entryWorkActive = false;
  session.activeBackgroundTasks = [{ task_id: 'real-user-work' }];
  sm.sendToSession(session, { type: 'active_background_tasks', tasks: session.activeBackgroundTasks });
  assert.equal(session._entryWorkActive, true);
  session.activeBackgroundTasks = [];
  sm.sendToSession(session, { type: 'active_background_tasks', tasks: [] });
  assert.equal(session._entryWorkActive, false);
  assert.ok(session.workStoppedAt >= stopped, 'live background-task completion records its work-stop transition');

});
test('human Stop message persists approval and input falling transitions once without renewing idle or read activity', function (t) {
  var create = require('../lib/sessions').createSessionManager;
  var attachSessions = require('../lib/project-sessions').attachSessions;
  var cwd = path.join(root, 'stop-project'); fs.mkdirSync(cwd, { recursive: true });
  function manager() { return create({ createInitialSession: false, cwd: cwd, sessionsBase: path.join(root, 'stop-sessions'), cliSessionsDir: path.join(root, 'empty-cli'), send: function () {} }); }
  var sm = manager(), clock = 1800000000000, writes = [], originalWrite = fs.writeFileSync;
  t.mock.method(Date, 'now', function () { return clock; });
  t.mock.method(fs, 'writeFileSync', function (file, data) {
    if (String(file).includes('.jsonl') && typeof data === 'string') writes.push(JSON.parse(data.split('\n')[0]));
    return originalWrite.apply(fs, arguments);
  });
  var hooks = [], attached = attachSessions({ sm: sm, sdk: { cancelResponseRecovery: function () { hooks.push('cancel'); } },
    clients: new Set(), opts: {}, usersModule: { isMultiUser: function () { return false; } }, getSessionForWs: function () { return null; },
    onPendingQueuePause: function () { hooks.push('pause'); }, onHumanPairStop: function () { hooks.push('pair'); } });
  function stop(session) { return attached.handleSessionsMessage({}, { type: 'stop', sessionId: session.localId, sessionOriginId: session.sessionOriginId }); }
  ['pendingPermissions', 'pendingAskUser', 'pendingUserDialogs', 'pendingElicitations'].forEach(function (key) {
    var session = sm.createSessionRaw({}), oldStop = clock - 3 * 86400000;
    session.workStoppedAt = oldStop; session[key] = { request: { requestId: 'pending' } };
    sm.saveSessionFile(session); writes.length = 0;
    assert.equal(session.queryInstance, null); assert.equal(session.isProcessing, false);
    assert.equal(policy.working(session), true, key);
    assert.equal(stop(session), true);
    assert.equal(policy.working(session), false, key);
    assert.equal(session.workStoppedAt, clock, key + ': Stop records the real transition without a query');
    assert.equal(writes.length, 1, key + ': exactly one transition metadata write');
    assert.equal(writes[0].workStoppedAt, clock);
    var stopped = session.workStoppedAt;
    clock += 1000; writes.length = 0;
    stop(session); sm.observeWorkActivity(session);
    sm.switchSession(session.localId, { readyState: 1 }); sm.broadcastSessionList();
    presence.recordVisit('stop-project', 'owner', session, Array.from(sm.sessions.values()));
    assert.equal(session.workStoppedAt, stopped, key + ': repeat Stop, replay, list and visit do not renew work');
    assert.equal(writes.length, 0, key + ': no repeat transition write');
    var restored = Array.from(manager().sessions.values()).find(function (item) { return item.sessionOriginId === session.sessionOriginId; });
    assert.equal(restored.workStoppedAt, stopped, key + ': transition survives a manager restart');
  });
  var idle = sm.createSessionRaw({}); idle.workStoppedAt = clock - 5 * 86400000;
  idle._entryWorkActive = true; // A stale observation must not turn an idle Stop into new work.
  var idleStop = idle.workStoppedAt; writes.length = 0;
  stop(idle); stop(idle);
  assert.equal(idle.workStoppedAt, idleStop); assert.equal(writes.length, 0);
  assert.equal(hooks.length, 30, 'the ordinary Stop hooks still run for every request');
  var processing = sm.createSessionRaw({}), interrupted = false;
  processing.isProcessing = true; processing.workStoppedAt = idleStop;
  processing.abortController = { abort: function () { interrupted = true; } };
  writes.length = 0;
  assert.equal(stop(processing), true);
  assert.equal(interrupted, true);
  assert.equal(processing.workStoppedAt, idleStop, 'a queued Stop is not completed work');
  assert.equal(writes.length, 0);
  clock += 1000; processing.isProcessing = false;
  sm.observeWorkActivity(processing); sm.observeWorkActivity(processing);
  assert.equal(processing.workStoppedAt, clock, 'actual runtime completion stamps stopped work');
  assert.equal(writes.length, 1);
});
test.after(async function () { await new Promise(function (resolve) { setTimeout(resolve, 250); }); fs.rmSync(root, { recursive: true, force: true }); });
