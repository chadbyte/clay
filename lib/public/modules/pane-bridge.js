import { forwardStudioPresentation } from './clay-studio-render.js';
// Pane-side postMessage bridge for the split-view shell. A chrome-less pane
// iframe reports its context usage up to the parent (which renders a chip in
// the pane header) and honors panel-toggle requests coming back down.
// Same-origin messages only, both directions.

import { store } from './store.js';
import { beginPaneLayoutScrollLock, endPaneLayoutScrollLock } from './chat-render-runtime.js';
import { paneMessageBinding, samePaneBinding } from './pane-binding.js';
import { getEffectiveContextView } from './context-view-preference.js';
import { forceExternalLinkToNewTab } from './pane-links.js';
import { toggleSearch } from './session-search.js';

export function reportPaneContext(data) {
  if (!store.get('paneMode') || window.parent === window) return;
  window.parent.postMessage({
    type: "clay-pane-context",
    paneBinding: paneMessageBinding(),
    sessionId: store.get('activeSessionId'),
    pct: data.pct,
    used: data.used,
    win: data.win,
    cls: data.cls,
    model: data.model,
    cost: data.cost,
  }, window.location.origin);
}

// A pane has no banner surface and no login modal of its own, so both panes
// hitting auth_required would otherwise race to start their own login flow.
// Hand the event to the parent shell, which owns the single flow.
export function forwardPaneAuthRequired(message) {
  if (!store.get('paneMode') || window.parent === window) return false;
  window.parent.postMessage({ type: "clay-pane-auth-required", paneBinding: paneMessageBinding(), message: message }, window.location.origin);
  return true;
}

export function forwardPaneMarkdownPresentation(message) {
  if (!store.get('paneMode') || window.parent === window) return false;
  return forwardStudioPresentation(message, "clay-pane-present-markdown");
}

export function forwardPaneIssueReference(ref, projectSlug) {
  if (!store.get('paneMode') || window.parent === window) return false;
  window.parent.postMessage({ type: "clay-pane-open-issue", paneBinding: paneMessageBinding(), ref: ref, projectSlug: projectSlug || store.get('currentSlug') }, window.location.origin);
  return true;
}

export { forwardPaneFileReference } from './pane-file-bridge.js';

// Toggle without setContextView: panes use a transient override and must not
// rewrite the user's server-persisted main-view preference.
function togglePaneContextPanel() {
  var effectiveView = getEffectiveContextView();
  store.set({ contextViewOverride: effectiveView === "panel" ? "off" : "panel" });
}

function preparePaneLink(event) {
  var target = event.target;
  if (!target || typeof target.closest !== "function") return;
  var anchor = target.closest("a[href]");
  if (!anchor || anchor.hasAttribute("download")) return;
  forceExternalLinkToNewTab(anchor, window.location.href);
}

export function initPaneBridge() {
  if (!store.get('paneMode')) return;
  // Hydration may still replace the persisted mode. Leave the override null
  // so the first header toggle derives from the actual effective view.
  store.set({ contextViewOverride: null });
  document.addEventListener("click", preparePaneLink, true);
  document.addEventListener("auxclick", preparePaneLink, true);
  window.addEventListener("message", function (event) {
    if (event.origin !== window.location.origin) return;
    var msg = event.data;
    if (!msg || (msg.type !== "clay-pane-toggle-context" && msg.type !== "clay-pane-toggle-search" && msg.type !== "clay-pane-layout-resize")) return;
    var committed = store.get('paneCommittedBinding');
    if (event.source !== window.parent || !committed || !paneMessageBinding() ||
        !samePaneBinding(committed, msg.paneBinding) || !samePaneBinding(paneMessageBinding(), msg.paneBinding)) return;
    if (msg.type === "clay-pane-layout-resize") {
      if (msg.phase === 'begin') beginPaneLayoutScrollLock(msg.token, msg.scrollTop);
      else if (msg.phase === 'end') endPaneLayoutScrollLock(msg.token);
    } else if (msg.type === "clay-pane-toggle-context") togglePaneContextPanel();
    else toggleSearch();
  });
}
