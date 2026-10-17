// Keyed DOM reconciliation for the parent split shell. Existing pane nodes
// (and their iframe browsing contexts) are reused by stable project/session
// identity while metadata and visual order are refreshed.

export function splitPaneForSession(id, slug, sessions) {
  var session = (sessions || []).find(function (item) { return item.id === id; });
  return { slug: slug, sessionId: id, title: session && session.title || ('Session ' + id) };
}

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
    if (!paneEl) {
      for (var ci = 0; ci < existing.length; ci++) {
        var candidate = existing[ci], frame = candidate.querySelector('.split-pane-frame');
        if (!used.has(candidate) && frame && frame.dataset.projectSlug === pane.slug && frame.clayPane &&
          !desired.some(function (item) { return splitPaneIdentity(item) === candidate.dataset.splitPaneKey; })) {
          paneEl = candidate; break;
        }
      }
    }
    if (!paneEl) paneEl = createPane(pane, pi);
    paneEl.dataset.splitPaneKey = key;
    updatePane(paneEl, pane, pi);
    if (paneEl.style) paneEl.style.order = String(pi);
    used.add(paneEl);
    if (!paneEl.parentNode) host.appendChild(paneEl);
  }
  for (var ei = existing.length - 1; ei >= 0; ei--) {
    if (!used.has(existing[ei])) existing[ei].remove();
  }
}
