// Pane-side postMessage bridge for the split-view shell. A chrome-less pane
// iframe reports its context usage up to the parent (which renders a chip in
// the pane header) and honors panel-toggle requests coming back down.
// Same-origin messages only, both directions.

import { store } from './store.js';
import { getEffectiveContextView } from './context-view-preference.js';
import { forceExternalLinkToNewTab } from './pane-links.js';

export function reportPaneContext(data) {
  if (!store.get('paneMode') || window.parent === window) return;
  window.parent.postMessage({
    type: "clay-pane-context",
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
  window.parent.postMessage({ type: "clay-pane-auth-required", message: message }, window.location.origin);
  return true;
}

export function forwardPaneMarkdownPresentation(message) {
  if (!store.get('paneMode') || window.parent === window) return false;
  window.parent.postMessage({ type: "clay-pane-present-markdown", message: message }, window.location.origin);
  return true;
}

export function forwardPaneIssueReference(ref, projectSlug) {
  if (!store.get('paneMode') || window.parent === window) return false;
  window.parent.postMessage({ type: "clay-pane-open-issue", ref: ref, projectSlug: projectSlug || store.get('currentSlug') }, window.location.origin);
  return true;
}

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
    if (!msg || msg.type !== "clay-pane-toggle-context") return;
    togglePaneContextPanel();
  });
}
