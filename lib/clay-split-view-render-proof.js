var z = require('zod');
var binding = z.object({ requestId: z.string().max(128), generation: z.number().int().nonnegative(), sessionId: z.number().int(), sessionOriginId: z.string().max(128) }).strict().nullable();
var snapshotSchema = z.object({ projectSlug: z.string().max(200).nullable(), ownerId: z.string().max(128).nullable(), hidden: z.boolean(),
  viewId: z.string().max(128).nullable(), revision: z.number().int().nonnegative(), tree: require('./clay-view-workspace-input').tree, focusOrigin: z.string().max(128).nullable(),
  expandedPaneId: z.string().min(1).max(128).nullable().optional(),
  singletonOrigin: z.string().max(128).nullable(), activeSessionId: z.number().int().nullable(),
  tools: z.array(z.object({ instanceId: z.string().min(1).max(128), kind: z.enum(['file', 'terminal', 'browser']), placement: z.enum(['docked', 'overlay']).nullable().optional(), expanded: z.boolean().optional(), visible: z.boolean(), ready: z.boolean(), unavailable: z.boolean(), geometry: z.object({ x: z.number().int().min(-100000).max(100000), y: z.number().int().min(-100000).max(100000), width: z.number().int().min(0).max(100000), height: z.number().int().min(0).max(100000) }).strict().nullable() }).strict()).max(8).optional(),
  panes: z.array(z.object({ origin: z.string().max(128), sessionId: z.number().int(), visible: z.boolean(), cached: z.boolean(), ready: z.boolean(), binding: binding }).strict()).max(32)
}).strict().superRefine(function (snapshot, ctx) {
  var tools = snapshot.tools || [];
  var expanded = tools.filter(function (tool) { return tool.expanded; });
  if (expanded.length > 1 || (snapshot.expandedPaneId || null) !== (expanded[0] && expanded[0].instanceId || null)) ctx.addIssue({ code: 'custom', message: 'Invalid expanded pane observation' });
  if (new Set(tools.map(function (tool) { return tool.instanceId; })).size !== tools.length || tools.some(function (tool) { return tool.ready && tool.unavailable || tool.visible && (!tool.geometry || tool.geometry.width === 0 || tool.geometry.height === 0); })) ctx.addIssue({ code: 'custom', message: 'Invalid tool observation' });
});
function validate(target, msg, current, ws) {
  var snap = snapshotSchema.parse(msg.snapshot);
  if (current.ws !== ws || current.slug !== target.projectSlug || snap.projectSlug !== target.projectSlug || snap.ownerId !== target.expectedScreen.ownerId || msg.surface !== 'split_view') throw new Error('Rendered Split view connection changed.');
  if (!msg.visible) return;
  if ((snap.expandedPaneId || null) !== (target.view.workspace && target.view.workspace.presentation && target.view.workspace.presentation.expandedPaneId || null)) throw new Error('Rendered expansion changed.');
  if (snap.hidden || snap.viewId !== target.view.id || snap.revision !== target.view.revision || snap.focusOrigin !== target.focusOrigin || JSON.stringify(snap.tree) !== JSON.stringify(target.view.tree)) throw new Error('Rendered Split view layout changed.');
  var active = target.view.sessions.find(function (session) { return session.sessionOriginId === target.view.activeSessionOriginId; });
  if (target.view.sessions.length && (!active || snap.activeSessionId !== active.id || current.sessionId !== active.id)) throw new Error('Rendered active conversation changed.');
  var tools = snap.tools || [], expectedTools = target.view.workspace ? target.view.workspace.panes.filter(function (pane) { return pane.kind !== 'session' && pane.open && (!snap.focusOrigin || snap.expandedPaneId || pane.placement === 'overlay') && (!snap.expandedPaneId || pane.instanceId === snap.expandedPaneId); }) : [];
  if (new Set(tools.map(function (tool) { return tool.instanceId; })).size !== tools.length || expectedTools.some(function (pane) { return !tools.some(function (tool) { return tool.instanceId === pane.instanceId && tool.kind === pane.kind && tool.placement === pane.placement && !!tool.expanded === (snap.expandedPaneId === pane.instanceId) && tool.visible && tool.ready && !tool.unavailable && tool.geometry && tool.geometry.width > 0 && tool.geometry.height > 0; }); }) || tools.filter(function (tool) { return tool.visible; }).length !== expectedTools.length) throw new Error('Rendered tool panes lack exact visible ready evidence.');
  var wanted = target.view.sessions.filter(function (session) { return !snap.expandedPaneId && (!target.focusOrigin || session.sessionOriginId === target.focusOrigin); });
  var visible = snap.panes.filter(function (pane) { return pane.visible; });
  if (wanted.length !== visible.length || wanted.some(function (session) {
    var pane = visible.find(function (item) { return item.origin === session.sessionOriginId && item.sessionId === session.id; });
    return !pane || pane.cached || !pane.ready || !pane.binding || !pane.binding.requestId || pane.binding.sessionOriginId !== pane.origin || pane.binding.sessionId !== pane.sessionId;
  })) throw new Error('Rendered Split view lacks exact ready visible pane bindings.');
}
module.exports = { validate: validate, snapshotSchema: snapshotSchema };
