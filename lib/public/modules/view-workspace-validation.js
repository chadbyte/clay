import { validLinkedPair } from './view-pair-validation.js';
import { sessionTree } from './view-workspace-state.js';
function id(value) { return typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value); }
function runtime(value) { return id(value) || typeof value === 'string' && /^runtime:[A-Za-z0-9_-]{1,128}$/.test(value); }
function fields(value, names) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join(',') === names.split(',').sort().join(','); }
function sameTree(a, b) { return !a || !b ? a === b : a.id || b.id ? a.id === b.id : a.axis === b.axis && a.ratio === b.ratio && sameTree(a.left,b.left) && sameTree(a.right,b.right); }
export function validWorkspaceView(view) {
  var value = view && view.workspace;
  if (!value || !fields(value, 'version,panes,tree,activePaneId' + (value.linkedPair === undefined ? '' : ',linkedPair') + (value.presentation === undefined ? '' : ',presentation')) || value.version !== 1 || !Array.isArray(value.panes) || value.panes.length > 16) return false;
  var instances = [], origins = [], docked = [], open = [], resources = [], tools = 0, overlays = 0;
  for (var i = 0; i < value.panes.length; i++) {
    var p = value.panes[i], r = p && p.resource;
    if (!fields(p, 'instanceId,kind,open,placement,resource') || !id(p.instanceId) || instances.indexOf(p.instanceId) >= 0 || typeof p.open !== 'boolean' || ['docked', 'overlay'].indexOf(p.placement) < 0) return false;
    instances.push(p.instanceId);
    if (p.kind === 'session') {
      if (!fields(r, 'originId') || !id(r.originId) || origins.indexOf(r.originId) >= 0 || !p.open || p.placement !== 'docked') return false;
      origins.push(r.originId);
    } else {
      if (++tools > 8) return false;
      if (p.kind === 'file') {
        if (!fields(r, 'path,mode,rendered') || typeof r.path !== 'string' || !r.path || r.path.length > 4096 || /[\\\x00-\x1f\x7f:]/.test(r.path) || !r.path.split('/').every(function(part) { return part && part !== '.' && part !== '..'; }) || ['follow', 'pin'].indexOf(r.mode) < 0 || typeof r.rendered !== 'boolean') return false;
      } else if (p.kind === 'terminal' || p.kind === 'browser') {
        if (!runtime(r && r.runtimeId)) return false;
        if (p.kind === 'terminal' ? !fields(r, 'id,identity,runtimeId') || !Number.isSafeInteger(r.id) || r.id < 1 || !id(r.identity) : !fields(r, 'id,runtimeId,sessionOriginId') || !id(r.id) || !id(r.sessionOriginId)) return false;
        var key = p.kind + ':' + r.runtimeId + ':' + r.id;
        if (resources.indexOf(key) >= 0) return false;
        resources.push(key);
      } else return false;
    }
    if (p.open) { open.push(p.instanceId); if (p.placement === 'docked') docked.push(p.instanceId); else overlays++; }
  }
  if (origins.length !== view.sessions.length || view.sessions.some(function(s) { return origins.indexOf(s.sessionOriginId) < 0; }) || overlays > 1 || (open.length ? open.indexOf(value.activePaneId) < 0 : value.activePaneId !== null)) return false;
  var seen = [], nodes = 0;
  function walk(node) {
    if (++nodes > 31) return false;
    if (fields(node, 'id')) { if (seen.indexOf(node.id) >= 0 || docked.indexOf(node.id) < 0) return false; seen.push(node.id); return true; }
    return fields(node, 'axis,ratio,left,right') && ['horizontal', 'vertical'].indexOf(node.axis) >= 0 && Number.isFinite(node.ratio) && node.ratio >= .05 && node.ratio <= .95 && walk(node.left) && walk(node.right);
  }
  if (docked.length ? !walk(value.tree) || seen.length !== docked.length : value.tree !== null) return false;
  if (value.presentation !== undefined && (!fields(value.presentation, 'focusedSessionOriginId,expandedPaneId') || value.presentation.focusedSessionOriginId !== null && origins.indexOf(value.presentation.focusedSessionOriginId) < 0 || value.presentation.expandedPaneId !== null && !value.panes.some(function (p) { return p.kind !== 'session' && p.open && p.instanceId === value.presentation.expandedPaneId; }))) return false;
  return sameTree(sessionTree(value), view.tree) && (value.linkedPair === undefined || validLinkedPair(value.linkedPair, value, { sessionRefs: view.sessions.map(function (s) { return { originId: s.sessionOriginId }; }) }));
}
