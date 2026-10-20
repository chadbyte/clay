var z = require('zod');
var binding = z.object({ requestId: z.string().max(128), generation: z.number().int().nonnegative(), sessionId: z.number().int(), sessionOriginId: z.string().max(128) }).strict().nullable();
var snapshotSchema = z.object({ projectSlug: z.string().max(200).nullable(), ownerId: z.string().max(128).nullable(), hidden: z.boolean(),
  viewId: z.string().max(128).nullable(), revision: z.number().int().nonnegative(), tree: z.unknown().nullable(), focusOrigin: z.string().max(128).nullable(),
  singletonOrigin: z.string().max(128).nullable(), activeSessionId: z.number().int().nullable(),
  panes: z.array(z.object({ origin: z.string().max(128), sessionId: z.number().int(), visible: z.boolean(), cached: z.boolean(), ready: z.boolean(), binding: binding }).strict()).max(32)
}).strict();
function validate(target, msg, current, ws) {
  var snap = snapshotSchema.parse(msg.snapshot);
  if (current.ws !== ws || current.slug !== target.projectSlug || snap.projectSlug !== target.projectSlug || snap.ownerId !== target.expectedScreen.ownerId || msg.surface !== 'split_view') throw new Error('Rendered Split view connection changed.');
  if (!msg.visible) return;
  if (snap.hidden || snap.viewId !== target.view.id || snap.revision !== target.view.revision || snap.focusOrigin !== target.focusOrigin || JSON.stringify(snap.tree) !== JSON.stringify(target.view.tree)) throw new Error('Rendered Split view layout changed.');
  var active = target.view.sessions.find(function (session) { return session.sessionOriginId === target.view.activeSessionOriginId; });
  if (!active || snap.activeSessionId !== active.id || current.sessionId !== active.id) throw new Error('Rendered active conversation changed.');
  var wanted = target.view.sessions.filter(function (session) { return !target.focusOrigin || session.sessionOriginId === target.focusOrigin; });
  var visible = snap.panes.filter(function (pane) { return pane.visible; });
  if (wanted.length !== visible.length || wanted.some(function (session) {
    var pane = visible.find(function (item) { return item.origin === session.sessionOriginId && item.sessionId === session.id; });
    return !pane || pane.cached || !pane.ready || !pane.binding || !pane.binding.requestId || pane.binding.sessionOriginId !== pane.origin || pane.binding.sessionId !== pane.sessionId;
  })) throw new Error('Rendered Split view lacks exact ready visible pane bindings.');
}
module.exports = { validate: validate, snapshotSchema: snapshotSchema };
