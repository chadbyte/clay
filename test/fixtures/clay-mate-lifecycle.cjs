var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
async function tick() { await new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  var count = 0, next = 0;
  function fresh() { var m = f.mates.createMate(f.mateCtx, { name: 'Lifecycle fixture' }); var p = f.make('mate-' + m.id, m); return { mate: m, project: p }; }
  async function inspect(item) { return f.call('inspect_mate_control', { mateId: item.mate.id }); }
  async function propose(item, action, patch) {
    var inspected = await inspect(item); assert.ok(inspected.targetToken, JSON.stringify(inspected));
    var args = { targetToken: inspected.targetToken, action: action, why: 'Apply the fixture owner request', requestId: 'mate-' + (++next) };
    if (patch !== undefined) args.patch = patch;
    var promise = f.call('control_mate_lifecycle', args); await tick();
    var ids = Object.keys(f.sourceSession.pendingAskUser || {});
    return { args: args, promise: promise, id: ids[ids.length - 1] };
  }
  async function apply(item, action, patch) { var p = await propose(item, action, patch); if (p.id) f.answer(p); return p.promise; }
  function cancel(p) { f.sourceSession.pendingAskUser[p.id].respond.cancel('Fixture stale review'); }
  var item = fresh(), foreign = f.mates.createMate(f.mates.buildMateCtx('foreign'), { name: 'Foreign' });
  var list = await f.call('list_owned_mates'); assert.ok(list.mates.some(function (m) { return m.mateId === item.mate.id; })); assert.equal(list.mates.some(function (m) { return m.mateId === foreign.id; }), false); count++;
  assert.equal((await f.call('inspect_mate_control', { mateId: foreign.id })).status, 'failed'); count++;
  var p = await propose(item, 'profile', { name: 'Reviewed Mate', bio: 'Reviewed introduction', workspaceColor: 'rose', avatarCatalogId: 'C02' });
  assert.notEqual(f.mates.getMate(f.mateCtx, item.mate.id).name, 'Reviewed Mate');
  var outsider = { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId };
  assert.equal(f.answer(p, outsider), false); assert.equal(f.answer(p, { readyState: 1, _clayUser: f.ws._clayUser, _clayActiveSession: f.sourceSession.localId }), false); count++;
  assert.equal(f.answer(p), true); var result = await p.promise; assert.equal(result.status, 'completed', JSON.stringify(result));
  var saved = f.mates.getMate(f.mateCtx, item.mate.id); assert.equal(saved.profile.displayName, 'Reviewed Mate'); assert.equal(saved.bio, 'Reviewed introduction'); assert.equal(saved.workspaceColor, 'rose'); assert.equal(saved.profile.avatarCatalogId, 'C02'); count++;
  var savedProfileRequest = p.args;
  assert.equal(f.answer(p), false); assert.deepEqual(await f.call('control_mate_lifecycle', p.args), result); count++;
  assert.equal((await f.call('control_mate_lifecycle', Object.assign({}, p.args, { patch: { name: 'Replayed' } }))).status, 'failed'); count++;
  p = await propose(item, 'profile', { name: 'Rejected' }); f.answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal(f.mates.getMate(f.mateCtx, item.mate.id).name, 'Reviewed Mate'); count++;
  p = await propose(item, 'profile', { name: 'Stale' }); f.mates.updateMate(f.mateCtx, item.mate.id, { bio: 'Newer' }); assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  var targetSession = item.project.sm.createSessionRaw({ ownerId: 'owner' });
  p = await propose(item, 'delete'); targetSession.title = 'Changed during review'; assert.equal(f.answer(p), false); cancel(p); await p.promise; count++;
  for (var change of ['foreign', 'generation', 'stop', 'shared', 'owner', 'registry']) {
    p = await propose(item, 'profile', { bio: 'Guarded' });
    var oldGeneration = f.sourceSession._sdkQueryGeneration, registry = f.mates.loadMates(f.mateCtx);
    if (change === 'foreign') f.sourceSession._mcpForeignInput = true;
    if (change === 'generation') f.sourceSession._sdkQueryGeneration++;
    if (change === 'stop') f.sourceSession.taskStopRequested = true;
    if (change === 'shared') f.sourceSession.sessionVisibility = 'shared';
    if (change === 'owner') targetSession.ownerId = 'foreign';
    if (change === 'registry') f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.filter(function (m) { return m.id !== f.clay.id; }) }));
    assert.equal(f.answer(p), false, change); cancel(p); await p.promise;
    f.sourceSession._mcpForeignInput = false; f.sourceSession._sdkQueryGeneration = oldGeneration; f.sourceSession.taskStopRequested = false; f.sourceSession.sessionVisibility = 'private'; targetSession.ownerId = 'owner';
    if (change === 'registry') f.mates.saveMates(f.mateCtx, registry);
    count++;
  }
  for (var patch of [{ createdBy: 'foreign' }, { model: 'bad' }, { profile: {} }, { avatarCatalogId: 'bad' }, { workspaceColor: 'bad' }]) {
    result = await apply(item, 'profile', patch); assert.equal(result.status, 'failed'); count++;
  }
  var canonical = { mate: f.clay }; assert.equal((await apply(canonical, 'delete')).status, 'failed'); count++;
  for (var project of [f.target, f.make('ordinary-mate-denied', f.mates.createMate(f.mateCtx, { name: 'Ordinary' }))]) {
    var session = project.sm.createSessionRaw({ ownerId: 'owner' }); session._sdkQueryGeneration = 1;
    assert.equal((await project.getMcpBridgeHandler(session.localId, true, 1).listTools()).some(function (t) { return t.name === 'control_mate_lifecycle'; }), false); count++;
  }
  var attached = require('../../lib/project-workspace-query').attachProjectWorkspaceQuery({ service: f.workspace, controlService: f.controls, sm: f.source.sm, projectSlug: 'clay-source', getProjectOwnerId: function () { return 'owner'; }, isMate: true, mateId: f.clay.id });
  var native = attached.createMcpServer(f.yoke.createAdapters().adapters.claude, f.sourceSession).tools;
  var dynamic = attached.getDynamicToolDefs(f.sourceSession), resumed = attached.getBridgeTools(f.sourceSession, function (v) { return v; });
  ['list_owned_mates', 'inspect_mate_control', 'control_mate_lifecycle'].forEach(function (name) {
    [native, dynamic, resumed].forEach(function (tools) { assert.ok(tools.some(function (tool) { return tool.name === name; })); });
    assert.ok(require('../../lib/claude-hook-installer').CLAY_MANAGED_ALLOW.includes('mcp__clay-workspace__' + name));
    assert.equal(f.source.sdk.checkToolWhitelist('mcp__clay-workspace__' + name, {}).behavior, 'allow');
  }); count++;
  var inactive = fresh(), pendingSession = inactive.project.sm.createSessionRaw({ ownerId: 'owner' }); pendingSession.isProcessing = true;
  assert.equal((await apply(inactive, 'delete')).status, 'failed'); assert.equal(f.mates.getMate(f.mateCtx, inactive.mate.id).lifecycleDeletion, undefined); pendingSession.isProcessing = false; count++;
  var originalRegistry = f.mates.loadMates(f.mateCtx);
  p = await propose(item, 'profile', { bio: 'Foreign target' });
  f.mates.saveMates(f.mateCtx, Object.assign({}, originalRegistry, { mates: originalRegistry.mates.map(function (m) { return m.id === item.mate.id ? Object.assign({}, m, { createdBy: 'foreign' }) : m; }) }));
  assert.equal(f.answer(p), false);
  assert.equal((await f.call('control_mate_lifecycle', savedProfileRequest)).status, 'failed');
  cancel(p); await p.promise; f.mates.saveMates(f.mateCtx, originalRegistry); count++;
  var origin = f.mates.getMate(f.mateCtx, item.mate.id);
  var registryFile = path.join(path.dirname(f.mates.getMateDir(f.mateCtx, item.mate.id)), 'mates.json');
  p = await propose(item, 'profile', { name: 'Disk failure' });
  fs.mkdirSync(registryFile + '.tmp'); f.answer(p); result = await p.promise; fs.rmdirSync(registryFile + '.tmp');
  assert.equal(result.status, 'failed'); assert.equal(f.mates.getMate(f.mateCtx, item.mate.id).name, origin.name); count++;
  var persistence = fresh(); p = await propose(persistence, 'delete');
  fs.mkdirSync(registryFile + '.tmp'); f.answer(p); result = await p.promise; fs.rmdirSync(registryFile + '.tmp');
  assert.equal(result.status, 'failed'); assert.equal(result.persisted, false); assert.ok(f.projects.has('mate-' + persistence.mate.id)); assert.equal(f.mates.getMate(f.mateCtx, persistence.mate.id).lifecycleDeletion, undefined); count++;
  var proof = fresh();
  f.fixtureAdapters.get(proof.project).codex.shutdown = function () { fs.mkdirSync(registryFile + '.tmp'); };
  result = await apply(proof, 'delete'); fs.rmdirSync(registryFile + '.tmp');
  assert.equal(result.status, 'failed'); assert.equal(result.runtimeClosed, true); assert.ok(f.mates.getMate(f.mateCtx, proof.mate.id).lifecycleDeletion); count++;
  // A reload or late cleanup without durable proof cannot claim deletion complete.
  result = await apply(proof, 'delete'); assert.equal(result.status, 'failed'); assert.match(result.error, /proof is unavailable/); assert.ok(fs.existsSync(f.mates.getMateDir(f.mateCtx, proof.mate.id))); count++;
  var events = [], foreignEvents = [];
  var ownerViewer = { readyState: 1, _clayUser: f.ws._clayUser, send: function (data) { events.push(JSON.parse(data)); } };
  var foreignViewer = { readyState: 1, _clayUser: outsider._clayUser, send: function (data) { foreignEvents.push(JSON.parse(data)); } };
  f.source.clients.add(ownerViewer); f.source.clients.add(foreignViewer);
  result = await apply(item, 'profile', { bio: 'Broadcast profile' }); assert.equal(result.status, 'completed'); assert.ok(events.some(function (e) { return e.type === 'mate_updated'; })); assert.equal(foreignEvents.length, 0); count++;
  // Exercise the shared human handler as well as the canonical tool.
  f.handler.handleMessage(f.ws, { type: 'mate_update', mateId: item.mate.id, updates: { bio: 'Human profile' }, requestId: 'human-profile' }); assert.equal(f.mates.getMate(f.mateCtx, item.mate.id).bio, 'Human profile'); count++;
  // Only the external adapter transport fails; production destroy/remove paths remain authoritative.
  var failed = fresh(); f.fixtureAdapters.get(failed.project).codex.shutdown = function () { throw new Error('Fixture provider cleanup failed'); };
  result = await apply(failed, 'delete'); assert.equal(result.status, 'failed'); assert.equal(result.runtimeClosed, false); assert.equal(result.deletionPending, true); assert.ok(f.projects.has('mate-' + failed.mate.id)); count++;
  var paused = failed.project.sm.createSessionRaw({ ownerId: 'owner' });
  assert.equal(await failed.project.sdk.startQuery(paused, 'Must remain paused'), false); count++;
  assert.throws(function () { f.handler.lifecycle.update('owner', failed.mate.id, { bio: 'Cannot edit while deleting' }); }, /pending/); count++;
  assert.throws(function () { f.handler.lifecycle.update('owner', item.mate.id, { lifecycleDeletion: { runtimeClosed: true } }); }, /server-managed/); count++;
  f.fixtureAdapters.get(failed.project).codex.shutdown = function () {};
  result = await apply(failed, 'delete'); assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(f.mates.getMate(f.mateCtx, failed.mate.id), null); count++;
  // Hold external cleanup so source authorization can change before directory deletion.
  var held = fresh(), release;
  f.fixtureAdapters.get(held.project).codex.shutdown = function () { return new Promise(function (resolve) { release = resolve; }); };
  p = await propose(held, 'delete'); f.answer(p); await tick(); f.sourceSession._mcpForeignInput = true; release();
  result = await p.promise; f.sourceSession._mcpForeignInput = false; assert.equal(result.status, 'failed'); assert.equal(result.runtimeClosed, true); assert.ok(fs.existsSync(f.mates.getMateDir(f.mateCtx, held.mate.id))); count++;
  f.fixtureAdapters.get(held.project).codex.shutdown = function () {};
  assert.equal((await apply(held, 'delete')).status, 'completed'); count++;
  var cleanup = fresh();
  p = await propose(cleanup, 'delete'); var dir = f.mates.getMateDir(f.mateCtx, cleanup.mate.id);
  fs.chmodSync(dir, 0o500);
  try { f.answer(p); result = await p.promise; } finally { fs.chmodSync(dir, 0o700); }
  assert.equal(result.status, 'failed'); assert.equal(result.runtimeClosed, true); assert.equal(result.deletionPending, true); assert.ok(fs.existsSync(dir)); count++;
  assert.deepEqual(await f.call('control_mate_lifecycle', p.args), result); count++;
  result = await apply(cleanup, 'delete'); assert.equal(result.status, 'completed'); assert.equal(fs.existsSync(dir), false); count++;
  var timeout = fresh(), releaseTimeout;
  f.fixtureAdapters.get(timeout.project).codex.shutdown = function () { return new Promise(function (resolve) { releaseTimeout = resolve; }); };
  result = await apply(timeout, 'delete'); assert.equal(result.status, 'failed'); assert.match(result.error, /timed out/); assert.equal(result.runtimeClosed, false); assert.ok(f.mates.getMate(f.mateCtx, timeout.mate.id).lifecycleDeletion); count++;
  releaseTimeout(); await tick();
  result = await apply(timeout, 'delete'); assert.equal(result.status, 'failed'); assert.match(result.error, /proof is unavailable/); count++;
  var interrupted = fresh(), interruptedRelease;
  f.fixtureAdapters.get(interrupted.project).codex.shutdown = function () { return new Promise(function (resolve) { interruptedRelease = resolve; }); };
  var concurrent = interrupted.project.sm.createSessionRaw({ ownerId: 'owner' });
  p = await propose(interrupted, 'delete'); f.answer(p); await tick(); concurrent.ownerId = 'foreign'; interruptedRelease(); result = await p.promise;
  assert.equal(result.status, 'failed'); assert.equal(result.runtimeClosed, true); assert.ok(fs.existsSync(f.mates.getMateDir(f.mateCtx, interrupted.mate.id))); count++;
  var badObserver = { readyState: 1, _clayUser: f.ws._clayUser, send: function (data) { if (JSON.parse(data).type === 'mate_updated') throw new Error('Fixture publication unavailable'); } };
  f.source.clients.add(badObserver);
  result = await apply(item, 'profile', { bio: 'Persisted before publication failure' }); f.source.clients.delete(badObserver);
  assert.equal(result.status, 'failed'); assert.equal(result.persisted, true); assert.equal(f.mates.getMate(f.mateCtx, item.mate.id).bio, 'Persisted before publication failure'); count++;
  p = await propose(item, 'delete'); f.answer(p); result = await p.promise; assert.equal(result.status, 'completed', JSON.stringify(result)); assert.equal(result.runtimeClosed, true); assert.equal(f.projects.has('mate-' + item.mate.id), false); assert.equal(f.mates.getMate(f.mateCtx, item.mate.id), null); assert.ok(events.some(function (e) { return e.type === 'mate_deleted'; })); assert.equal(foreignEvents.length, 0); count++;
  assert.deepEqual(await f.call('control_mate_lifecycle', p.args), result); count++;
  console.log(count + ' production Mate lifecycle scenarios passed');
}
module.exports = { run: run };
