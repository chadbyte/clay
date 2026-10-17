var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs');
var path = require('node:path');
var EventEmitter = require('node:events');
var fixture = require('./helpers/account-auth-fixture');
function request(server, method, url, data, cookie, origin) {
  return new Promise(function (resolve) {
    var req = new EventEmitter(); req.method = method; req.url = url;
    req.headers = { host: 'localhost', origin: origin || 'http://localhost', cookie: cookie || '', 'content-type': 'application/json' };
    req.socket = { remoteAddress: '127.0.0.1' };
    var result = {};
    var res = { writeHead: function (code, headers) { result.code = code; result.headers = headers; }, end: function (body) { result.body = JSON.parse(body); resolve(result); } };
    assert.equal(server.handleRequest(req, res, url), true);
    req.emit('data', JSON.stringify(data || {})); req.emit('end');
  });
}
function cookie(result) { return [].concat(result.headers['Set-Cookie'] || []).map(function (entry) { return entry.split(';')[0]; }).join('; '); }
function setup(t) { var h = fixture.isolated(t); fixture.seed(h, h.users.hashPin('012345')); return h; }
test('only successful login remembers a browser, persists across restart, and never authorizes access', async function (t) {
  var h = setup(t); var server = h.server();
  assert.deepEqual((await request(server, 'GET', '/auth/accounts')).body.accounts, []);
  var failure = await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '000000' });
  assert.equal(failure.code, 401); assert.equal(failure.headers['Set-Cookie'], undefined);
  var login = await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  assert.equal(login.code, 200);
  var remembered = login.headers['Set-Cookie'].find(function (entry) { return entry.startsWith('clay_accounts='); });
  assert.match(remembered, /HttpOnly; SameSite=Strict/);
  var hint = remembered.split(';')[0]; var raw = hint.split('=')[1];
  assert.equal(fs.readFileSync(path.join(h.root, 'remembered-accounts.json'), 'utf8').includes(raw), false);
  var listed = await request(h.server(), 'GET', '/auth/accounts', null, hint);
  assert.deepEqual(listed.body.accounts, [{ id: 'owner', username: 'Owner', name: 'Owner' }]);
  assert.equal(h.server().isRequestAuthed({ headers: { host: 'localhost', cookie: hint }, socket: { remoteAddress: '127.0.0.1' } }), false);
  assert.deepEqual((await request(server, 'GET', '/auth/accounts')).body.accounts, []);
  assert.equal((await request(server, 'POST', '/auth/accounts', { forget: 'owner' }, hint, 'https://foreign.example')).code, 403);
  await request(server, 'POST', '/auth/accounts', { forget: 'owner' });
  assert.equal((await request(server, 'GET', '/auth/accounts', null, hint)).body.accounts.length, 1);
  assert.deepEqual((await request(server, 'POST', '/auth/accounts', { forget: 'owner' }, hint)).body.accounts, []);
  assert.ok(h.users.findUserById('owner'));
  assert.ok(h.server().isRequestAuthed({ headers: { host: 'localhost', cookie: cookie(login) }, socket: { remoteAddress: '127.0.0.1' } }));
});
test('PIN transition is remembered only after a password is saved; successful login rotates the hint', async function (t) {
  var h = setup(t); var server = h.server();
  await request(server, 'PUT', '/api/account-auth-policy', { method: 'password' }, server.createMultiUserSession('owner').cookie);
  var proof = await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  assert.equal(proof.body.passwordRequired, true); assert.equal(cookie(proof).includes('clay_accounts='), false);
  var phrase = 'a memorable fixture passphrase';
  var done = await request(server, 'POST', '/auth/password-transition', { password: phrase, confirmPassword: phrase }, cookie(proof));
  assert.equal(done.code, 200); assert.ok(cookie(done).includes('clay_accounts='));
  var next = await request(server, 'POST', '/auth/login', { username: 'Owner', password: phrase }, cookie(done));
  assert.equal(next.code, 200); assert.notEqual(cookie(done), cookie(next));
  assert.deepEqual((await request(server, 'GET', '/auth/accounts', null, cookie(done))).body.accounts, []);
  assert.equal((await request(server, 'GET', '/auth/accounts', null, cookie(next))).body.accounts.length, 1);
});
test('expired accounts disappear; unavailable hint storage does not block sign-in', async function (t) {
  var h = setup(t); var server = h.server();
  var login = await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' });
  var file = path.join(h.root, 'remembered-accounts.json'); var data = JSON.parse(fs.readFileSync(file));
  Object.values(data).forEach(function (entry) { entry.until = 1; }); fs.writeFileSync(file, JSON.stringify(data));
  assert.deepEqual((await request(server, 'GET', '/auth/accounts', null, cookie(login))).body.accounts, []);
  fs.writeFileSync(file, 'invalid');
  assert.equal((await request(server, 'POST', '/auth/login', { username: 'Owner', pin: '012345' })).code, 200);
});
test('remembered list is bounded, unique and excludes deleted users', async function (t) {
  var h = setup(t); var state = h.users.loadUsers();
  for (var i = 0; i < 6; i++) state.users.push({ id: 'member' + i, username: 'Member' + i, role: 'member', pinHash: state.users[0].pinHash });
  h.users.saveUsers(state); var server = h.server(); var current = '';
  for (var j = 0; j < 6; j++) current = cookie(await request(server, 'POST', '/auth/login', { username: 'Member' + j, pin: '012345' }, current));
  var listed = (await request(server, 'GET', '/auth/accounts', null, current)).body.accounts;
  assert.equal(listed.length, 5); assert.equal(listed[0].id, 'member5');
  current = cookie(await request(server, 'POST', '/auth/login', { username: 'Member3', pin: '012345' }, current));
  listed = (await request(server, 'GET', '/auth/accounts', null, current)).body.accounts;
  assert.equal(listed.length, 5); assert.equal(listed[0].id, 'member3');
  state = h.users.loadUsers(); state.users = state.users.filter(function (user) { return user.id !== 'member3'; }); h.users.saveUsers(state);
  assert.equal((await request(server, 'GET', '/auth/accounts', null, current)).body.accounts.length, 4);
});
