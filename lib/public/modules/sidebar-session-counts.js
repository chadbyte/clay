// Display-only sidebar counts. Destructive Clear actions keep their separate
// authoritative session-id scope and cascade semantics.

function sessionId(session) {
  return session && typeof session.id === "number" ? session.id : null;
}

function addSession(session, roots, workers) {
  var id = sessionId(session);
  if (id === null) return;
  if (session.sessionRole === "worker") workers.add(id);
  else roots.add(id);
}

function visibleWorker(worker, driver, matchIds) {
  return matchIds === null || matchIds === undefined || matchIds.has(worker.id) || matchIds.has(driver.id);
}

function addItem(item, roots, workers, matchIds) {
  if (!item) return;
  if (item.type === "session") {
    addSession(item.data, roots, workers);
    return;
  }
  if (item.type === "driver-hierarchy") {
    addSession(item.root && item.root.driver, roots, workers);
    var children = item.root && item.root.workers || [];
    for (var i = 0; i < children.length; i++) if (visibleWorker(children[i], item.root.driver, matchIds)) addSession(children[i], roots, workers);
    return;
  }
  var sessions = item.type === "orphan-workers" ? item.workers : item.type === "split-group" ? item.members : item.type === "loop" ? item.children : [];
  for (var j = 0; j < (sessions || []).length; j++) {
    if (item.type === "orphan-workers" && matchIds !== null && matchIds !== undefined && !matchIds.has(sessions[j].id)) continue;
    addSession(sessions[j], roots, workers);
  }
}

export function summarizeSidebarItems(items, matchIds) {
  var roots = new Set();
  var workers = new Set();
  for (var i = 0; i < (items || []).length; i++) addItem(items[i], roots, workers, matchIds);
  return { roots: roots.size, workers: workers.size };
}

export function summarizeSidebarUnits(units, matchIds) {
  return summarizeSidebarItems((units || []).map(function (unit) { return unit.item; }), matchIds);
}

export function sidebarCountLabel(counts, short) {
  var roots = counts && counts.roots || 0;
  var workers = counts && counts.workers || 0;
  if (short) return roots + (roots === 1 ? " Driver" : " Drivers") + " · " + workers + (workers === 1 ? " Split Worker" : " Split Workers");
  return roots + (roots === 1 ? " Driver session" : " Driver sessions") + " and " + workers + (workers === 1 ? " Split Worker session" : " Split Worker sessions");
}

export function renderSidebarCount(className, counts, focusable) {
  var count = document.createElement("span");
  count.className = className + " session-count-summary";
  count.textContent = String(counts.roots);
  count.dataset.countDetail = sidebarCountLabel(counts, true);
  count.setAttribute("aria-label", sidebarCountLabel(counts, false));
  count.title = sidebarCountLabel(counts, false);
  if (focusable) count.tabIndex = 0;
  return count;
}
