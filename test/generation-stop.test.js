var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var vm = require('node:vm');
var createTurnStop = require('../lib/yoke/codex-turn-stop').createTurnStop;
var codex = require('../lib/yoke/adapters/codex');

function fixture() {
  var calls = [];
  var errors = [];
  var server = { started: true, send: function (method, params) {
    calls.push({ method: method, params: params }); return Promise.resolve({});
  } };
  return { server: server, calls: calls, errors: errors, stop: createTurnStop(server, function (err) { errors.push(err); }) };
}

test('Codex Stop sends exact current turn identity once', async function () {
  var f = fixture();
  f.stop.begin('thread'); f.stop.started('old'); f.stop.completed('old');
  f.stop.begin('thread'); f.stop.started('current');
  var pending = f.stop.abort();
  assert.equal(f.stop.abort(), pending);
  f.stop.completed('current');
  await pending;
  assert.deepEqual(f.calls, [{ method: 'turn/interrupt', params: { threadId: 'thread', turnId: 'current' } }]);
});

test('Stop during turn/start waits for its identity without interrupting the previous turn', async function () {
  var f = fixture();
  f.stop.begin('thread'); f.stop.started('old'); f.stop.completed('old');
  f.stop.begin('thread');
  var pending = f.stop.abort();
  await Promise.resolve(); assert.equal(f.calls.length, 0);
  f.stop.startSettled('new');
  await pending;
  assert.equal(f.calls[0].params.turnId, 'new');
});

test('turn notification can deliver cancellation identity before the start response', async function () {
  var f = fixture(); f.stop.begin('thread');
  var pending = f.stop.abort();
  f.stop.started('new'); f.stop.startSettled('new');
  await pending; assert.equal(f.calls.length, 1);
});

test('a late start response cannot resurrect a completed turn', async function () {
  var f = fixture(); f.stop.begin('thread'); f.stop.started('done');
  f.stop.completed('done'); f.stop.startSettled('done');
  await f.stop.abort(); assert.equal(f.calls.length, 0);
});

test('idle and failed-start Stop do not send an invalid interrupt', async function () {
  var f = fixture(); await f.stop.abort(); assert.equal(f.calls.length, 0);
  f = fixture(); f.stop.begin('thread');
  var pending = f.stop.abort(); f.stop.startSettled(null);
  await pending; assert.equal(f.calls.length, 0);
});

test('interrupt rejection and disconnection are reported', async function () {
  var f = fixture();
  f.server.send = function () { return Promise.reject(new Error('rejected')); };
  f.stop.begin('thread'); f.stop.started('turn'); await f.stop.abort();
  assert.equal(f.errors[0].message, 'rejected');
  f = fixture(); f.server.started = false;
  f.stop.begin('thread'); f.stop.started('turn'); await f.stop.abort();
  assert.equal(f.errors.length, 1); assert.equal(f.calls.length, 0);
});

test('adapter Stop during start interrupts the returned turn and finishes the iterator', async function () {
  var calls = [];
  var resolveStart;
  var controller = new AbortController();
  var server = { started: true, addHandler: function () { return {}; }, removeHandler: function () {}, send: function (method, params) {
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread' } });
    if (method === 'turn/start') return new Promise(function (resolve) { resolveStart = resolve; });
    if (method === 'turn/interrupt') { calls.push(params); return Promise.resolve({}); }
    return Promise.resolve({});
  } };
  var handle = codex.contractTestKit.createQueryHandle(server, { cwd: process.cwd(), skipSkills: true, abortController: controller });
  handle.pushMessage('test');
  while (!resolveStart) await new Promise(function (resolve) { setImmediate(resolve); });
  controller.abort();
  resolveStart({ turn: { id: 'turn' } });
  for await (var event of handle) { /* Drain until Stop ends the iterator. */ }
  assert.deepEqual(calls, [{ threadId: 'thread', turnId: 'turn' }]);
});

test('emergency Stop only sends on a connected processing session', function () {
  var state = { connected: true, processing: true };
  var listener;
  var click;
  var hidden;
  var sent = [];
  var button = { addEventListener: function (name, fn) { click = fn; } };
  var ws = { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } };
  var source = fs.readFileSync('lib/public/modules/generation-stop.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  var context = { store: { get: function (key) { return state[key]; }, subscribe: function (fn) { listener = fn; } }, getWs: function () { return ws; }, document: { getElementById: function (id) {
    if (id === 'generation-stop') return button;
    return { classList: { toggle: function (name, value) { hidden = value; } } };
  } } };
  vm.runInNewContext(source + '\ninitGenerationStop();', context);
  click(); assert.deepEqual(sent, [{ type: 'stop' }]);
  assert.equal(hidden, false); assert.equal(button.disabled, false);
  state = { connected: false, processing: true }; listener(state, { connected: true, processing: true });
  click(); assert.equal(sent.length, 1); assert.equal(button.disabled, true);
  state = { connected: true, processing: false }; listener(state, { connected: false, processing: true });
  click(); assert.equal(sent.length, 1); assert.equal(hidden, true);
});

test('adapter surfaces interrupt rejection before ending generation', async function () {
  var handler;
  var began;
  var server = { started: true, addHandler: function (fn) { handler = fn; return {}; }, removeHandler: function () {}, send: function (method) {
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread' } });
    if (method === 'turn/start') {
      handler({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'turn' } } });
      began = true; return Promise.resolve({ turn: { id: 'turn' } });
    }
    if (method === 'turn/interrupt') return Promise.reject(new Error('test rejection'));
    return Promise.resolve({});
  } };
  var handle = codex.contractTestKit.createQueryHandle(server, { cwd: process.cwd(), skipSkills: true });
  handle.pushMessage('test');
  while (!began) await new Promise(function (resolve) { setImmediate(resolve); });
  await handle.abort();
  var errors = [];
  for await (var event of handle) if (event.yokeType === 'error') errors.push(event.text);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /could not be confirmed/);
});

test('Stop between turns releases the query handler and discards queued input', async function () {
  var handler;
  var removed = false;
  var server = { started: true, addHandler: function (fn) { handler = fn; return {}; }, removeHandler: function () { removed = true; }, send: function (method) {
    if (method === 'thread/start') return Promise.resolve({ thread: { id: 'thread' } });
    if (method === 'turn/start') {
      setImmediate(function () { handler({ method: 'turn/completed', params: { threadId: 'thread' } }); });
      return Promise.resolve({ turn: { id: 'turn' } });
    }
    assert.notEqual(method, 'turn/interrupt');
    return Promise.resolve({});
  } };
  var handle = codex.contractTestKit.createQueryHandle(server, { cwd: process.cwd(), skipSkills: true });
  handle.pushMessage('test');
  for await (var event of handle) if (event.yokeType === 'result') break;
  await new Promise(function (resolve) { setImmediate(resolve); });
  await handle.abort();
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(removed, true);
  assert.equal(handle.pushMessage('should not run'), false);
});

test('Codex pre-aborted controller rejects input before starting a thread', async function () {
  var controller = new AbortController(); controller.abort();
  var calls = [];
  var server = { started: true, send: function (method) { calls.push(method); return Promise.resolve({}); } };
  var handle = codex.contractTestKit.createQueryHandle(server, { cwd: process.cwd(), skipSkills: true, abortController: controller });
  assert.equal(handle.pushMessage('late'), false);
  for await (var event of handle) { /* Drain cancellation. */ }
  assert.deepEqual(calls, []);
});

test('resumed Codex rejects old output and completion before and after the new turn starts', async function () {
  var handler, resume, start;
  var server = { started: true, addHandler: function (fn) { handler = fn; return {}; }, removeHandler: function () {}, send: function (method) {
    if (method === 'thread/resume') return new Promise(function (resolve) { resume = resolve; });
    if (method === 'turn/start') return new Promise(function (resolve) { start = resolve; });
    return Promise.resolve({});
  } };
  var handle = codex.contractTestKit.createQueryHandle(server, { cwd: process.cwd(), skipSkills: true, resumeSessionId: 'thread' });
  function delta(turn, text) { handler({ method: 'item/agentMessage/delta', params: { threadId: 'thread', turnId: turn, itemId: turn, delta: text } }); }
  function complete(turn) { handler({ method: 'turn/completed', params: { threadId: 'thread', turn: { id: turn, status: 'completed' } } }); }
  handle.pushMessage('new prompt');
  delta('old', 'stale replay during resume');
  resume({ thread: { id: 'thread' } });
  while (!start) await new Promise(function (resolve) { setImmediate(resolve); });
  delta('old', 'stale before start response'); complete('old');
  handler({ method: 'turn/started', params: { threadId: 'thread', turn: { id: 'new' } } });
  delta('new', 'fresh before start response');
  start({ turn: { id: 'new' } });
  await new Promise(function (resolve) { setImmediate(resolve); });
  delta('old', 'stale after start response'); complete('old');
  delta('new', 'fresh after stale completion');
  handle.endInput(); complete('new');
  var texts = [];
  for await (var event of handle) if (event.yokeType === 'text_delta') texts.push(event.text);
  assert.deepEqual(texts, ['fresh before start response', 'fresh after stale completion']);
});
