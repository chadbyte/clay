var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var EventEmitter = require('node:events');
var fixture = require('./helpers/account-auth-fixture');
var passwords = require('../lib/account-passwords');
var guardSocket = require('../lib/account-auth-socket').guardSocket;
var DAY = 86400000;
var phrase = 'a synthetic long security password';
test('server PIN login is disabled for accounts and retained for legacy single-user access', function (t) {
  var h = fixture.isolated(t);
  fixture.seed(h, h.users.hashPin('012345'));
  var server = h.server();
  var hash = require('../lib/server-auth').generateAuthToken('654321');
  server.setAuthToken(hash);
  var rejected = fixture.request(server, 'POST', '/auth', { pin: '654321' });
  assert.equal(rejected.code, 403);
  assert.equal(rejected.headers['Set-Cookie'], undefined);
  assert.equal(server.isRequestAuthed({ headers: { cookie: 'relay_auth=' + hash }, socket: {} }), false);
  var state = h.users.loadUsers(); state.multiUser = false; h.users.saveUsers(state);
  var accepted = fixture.request(server, 'POST', '/auth', { pin: '654321' });
  assert.equal(accepted.code, 200);
  assert.match(accepted.headers['Set-Cookie'], /^relay_auth=/);
});
function req(cookie, extra) {
  var result = new EventEmitter(); result.method = 'GET';
  result.headers = Object.assign({ host: 'clay.example.test', origin: 'https://clay.example.test', 'content-type': 'application/json', cookie: cookie || '', 'user-agent': 'Mozilla/5.0 Chrome/130.0 Linux' }, extra && extra.headers);
  result.socket = Object.assign({ remoteAddress: '192.0.2.1', encrypted: true }, extra && extra.socket); return result;
}
function request(server, method, url, data, cookie, extra) {
  return new Promise(function (resolve) {
    var incoming = req(cookie, extra); incoming.method = method; incoming.url = url;
    var result = {};
    var res = { writeHead: function (code, headers) { result.code = code; result.headers = headers || {}; }, end: function (body) { result.body = JSON.parse(body); resolve(result); } };
    assert.equal(server.handleRequest(incoming, res, url), true);
    incoming.emit('data', JSON.stringify(data || {})); incoming.emit('end');
  });
}
function cookie(response) { var value = response.headers['Set-Cookie']; return (Array.isArray(value) ? value : [value]).map(function (entry) { return entry.split(';')[0]; }).join('; '); }
async function setup(t) {
  var h = fixture.isolated(t); var hash = await passwords.hash(phrase);
  fixture.seed(h, null, { passwordHash: hash }); var state = h.users.loadUsers(); state.accountAuthMethod = 'password'; h.users.saveUsers(state);
  var server = h.server(); var session = server.createMultiUserSession('owner', hash, null, true, req());
  return { h: h, server: server, cookie: session.cookie, hash: hash, token: session.token };
}

test('server enforces idle and absolute expiry, including after restart and despite copied cookies', async function (t) {
  var f = await setup(t); var now = Date.now();
  t.mock.timers.enable({ apis: ['Date'], now: now });
  t.mock.timers.tick(7 * DAY + 1);
  assert.equal(f.server.isRequestAuthed(req(f.cookie)), false);
  assert.equal(f.h.server().isRequestAuthed(req(f.cookie)), false);
  var session = f.server.createMultiUserSession('owner', f.hash, null, true, req()).cookie;
  for (var day = 0; day < 29; day++) { t.mock.timers.tick(DAY); assert.equal(f.server.isRequestAuthed(req(session)), true); }
  t.mock.timers.tick(DAY + 1); assert.equal(f.server.isRequestAuthed(req(session)), false);
  assert.equal(f.h.server().isRequestAuthed(req(session)), false);
});

test('old account sessions gain one persisted grace period; disk stores token digests, not bearer tokens', async function (t) {
  var f = await setup(t); var old = 'owner:earlier-session-token'; var raw = {};
  raw[old] = { userId: 'owner', credential: f.hash };
  fs.writeFileSync(path.join(f.h.root, 'auth-tokens.json'), JSON.stringify(raw));
  var server = f.h.server(); var oldCookie = 'relay_auth_user=' + old;
  assert.equal(server.isRequestAuthed(req(oldCookie)), true);
  var data = fs.readFileSync(path.join(f.h.root, 'auth-tokens.json'), 'utf8');
  assert.equal(data.includes(old), false); assert.equal(data.includes(f.hash), false);
  var record = Object.values(JSON.parse(data).sessions)[0]; assert.equal(record.migrated, true);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(7 * DAY + 1);
  assert.equal(f.h.server().isRequestAuthed(req(oldCookie)), false);
  assert.equal(Object.values(JSON.parse(fs.readFileSync(path.join(f.h.root, 'auth-tokens.json'), 'utf8')).sessions)[0].expiresAt, record.expiresAt);
});

test('device list is owner-scoped and individual/other-session revocations survive restart', async function (t) {
  var f = await setup(t); var other = f.server.createMultiUserSession('owner', f.hash, null, true, req()).cookie;
  var state = f.h.users.loadUsers(); state.users.push({ id: 'second', username: 'Second', role: 'user', passwordHash: f.hash }); f.h.users.saveUsers(state);
  var foreign = f.server.createMultiUserSession('second', f.hash, null, true, req()).cookie;
  var listed = await request(f.server, 'GET', '/api/account-sessions', null, f.cookie);
  assert.equal(listed.body.sessions.length, 2); assert.equal(listed.body.sessions.filter(function (entry) { return entry.current; }).length, 1);
  assert.equal(JSON.stringify(listed.body).includes(f.token), false); assert.equal(JSON.stringify(listed.body).includes(f.hash), false);
  var target = listed.body.sessions.find(function (entry) { return !entry.current; });
  assert.equal((await request(f.server, 'POST', '/api/account-sessions', { id: target.id }, foreign)).code, 400);
  assert.equal((await request(f.server, 'POST', '/api/account-sessions', { id: target.id }, f.cookie)).code, 200);
  assert.equal(f.server.isRequestAuthed(req(other)), false); assert.equal(f.h.server().isRequestAuthed(req(other)), false);
  other = f.server.createMultiUserSession('owner', f.hash, null, true, req()).cookie;
  assert.equal((await request(f.server, 'POST', '/api/account-sessions', { id: 'others' }, f.cookie)).code, 200);
  assert.equal(f.server.isRequestAuthed(req(other)), false); assert.equal(f.server.isRequestAuthed(req(f.cookie)), true);
  assert.equal(f.server.isRequestAuthed(req(foreign)), true);
});

test('migration timestamps are not presented as activity and observed devices are enriched durably', async function (t) {
  var f = await setup(t); var raw = {};
  ['active', 'unseen'].forEach(function (token) { raw[token] = { userId: 'owner', credential: f.hash }; });
  fs.writeFileSync(path.join(f.h.root, 'auth-tokens.json'), JSON.stringify(raw));
  var server = f.h.server(); var active = 'relay_auth_user=active';
  var list = (await request(server, 'GET', '/api/account-sessions', null, active)).body.sessions;
  assert.equal(list[0].current, true);
  assert.match(list[0].userAgent, /Chrome/); assert.equal(list[0].address, '192.0.2.1');
  assert.ok(list[0].lastSeenAt); assert.equal(list[0].createdAt, null);
  assert.equal(list[1].lastSeenAt, null); assert.equal(list[1].unknownDevice, true);
  var expiry = list[0].expiresAt;
  var restarted = f.h.server();
  var again = (await request(restarted, 'GET', '/api/account-sessions', null, active)).body.sessions;
  assert.equal(again[0].expiresAt, expiry); assert.match(again[0].userAgent, /Chrome/);
  assert.equal(again[1].lastSeenAt, null);
});

test('issuing a replacement session retires only its presented same-account cookie atomically', async function (t) {
  var f = await setup(t);
  var other = f.server.createMultiUserSession('owner', f.hash, null, true, req()).cookie;
  f.h.state.failTokens = true;
  assert.throws(function () { f.server.createMultiUserSession('owner', f.hash, null, true, req(f.cookie)); });
  assert.equal(f.server.isRequestAuthed(req(f.cookie)), true);
  f.h.state.failTokens = false;
  var next = f.server.createMultiUserSession('owner', f.hash, null, true, req(f.cookie)).cookie;
  assert.equal(f.server.isRequestAuthed(req(f.cookie)), false);
  assert.equal(f.server.isRequestAuthed(req(next)), true);
  assert.equal(f.server.isRequestAuthed(req(other)), true);
  assert.equal((await request(f.server, 'GET', '/api/account-sessions', null, next)).body.sessions.length, 2);
});

test('failed sign-out persistence is reported and cannot claim durable revocation', async function (t) {
  var f = await setup(t); var listed = await request(f.server, 'GET', '/api/account-sessions', null, f.cookie);
  f.h.state.failTokens = true;
  assert.equal((await request(f.server, 'POST', '/api/account-sessions', { id: listed.body.sessions[0].id }, f.cookie)).code, 400);
  assert.equal(f.server.isRequestAuthed(req(f.cookie)), true);
  assert.equal((await request(f.server, 'POST', '/auth/logout', {}, f.cookie)).code, 503);
  f.h.state.failTokens = false;
  assert.equal((await request(f.server, 'POST', '/auth/logout', {}, f.cookie)).code, 200);
  assert.equal(f.h.server().isRequestAuthed(req(f.cookie)), false);
});

test('passive WebSocket traffic does not renew idle expiry; expiry and revocation close live sockets', async function (t) {
  var f = await setup(t); var ws = new EventEmitter(); var messages = [];
  ws.readyState = 1; ws.send = function (value) { messages.push(value); }; ws.close = function () { ws.readyState = 3; ws.emit('close'); };
  guardSocket(ws, req(f.cookie), f.server.isRequestAuthed, f.server.touchSession);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  for (var day = 0; day < 6; day++) { t.mock.timers.tick(DAY); ws.send('background output'); ws.emit('message', JSON.stringify({ type: 'ping' })); }
  t.mock.timers.tick(DAY + 1); ws.send('private output');
  assert.equal(ws.readyState, 3); assert.equal(messages[messages.length - 1], JSON.stringify({ type: 'account_auth_required' }));
});

test('account attempts survive restart and IP rotation; failure to save or corrupt storage fails closed', async function (t) {
  var f = await setup(t);
  for (var i = 0; i < 10; i++) {
    await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: 'wrong' }, '', { socket: { remoteAddress: '192.0.2.' + (i + 1) } });
  }
  var restarted = f.h.server();
  var blocked = await request(restarted, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', { socket: { remoteAddress: '192.0.2.99' } });
  assert.equal(blocked.code, 429);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(15 * 60000 + 1);
  assert.equal((await request(restarted, 'POST', '/auth/login', { username: 'Owner', password: phrase })).code, 200);
  f.h.state.failAttempts = true;
  assert.equal((await request(restarted, 'POST', '/auth/login', { username: 'Owner', password: phrase })).code, 400);
  f.h.state.failAttempts = false;
  fs.writeFileSync(path.join(f.h.root, 'auth-attempts.json'), 'broken');
  assert.equal((await request(restarted, 'POST', '/auth/login', { username: 'Owner', password: phrase })).code, 400);
});

test('exact Origin and HTTPS are required; trusted proxy transport and address headers are explicit', async function (t) {
  var f = await setup(t);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', { headers: { origin: 'https://evil.example.test' } })).code, 403);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', { headers: { origin: undefined, referer: undefined } })).code, 403);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', { headers: { 'sec-fetch-site': 'same-site' } })).code, 403);
  var spoofed = { socket: { encrypted: false }, headers: { 'x-forwarded-proto': 'https', 'x-real-ip': '127.0.0.1' } };
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', spoofed)).code, 403);
  assert.equal(f.server.isRequestAuthed(req(f.cookie, spoofed)), false);
  var saved = await request(f.server, 'PUT', '/api/account-transport', { origin: 'https://clay.example.test', trustedProxies: ['192.0.2.1'], currentPassword: phrase }, f.cookie);
  assert.equal(saved.code, 200);
  var proxied = { socket: { encrypted: false }, headers: { host: 'backend:3000', 'x-forwarded-proto': 'https', 'x-real-ip': '198.51.100.7' } };
  var login = await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', proxied);
  assert.equal(login.code, 200); assert.match(login.headers['Set-Cookie'][0], /; Secure/);
  assert.equal(f.server.isRequestAuthed(req(cookie(login), proxied)), true);
  var sessions = await request(f.server, 'GET', '/api/account-sessions', null, cookie(login), proxied);
  assert.equal(sessions.body.sessions.find(function (entry) { return entry.current; }).address, '198.51.100.7');
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', { socket: { encrypted: false }, headers: { 'x-forwarded-proto': 'http' } })).code, 403);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', { socket: { encrypted: false, remoteAddress: '192.0.2.2' }, headers: proxied.headers })).code, 403);
});

test('local administrative access remains available even when loopback is a configured proxy', async function (t) {
  var f = await setup(t); var transport = f.h.load('account-auth-transport').attachTransport({ users: f.h.users });
  transport.save({ origin: 'https://clay.example.test', trustedProxies: ['127.0.0.1'] });
  var local = { socket: { encrypted: false, remoteAddress: '127.0.0.1' }, headers: { host: 'localhost:3000', origin: 'http://localhost:3000' } };
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, '', local)).code, 200);
  assert.equal((await request(f.server, 'PUT', '/api/account-transport', { origin: 'http://unsafe.test', trustedProxies: [], currentPassword: phrase }, f.cookie)).code, 400);
});

test('terminal recovery expires, works once and revokes prior sessions and passkeys', async function (t) {
  var f = await setup(t); var state = f.h.users.loadUsers(); state.users[0].passkeys = [{ id: 'old-device' }]; f.h.users.saveUsers(state);
  f.server.setRecovery('test-recovery', 'one-time-terminal-secret');
  var result = await request(f.server, 'POST', '/recover/test-recovery', { step: 'reset', password: 'one-time-terminal-secret', pin: '654321' });
  assert.equal(result.code, 200); assert.equal(f.server.isRequestAuthed(req(f.cookie)), false);
  assert.equal(f.h.users.findUserById('owner').passkeys, undefined);
  assert.equal(f.server.handleRequest(Object.assign(req(), { method: 'GET' }), {}, '/recover/test-recovery'), false);
  f.server.setRecovery('expired-recovery', 'another-terminal-secret');
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(15 * 60000 + 1);
  assert.equal((await request(f.server, 'POST', '/recover/expired-recovery', { step: 'reset', password: 'another-terminal-secret', pin: '123456' })).code, 410);
});
