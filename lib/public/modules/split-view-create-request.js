// Pure request preparation for explicitly arranging Driver sessions.
import { preset, place, listIds } from './split-view-layout-client.js';

export function buildSplitViewCreateRequest(origins, sessions, activeSessionId, activeView) {
  if (!Array.isArray(origins) || origins.length < 2 || origins.length > 8 || new Set(origins).size !== origins.length) return { ok: false, error: "Choose two to eight unique sessions." };
  var selected = origins.map(function (origin) { return (sessions || []).find(function (session) { return session.sessionOriginId === origin; }); });
  if (selected.some(function (session) { return !session || session.sessionRole === 'worker' || session.isMate || session.isTui; })) return { ok: false, error: "One or more selected sessions are no longer available." };
  if (activeView) {
    var currentOrigins = activeView.sessions.map(function (session) { return session.sessionOriginId; });
    if (!currentOrigins.every(function (origin) { return origins.indexOf(origin) !== -1; })) return { ok: false, error: "Choose sessions from this Split view or from individual sessions." };
    var tree = activeView.tree, sourceOrigin = activeView.activeSessionOriginId;
    for (var i = 0; i < origins.length; i++) if (currentOrigins.indexOf(origins[i]) === -1) {
      var placed = place(tree, origins[i], sourceOrigin, 'right', 0.5);
      if (!placed.ok) return { ok: false, error: placed.reason || "Session could not be added." };
      tree = placed.tree;
    }
    return { ok: true, type: 'project_split_view_update', body: { id: activeView.id, sessionOrigins: listIds(tree), tree: tree,
      layout: activeView.layout, activeSessionOriginId: activeView.activeSessionOriginId } };
  }
  var tree = preset(origins, 'balanced'), current = selected.find(function (session) { return session.id === Number(activeSessionId); });
  return { ok: true, type: 'project_split_view_create', body: { name: 'Split view', sessionOrigins: origins, tree: tree,
    layout: 'balanced', activeSessionOriginId: current ? current.sessionOriginId : origins[0] }, meta: { activateCreatedView: true } };
}
