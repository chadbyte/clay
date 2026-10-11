var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('node:fs/promises');
var os = require('node:os');
var path = require('node:path');
var scanStorage = require('../lib/storage-usage').scanStorage;
var attachStorage = require('../lib/server-storage').attachStorage;

async function fixture(t) {
  var root = await fs.mkdtemp(path.join(os.tmpdir(), 'clay-usage-'));
  t.after(function () { return fs.rm(root, { recursive: true, force: true }); });
  await fs.mkdir(path.join(root, 'project'));
  await fs.writeFile(path.join(root, 'project', 'data'), Buffer.alloc(8192));
  var stat = await fs.stat(root);
  return { root: root, uid: stat.uid };
}
test('usage attributes allocated blocks and deduplicates overlapping roots and hard links', async function (t) {
  var f = await fixture(t);
  await fs.link(path.join(f.root, 'project', 'data'), path.join(f.root, 'linked'));
  await fs.symlink('/outside/not-scanned', path.join(f.root, 'outside'));
  var options = { configDir: f.root, projectPaths: [path.join(f.root, 'project')], platform: 'linux',
    users: [{ id: 'a', username: 'Alice', linuxUser: 'alice' }], resolveIdentity: async function () { return { uid: f.uid, home: f.root }; } };
  var result = await scanStorage(options);
  var directory = await fs.stat(f.root);
  var project = await fs.stat(path.join(f.root, 'project'));
  var file = await fs.stat(path.join(f.root, 'project', 'data'));
  assert.equal(result.totalBytes, (directory.blocks + project.blocks + file.blocks) * 512);
  assert.equal(result.totalFiles, 1);
  assert.equal(result.users[0].bytes, result.totalBytes);
  assert.equal(result.unattributedBytes, 0);
  assert.equal(result.skippedLinks, 1);
  assert.equal(result.partial, false);
});
test('missing and ambiguous identities remain unavailable instead of invented per-user totals', async function (t) {
  var f = await fixture(t);
  var result = await scanStorage({ configDir: f.root, platform: 'linux', users: [
    { id: 'a', username: 'A', linuxUser: 'same' }, { id: 'b', username: 'B', linuxUser: 'same' }, { id: 'c', username: 'C' }
  ], resolveIdentity: async function () { return { uid: f.uid, home: f.root }; } });
  assert.equal(result.users.every(function (user) { return !user.mapped; }), true);
  assert.equal(result.unattributedBytes, result.totalBytes);
});
test('scan limit and unreadable roots are marked partial', async function (t) {
  var f = await fixture(t);
  var result = await scanStorage({ configDir: f.root, platform: 'linux', maxEntries: 1 });
  assert.equal(result.partial, true);
  assert.equal(result.scannedEntries, 1);
  var missing = await scanStorage({ configDir: path.join(f.root, 'missing'), platform: 'linux' });
  assert.equal(missing.partial, true);
  assert.equal(missing.errors, 1);
});
test('non-Linux scans do not resolve or traverse account homes', async function (t) {
  var f = await fixture(t);
  var result = await scanStorage({ configDir: f.root, platform: 'darwin', users: [{ id:'a', username:'A', linuxUser:'a' }],
    resolveIdentity: function () { throw new Error('Must not resolve'); } });
  assert.equal(result.users[0].mapped, false);
  assert.equal(result.unattributedBytes, result.totalBytes);
});
function response() {
  return { status: 0, writeHead: function (status) { this.status = status; }, end: function (body) { this.body = JSON.parse(body); } };
}
test('storage endpoint denies members and rechecks authorization after a shared scan', async function () {
  var role = 'user'; var calls = 0; var finish;
  var handler = attachStorage({ isRequestAuthed: function () { return true; }, getMultiUserFromReq: function () { return {role:role}; },
    users: { isMultiUser: function () {return true;}, getAllUsers: function () {return [];} }, getProjectPaths: function () {return [];},
    scanStorage: function () { calls++; return new Promise(function (resolve) { finish = resolve; }); } });
  var denied = response(); handler.handleRequest({method:'GET'}, denied, '/api/server/storage');
  assert.equal(denied.status, 403); assert.equal(calls, 0);
  role = 'admin'; var first = response(); var second = response();
  handler.handleRequest({method:'GET'}, first, '/api/server/storage');
  handler.handleRequest({method:'GET'}, second, '/api/server/storage');
  assert.equal(calls, 1);
  role = 'user'; finish({ totalBytes: 1 });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(first.status, 403); assert.equal(second.status, 403);
  role = 'admin'; var cached = response(); handler.handleRequest({method:'GET'}, cached, '/api/server/storage');
  assert.equal(cached.status, 200); assert.equal(calls, 1);
});
test('mapped home directories outside Clay and project roots are included', async function (t) {
  var f = await fixture(t);
  var home = path.join(f.root, 'home');
  await fs.mkdir(home);
  await fs.writeFile(path.join(home, 'personal'), Buffer.alloc(4096));
  var result = await scanStorage({ configDir: path.join(f.root, 'project'), platform: 'linux',
    users: [{ id: 'a', username: 'A', linuxUser: 'alice' }],
    resolveIdentity: async function () { return { uid: f.uid, home: home }; } });
  assert.equal(result.totalFiles, 2);
  assert.equal(result.users[0].files, 2);
  assert.equal(result.roots, 2);
  assert.equal(result.partial, false);
});
test('project mode uses registered owners, nested ownership and unattributed shared hard links', async function (t) {
  var f = await fixture(t);
  var nested = path.join(f.root, 'project', 'nested');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'private'), Buffer.alloc(4096));
  await fs.link(path.join(f.root, 'project', 'data'), path.join(nested, 'shared'));
  var result = await scanStorage({ configDir: f.root, platform: 'linux', attribution: 'project',
    users: [{id:'a', username:'A', linuxUser:'ignored'}, {id:'b', username:'B'}],
    projects: [{path:path.join(f.root,'project'),projectOwnerId:'a'}, {path:nested,projectOwnerId:'b'}],
    resolveIdentity: function () { throw new Error('Project mode must not resolve home directories'); } });
  assert.equal(result.attribution, 'project');
  assert.equal(result.users[0].mapped, true);
  assert.equal(result.users[0].files, 0);
  assert.equal(result.users[1].files, 1);
  assert.equal(result.unattributedFiles, 1);
  assert.equal(result.totalFiles, 2);
  assert.equal(result.users[0].projects, 1);
  assert.equal(result.totalBytes, result.users[0].bytes + result.users[1].bytes + result.unattributedBytes);
});
test('large scans return progress without restarting, then return completed totals', async function () {
  var finish; var calls = 0;
  var handler = attachStorage({ isRequestAuthed:function () {return true;}, getMultiUserFromReq:function () {return {role:'admin'};},
    users:{isMultiUser:function () {return true;},getAllUsers:function () {return [];}}, getProjects:function () {return [];},
    scanStorage:function (options) {calls++; options.onProgress({scanning:true,totalBytes:12}); return new Promise(function (resolve) {finish=resolve;});} });
  var progress = response();
  var received = new Promise(function (resolve) { var end=progress.end; progress.end=function (body) {end.call(this,body);resolve();}; });
  handler.handleRequest({method:'GET'},progress,'/api/server/storage');
  await received;
  assert.equal(progress.status,202); assert.equal(progress.body.scanning,true);
  finish({scanning:false,totalBytes:100});
  await new Promise(function (resolve) {setImmediate(resolve);});
  var completed=response();handler.handleRequest({method:'GET'},completed,'/api/server/storage');
  assert.equal(completed.status,200);assert.equal(completed.body.totalBytes,100);assert.equal(calls,1);
});
test('project dependencies are counted before shared data can consume an explicit test budget', async function (t) {
  var f=await fixture(t);
  var dependencies=path.join(f.root,'project','node_modules');
  await fs.mkdir(dependencies);await fs.writeFile(path.join(dependencies,'package.js'),Buffer.alloc(16384));
  var result=await scanStorage({configDir:f.root,attribution:'project',platform:process.platform,
    users:[{id:'a',username:'A'}],projects:[{path:dependencies,projectOwnerId:'a'}],maxEntries:2});
  assert.equal(result.users[0].files,1);assert.ok(result.users[0].bytes>=16384);assert.equal(result.partial,true);
});

test('native traversal matches fallback with nested roots, hard links and unusual names', async function (t) {
  var native = require('../lib/storage-native-walk');
  if (!await native.available()) return t.skip('GNU find is unavailable');
  var f = await fixture(t);
  var nested = path.join(f.root, 'project', 'nested[*?]\n\t');
  await fs.mkdir(nested);
  await fs.writeFile(path.join(nested, 'line\nwith\ttabs'), Buffer.alloc(4096));
  await fs.link(path.join(f.root, 'project', 'data'), path.join(nested, 'shared'));
  await fs.symlink(f.root, path.join(nested, 'cycle'));
  var options = { configDir: f.root, platform: process.platform, attribution: 'project', users: [{ id: 'a', username: 'A' }, { id: 'b', username: 'B' }],
    projects: [{ path: path.join(f.root, 'project'), projectOwnerId: 'a' }, { path: nested, projectOwnerId: 'b' }] };
  var fast = await scanStorage(options);
  var fallback = await scanStorage(Object.assign({}, options, { native: false }));
  delete fast.checkedAt; delete fallback.checkedAt;
  assert.deepEqual(fast, fallback);
});

test('native metadata parsing preserves filenames and rejects malformed fields', function () {
  var parse = require('../lib/storage-native-walk').parseRecord;
  var entry = parse('1\t20\t1001\t8\t2\tf\t/home/name\nwith\ttabs');
  assert.equal(entry.path, '/home/name\nwith\ttabs');
  assert.equal(entry.stat.uid, 1001);
  assert.equal(entry.stat.blocks * 512, 4096);
  assert.equal(entry.stat.isFile(), true);
  assert.throws(function () { parse('bad\tmetadata'); }, /Invalid/);
});

test('storage keeps completed results for five minutes and explicit refresh coalesces', async function () {
  var calls = 0; var finish;
  var handler = attachStorage({ isRequestAuthed: function () { return true; }, getMultiUserFromReq: function () { return null; },
    users: { isMultiUser: function () { return false; }, getAllUsers: function () { return []; } },
    scanStorage: function () { calls++; return new Promise(function (resolve) { finish = resolve; }); } });
  handler.handleRequest({ method: 'GET' }, response(), '/api/server/storage');
  finish({ totalBytes: 100 });
  await new Promise(function (resolve) { setImmediate(resolve); });
  var now = Date.now;
  var base = now();
  Date.now = function () { return base + 60000; };
  try {
    var cached = response();
    handler.handleRequest({ method: 'GET' }, cached, '/api/server/storage');
    assert.equal(cached.status, 200);
    assert.equal(calls, 1);
    handler.handleRequest({ method: 'GET' }, response(), '/api/server/storage?refresh=1');
    handler.handleRequest({ method: 'GET' }, response(), '/api/server/storage?refresh=1');
    assert.equal(calls, 2);
    var polling = response();
    handler.handleRequest({ method: 'GET' }, polling, '/api/server/storage');
    assert.equal(polling.status, 0);
    finish({ totalBytes: 200 });
    await new Promise(function (resolve) { setImmediate(resolve); });
    assert.equal(polling.body.totalBytes, 200);
  } finally { Date.now = now; }
});

test('native traversal does not recount a root already visited through its parent', async function (t) {
  if (!await require('../lib/storage-native-walk').available()) return t.skip('GNU find is unavailable');
  var f = await fixture(t);
  var options = { configDir: f.root, projectPaths: [f.root, path.join(f.root, 'project')], platform: 'linux',
    users: [{ id: 'a', username: 'A', linuxUser: 'a' }], resolveIdentity: async function () { return { uid: f.uid, home: f.root }; } };
  var fast = await scanStorage(options);
  var fallback = await scanStorage(Object.assign({}, options, { native: false }));
  delete fast.checkedAt; delete fallback.checkedAt;
  assert.deepEqual(fast, fallback);
  assert.equal(fast.totalFiles, 1);
  assert.equal(fast.users[0].bytes, fast.totalBytes);
});
