var z = require('zod');
var workspace = require('./project-view-workspace');
var id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
var node = z.lazy(function () { return z.union([z.object({ id: id }).strict(), z.object({ axis: z.enum(['horizontal', 'vertical']), ratio: z.number().min(.05).max(.95), left: node, right: node }).strict()]); });
var tree = node.nullable().refine(function (value) {
  var count = 0;
  function walk(item, depth) { return !item || ++count <= 47 && depth <= 23 && (item.id || walk(item.left, depth + 1) && walk(item.right, depth + 1)); }
  return !!walk(value, 0);
});
var base = { instanceId: id, open: z.boolean(), placement: z.enum(['docked', 'overlay']) };
function pane(kind, resource) { return z.object(Object.assign({}, base, { kind: z.literal(kind), resource: z.object(resource).strict() })).strict(); }
var runtime = z.string().max(136).regex(/^(runtime:)?[A-Za-z0-9_-]+$/);
var schema = z.object({ version: z.literal(1), panes: z.array(z.discriminatedUnion('kind', [
  pane('session', { originId: id }),
  pane('file', { path: z.string().min(1).max(4096).refine(workspace.validFilePath), mode: z.enum(['follow', 'pin']), rendered: z.boolean() }),
  pane('terminal', { id: z.number().int().positive(), runtimeId: runtime, identity: id }),
  pane('workbench', { name: z.enum(workspace.workbenchNames) }),
  pane('browser', { id: id, runtimeId: runtime, sessionOriginId: id })
])).max(workspace.MAX_PANES), tree: tree, activePaneId: id.nullable(), presentation: z.object({ focusedSessionOriginId: id.nullable(), expandedPaneId: id.nullable() }).strict().optional(), linkedPair: z.object({ groupId: id, driverOriginId: id, workerOrigins: z.array(id).min(1).max(7), tree: tree }).strict().optional() }).strict();
function validateOperation(op, saved, view) {
  var target = op.change === 'move' ? saved.views.find(function (item) { return item.id === op.targetViewId; }) : view;
  if (op.change === 'move' && op.targetViewId && (!target || target.revision !== op.expectedTargetViewRevision)) throw new Error('Exact target View revision changed.');
  var value = op.workspace || op.targetWorkspace;
  if (!value) return;
  var origins = op.sessionOrigins || op.targetSessionOrigins || [];
  var valid = workspace.validate(value, { tree: op.tree, sessionRefs: origins.map(function (origin) { return { originId: origin }; }) });
  if (!valid.ok) throw new Error(valid.error);
  var prior = target && target.workspace || { panes: [] };
  function pairIdentity(pair) { return pair && [pair.groupId, pair.driverOriginId, pair.workerOrigins]; }
  if (JSON.stringify(pairIdentity(prior.linkedPair)) !== JSON.stringify(pairIdentity(value.linkedPair))) throw new Error('Changing linked Worker presentation is unavailable through canonical View composition.');
  var transition = workspace.transition(prior, value); if (!transition.ok) throw new Error(transition.error);
  value.panes.forEach(function (pane) {
    if (pane.kind === 'session' || pane.kind === 'workbench') return;
    var existing = prior.panes.find(function (item) { return item.instanceId === pane.instanceId && item.kind === pane.kind; });
    // Registered workbench shells use their existing UI entrypoints. Runtime and
    // file changes operate existing resources only; creating or rebinding
    // a resource requires its separate typed, authorized resource operation.
    if (!existing || (pane.kind === 'file' ? pane.resource.path !== existing.resource.path : Object.keys(pane.resource).some(function (key) { return pane.resource[key] !== existing.resource[key]; }))) throw new Error('New or rebound tool resources are unavailable through View composition.');
  });
}
function reviewText(op, view) {
  var value = op.workspace || op.targetWorkspace;
  if (!value) return JSON.stringify(op);
  var copy = Object.assign({}, op); delete copy.workspace; delete copy.targetWorkspace; delete copy.viewerRef; delete copy.tree;
  var prior = view && view.workspace || { panes: [] };
  var changes = value.panes.map(function (pane) {
    var old = prior.panes.find(function (item) { return item.instanceId === pane.instanceId; });
    if (!old) return pane;
    var delta = { instanceId: pane.instanceId }, changed = false;
    ['kind', 'open', 'placement'].forEach(function (key) { if (old[key] !== pane[key]) { delta[key] = pane[key]; changed = true; } });
    var resource = {}; Object.keys(pane.resource).forEach(function (key) { if (old.resource[key] !== pane.resource[key]) { resource[key] = pane.resource[key]; changed = true; } });
    if (Object.keys(resource).length) delta.resource = resource;
    if (changed) { delta.kind = pane.kind; delta.binding = pane.kind === 'file' ? { path: old.resource.path } : old.resource; }
    return changed ? delta : null;
  }).filter(Boolean);
  var removed = prior.panes.filter(function (pane) { return !value.panes.some(function (next) { return next.instanceId === pane.instanceId; }); }).map(function (pane) { return { instanceId: pane.instanceId, kind: pane.kind, binding: pane.resource }; });
  return JSON.stringify(copy) + '\nWorkspace v1 changes: ' + JSON.stringify({ panes: changes, removed: removed, tree: value.tree, activePaneId: value.activePaneId, linkedPair: value.linkedPair, presentation: value.presentation });
}
function validateObservation(saved, observed) {
  if (!observed || observed.status !== 'observed') return;
  var snapshot = observed.snapshot;
  if (!snapshot.viewId) { if ((snapshot.tools || []).length) throw new Error('Tool observation lacks an exact saved View.'); return; }
  var view = saved.views.find(function (item) { return item.id === snapshot.viewId; });
  if (!view) return; // A stale client observation never establishes saved membership.
  if (snapshot.revision !== view.revision) return;
  if (snapshot.expandedPaneId && !(snapshot.tools || []).some(function (tool) { return tool.instanceId === snapshot.expandedPaneId && tool.expanded; })) throw new Error('Expanded pane lacks exact observed tool evidence.');
  (snapshot.tools || []).forEach(function (tool) {
    if (!view.workspace || !view.workspace.panes.some(function (pane) { return pane.instanceId === tool.instanceId && pane.kind === tool.kind && (!tool.visible || pane.open); })) throw new Error('Observed tool does not belong to the exact saved View.');
  });
}
module.exports = { validateObservation: validateObservation, schema: schema, tree: tree, validateOperation: validateOperation, reviewText: reviewText, MAX_OPERATION_BYTES: 48000 };
