// Describes the server deletion scope so confirmations never understate it.
// Deleting a Driver also deletes every Split Worker session it owns,
// including hidden sessions and previous generations. The server sends that
// full total as `ownedWorkerCount`; the visible list alone can miss hidden
// Workers, so it never stands in for the total. When the total is unknown,
// the wording says so and a dialog is required. Deleting a Worker affects only
// that Worker.

var FULL_SCOPE = "including hidden sessions and previous generations";

export function ownedWorkerIds(driverId, sessions) {
  var list = Array.isArray(sessions) ? sessions : [];
  var ids = [];
  for (var i = 0; i < list.length; i++) {
    var session = list[i];
    if (session && session.sessionRole === "worker" && session.parentAvailable && session.parentSessionId === driverId) {
      ids.push(session.id);
    }
  }
  return ids;
}

function findSession(sessionId, sessions) {
  var list = Array.isArray(sessions) ? sessions : [];
  for (var i = 0; i < list.length; i++) if (list[i] && list[i].id === sessionId) return list[i];
  return null;
}

// { worker: true } | { known: true, visible, total } | { known: false, visible }
function ownership(session, sessions) {
  if (!session) return { known: false, visible: [] };
  if (session.sessionRole === "worker") return { worker: true, visible: [] };
  var visible = ownedWorkerIds(session.id, sessions);
  if (typeof session.ownedWorkerCount !== "number" || session.ownedWorkerCount < 0) return { known: false, visible: visible };
  return { known: true, visible: visible, total: Math.max(session.ownedWorkerCount, visible.length) };
}

function workerPhrase(count) {
  return count + " Split Worker " + (count === 1 ? "session" : "sessions");
}

export function describeSessionDelete(session, sessions) {
  var cached = session ? findSession(session.id, sessions) : null;
  var resolved = cached || (session && session.sessionRole ? session : null);
  var title = (session && session.title) || (cached && cached.title) || "New Session";
  var base = 'Delete "' + title + '"? ';
  var owner = ownership(resolved, sessions);
  if (owner.worker || (owner.known && owner.total === 0)) {
    return { workerCount: 0, requiresDialog: false, message: base + "This session and its history will be permanently removed." };
  }
  if (owner.known) {
    return { workerCount: owner.total, requiresDialog: true,
      message: base + "This Driver and all " + workerPhrase(owner.total) + " it owns, " + FULL_SCOPE +
        ", will be permanently removed with their history." };
  }
  return { workerCount: null, requiresDialog: true,
    message: base + "This session and its history will be permanently removed. If it is a Driver, every Split Worker session it owns, " +
      FULL_SCOPE + ", will also be permanently removed." };
}

export function describeGroupDelete(groupLabel, sessionIds, sessions) {
  var requested = [];
  var seen = new Set();
  var list = Array.isArray(sessionIds) ? sessionIds : [];
  for (var r = 0; r < list.length; r++) {
    if (seen.has(list[r])) continue;
    seen.add(list[r]);
    requested.push(list[r]);
  }
  var ids = requested.slice();
  var hidden = 0;
  var unknown = 0;
  for (var i = 0; i < requested.length; i++) {
    var owner = ownership(findSession(requested[i], sessions), sessions);
    if (owner.worker) continue;
    for (var j = 0; j < owner.visible.length; j++) {
      if (seen.has(owner.visible[j])) continue;
      seen.add(owner.visible[j]);
      ids.push(owner.visible[j]);
    }
    if (owner.known) hidden += owner.total - owner.visible.length;
    else unknown++;
  }
  var cascaded = ids.length - requested.length + hidden;
  var total = ids.length + hidden;
  var noun = total === 1 ? "session" : "sessions";
  var message = 'Clear "' + groupLabel + '"? ';
  if (unknown > 0) {
    message += "At least " + total + " " + noun + " will be permanently removed, plus every Split Worker session owned by a Driver here, " + FULL_SCOPE + ".";
  } else {
    message += total + " " + noun + " will be permanently removed";
    if (cascaded > 0) message += ", including " + workerPhrase(cascaded) + " owned by these Drivers, " + FULL_SCOPE;
    message += ".";
  }
  return { ids: ids, cascadedCount: cascaded, exact: unknown === 0, message: message };
}
