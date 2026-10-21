var test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-workbench-pref-'));
os.homedir = function () { return root; }; process.env.CLAY_HOME = root; process.env.CLAY_CONFIG = path.join(root, 'config.json'); delete process.env.CLAY_DEV;
var cp = require('node:child_process');
['spawn', 'exec', 'execFile', 'spawnSync', 'execSync', 'execFileSync'].forEach(function (key) { cp[key] = function () { throw new Error('External transport forbidden'); }; });
var users = require('../lib/users'), config = require('../lib/config');
var attach = require('../lib/server-workbench-layout-settings').attachWorkbenchLayoutSettings;
var EventEmitter = require('node:events');
test.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
function seed(multi) { users.saveUsers({ multiUser: multi, users: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }], invites: [] }); }
function http(options) {
  options = options || {};
  var account = options.account || 'a', authed = options.authed !== false;
  var api = attach({ users: users, isRequestAuthed: function () { return authed; }, getMultiUserFromReq: function () { return users.findUserById(account); } });
  var req = new EventEmitter(); req.setEncoding = function () {}; req.method = options.method || 'PUT';
  req.headers = Object.assign({ 'x-clay-account-id': account, 'x-clay-settings': '1', 'sec-fetch-site': 'same-origin' }, options.headers);
  var output = { writes: 0 }, res = { writeHead: function (status) { output.status = status; output.writes++; }, end: function (raw) { output.body = JSON.parse(raw); } };
  api.handleRequest(req, res, '/api/user/workbench-layout');
  return { output: output, req: req, change: function (id) { account = id; }, finish: function (body) { req.emit('data', typeof body === 'string' ? body : JSON.stringify(body)); req.emit('end'); return output; } };
}
test('real account storage persists revisions, separates accounts and refuses lost updates', function () {
  seed(true);
  assert.deepEqual(users.getWorkbenchLayoutPreference('a'), { accountId: 'a', mode: 'overlay', revision: 0 });
  assert.equal(users.setWorkbenchLayoutPreference('a', 'docked', 0).revision, 1);
  assert.equal(users.getWorkbenchLayoutPreference('a').mode, 'docked');
  assert.equal(users.getWorkbenchLayoutPreference('b').mode, 'overlay');
  assert.equal(users.setWorkbenchLayoutPreference('a', 'overlay', 0).status, 409);
  assert.equal(users.setWorkbenchLayoutPreference('a', 'invalid', 1).status, 400);
  assert.throws(function () { users.setWorkbenchLayoutPreference('foreign', 'docked', 0); });
  assert.equal(users.loadUsers().users[0].workbenchLayoutPreference.mode, 'docked');
});
test('atomic account and default-config failures retain persisted mode and unrelated settings', function () {
  seed(true); users.setWorkbenchLayoutPreference('a', 'docked', 0);
  var rename = fs.renameSync;
  fs.renameSync = function () { throw new Error('EIO'); };
  try { assert.throws(function () { users.setWorkbenchLayoutPreference('a', 'overlay', 1); }); }
  finally { fs.renameSync = rename; }
  assert.equal(users.getWorkbenchLayoutPreference('a').mode, 'docked');
  seed(false); config.saveConfig(Object.assign({}, config.loadConfig(), { unrelatedWorkbenchTest: 42 }));
  assert.equal(users.setWorkbenchLayoutPreference('default', 'docked', 0).revision, 1);
  fs.renameSync = function () { throw new Error('EIO'); };
  try { assert.throws(function () { users.setWorkbenchLayoutPreference('default', 'overlay', 1); }); }
  finally { fs.renameSync = rename; }
  assert.equal(users.getWorkbenchLayoutPreference('default').mode, 'docked');
  assert.equal(config.loadConfig().unrelatedWorkbenchTest, 42);
  assert.throws(function () { users.getWorkbenchLayoutPreference('a'); });
});
test('HTTP parser authenticates exact account, origin, bounded body and account at completion', function () {
  seed(true);
  assert.equal(http({ authed: false }).output.status, 401);
  assert.equal(http({ headers: { 'x-clay-account-id': 'b' } }).output.status, 403);
  assert.equal(http({ headers: { 'sec-fetch-site': 'cross-site' } }).output.status, 403);
  assert.equal(http({ headers: { 'x-clay-settings': undefined } }).output.status, 403);
  assert.equal(http({ headers: { origin: 'https://foreign.example', host: 'clay.example' } }).output.status, 403);
  var switched = http(); switched.change('b'); assert.equal(switched.finish({ mode: 'docked', revision: 0 }).status, 401);
  assert.equal(http().finish({ mode: 'docked', revision: 0, accountId: 'b' }).status, 400);
  assert.equal(http().finish('{').status, 400);
  var large = http(); large.finish('x'.repeat(65537)); assert.equal(large.output.status, 413); assert.equal(large.output.writes, 1);
  var aborted = http(); aborted.req.emit('aborted'); aborted.finish({ mode: 'docked', revision: 0 }); assert.equal(aborted.output.writes, 0);
  assert.equal(http().finish({ mode: 'docked', revision: 0 }).status, 200);
  assert.equal(http().finish({ mode: 'overlay', revision: 0 }).status, 409);
  assert.equal(http({ method: 'GET' }).output.body.mode, 'docked');
  var rename = fs.renameSync; fs.renameSync = function () { throw new Error('EIO'); };
  try { assert.equal(http().finish({ mode: 'overlay', revision: 1 }).status, 500); }
  finally { fs.renameSync = rename; }
  assert.equal(users.getWorkbenchLayoutPreference('a').mode, 'docked');
});

test('fresh preference factory reads saved disk state and duplicate revision saves cannot overwrite it', function () {
  seed(true);
  var factory = require('../lib/users-workbench-layout-preferences').attachWorkbenchLayoutPreferences;
  var reopened = factory({ loadUsers: users.loadUsers, saveUsers: users.saveUsers, isMultiUser: users.isMultiUser });
  assert.equal(http().finish({ mode: 'docked', revision: 0 }).status, 200);
  assert.deepEqual(reopened.get('a'), { accountId: 'a', mode: 'docked', revision: 1 });
  assert.equal(http().finish({ mode: 'overlay', revision: 0 }).status, 409);
  assert.equal(reopened.get('a').mode, 'docked');
  assert.equal(reopened.get('b').mode, 'overlay');
  assert.equal(http({ account: 'b' }).finish({ mode: 'docked', revision: 0 }).status, 200);
  assert.equal(reopened.set('a', 'overlay', 1).revision, 2);
  assert.equal(reopened.get('b').mode, 'docked');
});

test('window layouts persist by account and view without granting tool or session access', function () {
  seed(true);
  var base = { id: 'session-one' }, tree = { axis: 'horizontal', ratio: .6, left: base, right: { id: 'tool-terminal' } };
  var layout = { key: '["project","owner","view-one"]', base: base, tree: tree };
  var saved = http().finish({ mode: 'docked', revision: 0, layout: layout });
  assert.equal(saved.status, 200); assert.deepEqual(saved.body.layouts[layout.key], { base: base, tree: tree });
  assert.equal(users.getWorkbenchLayoutPreference('b').layouts, undefined);
  assert.deepEqual(users.getWorkbenchLayoutPreference('a').layouts[layout.key].tree, tree);
  assert.equal(http().finish({ mode: 'docked', revision: 0, layout: layout }).status, 409);
  ['tool-shell-command', 'tool-settings', 'tool-foreign'].forEach(function (id) {
    var invalid = Object.assign({}, layout, { tree: { axis: 'horizontal', ratio: .6, left: base, right: { id: id } } });
    assert.equal(http().finish({ mode: 'docked', revision: 1, layout: invalid }).status, 400);
  });
  assert.equal(http().finish({ mode: 'docked', revision: 1, layout: Object.assign({}, layout, { base: { id: 'different-session' } }) }).status, 400);
  assert.equal(http().finish({ mode: 'docked', revision: 1, layout: Object.assign({}, layout, { key: '__proto__' }) }).status, 400);
});
