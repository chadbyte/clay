import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { mutation } from './view-mutations.js';
import { remove, validateTree } from './split-view-layout-client.js';
import { showToast } from './utils.js';
import { iconHtml } from './icons.js';
import { closeSessionContextMenu } from './session-context-menu.js';

export function removeViewSession(view, origin) {
  var live = (store.get('projectSplitViews') || []).find(function (item) { return item.id === view.id && item.revision === view.revision; });
  if (!live || !live.sessions.some(function (session) { return session.sessionOriginId === origin; })) return false;
  var active = live.id === store.get('projectSplitViewActiveId');
  if (active) {
    try {
      document.querySelectorAll('#split-host .split-pane-frame').forEach(function (frame) { if (frame.clayPane) frame.clayPane.checkDraft(); });
    } catch (error) { showToast(error.message, 'warn'); return false; }
  }
  var origins = live.sessions.map(function (session) { return session.sessionOriginId; }).filter(function (item) { return item !== origin; });
  var tree = remove(live.tree, origin);
  if (!validateTree(tree, origins).ok) return false;
  var nextActive = live.activeSessionOriginId === origin ? origins[0] || null : live.activeSessionOriginId;
  return mutation('project_split_view_update', { id: live.id, sessionOrigins: origins, tree: tree,
    layout: live.layout, activeSessionOriginId: nextActive, active: active }, active ? { closedOrigin: origin, activeOrigin: nextActive } : null);
}

export function appendRemoveFromView(menu, session, currentAnchor) {
  if (!session || session.sessionRole === 'worker') return;
  var view = (store.get('projectSplitViews') || []).find(function (item) {
    return item.sessions.length > 1 && item.sessions.some(function (ref) { return ref.sessionOriginId === session.sessionOriginId; });
  });
  if (!view) return;
  var socket = getWs(), slug = store.get('currentSlug'), viewer = store.get('myUserId'), generation = store.get('projectSplitViewSocketGeneration');
  var button = document.createElement('button'); button.className = 'session-ctx-item';
  button.innerHTML = iconHtml('panel-left-close') + ' <span>Remove from View</span>';
  button.disabled = !!store.get('projectSplitViewPending');
  button.addEventListener('click', function (event) {
    event.stopPropagation(); var anchor = currentAnchor(); closeSessionContextMenu(false);
    if (!anchor || socket !== getWs() || slug !== store.get('currentSlug') || viewer !== store.get('myUserId') || generation !== store.get('projectSplitViewSocketGeneration')) return;
    removeViewSession(view, session.sessionOriginId);
  });
  menu.appendChild(button);
}
