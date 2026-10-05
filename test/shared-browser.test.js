var test = require('node:test');
var assert = require('node:assert/strict');
var attach = require('../lib/project-shared-browser').attachSharedBrowser;
var policy = require('../lib/shared-browser-policy');
function turn() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function harness() {
  var session = { localId: 1, ownerId: 'alice' };
  var sessions = new Map([[1, session]]);
  var peers = new Set(); var messages = []; var runtimes = []; var permit = true;
  var controller = attach({ slug: 'demo', sm: { sessions: sessions }, clients: peers,
    usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === 'alice' ? { id: id } : null; } },
    requestAccess: { canAccessProject: function () { return permit; }, hasPermission: function () { return permit; } },
    getIdentity: function () { return null; }, getSessionForWs: function (ws) { return sessions.get(ws.sessionId); },
    sendTo: function (ws, message) { messages.push({ ws: ws, message: message }); },
    createRuntime: function (options) {
      var runtime = { closed: false, requests: [], control: function (epoch) { this.epoch = epoch; }, viewing: function (visible) { this.visible = visible; },
        counter: 0, last: null,
        request: function (action, event, epoch) { this.requests.push({ action: action, event: event, epoch: epoch, id: ++this.counter }); this.last = Promise.resolve({ url: 'https://example.com/', image: 'fixture', snapshot: 'page' }); return this.last; },
        settle: function () { var through = ++this.counter; return Promise.resolve(this.last).catch(function () {}).then(function () { return { through: through }; }); },
        close: function () { this.closed = true; }, emit: options.onEvent };
      runtimes.push(runtime); setImmediate(function () { options.onEvent({ type: 'ready' }); }); return runtime;
    },
  });
  var alice = { _clayUser: { id: 'alice' }, sessionId: 1, readyState: 1, bufferedAmount: 0 };
  var bob = { _clayUser: { id: 'bob' }, sessionId: 1, readyState: 1, bufferedAmount: 0 };
  peers.add(alice); peers.add(bob);
  function state() { var entry = messages.filter(function (m) { return m.ws === alice && m.message.type === 'shared_browser_state'; }).pop(); return entry && entry.message.browser; }
  async function send(type, fields, ws) { controller.handleMessage(ws || alice, Object.assign({ type: 'shared_browser_' + type, sessionId: 1, browserId: state() && state().id, epoch: state() && state().epoch }, fields)); await turn(); await turn(); }
  return { controller: controller, session: session, sessions: sessions, alice: alice, bob: bob, runtimes: runtimes, messages: messages,
    state: state, send: send, revoke: function () { permit = false; }, tool: controller.getToolDefs(session)[0].handler };
}

test('shared browser URLs and input reject non-web schemes and unbounded actions', function () {
  assert.equal(policy.browserUrl('example.com'), 'https://example.com/');
  assert.equal(policy.browserUrl('http://localhost:3000'), 'http://localhost:3000/');
  ['file:///etc/passwd', 'javascript://alert(1)', 'https://name:secret@example.com', 'ftp://example.com'].forEach(function (url) { assert.throws(function () { policy.browserUrl(url); }); });
  assert.equal(policy.visibleUrl('https://example.com/path?token=secret#fragment'), 'https://example.com/path');
  assert.throws(function () { policy.validateAction({ kind: 'evaluate', script: '1' }); });
  assert.throws(function () { policy.validateAction({ kind: 'resize', width: 10000, height: 800 }); });
});
test('UI-created tabs start shared: owner and Clay both act without changing control or epoch', async function () {
  var h = harness();
  try {
    await h.send('open'); var start = h.state();
    assert.equal(start.control, 'agent');
    assert.equal(h.messages.some(function (m) { return m.ws === h.bob; }), false);
    assert.equal((await h.tool({ action: 'navigate', url: 'https://example.com' })).isError, undefined);
    assert.equal(h.runtimes.length, 1, 'agent open/actions reuse the UI-created tab');
    var kinds = [{ kind: 'navigate', url: 'https://example.org' }, { kind: 'back' }, { kind: 'forward' }, { kind: 'reload' }, { kind: 'move', x: 1, y: 2 }, { kind: 'down', x: 1, y: 2 }, { kind: 'up', x: 1, y: 2 }, { kind: 'click', x: 3, y: 4 }, { kind: 'wheel', deltaY: 40 }, { kind: 'text', text: 'hi' }, { kind: 'key', key: 'Enter' }, { kind: 'resize', width: 800, height: 600 }];
    for (var i = 0; i < kinds.length; i++) {
      await h.send('input', { event: kinds[i] });
      assert.equal(h.runtimes[0].requests.length, 2 + 2 * i, 'human ' + kinds[i].kind + ' reaches the worker');
      assert.equal((await h.tool({ action: 'click', x: 9, y: 9 })).isError, undefined, 'Clay still acts after human ' + kinds[i].kind);
    }
    assert.equal(h.state().control, 'agent'); assert.equal(h.state().epoch, start.epoch); assert.equal(h.state().handoff, false);
    var order = h.runtimes[0].requests.map(function (r) { return r.id; });
    assert.deepEqual(order, order.slice().sort(function (x, y) { return x - y; }), 'shared requests are serialized in arrival order');
  } finally { h.controller.destroy(); }
});
test('finish settles activity but retains the page and Clay permission', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    var before = h.state(); var epoch = before.epoch;
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { id: 0, text: 'Checking the page', phase: 'running' } });
    h.runtimes[0].emit({ type: 'pointer', epoch: epoch, generation: 0, pointer: { x: 3, y: 4, width: 1280, height: 800, sequence: 1, commandId: 0 } });
    assert.equal(h.state().activity.phase, 'running');
    var finished = JSON.parse((await h.tool({ action: 'finish' })).content[0].text);
    assert.equal(finished.control, 'agent');
    assert.equal(h.state().control, 'agent'); assert.equal(h.state().epoch, epoch); assert.equal(h.state().handoff, false);
    assert.equal(h.state().activity, null); assert.equal(h.state().pointer, null);
    assert.equal(h.state().activityHistory[0].phase, 'interrupted');
    assert.equal(h.runtimes[0].closed, false);
    assert.equal((await h.tool({ action: 'click', x: 1, y: 1 })).isError, undefined, 'no repeated grant is needed');
    assert.equal(JSON.parse((await h.tool({ action: 'open' })).content[0].text).id, before.id, 'open reuses the finished tab');
    assert.equal(h.runtimes.length, 1);
  } finally { h.controller.destroy(); }
});
test('exclusive human mode denies Clay mutations while the human still operates; resume restores sharing', async function () {
  var h = harness();
  try {
    await h.send('open');
    await h.send('control', { control: 'user' });
    var humanId = h.state().id; var epoch = h.state().epoch;
    assert.equal(h.state().control, 'user');
    var denied = await h.tool({ action: 'navigate', url: 'https://example.com' });
    assert.equal(denied.isError, true); assert.match(denied.content[0].text, /Only the user can control/);
    assert.equal((await h.tool({ action: 'resize', width: 800, height: 600 })).isError, true, 'agent resize is denied too');
    assert.equal(h.runtimes[0].requests.length, 0);
    assert.equal((await h.tool({ action: 'inspect' })).content[1].type, 'image', 'Clay may still inspect');
    await h.send('input', { event: { kind: 'text', text: 'human' } });
    await h.send('input', { event: { kind: 'navigate', url: 'https://example.com' } });
    await h.send('input', { event: { kind: 'resize', width: 800, height: 600 } });
    assert.equal(h.runtimes[0].requests.length, 4, 'inspect plus human input still works in exclusive mode');
    assert.equal(h.state().control, 'user'); assert.equal(h.state().epoch, epoch, 'human input never changes control or epoch');
    await h.tool({ action: 'finish' });
    assert.equal(h.state().control, 'user', 'finish does not resume sharing');
    var other = JSON.parse((await h.tool({ action: 'open', url: 'https://example.com' })).content[0].text);
    assert.notEqual(other.id, humanId, 'agent open creates an independent shared tab instead of reusing the exclusive one');
    assert.equal(other.control, 'agent');
    await h.send('control', { browserId: humanId, control: 'agent' });
    assert.equal((await h.tool({ action: 'click', browserId: humanId, x: 1, y: 1 })).isError, undefined, 'Clay acts again after resume');
  } finally { h.controller.destroy(); }
});
test('hide/reopen preserves runtime; only owner and current session receive frames', async function () {
  var h = harness();
  try {
    await h.send('open'); await h.send('view', { visible: true });
    assert.equal(h.runtimes[0].visible, true);
    await h.send('view', { visible: true }, h.bob);
    h.runtimes[0].emit({ type: 'frame', data: 'private', url: 'https://example.com', width: 1280, height: 800 });
    assert.equal(h.messages.some(function (m) { return m.ws === h.bob && m.message.type === 'shared_browser_frame'; }), false);
    await h.send('view', { visible: false }); assert.equal(h.runtimes[0].closed, false); assert.equal(h.runtimes[0].visible, false);
    await h.send('view', { visible: true }); assert.equal(h.runtimes.length, 1);
    h.alice.sessionId = 2;
    var before = h.messages.length; h.runtimes[0].emit({ type: 'frame', data: 'private' }); assert.equal(h.messages.length, before);
  } finally { h.controller.destroy(); }
});
test('takeover invalidates an in-flight agent result and stale input', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    var resolve;
    h.runtimes[0].request = function () { return new Promise(function (done) { resolve = done; }); };
    var pending = h.tool({ action: 'click', x: 10, y: 10 }); await turn();
    var epoch = h.state().epoch;
    await h.send('control', { control: 'user' }); resolve({});
    assert.equal((await pending).isError, true);
    await h.send('input', { epoch: epoch, event: { kind: 'text', text: 'stale' } });
    assert.match(h.messages[h.messages.length - 1].message.error, /control changed/);
  } finally { h.controller.destroy(); }
});
test('live permission and session deletion revoke tools and streamed data', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn(); h.revoke();
    assert.equal((await h.tool({ action: 'inspect' })).isError, true);
    h.runtimes[0].emit({ type: 'frame', data: 'secret' }); assert.equal(h.runtimes[0].closed, true);
    assert.equal(h.messages.some(function (m) { return m.message.data === 'secret'; }), false);
    h.sessions.delete(1); assert.equal((await h.tool({ action: 'open' })).isError, true);
  } finally { h.controller.destroy(); }
});
test('ended browser retains last frame but a new instance rejects stale controls', async function () {
  var h = harness();
  try {
    await h.send('open'); var id = h.state().id;
    await h.send('end'); assert.equal(h.runtimes[0].closed, true); assert.equal(h.state().phase, 'ended');
    await h.send('open'); assert.notEqual(h.state().id, id);
    await h.send('end', { browserId: id }); assert.equal(h.runtimes[1].closed, false);
  } finally { h.controller.destroy(); }
});

test('ownership changes discard the old browser before exposing a new session owner', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    h.session.ownerId = 'bob';
    h.runtimes[0].emit({ type: 'frame', data: 'old-owner-secret' });
    assert.equal(h.runtimes[0].closed, true);
    assert.equal(h.messages.some(function (m) { return m.message.data === 'old-owner-secret'; }), false);
  } finally { h.controller.destroy(); }
});
test('retained native tool definitions reject a superseded query generation', async function () {
  var h = harness();
  try {
    h.session._sdkQueryGeneration = 1;
    assert.equal((await h.tool({ action: 'open' })).isError, true);
    assert.equal(h.runtimes.length, 0);
  } finally { h.controller.destroy(); }
});
test('human input stays disabled until an in-flight control handoff completes', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    var acknowledge;
    h.runtimes[0].control = function () { return new Promise(function (resolve) { acknowledge = resolve; }); };
    await h.send('control', { control: 'user' });
    assert.equal(h.state().handoff, true);
    await h.send('input', { event: { kind: 'text', text: 'too soon' } });
    assert.equal(h.runtimes[0].requests.length, 0);
    acknowledge(); await turn();
    assert.equal(h.state().handoff, false);
    await h.send('input', { event: { kind: 'text', text: 'now' } });
    assert.equal(h.runtimes[0].requests.length, 1);
  } finally { h.controller.destroy(); }
});


test('browser activity is private, generation-bound and cleared on takeover', async function () {
  var h = harness();
  try {
    await h.send('open'); await h.send('control', { control: 'agent' });
    var epoch = h.state().epoch;
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { text: 'Checking the search results', phase: 'running' } });
    assert.equal(h.state().activity.text, 'Checking the search results');
    h.runtimes[0].emit({ type: 'pointer', epoch: epoch, generation: 0, pointer: { x: 30, y: 40, width: 1280, height: 800, sequence: 1 } });
    assert.equal(h.state().pointer.x, 30);
    assert.equal(h.messages.some(function(m) { return m.ws === h.bob; }), false);
    h.runtimes[0].emit({ type: 'activity', epoch: epoch - 1, generation: 0, activity: { text: 'Stale', phase: 'running' } });
    assert.equal(h.state().activity.text, 'Checking the search results');
    h.session._sdkQueryGeneration = 1;
    h.runtimes[0].emit({ type: 'state' });
    assert.equal(h.state().activity, null);
    assert.equal(h.state().pointer, null);
    await h.send('control', { control: 'user' });
    h.runtimes[0].emit({ type: 'pointer', epoch: epoch, generation: 1, pointer: { x: 30, y: 40 } });
    assert.equal(h.state().pointer, null);
    assert.equal((await h.controller.getToolDefs(h.session)[0].handler({ action: 'inspect', intent: 'x'.repeat(161) })).isError, true);
  } finally { h.controller.destroy(); }
});

test('agent opens its own tab without taking user control; explicit IDs isolate actions', async function () {
  var h = harness();
  try {
    await h.send('open'); var userId = h.state().id; await h.send('control', { control: 'user' });
    var opened = JSON.parse((await h.tool({ action: 'open', url: 'https://example.com' })).content[0].text);
    assert.notEqual(opened.id, userId);
    assert.equal(opened.control, 'agent');
    assert.equal(h.runtimes.length, 2);
    assert.equal(h.runtimes[0].requests.length, 0);
    assert.equal((await h.tool({ action: 'click', x: 1, y: 1 })).isError, true);
    assert.equal((await h.tool({ action: 'click', browserId: userId, x: 1, y: 1 })).isError, true);
    assert.equal((await h.tool({ action: 'click', browserId: opened.id, x: 1, y: 1 })).isError, undefined);
    var status = JSON.parse((await h.tool({ action: 'status' })).content[0].text);
    assert.equal(status.browsers.length, 2);
    assert.equal(status.browsers.find(function (tab) { return tab.id === userId; }).control, 'user');
    await h.send('view', { browserId: userId, visible: true });
    await h.send('view', { browserId: opened.id, visible: true });
    assert.equal(h.runtimes[0].visible, false);
    assert.equal(h.runtimes[1].visible, true);
    await h.send('close', { browserId: opened.id });
    assert.equal(h.runtimes[1].closed, true);
    assert.equal(h.runtimes[0].closed, false);
    assert.equal((await h.tool({ action: 'inspect', browserId: opened.id })).isError, true);
  } finally { h.controller.destroy(); }
});

test('tab IDs cannot cross conversations and independent tabs retain resource limits', async function () {
  var h = harness();
  try {
    var first = JSON.parse((await h.tool({ action: 'open' })).content[0].text);
    var other = { localId: 2, ownerId: 'alice' }; h.sessions.set(2, other);
    assert.equal((await h.controller.getToolDefs(other)[0].handler({ action: 'inspect', browserId: first.id })).isError, true);
    for (var i = 0; i < 3; i++) assert.equal((await h.tool({ action: 'open', newTab: true })).isError, undefined);
    assert.equal((await h.tool({ action: 'open', newTab: true })).isError, true);
    assert.equal(h.runtimes.length, 4);
  } finally { h.controller.destroy(); }
});
test('hide, reopen and reconnect preserve the control mode; closed tabs cannot be operated', async function () {
  var h = harness();
  try {
    await h.send('open'); var id = h.state().id;
    await h.send('view', { visible: true }); await h.send('view', { visible: false }); await h.send('view', { visible: true });
    assert.equal(h.state().control, 'agent');
    await h.send('control', { control: 'user' });
    var epoch = h.state().epoch;
    await h.send('view', { visible: false }); await h.send('state_request'); await h.send('view', { visible: true });
    assert.equal(h.state().control, 'user'); assert.equal(h.state().id, id); assert.equal(h.state().epoch, epoch);
    assert.equal((await h.tool({ action: 'click', x: 1, y: 1 })).isError, true);
    await h.send('control', { control: 'agent' });
    await h.send('state_request'); assert.equal(h.state().control, 'agent');
    await h.send('close', { browserId: id });
    assert.equal((await h.tool({ action: 'click', browserId: id, x: 1, y: 1 })).isError, true);
    assert.equal(h.runtimes[0].closed, true);
  } finally { h.controller.destroy(); }
});

// Deferred in-flight browser request that, like the real worker, owns a command id.
function deferRequest(runtime) {
  var finish; var id; var used = false;
  runtime.request = function (action, event, epoch) {
    var mine = ++runtime.counter; runtime.requests.push({ action: action, event: event, epoch: epoch, id: mine });
    if (used) return Promise.resolve({});
    used = true; id = mine;
    runtime.last = new Promise(function (resolve) { finish = resolve; });
    return runtime.last;
  };
  return { id: function () { return id; }, done: function (value) { finish(value || {}); } };
}
test('finish waits for an earlier running action and rejects its late telemetry without hiding live work', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    var deferred = deferRequest(h.runtimes[0]);
    var action = h.tool({ action: 'click', x: 5, y: 5 }); await turn();
    var epoch = h.state().epoch; var first = deferred.id();
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { id: first, text: 'Clicking', phase: 'running' } });
    var settled = false;
    var finishing = h.tool({ action: 'finish' }).then(function (r) { settled = true; return r; }); await turn(); await turn();
    assert.equal(settled, false, 'finish does not return while earlier work is still running');
    assert.equal(h.state().activity.phase, 'running', 'genuinely ongoing activity stays visible');
    h.runtimes[0].emit({ type: 'pointer', epoch: epoch, generation: 0, pointer: { x: 1, y: 1, sequence: 1, commandId: first } });
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { id: first, text: 'Clicking', phase: 'complete' } });
    deferred.done(); await action; var result = await finishing;
    assert.equal(result.isError, undefined);
    assert.equal(h.state().activity, null); assert.equal(h.state().pointer, null);
    assert.equal(h.state().control, 'agent'); assert.equal(h.state().epoch, epoch);
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { id: first, text: 'Clicking', phase: 'running' } });
    h.runtimes[0].emit({ type: 'pointer', epoch: epoch, generation: 0, pointer: { x: 2, y: 2, sequence: 2, commandId: first } });
    assert.equal(h.state().activity, null, 'pre-finish telemetry cannot resurrect working state');
    assert.equal(h.state().pointer, null);
    var next = deferRequest(h.runtimes[0]);
    var later = h.tool({ action: 'click', x: 6, y: 6 }); await turn();
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { id: next.id(), text: 'Clicking again', phase: 'running' } });
    assert.equal(h.state().activity.text, 'Clicking again', 'work started after finish reports normally');
    next.done(); await later;
  } finally { h.controller.destroy(); }
});
test('an action queued after finish keeps its activity when the earlier boundary settles', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    var epoch = h.state().epoch;
    var finishing = h.tool({ action: 'finish' });
    var deferred = deferRequest(h.runtimes[0]);
    var action = h.tool({ action: 'click', x: 5, y: 5 });
    await finishing; await turn();
    h.runtimes[0].emit({ type: 'activity', epoch: epoch, generation: 0, activity: { id: deferred.id(), text: 'Concurrent step', phase: 'running' } });
    assert.equal(h.state().activity.text, 'Concurrent step');
    deferred.done(); await action;
  } finally { h.controller.destroy(); }
});
test('human takeover during finish keeps human control and human input flowing', async function () {
  var h = harness();
  try {
    await h.tool({ action: 'open' }); await turn();
    var deferred = deferRequest(h.runtimes[0]);
    var action = h.tool({ action: 'click', x: 5, y: 5 }); await turn();
    var finishing = h.tool({ action: 'finish' }); await turn();
    await h.send('control', { control: 'user' });
    assert.equal(h.state().control, 'user'); assert.equal(h.state().handoff, false);
    var epoch = h.state().epoch;
    var requests = h.runtimes[0].requests.length;
    await h.send('input', { event: { kind: 'text', text: 'human typing' } });
    assert.equal(h.runtimes[0].requests.length, requests + 1, 'finish does not block unrelated human input');
    deferred.done(); await action; var result = await finishing;
    assert.equal(result.isError, undefined);
    assert.equal(h.state().control, 'user', 'finish never restores Clay control');
    assert.equal(h.state().epoch, epoch); assert.equal(h.state().handoff, false);
  } finally { h.controller.destroy(); }
});
test('other users cannot operate or pause a shared tab', async function () {
  var h = harness();
  try {
    await h.send('open'); var before = h.state();
    await h.send('input', { epoch: before.epoch, event: { kind: 'resize', width: 800, height: 600 } }, h.bob);
    await h.send('input', { epoch: before.epoch, event: { kind: 'navigate', url: 'https://example.com' } }, h.bob);
    await h.send('control', { control: 'user' }, h.bob);
    assert.equal(h.runtimes[0].requests.length, 0);
    assert.equal(h.state().control, 'agent'); assert.equal(h.state().epoch, before.epoch);
  } finally { h.controller.destroy(); }
});
test('human input during a pause handoff is rejected until it completes, then flows', async function () {
  var h = harness();
  try {
    await h.send('open'); var acknowledge;
    h.runtimes[0].control = function () { return new Promise(function (resolve) { acknowledge = resolve; }); };
    await h.send('control', { control: 'user' });
    assert.equal(h.state().handoff, true);
    await h.send('input', { event: { kind: 'click', x: 1, y: 1 } });
    assert.equal(h.runtimes[0].requests.length, 0);
    acknowledge(); await turn();
    await h.send('input', { event: { kind: 'click', x: 1, y: 1 } });
    assert.equal(h.runtimes[0].requests.length, 1);
  } finally { h.controller.destroy(); }
});
