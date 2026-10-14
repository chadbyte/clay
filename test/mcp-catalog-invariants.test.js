var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var spawn = require('child_process').spawn;
var createStore = require('../lib/mcp-connection-store').createConnectionStore;
var attachMcp = require('../lib/project-mcp').attachMcp;
function rootFor(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mcp-invariants-'));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  return root;
}
function remote(id) { return { id: id, source: 'url', url: 'https://example.com/' + id, enabled: true }; }
test('remote snapshots delete subsets; repeated project saves preserve exactly one foreign computer row', function (t) {
  var root = rootFor(t), a = createStore(root, 'a', { shared: true }), b = createStore(root, 'b', { shared: true });
  a.save('owner', [remote('r1'), remote('r2'), { id: 'local', source: 'computer', name: 'editor', enabled: true }]);
  var aSnapshot = a.snapshot('owner');
  a.save('owner', aSnapshot.records.filter(function (row) { return row.id !== 'r1'; }), aSnapshot.revision);
  assert.equal(a.load('owner').some(function (row) { return row.id === 'r1'; }), false);
  b.load('owner');
  b.save('owner', []); b.save('owner', []);
  var restarted = createStore(root, 'a', { shared: true }).load('owner');
  assert.equal(restarted.length, 1); assert.equal(restarted[0].name, 'editor');
  assert.deepEqual(b.load('owner'), []);
});
test('legacy computer rows survive and deleted remote rows cannot resurrect from another project migration', function (t) {
  var root = rootFor(t), legacyA = createStore(root, 'a'), legacyB = createStore(root, 'b');
  var computer = { id: 'local', source: 'computer', name: 'editor', enabled: true };
  legacyA.save('owner', [remote('r1'), computer]); legacyB.save('owner', [remote('r1'), computer]);
  assert.deepEqual(legacyA.load('owner'), [remote('r1'), computer]);
  var a = createStore(root, 'a', { shared: true }); a.load('owner'); a.save('owner', []);
  var b = createStore(root, 'b', { shared: true });
  assert.deepEqual(b.load('owner'), [Object.assign({}, computer, { project: 'b' })]);
  b.save('owner', []); assert.deepEqual(createStore(root, 'b', { shared: true }).load('owner'), []);
});
test('stale snapshots, duplicates and foreign project rows fail without altering the committed snapshot', function (t) {
  var root = rootFor(t), a = createStore(root, 'a', { shared: true }), b = createStore(root, 'b', { shared: true });
  a.save('owner', [remote('r1')]); b.load('owner');
  var old = a.snapshot('owner'); b.save('owner', [remote('r2')]);
  assert.throws(function () { a.save('owner', old.records, old.revision); }, /changed/);
  assert.throws(function () { a.save('owner', [remote('r2'), remote('r2')]); }, /Duplicate/);
  assert.throws(function () { a.save('owner', [{ id: 'c', source: 'computer', name: 'x', project: 'b' }]); }, /Foreign/);
  assert.deepEqual(a.load('owner'), [remote('r2')]);
});
test('independent processes cannot both commit the same revision', async function (t) {
  var root = rootFor(t), store = createStore(root, 'a', { shared: true });
  store.save('owner', [remote('initial')]);
  var revision = store.snapshot('owner').revision;
  var script = "var store = require(process.argv[1]).createConnectionStore(process.argv[2], 'a', {shared:true}); try { store.save('owner', [{id:process.argv[4],source:'url',url:'https://example.com/'+process.argv[4]}], process.argv[3]); } catch(error) { if (!/changed|busy/.test(error.message)) throw error; process.exitCode=2; }";
  function writer(id) {
    return new Promise(function (resolve, reject) {
      var child = spawn(process.execPath, ['-e', script, path.resolve('lib/mcp-connection-store.js'), root, revision, id]);
      var errors = ''; child.stderr.on('data', function (data) { errors += data; });
      child.on('error', reject); child.on('exit', function (code) { if (code === 0 || code === 2) resolve(code); else reject(new Error(errors)); });
    });
  }
  var exits = await Promise.all([writer('one'), writer('two')]);
  assert.deepEqual(exits.sort(), [0, 2]); assert.equal(store.load('owner').length, 1);
});

test('production-shaped source routing supports Mate calls and enforces source socket/root/owner authorization', async function (t) {
  var root = rootFor(t), otherRoot = rootFor(t), sends = [];
  var sourceWs = { readyState: 1, _clayUser: { id: 'owner' } }, mateWs = { readyState: 1, _clayUser: { id: 'owner' } };
  var sourceAllowed = true, ownerAllowed = true;
  var session = { localId: 1, ownerId: 'owner', mode: 'gui', history: [] };
  var replacement = { readyState: 1, _clayUser: { id: 'owner' } };
  function manager(slug, storageRoot, sockets) {
    var sessions = new Map([[1, session]]);
    return attachMcp({ root: storageRoot, slug: slug, clients: sockets, isMultiUser: function () { return true; },
      canAccess: function (ws) { return sockets.has(ws) && (slug !== 'source' || sourceAllowed) && ws._clayUser.id === 'owner'; },
      canUseOwner: function (owner) { return owner === 'owner' && (slug !== 'source' || ownerAllowed); },
      canUseSession: function (value) { return sessions.get(value.localId) === value && value.ownerId === 'owner' && require('../lib/mcp-session-access').canUsePersonalConnections(value, sessions); },
      getEnabledMcpServers: function () { return []; }, identity: function () {}, extensionId: function () { return slug; },
      sendTo: function (ws, msg) { sends.push({ slug: slug, ws: ws, msg: Object.assign({ slug: slug }, msg) }); } });
  }
  var sockets = new Set([sourceWs, replacement]), source = manager('source', root, sockets), mate = manager('mate', root, new Set([mateWs]));
  var isolated = manager('isolated', otherRoot, new Set([mateWs]));
  t.after(function () { source.destroy(); mate.destroy(); isolated.destroy(); });
  function register(ws) { source.handleMcpMessage(ws, { type: 'mcp_servers_available', hostConnected: true, servers: [{ name: 'local', enabled: true, tools: [{ name: 'echo', inputSchema: { type: 'object' } }] }] }); }
  register(sourceWs); mate.handleMcpMessage(mateWs, { type: 'mcp_toggle_server', name: 'local', enabled: true });
  assert.deepEqual(isolated.getMcpServers(session), {});
  var tool = mate.getMcpServers(session).local.instance._registeredTools.echo;
  var invoke = tool.handler || tool.callback;
  var call = invoke({}); var request = sends.find(function (row) { return row.msg.type === 'mcp_tool_call'; });
  assert.equal(request.slug, 'source'); assert.equal(request.msg.slug, 'source'); assert.equal(request.ws, sourceWs);
  source.handleMcpMessage(sourceWs, { type: 'mcp_tool_result', callId: request.msg.callId, result: { content: [] } }); await call;
  sourceAllowed = false; await assert.rejects(invoke({}), /unavailable/); sourceAllowed = true;
  var revoked = invoke({}); var rejected = assert.rejects(revoked, /changed/);
  ownerAllowed = false; request = sends.filter(function (row) { return row.msg.type === 'mcp_tool_call'; }).pop();
  source.handleMcpMessage(sourceWs, { type: 'mcp_tool_result', callId: request.msg.callId, result: { content: [] } });
  await rejected; ownerAllowed = true;
  sourceAllowed = true; register(sourceWs);
  var replaced = invoke({}); var replacementRejection = assert.rejects(replaced, /disconnected/); register(replacement); await replacementRejection;
  sockets.delete(replacement); await assert.rejects(invoke({}), /unavailable/);
});
