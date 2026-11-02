var fs = require("fs");
var path = require("path");
var config = require("./config");

// In-memory store: { slug: { userId: { sessionId, mateDm } } }
var store = {};
var presencePath = path.join(config.CONFIG_DIR, "user-presence.json");
var saveTimer = null;

function sessionIdForPersistence(session) {
  if (!session) return null;
  return session.cliSessionId || session.localId || null;
}

function shouldPersistDisconnectPresence(existing, sessionId, existingSession, currentSession) {
  return !!sessionId && (!existing || existing.sessionId === sessionId ||
    (!!existingSession && !!currentSession && existingSession === currentSession));
}

function findSession(sessions, sessionId) {
  if (!sessions || sessionId == null) return null;
  var found = null;
  sessions.forEach(function (session) {
    if (session.cliSessionId && session.cliSessionId === sessionId) found = session;
  });
  if (found) return found;
  return typeof sessionId === "number" ? (sessions.get(sessionId) || null) : null;
}

// Load from disk on startup
function load() {
  try {
    if (fs.existsSync(presencePath)) {
      var raw = fs.readFileSync(presencePath, "utf8");
      store = JSON.parse(raw);
    }
  } catch (e) {
    store = {};
  }
}

// Debounced save to disk (200ms)
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(function () {
    saveTimer = null;
    try {
      config.ensureConfigDir();
      fs.writeFileSync(presencePath, JSON.stringify(store, null, 2), "utf8");
    } catch (e) {
      // Silently ignore write errors
    }
  }, 200);
}

function setPresence(slug, userId, sessionId, mateDm) {
  if (!slug || !userId) return;
  if (!store[slug]) store[slug] = {};
  store[slug][userId] = {
    sessionId: sessionId || null,
    mateDm: mateDm !== undefined ? mateDm : null,
    visits: (store[slug][userId] && store[slug][userId].visits) || [],
  };
  scheduleSave();
}

function getPresence(slug, userId) {
  if (!slug || !userId) return null;
  if (!store[slug]) return null;
  return store[slug][userId] || null;
}

function setMateDm(slug, userId, mateDm) {
  if (!slug || !userId) return;
  if (!store[slug]) store[slug] = {};
  var existing = store[slug][userId] || {};
  store[slug][userId] = {
    sessionId: existing.sessionId || null,
    visits: existing.visits || [],
    mateDm: mateDm !== undefined ? mateDm : null,
  };
  scheduleSave();
}

function clearPresence(slug, userId) {
  if (!slug || !userId) return;
  if (store[slug]) {
    delete store[slug][userId];
    if (Object.keys(store[slug]).length === 0) delete store[slug];
    scheduleSave();
  }
}

// Remove all presence entries referencing a deleted session
function clearSession(slug, sessionId) {
  if (!slug || !store[slug]) return;
  var keys = Object.keys(store[slug]);
  for (var i = 0; i < keys.length; i++) {
    if (store[slug][keys[i]].sessionId === sessionId) {
      store[slug][keys[i]].sessionId = null;
    }
  }
  scheduleSave();
}

// Visits use durable origin identities. Disconnects update presence, never visit order.
function recordVisit(slug, userId, session, sessions) {
  if (!slug || !userId || !session || !session.sessionOriginId) return;
  if (!store[slug]) store[slug] = {};
  var existing = store[slug][userId] || { sessionId: null, mateDm: null };
  var allowed = new Set((sessions || [session]).map(function (item) { return item.sessionOriginId; }));
  var visits = (Array.isArray(existing.visits) ? existing.visits : []).filter(function (visit) {
    return visit && visit.originId !== session.sessionOriginId && allowed.has(visit.originId) && Number.isFinite(visit.visitedAt);
  }).slice(0, 99);
  visits.unshift({ originId: session.sessionOriginId, visitedAt: Date.now() });
  store[slug][userId] = Object.assign({}, existing, { visits: visits });
  scheduleSave();
}
function getVisits(slug, userId, sessions) {
  var existing = getPresence(slug, userId), visits = existing && existing.visits;
  var allowed = new Set(sessions.map(function (session) { return session.sessionOriginId; }));
  if (Array.isArray(visits) && visits.length) return visits.filter(function (visit) { return visit && allowed.has(visit.originId); }).slice(0, 100);
  // A legacy provider id can be resolved exactly; numeric local ids cannot survive renumbering.
  var legacy = existing && typeof existing.sessionId === 'string' && sessions.find(function (session) { return session.cliSessionId === existing.sessionId; });
  return legacy ? [{ originId: legacy.sessionOriginId, visitedAt: null }] : [];
}

load();

module.exports = {
  recordVisit: recordVisit,
  getVisits: getVisits,
  sessionIdForPersistence: sessionIdForPersistence,
  shouldPersistDisconnectPresence: shouldPersistDisconnectPresence,
  findSession: findSession,
  setPresence: setPresence,
  getPresence: getPresence,
  setMateDm: setMateDm,
  clearPresence: clearPresence,
  clearSession: clearSession,
};
