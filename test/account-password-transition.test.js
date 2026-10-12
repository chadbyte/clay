var test = require('node:test');
var assert = require('node:assert/strict');
var EventEmitter = require('node:events');
var fixture = require('./helpers/account-auth-fixture');
var passwords = require('../lib/account-passwords');
var guardSocket = require('../lib/account-auth-socket').guardSocket;

function request(server, method, url, data, cookie) {
  return new Promise(function (resolve) {
    var req = new EventEmitter();
    req.method = method; req.url = url; req.headers = { host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', cookie: cookie || '' }; req.socket = { remoteAddress: '127.0.0.1' };
    var result = {};
    var res = { writeHead: function (code, headers) { result.code = code; result.headers = headers || {}; }, end: function (body) { result.body = JSON.parse(body); resolve(result); } };
    assert.equal(server.handleRequest(req, res, url), true);
    req.emit('data', JSON.stringify(data || {})); req.emit('end');
  });
}
function cookie(result) { var value = result.headers['Set-Cookie']; return (Array.isArray(value) ? value : [value]).map(function (entry) { return entry.split(';')[0]; }).join('; '); }
function setup(t) {
  var h = fixture.isolated(t);
  fixture.seed(h, h.users.hashPin('012345'));
  var server = h.server();
  return { h: h, server: server, oldCookie: server.createMultiUserSession('owner').cookie };
}
var phrase = 'this is a long passphrase';

test('policy requires fresh PIN; pending authority cannot enter workspace; conversion survives restart', async function (t) {
  var f = setup(t); var h = f.h; var server = f.server;
  assert.equal((await request(server, 'PUT', '/api/account-auth-policy', { method: 'password' })).code, 403);
  assert.equal((await request(server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie)).code, 200);
  assert.equal(server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: f.oldCookie } }), false);
  assert.equal((await request(server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, f.oldCookie)).code, 400);
  assert.equal((await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '000000' })).code, 400);
  var proof = await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  assert.equal(proof.body.passwordRequired, true);
  assert.equal(server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: cookie(proof) } }), false);
  assert.equal((await request(server, 'POST', '/auth/password-transition', { password: 'short', confirmPassword: 'short' }, cookie(proof))).code, 400);
  assert.ok(h.users.findUserById('owner').pinHash);
  var done = await request(server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof));
  assert.equal(done.code, 200);
  assert.equal(h.users.findUserById('owner').pinHash, null);
  assert.equal(h.users.getSoloNoPinUser(), null);
  assert.equal(h.server().isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: cookie(done) } }), true);
  assert.equal(h.server().isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: f.oldCookie } }), false);
  assert.equal((await request(server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 400);
  assert.equal((await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' })).code, 400);
  assert.equal((await request(h.server(), 'POST', '/auth/login', { username: 'Owner', password: phrase })).code, 200);
  assert.equal((await request(server, 'POST', '/auth/login', { username: 'Owner', password: 'not the right password' })).code, 400);
  // Sessions minted by alternate legacy routes lack password verification.
  assert.equal(server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: server.createMultiUserSession('owner').cookie } }), false);
});

test('failed password write preserves PIN and lets the same verified transition retry', async function (t) {
  var f = setup(t); var h = f.h;
  await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  var proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  h.state.failUsers = true;
  assert.equal((await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 400);
  assert.ok(h.users.findUserById('owner').pinHash); assert.equal(h.users.findUserById('owner').passwordHash, undefined);
  h.state.failUsers = false;
  assert.equal((await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 200);
});

test('policy save failure, solo installs, and missing account credentials do not change access', async function (t) {
  var f = setup(t); var h = f.h;
  h.state.failUsers = true;
  assert.equal((await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie)).code, 400);
  assert.equal(f.server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: f.oldCookie } }), true);
  h.state.failUsers = false;
  h.config.saveConfig({ singleUserMigratedUserId: 'owner', singleUserMigratedAt: 1, pinHash: 'legacy-server-credential' });
  assert.equal((await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie)).code, 400);
  h.config.saveConfig({}); fixture.seed(h, null);
  assert.equal((await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie)).code, 400);
  assert.equal(f.server.isRequestAuthed({ headers: {} }), true);
});

test('PIN recovery invalidates password sessions and requires a new password', async function (t) {
  var f = setup(t); var h = f.h;
  await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  var proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  var done = await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof));
  h.users.updateUserPin('owner', '654321');
  assert.equal(f.server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: cookie(done) } }), false);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase })).code, 400);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '654321' })).body.passwordRequired, true);
});

test('concurrent and stale transitions cannot overwrite a replacement credential', async function (t) {
  var f = setup(t);
  await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  var proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  var results = await Promise.all([request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof)), request(f.server, 'POST', '/auth/password-transition', { password: 'another long passphrase', confirmPassword: 'another long passphrase' }, cookie(proof))]);
  assert.deepEqual(results.map(function (result) { return result.code; }).sort(), [200, 400]);
});

test('connected sockets reject incoming and outgoing workspace traffic after policy changes', function () {
  var ws = new EventEmitter(); var allowed = true; var sent = []; var handled = 0;
  ws.readyState = 1; ws.send = function (text) { sent.push(text); }; ws.close = function () { ws.readyState = 3; ws.emit('close'); };
  guardSocket(ws, {}, function () { return allowed; });
  ws.on('message', function () { handled++; }); ws.emit('message', 'before');
  allowed = false; ws.emit('message', 'after'); ws.send('secret output');
  assert.equal(handled, 1); assert.equal(ws.readyState, 3);
  assert.deepEqual(sent, [JSON.stringify({ type: 'account_auth_required' })]);
});

test('password hashing supports spaces and Unicode and preserves exact input', async function () {
  var value = '  긴 문장으로 사용하는 안전한 비밀번호  ';
  var hash = await passwords.hash(value);
  assert.equal(await passwords.verify(value, hash), true);
  assert.equal(await passwords.verify(value.trim(), hash), false);
  await assert.rejects(passwords.hash('short'));
  await assert.rejects(passwords.hash('x'.repeat(129)));
});

test('password changes verify current password and invalidate other sessions', async function (t) {
  var f = setup(t);
  await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  var proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  var done = await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof));
  assert.equal((await request(f.server, 'POST', '/auth/password-change', { currentPassword: 'wrong', password: 'new long password value', confirmPassword: 'new long password value' }, cookie(done))).code, 400);
  var changed = await request(f.server, 'POST', '/auth/password-change', { currentPassword: phrase, password: 'new long password value', confirmPassword: 'new long password value' }, cookie(done));
  assert.equal(changed.code, 200);
  assert.equal(f.server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: cookie(done) } }), false);
  assert.equal(f.server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: cookie(changed) } }), true);
});

test('transition proof expires and rate limits reject repeated guesses', async function (t) {
  var f = setup(t);
  await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  var proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() });
  t.mock.timers.tick(600001);
  assert.equal((await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 400);
  for (var i = 0; i < 10; i++) await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '000000' });
  var limited = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  assert.match(limited.body.error, /Too many attempts/);
});

test('logout cancels pending enrollment and credential resets invalidate pending proof', async function (t) {
  var f = setup(t);
  await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  var proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  await request(f.server, 'POST', '/auth/logout', {}, cookie(proof));
  assert.equal((await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 400);
  proof = await request(f.server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  f.h.users.updateUserPin('owner', '654321');
  assert.equal((await request(f.server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 400);
  assert.equal(f.h.users.authenticateUser('Owner', '654321').id, 'owner');
});

test('non-admin users cannot change policy and email-only accounts block activation', async function (t) {
  var f = setup(t);
  var other = f.h.users.createUserWithoutPin({ username: 'EmailOnly', email: 'fixture@example.invalid' }).user;
  var cookieValue = f.server.createMultiUserSession(other.id).cookie;
  assert.equal((await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, cookieValue)).code, 403);
  var result = await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie);
  assert.equal(result.code, 400); assert.match(result.body.error, /temporary account PIN/);
  assert.equal(f.server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: f.oldCookie } }), true);
  f.h.users.updateUserPin(other.id, '123456');
  assert.equal((await request(f.server, 'PUT', '/api/account-auth-policy', { method: 'password' }, f.oldCookie)).code, 200);
  assert.equal(f.server.isRequestAuthed({ socket: { remoteAddress: '127.0.0.1' }, headers: { host: 'localhost', cookie: cookieValue } }), false);
});
