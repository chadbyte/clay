import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { validPresentationClose } from './split-view-presentation-close.js';
import { removeViewSession } from './split-view-member-actions.js';
import { showStandaloneEmptyCanvas } from './project-empty-canvas.js';

function viewExists(views, id) {
  return (views || []).find(function (item) { return item.id === id; }) || null;
}

export function handlePresentationClose(detail, host, nativeApp) {
  var view = viewExists(store.get('projectSplitViews'), store.get('projectSplitViewActiveId'));
  if (!detail || !validPresentationClose(detail)) return;
  if (!view && detail.kind === 'singleton') {
    var standaloneSession = (getCachedSessions() || []).find(function (item) { return item.id === Number(detail.sessionId); });
    if (!standaloneSession || standaloneSession.sessionOriginId !== detail.sessionOriginId ||
        store.get('projectSplitViewSingletonOrigin') !== standaloneSession.sessionOriginId) return;
    showStandaloneEmptyCanvas(host, nativeApp);
    return;
  }
  if (!view || detail.kind !== 'saved-view') return;
  var session = (getCachedSessions() || []).find(function (item) { return item.id === Number(detail.sessionId); });
  if (!session || !view.sessions.some(function (item) { return item.sessionOriginId === session.sessionOriginId; })) return;
  removeViewSession(view, session.sessionOriginId);
}

export function reopenEmptyCanvasSession(row, switchToStandalone) {
  var picker = store.get('projectStartPicker');
  var session = row && picker && picker.projectStart && (getCachedSessions() || []).find(function (item) { return item.id === Number(row.dataset.sessionId); });
  if (!session) return false;
  return switchToStandalone(session.id) !== false;
}

export function handleEmptyCanvasSidebarClick(target, event, switchToStandalone) {
  var row = target.closest(".session-item[data-session-id], .session-loop-child[data-session-id]"), picker = store.get('projectStartPicker');
  if (!row || !picker || !picker.projectStart || target.closest(".session-row-actions button, .session-linear-link, input, textarea, select, [contenteditable='true']")) return false;
  reopenEmptyCanvasSession(row, switchToStandalone);
  event.preventDefault(); event.stopImmediatePropagation();
  return true;
}
