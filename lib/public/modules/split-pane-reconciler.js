// Keyed DOM reconciliation for the parent split shell. Existing pane nodes
// (and their iframe browsing contexts) are reused by stable project/session
// identity while metadata and visual order are refreshed.

export function splitPaneIdentity(pane) {
  return String(pane && pane.slug || "") + "#" + String(pane && pane.sessionId || "");
}

export function reconcileSplitPanes(host, panes, createPane, updatePane) {
  var desired = Array.isArray(panes) ? panes : [];
  var existing = host.querySelectorAll(".split-pane");
  var byKey = new Map();
  for (var i = 0; i < existing.length; i++) byKey.set(existing[i].dataset.splitPaneKey, existing[i]);
  var used = new Set();
  for (var pi = 0; pi < desired.length; pi++) {
    var pane = desired[pi];
    var key = splitPaneIdentity(pane);
    var paneEl = byKey.get(key);
    if (!paneEl) paneEl = createPane(pane, pi);
    paneEl.dataset.splitPaneKey = key;
    updatePane(paneEl, pane, pi);
    used.add(paneEl);
    if (!paneEl.parentNode) host.appendChild(paneEl);
  }
  for (var ei = existing.length - 1; ei >= 0; ei--) {
    if (!used.has(existing[ei])) existing[ei].remove();
  }
}
