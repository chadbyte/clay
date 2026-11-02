var WORKBENCH_NAMES = ['project-logs', 'you', 'issues', 'linear', 'notes-browser', 'scheduled-tasks', 'debates', 'mcp-skills', 'mate-knowledge', 'wireframe'];
// Persisted UI descriptors confer no authority. Restore must resolve every
// resource through its live authenticated service; this module performs no I/O.
var crypto = require('crypto');
var MAX_TOOLS = 16;
var MAX_PANES = 24;
function copy(value) { return JSON.parse(JSON.stringify(value)); }
function object(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function keys(value, fields) { return object(value) && Object.keys(value).sort().join(',') === fields.split(',').sort().join(','); }
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function runtimeId(value) { return id(value) || typeof value === 'string' && /^runtime:[A-Za-z0-9_-]{1,128}$/.test(value); }
function filePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 4096 &&
    !/[\\\x00-\x1f\x7f:]/.test(value) && value.split('/').every(function (part) { return part && part !== '.' && part !== '..'; });
}
function sessionId(origin) { return 'session-' + crypto.createHash('sha256').update(origin).digest('hex').slice(0, 32); }
function mapTree(tree, map) {
  if (!tree) return null;
  if (tree.id) return map[tree.id] ? { id: map[tree.id] } : null;
  var left = mapTree(tree.left, map), right = mapTree(tree.right, map);
  return !left ? right : !right ? left : { axis: tree.axis, ratio: tree.ratio, left: left, right: right };
}
function legacy(view) {
  var mapping = Object.create(null), panes = view.sessionRefs.map(function (ref) {
    var instanceId = sessionId(ref.originId); mapping[ref.originId] = instanceId;
    return { instanceId: instanceId, kind: 'session', open: true, placement: 'docked', resource: { originId: ref.originId } };
  });
  return { version: 1, panes: panes, tree: mapTree(view.tree, mapping), activePaneId: mapping[view.activeSessionOriginId] || null };
}
function normalized(view) {
  var result = copy(view);
  if (result.workspace === undefined) result.workspace = legacy(view);
  return result;
}
function validTree(tree, expected) {
  var seen = [], nodes = 0;
  function walk(node, depth) {
    if (!object(node) || ++nodes > MAX_PANES * 2 - 1 || depth > MAX_PANES) return false;
    if (keys(node, 'id')) {
      if (!id(node.id) || seen.indexOf(node.id) >= 0) return false;
      seen.push(node.id); return true;
    }
    return keys(node, 'axis,ratio,left,right') && ['horizontal', 'vertical'].indexOf(node.axis) >= 0 &&
      Number.isFinite(node.ratio) && node.ratio >= .05 && node.ratio <= .95 && walk(node.left, depth + 1) && walk(node.right, depth + 1);
  }
  if (!expected.length) return tree === null;
  return walk(tree, 0) && seen.length === expected.length && expected.every(function (value) { return seen.indexOf(value) >= 0; });
}
function sameTree(a, b) {
  if (!a || !b) return a === b;
  if (a.id || b.id) return a.id === b.id;
  return a.axis === b.axis && a.ratio === b.ratio && sameTree(a.left, b.left) && sameTree(a.right, b.right);
}
function failure(message) { return { ok: false, code: 'workspace', error: message }; }
function validate(value, view) {
  if (!object(value)) return failure('Invalid View workspace');
  if (!keys(value, 'version,panes,tree,activePaneId' + (value.linkedPair === undefined ? '' : ',linkedPair') + (value.presentation === undefined ? '' : ',presentation')) || value.version !== 1 || !Array.isArray(value.panes) || value.panes.length > MAX_PANES) return failure('Invalid View workspace');
  var instances = [], sessions = [], resources = [], docked = [], open = [], tools = 0, files = 0, overlays = 0, mapping = Object.create(null);
  for (var i = 0; i < value.panes.length; i++) {
    var pane = value.panes[i];
    if (!keys(pane, 'instanceId,kind,open,placement,resource') || !id(pane.instanceId) || instances.indexOf(pane.instanceId) >= 0 ||
        typeof pane.open !== 'boolean' || ['docked', 'overlay'].indexOf(pane.placement) < 0) return failure('Invalid or duplicate pane instance');
    instances.push(pane.instanceId);
    var resource = pane.resource;
    if (pane.kind === 'session') {
      if (!keys(resource, 'originId') || !id(resource.originId) || sessions.indexOf(resource.originId) >= 0 || !pane.open || pane.placement !== 'docked') return failure('Invalid session pane');
      sessions.push(resource.originId); mapping[pane.instanceId] = resource.originId;
    } else {
      if (++tools > MAX_TOOLS) return failure('A View supports at most sixteen tool panes');
      if (pane.kind === 'terminal' || pane.kind === 'browser') {
        var terminal = pane.kind === 'terminal';
        if (terminal ? !keys(resource, 'id,runtimeId,identity') || !Number.isSafeInteger(resource.id) || resource.id < 1 || !id(resource.identity) || !runtimeId(resource.runtimeId) :
            !keys(resource, 'id,runtimeId,sessionOriginId') || !id(resource.id) || !runtimeId(resource.runtimeId) || !id(resource.sessionOriginId)) return failure('Invalid runtime resource descriptor');
        var identity = pane.kind + ':' + resource.runtimeId + ':' + resource.id;
        if (resources.indexOf(identity) >= 0) return failure('Duplicate runtime resource');
        resources.push(identity);
      } else if (pane.kind === 'file') {
        if (++files > 8) return failure('A View supports at most eight file panes');
        if (!keys(resource, 'path,mode,rendered') || !filePath(resource.path) || ['follow', 'pin'].indexOf(resource.mode) < 0 || typeof resource.rendered !== 'boolean') return failure('Invalid file resource descriptor');
      } else if (pane.kind === 'workbench') {
        if (!keys(resource, 'name') || WORKBENCH_NAMES.indexOf(resource.name) < 0 || resources.indexOf('workbench:' + resource.name) >= 0) return failure('Invalid or duplicate workbench');
        resources.push('workbench:' + resource.name);
      } else return failure('Unknown pane kind');
    }
    if (pane.open) { open.push(pane.instanceId); if (pane.placement === 'docked') docked.push(pane.instanceId); else overlays++; }
  }
  var origins = view.sessionRefs.map(function (ref) { return ref.originId; });
  if (sessions.length !== origins.length || origins.some(function (origin) { return sessions.indexOf(origin) < 0; })) return failure('Workspace sessions must exactly match View membership');
  if (overlays > 1 || !validTree(value.tree, docked)) return failure('Workspace layout must exactly match open docked panes');
  if (open.length ? open.indexOf(value.activePaneId) < 0 : value.activePaneId !== null) return failure('Active pane must be open');
  if (!sameTree(mapTree(value.tree, mapping), view.tree)) return failure('Session tree must match the workspace session projection');
  if (value.presentation !== undefined && (!keys(value.presentation, 'focusedSessionOriginId,expandedPaneId') || value.presentation.focusedSessionOriginId !== null && sessions.indexOf(value.presentation.focusedSessionOriginId) < 0 || value.presentation.expandedPaneId !== null && !value.panes.some(function (p) { return p.kind !== 'session' && p.open && p.instanceId === value.presentation.expandedPaneId; }))) return failure('Invalid View presentation');
  if (value.linkedPair !== undefined && !require('./project-view-pair').valid(value.linkedPair, value, view)) return failure('Invalid linked Worker presentation');
  return { ok: true };
}
function samePane(a, b) {
  return a.instanceId === b.instanceId && a.kind === b.kind && a.open === b.open && a.placement === b.placement &&
    Object.keys(a.resource).length === Object.keys(b.resource).length && Object.keys(a.resource).every(function (key) { return a.resource[key] === b.resource[key]; });
}
function transition(previous, next) {
  for (var i = 0; i < next.panes.length; i++) {
    var pane = next.panes[i], prior = previous.panes.find(function (item) { return item.instanceId === pane.instanceId; });
    if (!prior) continue;
    if (pane.kind !== prior.kind || pane.kind !== 'file' && Object.keys(pane.resource).some(function (key) { return pane.resource[key] !== prior.resource[key]; })) return failure('An existing pane instance cannot change resource identity');
  }
  return { ok: true };
}
// Terminal and Browser descriptors bind to one daemon runtime. After a restart
// their expansion would hide every session behind an unavailable tool, so reads
// project it as collapsed without rewriting the saved bytes.
function withoutStaleExpansion(value, runtimeId) {
  if (!value || !value.presentation || value.presentation.expandedPaneId === null) return value;
  var expanded = value.panes.find(function (pane) { return pane.instanceId === value.presentation.expandedPaneId; });
  if (!expanded || (expanded.kind !== 'terminal' && expanded.kind !== 'browser') || expanded.resource.runtimeId === runtimeId) return value;
  var result = copy(value); result.presentation.expandedPaneId = null; return result;
}
// Session deletion never discards another pane or its binding. The legacy
// session tree is a compatibility projection of the authoritative workspace.
function removeSession(view, origin) {
  if (!view.workspace) return;
  if (view.workspace.linkedPair && view.workspace.linkedPair.driverOriginId === origin) delete view.workspace.linkedPair;
  var value = view.workspace, mapping = Object.create(null), sessionMapping = Object.create(null);
  value.panes = value.panes.filter(function (pane) { return pane.kind !== 'session' || pane.resource.originId !== origin; });
  value.panes.forEach(function (pane) { mapping[pane.instanceId] = pane.instanceId; if (pane.kind === 'session') sessionMapping[pane.instanceId] = pane.resource.originId; });
  value.tree = mapTree(value.tree, mapping);
  view.tree = mapTree(value.tree, sessionMapping);
  if (value.presentation && value.presentation.focusedSessionOriginId === origin) value.presentation.focusedSessionOriginId = null;
  if (!value.panes.some(function (pane) { return pane.open && pane.instanceId === value.activePaneId; })) {
    var active = value.panes.find(function (pane) { return pane.open; }); value.activePaneId = active ? active.instanceId : null;
  }
}
module.exports = { samePane: samePane, MAX_TOOLS: MAX_TOOLS, MAX_PANES: MAX_PANES, validate: validate, transition: transition,
  normalized: normalized, legacy: legacy, removeSession: removeSession, validFilePath: filePath, withoutStaleExpansion: withoutStaleExpansion };

module.exports.workbenchNames = WORKBENCH_NAMES;
