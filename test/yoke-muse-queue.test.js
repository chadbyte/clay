var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var os = require('node:os');
var createMuseAdapter = require('../lib/yoke/adapters/muse').createMuseAdapter;
var createSDKBridge = require('../lib/sdk-bridge').createSDKBridge;
var createQueue = require('../lib/project-pending-message-queue').createPendingMessageQueue;
var attachUserMessage = require('../lib/project-user-message').attachUserMessage;
async function until(predicate, label) {
  var deadline = Date.now() + 1800;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out: ' + label);
    await new Promise(function (resolve) { setTimeout(resolve, 5); });
  }
}
async function fixture(t, mode, hooks) {
  var sdk = await import('@muse-code/sdk');
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-muse-queue-'));
  var log = path.join(root, 'wire.jsonl');
  var adapter = createMuseAdapter({ cwd: root, _binaryPath: path.join(__dirname, 'fixtures/muse-msp-host.cjs'), _shutdownTimeoutMs: 40,
    _sdk: Object.assign({}, sdk, { spawnMspConnection: function (options) {
      return sdk.spawnMspConnection(Object.assign({}, options, { command: process.execPath,
        args: [path.join(__dirname, 'fixtures/muse-msp-host.cjs')],
        env: Object.assign({}, options.env, { MUSE_FIXTURE_MODE: mode, MUSE_FIXTURE_LOG: log }) }));
    } }) });
  var session = { localId: 'queue-session', sessionOriginId: 'queue-origin', ownerId: 'owner', vendor: 'muse',
    title: 'Queue fixture', titleManuallySet: true, model: 'wonder-1', history: [], messageUUIDs: [],
    pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {}, isProcessing: true };
  var recorded = [];
  var handler;
  function available() {
    if (hooks && hooks.available) hooks.available(api);
    if (handler) setImmediate(function () { handler.consumePendingMessage(session); });
  }
  var sm = { sessions: new Map([[session.localId, session]]), availableModels: [], permissionRequestIndex: {},
    saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {},
    sendToSession: function () {}, sendAndRecord: function (target, message) {
      recorded.push(message); if (hooks && hooks.record) hooks.record(message, api);
    } };
  var queue = createQueue({ filePath: path.join(root, 'queue.json'), slug: 'queue-project',
    authorize: function (target, actor) { return target === session && actor && actor.id === 'owner'; } });
  var bridge = createSDKBridge({ cwd: root, slug: 'queue-project', adapter: adapter, adapters: { muse: adapter },
    sessionManager: sm, send: function () {}, onSessionAvailable: available, onTurnDone: function () {
      if (hooks && hooks.done) hooks.done(api);
      available();
    },
    onProcessingChanged: function () { if (hooks && hooks.changed) hooks.changed(api); } });
  var actor = { id: 'owner' };
  var ws = { readyState: 1, _clayUser: actor, send: function () {} };
  handler = attachUserMessage({ cwd: root, slug: 'queue-project', sm: sm, sdk: bridge, opts: {},
    send: function () {}, sendTo: function () {}, sendToSession: function () {}, sendToSessionOthers: function () {},
    clients: new Set(), usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === 'owner' ? actor : null; } },
    getSessionForWs: function () { return session; }, getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {},
    getOsUserInfoForWs: function () {}, hydrateImageRefs: function (message) { return message; }, imagesDir: root,
    onProcessingChanged: function () {}, browserState: { _browserTabList: {} },
    _loop: { handleLoopMessage: function () { return false; } },
    loadContextSources: function () { return []; }, adapter: adapter, pendingMessageQueue: queue,
    authorizePendingDispatch: function () { return true; } });
  var actions = require('../lib/project-session-actions').attachSessionActions({ sm: sm, sdk: bridge });
  var api = { session: session, adapter: adapter, bridge: bridge, queue: queue, recorded: recorded,
    stop: function () { return actions.stop(session, actor); },
    wire: function () { return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : []; },
    send: function (text, id) { handler.handleUserMessage(ws, { type: 'message', text: text, clientMessageId: id, projectSlug: 'queue-project', sessionId: session.localId, sessionOriginId: session.sessionOriginId, accountId: 'owner' }); },
    command: function (name) { return Array.from(adapter.clients)[0].connection.command('session/setName', { sessionId: session.cliSessionId, name: name }); },
  };
  api.starts = function () {
    var seen = new Set();
    return api.wire().filter(function (row) {
      if (row.method !== 'turn/start' || seen.has(row.params.commandId)) return false;
      seen.add(row.params.commandId); return true;
    });
  };
  t.after(async function () {
    await adapter.shutdown();
    api.wire().filter(function (row) { return row.pid; }).forEach(function (row) {
      assert.throws(function () { process.kill(row.pid, 0); }, /ESRCH/, 'SDK fixture process must be gone');
    });
    fs.rmSync(root, { recursive: true, force: true });
  });
  assert.equal(await bridge.startQuery(session, 'greeting'), true);
  return api;
}

test('foreground-completed SDK turn admits queued follow-up before background terminal without inventing a result', { timeout: 7000 }, async function (t) {
  var f = await fixture(t, 'foreground-wait');
  f.send('알았어.', 'second');
  await until(function () { return f.wire().some(function (row) { return row.method === 'turn/foregroundCompleted'; }); }, 'foreground event');
  await until(function () { return f.starts().length === 2; }, 'queued second turn reaches SDK');
  assert.equal(f.queue.inspect(f.session, { id: 'owner' }, 'second').state, 'consumed');
  await until(function () { return f.recorded.some(function (row) { return row.type === 'result'; }); }, 'second terminal');
  assert.equal(f.recorded.filter(function (row) { return row.type === 'result'; }).length, 1, 'foreground notice is not a terminal');
  assert.equal(f.session.isProcessing, true, 'background turn still pending');
  await f.command('complete-background');
  await until(function () { return !f.session.isProcessing; }, 'real background terminal');
  assert.equal(f.recorded.filter(function (row) { return row.type === 'result'; }).length, 1);
  assert.equal(f.recorded.filter(function (row) { return row.type === 'background_result'; }).length, 1, 'duplicate terminals are ignored');
  assert.equal(f.starts().length, 2);
});

test('a second user message after a real result reuses the persistent SDK session', { timeout: 7000 }, async function (t) {
  var f = await fixture(t, 'complete');
  await until(function () { return f.recorded.some(function (row) { return row.type === 'result'; }); }, 'first result');
  f.send('second message', 'after-result');
  await until(function () { return f.recorded.filter(function (row) { return row.type === 'result'; }).length === 2; }, 'second result');
  assert.equal(f.starts().length, 2);
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.session._awaitingTurnResult, false);
  assert.equal(f.wire().filter(function (row) { return row.method === 'session/start'; }).length, 1);
});

test('synchronous user arrival during terminal processing reaches the SDK exactly once', { timeout: 7000 }, async function (t) {
  var injected = false;
  var f = await fixture(t, 'complete', { changed: function (live) {
    if (live && !live.session.isProcessing && !injected) { injected = true; live.send('synchronous next', 'synchronous-next'); }
  } });
  await until(function () { return f.recorded.filter(function (row) { return row.type === 'result'; }).length === 2; }, 'synchronous follow-up result');
  assert.equal(f.starts().length, 2);
  assert.equal(f.session.history.filter(function (row) { return row.clientMessageId === 'synchronous-next'; }).length, 1);
  assert.equal(f.session.isProcessing, false);
});

['foreground-wait', 'foreground-early', 'foreground-queued'].forEach(function (mode) {
  test(mode + ' supports later arrival and further foreground turns while old background remains', { timeout: 7000 }, async function (t) {
    var f = await fixture(t, mode);
    var credit = require('../lib/sdk-foreground-admission');
    await until(function () { return credit.available(f.session); }, 'foreground admission window');
    assert.equal(f.recorded.filter(function (row) { return row.type === 'done'; }).length, 0);
    f.send('second after foreground', 'foreground-second');
    await until(function () { return f.recorded.some(function (row) { return row.type === 'result'; }); }, 'second result');
    await until(function () { return credit.available(f.session); }, 'next foreground admission');
    f.send('third with background pending', 'foreground-third');
    await until(function () { return f.starts().length === 3; }, 'third SDK submit');
    assert.deepEqual(Array.from(f.adapter.clients)[0].session.fold.turn(f.starts()[0].params.commandId).foregroundCompleted.blockingAgents, ['reminder-1']);
    assert.equal(f.queue.inspect(f.session, { id: 'owner' }, 'foreground-third').state, 'consumed');
    f.starts().forEach(function (row) { assert.equal(row.params.ifBusy, undefined, 'retain SDK default queue semantics; no steering, replacement or retry'); });
    await f.command('complete-background');
    await until(function () { return !f.session.isProcessing; }, 'all real terminals');
    assert.equal(Array.from(f.adapter.clients)[0].session.fold.turn(f.starts()[0].params.commandId).state, 'settled');
    assert.equal(f.starts().length, 3);
    if (mode === 'foreground-queued') {
      assert.ok(f.wire().some(function (row) { return row.result && row.result.disposition === 'queued'; }));
      f.wire().filter(function (row) { return row.method === 'turn/start'; }).forEach(function (row) {
        var original = f.starts().find(function (start) { return start.params.commandId === row.params.commandId; });
        assert.deepEqual(row.params, original.params, 'SDK queue reconciliation reuses the identical logical command');
      });
    }
  });
});

test('late background terminal cannot cancel a newer pending tool approval or complete its user-work callback', { timeout: 7000 }, async function (t) {
  var completions = 0;
  var f = await fixture(t, 'foreground-approval', { done: function () { completions++; } });
  f.send('second requires approval', 'approve-second');
  await until(function () { return Object.keys(f.session.pendingPermissions).length === 1; }, 'second turn permission');
  var pending = f.session.pendingPermissions;
  var request = Object.keys(pending)[0];
  await f.command('complete-background');
  await until(function () { return f.recorded.some(function (row) { return row.type === 'background_result'; }); }, 'older background terminal');
  assert.equal(f.session.pendingPermissions, pending);
  assert.ok(f.session.pendingPermissions[request]);
  assert.equal(f.session.isProcessing, true);
  assert.equal(f.session._awaitingTurnResult, true);
  assert.equal(completions, 0, 'the newer user turn has no terminal yet');
  assert.equal(f.recorded.filter(function (row) { return row.type === 'done'; }).length, 0);
  f.send('third waits for a new admission boundary', 'approval-third');
  await f.command('duplicate-foreground');
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  assert.equal(require('../lib/sdk-foreground-admission').available(f.session), false, 'duplicate older foreground notice offers no new admission');
  assert.equal(f.queue.inspect(f.session, { id: 'owner' }, 'approval-third').state, 'pending');
  assert.equal(f.starts().length, 2);
  f.session.taskStopRequested = true;
  await f.session.queryInstance.abort();
  assert.equal(Object.keys(f.session.pendingPermissions).length, 0, 'Stop retires the live callback immediately');
  assert.equal(f.wire().filter(function (row) { return row.method === 'turn/cancel'; }).length, 1, 'only the still-live newer turn is cancelled');
});

test('foreground availability alone is non-terminal; its eventual terminal still completes the original turn', { timeout: 7000 }, async function (t) {
  var f = await fixture(t, 'foreground-wait');
  await until(function () { return require('../lib/sdk-foreground-admission').available(f.session); }, 'foreground window');
  assert.equal(f.session.isProcessing, true);
  assert.equal(f.recorded.filter(function (row) { return row.type === 'result' || row.type === 'done'; }).length, 0);
  await f.command('complete-background');
  await until(function () { return !f.session.isProcessing; }, 'real terminal');
  assert.equal(f.recorded.filter(function (row) { return row.type === 'result'; }).length, 1);
  assert.equal(f.recorded.filter(function (row) { return row.type === 'background_result'; }).length, 0);
});

test('Stop invalidates foreground admission immediately and never replays pending messages', { timeout: 7000 }, async function (t) {
  var f = await fixture(t, 'foreground-wait');
  var credit = require('../lib/sdk-foreground-admission');
  await until(function () { return credit.available(f.session); }, 'foreground window');
  var handle = f.session.queryInstance;
  var stopped = f.stop();
  assert.equal(stopped.status, 'queued');
  f.send('keep pending on Stop', 'stopped-pending');
  var closing = handle.close();
  assert.equal(credit.available(f.session), false);
  assert.equal(handle.pushMessage('must not replay'), false);
  await closing;
  await until(function () { return f.adapter.clients.size === 0; }, 'Stop cleanup');
  assert.equal(f.queue.inspect(f.session, { id: 'owner' }, 'stopped-pending').state, 'pending');
  assert.equal(f.starts().length, 1);
  assert.equal(f.wire().filter(function (row) { return row.method === 'turn/cancel'; }).length, 1, 'Stop cancels the background-held turn too');
  assert.equal(f.recorded.filter(function (row) { return row.type === 'result'; }).length, 0);
});

test('synchronous arrival in foreground admission callback drains exactly once', { timeout: 7000 }, async function (t) {
  var injected = false;
  var f = await fixture(t, 'foreground-early', { available: function (live) {
    if (live && !injected && require('../lib/sdk-foreground-admission').available(live.session)) {
      injected = true;
      live.send('synchronous foreground follow-up', 'synchronous-foreground');
    }
  } });
  await until(function () { return f.starts().length === 2; }, 'synchronous foreground submit');
  assert.equal(f.queue.inspect(f.session, { id: 'owner' }, 'synchronous-foreground').state, 'consumed');
  assert.equal(f.session.history.filter(function (row) { return row.clientMessageId === 'synchronous-foreground'; }).length, 1);
  await f.command('complete-background');
  await until(function () { return !f.session.isProcessing; }, 'real terminals');
  assert.equal(f.starts().length, 2);
});

test('background failure remains a real terminal error and retires the query without retry', { timeout: 7000 }, async function (t) {
  var f = await fixture(t, 'foreground-wait');
  await until(function () { return require('../lib/sdk-foreground-admission').available(f.session); }, 'foreground window');
  await f.command('fail-background');
  await until(function () { return f.recorded.some(function (row) { return row.type === 'error' && /Background fixture failed/.test(row.text); }); }, 'background failure');
  await until(function () { return f.session.queryInstance === null; }, 'failed stream cleanup');
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.starts().length, 1);
  assert.equal(f.recorded.filter(function (row) { return row.type === 'result'; }).length, 0);
  assert.equal(require('../lib/sdk-foreground-admission').available(f.session), false);
});

test('foreground admission cannot cross a replaced query, generation, Stop or paused queue', function () {
  var credit = require('../lib/sdk-foreground-admission');
  var original = {};
  var session = { queryInstance: original, _sdkQueryGeneration: 4 };
  assert.equal(credit.offer(session), true);
  assert.equal(credit.available(session), true);
  session.queryInstance = {};
  assert.equal(credit.available(session), false);
  session.queryInstance = original;
  session._sdkQueryGeneration = 5;
  assert.equal(credit.available(session), false);
  session._sdkQueryGeneration = 4;
  session.taskStopRequested = true;
  assert.equal(credit.available(session), false);
  session.taskStopRequested = false;
  session._pendingMessageDrainPaused = true;
  assert.equal(credit.available(session), false);
});
