var crypto = require("crypto");

var PROVENANCE_VERSION = 1;
var MAX_ORIGIN_LENGTH = 128;

function safeOriginId(value) {
  if (typeof value !== "string") return null;
  var trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_ORIGIN_LENGTH) return null;
  return trimmed;
}

function ensureOrigin(session) {
  if (!session) return null;
  var existing = safeOriginId(session.sessionOriginId);
  if (existing) {
    session.sessionOriginId = existing;
    return existing;
  }
  session.sessionOriginId = crypto.randomUUID();
  return session.sessionOriginId;
}

function isWorker(session) {
  return !!(session && session.sessionProvenance && session.sessionProvenance.kind === "worker");
}

function nextWorkerGeneration(parentOriginId, sessions) {
  var next = 1;
  sessions.forEach(function (session) {
    var provenance = session && session.sessionProvenance;
    if (!provenance || provenance.kind !== "worker" || provenance.parentSessionOriginId !== parentOriginId) return;
    var generation = Number.isInteger(provenance.generation) && provenance.generation > 0 ? provenance.generation : 0;
    if (generation >= next) next = generation + 1;
  });
  return next;
}

function markWorker(driver, worker, sessions) {
  if (!driver || !worker || driver === worker) throw new Error("Split Worker provenance requires distinct sessions");
  if ((driver.ownerId || null) !== (worker.ownerId || null)) throw new Error("Split Worker provenance requires the same owner");
  if (isWorker(driver)) throw new Error("A Split Worker cannot become a Driver");
  var parentOriginId = ensureOrigin(driver);
  ensureOrigin(worker);
  worker.sessionProvenance = {
    version: PROVENANCE_VERSION,
    kind: "worker",
    parentSessionOriginId: parentOriginId,
    generation: nextWorkerGeneration(parentOriginId, sessions),
    createdVia: "split-worker",
    createdAt: Date.now(),
  };
  return worker.sessionProvenance;
}

function restore(meta, session) {
  var storedOriginId = safeOriginId(meta && meta.sessionOriginId);
  ensureOrigin(session);
  var stored = meta && meta.sessionProvenance;
  if (!stored || stored.kind !== "worker") return storedOriginId !== session.sessionOriginId;
  var parentOriginId = safeOriginId(stored.parentSessionOriginId);
  // A corrupt Worker record remains a Worker. It is projected as orphaned
  // instead of silently gaining top-level Driver authority.
  session.sessionProvenance = {
    version: PROVENANCE_VERSION,
    kind: "worker",
    parentSessionOriginId: parentOriginId,
    generation: Number.isInteger(stored.generation) && stored.generation > 0 ? stored.generation : null,
    createdVia: stored.createdVia === "split-worker" ? "split-worker" : null,
    createdAt: typeof stored.createdAt === "number" && isFinite(stored.createdAt) ? stored.createdAt : null,
  };
  session._pairGeneration = session.sessionProvenance.generation;
  return storedOriginId !== session.sessionOriginId || JSON.stringify(stored) !== JSON.stringify(session.sessionProvenance);
}

function metadata(session) {
  var result = { sessionOriginId: ensureOrigin(session) };
  if (isWorker(session)) result.sessionProvenance = Object.assign({}, session.sessionProvenance);
  return result;
}

function hierarchyFor(sessions) {
  var originMap = {};
  var duplicateOrigins = {};
  for (var i = 0; i < sessions.length; i++) {
    var originId = safeOriginId(sessions[i] && sessions[i].sessionOriginId);
    if (!originId) continue;
    if (originMap[originId]) duplicateOrigins[originId] = true;
    else originMap[originId] = sessions[i];
  }
  var result = {};
  for (var j = 0; j < sessions.length; j++) {
    var session = sessions[j];
    if (!isWorker(session)) {
      result[session.localId] = { role: "driver", parentSessionId: null, parentAvailable: false, generation: null };
      continue;
    }
    var provenance = session.sessionProvenance;
    var parentOriginId = safeOriginId(provenance.parentSessionOriginId);
    var parent = duplicateOrigins[parentOriginId] ? null : originMap[parentOriginId];
    var sameOwner = parent && (parent.ownerId || null) === (session.ownerId || null);
    var validParent = sameOwner && !isWorker(parent) ? parent : null;
    result[session.localId] = {
      role: "worker",
      parentSessionId: validParent ? validParent.localId : null,
      parentAvailable: !!validParent,
      generation: Number.isInteger(provenance.generation) && provenance.generation > 0 ? provenance.generation : null,
    };
  }
  return result;
}

module.exports = {
  ensureOrigin: ensureOrigin,
  hierarchyFor: hierarchyFor,
  isWorker: isWorker,
  markWorker: markWorker,
  metadata: metadata,
  restore: restore,
};
