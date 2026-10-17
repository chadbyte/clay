var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var WebSocket = require('ws');
test('real authenticated app sockets activate unseen pair history, reject stale actions and reconnect to latest pin', { timeout: 30000 }, async function (t) {
  var child = cp.fork(path.join(__dirname, 'fixtures/pane-reuse-server.cjs'), [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  t.after(function () { child.kill('SIGTERM'); });
  var logs = '';
  child.stdout.on('data', function (data) { logs += data; }); child.stderr.on('data', function (data) { logs += data; });
  var info = await new Promise(function (resolve, reject) {
    var timeout = setTimeout(function () { reject(new Error(logs)); }, 15000);
    child.once('message', function (value) { clearTimeout(timeout); resolve(value); });
    child.once('exit', function (code) { if (code) { clearTimeout(timeout); reject(new Error(logs)); } });
  });
  var origin = 'http://127.0.0.1:' + info.port;
  var login = await fetch(origin + '/fixture/login', { redirect: 'manual' });
  assert.equal(login.status, 302);
  var cookie = login.headers.get('set-cookie').split(';')[0];
  var html = await (await fetch(origin + '/p/reuse/', { headers: { cookie: cookie } })).text();
  assert.ok(html.includes('/fixture/bench.js'), 'production app exposes the Driver timing harness');
  var data = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  assert.equal(data.groups.length, 3); assert.equal(data.sessions.filter(function (item) { return item.sessionRole === 'worker'; }).length, 3);
  async function connect(id) {
    var ws = new WebSocket(origin.replace('http:', 'ws:') + '/p/reuse/ws?pane=1&session=' + id, { headers: { Cookie: cookie, Origin: origin } });
    var messages = [];
    ws.on('message', function (raw) {
      var message = JSON.parse(raw);
      if (message.type === 'pane_history_batch') message.items.forEach(function (item) { messages.push(Object.assign({}, item, { paneActivation: message.paneActivation })); });
      else messages.push(message);
    });
    t.after(function () { ws.terminate(); });
    await new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); });
    await wait(function () { return messages.some(function (item) { return item.type === 'split_groups'; }); });
    return { ws: ws, messages: messages };
  }
  async function wait(check) {
    var start = Date.now();
    while (!check()) { if (Date.now() - start > 5000) throw new Error('Product path deadline exceeded\n' + logs); await new Promise(function (resolve) { setTimeout(resolve, 5); }); }
  }
  function request(id, generation) {
    var target = data.sessions.find(function (item) { return item.id === id; });
    var group = data.groups.find(function (item) { return item.members.includes(id); });
    var parent = target.parentSessionId && data.sessions.find(function (item) { return item.id === target.parentSessionId; });
    return { type: 'switch_session', id: id, paneActivation: { requestId: 'real-' + generation, generation: generation, projectSlug: 'reuse', viewerId: 'owner', ownerId: 'owner',
      sessionOriginId: target.sessionOriginId, role: target.sessionRole, workerGeneration: target.workerGeneration || null,
      parentSessionOriginId: parent ? parent.sessionOriginId : null,
      groupStamp: group ? JSON.stringify({ id: group.id, members: group.members, pair: group.pair || null }) : null } };
  }
  var first = await connect(data.groups[0].pair.driverId), binding;
  for (var i = 1; i <= 35; i++) {
    var group = data.groups[i % data.groups.length], id = group.pair.driverId;
    await fetch(origin + '/fixture/history?id=' + id, { method: 'POST', headers: { cookie: cookie } });
    var message = request(id, i); first.messages.length = 0; first.ws.send(JSON.stringify(message));
    await wait(function () { return first.messages.some(function (item) { return item.type === 'pane_activation_snapshot_done' && item.paneActivation.generation === i; }); });
    binding = first.messages.find(function (item) { return item.type === 'pane_activation_snapshot_done'; }).paneActivation;
    assert.equal(binding.sessionId, id);
    assert.ok(first.messages.some(function (item) { return item.type === 'delta' && item.text.startsWith('UNSEEN_' + id); }));
    assert.ok(first.messages.every(function (item) { return !item.paneActivation || item.paneActivation.requestId === message.paneActivation.requestId; }));
  }
  var before = first.messages.length;
  first.ws.send(JSON.stringify({ type: 'input_sync', text: 'STALE_INPUT', paneBinding: Object.assign({}, binding, { sessionId: data.standaloneId }) }));
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  assert.equal(first.messages.length, before, 'stale mutation has no effects or response');
  var latest = binding.sessionId; first.ws.terminate();
  var reconnect = await connect(latest);
  reconnect.ws.send(JSON.stringify(request(latest, 1)));
  await wait(function () { return reconnect.messages.some(function (item) { return item.type === 'pane_activation_snapshot_done'; }); });
  assert.equal(reconnect.messages.find(function (item) { return item.type === 'pane_activation_snapshot_done'; }).paneActivation.sessionId, latest);
  var aId = data.groups[0].pair.driverId, bId = data.groups[1].pair.driverId;
  await fetch(origin + '/fixture/running?id=' + aId, { method: 'POST', headers: { cookie: cookie } });
  await fetch(origin + '/fixture/running?id=' + bId, { method: 'POST', headers: { cookie: cookie } });
  await fetch(origin + '/fixture/review?id=' + aId, { method: 'POST', headers: { cookie: cookie } });
  reconnect.messages.length = 0; reconnect.ws.send(JSON.stringify(request(aId, 2)));
  await wait(function () { return reconnect.messages.some(function (item) { return item.type === 'pane_activation_snapshot_done'; }); });
  var aBinding = reconnect.messages.find(function (item) { return item.type === 'pane_activation_snapshot_done'; }).paneActivation;
  assert.ok(reconnect.messages.some(function (item) { return item.type === 'permission_request_pending' && item.requestId === 'review-' + aId; }));
  reconnect.messages.length = 0; reconnect.ws.send(JSON.stringify(request(bId, 3)));
  await wait(function () { return reconnect.messages.some(function (item) { return item.type === 'pane_activation_snapshot_done'; }); });
  var bBinding = reconnect.messages.find(function (item) { return item.type === 'pane_activation_snapshot_done'; }).paneActivation;
  reconnect.ws.send(JSON.stringify({ type: 'stop', paneBinding: aBinding }));
  reconnect.ws.send(JSON.stringify({ type: 'permission_response', requestId: 'review-' + aId, decision: 'allow', paneBinding: bBinding }));
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  var effects = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  assert.deepEqual(effects.stopped, [], 'selection and stale Stop leave both running controllers alone');
  assert.deepEqual(effects.reviews, [], 'a review for the previous session cannot be applied from the destination');
  reconnect.ws.send(JSON.stringify({ type: 'stop', paneBinding: bBinding }));
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  effects = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  assert.deepEqual(effects.stopped, [bId], 'current Stop reaches only its authenticated target');
  reconnect.messages.length = 0; reconnect.ws.send(JSON.stringify(request(aId, 4)));
  await wait(function () { return reconnect.messages.some(function (item) { return item.type === 'pane_activation_snapshot_done'; }); });
  aBinding = reconnect.messages.find(function (item) { return item.type === 'pane_activation_snapshot_done'; }).paneActivation;
  reconnect.ws.send(JSON.stringify({ type: 'permission_response', requestId: 'review-' + aId, decision: 'allow', paneBinding: aBinding }));
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  effects = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  assert.equal(effects.reviews.length, 1); assert.equal(effects.reviews[0].sessionId, aId);
  var native = new WebSocket(origin.replace('http:', 'ws:') + '/p/reuse/ws', { headers: { Cookie: cookie, Origin: origin } });
  t.after(function () { native.terminate(); });
  var nativeMessages = []; native.on('message', function (raw) { nativeMessages.push(JSON.parse(raw)); });
  await new Promise(function (resolve) { native.once('open', resolve); });
  native.send(JSON.stringify({ type: 'switch_session', id: data.standaloneId }));
  await wait(function () { return nativeMessages.some(function (item) { return item.type === 'session_switched' && item.id === data.standaloneId; }); });
  assert.ok(nativeMessages.every(function (item) { return !item.paneActivation; }));
  await fetch(origin + '/fixture/running?id=' + aId, { method: 'POST', headers: { cookie: cookie } });
  var originA = data.sessions.find(function (session) { return session.id === aId; }).sessionOriginId;
  native.send(JSON.stringify({ type: 'stop', sessionId: aId, sessionOriginId: 'replaced-origin' }));
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  effects = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  assert.deepEqual(effects.stopped, [bId], 'explicit Stop rejects a replaced origin without affecting the socket destination');
  native.send(JSON.stringify({ type: 'stop', sessionId: aId, sessionOriginId: originA }));
  await wait(function () { return nativeMessages.some(function (item) { return item.type === 'session_list'; }); });
  await new Promise(function (resolve) { setTimeout(resolve, 30); });
  effects = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  assert.deepEqual(effects.stopped, [bId, aId], 'the exact displayed source can be stopped while a deferred destination owns the socket');
});
