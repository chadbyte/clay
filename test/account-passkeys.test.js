var test = require('node:test');
var assert = require('node:assert/strict');
var EventEmitter = require('node:events');
var fixture = require('./helpers/account-auth-fixture');
var authenticator = require('./helpers/passkey-authenticator').createAuthenticator;
var passwords = require('../lib/account-passwords');
var phrase = 'synthetic long account passphrase';
var origin = 'https://clay.example.test';

function request(server, method, url, data, cookie, headers) {
  return new Promise(function (resolve) {
    var req = new EventEmitter(); req.method = method; req.url = url;
    req.headers = Object.assign({ host: 'clay.example.test', 'content-type': 'application/json', origin: origin, cookie: cookie || '' }, headers);
    req.socket = { remoteAddress: '127.0.0.1', encrypted: true };
    var result = {};
    var res = { writeHead: function (code, values) { result.code = code; result.headers = values || {}; }, end: function (body) { result.body = JSON.parse(body); resolve(result); } };
    assert.equal(server.handleRequest(req, res, url), true);
    req.emit('data', JSON.stringify(data || {})); req.emit('end');
  });
}
function cookies(response) {
  var value = response.headers['Set-Cookie'];
  return (Array.isArray(value) ? value : value ? [value] : []).map(function (entry) { return entry.split(';')[0]; }).join('; ');
}
async function setup(t) {
  var h = fixture.isolated(t); var hash = await passwords.hash(phrase);
  fixture.seed(h, null, { passwordHash: hash });
  var state = h.users.loadUsers(); state.accountAuthMethod = 'password'; h.users.saveUsers(state);
  var server = h.server(); var cookie = server.createMultiUserSession('owner', hash).cookie;
  var result = await request(server, 'PUT', '/api/passkey-policy', { origin: origin, currentPassword: phrase }, cookie);
  assert.equal(result.code, 200, JSON.stringify(result.body));
  return { h: h, server: server, cookie: cookie, key: authenticator() };
}
async function register(f, overrides, key) {
  key = key || f.key;
  var options = await request(f.server, 'POST', '/api/passkeys/register/options', { name: 'Personal laptop', currentPassword: phrase }, f.cookie);
  assert.equal(options.code, 200, JSON.stringify(options.body));
  assert.equal(options.body.options.authenticatorSelection.userVerification, 'required');
  assert.equal(options.body.options.authenticatorSelection.residentKey, 'required');
  var proof = cookies(options); var response = key.register(options.body.options, origin, overrides);
  var result = await request(f.server, 'POST', '/api/passkeys/register/verify', { response: response }, f.cookie + '; ' + proof);
  return { result: result, response: response, proof: proof };
}
async function login(f, overrides, key) {
  var options = await request(f.server, 'POST', '/auth/passkeys/login/options', {});
  assert.equal(options.code, 200, JSON.stringify(options.body));
  assert.equal(options.body.options.userVerification, 'required');
  var proof = cookies(options); var response = (key || f.key).authenticate(options.body.options, origin, overrides);
  var result = await request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response }, proof);
  return { result: result, proof: proof, response: response };
}
function authed(server, cookie) { return server.isRequestAuthed({ socket: { encrypted: true, remoteAddress: '127.0.0.1' }, headers: { host: 'clay.example.test', cookie: cookie } }); }

test('real WebAuthn registration and signed login persist, expose only safe metadata and support multiple named passkeys', async function (t) {
  var f = await setup(t);
  var registered = await register(f); assert.equal(registered.result.code, 200, JSON.stringify(registered.result.body));
  assert.equal(registered.result.body.passkeys[0].publicKey, undefined);
  assert.equal(authed(f.server, registered.proof), false);
  var second = authenticator(); assert.equal((await register(f, {}, second)).result.code, 200);
  var loginResult = await login(f); assert.equal(loginResult.result.code, 200, JSON.stringify(loginResult.result.body));
  assert.match(loginResult.result.headers['Set-Cookie'][0], /; Secure/);
  assert.equal(authed(f.server, cookies(loginResult.result)), true);
  assert.equal(authed(f.h.server(), cookies(loginResult.result)), true);
  var user = f.h.users.findUserById('owner');
  assert.equal(user.passkeys[0].counter, 1); assert.ok(user.passkeys[0].lastUsedAt);
  assert.ok(user.passwordHash); assert.equal(user.passkeys.length, 2);
  var renamed = await request(f.server, 'POST', '/api/passkeys/rename', { id: second.id, name: 'Backup key', currentPassword: phrase }, f.cookie);
  assert.equal(renamed.code, 200); assert.equal(renamed.body.passkeys[1].name, 'Backup key');
  assert.equal((await login(f, {}, second)).result.code, 200);
});

test('fresh password and authenticated ownership protect registration, naming, removal and policy changes', async function (t) {
  var f = await setup(t);
  assert.equal((await request(f.server, 'POST', '/api/passkeys/register/options', { name: 'No session', currentPassword: phrase })).code, 400);
  assert.equal((await request(f.server, 'POST', '/api/passkeys/register/options', { name: 'Wrong password', currentPassword: 'wrong' }, f.cookie)).code, 400);
  assert.equal((await request(f.server, 'PUT', '/api/passkey-policy', { origin: origin, currentPassword: 'wrong' }, f.cookie)).code, 400);
  assert.equal((await register(f)).result.code, 200);
  var hash = await passwords.hash(phrase); var state = f.h.users.loadUsers();
  state.users.push({ id: 'other', username: 'Other', role: 'user', passwordHash: hash }); f.h.users.saveUsers(state);
  var otherCookie = f.server.createMultiUserSession('other', hash).cookie;
  assert.equal((await request(f.server, 'PUT', '/api/passkey-policy', { origin: origin, currentPassword: phrase }, otherCookie)).code, 403);
  assert.equal((await request(f.server, 'POST', '/api/passkeys/remove', { id: f.key.id, currentPassword: phrase }, otherCookie)).code, 400);
  assert.equal((await request(f.server, 'POST', '/api/passkeys/rename', { id: f.key.id, name: 'Changed', currentPassword: 'wrong' }, f.cookie)).code, 400);
  assert.equal(f.h.users.findUserById('owner').passkeys[0].name, 'Personal laptop');
});

test('exact configured origin and RP ID are independent of request host or network allowlists', async function (t) {
  var f = await setup(t);
  for (var value of ['http://public.example.test', 'https://127.0.0.1', 'https://clay.example.test/path', 'https://*.example.test']) {
    assert.equal((await request(f.server, 'PUT', '/api/passkey-policy', { origin: value, currentPassword: phrase }, f.cookie)).code, 400);
  }
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/options', {}, '', { origin: 'https://evil.example.test', host: 'evil.example.test' })).code, 403);
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/options', {}, '', { origin: undefined })).code, 403);
  var options = await request(f.server, 'POST', '/auth/passkeys/login/options', {}, '', { host: 'clay.example.test', 'x-forwarded-host': 'untrusted.example.test' });
  assert.equal(options.body.options.rpId, 'clay.example.test');
  assert.equal((await register(f, { rpID: 'wrong.example.test' })).result.code, 400);
  assert.equal((await register(f, { client: { origin: 'https://evil.example.test' } })).result.code, 400);
  assert.equal((await register(f)).result.code, 200);
  assert.equal((await request(f.server, 'PUT', '/api/passkey-policy', { origin: 'https://new.example.test', currentPassword: phrase }, f.cookie)).code, 400);
});

test('user presence, verification, signatures, user handles and counters are enforced', async function (t) {
  var f = await setup(t);
  assert.equal((await register(f, { flags: 0x41 })).result.code, 400);
  assert.equal((await register(f, { flags: 0x44 })).result.code, 400);
  assert.equal((await register(f, { client: { crossOrigin: true } })).result.code, 400);
  assert.equal((await register(f)).result.code, 200);
  for (var overrides of [{ flags: 1 }, { flags: 4 }, { badSignature: true }, { handle: 'wrong' }, { handle: null }, { rpID: 'wrong.example.test' }, { client: { origin: 'https://evil.example.test' } }]) {
    assert.equal((await login(f, overrides)).result.code, 400, JSON.stringify(overrides));
  }
  assert.equal((await login(f)).result.code, 200);
  assert.equal((await login(f)).result.code, 400);
  assert.equal((await login(f, { counter: 2 })).result.code, 200);
});

test('challenges are browser and session bound, single-use, expiring and cancelled by logout', async function (t) {
  var f = await setup(t);
  var options = await request(f.server, 'POST', '/api/passkeys/register/options', { name: 'Laptop', currentPassword: phrase }, f.cookie);
  var response = f.key.register(options.body.options, origin);
  var otherSession = f.server.createMultiUserSession('owner', f.h.users.findUserById('owner').passwordHash).cookie;
  assert.equal((await request(f.server, 'POST', '/api/passkeys/register/verify', { response: response }, otherSession + '; ' + cookies(options))).code, 400);
  var registered = await register(f); assert.equal(registered.result.code, 200);
  assert.equal((await request(f.server, 'POST', '/api/passkeys/register/verify', { response: registered.response }, f.cookie + '; ' + registered.proof)).code, 400);
  options = await request(f.server, 'POST', '/auth/passkeys/login/options', {});
  response = f.key.authenticate(options.body.options, origin);
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response })).code, 400);
  var first = await request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response }, cookies(options));
  assert.equal(first.code, 200);
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response }, cookies(options))).code, 400);
  options = await request(f.server, 'POST', '/auth/passkeys/login/options', {});
  await request(f.server, 'POST', '/auth/logout', {}, cookies(options));
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response }, cookies(options))).code, 400);
  options = await request(f.server, 'POST', '/auth/passkeys/login/options', {});
  t.mock.timers.enable({ apis: ['Date'], now: Date.now() }); t.mock.timers.tick(300001);
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/verify', { response: f.key.authenticate(options.body.options, origin, { counter: 2 }) }, cookies(options))).code, 400);
});

test('failed persistence grants no access and does not remove password fallback', async function (t) {
  var f = await setup(t);
  f.h.state.failUsers = true;
  assert.equal((await register(f)).result.code, 400);
  assert.equal(f.h.users.findUserById('owner').passkeys, undefined);
  f.h.state.failUsers = false; assert.equal((await register(f)).result.code, 200);
  f.h.state.failUsers = true;
  var failed = await login(f); assert.equal(failed.result.code, 400); assert.equal(failed.result.headers['Set-Cookie'], undefined);
  assert.equal(f.h.users.findUserById('owner').passkeys[0].counter, 0);
  f.h.state.failUsers = false;
  assert.equal((await login(f)).result.code, 200);
  assert.equal((await request(f.server, 'POST', '/auth/login', { username: 'Owner', password: phrase })).code, 200);
});

test('removal revokes passkey sessions, password changes revoke sessions and recovery clears all passkeys', async function (t) {
  var f = await setup(t); assert.equal((await register(f)).result.code, 200);
  var signedIn = await login(f); var session = cookies(signedIn.result);
  var removed = await request(f.server, 'POST', '/api/passkeys/remove', { id: f.key.id, currentPassword: phrase }, f.cookie);
  assert.equal(removed.code, 200); assert.equal(authed(f.server, session), false); assert.equal(authed(f.h.server(), session), false);
  assert.equal(authed(f.server, cookies(removed)), true); assert.equal((await login(f, { counter: 2 })).result.code, 400);
  assert.equal(authed(f.server, f.cookie), false);
  f.cookie = cookies(removed);
  f.key = authenticator(); assert.equal((await register(f)).result.code, 200);
  session = cookies((await login(f)).result);
  var change = await request(f.server, 'POST', '/auth/password-change', { currentPassword: phrase, password: 'another long passphrase', confirmPassword: 'another long passphrase' }, f.cookie);
  assert.equal(change.code, 200); assert.equal(authed(f.server, session), false);
  f.h.users.updateUserPin('owner', '123456');
  assert.equal(f.h.users.findUserById('owner').passkeys, undefined);
  assert.equal((await login(f, { counter: 2 })).result.code, 400);
});

test('concurrent verification consumes a challenge once and invalid requests are bounded', async function (t) {
  var f = await setup(t); assert.equal((await register(f)).result.code, 200);
  var options = await request(f.server, 'POST', '/auth/passkeys/login/options', {});
  var response = f.key.authenticate(options.body.options, origin);
  var results = await Promise.all([request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response }, cookies(options)), request(f.server, 'POST', '/auth/passkeys/login/verify', { response: response }, cookies(options))]);
  assert.deepEqual(results.map(function (result) { return result.code; }).sort(), [200, 400]);
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/options', { large: 'x'.repeat(33000) })).code, 413);
  assert.equal((await request(f.server, 'POST', '/auth/passkeys/login/options', {}, '', { 'content-type': 'text/plain' })).code, 415);
  for (var i = 0; i < 10; i++) await request(f.server, 'POST', '/auth/passkeys/login/options', {});
  assert.match((await request(f.server, 'POST', '/auth/passkeys/login/options', {})).body.error, /Too many attempts/);
});

test('solo and account PIN modes cannot enable passkeys; localhost is accepted explicitly', async function (t) {
  var h = fixture.isolated(t); fixture.seed(h, null);
  var server = h.server();
  assert.equal((await request(server, 'GET', '/api/passkey-policy')).body.available, false);
  assert.equal((await request(server, 'POST', '/auth/passkeys/login/options', {})).code, 409);
  assert.equal((await request(server, 'PUT', '/api/passkey-policy', { origin: origin, currentPassword: phrase })).code, 400);
  var parser = require('../lib/account-passkey-policy');
  assert.equal(parser.parseOrigin('http://localhost:3000').rpID, 'localhost');
});

test('synced passkeys can use zero counters but cannot change their backup eligibility', async function (t) {
  var f = await setup(t);
  assert.equal((await register(f, { flags: 0x5d })).result.code, 200);
  assert.equal((await login(f, { flags: 0x1d, counter: 0 })).result.code, 200);
  assert.equal((await login(f, { flags: 0x1d, counter: 0 })).result.code, 200);
  assert.equal((await login(f, { flags: 5, counter: 0 })).result.code, 400);
});

test('credential changes and policy changes invalidate pending registration', async function (t) {
  var f = await setup(t);
  var options = await request(f.server, 'POST', '/api/passkeys/register/options', { name: 'Pending', currentPassword: phrase }, f.cookie);
  var response = f.key.register(options.body.options, origin);
  await request(f.server, 'PUT', '/api/passkey-policy', { origin: 'https://different.example.test', currentPassword: phrase }, f.cookie);
  assert.equal((await request(f.server, 'POST', '/api/passkeys/register/verify', { response: response }, f.cookie + '; ' + cookies(options), { origin: 'https://different.example.test', host: 'different.example.test' })).code, 400);
  await request(f.server, 'PUT', '/api/passkey-policy', { origin: origin, currentPassword: phrase }, f.cookie);
  options = await request(f.server, 'POST', '/api/passkeys/register/options', { name: 'Pending', currentPassword: phrase }, f.cookie);
  response = f.key.register(options.body.options, origin);
  f.h.users.updateUserPin('owner', '123456');
  assert.equal((await request(f.server, 'POST', '/api/passkeys/register/verify', { response: response }, f.cookie + '; ' + cookies(options))).code, 400);
  assert.equal(f.h.users.findUserById('owner').passkeys, undefined);
});

test('session persistence failure does not issue a passkey login cookie', async function (t) {
  var f = await setup(t); assert.equal((await register(f)).result.code, 200);
  f.h.state.failTokens = true;
  var result = await login(f); assert.equal(result.result.code, 400); assert.equal(result.result.headers['Set-Cookie'], undefined);
  f.h.state.failTokens = false;
  assert.equal((await login(f, { counter: 2 })).result.code, 200);
});
