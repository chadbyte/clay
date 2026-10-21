var assert = require('node:assert/strict');
async function run(h) {
  var count = 0, workspace = require('../../lib/project-view-workspace');
  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  async function apply(op) { var p = await h.propose(op); h.answer(p); var result = await p.promise; assert.equal(result.status, 'persisted', JSON.stringify(result)); assert.equal(result.broadcast, 'attempted'); assert.equal(result.uiObserved, false); return { result: result, proposal: p }; }
  var empty = { version: 1, panes: [], tree: null, activePaneId: null };
  var created = await apply(h.operation('create', { name: 'Empty View', sessionOrigins: [], tree: null, layout: 'columns', activeSessionOriginId: null, workspace: empty }));
  var view = (await h.read()).views.find(function (v) { return v.id === created.result.view.id; });
  assert.equal(view.sessions.length, 0); count++;
  function update(value) { return h.operation('update', { id: view.id, expectedViewRevision: view.revision, sessionOrigins: view.sessions.map(function (s) { return s.sessionOriginId; }), tree: view.tree, layout: view.layout, activeSessionOriginId: view.activeSessionOriginId, workspace: value }); }
  var file = { instanceId: 'existing-file', kind: 'file', open: true, placement: 'docked', resource: { path: 'README.md', mode: 'follow', rendered: true } };
  var tools = { version: 1, panes: [file], tree: { id: file.instanceId }, activePaneId: file.instanceId };
  assert.equal((await h.call('inspect_owner_screen_change', { operation: update(tools) })).status, 'failed'); count++;
  var api = h.f.target.getSplitViewControl(h.viewer), human = api.update(update(tools));
  assert.equal(human.ok, true); api.publish(); view = (await h.read()).views.find(function (v) { return v.id === view.id; });
  h.snapshot(view, [{ instanceId: file.instanceId, kind: 'file', visible: true, ready: true, unavailable: false, geometry: { x: 0, y: 0, width: 400, height: 600 } }]);
  var awareness = await h.read(); assert.equal(awareness.currentView.toolPanes[0].configurationRevision, view.revision); assert.equal(awareness.currentView.toolPanes[0].screen.ready, true); assert.equal(awareness.currentView.sessions.length, 0); count++;
  h.snapshot(view, [{ instanceId: 'foreign-instance', kind: 'file', visible: true, ready: true, unavailable: false, geometry: { x: 0, y: 0, width: 100, height: 100 } }]);
  assert.equal((await h.read()).status, 'failed'); count++;
  h.snapshot(view, []);
  var pinned = clone(view.workspace); pinned.panes[0].resource.mode = 'pin';
  var done = await apply(update(pinned)); assert.deepEqual(await h.call('control_owner_screen', done.proposal.args), done.result); count++;
  view = (await h.read()).views.find(function (v) { return v.id === view.id; }); h.snapshot(view, []);
  var rebound = clone(view.workspace); rebound.panes[0].resource.path = 'foreign.md';
  assert.equal((await h.call('inspect_owner_screen_change', { operation: update(rebound) })).status, 'failed');
  assert.equal((await h.call('inspect_owner_screen_change', { operation: Object.assign(update(view.workspace), { accountId: 'foreign' }) })).status, 'failed'); count++;
  var changed = clone(view.workspace); changed.panes[0].resource.mode = 'follow';
  var p = await h.propose(update(changed));
  h.f.sourceSession.taskStopRequested = true; if (!h.answer(p)) { var pending = h.f.sourceSession.pendingAskUser[p.id]; if (pending) pending.respond.cancel('Stopped'); }
  assert.notEqual((await p.promise).status, 'persisted'); h.f.sourceSession.taskStopRequested = false; count++;
  var origin = h.f.session.sessionOriginId, sessionPane = workspace.legacy({ sessionRefs: [{ originId: origin }], tree: { id: origin }, activeSessionOriginId: origin }).panes[0];
  var mixed = clone(view.workspace); mixed.panes.unshift(sessionPane); mixed.tree = { axis: 'horizontal', ratio: .4, left: { id: sessionPane.instanceId }, right: mixed.tree };
  await apply(Object.assign(update(mixed), { sessionOrigins: [origin], tree: { id: origin }, activeSessionOriginId: origin }));
  view = (await h.read()).views.find(function (v) { return v.id === view.id; }); assert.equal(view.sessions.length, 1); assert.equal(view.workspace.panes[1].resource.mode, 'pin'); count++;
  h.snapshot(view, []);
  var presentation = clone(view.workspace); presentation.presentation = { focusedSessionOriginId: origin, expandedPaneId: file.instanceId };
  await apply(update(presentation)); view = (await h.read()).views.find(function (v) { return v.id === view.id; });
  assert.deepEqual(view.workspace.presentation, presentation.presentation); h.snapshot(view, []); count++;
  var huge = Object.assign(update(view.workspace), { name: 'x'.repeat(49000) });
  assert.equal((await h.call('inspect_owner_screen_change', { operation: huge })).status, 'failed'); count++;
  var destination = (await h.read()).views.find(function (v) { return v.id !== view.id; });
  var movedWorkspace = clone(destination.workspace); movedWorkspace.panes.push(sessionPane);
  movedWorkspace.tree = { axis: 'horizontal', ratio: .5, left: movedWorkspace.tree, right: { id: sessionPane.instanceId } };
  var move = h.operation('move', { sourceViewId: view.id, expectedViewRevision: view.revision, sourceSessionOriginId: origin, targetViewId: destination.id, expectedTargetViewRevision: destination.revision, targetSessionOrigins: destination.sessions.map(function (s) { return s.sessionOriginId; }).concat(origin), name: destination.name, layout: 'columns', tree: { axis: 'horizontal', ratio: .5, left: destination.tree, right: { id: origin } }, activeSessionOriginId: origin, targetWorkspace: movedWorkspace });
  assert.equal((await h.call('inspect_owner_screen_change', { operation: Object.assign({}, move, { expectedTargetViewRevision: destination.revision - 1 }) })).status, 'failed'); count++;
  await apply(move); view = (await h.read()).views.find(function (v) { return v.id === view.id; }); assert.equal(view.sessions.length, 0); assert.equal(view.workspace.panes[0].resource.mode, 'pin'); count++;
  h.snapshot(view, []);
  await apply(update(empty)); count++;
  view = (await h.read()).views.find(function (v) { return v.id === view.id; }); h.snapshot(view, []);
  var logsPane = { instanceId: 'logs-pane', kind: 'workbench', open: true, placement: 'docked', resource: { name: 'project-logs' } };
  await apply(update({ version: 1, panes: [logsPane], tree: { id: logsPane.instanceId }, activePaneId: logsPane.instanceId }));
  view = (await h.read()).views.find(function (v) { return v.id === view.id; });
  h.snapshot(view, [{ instanceId: logsPane.instanceId, kind: 'workbench', placement: 'docked', visible: true, ready: true, unavailable: false, geometry: { x: 0, y: 0, width: 400, height: 600 } }]);
  awareness = await h.read(); assert.equal(awareness.currentView.toolPanes[0].resource.name, 'project-logs'); assert.equal(awareness.currentView.toolPanes[0].screen.ready, true); count++;
  var badPanel = clone(view.workspace); badPanel.panes[0].resource.name = 'settings';
  assert.equal((await h.call('inspect_owner_screen_change', { operation: update(badPanel) })).status, 'failed'); count++;
  await apply(update(empty)); count++;
  return count;
}
module.exports = { run: run };
