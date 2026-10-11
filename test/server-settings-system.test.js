var test = require('node:test');
var assert = require('node:assert/strict');
var fork = require('node:child_process').fork;
var path = require('node:path');
var WebSocket = require('ws');
var settings = require('../lib/project-server-settings');

function fixture(t) {
  return new Promise(function (resolve, reject) {
    var child = fork(path.join(__dirname, 'fixtures/server-settings-server.js'), [], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(function () { if (child.connected) child.send('close'); });
    child.once('error', reject);
    child.once('message', function (data) { resolve({ child: child, url: 'http://127.0.0.1:' + data.port, port: data.port }); });
  });
}
function connect(t, f, user) {
  return new Promise(function (resolve, reject) {
    var ws = new WebSocket('ws://127.0.0.1:' + f.port + '/p/sample/ws', { headers: { Cookie: 'relay_auth_user=network-' + user } });
    t.after(function () { ws.close(); });
    ws.once('open', function () { resolve(ws); }); ws.once('error', reject);
  });
}
function message(ws, data, type) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { ws.off('message', receive); reject(new Error('Missing ' + type)); }, 5000);
    function receive(raw) { var msg = JSON.parse(raw); if (msg.type !== type) return; clearTimeout(timer); ws.off('message', receive); resolve(msg); }
    ws.on('message', receive); ws.send(JSON.stringify(data));
  });
}

test('real settings routes persist environment and notification preferences and retain prior values on failure', { timeout: 20000 }, async function (t) {
  var f = await fixture(t); var ws = await connect(t, f, 'admin');
  var env = await message(ws, { type: 'get_shared_env' }, 'shared_env_result');
  assert.match(env.envrc, /EXAMPLE_KEY/);
  var saved = await message(ws, { type: 'set_shared_env', envrc: 'export REVIEWED_KEY=test-value' }, 'set_shared_env_result');
  assert.equal(saved.ok, true); assert.match(saved.timing, /newly created/);
  await fetch(f.url + '/__fixture/fail');
  var failed = await message(ws, { type: 'set_shared_env', envrc: 'export REVIEWED_KEY=failed-value' }, 'set_shared_env_result');
  assert.equal(failed.ok, false); assert.match(failed.error, /disk failure/);
  var reloaded = await message(ws, { type: 'get_shared_env' }, 'shared_env_result');
  assert.equal(reloaded.envrc, 'export REVIEWED_KEY=test-value');
  var unsupported = await message(ws, { type: 'set_keep_awake', value: true }, 'set_keep_awake_result');
  assert.equal(unsupported.ok, false); assert.match(unsupported.error, /macOS/);
  await fetch(f.url + '/__fixture/recover');
  var retained = await message(ws, { type: 'set_image_retention', days: 30 }, 'set_image_retention_result');
  assert.equal(retained.ok, true); assert.equal(retained.days, 30);
  var invalid = await message(ws, { type: 'set_image_retention', days: -1 }, 'set_image_retention_result');
  assert.equal(invalid.ok, false);
  var headers = { Cookie: 'relay_auth_user=network-admin', 'Content-Type': 'application/json', 'X-Clay-Settings': '1' };
  var notification = await fetch(f.url + '/api/user/notifications', { method: 'PUT', headers: headers, body: JSON.stringify({ alert: false, sound: true }) });
  assert.equal(notification.status, 200);
  assert.equal((await (await fetch(f.url + '/api/user/notifications', { headers: headers })).json()).alert, false);
  var member = await (await fetch(f.url + '/api/user/notifications', { headers: { Cookie: 'relay_auth_user=network-member' } })).json();
  assert.equal(member.alert, true, 'preferences do not leak into another account');
  assert.equal((await fetch(f.url + '/api/user/notifications')).status, 401);
  assert.equal((await fetch(f.url + '/api/user/notifications', { method: 'PUT', headers: Object.assign({}, headers, { 'Sec-Fetch-Site': 'cross-site' }), body: '{}' })).status, 403);
  var usageResponse = await fetch(f.url + '/api/server/storage', { headers: headers });
  assert.equal(usageResponse.status, 200);
  var usage = await usageResponse.json();
  assert.ok(usage.totalBytes > 0);
  assert.equal(usage.users.length, 2);
  assert.equal(usage.partial, false);
  assert.equal((await fetch(f.url + '/api/server/storage')).status, 401);
  assert.equal((await fetch(f.url + '/api/server/storage', { headers: { Cookie: 'relay_auth_user=network-member' } })).status, 403);
  var restart = await message(ws, { type: 'restart_server' }, 'restart_server_result'); assert.equal(restart.ok, true);
  var shutdown = await message(ws, { type: 'shutdown_server' }, 'shutdown_server_result'); assert.equal(shutdown.ok, true);
});

test('management handler checks current administrator identity, validation and persistence exceptions', function () {
  var sent = []; var changes = 0; var role = 'user';
  var ctx = { usersModule: { isMultiUser: function () { return true; }, findUserById: function () { return { id: 'a', role: role }; } },
    opts: { onGetDaemonConfig: function () { return { osUsers: true, platform: 'darwin' }; }, onSetPin: function () { changes++; return { ok: true }; }, onSetKeepAwake: function () { throw new Error('disk unavailable'); } },
    sendTo: function (ws, msg) { sent.push(msg); }, send: function () {} };
  var ws = { _clayUser: { id: 'a', role: 'admin' } };
  settings.handleServerSettings(ctx, ws, { type: 'set_pin', pin: '123456' });
  assert.equal(changes, 0); assert.match(sent.pop().error, /Administrator/);
  role = 'admin'; settings.handleServerSettings(ctx, ws, { type: 'set_pin', pin: '123' });
  assert.equal(changes, 0); assert.equal(sent.pop().ok, false);
  settings.handleServerSettings(ctx, ws, { type: 'set_pin', pin: '123456' }); assert.equal(changes, 1);
  settings.handleServerSettings(ctx, ws, { type: 'set_keep_awake', value: true }); assert.match(sent.pop().error, /disk unavailable/);
});

test('daemon settings publish only persisted configuration and preserve unrelated fields', function () {
  var save = require('../lib/daemon-settings').saveDaemonSetting;
  var config = { keepAwake: false, projectSharing: { sample: ['member'] }, unrelated: 'retained' };
  assert.throws(function () { save(config, 'keepAwake', true, function () { throw new Error('disk full'); }); }, /disk full/);
  assert.equal(config.keepAwake, false);
  var persisted;
  save(config, 'keepAwake', true, function (next) { persisted = next; assert.equal(config.keepAwake, false); });
  assert.equal(config.keepAwake, true);
  assert.equal(persisted.unrelated, 'retained');
  assert.deepEqual(persisted.projectSharing, { sample: ['member'] });
});

test('members can use their own preferences but cannot administer an accessible project server', { timeout: 15000 }, async function (t) {
  var f = await fixture(t); var ws = await connect(t, f, 'member');
  var denied = await message(ws, { type: 'set_image_retention', days: 0 }, 'set_image_retention_result');
  assert.equal(denied.ok, false); assert.match(denied.error, /Administrator/);
  var env = await message(ws, { type: 'get_shared_env' }, 'shared_env_result');
  assert.match(env.error, /not permitted/); assert.equal(env.envrc, undefined);
  var channel = await message(ws, { type: 'set_update_channel', channel: 'beta' }, 'set_update_channel_result');
  assert.equal(channel.ok, false);
  var smtp = await fetch(f.url + '/api/admin/smtp', { headers: { Cookie: 'relay_auth_user=network-member' } });
  assert.equal(smtp.status, 403);
});

test('single-user preferences survive a new route instance and reject unauthenticated writes', async function (t) {
  var fs = require('node:fs'); var os = require('node:os'); var http = require('node:http');
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-notification-test-'));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var attach = require('../lib/server-notification-settings').attachNotificationSettings;
  var ctx = { CONFIG_DIR: dir, users: { isMultiUser: function () { return false; } }, isRequestAuthed: function (req) { return req.headers.authorization === 'fixture'; } };
  var route = attach(ctx);
  var server = http.createServer(function (req, res) { route.handleRequest(req, res, req.url); });
  t.after(function () { server.close(); });
  await new Promise(function (resolve) { server.listen(0, '127.0.0.1', resolve); });
  var url = 'http://127.0.0.1:' + server.address().port + '/api/user/notifications';
  var headers = { Authorization: 'fixture', 'X-Clay-Settings': '1', 'Content-Type': 'application/json' };
  assert.equal((await fetch(url, { method: 'PUT', headers: headers, body: JSON.stringify({ alert: false, sound: false }) })).status, 200);
  route = attach(ctx);
  assert.deepEqual(await (await fetch(url, { headers: headers })).json(), { alert: false, sound: false, configured: true });
  assert.equal(fs.statSync(path.join(dir, 'notification-preferences.json')).mode & 0o777, 0o600);
  assert.equal((await fetch(url, { method: 'PUT', body: '{}' })).status, 401);
});
