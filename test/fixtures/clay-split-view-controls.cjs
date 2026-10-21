var assert = require('node:assert/strict'), fs = require('node:fs');
var layout = require('../../lib/split-view-layout');
async function run(f) {
  var count = 0, sequence = 0, messages = [], sourceStopped = false, onProbe = null;
  var second = f.target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
  var third = f.target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
  var snapshot = { projectSlug: 'target', ownerId: 'owner', hidden: false, viewId: null, revision: 0, tree: null, focusOrigin: null, singletonOrigin: f.session.sessionOriginId, activeSessionId: f.session.localId, tools: [], panes: [] };
  var viewer = { readyState: 1, _clayUser: f.users.findUserById('owner'), _clayActiveSession: f.session.localId, send: function (text) {
    var msg = JSON.parse(text); messages.push(msg);
    if (msg.type === 'clay_view_probe') queueMicrotask(function () { if (onProbe) { var hook = onProbe; onProbe = null; hook(); } f.target.handleMessage(viewer, { type: 'clay_view_observed', probeId: msg.probeId, snapshot: JSON.parse(JSON.stringify(snapshot)) }); });
  } };
  f.target.clients.add(viewer); f.target.handleMessage(viewer, { type: 'clay_ui_ready', version: 1 });
  async function call(name, args) {
    var bridge = f.source.getMcpBridgeHandler(f.sourceSession.localId, true, Number(f.sourceSession._sdkQueryGeneration || 0));
    return JSON.parse((await bridge.callTool('clay-workspace', name, args)).content[0].text);
  }
  var screens = await call('read_owner_screen', { action: 'screen_context' });
  var ref = messages.find(function (msg) { return msg.type === 'clay_control_viewer'; }).viewerRef;
  function read() { return call('read_owner_screen', { action: 'split_views', projectSlug: 'target', viewerRef: ref }); }
  function operation(change, extra) {
    var state = f.target.getSplitViewControl(viewer).state();
    return Object.assign({ action: 'split_view', change: change, viewerRef: ref, projectSlug: 'target', accountId: 'owner', expectedRevision: state.revision }, extra);
  }
  async function propose(op) {
    var inspected = await call('inspect_owner_screen_change', { operation: op });
    assert.ok(inspected.targetToken, JSON.stringify(inspected));
    var args = { targetToken: inspected.targetToken, requestId: 'split-' + ++sequence, why: 'Exercise exact isolated Split view controls' };
    var promise = call('control_owner_screen', args);
    for (var i = 0; i < 8; i++) await new Promise(function (resolve) { setImmediate(resolve); });
    var keys = Object.keys(f.sourceSession.pendingAskUser || {});
    assert.ok(keys.length, 'actual authenticated review pending');
    return { args: args, promise: promise, id: keys[keys.length - 1] };
  }
  function answer(p, selection) { return f.source.handleHomeAskUserResponse({ toolId: p.id, answers: { 0: selection || 'Apply exact change' } }, f.sourceSession, f.ws); }
  function cancel(p) { var pending = f.sourceSession.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Fixture invalidation'); }
  for (var vendor of ['claude', 'codex']) {
    f.sourceSession.vendor = vendor;
    for (var fresh of [true, false]) {
      var catalog = await f.source.getMcpBridgeHandler(f.sourceSession.localId, fresh, 8).listTools();
      var screenTool = catalog.find(function (tool) { return tool.name === 'inspect_owner_screen_change'; });
      assert.ok(screenTool.inputSchema.properties.operation.properties.action.enum.includes('split_view'));
      assert.ok(screenTool.inputSchema.properties.operation.properties.change.enum.includes('move'));
      assert.ok(screenTool.inputSchema.properties.operation.properties.workspace);
      assert.ok(screenTool.inputSchema.properties.operation.properties.accountId);
      assert.ok(screenTool.inputSchema.properties.operation.properties.expectedTargetViewRevision);
      var readTool = catalog.find(function (tool) { return tool.name === 'read_owner_screen'; });
      assert.ok(readTool.inputSchema.properties.action.enum.includes('split_views')); count++;
    }
  }
  f.sourceSession.vendor = 'claude';
  var before = await read(); assert.ok(before.screen, JSON.stringify(before)); assert.equal(before.screen.status, 'observed');
  assert.equal(before.currentView.membershipSource, 'observed_singleton');
  assert.equal(before.currentView.sessions[0].id, f.session.localId); count++;
  var origins = [f.session.sessionOriginId, second.sessionOriginId];
  var create = operation('create', { name: 'Split view', layout: 'columns', sessionOrigins: origins, tree: layout.createPreset(origins, 'columns'), activeSessionOriginId: origins[0] });
  var p = await propose(create); answer(p, 'Keep unchanged'); assert.equal((await p.promise).status, 'cancelled'); assert.equal((await read()).revision, 0); count++;
  p = await propose(create); answer(p); var created = await p.promise; assert.equal(created.status, 'persisted', JSON.stringify(created));
  assert.deepEqual(await call('control_owner_screen', p.args), created); assert.equal((await read()).revision, 1); count++;
  var view = (await read()).views[0]; assert.equal(view.sessions.length, 2); assert.equal(view.tree.axis, 'horizontal');
  assert.equal((await call('inspect_owner_screen_change', { operation: create })).status, 'failed'); count++;
  for (var change of ['rename', 'organize', 'update']) {
    view = (await read()).views[0];
    var fields = { id: view.id, expectedViewRevision: view.revision };
    if (change === 'rename') fields.name = 'Reviewed view';
    if (change === 'organize') { fields.favorite = true; fields.folderId = null; }
    if (change === 'update') Object.assign(fields, { layout: 'rows', sessionOrigins: origins.concat(third.sessionOriginId), tree: layout.createPreset(origins.concat(third.sessionOriginId), 'rows'), activeSessionOriginId: second.sessionOriginId });
    p = await propose(operation(change, fields)); answer(p); assert.equal((await p.promise).status, 'persisted'); count++;
  }
  view = (await read()).views[0]; assert.equal(view.name, 'Reviewed view'); assert.equal(view.favorite, true); assert.equal(view.sessions.length, 3);
  // Human and canonical entry points use the same persisted update service.
  var human = f.target.getSplitViewControl(viewer).update(Object.assign({}, view, { accountId: 'owner', projectSlug: 'target', expectedViewRevision: view.revision, expectedRevision: (await read()).revision, sessionOrigins: view.sessions.map(function (s) { return s.sessionOriginId; }) }));
  assert.equal(human.ok, true); assert.deepEqual(human.view.tree, view.tree); count++;
  view = (await read()).views[0];
  var rename = operation('rename', { id: view.id, expectedViewRevision: view.revision, name: 'Must not persist' });
  for (var failure of ['stop', 'context', 'owner', 'project', 'generation', 'replacement']) {
    p = await propose(rename);
    if (failure === 'stop') f.sourceSession.taskStopRequested = true;
    if (failure === 'context') snapshot.focusOrigin = 'changed';
    if (failure === 'owner') viewer._clayUser = f.users.findUserById('foreign');
    if (failure === 'project') f.revoke();
    if (failure === 'generation') f.sourceSession._sdkQueryGeneration++;
    if (failure === 'replacement') f.target.sm.sessions.set(second.localId, Object.assign({}, second));
    var accepted = answer(p); if (!accepted) cancel(p);
    var result = await p.promise; assert.notEqual(result.status, 'persisted', failure); count++;
    f.sourceSession.taskStopRequested = false; snapshot.focusOrigin = null; viewer._clayUser = f.users.findUserById('owner'); f.restoreAccess(); f.sourceSession._sdkQueryGeneration = 8; f.target.sm.sessions.set(second.localId, second);
  }
  p = await propose(rename);
  var originalRename = fs.renameSync;
  fs.renameSync = function (from, to) { if (to === require('node:path').join(f.target.sm.sessionsDir, 'presentation-split-views.json')) throw new Error('Fixture Split view storage failure'); return originalRename.apply(fs, arguments); };
  try { answer(p); assert.equal((await p.promise).status, 'failed'); } finally { fs.renameSync = originalRename; }
  assert.equal((await read()).views[0].name, 'Reviewed view'); count++;
  view = (await read()).views[0];
  p = await propose(operation('open', { id: view.id, expectedViewRevision: view.revision, focusOrigin: second.sessionOriginId })); answer(p);
  var delivered = await p.promise; assert.equal(delivered.status, 'delivered', JSON.stringify(delivered)); assert.equal(delivered.visible, 'unknown');
  f.target.handleMessage(viewer, { type: 'clay_navigation_claim', deliveryId: delivered.deliveryId });
  var apply = messages.find(function (msg) { return msg.type === 'clay_navigation_apply' && msg.deliveryId === delivered.deliveryId; }); assert.ok(apply);
  f.target.handleMessage(viewer, { type: 'clay_navigation_ack', deliveryId: delivered.deliveryId, status: 'accepted' });
  viewer._clayActiveSession = second.localId; snapshot.activeSessionId = second.localId;
  var rendered = Object.assign({}, snapshot, { viewId: view.id, revision: view.revision, tree: view.tree, focusOrigin: second.sessionOriginId, singletonOrigin: null, panes: [{ origin: second.sessionOriginId, sessionId: second.localId, visible: true, cached: false, ready: true, binding: { requestId: 'exact', generation: 2, sessionId: second.localId, sessionOriginId: second.sessionOriginId } }] });
  f.target.handleMessage(viewer, { type: 'clay_navigation_rendered', deliveryId: delivered.deliveryId, renderToken: apply.renderToken, surface: 'split_view', visible: true, snapshot: rendered });
  var receipt = await call('read_owner_screen', { action: 'delivery', deliveryId: delivered.deliveryId }); assert.equal(receipt.visible, true, JSON.stringify(receipt)); count++;
  f.target.handleMessage(viewer, { type: 'clay_navigation_rendered', deliveryId: delivered.deliveryId, renderToken: apply.renderToken, surface: 'split_view', visible: false, snapshot: rendered });
  assert.equal((await call('read_owner_screen', { action: 'delivery', deliveryId: delivered.deliveryId })).visible, true); count++;
  snapshot = rendered;
  var worker = f.target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
  var archived = f.target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
  var provenance = require('../../lib/session-provenance');
  provenance.markWorker(f.session, worker, f.target.sm.sessions); worker._pairGeneration = worker.sessionProvenance.generation;
  provenance.markWorker(f.session, archived, f.target.sm.sessions); archived._pairGeneration = archived.sessionProvenance.generation;
  viewer._clayActiveSession = second.localId;
  f.target.handleMessage(viewer, { type: 'split_group_create', members: [f.session.localId, worker.localId], pair: { driverId: f.session.localId, workerId: worker.localId } });
  assert.equal(messages.filter(function (msg) { return msg.type === 'split_group_result'; }).pop().ok, true);
  worker.isProcessing = true; worker.pendingPermissions = { secret: { input: 'DO_NOT_EXPOSE' } };
  worker._pairDelegation = { taskId: 'fixture-task', workerSessionId: worker.localId, generation: worker._pairGeneration, message: 'DO_NOT_EXPOSE' };
  archived.isProcessing = false; archived.taskStopRequested = true;
  // Every persisted member remains observable while only the second member is focused.
  f.session.isProcessing = true; third.isProcessing = true; third.pendingPermissions = { fixture: {} };
  second.isProcessing = true; second.pendingAskUser = { fixture: {} };
  var awareness = await read();
  assert.equal(awareness.currentView.membershipSource, 'persisted_view');
  assert.equal(awareness.currentView.sessions.length, 3);
  function stateFor(origin) { return awareness.currentView.sessions.find(function (item) { return item.sessionOriginId === origin; }); }
  assert.equal(stateFor(f.session.sessionOriginId).runtime.state, 'working');
  assert.equal(stateFor(f.session.sessionOriginId).screen.panes.length, 0);
  assert.equal(stateFor(third.sessionOriginId).runtime.state, 'awaiting_approval');
  assert.equal(stateFor(second.sessionOriginId).runtime.state, 'awaiting_input');
  assert.equal(stateFor(second.sessionOriginId).screen.panes[0].ready, true);
  assert.equal(stateFor(second.sessionOriginId).screen.panes[0].visible, true);
  assert.match(stateFor(third.sessionOriginId).sessionRef, /^session:/); count++;
  var linked = stateFor(f.session.sessionOriginId).linkedWorkers.workers;
  assert.equal(linked.length, 2);
  assert.equal(linked[0].association, 'current'); assert.equal(linked[0].generation, worker._pairGeneration);
  assert.equal(linked[0].runtime.state, 'awaiting_approval'); assert.equal(linked[0].currentTaskId, 'fixture-task');
  assert.equal(linked[1].association, 'archived'); assert.equal(linked[1].runtime.state, 'stopped');
  assert.ok(linked[0].runtime.observedAt); assert.doesNotMatch(JSON.stringify(awareness), /DO_NOT_EXPOSE/); count++;
  worker.pendingPermissions = {}; worker._queryStarting = true; worker.isProcessing = false;
  awareness = await read(); assert.equal(stateFor(f.session.sessionOriginId).linkedWorkers.workers[0].runtime.state, 'working'); count++;
  worker._queryStarting = false; worker._responseRecoveryStopPending = {};
  awareness = await read(); assert.equal(stateFor(f.session.sessionOriginId).linkedWorkers.workers[0].runtime.state, 'recovering');
  worker._responseRecoveryStopPending = null; count++;
  worker.pendingAskUser = { review: { request: { source: 'product-control', questions: ['DO_NOT_EXPOSE'] } } };
  awareness = await read();
  var reviewState = stateFor(f.session.sessionOriginId).linkedWorkers.workers[0].runtime;
  assert.equal(reviewState.state, 'awaiting_approval'); assert.equal(reviewState.pendingReviewCount, 1); assert.equal(reviewState.pendingQuestionCount, 1);
  assert.doesNotMatch(JSON.stringify(awareness), /DO_NOT_EXPOSE/); worker.pendingAskUser = {}; count++;
  for (var invalidation of ['member-replaced', 'member-deleted', 'member-foreign', 'worker-generation', 'worker-replaced', 'worker-foreign', 'source-stop', 'revoke', 'context']) {
    onProbe = function () {
      if (invalidation === 'member-replaced') f.target.sm.sessions.set(third.localId, Object.assign({}, third));
      if (invalidation === 'member-deleted') f.target.sm.sessions.delete(third.localId);
      if (invalidation === 'member-foreign') third.ownerId = 'foreign';
      if (invalidation === 'worker-generation') worker.sessionProvenance.generation++;
      if (invalidation === 'worker-replaced') f.target.sm.sessions.set(worker.localId, Object.assign({}, worker));
      if (invalidation === 'worker-foreign') worker.ownerId = 'foreign';
      if (invalidation === 'source-stop') f.sourceSession.taskStopRequested = true;
      if (invalidation === 'revoke') f.revoke();
      if (invalidation === 'context') viewer._clayActiveSession = third.localId;
    };
    var invalid = await read(); assert.equal(invalid.status, 'failed', invalidation + JSON.stringify(invalid));
    f.target.sm.sessions.set(third.localId, third); third.ownerId = 'owner';
    f.target.sm.sessions.set(worker.localId, worker); worker.ownerId = 'owner'; worker.sessionProvenance.generation = worker._pairGeneration;
    f.sourceSession.taskStopRequested = false; f.restoreAccess(); viewer._clayActiveSession = second.localId; count++;
  }

  third.pendingPermissions = {}; second.pendingAskUser = {};
  third.taskStopRequested = true; second.isProcessing = false; second._pendingMessageDrainPaused = true;
  f.session.isProcessing = false; snapshot.hidden = true; snapshot.panes[0].cached = true;
  awareness = await read();
  assert.equal(stateFor(third.sessionOriginId).runtime.state, 'stopping');
  assert.equal(stateFor(second.sessionOriginId).runtime.state, 'stopped');
  assert.equal(stateFor(f.session.sessionOriginId).runtime.state, 'idle');
  assert.equal(stateFor(second.sessionOriginId).screen.panes[0].visible, false);
  assert.equal(stateFor(second.sessionOriginId).screen.panes[0].cached, true);
  assert.equal(stateFor(second.sessionOriginId).runtime.providerConnection, 'unknown'); count++;
  third.isProcessing = false; third.taskStopRequested = false; second._pendingMessageDrainPaused = false;
  snapshot.revision++;
  awareness = await read(); assert.equal(awareness.currentView.configurationMatches, false);
  assert.equal(awareness.currentView.sessions.length, 3); snapshot.revision--; count++;
  var priorProcessing = third.isProcessing; delete third.isProcessing;
  awareness = await read(); assert.equal(stateFor(third.sessionOriginId).runtime.state, 'unknown');
  third.isProcessing = priorProcessing; count++;
  snapshot.hidden = false; snapshot.panes[0].cached = false;
  p = await propose(operation('focus', { id: view.id, expectedViewRevision: view.revision, focusOrigin: null })); answer(p);
  var focusDelivery = await p.promise; assert.equal(focusDelivery.status, 'delivered');
  f.target.handleMessage(viewer, { type: 'clay_navigation_claim', deliveryId: focusDelivery.deliveryId });
  f.target.handleMessage(viewer, { type: 'clay_navigation_ack', deliveryId: focusDelivery.deliveryId, status: 'refused' });
  assert.equal((await call('read_owner_screen', { action: 'delivery', deliveryId: focusDelivery.deliveryId })).visible, 'unknown'); count++;
  var illegal = operation('update', { id: view.id, expectedViewRevision: view.revision, layout: 'columns', tree: layout.createPreset(origins, 'columns'), sessionOrigins: [origins[0], origins[0]], activeSessionOriginId: origins[0] });
  assert.equal((await call('inspect_owner_screen_change', { operation: illegal })).status, 'failed'); count++;
  assert.equal((await call('inspect_owner_screen_change', { operation: Object.assign({}, rename, { dispatch: 'delete_session' }) })).status, 'failed'); count++;
  second.isProcessing = true;
  p = await propose(operation('separate', { id: view.id, expectedViewRevision: view.revision })); answer(p); assert.equal((await p.promise).status, 'persisted');
  assert.equal((await read()).views.length, 0); assert.ok(f.target.sm.sessions.has(second.localId)); assert.ok(f.target.sm.sessions.has(f.session.localId)); count++;
  assert.equal(second.isProcessing, true); second.isProcessing = false;
  snapshot = Object.assign({}, snapshot, { viewId: null, revision: 0, tree: null, focusOrigin: null, panes: [] });
  var fourth = f.target.sm.createSession({ ownerId: 'owner', vendor: 'codex', sessionVisibility: 'private' });
  snapshot.activeSessionId = viewer._clayActiveSession;
  for (var pair of [origins, [third.sessionOriginId, fourth.sessionOriginId]]) {
    p = await propose(operation('create', { name: 'Split view', layout: 'columns', sessionOrigins: pair, tree: layout.createPreset(pair, 'columns'), activeSessionOriginId: pair[0] })); answer(p); assert.equal((await p.promise).status, 'persisted');
  }
  var views = (await read()).views, sourceView = views[0], destination = views[1], moved = sourceView.sessions[1].sessionOriginId;
  var targetOrigins = destination.sessions.map(function (session) { return session.sessionOriginId; }).concat(moved);
  p = await propose(operation('move', { sourceViewId: sourceView.id, expectedViewRevision: sourceView.revision, sourceSessionOriginId: moved, targetViewId: destination.id, expectedTargetViewRevision: destination.revision, targetSessionOrigins: targetOrigins, name: 'Split view', layout: 'rows', tree: layout.createPreset(targetOrigins, 'rows'), activeSessionOriginId: moved })); answer(p);
  assert.equal((await p.promise).status, 'persisted'); views = (await read()).views;
  assert.equal(views.length, 1); assert.equal(views[0].sessions.length, 3); assert.ok(f.target.sm.sessions.has(f.session.localId)); count++;
  count += await require('./clay-view-workspace-controls.cjs').run({ f: f, viewer: viewer, operation: operation, propose: propose, answer: answer, read: read, call: call,
    snapshot: function (view, tools) { snapshot = Object.assign({}, snapshot, { viewId: view.id, revision: view.revision, tree: view.tree, focusOrigin: null, singletonOrigin: null, panes: [], tools: tools }); } });
  f.target.clients.delete(viewer);
  console.log(count + ' production Split view control scenarios passed');
}
module.exports = { run: run };
