var test = require('node:test');
var assert = require('node:assert/strict');
var crypto = require('node:crypto');
var fs = require('node:fs');
var os = require('node:os');
var path = require('node:path');
var vm = require('node:vm');
var EventEmitter = require('node:events');
var attachAuth = require('../lib/users-auth').attachAuth;

function legacy(pin) {
  return crypto.createHash('sha256').update('clay-user:' + pin).digest('hex');
}

function harness(hash, failSave) {
  var data = { users: [{ id: 'owner', username: 'Owner', pinHash: hash, mustChangePin: true, profile: { name: 'Keep' } }], smtp: { host: 'keep' } };
  var saves = 0;
  var auth = attachAuth({
    loadUsers: function () { return JSON.parse(JSON.stringify(data)); },
    saveUsers: function (next) { if (failSave) throw new Error('disk unavailable'); data = next; saves++; },
  });
  return { auth: auth, data: function () { return data; }, saves: function () { return saves; } };
}

test('new account PIN hashes have independent salts and verify with fixed scrypt parameters', function () {
  var auth = harness(null).auth;
  var first = auth.hashPin('012345');
  var second = auth.hashPin('012345');
  assert.notEqual(first, second);
  assert.match(first, /^scrypt-v1:[a-f0-9]{32}:[a-f0-9]{128}$/);
  var parts = first.split(':');
  assert.equal(parts[2], crypto.scryptSync('clay-user:012345', parts[1], 64, { N: 16384, r: 8, p: 1 }).toString('hex'));
  assert.equal(auth.verifyPin('012345', first), true);
  assert.equal(auth.verifyPin('012346', first), false);
  assert.equal(auth.verifyPin('012345', second), true);
});

test('legacy login migrates only after success and preserves unrelated account data', function () {
  var h = harness(legacy('012345'));
  assert.equal(h.auth.authenticateUser('owner', 'wrong'), null);
  assert.equal(h.saves(), 0);
  assert.equal(h.auth.authenticateUser('OWNER', '012345').id, 'owner');
  assert.equal(h.saves(), 1);
  assert.match(h.data().users[0].pinHash, /^scrypt-v1:/);
  assert.equal(h.data().users[0].mustChangePin, true);
  assert.equal(h.data().users[0].profile.name, 'Keep');
  assert.equal(h.data().smtp.host, 'keep');
  assert.equal(h.auth.authenticateUser('owner', '012345').id, 'owner');
  assert.equal(h.saves(), 1, 'new hashes do not rewrite on every login');
});

test('migration write failure keeps a valid legacy login working', function () {
  var hash = legacy('123456');
  var h = harness(hash, true);
  assert.equal(h.auth.authenticateUser('owner', '123456').pinHash, hash);
  assert.equal(h.data().users[0].pinHash, hash);
  assert.equal(h.auth.authenticateUser('owner', '123456').id, 'owner');
  assert.equal(h.auth.authenticateUser('owner', '000000'), null);
});

test('malformed hashes and inputs fail closed without migration', function () {
  var hashes = [null, '', {}, 'a'.repeat(63), 'z'.repeat(64), 'scrypt-v2:' + 'a'.repeat(32) + ':' + 'b'.repeat(128), 'scrypt-v1:aa:bb', 'scrypt-v1:' + 'a'.repeat(32) + ':' + 'b'.repeat(128) + ':extra'];
  hashes.forEach(function (hash) {
    var h = harness(hash);
    assert.equal(h.auth.authenticateUser('owner', '123456'), null);
    assert.equal(h.saves(), 0);
  });
  var h = harness(legacy('123456'));
  [null, undefined, {}, [], NaN].forEach(function (input) {
    assert.equal(h.auth.authenticateUser(input, '123456'), null);
    assert.equal(h.auth.authenticateUser('owner', input), null);
  });
  assert.equal(h.auth.authenticateUser('missing', '123456'), null);
});

test('older numeric JSON PIN submissions keep working across migration', function () {
  var h = harness(legacy('123456'));
  assert.equal(h.auth.authenticateUser('owner', 123456).id, 'owner');
  assert.equal(h.auth.authenticateUser('owner', 123456).id, 'owner');
  assert.equal(h.auth.authenticateUser('owner', '123456').id, 'owner');
});

// Load real modules against an isolated config root, never the operator's data.
function isolated(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-pin-auth-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  var cache = {};
  function load(name) {
    if (cache[name]) return cache[name].exports;
    if (name === 'config') return { CONFIG_DIR: root, isDevMode: false };
    if (name === 'mates') return { buildMateCtx: function () { return {}; }, ensureBuiltinMates: function () {} };
    if (name === 'dicebear-avatar') return {};
    var file = path.join(__dirname, '../lib', name + '.js');
    var mod = { exports: {} };
    cache[name] = mod;
    var wrapper = vm.runInThisContext('(function(require,module,exports,__filename,__dirname){' + fs.readFileSync(file, 'utf8') + '\n})', { filename: file });
    wrapper(function (id) { return id.indexOf('./') === 0 ? load(id.slice(2)) : require(id); }, mod, mod.exports, file, path.dirname(file));
    return mod.exports;
  }
  var users = load('users');
  var pages = {};
  ['pinPageHtml', 'adminSetupPageHtml', 'multiUserLoginPageHtml', 'smtpLoginPageHtml'].forEach(function (key) { pages[key] = function () { return ''; }; });
  function server() { return load('server-auth').attachAuth({ users: users, smtp: { isEmailLoginEnabled: function () { return false; } }, pages: pages }); }
  return { root: root, users: users, load: load, server: server };
}

function request(handler, method, url, body, cookie) {
  var req = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { cookie: cookie || '' };
  req.socket = { remoteAddress: '127.0.0.1' };
  var result = {};
  var res = { writeHead: function (code, headers) { result.code = code; result.headers = headers || {}; }, end: function (text) { result.body = JSON.parse(text); } };
  assert.equal(handler.handleRequest(req, res, url), true);
  req.emit('data', JSON.stringify(body));
  req.emit('end');
  return result;
}

function seed(h, pinHash, extras) {
  fs.writeFileSync(path.join(h.root, 'users.json'), JSON.stringify({ multiUser: true, users: [Object.assign({ id: 'owner', username: 'Owner', role: 'admin', pinHash: pinHash }, extras)], invites: [] }));
}

test('deployed legacy login upgrades on disk and old sessions survive migration and restart', function (t) {
  var h = isolated(t);
  seed(h, legacy('012345'));
  fs.writeFileSync(path.join(h.root, 'auth-tokens.json'), JSON.stringify({ 'owner:existing-session': 'owner' }));
  var server = h.server();
  var oldReq = { headers: { cookie: 'relay_auth_user=owner:existing-session' } };
  assert.equal(server.getMultiUserFromReq(oldReq).id, 'owner');
  var login = request(server, 'POST', '/auth/login', { username: 'owner', pin: '012345' });
  assert.equal(login.code, 200);
  assert.match(h.users.findUserById('owner').pinHash, /^scrypt-v1:/);
  var restarted = h.server();
  assert.equal(restarted.getMultiUserFromReq(oldReq).id, 'owner');
  assert.equal(restarted.getMultiUserFromReq({ headers: { cookie: login.headers['Set-Cookie'].split(';')[0] } }).id, 'owner');
  assert.equal(request(restarted, 'POST', '/auth/login', { username: 'owner', pin: '012345' }).code, 200);
  assert.equal(request(restarted, 'POST', '/auth/login', { username: 'owner', pin: '000000' }).code, 401);
});

test('PIN settings verify both formats and persist the new PIN without invalidating sessions', function (t) {
  var h = isolated(t);
  [legacy('123456'), h.users.hashPin('123456')].forEach(function (hash) {
    seed(h, hash);
    var server = h.server();
    var cookie = server.createMultiUserSession('owner').cookie;
    var settings = h.load('server-settings').attachSettings({ users: h.users, CONFIG_DIR: h.root, opts: {}, getMultiUserFromReq: server.getMultiUserFromReq });
    assert.equal(request(settings, 'PUT', '/api/user/pin', { currentPin: '000000', newPin: '654321' }, cookie).code, 400);
    assert.equal(h.users.findUserById('owner').pinHash, hash);
    assert.equal(request(settings, 'PUT', '/api/user/pin', { currentPin: '123456', newPin: '654321' }, cookie).code, 200);
    assert.match(h.users.findUserById('owner').pinHash, /^scrypt-v1:/);
    assert.equal(h.users.authenticateUser('owner', '123456'), null);
    assert.equal(h.users.authenticateUser('owner', '654321').id, 'owner');
    assert.equal(server.getMultiUserFromReq({ headers: { cookie: cookie } }).id, 'owner');
  });
});

test('temporary PINs, new accounts and admin recovery use salted hashes', function (t) {
  var h = isolated(t);
  seed(h, legacy('123456'));
  var created = h.users.createUserByAdmin({ username: 'new-user' });
  assert.match(created.user.pinHash, /^scrypt-v1:/);
  assert.equal(h.users.authenticateUser('new-user', created.tempPin).mustChangePin, true);
  var server = h.server();
  var cookie = server.createMultiUserSession(created.user.id).cookie;
  var settings = h.load('server-settings').attachSettings({ users: h.users, CONFIG_DIR: h.root, opts: {}, getMultiUserFromReq: server.getMultiUserFromReq });
  assert.equal(request(settings, 'PUT', '/api/user/pin', { newPin: '012345' }, cookie).code, 200);
  assert.equal(h.users.authenticateUser('new-user', '012345').mustChangePin, false);
  server.setRecovery('fixture', 'recovery-secret');
  assert.equal(request(server, 'POST', '/recover/fixture', { step: 'reset', password: 'recovery-secret', pin: '987654' }).code, 200);
  assert.equal(h.users.authenticateUser('owner', '123456'), null);
  assert.equal(h.users.authenticateUser('owner', '987654').id, 'owner');
  assert.match(h.users.findUserById('owner').pinHash, /^scrypt-v1:/);
});

test('solo no-PIN access and legacy server-wide PIN formats remain unchanged', function (t) {
  var h = isolated(t);
  seed(h, null);
  assert.equal(h.server().getMultiUserFromReq({ headers: {} }).id, 'owner');
  assert.equal(h.users.authenticateUser('owner', ''), null);
  var auth = h.load('server-auth');
  var legacyServerHash = crypto.createHash('sha256').update('clay:123456').digest('hex');
  assert.equal(auth.verifyPin('123456', legacyServerHash), true);
  assert.equal(auth.verifyPin('123456', auth.generateAuthToken('123456')), true);
});
