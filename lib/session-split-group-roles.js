// Shared role and target identity rules for Split Groups.
//
// Version 1 is the persisted two-session pair shape. Version 2 describes one
// Driver and up to two Workers, but callers must explicitly opt into it until
// all production consumers can address more than one Worker.
// Remaining direct pair.workerId reads are deliberate compatibility branches:
// session-split-groups owns legacy-only create and Driver-transfer transactions,
// while session-split-group-anchors and persistence resolve legacy records.
// Production activation must still migrate the client hierarchy, pane lock, and
// split-group helper projections before the server gate is enabled.

var MAX_WORKERS = 2;

function isInteger(value) {
  return Number.isInteger(value);
}

function containsOnce(values, value) {
  var count = 0;
  for (var i = 0; i < values.length; i++) if (values[i] === value) count++;
  return count === 1;
}

function validateMembers(members) {
  if (!Array.isArray(members) || (members.length !== 2 && members.length !== 3)) {
    return { ok: false, error: "A split group requires exactly two sessions until multi-Worker consumers are enabled" };
  }
  for (var i = 0; i < members.length; i++) {
    if (!isInteger(members[i])) return { ok: false, error: "Split group members must be distinct integer session ids" };
    if (!containsOnce(members, members[i])) return { ok: false, error: "Split group members must be distinct integer session ids" };
  }
  return { ok: true };
}

function validateRoleIds(driverId, workerIds, members) {
  if (!isInteger(driverId)) return { ok: false, error: "The Driver role must reference an integer session id" };
  if (!Array.isArray(workerIds) || workerIds.length < 1 || workerIds.length > MAX_WORKERS) {
    return { ok: false, error: "A configured role requires one to two Workers" };
  }
  if (!containsOnce(members, driverId)) return { ok: false, error: "The Driver role must reference exactly one split group member" };
  var seen = [driverId];
  for (var i = 0; i < workerIds.length; i++) {
    if (!isInteger(workerIds[i]) || seen.indexOf(workerIds[i]) !== -1 || !containsOnce(members, workerIds[i])) {
      return { ok: false, error: "Worker roles must reference distinct split group members" };
    }
    seen.push(workerIds[i]);
  }
  if (seen.length !== members.length) return { ok: false, error: "Every split group member must have exactly one role" };
  return { ok: true };
}

function normalizePair(pair, members) {
  var memberCheck = validateMembers(members);
  if (!memberCheck.ok) return memberCheck;
  if (pair == null) {
    if (members.length !== 2) return { ok: false, error: "An ad-hoc split group requires exactly two sessions" };
    return { ok: true, kind: "adhoc", version: null, driverId: null, workerIds: [] };
  }
  if (!pair || typeof pair !== "object" || Array.isArray(pair)) return { ok: false, error: "Split group roles must be an object" };

  var hasVersion = Object.prototype.hasOwnProperty.call(pair, "version");
  var hasLegacyWorker = Object.prototype.hasOwnProperty.call(pair, "workerId");
  var hasWorkerIds = Object.prototype.hasOwnProperty.call(pair, "workerIds");
  if (hasVersion && pair.version !== 2) return { ok: false, error: "Unknown split group role version" };
  if (hasVersion && hasLegacyWorker) return { ok: false, error: "Versioned roles cannot also define legacy workerId" };
  if (hasVersion && !hasWorkerIds) return { ok: false, error: "Version 2 roles require workerIds" };
  if (!hasVersion && hasWorkerIds) return { ok: false, error: "workerIds requires version 2 roles" };
  if (!hasVersion && !hasLegacyWorker) return { ok: false, error: "Legacy roles require workerId" };

  var workerIds = hasVersion ? pair.workerIds : [pair.workerId];
  var checked = validateRoleIds(pair.driverId, workerIds, members);
  if (!checked.ok) return checked;
  return {
    ok: true,
    kind: hasVersion ? "versioned" : "legacy",
    version: hasVersion ? 2 : null,
    driverId: pair.driverId,
    workerIds: workerIds.slice(),
  };
}

function validateStorePair(pair, members) {
  var normalized = normalizePair(pair, members);
  if (!normalized.ok) return normalized;
  if (normalized.kind === "versioned") {
    return { ok: false, error: "Version 2 split group roles are reserved until multi-Worker consumers are migrated" };
  }
  if (normalized.kind === "adhoc" && members.length !== 2) {
    return { ok: false, error: "An ad-hoc split group requires exactly two sessions" };
  }
  return normalized;
}

function isUnsupportedPair(pair) {
  return !!(pair && typeof pair === "object" && Object.prototype.hasOwnProperty.call(pair, "version"));
}

function validateStoredGroup(group, sessions) {
  if (!group || typeof group.id !== "string" || !Array.isArray(group.members) || group.members.length !== 2) return false;
  if (!sessions.has(group.members[0]) || !sessions.has(group.members[1])) return false;
  return validateStorePair(group.pair, group.members).ok;
}

function resolveWorkerTarget(role, requestedWorkerId) {
  if (!role || !role.ok || role.kind === "adhoc") return { ok: false, error: "The split group has no configured Workers" };
  if (requestedWorkerId != null) {
    if (!isInteger(requestedWorkerId) || role.workerIds.indexOf(requestedWorkerId) === -1) {
      return { ok: false, error: "workerId must identify an exact configured Worker" };
    }
    return { ok: true, workerId: requestedWorkerId };
  }
  if (role.workerIds.length !== 1) return { ok: false, error: "workerId is required when more than one Worker is configured" };
  return { ok: true, workerId: role.workerIds[0] };
}

function resolveLiveRoles(sm, group) {
  var normalized = normalizePair(group && group.pair, group && group.members);
  if (!normalized.ok || normalized.kind === "adhoc") return null;
  var driver = sm.sessions.get(normalized.driverId);
  if (!driver || sm.sessions.get(driver.localId) !== driver || driver.destroying) return null;
  var workers = [];
  for (var i = 0; i < normalized.workerIds.length; i++) {
    var worker = sm.sessions.get(normalized.workerIds[i]);
    if (!worker || sm.sessions.get(worker.localId) !== worker || worker.destroying) return null;
    if ((worker.ownerId || null) !== (driver.ownerId || null)) return null;
    workers.push(worker);
  }
  return { group: group, role: normalized, driver: driver, workers: workers };
}

function matchesLiveTarget(sm, group, caller, worker) {
  if (!group || !caller || !worker) return false;
  if (sm.sessions.get(caller.localId) !== caller || sm.sessions.get(worker.localId) !== worker) return false;
  if ((caller.ownerId || null) !== (worker.ownerId || null)) return false;
  var normalized = normalizePair(group.pair, group.members);
  if (!normalized.ok) return false;
  if (normalized.kind === "adhoc") {
    return group.members.indexOf(caller.localId) !== -1 && group.members.indexOf(worker.localId) !== -1 && caller !== worker;
  }
  var roles = resolveLiveRoles(sm, group);
  return !!(roles && roles.driver === caller && roles.workers.indexOf(worker) !== -1);
}

function taskGeneration(worker) {
  return worker && (worker._pairGeneration || worker.sessionProvenance && worker.sessionProvenance.generation) || null;
}

function tokenMatchesWorker(worker, token) {
  return !!(worker && token && token.workerSessionId === worker.localId && token.generation === taskGeneration(worker));
}

module.exports = {
  MAX_WORKERS: MAX_WORKERS,
  normalizePair: normalizePair,
  matchesLiveTarget: matchesLiveTarget,
  resolveLiveRoles: resolveLiveRoles,
  resolveWorkerTarget: resolveWorkerTarget,
  tokenMatchesWorker: tokenMatchesWorker,
  validateMembers: validateMembers,
  validateRoleIds: validateRoleIds,
  validateStoredGroup: validateStoredGroup,
  validateStorePair: validateStorePair,
  isUnsupportedPair: isUnsupportedPair,
};
