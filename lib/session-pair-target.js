var splitRoles = require("./session-split-group-roles");
var multiWorkerFeature = require("./multi-worker-feature");

function resolveGroupTarget(sm, group, caller, args, options) {
  if (!caller || sm.sessions.get(caller.localId) !== caller) throw new Error("this session is no longer live; the partner tools are bound to an exact session");
  var requestedWorkerId = args && args.workerId;
  var normalized = splitRoles.normalizePair(group && group.pair, group && group.members);
  if (!normalized.ok) throw new Error(normalized.error);
  var workerId;
  if (normalized.kind === "adhoc") {
    workerId = group.members[0] === caller.localId ? group.members[1] : group.members[0];
    if (requestedWorkerId != null && requestedWorkerId !== workerId) throw new Error("workerId must identify the exact split partner");
  } else {
    if (normalized.driverId !== caller.localId) throw new Error("only the configured Driver can direct this pair");
    var target = splitRoles.resolveWorkerTarget(normalized, requestedWorkerId);
    if (!target.ok) throw new Error(target.error);
    workerId = target.workerId;
    if (normalized.kind === "versioned" && (!options || options.readOnly !== true) &&
        (!options || !multiWorkerFeature.isEnabled(options.multiWorkerFeature))) {
      throw new Error("multi-Worker mutations remain gated until lifecycle, result, and Stop routing are migrated");
    }
  }
  var worker = sm.sessions.get(workerId);
  if (!worker || sm.sessions.get(worker.localId) !== worker) throw new Error("split partner session was not found");
  if ((caller.ownerId || null) !== (worker.ownerId || null)) throw new Error("split partner access denied");
  if (group.members.indexOf(caller.localId) === -1 || group.members.indexOf(worker.localId) === -1) {
    throw new Error("the exact caller and Worker must both belong to this split group");
  }
  return { group: group, partner: worker, role: normalized, workerId: workerId };
}

function rolesFor(sm, store, session) {
  if (!session || sm.sessions.get(session.localId) !== session) return null;
  var group = store.groupForMember(session.localId);
  var roles = group && group.pair ? splitRoles.resolveLiveRoles(sm, group) : null;
  if (!roles) return null;
  roles.worker = roles.workers.length === 1 ? roles.workers[0] :
    roles.workers.find(function (worker) { return worker === session; }) || null;
  return roles;
}

module.exports = { resolveGroupTarget: resolveGroupTarget, rolesFor: rolesFor };
