var test = require('node:test'), assert = require('node:assert/strict'), cp = require('node:child_process'), path = require('node:path');
var WebSocket = require('ws');

// Live provider output after pane activation must carry the pane binding.
// The pane client drops every frame without it, so the answer only appears
// after a reconnect replays history.
async function start(t) {
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
  var cookie = login.headers.get('set-cookie').split(';')[0];
  var data = await (await fetch(origin + '/fixture/state', { headers: { cookie: cookie } })).json();
  async function wait(check) {
    var begin = Date.now();
    while (!check()) { if (Date.now() - begin > 5000) throw new Error('Product path deadline exceeded\n' + logs); await new Promise(function (resolve) { setTimeout(resolve, 5); }); }
  }
  async function post(pathname) { await fetch(origin + pathname, { method: 'POST', headers: { cookie: cookie } }); }
  async function connect(query) {
    var ws = new WebSocket(origin.replace('http:', 'ws:') + '/p/reuse/ws' + query, { headers: { Cookie: cookie, Origin: origin } });
    var messages = [];
    ws.on('message', function (raw) { messages.push(JSON.parse(raw)); });
    t.after(function () { ws.terminate(); });
    await new Promise(function (resolve, reject) { ws.once('open', resolve); ws.once('error', reject); });
    await wait(function () { return messages.some(function (item) { return item.type === 'split_groups'; }); });
    return { ws: ws, messages: messages };
  }
  async function activate(pane, id, generation) {
    var target = data.sessions.find(function (item) { return item.id === id; });
    var group = data.groups.find(function (item) { return item.members.includes(id); });
    pane.messages.length = 0;
    pane.ws.send(JSON.stringify({ type: 'switch_session', id: id, paneActivation: { requestId: 'live-' + generation, generation: generation, projectSlug: 'reuse', viewerId: 'owner', ownerId: 'owner',
      sessionOriginId: target.sessionOriginId, role: target.sessionRole, workerGeneration: null, parentSessionOriginId: null,
      groupStamp: JSON.stringify({ id: group.id, members: group.members, pair: group.pair || null }) } }));
    await wait(function () { return pane.messages.some(function (item) { return item.type === 'pane_activation_snapshot_done'; }); });
    var binding = pane.messages.find(function (item) { return item.type === 'pane_activation_snapshot_done'; }).paneActivation;
    pane.messages.length = 0;
    return binding;
  }
  function settle() { return new Promise(function (resolve) { setTimeout(resolve, 60); }); }
  return { data: data, wait: wait, post: post, connect: connect, activate: activate, settle: settle };
}

test('live recorded events reach an activated pane socket with its binding', { timeout: 30000 }, async function (t) {
  var f = await start(t), id = f.data.groups[0].pair.driverId;
  var pane = await f.connect('?pane=1&session=' + id), binding = await f.activate(pane, id, 1);
  await f.post('/fixture/history?id=' + id);
  await f.wait(function () { return pane.messages.some(function (item) { return item.type === 'done'; }); });
  ['user_message', 'delta', 'done'].forEach(function (type) {
    var live = pane.messages.find(function (item) { return item.type === type; });
    assert.ok(live, type + ' reaches the pane socket');
    assert.deepEqual(live.paneActivation, binding, type + ' is bound to the activated pane');
  });
});

test('ephemeral status from sendToSession is bound for panes and unchanged for ordinary clients', { timeout: 30000 }, async function (t) {
  var f = await start(t), id = f.data.groups[0].pair.driverId;
  var pane = await f.connect('?pane=1&session=' + id), binding = await f.activate(pane, id, 1);
  var plain = await f.connect('');
  plain.ws.send(JSON.stringify({ type: 'switch_session', id: id }));
  await f.wait(function () { return plain.messages.some(function (item) { return item.type === 'session_switched' && item.id === id; }); });
  plain.messages.length = 0;
  await f.post('/fixture/live?id=' + id + '&kind=status&status=processing');
  await f.wait(function () { return pane.messages.some(function (item) { return item.type === 'status'; }) && plain.messages.some(function (item) { return item.type === 'status'; }); });
  assert.deepEqual(pane.messages.find(function (item) { return item.type === 'status'; }).paneActivation, binding);
  var ordinary = plain.messages.find(function (item) { return item.type === 'status'; });
  assert.equal(ordinary.status, 'processing'); assert.ok(!ordinary.paneActivation, 'ordinary client frames are not given a pane binding');
  await f.post('/fixture/live?id=' + id + '&kind=delta&text=ORDINARY_LIVE');
  await f.wait(function () { return plain.messages.some(function (item) { return item.type === 'delta' && item.text === 'ORDINARY_LIVE'; }); });
  assert.ok(!plain.messages.find(function (item) { return item.text === 'ORDINARY_LIVE'; }).paneActivation);
});

test('a pane that moved to another session never receives the previous session live frames', { timeout: 30000 }, async function (t) {
  var f = await start(t), aId = f.data.groups[0].pair.driverId, bId = f.data.groups[1].pair.driverId;
  var pane = await f.connect('?pane=1&session=' + aId);
  await f.activate(pane, aId, 1);
  var bBinding = await f.activate(pane, bId, 2);
  await f.post('/fixture/live?id=' + aId + '&kind=turn&text=STALE_A_OUTPUT');
  await f.post('/fixture/live?id=' + aId + '&kind=status');
  await f.settle();
  assert.deepEqual(pane.messages.filter(function (item) { return item.type === 'delta' || item.type === 'done' || item.type === 'status'; }), [], 'previous session output is not delivered');
  await f.post('/fixture/live?id=' + bId + '&kind=turn&text=CURRENT_B_OUTPUT');
  await f.wait(function () { return pane.messages.some(function (item) { return item.type === 'done'; }); });
  var current = pane.messages.find(function (item) { return item.text === 'CURRENT_B_OUTPUT'; });
  assert.deepEqual(current.paneActivation, bBinding);
});

test('pending queue broadcast is bound for an activated pane and plain for ordinary clients', { timeout: 30000 }, async function (t) {
  var f = await start(t), id = f.data.groups[0].pair.driverId;
  var pane = await f.connect('?pane=1&session=' + id), binding = await f.activate(pane, id, 1);
  var plain = await f.connect('');
  plain.ws.send(JSON.stringify({ type: 'switch_session', id: id }));
  await f.wait(function () { return plain.messages.some(function (item) { return item.type === 'session_switched' && item.id === id; }); });
  await f.post('/fixture/running?id=' + id);
  plain.messages.length = 0; pane.messages.length = 0;
  pane.ws.send(JSON.stringify({ type: 'message', text: 'QUEUED_WHILE_RUNNING', paneBinding: binding }));
  await f.wait(function () { return pane.messages.some(function (item) { return item.type === 'pending_message_queued'; }) && plain.messages.some(function (item) { return item.type === 'pending_message_queued'; }); });
  assert.deepEqual(pane.messages.find(function (item) { return item.type === 'pending_message_queued'; }).paneActivation, binding);
  assert.ok(!plain.messages.find(function (item) { return item.type === 'pending_message_queued'; }).paneActivation);
});
