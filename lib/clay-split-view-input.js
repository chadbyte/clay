var z = require('zod');
var layout = require('./split-view-layout');
var id = z.string().min(1).max(128).regex(/^[A-Za-z0-9_-]+$/);
var revision = z.number().int().nonnegative();
var workspace = require('./clay-view-workspace-input');
var tree = workspace.tree;
var composition = { sessionOrigins: z.array(id).max(8), layout: z.enum(layout.PRESETS), tree: tree, activeSessionOriginId: id.nullable(), workspace: workspace.schema.optional() };
var common = { action: z.literal('split_view'), viewerRef: z.string().max(128), projectSlug: z.string().min(1).max(200), accountId: z.string().min(1).max(128).nullable(), expectedRevision: revision };
function shape(action, fields) { return z.object(Object.assign({}, common, { change: z.literal(action) }, fields)).strict(); }
var operationSchema = z.discriminatedUnion('change', [
  shape('create', Object.assign({ name: z.string().min(1).max(80) }, composition)),
  shape('update', Object.assign({ id: id, expectedViewRevision: revision }, composition)),
  shape('rename', { id: id, expectedViewRevision: revision, name: z.string().min(1).max(80) }),
  shape('separate', { id: id, expectedViewRevision: revision }),
  shape('organize', { id: id, expectedViewRevision: revision, folderId: id.nullable(), favorite: z.boolean() }),
  shape('move', { sourceViewId: id, expectedViewRevision: revision, sourceSessionOriginId: id, targetViewId: id.optional(), targetSessionOriginId: id.optional(),
    expectedTargetViewRevision: revision.optional(), targetWorkspace: workspace.schema.optional(), targetSessionOrigins: z.array(id).min(1).max(8), name: z.string().min(1).max(80), layout: z.enum(layout.PRESETS), tree: tree, activeSessionOriginId: id.nullable() }),
  shape('open', { id: id, expectedViewRevision: revision, focusOrigin: id.nullable() }),
  shape('focus', { id: id, expectedViewRevision: revision, focusOrigin: id.nullable() })
]);
module.exports = { operationSchema: operationSchema };
