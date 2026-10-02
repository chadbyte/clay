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

// Minimal fake DOM node supporting the handful of APIs generation-stop.js
// actually calls: addEventListener, classList.toggle/contains, and
// reparenting via appendChild / insertBefore (both update parentNode, as the
// real DOM does, so a node is never left registered in two containers).
function makeNode(id) {
  var classes = {};
  var listeners = {};
  var node = {
    id: id,
    parentNode: null,
    children: [],
    classList: { toggle: function (name, on) { if (on) classes[name] = true; else delete classes[name]; }, contains: function (name) { return !!classes[name]; } },
    addEventListener: function (name, fn) { listeners[name] = fn; },
    dispatch: function (name) { if (listeners[name]) listeners[name](); },
    appendChild: function (child) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      node.children.push(child);
      child.parentNode = node;
      return child;
    },
    insertBefore: function (child, before) {
      if (child.parentNode) child.parentNode.children.splice(child.parentNode.children.indexOf(child), 1);
      var at = before ? node.children.indexOf(before) : -1;
      if (at === -1) node.children.push(child); else node.children.splice(at, 0, child);
      child.parentNode = node;
      return child;
    },
  };
  return node;
}

function loadGenerationStop(overrides) {
  var state = Object.assign({ connected: true, processing: true }, overrides && overrides.state);
  var listener;
  var sent = [];
  var locked = !!(overrides && overrides.locked);
  var els = {
    'generation-stop': makeNode('generation-stop'),
    'input-area': makeNode('input-area'),
    'input-bottom-right': makeNode('input-bottom-right'),
    'send-btn': makeNode('send-btn'),
  };
  // The unlocked default: Stop already sits beside Send, as index.html wires it.
  els['input-bottom-right'].appendChild(els['generation-stop']);
  els['input-bottom-right'].appendChild(els['send-btn']);
  var ws = { readyState: 1, send: function (message) { sent.push(JSON.parse(message)); } };
  var source = fs.readFileSync('lib/public/modules/generation-stop.js', 'utf8').replace(/^import .*;\n/gm, '').replace('export function', 'function');
  var context = {
    store: {
      get: function (key) { return state[key]; },
      subscribe: function (fn) { listener = fn; },
    },
    getWs: function () { return ws; },
    isDriverOperatedView: function () { return locked; },
    document: { getElementById: function (id) { return els[id] || null; } },
  };
  vm.runInNewContext(source + '\ninitGenerationStop();', context);
  return {
    els: els, sent: sent,
    button: els['generation-stop'],
    click: function () { els['generation-stop'].dispatch('click'); },
    setLocked: function (value) { locked = value; },
    setState: function (next) { var prev = state; state = Object.assign({}, state, next); listener(state, prev); },
  };
}

test('emergency Stop only sends on a connected processing session', function () {
  var f = loadGenerationStop();
  f.click(); assert.deepEqual(f.sent, [{ type: 'stop' }]);
  assert.equal(f.button.classList.contains('hidden'), false);
  assert.equal(f.button.disabled, false);
  f.setState({ connected: false, processing: true });
  f.click(); assert.equal(f.sent.length, 1); assert.equal(f.button.disabled, true);
  f.setState({ connected: true, processing: false });
  f.click(); assert.equal(f.sent.length, 1); assert.equal(f.button.classList.contains('hidden'), true);
});

test('Stop lives beside Send in the ordinary composer action row', function () {
  var f = loadGenerationStop({ locked: false });
  assert.equal(f.button.parentNode, f.els['input-bottom-right']);
  assert.ok(f.els['input-bottom-right'].children.indexOf(f.button) < f.els['input-bottom-right'].children.indexOf(f.els['send-btn']),
    'Stop sits before Send, never after it');
});

test('a locked configured Worker pane keeps Stop reachable outside the hidden composer', function () {
  var f = loadGenerationStop({ locked: true });
  assert.equal(f.button.parentNode, f.els['input-area'],
    'Stop is relocated to a direct child of #input-area, never left inside #input-bottom-right');
  assert.equal(f.els['input-bottom-right'].children.indexOf(f.button), -1,
    'no duplicate Stop is left behind in the composer action row');
});

test('Stop follows the pane across a lock/unlock transition, never duplicated', function () {
  var f = loadGenerationStop({ locked: false });
  assert.equal(f.button.parentNode, f.els['input-bottom-right']);
  f.setLocked(true);
  f.setState({ splitGroups: [{ id: 'sg1' }] });
  assert.equal(f.button.parentNode, f.els['input-area']);
  assert.equal(f.els['input-bottom-right'].children.indexOf(f.button), -1);
  f.setLocked(false);
  f.setState({ activeSessionId: 9 });
  assert.equal(f.button.parentNode, f.els['input-bottom-right']);
  assert.equal(f.els['input-area'].children.indexOf(f.button), -1);
  // At no point does either container hold the node twice.
  assert.equal(f.els['input-bottom-right'].children.filter(function (c) { return c === f.button; }).length, 1);
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
