var test = require('node:test');
var assert = require('node:assert/strict');
var EventEmitter = require('node:events');
var fixture = require('./helpers/account-auth-fixture');
var passwords = require('../lib/account-passwords');

function request(server, method, url, data, cookie, extra) {
  return new Promise(function (resolve) {
    var req = new EventEmitter(); req.method = method; req.url = url;
    req.headers = Object.assign({ host: 'localhost', origin: 'http://localhost', 'content-type': 'application/json', cookie: cookie || '' }, extra);
    req.socket = { remoteAddress: '127.0.0.1' };
    var result = {};
    var res = { writeHead: function (code, headers) { result.code = code; result.headers = headers || {}; }, end: function (body) { result.body = JSON.parse(body); resolve(result); } };
    if (!server.auth.handleRequest(req, res, url) && !server.admin.handleRequest(req, res, url)) {
      result.code = server.auth.isRequestAuthed(req) ? 200 : 401; result.body = {}; resolve(result);
    }
    req.emit('data', JSON.stringify(data || {})); req.emit('end');
  });
}
function cookie(response) {
  var value = response.headers['Set-Cookie'];
  return (Array.isArray(value) ? value : [value]).filter(Boolean).map(function (entry) { return entry.split(';')[0]; }).join('; ');
}
async function setup(t, password) {
  var h = fixture.isolated(t);
  var hash = password ? await passwords.hash('a synthetic recovery password') : null;
  fixture.seed(h, h.users.hashPin('012345'), hash ? { passwordHash: hash } : {});
  var state = h.users.loadUsers();
  state.accountAuthMethod = password ? 'password' : 'pin';
  state.users.push({ id: 'target', username: 'Target', role: 'user', pinHash: h.users.hashPin('123456'),
    passwordHash: hash || undefined, passkeys: [{ id: 'old-passkey' }], passkeyUserHandle: 'old-handle' });
  h.users.saveUsers(state);
  function server() {
    var auth = h.server();
    var admin = h.load('server-admin').attachAdmin({ users: h.users, projects: new Map(),
      getMultiUserFromReq: auth.getMultiUserFromReq, revokeUserTokens: auth.revokeUserTokens });
    return { auth: auth, admin: admin };
  }
  var s = server();
  return { h: h, s: s, server: server,
    admin: s.auth.createMultiUserSession('owner', hash).cookie,
    target: s.auth.createMultiUserSession('target', hash).cookie };
}
function reset(f, actor, target) { return request(f.s, 'POST', '/api/admin/users/' + (target || 'target') + '/reset-pin', {}, actor); }
async function login(f, pin) { return request(f.s, 'POST', '/auth/login', { username: 'Target', pin: pin }); }

test('administrator PIN recovery revokes sessions and grants only bounded PIN enrollment', async function (t) {
  var f = await setup(t, false);
  assert.equal((await reset(f, f.target)).code, 403);
  assert.equal((await reset(f, '')).code, 403);
  assert.equal((await reset(f, f.admin, 'missing')).code, 404);
  var ws = new EventEmitter(); var sent = [];
  ws.readyState = 1; ws.send = function (value) { sent.push(value); };
  ws.close = function () { ws.readyState = 3; ws.emit('close'); };
  require('../lib/account-auth-socket').guardSocket(ws, { headers: { cookie: f.target }, socket: {} }, f.s.auth.isRequestAuthed, f.s.auth.touchSession);
  var resetResult = await reset(f, f.admin);
  ws.send('private output after reset');
  assert.equal(ws.readyState, 3); assert.deepEqual(sent, [JSON.stringify({ type: 'account_auth_required' })]);
  assert.equal(resetResult.code, 200); assert.equal(resetResult.headers['Cache-Control'], 'no-store');
  var pin = resetResult.body.tempPin; assert.match(pin, /^\d{6}$/);
  assert.equal(f.h.users.findUserById('target').mustChangePin, true);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, f.target)).code, 401);
  assert.equal((await request(f.server(), 'GET', '/workspace', {}, f.target)).code, 401);
  assert.notEqual((await login(f, '123456')).code, 200);
  var proof = await login(f, pin); assert.equal(proof.body.pinRequired, true);
  assert.doesNotMatch(cookie(proof), /relay_auth_user=/);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, cookie(proof))).code, 401);
  assert.equal((await request(f.s, 'POST', '/api/admin/users/owner/reset-pin', {}, cookie(proof))).code, 403);
  var save = function (data, token) { return request(f.s, 'POST', '/auth/pin-transition', data, token || cookie(proof)); };
  assert.equal((await save({ pin: pin, confirmPin: pin })).code, 400);
  assert.equal((await save({ pin: '12', confirmPin: '12' })).code, 400);
  assert.equal((await save({ pin: '987654', confirmPin: '111111' })).code, 400);
  var done = await save({ pin: '987654', confirmPin: '987654' }); assert.equal(done.code, 200);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, cookie(done))).code, 200);
  assert.equal((await save({ pin: '111111', confirmPin: '111111' })).code, 400);
  assert.notEqual((await login(f, pin)).code, 200);
  assert.equal(f.h.users.findUserById('target').mustChangePin, false);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, f.admin)).code, 200);
});

test('password recovery clears old credentials and passkeys and requires password enrollment', async function (t) {
  var f = await setup(t, true); var pin = (await reset(f, f.admin)).body.tempPin;
  var target = f.h.users.findUserById('target');
  assert.equal(target.passwordHash, undefined); assert.equal(target.passkeys, undefined); assert.equal(target.passkeyUserHandle, undefined);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, f.target)).code, 401);
  assert.equal((await request(f.s, 'POST', '/auth/login', { username: 'Target', password: 'a synthetic recovery password' })).code, 400);
  var proof = await login(f, pin); assert.equal(proof.body.passwordRequired, true);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, cookie(proof))).code, 401);
  var phrase = 'a new synthetic recovered password';
  var done = await request(f.s, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof));
  assert.equal(done.code, 200); assert.equal((await request(f.s, 'GET', '/workspace', {}, cookie(done))).code, 200);
  assert.notEqual((await login(f, pin)).code, 200);
  assert.equal((await request(f.s, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof))).code, 400);
});

test('reset failures never return credentials; failed revocation preserves credentials', async function (t) {
  var f = await setup(t, false); var original = f.h.users.findUserById('target').pinHash;
  f.h.state.failTokens = true;
  var failed = await reset(f, f.admin); assert.equal(failed.code, 503); assert.equal(failed.body.tempPin, undefined);
  assert.equal(f.h.users.findUserById('target').pinHash, original);
  f.h.state.failTokens = false; f.h.state.failUsers = true;
  failed = await reset(f, f.admin); assert.equal(failed.code, 503); assert.equal(failed.body.tempPin, undefined);
  assert.equal(f.h.users.findUserById('target').pinHash, original);
  assert.equal((await request(f.s, 'GET', '/workspace', {}, f.target)).code, 401);
  f.h.state.failUsers = false;
  assert.equal((await reset(f, f.admin)).code, 200);
});

test('PIN proof expires, fails after another reset or restart, and retains failed drafts for retry', async function (t) {
  var f = await setup(t, false); var pin = (await reset(f, f.admin)).body.tempPin;
  var proof = await login(f, pin);
  var data = { pin: '987654', confirmPin: '987654' };
  assert.equal((await request(f.server(), 'POST', '/auth/pin-transition', data, cookie(proof))).code, 400);
  f.h.state.failUsers = true;
  assert.equal((await request(f.s, 'POST', '/auth/pin-transition', data, cookie(proof))).code, 400);
  f.h.state.failUsers = false;
  pin = (await reset(f, f.admin)).body.tempPin;
  assert.equal((await request(f.s, 'POST', '/auth/pin-transition', data, cookie(proof))).code, 400);
  proof = await login(f, pin);
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(600001);
  assert.equal((await request(f.s, 'POST', '/auth/pin-transition', data, cookie(proof))).code, 400);
  proof = await login(f, pin);
  assert.equal((await request(f.s, 'POST', '/auth/pin-transition', data, cookie(proof))).code, 200);
});


test('recovery rejects cross-origin reset and PIN enrollment without mutating credentials', async function (t) {
  var f = await setup(t, false); var original = f.h.users.findUserById('target').pinHash;
  assert.equal((await request(f.s, 'POST', '/api/admin/users/target/reset-pin', {}, f.admin, { origin: 'https://foreign.test' })).code, 403);
  assert.equal(f.h.users.findUserById('target').pinHash, original);
  var pin = (await reset(f, f.admin)).body.tempPin; var proof = await login(f, pin);
  assert.equal((await request(f.s, 'POST', '/auth/pin-transition', { pin: '987654', confirmPin: '987654' }, cookie(proof), { origin: 'https://foreign.test' })).code, 403);
  assert.equal(f.h.users.findUserById('target').mustChangePin, true);
});


test('a demoted administrator cannot reset credentials, while another administrator remains recoverable', async function (t) {
  var f = await setup(t, false); var state = f.h.users.loadUsers();
  state.users[1].role = 'admin'; f.h.users.saveUsers(state);
  assert.equal((await reset(f, f.admin)).code, 200);
  state = f.h.users.loadUsers(); state.users[0].role = 'user'; f.h.users.saveUsers(state);
  assert.equal((await reset(f, f.admin)).code, 403);
});

test('email sign-in cannot bypass mandatory credential enrollment', async function (t) {
  var f = await setup(t, false); var state = f.h.users.loadUsers();
  state.users[1].email = 'synthetic@example.test'; f.h.users.saveUsers(state);
  await reset(f, f.admin);
  var auth = f.h.load('server-auth').attachAuth({ users: f.h.users,
    smtp: { isEmailLoginEnabled: function () { return true; }, verifyOtp: function () { return { valid: true }; } },
    pages: { pinPageHtml: function () { return ''; }, adminSetupPageHtml: function () { return ''; } } });
  var result = await request({ auth: auth, admin: f.s.admin }, 'POST', '/auth/verify-otp', { email: 'synthetic@example.test', code: '123456' });
  assert.equal(result.code, 403); assert.equal(result.headers['Set-Cookie'], undefined);
});
