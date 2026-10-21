import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { livePaneBinding, paneTarget, samePaneTarget } from './pane-binding.js';

function exactReadyPane(paneEl, frame) {
  if (!paneEl || !frame || !frame.clayPane || !store.get('connected') || frame.dataset.requestedSessionId) return false;
  var live = frame.clayPane.identity();
  var sessionId = Number(paneEl.dataset.sessionId);
  var target = live && paneTarget(store.snap(), getCachedSessions(), live.sessionId);
  return !!(live && live.ready && sessionId === live.sessionId && Number(frame.dataset.sessionId) === live.sessionId &&
    live.binding && live.binding.sessionOriginId === frame.dataset.sessionOriginId &&
    samePaneTarget(target, live.binding) && livePaneBinding(frame));
}

export function syncPaneHeaderState(paneEl) {
  var header = paneEl && paneEl.querySelector('.split-pane-header');
  var frame = paneEl && paneEl.querySelector('.split-pane-frame');
  if (!header || !frame) return false;
  var ready = exactReadyPane(paneEl, frame);
  header.setAttribute('aria-busy', ready ? 'false' : 'true');
  header.dataset.paneLoading = ready ? 'false' : 'true';
  header.inert = !ready;
  var actions = header.querySelectorAll('.split-pane-info, .split-pane-search, .split-pane-context, .split-pane-sidebar, .split-view-arrange-trigger');
  for (var i = 0; i < actions.length; i++) {
    var action = actions[i];
    if (!ready) {
      if (action.dataset.panePriorDisabled == null) action.dataset.panePriorDisabled = action.disabled ? 'true' : 'false';
      action.disabled = true;
    } else if (action.dataset.panePriorDisabled != null) {
      action.disabled = action.dataset.panePriorDisabled === 'true';
      delete action.dataset.panePriorDisabled;
    }
  }
  var close = paneEl.querySelector('.split-pane-close');
  if (close) {
    var host = paneEl.parentNode;
    var singletonOnly = !!host && host.id === 'split-host' && host.dataset && host.dataset.singlePane === 'true' &&
      host.querySelectorAll('.split-pane').length === 1;
    close.hidden = singletonOnly;
    close.disabled = !ready || singletonOnly;
  }
  var title = paneEl.querySelector('.split-pane-title');
  if (title) title.setAttribute('aria-disabled', ready ? 'false' : 'true');
  return ready;
}
