var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
var clock = Date.UTC(2031, 0, 1, 8), captures = [];
function installClock() { process.env.TZ = 'UTC'; Date.now = function () { return clock; }; }
function createQuery(options) {
  captures.push(options);
  return { pushMessage: function () { return true; }, close: function () {}, [Symbol.asyncIterator]: function () {
    var step = 0;
    return { next: async function () { step++; if (step === 1) return { done: false, value: { yokeType: 'session_started', sessionId: options.resume || 'schedule-fixture-' + captures.length } }; if (step === 2) return { done: false, value: { yokeType: 'result', result: 'Fixture transport ended.' } }; return { done: true }; } };
  } };
}
async function settle() { for (var i = 0; i < 12; i++) await new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  var count = 0, sequence = 0;
  f.projects.forEach(function (project) { project.sm.installedVendors = ['claude', 'codex']; project.sm.modelsByVendor = { claude: [{ value: 'fixture-model' }], codex: [{ value: 'fixture-model' }] }; });
  var ref = require('../../lib/workspace-query-service').sessionRef;
  var other = f.projects.get('other-mate'), mateSession = other.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
  var mate = { kind: 'mate', mateId: f.custom.id, sessionRef: ref('other-mate', mateSession) };
  var own = { kind: 'mate', mateId: f.clay.id, sessionRef: ref('clay-source', f.sourceSession) };
  var project = { kind: 'project', projectSlug: 'target', sessionRef: ref('target', f.session) };
  var rule = { version: 1, timezone: 'server-local', anchorDate: '2031-01-01', time: '09:00', recurrence: null };
  function answer(p, actor, selection) { return f.source.handleHomeAskUserResponse({ toolId: p.id, answers: { 0: selection || 'Apply exact change' } }, f.sourceSession, actor || f.ws); }
  async function call(name, args) { try { var bridge = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, Number(f.sourceSession._sdkQueryGeneration || 0)); return JSON.parse((await bridge.callTool('clay-workspace', name, args || {})).content[0].text); } catch (error) { return { status: 'failed', error: error.message }; } }
  async function read(target, op) { return call('read_schedule_controls', { target: target, operation: op || { action: 'list' } }); }
  async function propose(target, op, reuse) {
    var inspected = await call('inspect_schedule_change', { target: target, operation: op });
    assert.ok(inspected.targetToken, JSON.stringify(inspected));
    var args = { targetToken: inspected.targetToken, requestId: reuse || 'schedule_' + Date.now() + '_' + (++sequence), why: 'Review the exact fixture scheduling intent' };
    var promise = call('control_schedules', args);
    await settle();
    var ids = Object.keys(f.sourceSession.pendingAskUser || {});
    assert.ok(ids.length, JSON.stringify(await Promise.race([promise, Promise.resolve({ waiting: true })])));
    return { promise: promise, args: args, id: ids[ids.length - 1] };
  }
  async function success(target, op) {
    var p = await propose(target, op); assert.equal(answer(p), true); var result = await p.promise;
    assert.ok(['completed', 'proposed', 'queued'].includes(result.status), JSON.stringify(result)); count++; return result;
  }
  function cancel(p) { var pending = f.sourceSession.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Fixture invalidation'); }
  var sourceArgs = { projectSlug: 'clay-source', projectOwnerId: 'owner', isMate: true, mateId: f.clay.id, session: f.sourceSession };
  for (var vendor of ['claude', 'codex']) {
    f.sourceSession.vendor = vendor;
    for (var fresh of [true, false]) {
      var tools = await f.source.getMcpBridgeHandler(f.sourceSession.localId, fresh, 8).listTools();
      ['begin_schedule_control_interview', 'read_schedule_controls', 'inspect_schedule_change', 'control_schedules'].forEach(function (name) { assert.ok(tools.some(function (tool) { return tool.name === name; })); }); count++;
    }
  }
  f.sourceSession.vendor = 'claude';
  assert.throws(function () { f.source.getMateScheduleControl().create(f.sourceSession, { message: 'Forged host authority', rule: rule }, 'unreviewed'); }, /separate owner-reviewed/); count++;
  var begun = await call('begin_schedule_control_interview', { target: mate }); assert.equal(begun.status, 'interview_started');
  assert.equal(f.controls.bind(sourceArgs).schedulingQuestionLimit(), 1); count++;
  var ordinary = other.getMcpBridgeHandler(mateSession.localId, true, Number(mateSession._sdkQueryGeneration || 0));
  assert.equal((await ordinary.listTools()).some(function (tool) { return tool.name === 'control_schedules'; }), false); count++;
  assert.equal((await read(mate)).schedules.length, 0);
  var p = await propose(mate, { action: 'create_mate', data: { message: 'Cross Mate brief', scheduleRule: rule } });
  assert.equal((await read(mate)).schedules.length, 0);
  assert.equal(answer(p, { readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId }), false);
  assert.equal(answer(p), true); var first = await p.promise; assert.equal(first.status, 'completed', JSON.stringify(first));
  assert.equal(first.delivery, 'queued'); assert.equal(first.schedule.createdBy.type, 'canonicalClay'); assert.equal(first.schedule.createdBy.mateId, f.clay.id); count++;
  assert.equal(answer(p), false); assert.deepEqual(await call('control_schedules', p.args), first); assert.equal((await read(mate)).schedules.length, 1); count++;
  var savedRequest = p.args.requestId;
  assert.equal((await read(mate, { action: 'receipt', requestId: savedRequest })).status, 'finished'); count++;
  assert.equal((await call('control_schedules', Object.assign({}, p.args, { why: 'Changed intent' }))).status, 'failed'); count++;
  var rec = first.schedule;
  var updated = await success(mate, { action: 'update_mate', id: rec.id, revision: rec.revision, data: { message: 'Updated brief' } }); rec = updated.schedule;
  assert.equal(rec.updatedBy.type, 'canonicalClay'); assert.notEqual(rec.revision, first.schedule.revision); count++;
  p = await propose(mate, { action: 'cancel_mate', id: rec.id, revision: rec.revision }); answer(p, f.ws, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); count++;
  var cancelled = await success(mate, { action: 'cancel_mate', id: rec.id, revision: rec.revision }); assert.equal(cancelled.schedule.state, 'cancelled'); count++;
  var ownResult = await success(own, { action: 'create_mate', data: { message: 'Canonical own brief', scheduleRule: rule } }); assert.equal(ownResult.schedule.ownerId, 'owner'); count++;
  var one = await success(mate, { action: 'create_mate', data: { message: 'Deliver once', scheduleRule: rule } });
  var stale = await call('inspect_schedule_change', { target: mate, operation: { action: 'update_mate', id: one.schedule.id, revision: 'old', data: { message: 'Stale' } } }); assert.equal(stale.status, 'failed'); count++;
  for (var mode of ['foreignSource', 'stop', 'query', 'targetStop', 'targetDeleted', 'registryDeleted', 'targetForeign', 'targetRuntime', 'sourceDeleted']) {
    p = await propose(mate, { action: 'create_mate', data: { message: 'Guarded ' + mode, scheduleRule: rule } });
    var registry = f.mates.loadMates(f.mateCtx), source = f.projects.get('clay-source'), targetModel = mateSession.model;
    if (mode === 'foreignSource') f.sourceSession._mcpForeignInput = true;
    if (mode === 'stop') f.sourceSession.taskStopRequested = true;
    if (mode === 'query') f.sourceSession._sdkQueryGeneration++;
    if (mode === 'targetStop') mateSession.taskStopRequested = true;
    if (mode === 'targetDeleted') f.projects.delete('other-mate');
    if (mode === 'registryDeleted') f.mates.saveMates(f.mateCtx, Object.assign({}, registry, { mates: registry.mates.filter(function (entry) { return entry.id !== f.custom.id; }) }));
    if (mode === 'targetForeign') mateSession.ownerId = 'foreign';
    if (mode === 'targetRuntime') mateSession.model = 'changed-model';
    if (mode === 'sourceDeleted') f.projects.delete('clay-source');
    assert.equal(answer(p), false, mode); cancel(p); await p.promise;
    f.sourceSession._mcpForeignInput = false; f.sourceSession.taskStopRequested = false; f.sourceSession._sdkQueryGeneration = 8; mateSession.taskStopRequested = false; mateSession.ownerId = 'owner'; mateSession.model = targetModel;
    f.projects.set('other-mate', other); f.projects.set('clay-source', source); f.mates.saveMates(f.mateCtx, registry); count++;
  }
  p = await propose(mate, { action: 'update_mate', id: one.schedule.id, revision: one.schedule.revision, data: { message: 'Stale after real edit' } });
  other.getMateScheduleControl().update(mateSession, { id: one.schedule.id, revision: one.schedule.revision }, { message: 'Real concurrent edit', rule: rule });
  assert.equal(answer(p), false); cancel(p); await p.promise; count++;
  var defs = f.source.sdk.getQueryToolDefs(f.sourceSession, 8);
  assert.equal(defs.some(function (item) { return item.name === 'propose_mate_schedule' || item.name === 'propose_scheduled_task'; }), false); count++;
  var taskData = { name: 'Scheduled fixture task', instructions: 'Inspect the fixture only', scheduleRule: rule, execution: { driver: { vendor: 'codex', model: 'fixture-model', effort: 'medium' }, worker: { vendor: 'codex', model: 'fixture-model', effort: 'medium' } } };
  var proposal = await success(project, { action: 'propose', data: taskData }); assert.equal(proposal.status, 'proposed'); assert.equal((await read(project)).records.length, 0); count++;
  var taskEvents = [], ws = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: f.session.localId, send: function (data) { taskEvents.push(JSON.parse(data)); } }; f.target.clients.add(ws);
  var creation = { type: 'scheduled_task_create', sessionId: f.session.localId, requestId: 'human-create', proposalId: proposal.proposalId, version: proposal.version };
  f.target.handleMessage(ws, creation);
  var action = taskEvents.find(function (event) { return event.type === 'scheduled_task_action_result'; }); assert.ok(action && action.ok, JSON.stringify(taskEvents)); count++;
  var task = (await read(project)).records[0]; assert.equal(task.createdBy.type, 'canonicalClay'); assert.equal(task.ownerId, 'owner');
  f.target.handleMessage(ws, creation); assert.equal((await read(project)).records.length, 1); count++;
  var result = await success(project, { action: 'update', id: task.id, revision: task.revision, data: { name: 'Updated fixture task' } }); task = result.record; assert.equal(task.name, 'Updated fixture task'); count++;
  await success(project, { action: 'pause', id: task.id, revision: task.revision }); task = (await read(project, { action: 'read', id: task.id })).record; assert.equal(task.enabled, false); count++;
  await success(project, { action: 'resume', id: task.id, revision: task.revision }); task = (await read(project, { action: 'read', id: task.id })).record; assert.equal(task.enabled, true); count++;
  p = await propose(project, { action: 'pause', id: task.id, revision: task.revision }); f.revoke(); assert.equal(answer(p), false); cancel(p); await p.promise; f.restoreAccess(); count++;
  // A second proposal stays uncreated when its author query is stopped.
  proposal = await success(project, { action: 'propose', data: Object.assign({}, taskData, { name: 'Stopped author proposal' }) });
  f.sourceSession.taskStopRequested = true;
  taskEvents.length = 0;
  f.target.handleMessage(ws, { type: 'scheduled_task_create', sessionId: f.session.localId, requestId: 'stopped-create', proposalId: proposal.proposalId, version: proposal.version });
  assert.equal(taskEvents.find(function (event) { return event.type === 'scheduled_task_action_result'; }).ok, false);
  f.sourceSession.taskStopRequested = false;
  f.target.handleMessage(ws, { type: 'scheduled_task_cancel', sessionId: f.session.localId, proposalId: proposal.proposalId, version: proposal.version });
  assert.equal((await read(project)).records.length, 1); count++;
  // Run now uses the existing executor and returns dispatch, never completion.
  var runResult = await success(project, { action: 'run', id: task.id, revision: task.revision }); assert.equal(runResult.status, 'queued');
  await settle(); task = (await read(project, { action: 'read', id: task.id })).record;
  assert.ok(task.activeRun && task.activeRun.driverOriginId && task.activeRun.workerOriginId); count++;
  var cancelledTask = await success(project, { action: 'cancel', id: task.id, revision: task.revision }); assert.equal(cancelledTask.removed, true);
  assert.equal((await read(project)).records.length, 0); count++;
  // Save failure before the target mutation leaves a durable no-replay receipt.
  var originalRename = fs.renameSync;
  var beforeFailure = (await read(mate)).schedules.length;
  p = await propose(mate, { action: 'create_mate', data: { message: 'Failed target save', scheduleRule: rule } });
  fs.renameSync = function (from, to) { if (String(to).endsWith('/' + mateSession._sessionRecordId + '.jsonl')) throw new Error('Fixture schedule target save failure'); return originalRename.apply(fs, arguments); };
  try { answer(p); var failed = await p.promise; } finally { fs.renameSync = originalRename; }
  assert.equal(failed.status, 'failed'); assert.match(failed.error, /could not be saved/);
  assert.equal((await read(mate)).schedules.length, beforeFailure); count++;
  var failedRequest = p.args.requestId;
  f.sourceSession._sdkQueryGeneration++;
  assert.equal((await read(mate, { action: 'receipt', requestId: savedRequest })).result.schedule.id, first.schedule.id);
  assert.equal((await read(mate, { action: 'receipt', requestId: failedRequest })).status, 'applying'); count++;
  // A real session reload restores the saved receipt metadata.
  var sourceOrigin = f.sourceSession.sessionOriginId;
  var savedSource = f.source;
  await savedSource.destroy();
  f.source = f.make('clay-source', f.clay);
  f.sourceSession = Array.from(f.source.sm.sessions.values()).find(function (session) { return session.sessionOriginId === sourceOrigin; });
  assert.ok(f.sourceSession && f.sourceSession.claySchedulingReceipts.length);
  f.sourceSession._sdkQueryGeneration = 20; f.sourceSession.abortController = new AbortController();
  f.ws._clayActiveSession = f.sourceSession.localId; f.source.clients.add(f.ws);
  own.sessionRef = ref('clay-source', f.sourceSession);
  assert.equal((await read(mate, { action: 'receipt', requestId: savedRequest })).status, 'finished');
  var retryInspection = await call('inspect_schedule_change', { target: mate, operation: { action: 'create_mate', data: { message: 'Failed target save', scheduleRule: rule } } });
  var retryResult = await call('control_schedules', { targetToken: retryInspection.targetToken, requestId: failedRequest, why: 'Review the exact fixture scheduling intent' });
  assert.equal(retryResult.persisted, 'unknown'); assert.equal((await read(mate)).schedules.length, beforeFailure); count++;
  // Live retry receipts are never evicted within their advertised window.
  var sourceState = f.sourceSession.claySchedulingReceipts;
  f.sourceSession.claySchedulingReceipts = sourceState.concat(Array.from({ length: Math.max(0, 100 - sourceState.length) }, function (_, index) { return { id: 'capacity_' + Date.now() + '_' + index, key: 'fixture', status: 'finished', result: { status: 'completed' } }; }));
  f.source.sm.saveSessionFile(f.sourceSession);
  p = await propose(mate, { action: 'create_mate', data: { message: 'Capacity must not evict retry protection', scheduleRule: rule } });
  answer(p); var capacity = await p.promise; assert.equal(capacity.status, 'failed'); assert.equal(capacity.persisted, false); assert.match(capacity.error, /capacity/);
  assert.equal((await read(mate)).schedules.length, beforeFailure);
  f.sourceSession.claySchedulingReceipts = sourceState; f.source.sm.saveSessionFile(f.sourceSession); count++;
  var preDue = captures.length;
  clock = Date.UTC(2031, 0, 1, 9, 1); f.scheduler.tick(); await settle();
  assert.ok(captures.length > preDue, 'Due schedules must reach the real SDK with fake provider transport');
  assert.equal(mateSession.mateSchedules.find(function (record) { return record.id === one.schedule.id; }).state, 'completed');
  assert.equal(mateSession.mateSchedules.find(function (record) { return record.id === cancelled.schedule.id; }).state, 'cancelled');
  assert.equal(f.sourceSession.mateSchedules.find(function (record) { return record.id === ownResult.schedule.id; }).state, 'completed'); count++;
  console.log(count + ' production scheduling scenarios passed');
}
module.exports = { run: run, installClock: installClock, createQuery: createQuery };
