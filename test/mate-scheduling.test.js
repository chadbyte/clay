var test = require('node:test');
var assert = require('node:assert/strict');
var fs = require('fs');
var os = require('os');
var path = require('path');
var root = fs.mkdtempSync(path.join(os.tmpdir(), 'clay-mate-scheduling-'));
process.env.HOME = root;
process.env.CLAY_HOME = root;
process.env.TZ = 'UTC';
var clock = Date.UTC(2031, 0, 1, 8, 0);
var realNow = Date.now;
Date.now = function () { return clock; };
var runtime = require('./fixtures/mate-scheduling-runtime.cjs').runtime;
function flush() { return new Promise(function (resolve) { setImmediate(resolve); }); }
async function settle() { for (var i = 0; i < 8; i++) await flush(); }
function rule(extra) { return Object.assign({ version: 1, timezone: 'server-local', anchorDate: '2031-01-01', time: '09:00', recurrence: null }, extra); }
function decode(result) { return JSON.parse(result.content[0].text); }
function tool(tools, name) { return tools.find(function (entry) { return entry.name === name; }); }
function pending(f) { return Object.keys(f.session.pendingAskUser || {})[0]; }
function answer(r, f, label, actor, id) {
  return f.project.handleHomeAskUserResponse({ toolId: id || pending(f), answers: { approve: [label] } }, f.session, r.ws(f, actor));
}
async function propose(r, f, tools, message, scheduleRule) {
  var promise = tool(tools, 'propose_mate_schedule').handler({ message: message || 'Review today', scheduleRule: scheduleRule || rule() });
  assert.ok(pending(f));
  var id = pending(f);
  assert.equal(answer(r, f, 'Create schedule'), true);
  assert.equal(answer(r, f, 'Create schedule', r.owner, id), false);
  return decode(await promise);
}
function scheduled(r, f) { return r.scheduler.listJobs().filter(function (job) { return job.projectId === 'mate-' + f.mate.id; }); }
async function fixture(t, options) {
  clock = Date.UTC(2031, 0, 1, 8, 0);
  var r = runtime(options);
  t.after(function () { return r.close(); });
  return r;
}

test.after(function () { Date.now = realNow; fs.rmSync(root, { recursive: true, force: true }); });

test('production registration binds creation intent before any provider identity, dispatches through normal private Mate runtime', async function (t) {
  var r = await fixture(t);
  var f = r.create({ message: 'Creation brief', scheduleRule: rule() });
  assert.equal(f.session.cliSessionId, null);
  assert.equal(f.session.mateSchedules.length, 1);
  assert.equal(scheduled(r, f).length, 1);
  assert.equal(scheduled(r, f)[0].target.id, f.session.sessionOriginId);
  assert.equal(r.captures.length, 0);
  clock = Date.UTC(2031, 0, 1, 9, 1);
  r.scheduler.tick();
  await settle();
  assert.equal(r.captures.length, 1);
  assert.equal(f.session.mateSchedules[0].state, 'completed');
  assert.ok(f.session.history.some(function (event) { return event.type === 'scheduled_message_sent'; }));
  var queueItems = fs.readdirSync(path.join(root, 'pending-message-queues')).flatMap(function (name) {
    return JSON.parse(fs.readFileSync(path.join(root, 'pending-message-queues', name), 'utf8')).items;
  });
  assert.equal(queueItems.find(function (item) { return item.schedule && item.schedule.jobId === scheduled(r, f)[0].id; }).state, 'consumed');
  assert.ok(r.captures[0].dynamicTools.some(function (entry) { return entry.name === 'read_mate_schedule'; }));
});

test('authenticated exact proposal approval, two independent schedules, logical read/update/cancel and restore', async function (t) {
  var r = await fixture(t);
  var f = r.create();
  var tools = await r.tools(f);
  var first = await propose(r, f, tools, 'First');
  var second = await propose(r, f, tools, 'Second');
  assert.equal(first.status, 'created');
  assert.equal(second.status, 'created');
  assert.equal(scheduled(r, f).filter(function (job) { return job.state === 'queued'; }).length, 2);
  var list = decode(await tool(tools, 'list_mate_schedules').handler({})).schedules;
  assert.equal(list.length, 2);
  assert.equal(decode(await tool(tools, 'read_mate_schedule').handler({ id: list[0].id })).schedule.message, 'First');
  var update = tool(tools, 'update_mate_schedule').handler({ id: list[0].id, revision: list[0].revision, date: '2031-01-02', time: '10:30' });
  answer(r, f, 'Update schedule');
  var updated = decode(await update);
  assert.equal(updated.status, 'updated');
  assert.equal(updated.schedule.rule.anchorDate, '2031-01-02');
  assert.equal(updated.schedule.rule.time, '10:30');
  assert.notEqual(updated.schedule.revision, list[0].revision);
  assert.equal(decode(await tool(tools, 'update_mate_schedule').handler({ id: list[0].id, revision: list[0].revision })).status, 'rejected');
  var cancellation = tool(tools, 'cancel_mate_schedule').handler({ id: list[1].id, revision: list[1].revision });
  answer(r, f, 'Cancel schedule');
  assert.equal(decode(await cancellation).status, 'cancelled');
  f.session.cliSessionId = 'provider-appeared';
  f.sm.saveSessionFile(f.session);
  await f.project.destroy(); r.projects.delete('mate-' + f.mate.id);
  var restored = r.open(f.mate);
  assert.equal(restored.session.mateSchedules.length, 2);
  clock = Date.UTC(2031, 0, 2, 10, 31);
  var before = r.captures.length;
  r.scheduler.tick(); await settle();
  assert.equal(r.captures.length, before + 1);
  assert.equal(restored.session.mateSchedules.find(function (record) { return record.id === list[0].id; }).state, 'completed');
  assert.equal(restored.session.mateSchedules.find(function (record) { return record.id === list[1].id; }).state, 'cancelled');
});

test('negated, unrelated, foreign, stale and forged approvals cannot admit a schedule', async function (t) {
  var r = await fixture(t), f = r.create(), tools = await r.tools(f);
  for (var label of ['do not create', 'Yes', 'Cancel']) {
    var promise = tool(tools, 'propose_mate_schedule').handler({ message: 'No admission', scheduleRule: rule() });
    f.session.history.push({ type: 'user_message', text: 'Yes, create it' });
    assert.equal(scheduled(r, f).length, 0);
    assert.equal(answer(r, f, 'Create schedule', r.stranger), false);
    assert.equal(answer(r, f, 'Create schedule', r.owner, 'forged'), false);
    answer(r, f, label);
    assert.equal(decode(await promise).status, 'cancelled');
  }
  var stale = tool(tools, 'propose_mate_schedule').handler({ message: 'Stale', scheduleRule: rule() });
  f.session._sdkQueryGeneration++;
  answer(r, f, 'Create schedule');
  assert.equal(decode(await stale).status, 'rejected');
  assert.equal(scheduled(r, f).length, 0);
  tools = await r.tools(f);
  f.session._mcpForeignInput = true;
  assert.equal(decode(await tool(tools, 'propose_mate_schedule').handler({ message: 'Foreign', scheduleRule: rule() })).status, 'rejected');
});

test('recurrence after N, until and cancellation remain durable without resurrecting terminal jobs', async function (t) {
  var r = await fixture(t, { namespace: 'recurrence-restart' }), f = r.create(), tools = await r.tools(f);
  var a = await propose(r, f, tools, 'Twice', rule({ recurrence: { every: 1, unit: 'day' }, recurrenceEnd: { type: 'after', count: 2 } }));
  var b = await propose(r, f, tools, 'Until', rule({ recurrence: { every: 1, unit: 'day' }, recurrenceEnd: { type: 'until', date: '2031-01-02' } }));
  clock = Date.UTC(2031, 0, 1, 9, 1); r.scheduler.tick(); await settle();
  // A second tick releases the second fair-owner job after the first settles.
  f.session.isProcessing = false; f.session._awaitingTurnResult = false; r.scheduler.tick(); await settle();
  assert.equal(f.session.mateSchedules.find(function (item) { return item.id === a.schedule.id; }).count, 1);
  assert.equal(f.session.mateSchedules.find(function (item) { return item.id === b.schedule.id; }).count, 1);
  tools = await r.tools(f);
  var cancellation = tool(tools, 'cancel_mate_schedule').handler({ id: b.schedule.id, revision: b.schedule.revision });
  answer(r, f, 'Cancel schedule');
  assert.equal(decode(await cancellation).status, 'cancelled');
  f.sm.saveSessionFile(f.session);
  var mate = f.mate;
  await r.close();
  r = runtime({ namespace: 'recurrence-restart' });
  t.after(function () { return r.close(); });
  f = r.open(mate);
  clock = Date.UTC(2031, 0, 2, 9, 1); r.scheduler.tick(); await settle();
  assert.equal(f.session.mateSchedules.find(function (item) { return item.id === a.schedule.id; }).count, 2);
  assert.equal(f.session.mateSchedules.find(function (item) { return item.id === a.schedule.id; }).state, 'completed');
  assert.equal(f.session.mateSchedules.find(function (item) { return item.id === b.schedule.id; }).state, 'cancelled');
  assert.equal(scheduled(r, f).filter(function (job) { return job.payload.mateScheduleId === b.schedule.id && job.state === 'queued'; }).length, 0);
});

test('creation registration failure cleans up Mate and cannot produce a false scheduling success', async function (t) {
  var r = await fixture(t), ctx = r.mates.buildMateCtx(r.owner.id);
  var before = r.mates.getAllMates(ctx).length;
  assert.throws(function () { r.create({ message: 'Expired', scheduleRule: rule({ anchorDate: '2000-01-01' }) }); }, /expired/);
  assert.equal(r.mates.getAllMates(ctx).length, before);
  assert.equal(r.scheduler.listJobs().length, 0);
});

test('owner revocation and deleted Mate prevent dispatch after persistence', async function (t) {
  var r = await fixture(t), f = r.create(), tools = await r.tools(f);
  await propose(r, f, tools);
  r.setAccess(false);
  clock = Date.UTC(2031, 0, 1, 9, 1); r.scheduler.tick(); await settle();
  assert.equal(r.captures.length, 1);
  assert.equal(scheduled(r, f)[0].state, 'failed');
  r.setAccess(true);
  var g = r.create(), other = await r.tools(g);
  clock = Date.UTC(2031, 0, 1, 8, 0);
  await propose(r, g, other);
  r.mates.deleteMate(r.mates.buildMateCtx(r.owner.id), g.mate.id);
  clock = Date.UTC(2031, 0, 1, 9, 1); r.scheduler.tick(); await settle();
  assert.equal(scheduled(r, g)[0].state, 'failed');
});

test('creation proposal review validates optional intent and binds only after authenticated approval; cancellation and duplicate approval are inert', async function (t) {
  var r = await fixture(t);
  var clay = r.mates.getAllMates(r.mates.buildMateCtx(r.owner.id)).find(function (mate) { return mate.builtinKey === 'clay'; });
  var f = r.open(clay, true);
  f.session.mateCreationMode = true;
  f.sm.sendAndRecord(f.session, { type: 'ask_user_answered', toolId: 'interview-transport-answer', answers: { 0: 'A daily review partner' } });
  var tools = await r.tools(f);
  var definition = r.definition({ message: 'Bound after approval', scheduleRule: rule() });
  definition.activities = JSON.stringify(definition.activities);
  definition.communicationStyle = JSON.stringify(definition.communicationStyle);
  definition.scheduleIntent = JSON.stringify(definition.scheduleIntent);
  var promise = tool(tools, 'propose_mate').handler(definition);
  var proposal = f.session.history.findLast(function (event) { return event.type === 'mate_creation_proposal'; }).proposal;
  assert.equal(proposal.scheduleTimezone, 'UTC');
  assert.equal(proposal.scheduleIntent.message, 'Bound after approval');
  assert.equal(r.scheduler.listJobs().length, 0);
  assert.equal(f.project.handleHomeMateCreationProposalResponse(r.ws(f, r.stranger), { proposalId: proposal.proposalId, action: 'create' }, f.session), false);
  assert.equal(f.project.handleHomeMateCreationProposalResponse(r.ws(f), { proposalId: proposal.proposalId, action: 'cancel' }, f.session), true);
  await promise;
  assert.equal(r.scheduler.listJobs().length, 0);
  promise = tool(tools, 'propose_mate').handler(definition);
  proposal = f.session.history.findLast(function (event) { return event.type === 'mate_creation_proposal'; }).proposal;
  assert.equal(f.project.handleHomeMateCreationProposalResponse(r.ws(f), { proposalId: proposal.proposalId, action: 'create' }, f.session), true);
  assert.equal(f.project.handleHomeMateCreationProposalResponse(r.ws(f), { proposalId: proposal.proposalId, action: 'create' }, f.session), false);
  await promise;
  assert.equal(r.scheduler.listJobs().length, 1);
  assert.notEqual(r.scheduler.listJobs()[0].projectId, 'mate-' + clay.id);
});

test('real scheduler write failure rejects approval and creation without claiming persistence', async function (t) {
  var namespace = 'write-failure';
  var r = await fixture(t, { namespace: namespace }), f = r.create(), tools = await r.tools(f);
  var temporary = path.join(root, 'scheduler-' + namespace + '.json.tmp-' + process.pid);
  fs.mkdirSync(temporary);
  var promise = tool(tools, 'propose_mate_schedule').handler({ message: 'Must not claim success', scheduleRule: rule() });
  answer(r, f, 'Create schedule');
  assert.equal(decode(await promise).status, 'rejected');
  assert.equal(r.scheduler.listJobs().length, 0);
  assert.equal(r.scheduler.status().healthy, false);
  fs.rmdirSync(temporary);
});

test('until limits stop at the final local date and delayed occurrences coalesce rather than replay a backlog', async function (t) {
  var r = await fixture(t), f = r.create(), tools = await r.tools(f);
  var a = await propose(r, f, tools, 'Until tomorrow', rule({ recurrence: { every: 1, unit: 'day' }, recurrenceEnd: { type: 'until', date: '2031-01-02' } }));
  clock = Date.UTC(2031, 0, 5, 10, 0);
  r.scheduler.tick(); await settle();
  var record = f.session.mateSchedules.find(function (item) { return item.id === a.schedule.id; });
  assert.equal(record.count, 1);
  assert.equal(record.state, 'completed');
  assert.equal(r.captures.length, 2);
});

test('native Claude and resumed Codex expose the same authoritative schedule tools, including the read tool', async function (t) {
  var r = await fixture(t, { vendor: 'claude' }), f = r.create();
  await r.tools(f);
  var registered = r.captures[0].mcpServers['clay-mate-schedules'].instance._registeredTools;
  assert.ok(registered.propose_mate_schedule);
  assert.ok(registered.read_mate_schedule);
  var read = registered.read_mate_schedule;
  var response = await (read.handler || read.callback)({ id: 'missing' });
  assert.equal(decode(response).status, 'rejected');
  var nativeProposal = registered.propose_mate_schedule;
  var approval = (nativeProposal.handler || nativeProposal.callback)({ message: 'Native Claude review', scheduleRule: rule() });
  assert.ok(pending(f));
  answer(r, f, 'Create schedule');
  assert.equal(decode(await approval).status, 'created');
  await r.close();
  r = runtime(); t.after(function () { return r.close(); });
  f = r.create(); f.session.cliSessionId = 'old-codex-thread';
  await r.tools(f);
  assert.ok(r.captures[0].sessionMcpServer.args.includes('--session-only'));
  var bridge = f.project.getMcpBridgeHandler(f.session.localId, true, f.session._sdkQueryGeneration);
  var catalog = await bridge.listTools();
  assert.ok(catalog.some(function (entry) { return entry.server === 'clay-mate-schedules' && entry.name === 'read_mate_schedule'; }));
  var priorGeneration = f.session._sdkQueryGeneration;
  await r.tools(f);
  var stale = f.project.getMcpBridgeHandler(f.session.localId, true, priorGeneration);
  assert.deepEqual(await stale.listTools(), []);
});

test('recovering the scheduler-to-queue crash gap reuses the same occurrence and stable origin after provider identity appears', async function (t) {
  var r = await fixture(t), f = r.create({ message: 'Recover once', scheduleRule: rule() });
  var before = scheduled(r, f)[0];
  f.session.cliSessionId = 'provider-assigned-later'; f.sm.saveSessionFile(f.session);
  await f.project.destroy(); r.projects.delete('mate-' + f.mate.id);
  var queues = fs.readdirSync(path.join(root, 'pending-message-queues')).map(function (name) { return path.join(root, 'pending-message-queues', name); });
  for (var file of queues) {
    var data = JSON.parse(fs.readFileSync(file, 'utf8'));
    data.items = data.items.filter(function (item) { return !item.schedule || item.schedule.jobId !== before.id; });
    fs.writeFileSync(file, JSON.stringify(data));
  }
  f = r.open(f.mate);
  assert.equal(scheduled(r, f).length, 1);
  assert.equal(scheduled(r, f)[0].id, before.id);
  clock = Date.UTC(2031, 0, 1, 9, 1); r.scheduler.tick(); await settle();
  assert.equal(r.captures.length, 1);
  assert.equal(f.session.mateSchedules[0].state, 'completed');
});

test('successor admission write failure stays visible, preserves the accepted provider turn, and recovers idempotently', async function (t) {
  var namespace = 'successor-admission';
  var r = await fixture(t, { namespace: namespace });
  var f = r.create({ message: 'Recover the next brief', scheduleRule: rule({ recurrence: { every: 1, unit: 'day' }, recurrenceEnd: { type: 'after', count: 2 } }) });
  clock = Date.UTC(2031, 0, 1, 9, 1);
  r.scheduler.tick();
  // Let the durable scheduler complete its queue handoff without running the
  // setImmediate that consumes the queue and admits the next occurrence.
  for (var i = 0; i < 12; i++) await Promise.resolve();
  assert.equal(scheduled(r, f)[0].state, 'completed');
  var temporary = path.join(root, 'scheduler-' + namespace + '.json.tmp-' + process.pid);
  fs.mkdirSync(temporary);
  await settle();
  assert.equal(f.session.mateSchedules[0].count, 1);
  assert.equal(f.session.mateSchedules[0].occurrence, 1);
  assert.equal(r.scheduler.listJobs().length, 1);
  assert.ok(f.session.history.some(function (event) { return event.type === 'error' && /next occurrence needs recovery/.test(event.text); }));
  assert.ok(f.session.history.some(function (event) { return event.type === 'result'; }));
  var mate = f.mate;
  fs.rmdirSync(temporary);
  await r.close();
  r = runtime({ namespace: namespace }); t.after(function () { return r.close(); });
  f = r.open(mate);
  assert.equal(scheduled(r, f).length, 2);
  assert.equal(scheduled(r, f).filter(function (job) { return job.state === 'queued'; }).length, 1);
  clock = Date.UTC(2031, 0, 2, 9, 1); r.scheduler.tick(); await settle();
  assert.equal(f.session.mateSchedules[0].count, 2);
  assert.equal(f.session.mateSchedules[0].state, 'completed');
});

test('explicit legacy CLI target lookup restores and dispatches an approved Mate schedule', async function (t) {
  var r = await fixture(t), f = r.create({ message: 'Legacy reminder', scheduleRule: rule() });
  f.session.cliSessionId = 'legacy-provider-thread';
  f.sm.saveSessionFile(f.session);
  var job = scheduled(r, f)[0];
  assert.ok(job);
  r.scheduler.replaceQueued(job.id, { target: { kind: 'project-session', id: f.session.cliSessionId } });
  await f.project.destroy(); r.projects.delete('mate-' + f.mate.id);
  f = r.open(f.mate);
  clock = Date.UTC(2031, 0, 1, 9, 1);
  r.scheduler.tick(); await settle();
  assert.equal(r.captures.length, 1);
  assert.equal(r.scheduler.getJob(job.id).state, 'completed');
  assert.ok(f.session.history.some(function (event) { return event.type === 'scheduled_message_sent'; }));
});

test('aborted schedule reviews expire in project and Home event history and cannot approve later', async function (t) {
  var r = await fixture(t), f = r.create(), tools = await r.tools(f);
  f.session.abortController = new AbortController();
  var proposal = tool(tools, 'propose_mate_schedule').handler({ message: 'Expire this review', scheduleRule: rule() });
  var id = pending(f);
  f.session.abortController.abort();
  assert.equal(decode(await proposal).status, 'cancelled');
  assert.equal(answer(r, f, 'Create schedule', r.owner, id), false);
  assert.equal(scheduled(r, f).length, 0);
  var event = f.session.history.findLast(function (entry) { return entry.type === 'mate_schedule_question_expired'; });
  assert.ok(event);
  var homeEvents = require('../lib/server-home-chat-events');
  assert.equal(homeEvents.transformEvent(event, f.mate.id, f.session).status, 'expired');
  assert.equal(homeEvents.historyToHomeChat(f.session.history, false, false, f.session.pendingAskUser).findLast(function (entry) { return entry.role === 'question'; }).status, 'expired');
});

test('pending schedule draft survives real session serialization without restoring human approval authority', async function (t) {
  var r = await fixture(t), f = r.create(), tools = await r.tools(f);
  var proposal = tool(tools, 'propose_mate_schedule').handler({ message: 'Restore this exact draft', scheduleRule: rule() });
  var draft = JSON.parse(JSON.stringify(f.session.mateScheduleDraft));
  var requestId = pending(f);
  assert.ok(draft.id);
  assert.ok(draft.revision);
  assert.equal(scheduled(r, f).length, 0);
  var managerOptions = { cwd: r.mates.getMateDir(r.mates.buildMateCtx(r.owner.id), f.mate.id), isMate: true, send: function () {} };
  var restoredManager = require('../lib/sessions').createSessionManager(managerOptions);
  var restored = Array.from(restoredManager.sessions.values()).find(function (session) { return session.sessionOriginId === f.session.sessionOriginId; });
  assert.ok(restored);
  assert.deepEqual(restored.mateScheduleDraft, draft);
  assert.equal(restored.ownerId, r.owner.id);
  assert.deepEqual(Object.keys(restored.pendingAskUser || {}), []);
  assert.equal(f.project.handleHomeAskUserResponse({ toolId: requestId, answers: { approve: ['Create schedule'] } }, restored, r.ws(f)), false);
  assert.equal(scheduled(r, f).length, 0);
  answer(r, f, 'Cancel');
  assert.equal(decode(await proposal).status, 'cancelled');
  var afterCancel = require('../lib/sessions').createSessionManager(managerOptions);
  var cancelledSession = Array.from(afterCancel.sessions.values()).find(function (session) { return session.sessionOriginId === f.session.sessionOriginId; });
  assert.equal(cancelledSession.mateScheduleDraft == null, true);
});
