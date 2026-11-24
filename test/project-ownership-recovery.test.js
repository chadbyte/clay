var test = require('node:test'), assert = require('node:assert/strict');
var fs = require('fs'), path = require('path'), os = require('os'), EventEmitter = require('events');
var create = require('../lib/project-ownership-recovery').createRecoveryService;
function fixture(t) {
  var home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'clay-recovery-'))); t.after(function () { fs.rmSync(home, { recursive: true, force: true }); });
  var directory = path.join(home, 'project'); fs.mkdirSync(directory);
  var data = { config: { osUsers: true, unrelated: 'keep', projects: [{ slug: 'parent', path: directory, ownerId: 'deleted', visibility: 'private', allowedUsers: ['member'], ownershipRecovery: 'required' }] },
    accounts: [{ id: 'owner', username: 'Owner', role: 'user', linuxUser: 'real-owner' }, { id: 'admin', role: 'admin', username: 'Admin' }], fail: false, published: 0, saved: 0, mapped: true };
  data.service = create({ getConfig: function () { return data.config; }, getAccounts: function () { return data.accounts; }, now: function () { return data.now || Date.now(); }, resolveIdentity: function () { if (!data.mapped) throw new Error('missing'); return { uid: fs.statSync(home).uid, home: home }; },
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
  assert.equal((await call('POST', { revision: '0'.repeat(64) })).status, 403);
  actor = { id: 'admin' }; var check = (await call('GET')).data;
  assert.equal((await call('POST', { revision: check.revision }, { origin: 'https://foreign.example' })).status, 403);
  assert.equal((await call('POST', { revision: check.revision, ownerId: 'admin' })).status, 409);
  assert.equal((await call('POST', { revision: '0'.repeat(64) })).status, 409);
  assert.equal((await call('POST', { revision: check.revision, padding: 'x'.repeat(2048) })).status, 409);
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

test('local operator approval reviews an exact owner without OS mapping and consumes once', function (t) {
  var f = fixture(t); f.config.osUsers = false; delete f.accounts[0].linuxUser;
  assert.equal(f.service.inspect('parent').code, 'mapping_unavailable');
  assert.equal(f.service.approve('parent', 'missing').ok, false);
  var issued = f.service.approve('parent', 'Owner'); assert.equal(issued.ok, true); assert.equal(f.saved, 0);
  var check = f.service.reviewApproval('parent', issued.approvalCode, 'admin');
  assert.equal(check.owner.id, 'owner'); assert.equal(check.status, 'ready');
  assert.equal(JSON.stringify(f.service.inspect('parent')).includes(issued.approvalCode), false);
  assert.throws(function () { f.service.reviewApproval('parent', issued.approvalCode, 'other-admin'); }, /invalid/);
  assert.throws(function () { f.service.reviewApproval('foreign', issued.approvalCode, 'admin'); }, /invalid/);
  assert.equal(f.service.apply('parent', check.revision, function () { return { id: 'admin' }; }, issued.approvalCode).ok, true);
  assert.deepEqual(f.config.projects[0].allowedUsers, ['member']);
  assert.throws(function () { f.service.reviewApproval('parent', issued.approvalCode, 'admin'); }, /invalid/);
});
test('operator approvals expire, bind all accounts and directories, and cannot bypass OS isolation', function (t) {
  var f = fixture(t); assert.equal(f.service.approve('parent', 'Owner').ok, false);
  f.config.osUsers = false; delete f.accounts[0].linuxUser;
  var issued = f.service.approve('parent', 'Owner'); f.now = issued.expiresAt;
  assert.throws(function () { f.service.reviewApproval('parent', issued.approvalCode, 'admin'); }, /expired/);
  f.now = 1; issued = f.service.approve('parent', 'Owner'); f.accounts[0].role = 'admin';
  assert.throws(function () { f.service.reviewApproval('parent', issued.approvalCode, 'admin'); }, /changed/);
  issued = f.service.approve('parent', 'Owner');
  fs.renameSync(f.config.projects[0].path, f.config.projects[0].path + '-old'); fs.mkdirSync(f.config.projects[0].path);
  assert.throws(function () { f.service.reviewApproval('parent', issued.approvalCode, 'admin'); }, /changed/);
  issued = f.service.approve('parent', 'Owner'); var check = f.service.reviewApproval('parent', issued.approvalCode, 'admin'); f.fail = true;
  assert.throws(function () { f.service.apply('parent', check.revision, function () { return { id: 'admin' }; }, issued.approvalCode); }, /disk/);
  assert.equal(f.saved, 0); assert.throws(function () { f.service.reviewApproval('parent', issued.approvalCode, 'admin'); }, /used/);
});
test('operator approval is bounded and rejects unavailable directories, Mates and worktrees', function (t) {
  var f = fixture(t); f.config.osUsers = false; delete f.accounts[0].linuxUser;
  f.config.projects.push({ slug: 'mate-private', isMate: true }, { slug: 'parent--child' });
  assert.equal(f.service.approve('mate-private', 'Owner').ok, false); assert.equal(f.service.approve('parent--child', 'Owner').ok, false);
  for (var i = 0; i < 100; i++) assert.equal(f.service.approve('parent', 'Owner').ok, true);
  assert.match(f.service.approve('parent', 'Owner').error, /Too many/);
  fs.rmSync(f.config.projects[0].path, { recursive: true }); assert.equal(f.service.approve('parent', 'Owner').ok, false);
});
test('HTTP direct recovery binds the authenticated administrator and rejects legacy approval input', function (t) {
  var f = fixture(t); f.config.osUsers = false; delete f.accounts[0].linuxUser;
  var actor = { id: 'admin' };
  var route = require('../lib/server-project-ownership').attachOwnershipRoutes({ service: f.service, projects: new Map([['parent', { getStatus: function () { return {}; } }]]), getUser: function () { return actor; }, users: { isMultiUser: function () { return true; }, findUserById: function (id) { return f.accounts.find(function (a) { return a.id === id; }); }, getEffectivePermissions: function () { return {}; } } });
  function post(body, beforeEnd) {
    var response;
    var req = new EventEmitter(); req.method = 'POST'; req.headers = { host: 'localhost', 'content-type': 'application/json' };
    route.handleRequest(req, { writeHead: function (status) { this.status = status; }, end: function (value) { response = { status: this.status, data: JSON.parse(value) }; } }, '/api/project-settings/parent/ownership');
    if (beforeEnd) beforeEnd(); req.emit('data', JSON.stringify(body)); req.emit('end'); return response;
  }
  assert.equal(post({ owner: 'Admin', cmd: 'authorize_project_recovery' }).status, 409);
  var check = f.service.inspect('parent', 'admin');
  assert.equal(check.status, 'ready'); assert.equal(check.owner.id, 'admin'); assert.equal(f.saved, 0);
  assert.equal(post({ approvalCode: '0'.repeat(48) }).status, 409);
  assert.equal(post({ revision: check.revision, approvalCode: '0'.repeat(48) }).status, 409);
  assert.equal(post({ revision: check.revision }, function () { f.accounts[1].role = 'user'; }).status, 409);
  assert.equal(f.saved, 0); f.accounts[1].role = 'admin';
  assert.equal(post({ revision: check.revision }).status, 200);
  assert.equal(f.config.projects[0].ownerId, 'admin');
  assert.equal(post({ revision: check.revision }).status, 409);
});
test('legacy CLI points to direct GUI recovery without issuing approvals or applying ownership', { timeout: 15000 }, async function (t) {
  var f = fixture(t); f.config.osUsers = false; delete f.accounts[0].linuxUser;
  var cliHome = path.dirname(f.config.projects[0].path), sock = path.join(cliHome, 'daemon.sock');
  var sent = 0;
  var ipc = require('../lib/ipc').createIPCServer(sock, function () { sent++; throw new Error('Legacy CLI must not request an approval.'); }); t.after(function () { ipc.close(); });
  // Wait for the Unix socket to bind before starting the isolated CLI process.
  while (!fs.existsSync(sock)) await new Promise(function (resolve) { setImmediate(resolve); });
  var child = require('child_process').spawn(process.execPath, ['--require', path.join(__dirname, 'helpers/yoke-no-provider-processes.cjs'), path.join(__dirname, '../bin/cli.js'), '--authorize-project-recovery', 'parent', '--owner', 'Owner'], {
    env: Object.assign({}, process.env, { HOME: cliHome, CLAY_HOME: cliHome, CODEX_HOME: path.join(cliHome, '.codex'), CLAY_DEV: '' }), stdio: ['ignore','pipe','pipe']
  }); t.after(function () { child.kill(); });
  var output = '', errors = ''; child.stdout.on('data', function (data) { output += data; }); child.stderr.on('data', function (data) { errors += data; });
  var exit = await new Promise(function (resolve, reject) { child.on('exit', resolve); child.on('error', reject); });
  assert.equal(exit, 0, errors); assert.match(output, /Ownership has not changed/); assert.doesNotMatch(output, /[a-f0-9]{48}/); assert.equal(sent, 0); assert.equal(f.saved, 0);
});


test('direct administrator recovery preserves valid owners and prefers verified mapped owners', function (t) {
  var f = fixture(t); f.config.osUsers = false;
  var check = f.service.inspect('parent', 'admin'); assert.equal(check.owner.id, 'owner');
  f.config.projects[0].ownerId = 'owner';
  check = f.service.inspect('parent', 'admin'); assert.equal(check.owner.id, 'owner');
  f.service.apply('parent', check.revision, function () { return { id: 'admin' }; });
  assert.equal(f.config.projects[0].ownerId, 'owner');
  check = f.service.inspect('parent', 'admin'); assert.equal(check.status, 'healthy');
  assert.throws(function () { f.service.apply('parent', check.revision, function () { return { id: 'admin' }; }); });
  assert.equal(f.saved, 1);
});
test('unmapped orphan recovery binds exact actor, accounts, project and real directory', function (t) {
  var f = fixture(t); f.config.osUsers = false; delete f.accounts[0].linuxUser;
  f.accounts.push({ id: 'second-admin', role: 'admin', username: 'Second' });
  var actor = function () { return { id: 'admin' }; };
  var check = f.service.inspect('parent', 'admin');
  assert.equal(check.code, 'administrator_recovery'); assert.equal(check.owner.id, 'admin');
  assert.equal(f.service.inspect('parent', 'owner').status, 'blocked');
  assert.throws(function () { f.service.apply('parent', check.revision, function () { return { id: 'second-admin' }; }); });
  f.accounts[0].username = 'Replaced'; assert.throws(function () { f.service.apply('parent', check.revision, actor); });
  check = f.service.inspect('parent', 'admin'); f.config.projects[0].ownerId = 'owner';
  assert.throws(function () { f.service.apply('parent', check.revision, actor); });
  assert.equal(f.config.projects[0].ownerId, 'owner'); f.config.projects[0].ownerId = 'deleted';
  check = f.service.inspect('parent', 'admin'); var directory = f.config.projects[0].path;
  fs.renameSync(directory, directory + '-original'); fs.mkdirSync(directory);
  assert.throws(function () { f.service.apply('parent', check.revision, actor); });
  fs.rmdirSync(directory); fs.symlinkSync(directory + '-original', directory);
  assert.equal(f.service.inspect('parent', 'admin').status, 'blocked');
  assert.equal(f.saved, 0);
});
test('direct recovery rechecks changes during authorization and refuses failed runtime replay for every administrator', function (t) {
  var f = fixture(t); f.config.osUsers = false; delete f.accounts[0].linuxUser;
  f.accounts.push({ id: 'second-admin', role: 'admin', username: 'Second' });
  var check = f.service.inspect('parent', 'admin'), calls = 0;
  assert.throws(function () { f.service.apply('parent', check.revision, function () {
    calls++; if (calls === 2) f.config.projects[0].ownerId = 'owner'; return { id: 'admin' };
  }); });
  assert.equal(f.saved, 0); f.config.projects[0].ownerId = 'deleted'; f.publishBeforeAssign = true;
  check = f.service.inspect('parent', 'admin');
  assert.equal(f.service.apply('parent', check.revision, function () { return { id: 'admin' }; }).status, 'publication_failed');
  assert.equal(f.service.inspect('parent', 'second-admin').status, 'publication_failed');
  assert.equal(f.saved, 1);
});
test('administrator recovery never bypasses OS identity proof or unavailable directories', function (t) {
  var f = fixture(t); f.mapped = false;
  assert.equal(f.service.inspect('parent', 'admin').status, 'blocked');
  f.config.osUsers = false; var directory = f.config.projects[0].path;
  fs.rmdirSync(directory); assert.equal(f.service.inspect('parent', 'admin').status, 'blocked');
  fs.writeFileSync(directory, 'not a directory'); assert.equal(f.service.inspect('parent', 'admin').status, 'blocked');
  assert.equal(f.saved, 0);
});
