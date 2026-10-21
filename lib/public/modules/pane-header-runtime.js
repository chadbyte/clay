import { store } from './store.js';

// Read-only presentation metadata from this pane's committed authenticated view.
export function paneHeaderRuntime() {
  var state = store.snap(), binding = state.paneCommittedBinding;
  if (!binding || !state.connected || !state.paneReady || state.paneSuspended || state.panePendingBinding ||
      state.activeSessionId !== binding.sessionId || state.sessionOriginId !== binding.sessionOriginId ||
      state.currentSlug !== binding.projectSlug || (state.myUserId || null) !== (binding.viewerId || null)) return null;
  return { binding: binding, vendor: state.currentVendor, model: state.currentModel || '' };
}

export function initPaneHeaderRuntime(frame) {
  store.subscribe(function (state, previous) {
    if (state.currentModel === previous.currentModel && state.currentVendor === previous.currentVendor) return;
    if (!paneHeaderRuntime() || frame.contentWindow !== window || frame.contentDocument !== document) return;
    frame.dispatchEvent(new window.parent.CustomEvent('clay-pane-config'));
  });
}
