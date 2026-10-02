var test = require('node:test');
var assert = require('node:assert/strict');
var EventEmitter = require('node:events');
var PassThrough = require('node:stream').PassThrough;
var acpCreate = require('../lib/yoke/acp-query-handle').createAcpQueryHandle;
var kiroCreate = require('../lib/yoke/adapters/kiro').contractTestKit.createQueryHandle;
var agyCreate = require('../lib/yoke/adapters/antigravity').createAntigravityQueryHandle;
var claude = require('../lib/yoke/adapters/claude').contractTestKit;
var Manager = require('../lib/yoke/acp-process-manager').AcpProcessManager;
var profiles = require('../lib/yoke/acp-agent-profiles');

function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function until(check) {
  for (var i = 0; i < 30; i++) { if (check()) return; await tick(); }
  assert.fail('Expected lifecycle boundary was not reached');
}
function fixture(vendor, options) {
  options = options || {};
  var calls = [], replies = [], handlers = [];
  var controller = new AbortController();
  if (options.preAborted) controller.abort();
  var startResolve, promptResolve, permissionResolve;
  var server = {
    started: true,
    addHandler: function (fn) { var entry = { fn: fn }; handlers.push(entry); return entry; },
    removeHandler: function (entry) { handlers.splice(handlers.indexOf(entry), 1); },
    send: function (method, params) {
      calls.push({ method: method, params: params });
      if (method === 'session/new' || method === 'session/load') {
        if (options.pendingStart) return new Promise(function (resolve) { startResolve = resolve; });
        return Promise.resolve({ sessionId: vendor + '-session', modes: { currentModeId: 'default' } });
      }
      if (method === 'session/prompt') return new Promise(function (resolve) { promptResolve = resolve; });
      return Promise.resolve({});
    },
    notify: function (method, params) {
      calls.push({ method: method, params: params });
      if (options.failCancel) return false;
    },
    respond: function (id, result) { replies.push({ id: id, result: result }); },
  };
  var opts = { vendor: vendor, cwd: process.cwd(), model: 'auto', abortController: controller,
    driver: profiles.getAcpAgentDriver(vendor),
    canUseTool: function () { return new Promise(function (resolve) { permissionResolve = resolve; }); },
  };
  var handle = vendor === 'kiro' ? kiroCreate(server, opts) : acpCreate(server, opts);
  return { handle: handle, controller: controller, calls: calls, handlers: handlers, replies: replies,
    startReady: function () { return !!startResolve; }, resolveStart: function () { startResolve({ sessionId: vendor + '-session' }); },
    promptReady: function () { return !!promptResolve; }, resolvePrompt: function () { promptResolve({ stopReason: 'end_turn' }); },
    permissionReady: function () { return !!permissionResolve; }, approve: function () { permissionResolve({ behavior: 'allow' }); },
  };
}

['grok', 'kimi', 'copilot', 'qwen', 'junie', 'opencode', 'kiro'].forEach(function (vendor) {
  test(vendor + ': active Stop cancels only its session and releases a hung prompt', async function () {
    var f = fixture(vendor);
    f.handle.pushMessage('start'); await until(f.promptReady);
    f.handle.pushMessage('queued');
    f.controller.abort(); await tick();
    assert.equal(f.handle.pushMessage('late'), false);
    assert.equal(f.handlers.length, 0);
    var cancels = f.calls.filter(function (call) { return call.method === 'session/cancel'; });
    assert.deepEqual(cancels.map(function (call) { return call.params; }), [{ sessionId: vendor + '-session' }]);
    f.handle.abort(); await tick();
    assert.equal(f.calls.filter(function (call) { return call.method === 'session/cancel'; }).length, 1);
  });
  test(vendor + ': Stop before or during startup never launches a prompt', async function () {
    var f = fixture(vendor, { preAborted: true });
    await tick(); assert.equal(f.handle.pushMessage('never'), false); assert.equal(f.calls.length, 0);
    f = fixture(vendor, { pendingStart: true });
    f.handle.pushMessage('start'); await until(f.startReady);
    f.controller.abort(); await tick(); assert.equal(f.handlers.length, 0);
    f.resolveStart(); await tick();
    assert.equal(f.calls.some(function (call) { return call.method === 'session/prompt'; }), false);
  });
  test(vendor + ': Stop cancels pending permission and ignores a late approval', async function () {
    var f = fixture(vendor); f.handle.pushMessage('start'); await until(f.promptReady);
    f.handlers[0].fn({ id: 4, method: 'session/request_permission', params: {
      sessionId: vendor + '-session', toolCall: { toolCallId: 'tool', title: 'Command', kind: 'execute' },
      options: [{ kind: 'allow_once', optionId: 'allow' }, { kind: 'reject_once', optionId: 'deny' }],
    } });
    await until(f.permissionReady); f.controller.abort(); await tick(); f.approve(); await tick();
    assert.deepEqual(f.replies, [{ id: 4, result: { outcome: { outcome: 'cancelled' } } }]);
  });
  test(vendor + ': idle Stop releases the between-turn message wait', async function () {
    var f = fixture(vendor); f.handle.pushMessage('start'); await until(f.promptReady);
    f.resolvePrompt(); await tick(); f.controller.abort(); await tick();
    assert.equal(f.handlers.length, 0); assert.equal(f.handle.pushMessage('late'), false);
  });
  test(vendor + ': failed cancel delivery reaches the event stream', async function () {
    var f = fixture(vendor, { failCancel: true }); f.handle.pushMessage('start'); await until(f.promptReady);
    f.controller.abort(); await tick(); var errors = [];
    for await (var event of f.handle) if (event.yokeType === 'error') errors.push(event.text);
    assert.equal(errors.length, 1); assert.match(errors[0], /could not be delivered/);
  });
});

function agyFixture(controller) {
  var kills = [], spawns = 0, proc;
  var handle = agyCreate('/fixture/agy', { abortController: controller, _spawn: function () {
    spawns++; proc = new EventEmitter(); proc.stdout = new PassThrough(); proc.stderr = new PassThrough();
    proc.stdin = { write: function () { return true; }, end: function () {} };
    proc.kill = function (signal) { kills.push(signal); };
    return proc;
  } });
  return { handle: handle, kills: kills, spawns: function () { return spawns; }, exit: function () { proc.emit('exit', null, 'SIGINT'); } };
}
test('Antigravity: external Stop reaches SIGINT and escalates only its owned process', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var controller = new AbortController(); var f = agyFixture(controller);
  f.handle.pushMessage('start'); controller.abort();
  assert.deepEqual(f.kills, ['SIGINT']); assert.equal(f.handle.pushMessage('late'), false);
  t.mock.timers.tick(5000); assert.deepEqual(f.kills, ['SIGINT', 'SIGKILL']); f.exit();
});
test('Antigravity: pre-abort prevents spawn; normal exit cancels escalation', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var controller = new AbortController(); controller.abort(); var f = agyFixture(controller);
  assert.equal(f.handle.pushMessage('never'), false); assert.equal(f.spawns(), 0);
  controller = new AbortController(); f = agyFixture(controller); f.handle.pushMessage('start'); controller.abort(); f.exit();
  t.mock.timers.tick(5000); assert.deepEqual(f.kills, ['SIGINT']);
});
test('Claude SDK: controller Stop closes input immediately including pre-aborted queries', function () {
  [false, true].forEach(function (preAborted) {
    var controller = new AbortController(); if (preAborted) controller.abort();
    var queue = claude.createMessageQueue();
    var handle = claude.createQueryHandle({}, queue, controller);
    if (!preAborted) controller.abort();
    assert.equal(handle.pushMessage('late'), false); assert.equal(queue.push({}), false); handle.close();
  });
});
test('Claude IPC: repeated Stop does not postpone kill and rejects new messages', function (t) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  var calls = [], kills = [];
  var worker = { messageHandlers: [], onMessage: function (fn) { this.messageHandlers.push(fn); }, send: function (message) { calls.push(message); return true; }, process: { pid: 1, kill: function (signal) { kills.push(signal); } } };
  var handle = claude.createWorkerQueryHandle(worker);
  handle.abort(); t.mock.timers.tick(3000); handle.abort(); t.mock.timers.tick(2000);
  assert.equal(calls.filter(function (m) { return m.type === 'abort'; }).length, 1);
  assert.deepEqual(kills, ['SIGKILL']); assert.equal(handle.pushMessage('late'), false); handle.close();
});
test('ACP transport: cancelling one request frees its timer and preserves another request', async function () {
  var manager = new Manager('/fixture', {}); var messages = [];
  manager.started = true; manager.proc = { stdin: { write: function (text) { messages.push(JSON.parse(text)); } } };
  var controller = new AbortController();
  var first = manager.send('session/prompt', { sessionId: 'one' }, 60000, controller.signal);
  var second = manager.send('session/prompt', { sessionId: 'two' }, 60000);
  controller.abort(); await assert.rejects(first, { name: 'AbortError' });
  assert.equal(Object.keys(manager.pendingRequests).length, 1);
  manager.pendingRequests[messages[1].id].resolve({ stopReason: 'end_turn' }); await second;
  assert.equal(Object.keys(manager.pendingRequests).length, 0);
});

test('Claude IPC: Stop aborts interaction signals and denies late permission approval', async function () {
  var listener, approve, signal;
  var calls = [];
  var worker = { onMessage: function (fn) { listener = fn; }, send: function (message) { calls.push(message); return true; } };
  var handle = claude.createWorkerQueryHandle(worker, function (name, input, context) {
    signal = context.signal;
    return new Promise(function (resolve) { approve = resolve; });
  });
  listener({ type: 'permission_request', requestId: 'permission', toolName: 'Bash', input: {} });
  handle.abort();
  assert.equal(signal.aborted, true);
  approve({ behavior: 'allow', updatedInput: {} });
  await Promise.resolve();
  assert.equal(calls.filter(function (m) { return m.type === 'permission_response'; })[0].result.behavior, 'deny');
  clearTimeout(worker._abortTimeout);
  handle.close();
});
