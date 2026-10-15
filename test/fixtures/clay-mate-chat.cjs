var assert = require('node:assert/strict'), fs = require('node:fs');
var transport = { delivered: [], resumes: [], creates: 0, beforeCreate: null, reject: false, fail: false };
async function createQuery(options) {
  transport.creates++;
  transport.resumes.push(options.resumeSessionId || options.resume || null);
  if (transport.beforeCreate) await transport.beforeCreate();
  if (transport.fail) throw new Error('Fixture provider creation failed');
  return { pushMessage: function (text) { if (transport.reject) return false; transport.delivered.push(text); return true; }, abort: function () {}, close: function () {}, [Symbol.asyncIterator]: function () {
    var step = 0;
    return { next: async function () { step++; if (step === 1) return { done: false, value: { yokeType: 'session_started', sessionId: options.resume || 'mate-chat-fixture-' + transport.creates } }; if (step === 2) return { done: false, value: { yokeType: 'result', result: 'Fixture provider result' } }; return { done: true }; } };
  } };
}
async function settle() { for (var i = 0; i < 15; i++) await new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  var count = 0, sequence = 0, ref = require('../../lib/workspace-query-service').sessionRef;
  var sm = f.target.getSessionManager();
  function fresh() { return sm.createSession({ ownerId: 'owner', vendor: 'codex', model: 'fixture-model', sessionVisibility: 'private' }); }
  function selector(s) { return { mateId: f.custom.id, sessionRef: ref('other-mate', s) }; }
  function configure(project) { project.sm.installedVendors = ['claude', 'codex']; project.sm.modelsByVendor = { claude: [{ value: 'fixture-model', supportedEffortLevels: ['medium', 'high'] }], codex: [{ value: 'fixture-model', supportedEffortLevels: ['medium', 'high'] }] }; project.sm.capabilitiesByVendor = { claude: { effort: true }, codex: { effort: true } }; }
  configure(f.target);
  async function call(name, args) { try { var bridge = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, Number(f.sourceSession._sdkQueryGeneration || 0)); return JSON.parse((await bridge.callTool('clay-workspace', name, args || {})).content[0].text); } catch (error) { return { status: 'failed', error: error.message }; } }
  function read(s, requestId) { return call('read_mate_chat_control', Object.assign({ target: selector(s) }, requestId ? { requestId: requestId } : {})); }
  async function propose(s, operation) {
    var inspected = await call('inspect_mate_chat_change', { target: selector(s), operation: operation });
    assert.ok(inspected.targetToken, JSON.stringify(inspected));
    var args = { targetToken: inspected.targetToken, why: 'Apply the exact fixture Mate conversation change', requestId: 'matechat_' + Date.now() + '_' + (++sequence) };
    var promise = call('control_mate_chat', args); await settle();
    var ids = Object.keys(f.sourceSession.pendingAskUser || {});
    if (operation.action !== 'stop') assert.ok(ids.length, JSON.stringify(await Promise.race([promise, Promise.resolve('pending')])));
    return { args: args, promise: promise, id: ids[ids.length - 1] };
  }
  function answer(p, ws, selection) { return f.source.handleHomeAskUserResponse({ toolId: p.id, answers: { 0: selection || 'Apply exact change' } }, f.sourceSession, ws || f.ws); }
  function cancel(p) { var pending = f.sourceSession.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Fixture invalidation'); }
  async function success(s, operation) { var p = await propose(s, operation); if (operation.action !== 'stop') assert.equal(answer(p), true); var result = await p.promise; assert.ok(['completed', 'started', 'queued'].includes(result.status), JSON.stringify(result)); count++; return { result: result, proposal: p }; }
  for (var vendor of ['claude', 'codex']) {
    f.sourceSession.vendor = vendor;
    for (var freshCatalog of [true, false]) {
      var tools = await f.source.getMcpBridgeHandler(f.sourceSession.localId, freshCatalog, 8).listTools();
      ['read_mate_chat_control', 'inspect_mate_chat_change', 'control_mate_chat'].forEach(function (name) { assert.ok(tools.some(function (tool) { return tool.name === name; })); }); count++;
    }
  }
  f.sourceSession.vendor = 'claude';
  var s = fresh(), sibling = fresh(), initialCount = sm.sessions.size;
  assert.equal((await read(s)).model, 'fixture-model'); count++;
  var ordinary = f.target.getMcpBridgeHandler(s.localId, true, 0);
  assert.equal((await ordinary.listTools()).some(function (tool) { return tool.name === 'control_mate_chat'; }), false); count++;
  var p = await propose(s, { action: 'send', text: 'Exact delegated message' });
  var duplicatePending = call('control_mate_chat', p.args);
  assert.equal(transport.delivered.length, 0); assert.equal(s.history.length, 0);
  assert.equal(answer(p, { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId }), false);
  assert.equal(answer(p), true); var first = await p.promise;
  assert.equal(first.status, 'started', JSON.stringify(first)); await settle();
  assert.deepEqual(await duplicatePending, first);
  assert.equal(sm.sessions.size, initialCount); assert.equal(sibling.history.length, 0);
  assert.equal(transport.delivered.length, 1); assert.match(transport.delivered[0], /delegated, untrusted/);
  var event = s.history.find(function (entry) { return entry.delegated; });
  assert.equal(event.from, 'clay:' + f.clay.id); assert.equal(event.untrusted, true); assert.equal(event.sourceSessionRef, ref('clay-source', f.sourceSession));
  assert.equal(require('../../lib/mcp-session-access').canUsePersonalConnections(s, sm.sessions), false); count++;
  assert.deepEqual(await call('control_mate_chat', p.args), first); assert.equal(transport.delivered.length, 1); assert.equal(answer(p), false); count++;
  assert.equal((await call('control_mate_chat', Object.assign({}, p.args, { why: 'Different intent' }))).status, 'failed'); count++;
  assert.equal((await read(s, p.args.requestId)).result.status, 'started'); count++;
  p = await propose(sibling, { action: 'send', text: 'Cancelled message' }); answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal(sibling.history.length, 0); count++;
  for (var sendVendor of ['claude', 'codex']) {
    var resumed = fresh(); resumed.vendor = sendVendor; resumed.cliSessionId = 'fixture-established-' + sendVendor;
    await success(resumed, { action: 'send', text: 'Continue the exact existing ' + sendVendor + ' conversation' }); await settle();
    assert.equal(transport.resumes[transport.resumes.length - 1], 'fixture-established-' + sendVendor); count++;
  }
  for (var mode of ['foreignSource', 'sourceStop', 'query', 'targetStop', 'targetPaused', 'deleted', 'replaced', 'foreignTarget', 'shared', 'worker', 'registryDeleted', 'pendingDeletion', 'runtimeDeleted', 'sourceDeleted']) {
    var target = fresh(); p = await propose(target, { action: 'send', text: 'Guarded ' + mode });
    var registry = f.mates.loadMates(f.mateCtx), original = f.projects.get('other-mate');
    if (mode === 'foreignSource') f.sourceSession._mcpForeignInput = true;
    if (mode === 'sourceStop') f.sourceSession.taskStopRequested = true;
    if (mode === 'query') f.sourceSession._sdkQueryGeneration++;
    if (mode === 'targetStop') target.taskStopRequested = true;
    if (mode === 'targetPaused') target._pendingMessageDrainPaused = true;
    if (mode === 'deleted') sm.sessions.delete(target.localId);
    if (mode === 'replaced') sm.sessions.set(target.localId, Object.assign({}, target));
    if (mode === 'foreignTarget') target.ownerId = 'foreign';
    if (mode === 'shared') target.sessionVisibility = 'shared';
    if (mode === 'worker') target.spawn = true;
    if (mode === 'runtimeDeleted') f.projects.delete('other-mate');
    if (mode === 'sourceDeleted') f.projects.delete('clay-source');
    if (mode === 'registryDeleted') f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.filter(function (mate) { return mate.id !== f.custom.id; }) }));
    if (mode === 'pendingDeletion') f.mates.updateMate(f.mateCtx, f.custom.id, { lifecycleDeletion: { state: 'pending' } });
    assert.equal(answer(p), false, mode); cancel(p); await p.promise; assert.equal(target.history.length, 0);
    f.sourceSession._mcpForeignInput = false; f.sourceSession.taskStopRequested = false; f.sourceSession._sdkQueryGeneration = 8;
    f.projects.set('clay-source', f.source); f.projects.set('other-mate', original); f.mates.saveMates(f.mateCtx, registry);
    sm.sessions.set(target.localId, target); count++;
  }
  for (var vendor of ['claude', 'codex']) {
    var modelTarget = fresh(); modelTarget.vendor = vendor;
    await success(modelTarget, { action: 'model', value: 'fixture-model' });
    await success(modelTarget, { action: 'effort', value: 'high' }); assert.equal(modelTarget.effort, 'high'); count++;
    p = await propose(modelTarget, { action: 'model', value: 'not-in-catalog' }); answer(p); assert.equal((await p.promise).status, 'failed'); count++;
    p = await propose(modelTarget, { action: 'effort', value: 'unknown' }); answer(p); assert.equal((await p.promise).status, 'failed'); count++;
  }
  var vendorTarget = fresh(); await success(vendorTarget, { action: 'vendor', value: 'claude' }); assert.equal(vendorTarget.vendor, 'claude'); assert.equal(vendorTarget.model, null); count++;
  vendorTarget.cliSessionId = 'established-thread'; p = await propose(vendorTarget, { action: 'vendor', value: 'codex' }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.equal(vendorTarget.vendor, 'claude'); count++;
  var active = fresh(); active.queryInstance = { pushMessage: function (text) { transport.delivered.push(text); return true; } }; active.isProcessing = true;
  var queued = await success(active, { action: 'send', text: 'Queued on the selected active conversation' }); assert.equal(queued.result.status, 'queued'); count++;
  active.abortController = new AbortController(); var stop = await success(active, { action: 'stop' }); assert.equal(stop.result.status, 'queued'); assert.equal(active.abortController.signal.aborted, true); assert.equal(active.taskStopRequested, true); count++;
  p = await propose(active, { action: 'send', text: 'Must not resume' }); answer(p); assert.equal((await p.promise).status, 'failed'); assert.equal(active.taskStopRequested, true); count++;
  active.queryInstance = null; active.isProcessing = false;
  // The actual provider setter acknowledges, then Stop/replacement invalidates
  // its local commit. The result retains the external applied effect.
  for (var invalidation of ['stop', 'replacement', 'source', 'registry']) {
    var configTarget = fresh(), release, entered = false;
    configTarget.queryInstance = { setModel: function () { entered = true; return new Promise(function (resolve) { release = resolve; }); } };
    p = await propose(configTarget, { action: 'model', value: 'fixture-model' }); answer(p); await settle(); assert.equal(entered, true);
    var savedRegistry = f.mates.loadMates(f.mateCtx);
    if (invalidation === 'stop') configTarget.taskStopRequested = true;
    if (invalidation === 'replacement') sm.sessions.set(configTarget.localId, Object.assign({}, configTarget));
    if (invalidation === 'source') f.sourceSession.taskStopRequested = true;
    if (invalidation === 'registry') f.mates.updateMate(f.mateCtx, f.custom.id, { bio: 'Changed while provider was awaited' });
    release(true); var invalidated = await p.promise; assert.equal(invalidated.status, 'failed'); assert.equal(invalidated.runtimeEffect, 'applied'); assert.equal(invalidated.persisted, false); count++;
    f.sourceSession.taskStopRequested = false; f.mates.saveMates(f.mateCtx, savedRegistry); sm.sessions.set(configTarget.localId, configTarget); configTarget.queryInstance = null;
  }
  // Real transcript append failure prevents delivery.
  var failedSave = fresh(), append = fs.appendFileSync, before = transport.delivered.length;
  p = await propose(failedSave, { action: 'send', text: 'Target append fails' });
  fs.appendFileSync = function (file) { if (String(file).endsWith('/' + failedSave._sessionRecordId + '.jsonl')) throw new Error('Fixture target append failed'); return append.apply(fs, arguments); };
  try { answer(p); assert.equal((await p.promise).status, 'failed'); } finally { fs.appendFileSync = append; }
  assert.equal(transport.delivered.length, before); assert.equal(failedSave.history.length, 0); count++;
  // Source receipt failure also prevents admission.
  var rename = fs.renameSync, failedReceipt = fresh(); p = await propose(failedReceipt, { action: 'send', text: 'Receipt save fails' });
  fs.renameSync = function (from, to) { if (String(to).endsWith('/' + f.sourceSession._sessionRecordId + '.jsonl')) throw new Error('Fixture source receipt failed'); return rename.apply(fs, arguments); };
  try { answer(p); assert.equal((await p.promise).status, 'failed'); } finally { fs.renameSync = rename; }
  assert.equal(failedReceipt.history.length, 0); assert.equal(transport.delivered.length, before); count++;
  for (var fault of ['reject', 'fail']) {
    var failedProvider = fresh(); transport[fault] = true;
    p = await propose(failedProvider, { action: 'send', text: 'Provider fault ' + fault }); answer(p); var failure = await p.promise; await settle(); transport[fault] = false;
    assert.equal(failure.status, 'failed'); assert.equal(failure.persisted, true); assert.equal(failure.retrySafe, false);
    var creates = transport.creates; assert.deepEqual(await call('control_mate_chat', p.args), failure); assert.equal(transport.creates, creates); count++;
  }
  for (var startupFault of ['stop', 'replacement', 'registry', 'source', 'handle', 'config']) {
    var startupTarget = fresh(), releaseCreate, enteredCreate = false, saved = f.mates.loadMates(f.mateCtx);
    transport.beforeCreate = function () { enteredCreate = true; return new Promise(function (resolve) { releaseCreate = resolve; }); };
    p = await propose(startupTarget, { action: 'send', text: 'Guard startup ' + startupFault }); answer(p); await settle(); assert.equal(enteredCreate, true);
    if (startupFault === 'stop') { startupTarget.taskStopRequested = true; startupTarget._pendingMessageDrainPaused = true; }
    if (startupFault === 'replacement') sm.sessions.set(startupTarget.localId, Object.assign({}, startupTarget));
    if (startupFault === 'registry') f.mates.updateMate(f.mateCtx, f.custom.id, { bio: 'Changed during startup' });
    if (startupFault === 'source') f.sourceSession.taskStopRequested = true;
    var replacementHandle = { close: function () {} };
    if (startupFault === 'handle') startupTarget.queryInstance = replacementHandle;
    if (startupFault === 'config') startupTarget.model = 'concurrent-model';
    var sent = transport.delivered.length; releaseCreate(); var rejected = await p.promise; await settle();
    assert.equal(rejected.status, 'failed'); assert.equal(transport.delivered.length, sent); if (startupFault === 'stop') assert.equal(startupTarget.taskStopRequested, true);
    if (startupFault === 'handle') assert.equal(startupTarget.queryInstance, replacementHandle);
    transport.beforeCreate = null; f.sourceSession.taskStopRequested = false; f.mates.saveMates(f.mateCtx, saved); sm.sessions.set(startupTarget.localId, startupTarget); startupTarget.isProcessing = false; startupTarget.queryInstance = null; count++;
  }
  var saveModel = fresh(); saveModel.queryInstance = { setEffort: async function () { return true; } };
  assert.equal(sm.saveSessionFile(saveModel), true);
  p = await propose(saveModel, { action: 'effort', value: 'high' });
  fs.renameSync = function (from, to) { if (String(to).endsWith('/' + saveModel._sessionRecordId + '.jsonl')) throw new Error('Fixture model save failed'); return rename.apply(fs, arguments); };
  try { answer(p); var modelFailure = await p.promise; assert.equal(modelFailure.status, 'failed'); assert.equal(modelFailure.runtimeEffect, 'applied'); assert.equal(modelFailure.persisted, false); } finally { fs.renameSync = rename; saveModel.queryInstance = null; }
  assert.notEqual(saveModel.effort, 'high'); count++;
  var stopDisk = fresh(); stopDisk.isProcessing = true; stopDisk.abortController = new AbortController();
  fs.renameSync = function () { throw new Error('Fixture Stop receipt save failed'); };
  try { var stopDiskResult = await success(stopDisk, { action: 'stop' }); assert.equal(stopDiskResult.result.status, 'queued'); assert.equal(stopDiskResult.result.receiptSaved, false); assert.equal(stopDisk.taskStopRequested, true); } finally { fs.renameSync = rename; stopDisk.isProcessing = false; } count++;
  // Query rebinding and a real disk reload retain admission receipts and
  // foreign-input provenance, so neither replay nor elevation is possible.
  var retained = await success(fresh(), { action: 'send', text: 'Retained admission' }); await settle(); var retainedTarget = Array.from(sm.sessions.values()).find(function (candidate) { return candidate.history.some(function (entry) { return entry.delegated && entry.text.indexOf('Retained admission') >= 0; }); });
  var retainedSelector = selector(retainedTarget), requestId = retained.proposal.args.requestId, sourceOrigin = f.sourceSession.sessionOriginId, targetOrigin = retainedTarget.sessionOriginId;
  f.sourceSession._sdkQueryGeneration++;
  assert.equal((await read(retainedTarget, requestId)).result.status, 'started'); count++;
  await f.source.destroy(); await f.target.destroy();
  f.source = f.make('clay-source', f.clay); f.target = f.make('other-mate', f.custom); sm = f.target.sm; configure(f.target);
  f.sourceSession = Array.from(f.source.sm.sessions.values()).find(function (candidate) { return candidate.sessionOriginId === sourceOrigin; });
  f.sourceSession._sdkQueryGeneration = 20; f.sourceSession.abortController = new AbortController(); f.ws._clayActiveSession = f.sourceSession.localId; f.source.clients.add(f.ws);
  retainedTarget = Array.from(sm.sessions.values()).find(function (candidate) { return candidate.sessionOriginId === targetOrigin; });
  assert.ok(retainedTarget); assert.equal(require('../../lib/mcp-session-access').canUsePersonalConnections(retainedTarget, sm.sessions), false);
  assert.equal((await read(retainedTarget, requestId)).result.status, 'started'); count++;
  var inspected = await call('inspect_mate_chat_change', { target: selector(retainedTarget), operation: { action: 'send', text: 'Retained admission' } });
  var noReplay = await call('control_mate_chat', { targetToken: inspected.targetToken, requestId: requestId, why: 'Apply the exact fixture Mate conversation change' });
  assert.equal(noReplay.status, 'started'); count++;
  // OS-mode production projects resolve the actual owner mapping. Only the
  // OS identity lookup is replaced; no host identity or ACL is mutated.
  var osUsers = require('../../lib/os-users'), resolveOsUser = osUsers.resolveOsUserInfo, uid = 12345, buildMateCtx = f.mates.buildMateCtx;
  var roster = f.users.loadUsers();
  await f.target.destroy(); module.exports.osMode = true; f.target = f.make('other-mate', f.custom); module.exports.osMode = false; sm = f.target.sm; configure(f.target);
  var osTarget = fresh();
  assert.equal((await read(osTarget)).status, 'failed'); count++;
  // Keep OS-mode registry files in the already isolated owner directory.
  f.mates.buildMateCtx = function (owner) { return Object.assign({}, buildMateCtx(owner), { linuxUser: null }); };
  f.users.saveUsers(Object.assign({}, roster, { users: roster.users.map(function (user) { return Object.assign({}, user, user.id === 'owner' ? { linuxUser: 'fixture-mapped-owner' } : {}); }) }));
  osUsers.resolveOsUserInfo = function (username) { assert.equal(username, 'fixture-mapped-owner'); return { uid: uid, gid: 12345 }; };
  try {
    var osRead = await read(osTarget); assert.equal(osRead.model, 'fixture-model', JSON.stringify(osRead)); count++;
    p = await propose(osTarget, { action: 'model', value: 'fixture-model' }); uid++; assert.equal(answer(p), false); cancel(p); await p.promise; count++;
    uid = 12345; osTarget.queryInstance = { setModel: function () { return new Promise(function (resolve) { release = resolve; }); } };
    p = await propose(osTarget, { action: 'model', value: 'fixture-model' }); answer(p); await settle(); uid++; release(true); var osResult = await p.promise; assert.equal(osResult.status, 'failed'); assert.equal(osResult.runtimeEffect, 'applied'); osTarget.queryInstance = null; count++;
    uid = 12345;
    var savedSource = f.sourceSession.sessionOriginId;
    await f.source.destroy(); module.exports.osMode = true; f.source = f.make('clay-source', f.clay); module.exports.osMode = false;
    f.sourceSession = Array.from(f.source.sm.sessions.values()).find(function (candidate) { return candidate.sessionOriginId === savedSource; });
    f.sourceSession._sdkQueryGeneration = 30; f.sourceSession.abortController = new AbortController(); f.ws._clayActiveSession = f.sourceSession.localId; f.source.clients.add(f.ws);
    p = await propose(osTarget, { action: 'model', value: 'fixture-model' }); uid++; assert.equal(answer(p), false); cancel(p); await p.promise; count++;
  } finally { osUsers.resolveOsUserInfo = resolveOsUser; f.users.saveUsers(roster); f.mates.buildMateCtx = buildMateCtx; }
  console.log(count + ' production Mate chat scenarios passed');
}
module.exports = { createQuery: createQuery, run: run };
