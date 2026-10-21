import { copy, mapWorkspaceTree, paneOwner } from './view-workspace-state.js';
import { listIds } from './split-view-layout-client.js';
// Coordinates never create resources. Resolve the old singleton Files slot only
// after a real file instance exists; leave other delayed slots intact.
export function boundLegacyCoordinates(record, value) {
  var next = copy(record), mapping = {};
  listIds(record.tree).forEach(function (id) { mapping[id] = id; });
  var files = value.panes.filter(function (pane) { return pane.kind === 'file' && pane.open && pane.placement === 'docked'; });
  if (files.length === 1) mapping['tool-file-viewer'] = 'tool-' + paneOwner(files[0]);
  next.tree = mapWorkspaceTree(next.tree, mapping);
  return next;
}
export function legacyCoordinatesReady(record, value) {
  var ids = value.panes.filter(function (p) { return p.open && p.placement === 'docked'; }).map(function (p) { return 'tool-' + paneOwner(p); });
  return listIds(boundLegacyCoordinates(record, value).tree).filter(function (id) { return id.indexOf('tool-') === 0; }).every(function (id) { return ids.indexOf(id) >= 0; });
}
