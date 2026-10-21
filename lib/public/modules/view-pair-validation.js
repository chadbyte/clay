// Pair presentation is UI state, never Worker membership or execution authority.
export function validLinkedPair(pair, value, view) {
  if (!pair || Object.keys(pair).sort().join(',') !== 'driverOriginId,groupId,tree,workerOrigins' || typeof pair.groupId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(pair.groupId) ||
      !view.sessionRefs.some(function (r) { return r.originId === pair.driverOriginId; }) || !Array.isArray(pair.workerOrigins) || !pair.workerOrigins.length || pair.workerOrigins.length + view.sessionRefs.length > 8 || new Set(pair.workerOrigins).size !== pair.workerOrigins.length || pair.workerOrigins.indexOf(pair.driverOriginId) >= 0 || pair.workerOrigins.some(function (id) { return typeof id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(id); })) return false;
  var mapping = {}, expected = pair.workerOrigins.slice();
  value.panes.forEach(function (p) { if (!p.open || p.placement !== 'docked') return; var id = p.kind === 'session' ? p.resource.originId : 'tool-' + (p.kind === 'file' ? 'file-' + p.instanceId : p.kind); mapping[id] = p.instanceId; expected.push(id); });
  var count = 0, seen = [];
  function walk(n) { if (!n || ++count > 31) return false; if (Object.keys(n).join(',') === 'id') { seen.push(n.id); return expected.indexOf(n.id) >= 0; } return Object.keys(n).sort().join(',') === 'axis,left,ratio,right' && ['horizontal','vertical'].indexOf(n.axis) >= 0 && Number.isFinite(n.ratio) && n.ratio >= .05 && n.ratio <= .95 && walk(n.left) && walk(n.right); }
  function project(n) { if (!n) return null; if (n.id) return mapping[n.id] ? { id: mapping[n.id] } : null; var l = project(n.left), r = project(n.right); return !l ? r : !r ? l : { axis:n.axis,ratio:n.ratio,left:l,right:r }; }
  function same(a,b) { return !a || !b ? a === b : a.id || b.id ? a.id === b.id : a.axis === b.axis && a.ratio === b.ratio && same(a.left,b.left) && same(a.right,b.right); }
  return expected.length <= 16 && walk(pair.tree) && seen.length === expected.length && new Set(seen).size === seen.length && same(project(pair.tree),value.tree);
}
