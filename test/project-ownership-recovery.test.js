var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('fs'), path = require('path'), os = require('os'), EventEmitter = require('events');
var create = require('../lib/project-ownership-recovery').createRecoveryService;
function fixture(t) {
  var home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-recovery-'))); t.after(function () { fs.rmSync(home, { recursive: true, force: true }); });
  var directory = path.join(home, 'project'); fs.mkdirSync(directory);
  var data = { config: { osUsers: true, unrelated: 'keep', projects: [{ slug: 'parent', path: directory, ownerId: 'deleted', visibility: 'private', allowedUsers: ['member'], ownershipRecovery: 'required' }] },
    accounts: [{ id: 'owner', username: 'Owner', role: 'user', linuxUser: 'real-owner' }, { id: 'admin', role: 'admin', username: 'Admin' }], fail: false, published: 0, saved: 0, mapped: true };
  data.service = create({ getConfig: function () { return data.config; }, getAccounts: function () { return data.accounts; }, resolveIdentity: function () { if (!data.mapped) throw new Error('missing'); return { uid: fs.statSync(home).uid, home: home }; },
    persist: function (next) { if (data.fail) throw new Error('disk failure'); data.disk = next; data.saved++; },
    publish: function (next) { if (data.publishBeforeAssign) throw new Error('publication failure before config update'); data.config = next; data.published++; if (data.publishFail) throw new Error('publication failure'); } });
  return data;
}
test('private recovery requires unique OS proof, saves before publication, preserves sharing and never transfers sessions', function (t) {
  var f = fixture(t), check = f.service.inspect('parent');
  assert.equal(check.status, 'ready'); assert.equal(check.owner.id, 'owner');
  assert.equal(JSON.stringify(check).includes(f.config.projects[0].path), false);
  assert.equal(f.service.apply('parent', check.revision, function () {}).status, 'recovered');
  assert.equal(f.saved, 1); assert.equal(f.published, 1); assert.equal(f.config.unrelated, 'keep');
  assert.deepEqual(f.config.projects[0].allowedUsers, ['member']); assert.equal(f.config.projects[0].ownershipRecovery, undefined);
  assert.equal(f.service.inspect('parent').status, 'healthy');
  assert.throws(function () { f.service.apply('parent', check.revision, function () {}); }, /Check again/); assert.equal(f.saved, 1);
});
test('blocked mapping, aliases, owner replacement and evidence changes cannot be overridden', function (t) {
  var f = fixture(t); f.mapped = false; assert.equal(f.service.inspect('parent').code, 'identity_unresolved');
  assert.throws(function () { f.service.apply('parent', 'anything', function () {}); });
  f.mapped = true; var check = f.service.inspect('parent');
  f.accounts.push({ id: 'alias', linuxUser: 'alias' }); assert.equal(f.service.inspect('parent').code, 'ambiguous_mapping');
  assert.throws(function () { f.service.apply('parent', check.revision, function () {}); });
  f.accounts.pop(); f.config.projects[0].allowedUsers.push('new-member');
  assert.throws(function () { f.service.apply('parent', check.revision, function () {}); });
  check = f.service.inspect('parent'); fs.renameSync(f.config.projects[0].path, f.config.projects[0].path + '-old'); fs.mkdirSync(f.config.projects[0].path);
  assert.throws(function () { f.service.apply('parent', check.revision, function () {}); }); assert.equal(f.saved, 0);
});
test('persistence and authorization failures do not publish; uncertain publication is explicit', function (t) {
  var f = fixture(t), check = f.service.inspect('parent'); f.fail = true;
  assert.throws(function () { f.service.apply('parent', check.revision, function () {}); }, /disk/); assert.equal(f.published, 0); assert.equal(f.config.projects[0].ownerId, 'deleted');
  f.fail = false; assert.throws(function () { f.service.apply('parent', check.revision, function () { throw new Error('revoked'); }); }, /revoked/); assert.equal(f.saved, 0);
  f.publishFail = true; var result = f.service.apply('parent', check.revision, function () {}); assert.equal(result.status, 'publication_failed'); assert.equal(result.persisted, true);
});
test('public orphan uses the same deterministic startup policy; worktrees and Mates cannot be claimed', function (t) {
  var f = fixture(t); f.config.projects[0].visibility = 'public'; var check = f.service.inspect('parent'); assert.equal(check.owner.id, 'admin');
  f.config.projects.push({ slug: 'mate-private', isMate: true }, { slug: 'parent--child' });
  assert.throws(function () { f.service.inspect('parent--child'); }); assert.throws(function () { f.service.inspect('mate-private'); });
});
test('HTTP recovery checks live admin identity, JSON/same origin, exact revision and bounded body', async function (t) {
  var f = fixture(t), actor = { id: 'admin', role: 'admin' };
  var route = require('../lib/server-project-ownership').attachOwnershipRoutes({ service: f.service, projects: new Map([['parent', { getStatus: function () { return {}; } }]]), getUser: function () { return actor; }, users: { isMultiUser: function () { return true; }, findUserById: function (id) { return f.accounts.find(function (a) { return a.id === id; }); }, getEffectivePermissions: function () { return {}; } } });
  function call(method, value, headers, beforeEnd) { return new Promise(function (resolve) {
    var req = new EventEmitter(); req.method = method; req.headers = Object.assign({ host: 'localhost', 'content-type': 'application/json' }, headers);
    var res = { writeHead: function (code) { this.status = code; }, end: function (body) { resolve({ status: this.status, data: JSON.parse(body) }); } };
    assert.equal(route.handleRequest(req, res, '/api/project-settings/parent/ownership'), true);
    if (method === 'POST') { if (beforeEnd) beforeEnd(); req.emit('data', JSON.stringify(value)); req.emit('end'); }
  }); }
  actor = { id: 'owner' }; assert.equal((await call('GET')).status, 403);
  actor = { id: 'admin' }; var check = (await call('GET')).data;
  assert.equal((await call('POST', { revision: check.revision }, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await call('POST', { revision: check.revision, ownerId: 'admin' })).status, 409);
  assert.equal((await call('POST', { revision: check.revision }, {}, function () { actor = { id: 'owner' }; })).status, 409);
  assert.equal(f.saved, 0); actor = { id: 'admin' };
  assert.equal((await call('POST', { revision: check.revision })).status, 200);
});

test('a saved but unpublished recovery cannot be replayed against stale in-memory configuration', function (t) {
  var f = fixture(t), check = f.service.inspect('parent'); f.publishBeforeAssign = true;
  assert.equal(f.service.apply('parent', check.revision, function () {}).persisted, true);
  assert.equal(f.service.inspect('parent').status, 'publication_failed');
  assert.throws(function () { f.service.apply('parent', check.revision, function () {}); });
  assert.equal(f.saved, 1); assert.equal(f.config.projects[0].ownerId, 'deleted');
});
