import { store } from './store.js';
import { livePaneBinding, samePaneBinding } from './pane-binding.js';

export function presentationCloseTarget(pane) {
  var state = store.snap(), frame = pane && pane.querySelector('.split-pane-frame');
  var live = frame && frame.clayPane && frame.clayPane.identity();
  var view = (state.projectSplitViews || []).find(function (item) { return item.id === state.projectSplitViewActiveId; });
  if (!view || !pane || !pane.isConnected || pane.hidden || !live || !live.ready || !livePaneBinding(frame) ||
      frame.dataset.requestedSessionId || live.projectSlug !== state.currentSlug || live.ownerId !== (state.myUserId || null) ||
      frame.dataset.sessionId !== String(live.sessionId) || frame.dataset.sessionOriginId !== live.binding.sessionOriginId ||
      !view.sessions.some(function (item) { return item.id === live.sessionId && item.sessionOriginId === live.binding.sessionOriginId; })) return null;
  return { viewId: view.id, revision: state.projectSplitViewRevision, sessionId: live.sessionId,
    sessionOriginId: live.binding.sessionOriginId, frame: frame, binding: live.binding };
}

export function validPresentationClose(detail) {
  var pane = detail && detail.frame && detail.frame.closest('.split-pane');
  var current = presentationCloseTarget(pane);
  return !!(current && current.frame === detail.frame && current.viewId === detail.viewId && current.revision === detail.revision &&
    current.sessionId === detail.sessionId && current.sessionOriginId === detail.sessionOriginId && samePaneBinding(current.binding, detail.binding));
}

export function bindPresentationClose(pane) {
  var button = pane.querySelector('.split-pane-close');
  if (!button || button.dataset.presentationCloseBound) return;
  button.dataset.presentationCloseBound = 'true';
  // Target capture runs after the header's stale-pointer/key guards and before
  // any callback retained by a reused legacy execution pane.
  button.addEventListener('click', function (event) {
    if (!store.get('projectSplitViewActiveId') && !store.get('projectSplitViewSingletonOrigin')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    var detail = presentationCloseTarget(pane);
    if (detail) document.dispatchEvent(new CustomEvent('clay-split-view-close-pane', { detail: detail }));
  }, true);
}
