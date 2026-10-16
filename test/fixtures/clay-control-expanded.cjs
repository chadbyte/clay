var assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
var providers = [], browserFailure = false, sketchRelease = null;
function createQuery(options) {
  var release, gate = new Promise(function (resolve) { release = resolve; });
  var record = { release: release, options: options }; providers.push(record);
  return { endInput: function () {}, pushMessage: function () { return true; }, abort: release, close: release, [Symbol.asyncIterator]: function () {
    var step = 0; return { next: async function () {
      if (++step === 1) return { done: false, value: { yokeType: 'session_started', sessionId: options.resume || 'assignment-fixture-' + providers.length } };
      if (step === 2) { await gate; return { done: false, value: { yokeType: 'result', result: 'Isolated Driver finished' } }; }
      return { done: true };
    } };
  } };
}
function installTransport() {
  require('../../lib/plantuml-renderer').renderPlantUml = function () { return sketchRelease === false ? new Promise(function (resolve) { sketchRelease = resolve; }) : Promise.resolve(); };
  require('../../lib/shared-browser-runtime').createRuntime = function (options) {
    setImmediate(function () { options.onEvent({ type: 'ready' }); });
    return { control: function () {}, viewing: function () {}, close: function () {}, settle: function () { return Promise.resolve({ through: 1 }); },
      request: function (action, event) { if (browserFailure) return Promise.reject(new Error('Isolated browser transport uncertainty')); return Promise.resolve({ url: event && event.url || 'https://fixture.invalid/', width: 1280, height: 800 }); } };
  };
}
async function tick() { for (var i = 0; i < 20; i++) await new Promise(function (resolve) { setImmediate(resolve); }); }
async function run(f) {
  function display() { var bound = f.controls.bind({ projectSlug: 'clay-source', projectOwnerId: 'owner', isMate: true, mateId: f.clay.id, session: f.sourceSession }); return bound && bound._presentation; }
  var ref = require('../../lib/workspace-query-service').sessionRef;
  var assignment = require('../../lib/workspace-assignment-service').attachWorkspaceAssignmentService({ getProjects: function () { return f.projects; }, isMultiUser: f.users.isMultiUser, sessionRef: ref, getPresentation: display });
  var principal = { userId: 'owner', sourceProjectSlug: 'clay-source', sourceSessionId: f.sourceSession.localId, sourceSessionRef: ref('clay-source', f.sourceSession), mateId: f.clay.id };
  function phases() { return f.events.filter(function (event) { return event.type === 'clay_control_activity' && event.domain === 'assignment'; }); }
  var proposal = assignment.propose(principal, { projectSlug: 'target', title: 'Observed assignment', task: 'Finish the isolated review.' });
  assert.equal(phases().at(-1).phase, 'review'); assert.equal(phases().at(-1).target.kind, 'project');
  var first = phases().at(-1).id, count = phases().length;
  assert.equal(assignment.propose(principal, { projectSlug: 'target', title: 'Observed assignment', task: 'Finish the isolated review.' }).assignmentId, proposal.assignmentId);
  assert.equal(phases().length, count);
  function respond(record, action, ws) { return assignment.respond(ws || f.ws, { assignmentId: record.assignmentId, sourceProjectSlug: 'clay-source', sourceSessionRef: principal.sourceSessionRef, action: action }, 'clay-source'); }
  await assert.rejects(respond(proposal, 'approve', { _clayUser: { id: 'foreign' }, _clayActiveSession: f.sourceSession.localId }), /stale|unavailable|denied/);
  var approved = await respond(proposal, 'approve'); await tick();
  assert.equal(approved.status, 'running', JSON.stringify(approved)); assert.ok(providers.length);
  assert.ok(phases().some(function (event) { return event.id === first && event.phase === 'queued'; }));
  assert.ok(phases().some(function (event) { return event.id === first && event.phase === 'running'; }));
  providers.at(-1).release(); await tick(); assert.equal(assignment.getStatus(principal, proposal.assignmentId).status, 'completed');
  assert.equal(phases().at(-1).phase, 'completed');
  f.target.sm.capabilitiesByVendor.codex.sessionResume = true;
  proposal = assignment.proposeFollowUp(principal, { projectSlug: 'target', targetSessionRef: ref('target', f.session), title: 'Reviewed follow-up', task: 'Continue the isolated review.' });
  await respond(proposal, 'cancel'); await tick(); assert.equal(phases().at(-1).phase, 'cancelled');
  proposal = assignment.proposeFollowUp(principal, { projectSlug: 'target', targetSessionRef: ref('target', f.session), title: 'Run follow-up', task: 'Continue the exact existing Driver.' });
  var follow = phases().at(-1).id; await respond(proposal, 'approve'); await tick();
  assert.equal(assignment.getStatus(principal, proposal.assignmentId).status, 'running');
  providers.at(-1).release(); await tick(); assert.equal(assignment.getStatus(principal, proposal.assignmentId).status, 'completed');
  assert.ok(phases().some(function (event) { return event.id === follow && event.phase === 'completed'; }));
  for (var invalidation of ['stop', 'replaced-target', 'replaced-source']) {
    proposal = assignment.propose(principal, { projectSlug: 'target', title: 'Delayed ' + invalidation, task: 'Hold the isolated Driver result for ' + invalidation });
    var pendingId = phases().at(-1).id; await respond(proposal, 'approve'); await tick();
    var record = assignment.records.find(function (item) { return item.assignmentId === proposal.assignmentId; });
    var targetSession = f.target.sm.sessions.get(record.targetSessionId), origin = f.sourceSession.sessionOriginId;
    if (invalidation === 'stop') f.sourceSession.abortController.abort();
    if (invalidation === 'replaced-target') f.target.sm.sessions.set(targetSession.localId, Object.assign({}, targetSession, { sessionOriginId: 'replaced-target-origin' }));
    if (invalidation === 'replaced-source') f.sourceSession.sessionOriginId = 'replaced-source-origin';
    providers.at(-1).release(); await tick();
    assert.equal(f.events.some(function (event) { return event.id === pendingId && event.phase === 'completed'; }), false, invalidation);
    f.target.sm.sessions.set(targetSession.localId, targetSession); f.sourceSession.sessionOriginId = origin;
    f.sourceSession.abortController = new AbortController(); f.sourceSession.taskStopRequested = false;
  }
  // Studio presentation uses the real session-bound document service and send path.
  fs.writeFileSync(path.join(f.source.getStatus().path, 'presentation.md'), '# Isolated workbench');
  var result = await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-documents', 'present_markdown_edit', { path: 'presentation.md' });
  assert.equal(JSON.parse(result.content[0].text).ready, true); await tick();
  assert.ok(f.events.some(function (event) { return event.domain === 'studio' && event.action === 'document' && event.phase === 'delivered'; }));
  var secondaryEvents = [], secondary = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: f.sourceSession.localId, send: function (raw) { secondaryEvents.push(JSON.parse(raw)); } };
  f.source.clients.add(secondary);
  await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-documents', 'present_markdown_edit', { path: 'presentation.md' }); await tick();
  var presentation = f.events.filter(function (event) { return event.type === 'markdown_edit_present' && event.controlPresentation; }).at(-1).controlPresentation;
  var receipt = { type: 'clay_studio_rendered', id: presentation.id, token: presentation.token, revision: presentation.target.revision, sessionOriginId: presentation.sourceSessionOriginId, visible: true };
  var beforeReceipts = f.events.length;
  f.source.handleMessage({ readyState: 1, _clayUser: f.users.findUserById('foreign'), _clayActiveSession: f.sourceSession.localId }, receipt); await tick();
  assert.equal(f.events.length, beforeReceipts);
  f.source.handleMessage(f.ws, Object.assign({}, receipt, { token: 'stale-challenge' })); await tick(); assert.equal(f.events.length, beforeReceipts);
  f.source.handleMessage(f.ws, receipt); await tick();
  assert.ok(f.events.some(function (event) { return event.id === presentation.activityId && event.phase === 'rendered' && event.target.surface === 'document'; }));
  assert.equal(secondaryEvents.some(function (event) { return event.id === presentation.activityId && event.phase === 'rendered'; }), false, 'Another owner window cannot inherit this viewer render receipt'); f.source.clients.delete(secondary);
  var completedCount = f.events.length; f.source.handleMessage(f.ws, receipt); await tick(); assert.equal(f.events.length, completedCount);
  for (var change of ['stop', 'source-origin', 'generation', 'file-revision', 'late', 'viewer-context']) {
    await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-documents', 'present_markdown_edit', { path: 'presentation.md' }); await tick();
    var evidence = f.events.filter(function (event) { return event.type === 'markdown_edit_present' && event.controlPresentation; }).at(-1).controlPresentation;
    var origin = f.sourceSession.sessionOriginId, active = f.ws._clayActiveSession, now = Date.now;
    if (change === 'stop') f.sourceSession.taskStopRequested = true;
    if (change === 'source-origin') f.sourceSession.sessionOriginId = 'replaced-studio-origin';
    if (change === 'generation') f.sourceSession._sdkQueryGeneration++;
    if (change === 'file-revision') fs.writeFileSync(path.join(f.source.getStatus().path, 'presentation.md'), '# Replaced while rendering');
    if (change === 'late') Date.now = function () { return now() + 5001; };
    if (change === 'viewer-context') f.ws._clayActiveSession = 999;
    f.source.handleMessage(f.ws, { type: 'clay_studio_rendered', id: evidence.id, token: evidence.token, revision: evidence.target.revision, sessionOriginId: evidence.sourceSessionOriginId, visible: true });
    Date.now = now; await tick();
    assert.equal(f.events.some(function (event) { return event.id === evidence.activityId && event.phase === 'rendered'; }), false, change);
    f.sourceSession.taskStopRequested = false; f.sourceSession.sessionOriginId = origin; f.sourceSession._sdkQueryGeneration = 8; f.ws._clayActiveSession = active;
  }

  result = await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-documents', 'present_wireframe', { id: 'presentation-fixture', source: '@startsalt\n{ [Review] }\n@endsalt', title: 'Isolated sketch' });
  assert.equal(JSON.parse(result.content[0].text).ready, true); await tick();
  assert.ok(f.events.some(function (event) { return event.domain === 'studio' && event.action === 'sketch' && event.phase === 'delivered'; }));
  result = await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-shared-browser', 'shared_browser', { action: 'open', url: 'https://fixture.invalid/', intent: 'I will open the isolated browser transport.' });
  assert.equal(result.isError, undefined, JSON.stringify(result)); await tick();
  assert.ok(f.events.some(function (event) { return event.domain === 'studio' && event.action === 'browser' && event.phase === 'completed'; }));
  browserFailure = true;
  result = await f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-shared-browser', 'shared_browser', { action: 'open', url: 'https://uncertain.invalid/', intent: 'I will check the isolated uncertain transport.' });
  browserFailure = false; await tick(); assert.equal(result.isError, true);
  assert.equal(f.events.filter(function (event) { return event.domain === 'studio'; }).at(-1).phase, 'unknown');
  sketchRelease = false;
  var delayed = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, 8).callTool('clay-documents', 'present_wireframe', { id: 'delayed-fixture', source: '@startsalt\n{ [Delayed] }\n@endsalt' });
  await tick(); var sketchId = f.events.filter(function (event) { return event.domain === 'studio'; }).at(-1).id;
  var sourceOrigin = f.sourceSession.sessionOriginId; f.sourceSession.sessionOriginId = 'late-studio-source';
  sketchRelease(); sketchRelease = null; await delayed; await tick(); f.sourceSession.sessionOriginId = sourceOrigin;
  assert.equal(f.events.some(function (event) { return event.id === sketchId && event.phase === 'delivered'; }), false);
  for (var delivered of f.events.filter(function (event) { return event.controlPresentation; })) {
    var evidence = delivered.controlPresentation;
    f.source.handleMessage(f.ws, { type: 'clay_studio_rendered', id: evidence.id, token: evidence.token, revision: evidence.target.revision, sessionOriginId: evidence.sourceSessionOriginId, visible: false });
  }
  await tick();
  var before = f.events.filter(function (event) { return event.domain === 'studio'; }).length;
  fs.writeFileSync(path.join(f.target.getStatus().path, 'presentation.md'), '# Ordinary Driver');
  await f.target.getMcpBridgeHandler(f.session.localId, true, Number(f.session._sdkQueryGeneration || 0)).callTool('clay-documents', 'present_markdown_edit', { path: 'presentation.md' });
  await tick(); assert.equal(f.events.filter(function (event) { return event.domain === 'studio'; }).length, before);
  console.log('Real assignment/follow-up review/dispatch/completion and Studio document delivery presentation passed');
}
module.exports = { installTransport: installTransport, createQuery: createQuery, run: run };
