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
  if (hooks && hooks.client) {
    sm = require('../lib/sessions').createSessionManager({ cwd: root, sessionsBase: path.join(root, 'sessions'), cliSessionsDir: path.join(root, 'cli'),
      send: function () {}, sendTo: function (target, event) { target.replay(event); } });
    sm.sessions.set(session.localId, session);
    sm.subscribeSession(session.localId, function (event) { recorded.push(event); hooks.client.dispatch(event); });
    session.history.push({ type: 'user_message', text: 'greeting' });
    hooks.client.dispatch(session.history[0]);
    assert.equal(sm.saveSessionFile(session), true);
  }
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
    send: function () {}, sendTo: function () {}, sendToSession: function () {}, sendToSessionOthers: function (source, id, event) { if (hooks && hooks.client) hooks.client.dispatch(event); },
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
    record: function (event) { sm.sendAndRecord(session, event); },
    persisted: function () {
      var file = fs.readdirSync(sm.sessionsDir).find(function (name) { return name.endsWith('.jsonl'); });
      return fs.readFileSync(path.join(sm.sessionsDir, file), 'utf8').trim().split('\n').map(JSON.parse).slice(1);
    },
    replay: function (client, history) { sm.replayHistory(Object.assign({}, session, { history: history || api.persisted() }), 0, client); },
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

[false, true].forEach(function (animate) {
  test('foreground render boundary preserves ordered live and persisted/replayed assistant bubbles; animate=' + animate, { timeout: 7000 }, async function (t) {
    var createClient = require('./helpers/project-stream-client.cjs').create;
    var client = createClient({ animate: animate });
    var credit = require('../lib/sdk-foreground-admission');
    var injected = false;
    var f = await fixture(t, 'foreground-render', { client: client, available: function (live) {
      if (animate && !injected && credit.available(live.session)) {
        injected = true;
        live.send('second user', 'render-second');
      }
    } });
    await until(function () { return credit.available(f.session); }, 'first foreground');
    if (!injected) f.send('second user', 'render-second');
    await until(function () { return f.starts().length === 2 && credit.available(f.session); }, 'second foreground');
    client.frame();
    var expected = [ { role: 'user', text: 'greeting' }, { role: 'assistant', text: 'MUSE_FIRST_OK' },
      { role: 'user', text: 'second user' }, { role: 'assistant', text: 'MUSE_SECOND_OK' } ];
    assert.deepEqual(client.rows(), expected);
    assert.equal(f.session.isProcessing, true, 'open background turns retain Stop/processing');
    assert.equal(f.session._awaitingTurnResult, true);
    assert.equal(f.recorded.some(function (event) { return event.type === 'result' || event.type === 'done'; }), false, 'render boundary is not terminal');
    var restored = createClient();
    f.replay(restored);
    restored.frame();
    assert.deepEqual(restored.rows(), expected);
    assert.equal(f.persisted().filter(function (event) { return event.type === 'assistant_boundary'; }).length, 2);
    var history = f.persisted();
    assert.ok(history.findIndex(function (event) { return event.type === 'assistant_boundary'; }) < history.findIndex(function (event) { return event.clientMessageId === 'render-second'; }), 'boundary is persisted before next admission');
    var legacy = createClient();
    f.replay(legacy, history.filter(function (event) { return event.type !== 'assistant_boundary'; }));
    legacy.frame();
    assert.deepEqual(legacy.rows(), expected, 'old history without boundary records still splits at its user turn');
    f.stop();
  });
});

test('client presentation boundary flushes buffered prose without settling tools, approvals or Stop', function () {
  var client = require('./helpers/project-stream-client.cjs').create();
  client.dispatch({ type: 'delta', text: 'buffered answer' });
  var background = [{ task_id: 'pending-background' }];
  var pending = { review: { state: 'pending' } };
  client.context.store.set({ activeBackgroundTasks: background, pendingPermissions: pending, status: 'processing' });
  client.dispatch({ type: 'assistant_boundary' });
  assert.deepEqual(client.rows(), [{ role: 'assistant', text: 'buffered answer' }]);
  assert.equal(client.context.store.get('currentMsgEl'), null);
  assert.equal(client.context.store.get('currentFullText'), '');
  assert.equal(client.context.store.get('sessionIsProcessing'), true);
  assert.equal(client.context.store.get('status'), 'processing');
  assert.equal(client.context.store.get('activeBackgroundTasks'), background);
  assert.equal(client.context.store.get('pendingPermissions'), pending);
  ['markAllToolsDone', 'finishThinkingTurn', 'enableMainInput', 'resetToolState', 'finishMarkdownTurn'].forEach(function (name) {
    assert.equal(client.calls[name] || 0, 0, name + ' must not run at a presentation boundary');
  });
});

test('native queued follow-ups retain truthful activity across three turns, late background results, replay and Stop', { timeout: 7000 }, async function (t) {
  var createClient = require('./helpers/project-stream-client.cjs').create;
  var client = createClient();
  var credit = require('../lib/sdk-foreground-admission');
  var f = await fixture(t, 'foreground-lifecycle', { client: client });
  await until(function () { return credit.available(f.session); }, 'first foreground');
  f.send('second delayed response', 'lifecycle-second');
  await until(function () { return f.starts().length === 2; }, 'second native acknowledgement');
  assert.equal(client.activity(), 'Waiting for provider');
  var secondId = f.starts()[1].params.commandId;
  await until(function () { return f.recorded.some(function (row) {
    return row.type === 'turn_activity' && row.turnId === secondId && row.disposition === 'queued';
  }); }, 'observed native queued disposition');
  assert.equal(f.recorded.some(function (row) { return row.type === 'message_uuid' && row.uuid === secondId; }), false, 'a queued ACK is not an observed start');
  f.send('third delayed response', 'lifecycle-third');
  assert.equal(f.queue.inspect(f.session, { id: 'owner' }, 'lifecycle-third').state, 'pending');
  await f.command('complete-background');
  await until(function () { return f.recorded.some(function (row) { return row.type === 'background_result'; }); }, 'old background terminal');
  assert.equal(client.activity(), 'Waiting for provider');
  var restored = createClient(); f.replay(restored); restored.frame();
  assert.equal(restored.activity(), 'Waiting for provider', 'replay restores actual latest admission state');
  await f.command('launch-next');
  await until(function () { return client.activity() === 'Working'; }, 'observed native start');
  assert.equal(f.recorded.filter(function (row) { return row.type === 'message_uuid' && row.uuid === secondId; }).length, 1);
  await f.command('answer-next');
  await until(function () { return f.starts().length === 3; }, 'third native queued acknowledgement');
  assert.equal(client.activity(), 'Waiting for provider');
  await f.command('complete-active');
  await until(function () { return f.recorded.filter(function (row) { return row.type === 'background_result'; }).length === 2; }, 'second late terminal');
  assert.equal(client.activity(), 'Waiting for provider');
  await f.command('launch-next');
  await until(function () { return client.activity() === 'Working'; }, 'third observed start');
  await f.command('approval-next');
  await until(function () { return Object.keys(f.session.pendingPermissions).length === 1; }, 'third approval');
  assert.equal(client.activity(), null, 'a real approval card replaces running activity');
  assert.equal(client.calls.renderPermissionRequest, 1);
  var inputEvents = f.recorded.length;
  f.bridge.processSDKMessage(f.session, { yokeType: 'turn_activity', phase: 'running', turnId: f.starts()[2].params.commandId });
  assert.equal(f.recorded.length, inputEvents, 'late activity must not replace an authoritative input wait');
  var approvalReplay = createClient(); f.replay(approvalReplay); approvalReplay.frame();
  assert.equal(approvalReplay.activity(), null, 'replay must not resurrect Working over a live approval');
  assert.deepEqual(client.errors, []);
  assert.deepEqual(restored.errors, []);
  assert.deepEqual(approvalReplay.errors, []);
  var handle = f.session.queryInstance;
  f.stop();
  await handle.close();
  await until(function () { return f.session.queryInstance === null; }, 'Stop cleanup');
  assert.equal(Object.keys(f.session.pendingPermissions).length, 0);
  assert.equal(client.activity(), null);
  assert.equal(handle.pushMessage('never replay'), false);
  assert.equal(f.starts().length, 3);
  f.starts().forEach(function (row) { assert.equal(row.params.ifBusy, undefined, 'retain native default queue disposition policy'); });
});

['stop', 'failure'].forEach(function (ending) {
  test('native queued wait clears on ' + ending + ' without a fabricated start or resend', { timeout: 7000 }, async function (t) {
    var client = require('./helpers/project-stream-client.cjs').create();
    var credit = require('../lib/sdk-foreground-admission');
    var f = await fixture(t, 'foreground-lifecycle', { client: client });
    await until(function () { return credit.available(f.session); }, 'first foreground');
    f.send('queued until native start', 'queued-stop');
    await until(function () { return client.activity() === 'Waiting for provider' && f.starts().length === 2; }, 'queued waiting state');
    var secondId = f.starts()[1].params.commandId;
    assert.equal(f.recorded.some(function (row) { return row.type === 'message_uuid' && row.uuid === secondId; }), false);
    var handle = f.session.queryInstance;
    if (ending === 'stop') { f.stop(); await handle.close(); }
    else await f.command('fail-background');
    await until(function () { return f.session.queryInstance === null; }, 'terminal cleanup');
    assert.equal(client.activity(), null);
    assert.equal(f.session.isProcessing, false);
    assert.equal(handle.pushMessage('no resend'), false);
    assert.equal(f.starts().length, 2);
    assert.equal(f.recorded.some(function (row) { return row.type === 'message_uuid' && row.uuid === secondId; }), false);
    assert.equal(f.recorded.some(function (row) { return row.type === 'result'; }), false);
    assert.deepEqual(client.errors, []);
  });
});

['permission', 'question', 'elicitation'].forEach(function (kind) {
  test('foreground and explicit activity respect pending ' + kind + ' cards live and on replay', { timeout: 7000 }, async function (t) {
    var createClient = require('./helpers/project-stream-client.cjs').create;
    var client = createClient();
    var f = await fixture(t, 'foreground-lifecycle', { client: client });
    await until(function () { return require('../lib/sdk-foreground-admission').available(f.session); }, 'foreground');
    f.send('input review', 'input-review');
    await until(function () { return f.starts().length === 2; }, 'queued acknowledgement');
    await f.command('launch-next');
    await until(function () { return client.activity() === 'Working'; }, 'native started');
    if (kind === 'question') {
      // A tool-name announcement alone is not a question card.
      f.record({ type: 'tool_start', id: 'announced', name: 'ask_user_questions' });
      var announcement = createClient(); f.replay(announcement); announcement.frame();
      assert.equal(announcement.activity(), 'Working');
      assert.deepEqual(announcement.errors, []);
      var onSettle;
      var respond = { onSettle: function (fn) { onSettle = fn; }, cancel: function () { onSettle({ status: 'cancelled' }); } };
      require('../lib/project-ask-user').attachAskUser({ record: function (session, event) { f.record(event); } })
        .createHandler(f.session)({ id: 'question-review', source: 'product-control', questions: [{ id: 'q', question: 'Continue?', options: [] }] }, respond);
    } else if (kind === 'elicitation') {
      // Use the actual bridge callback that creates and records an input wait.
      f.bridge.handleElicitation(f.session, { serverName: 'fixture', message: 'Choose', requestedSchema: { type: 'object' } }, {});
    } else {
      await f.command('approval-next');
      await until(function () { return Object.keys(f.session.pendingPermissions).length === 1; }, 'native permission');
    }
    var key = kind === 'permission' ? 'pendingPermissions' : kind === 'question' ? 'pendingAskUser' : 'pendingElicitations';
    var id = Object.keys(f.session[key])[0];
    assert.ok(id);
    assert.equal(client.context.store.get('turnActivity'), null, 'actual card clears stored phase');
    assert.equal(client.activity(), null);
    var activities = f.recorded.filter(function (row) { return row.type === 'turn_activity'; }).length;
    f.bridge.processSDKMessage(f.session, { yokeType: 'foreground_available' });
    ['waiting', 'running', 'background'].forEach(function (phase) {
      f.bridge.processSDKMessage(f.session, { yokeType: 'turn_activity', phase: phase });
    });
    assert.equal(f.recorded.filter(function (row) { return row.type === 'turn_activity'; }).length, activities);
    assert.ok(f.session[key][id], 'foreground does not settle the review');
    var restored = createClient(); f.replay(restored); restored.frame();
    assert.equal(restored.context.store.get('turnActivity'), null);
    assert.equal(restored.activity(), null, 'history_done cannot resurrect pre-card activity');
    // Settle the exact callback as the response service does, then record its receipt.
    var entry = f.session[key][id];
    if (kind === 'question') entry.respond.cancel('test resolution');
    else { delete f.session[key][id]; entry.resolve(kind === 'permission' ? { behavior: 'deny', message: 'test resolution' } : { action: 'cancel' }); }
    f.record(kind === 'question' ? { type: 'ask_user_answered', toolId: id, answers: {} }
      : kind === 'permission' ? { type: 'permission_resolved', requestId: id, decision: 'deny' }
      : { type: 'elicitation_resolved', requestId: id, action: 'cancel' });
    assert.equal(client.activity(), null, 'resolution alone does not invent native activity');
    f.bridge.processSDKMessage(f.session, { yokeType: 'turn_activity', phase: 'waiting' });
    assert.equal(client.activity(), 'Waiting for provider', 'observed later activity may resume after resolution');
    var resolvedReplay = createClient(); f.replay(resolvedReplay); resolvedReplay.frame();
    assert.equal(resolvedReplay.activity(), 'Waiting for provider');
    var handle = f.session.queryInstance;
    f.stop(); await handle.close();
    assert.equal(client.activity(), null);
    var stoppedReplay = createClient(); f.replay(stoppedReplay); stoppedReplay.frame();
    assert.equal(stoppedReplay.activity(), null);
    [client, restored, resolvedReplay, stoppedReplay].forEach(function (view) { assert.deepEqual(view.errors, []); });
  });
});
