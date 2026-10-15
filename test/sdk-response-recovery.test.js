var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var home = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-response-recovery-'));
process.env.HOME = home;
process.env.CLAY_HOME = path.join(home, '.clay');
var attach = require('../lib/sdk-response-recovery').attachResponseRecovery;
var createSDKBridge = require('../lib/sdk-bridge').createSDKBridge;
test.after(function() { fs.rmSync(home, { recursive: true, force: true }); });

function clock() {
  var timers = new Map();
  var id = 0;
  return {
    setTimeout: function(fn, ms) { timers.set(++id, { fn: fn, ms: ms }); return id; },
    clearTimeout: function(key) { timers.delete(key); },
    fire: function(ms) {
      var entry = Array.from(timers.entries()).find(function(item) { return item[1].ms === ms; });
      assert.ok(entry, 'expected pending timer for ' + ms);
      timers.delete(entry[0]);
      entry[1].fn();
      return drain();
    },
    size: function() { return timers.size; },
  };
}
async function drain() { for (var i = 0; i < 20; i++) await Promise.resolve(); }
function fixture() {
  var timers = clock();
  var records = [];
  var restarts = [];
  var session = { localId: 'one', isProcessing: true };
  var sessions = new Map([[session.localId, session]]);
  var recovery = attach({ sessions: sessions, setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, waitMs: 100, stopMs: 10,
    changed: function() {}, broadcast: function() {}, send: function() {}, record: function(target, message) { records.push(message); },
    restart: function(target, payload, state) { restarts.push({ session: target, payload: payload, state: state }); } });
  return { timers: timers, records: records, restarts: restarts, session: session, sessions: sessions, recovery: recovery };
}

test('unanswered turn waits for actual stop before replaying exact payload once', async function() {
  var f = fixture();
  var resolveStop;
  f.session.queryInstance = { stopAndWait: function() { return new Promise(function(resolve) { resolveStop = resolve; }); } };
  var payload = { text: 'exact prompt', images: [{ data: 'attachment', mediaType: 'image/png' }], linuxUser: 'authorized-user' };
  f.recovery.begin(f.session, payload);
  var expiry = f.timers.fire(100);
  await drain();
  assert.equal(f.restarts.length, 0);
  resolveStop();
  await expiry;
  await drain();
  assert.equal(f.restarts.length, 1);
  assert.deepEqual(f.restarts[0].payload, payload);
  f.session.queryInstance = { stopAndWait: function() { return Promise.resolve(); } };
  await f.timers.fire(100);
  assert.equal(f.restarts.length, 1);
  assert.equal(f.session.isProcessing, false);
  assert.ok(f.records.some(function(message) { return message.type === 'error' && /one automatic retry/.test(message.text); }));
  assert.equal(f.timers.size(), 0);
});

test('meaningful text, thinking, tool and assistant output disarm recovery', function() {
  [{ yokeType: 'text_delta', text: 'answer' }, { yokeType: 'thinking_delta', text: 'reasoning' }, { yokeType: 'tool_start' },
    { yokeType: 'tool_input_delta' }, { yokeType: 'tool_progress' }, { yokeType: 'task_started' }, { yokeType: 'task_progress' },
    { yokeType: 'subagent_message' }, { yokeType: 'message', messageRole: 'assistant', content: [{}] }].forEach(function(event) {
    var f = fixture();
    f.recovery.begin(f.session, { text: 'question' });
    f.recovery.event(f.session, event);
    assert.equal(f.timers.size(), 0, event.yokeType);
  });
});

test('heartbeats, initialization and empty content do not postpone recovery', async function() {
  var f = fixture();
  f.session.queryInstance = { stopAndWait: function() { return Promise.resolve(); } };
  f.recovery.begin(f.session, { text: 'question' });
  [{ yokeType: 'init' }, { yokeType: 'heartbeat' }, { yokeType: 'status' }, { yokeType: 'text_delta', text: '' }, { type: '_worker_meta' }].forEach(function(event) { f.recovery.event(f.session, event); });
  await f.timers.fire(100);
  assert.equal(f.restarts.length, 1);
  f.recovery.dispose();
});

test('queued messages prevent ambiguous automatic replay and clear processing', async function() {
  var f = fixture();
  f.session.queryInstance = { stopAndWait: function() { return Promise.resolve(); } };
  f.recovery.begin(f.session, { text: 'first' });
  f.recovery.enqueue(f.session, { text: 'second' });
  await f.timers.fire(100);
  assert.equal(f.restarts.length, 0);
  assert.equal(f.session.isProcessing, false);
  assert.ok(f.records.some(function(message) { return /Several messages were queued/.test(message.text || ''); }));
});

test('human decisions and known active tools remain protected from automatic stop', async function() {
  for (var key of ['pendingPermissions', 'pendingAskUser', 'pendingElicitations', 'pendingUserDialogs', 'activeTaskToolIds', 'activeBackgroundTasks']) {
    var f = fixture();
    var stops = 0;
    f.session[key] = key === 'activeBackgroundTasks' ? [{}] : { active: {} };
    f.session.queryInstance = { stopAndWait: function() { stops++; return Promise.resolve(); } };
    f.recovery.begin(f.session, { text: 'question' });
    await f.timers.fire(100);
    assert.equal(stops, 0, key);
    assert.equal(f.restarts.length, 0, key);
    assert.equal(f.session.isProcessing, true, key);
  }
});

test('manual Stop during stop confirmation cancels the future retry', async function() {
  var f = fixture();
  var resolveStop;
  f.session.queryInstance = { stopAndWait: function() { return new Promise(function(resolve) { resolveStop = resolve; }); } };
  f.recovery.begin(f.session, { text: 'question' });
  var expiry = f.timers.fire(100);
  f.recovery.cancel(f.session);
  resolveStop();
  await expiry;
  await drain();
  assert.equal(f.restarts.length, 0);
  assert.equal(f.timers.size(), 0);
});

test('unconfirmed stop fails closed with actionable terminal feedback', async function() {
  var f = fixture();
  f.session.queryInstance = { stopAndWait: function() { return new Promise(function() {}); } };
  f.recovery.begin(f.session, { text: 'question' });
  var expiry = f.timers.fire(100);
  f.timers.fire(10);
  await expiry;
  await drain();
  assert.equal(f.restarts.length, 0);
  assert.equal(f.session.isProcessing, false);
  assert.ok(f.records.some(function(message) { return message.type === 'error' && /could not be confirmed stopped/.test(message.text); }));
});

test('sessions recover independently and teardown cancels every deadline', async function() {
  var f = fixture();
  var second = { localId: 'two', isProcessing: true, queryInstance: { stopAndWait: function() { return Promise.resolve(); } } };
  f.sessions.set(second.localId, second);
  f.recovery.begin(f.session, { text: 'one' });
  f.recovery.begin(second, { text: 'two' });
  f.recovery.progress(f.session);
  assert.equal(f.timers.size(), 1);
  await f.timers.fire(100);
  assert.equal(f.restarts[0].session, second);
  f.recovery.dispose();
  assert.equal(f.timers.size(), 0);
});

function streamHandle() {
  var waiting;
  var ended = false;
  var queue = [];
  var pushed = [];
  var stopResolve;
  var stopPending;
  var handle = {
    pushed: pushed,
    pushMessage: function(text, images) { pushed.push({ text: text, images: images }); return true; },
    close: function() {},
    stopAndWait: function() {
      if (!stopPending) stopPending = new Promise(function(resolve) { stopResolve = resolve; });
      return stopPending;
    },
    stopped: function() { ended = true; if (waiting) { waiting({ done: true }); waiting = null; } if (stopResolve) stopResolve(); },
    emit: function(event) { if (waiting) { var fn = waiting; waiting = null; fn({ value: event, done: false }); } else queue.push(event); },
    [Symbol.asyncIterator]: function() { return { next: function() {
      if (queue.length) return Promise.resolve({ value: queue.shift(), done: false });
      if (ended) return Promise.resolve({ done: true });
      return new Promise(function(resolve) { waiting = resolve; });
    } }; },
  };
  return handle;
}
function bridgeFixture(create) {
  var timers = clock();
  var records = [];
  var handles = [];
  var options = [];
  var session = { localId: 'bridge-one', vendor: 'claude', cliSessionId: 'existing-authorized-session', isProcessing: true,
    pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {}, history: [] };
  var sessions = new Map([[session.localId, session]]);
  var adapter = { vendor: 'claude', createQuery: function(opts) {
    options.push(opts);
    if (create) return create(opts, options.length);
    var handle = streamHandle(); handles.push(handle); return Promise.resolve(handle);
  } };
  var bridge = createSDKBridge({ cwd: process.cwd(), adapter: adapter, adapters: { claude: adapter }, send: function() {},
    sessionManager: { sessions: sessions, availableModels: [], saveSessionFile: function() {}, broadcastSessionList: function() {},
      sendAndRecord: function(target, message) { records.push(message); }, sendToSession: function() {} },
    responseRecovery: { setTimeout: timers.setTimeout, clearTimeout: timers.clearTimeout, waitMs: 100, stopMs: 10 } });
  return { bridge: bridge, timers: timers, records: records, session: session, sessions: sessions, handles: handles, options: options };
}

test('production bridge retries exact original text/images/context only after terminated old attempt', async function() {
  var f = bridgeFixture();
  var images = [{ mediaType: 'image/png', data: 'fixture-image' }];
  await f.bridge.startQuery(f.session, 'original exact text', images, null);
  images[0].data = "mutated-later";
  f.timers.fire(100);
  await drain();
  assert.equal(f.handles.length, 1);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 2);
  assert.equal(f.handles[1].pushed[0].text, 'original exact text');
  assert.deepEqual(f.handles[1].pushed[0].images, [{ mediaType: "image/png", data: "fixture-image" }]);
  assert.equal(f.options[1].resumeSessionId, 'existing-authorized-session');
  assert.equal(f.options[1].cwd, f.options[0].cwd);
  f.timers.fire(100);
  await drain();
  f.handles[1].stopped();
  await drain();
  assert.equal(f.handles.length, 2);
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.timers.size(), 0);
  f.bridge.stopIdleReaper();
});

test('production bridge ignores initialization and cancels recovery on first meaningful output', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.handles[0].emit({ yokeType: 'init', sessionId: 'existing-authorized-session' });
  await drain();
  assert.equal(f.timers.size(), 1);
  f.handles[0].emit({ yokeType: 'text_start', blockId: 'text' });
  f.handles[0].emit({ yokeType: 'text_delta', blockId: 'text', text: 'answer' });
  await drain();
  assert.equal(f.timers.size(), 0);
  f.bridge.stopIdleReaper();
});

test('production manual cancellation prevents retry after late stop confirmation', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.timers.fire(100);
  await drain();
  f.bridge.cancelResponseRecovery(f.session);
  f.session.taskStopRequested = true;
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 1);
  assert.equal(f.timers.size(), 0);
  f.bridge.stopIdleReaper();
});

test('production initial delivery throw/reject and adapter failure clear spinner with actionable status', async function() {
  for (var mode of ['throw', 'reject', 'create-reject']) {
    var f = bridgeFixture(function() {
      if (mode === 'create-reject') return Promise.reject(new Error('adapter unavailable'));
      var handle = streamHandle();
      handle.pushMessage = function() { if (mode === 'throw') throw new Error('input failed'); return false; };
      return Promise.resolve(handle);
    });
    await f.bridge.startQuery(f.session, 'question', null, null);
    await drain();
    assert.equal(f.session.isProcessing, false, mode);
    assert.equal(f.session.queryInstance, null, mode);
    assert.equal(f.timers.size(), 0, mode);
    assert.ok(f.records.some(function(message) { return message.type === 'error'; }), mode);
    assert.ok(f.records.some(function(message) { return message.type === 'done'; }), mode);
    f.bridge.stopIdleReaper();
  }
});

test('production early iterator close clears processing and prevents a stale recovery', async function() {
  var f = bridgeFixture(function() { var handle = streamHandle(); handle.stopped(); return Promise.resolve(handle); });
  await f.bridge.startQuery(f.session, 'question', null, null);
  await drain();
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.timers.size(), 0);
  assert.ok(f.records.some(function(message) { return message.type === 'done'; }));
  f.bridge.stopIdleReaper();
});

test('late old stop confirmation cannot cancel a new turn watchdog', async function() {
  var f = fixture();
  var resolveStop;
  f.session.queryInstance = { stopAndWait: function() { return new Promise(function(resolve) { resolveStop = resolve; }); } };
  f.recovery.begin(f.session, { text: 'old question' });
  f.timers.fire(100);
  await drain();
  f.recovery.cancel(f.session);
  var current = f.recovery.begin(f.session, { text: 'new question' });
  resolveStop();
  await drain();
  assert.equal(f.recovery.current(f.session), current);
  assert.equal(f.timers.size(), 1);
  f.recovery.dispose();
});

test('production queued input is retained without replay when delivery is ambiguous', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'first', null, null);
  assert.equal(f.bridge.pushMessage(f.session, 'second', null), true);
  f.timers.fire(100);
  await drain();
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 1);
  assert.deepEqual(f.handles[0].pushed.map(function(message) { return message.text; }), ['first', 'second']);
  assert.equal(f.session.isProcessing, false);
  assert.ok(f.records.some(function(message) { return message.type === 'error' && /Several messages/.test(message.text); }));
  f.bridge.stopIdleReaper();
});

test('production callbacks opening permission/questions protect startup before any SDK event', async function() {
  for (var key of ['pendingPermissions', 'pendingAskUser', 'pendingElicitations', 'pendingUserDialogs']) {
    var f = bridgeFixture();
    await f.bridge.startQuery(f.session, 'question', null, null);
    f.session[key] = { request: {} };
    await f.timers.fire(100);
    assert.equal(f.handles.length, 1, key);
    assert.equal(f.session.isProcessing, true, key);
    assert.equal(f.timers.size(), 0, key);
    f.bridge.stopIdleReaper();
  }
});

test('production teardown cancels all pending requests', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.bridge.stopIdleReaper();
  assert.equal(f.timers.size(), 0);
  assert.equal(f.handles.length, 1);
});

test('production late old output is ignored while recovery awaits stop confirmation', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.timers.fire(100);
  await drain();
  f.handles[0].emit({ yokeType: 'text_start', blockId: 'late' });
  f.handles[0].emit({ yokeType: 'text_delta', blockId: 'late', text: 'late stale answer' });
  f.handles[0].emit({ yokeType: 'result', resultText: 'late stale result' });
  await drain();
  assert.equal(f.records.some(function(message) { return message.type === 'text_delta' && message.text === 'late stale answer'; }), false);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 2);
  f.bridge.stopIdleReaper();
});

test('production deadline during adapter startup stops late handle before original input dispatch', async function() {
  var resolveStartup;
  var late = streamHandle();
  var f = bridgeFixture(function(opts, attempt) {
    if (attempt === 1) return new Promise(function(resolve) { resolveStartup = resolve; });
    return Promise.resolve(streamHandle());
  });
  var starting = f.bridge.startQuery(f.session, 'startup question', null, null);
  await drain();
  f.timers.fire(100);
  await drain();
  assert.equal(f.options.length, 1);
  resolveStartup(late);
  await starting;
  await drain();
  assert.equal(late.pushed.length, 0, 'expired attempt must not dispatch after slow startup');
  assert.equal(f.options.length, 1, 'late handle needs confirmed stop first');
  late.stopped();
  await drain();
  assert.equal(f.options.length, 2);
  f.bridge.stopIdleReaper();
});

test('production project session Stop cancels server recovery while a stop acknowledgement is pending', async function() {
  var f = bridgeFixture();
  var attachSessions = require('../lib/project-sessions').attachSessions;
  var sessions = attachSessions({ cwd: process.cwd(), slug: 'fixture', sm: { sessions: new Map([[f.session.localId, f.session]]) }, sdk: f.bridge,
    opts: {}, clients: new Set(), usersModule: { isMultiUser: function() { return false; } } });
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.timers.fire(100);
  await drain();
  assert.equal(sessions.stopHomeSession(f.session), true);
  assert.equal(f.session.taskStopRequested, true);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 1);
  assert.equal(f.timers.size(), 0);
  f.bridge.stopIdleReaper();
});

test('production old generation tool policy callbacks deny after recovery starts', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.timers.fire(100);
  await drain();
  var policy = await f.options[0].preToolUsePolicy('Write', { path: 'blocked' });
  var permission = await f.options[0].canUseTool('Write', { path: 'blocked' }, {});
  assert.equal(policy.behavior, 'deny');
  assert.equal(permission.behavior, 'deny');
  f.handles[0].stopped();
  await drain();
  var late = await f.options[0].preToolUsePolicy('Write', { path: 'blocked' });
  assert.equal(late.behavior, 'deny');
  f.bridge.stopIdleReaper();
});

test('production response timer survives viewer disconnect and records recovery for reconnect', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'question', null, null);
  // Viewer sockets are deliberately absent; the server session owns recovery.
  await f.timers.fire(100);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 2);
  assert.ok(f.records.some(function(message) { return message.type === 'info' && /Retrying your original/.test(message.text); }));
  assert.equal(f.session.isProcessing, true);
  f.bridge.stopIdleReaper();
});

test('deleted or ownership-changed sessions cannot replay a pending turn', async function() {
  for (var mode of ['removed', 'owner']) {
    var f = bridgeFixture();
    await f.bridge.startQuery(f.session, 'question', null, null);
    if (mode === 'removed') f.sessions.delete(f.session.localId);
    else f.session.ownerId = 'different-owner';
    await f.timers.fire(100);
    assert.equal(f.handles.length, 1, mode);
    assert.equal(f.timers.size(), 0, mode);
    f.bridge.stopIdleReaper();
  }
});

test('production retry preserves original model and effort after session settings change', async function() {
  var f = bridgeFixture();
  f.session.model = 'claude-sonnet-4-6';
  f.session.effort = 'low';
  await f.bridge.startQuery(f.session, 'question', null, null);
  f.session.model = 'claude-opus-4-6';
  f.session.effort = 'high';
  await f.timers.fire(100);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.options.length, 2);
  assert.equal(f.options[1].model, f.options[0].model);
  assert.equal(f.options[1].effort, f.options[0].effort);
  assert.equal(f.options[1].appendSystemPrompt, f.options[0].appendSystemPrompt);
  f.bridge.stopIdleReaper();
});

test('unconfirmed old execution blocks new delivery until termination is observed', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'original', null, null);
  f.timers.fire(100);
  await drain();
  f.timers.fire(10);
  await drain();
  assert.equal(f.session.isProcessing, false);
  assert.equal(f.bridge.pushMessage(f.session, 'new prompt'), false);
  assert.equal(await f.bridge.startQuery(f.session, 'new prompt'), false);
  assert.equal(f.handles.length, 1);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.session._responseRecoveryStopPending, null);
  await f.bridge.startQuery(f.session, 'explicit new prompt');
  assert.equal(f.handles.length, 2);
  f.bridge.stopIdleReaper();
});

test('retired Claude callbacks cannot reopen dialogs or admit side-effect tools', async function() {
  var f = bridgeFixture();
  await f.bridge.startQuery(f.session, 'original', null, null);
  var options = f.options[0];
  f.timers.fire(100);
  await drain();
  assert.equal((await options.preToolUsePolicy('Bash', { command: 'side-effect' })).behavior, 'deny');
  assert.equal((await options.canUseTool('Bash', { command: 'side-effect' })).behavior, 'deny');
  assert.deepEqual(await options.onElicitation({}), { action: 'cancel' });
  assert.deepEqual(await options.onUserDialog({}), { behavior: 'cancelled' });
  var cancelled = false;
  options.onUserInputRequest({}, { cancel: function() { cancelled = true; } });
  assert.equal(cancelled, true);
  assert.equal(Object.keys(f.session.pendingElicitations).length, 0);
  f.handles[0].stopped();
  await drain();
  assert.equal(f.handles.length, 2);
  cancelled = false;
  options.onUserInputRequest({}, { cancel: function() { cancelled = true; } });
  assert.equal(cancelled, true, 'late old question is rejected after replacement');
  assert.equal(f.timers.size(), 1, 'late old question must not cancel the replacement watchdog');
  f.timers.fire(100);
  await drain();
  f.handles[1].stopped();
  await drain();
  assert.equal(f.handles.length, 2, 'only one automatic retry is allowed');
  assert.equal(f.session.isProcessing, false);
  assert.ok(f.records.some(function(message) { return /one automatic retry/.test(message.text || ''); }));
  f.bridge.stopIdleReaper();
});
