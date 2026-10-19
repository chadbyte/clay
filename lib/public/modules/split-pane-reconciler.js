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

export function reconcileSplitPanes(host, panes, createPane, updatePane, retention) {
  var desired = Array.isArray(panes) ? panes : [];
  var existing = host.querySelectorAll(retention ? ".split-pane, .split-pane-cached" : ".split-pane");
  existing = Array.from(existing);
  if (retention) existing.sort(function (a, b) { return retention.age(a) - retention.age(b); });
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
        if (candidate.parentNode === host && !used.has(candidate) && (!retention || retention.canRetarget(candidate)) && frame && frame.dataset.projectSlug === pane.slug && frame.clayPane &&
          !desired.some(function (item) { return splitPaneIdentity(item) === candidate.dataset.splitPaneKey; })) {
          paneEl = candidate; break;
        }
      }
    }
    if (!paneEl && retention) {
      while (host.querySelectorAll('.split-pane, .split-pane-cached').length >= retention.limit) {
        var victim = existing.find(function (item) { return item.parentNode === host && !used.has(item) &&
          !desired.some(function (model) { return splitPaneIdentity(model) === item.dataset.splitPaneKey; }); });
        if (!victim) break;
        retention.evict(victim);
      }
    }
    if (!paneEl) paneEl = createPane(pane, pi);
    if (retention) retention.restore(paneEl);
    paneEl.dataset.splitPaneKey = key;
    updatePane(paneEl, pane, pi);
    if (retention) retention.remember(paneEl, pane);
    if (paneEl.style) paneEl.style.order = String(pi);
    used.add(paneEl);
    if (!paneEl.parentNode) host.appendChild(paneEl);
  }
  for (var ei = existing.length - 1; ei >= 0; ei--) {
    if (!used.has(existing[ei]) && existing[ei].parentNode === host) {
      if (retention && retention.retain(existing[ei])) retention.park(existing[ei]);
      else if (retention) retention.evict(existing[ei]);
      else existing[ei].remove();
    }
  }
}
