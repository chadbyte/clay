var multiWorkerFeature = require("./multi-worker-feature");
var splitRoles = require("./session-split-group-roles");

function sameOwner(session, ownerId) {
  return !!session && (session.ownerId || null) === (ownerId || null);
}

function generationOf(session) {
  return session && (session._pairGeneration ||
    session.sessionProvenance && session.sessionProvenance.generation) || null;
}

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function replace(target, source) {
  var keys = Object.keys(target);
  for (var i = 0; i < keys.length; i++) delete target[keys[i]];
  Object.assign(target, clone(source));
}

function attachVersionedMutations(ctx) {
  function authorized(feature) {
    return ctx.enabled && multiWorkerFeature.isEnabled(feature);
  }

  function rejectCapability(capability) {
    if (authorized(capability)) return null;
    return { ok: false, error: "Version 2 split groups require the server multi-Worker feature" };
  }

  function exactGroup(ownerId, msg, targetRequired) {
    var group = ctx.groups().find(function (item) { return item.id === (msg && msg.groupId); });
    if (!group) return { error: "Split group not found" };
    if (msg.expectedGroup && msg.expectedGroup !== group) return { error: "The exact split group changed" };
    if ((group.ownerId || null) !== (ownerId || null)) return { error: "Split group owner changed" };
    var normalized = splitRoles.normalizePair(group.pair, group.members);
    if (!normalized.ok || normalized.kind === "adhoc") return { error: "Split group roles changed" };
    if (normalized.driverId !== msg.driverId) return { error: "The configured Driver changed" };
    if (Array.isArray(msg.expectedWorkerIds) &&
        normalized.workerIds.join(",") !== msg.expectedWorkerIds.join(",")) {
      return { error: "The configured Worker membership changed" };
    }
    var driver = ctx.sessions.get(msg.driverId);
    if (!sameOwner(driver, ownerId) || ctx.sessions.get(driver.localId) !== driver ||
        (msg.driverOriginId || null) !== (driver.sessionOriginId || null)) {
      return { error: "The exact Driver identity changed" };
    }
    var target = null;
    if (targetRequired) {
      if (normalized.workerIds.indexOf(msg.workerId) === -1) return { error: "The selected Worker changed" };
      target = ctx.sessions.get(msg.workerId);
      if (!sameOwner(target, ownerId) || ctx.sessions.get(target.localId) !== target ||
          (msg.workerOriginId || null) !== (target.sessionOriginId || null) ||
          msg.generation !== generationOf(target)) {
        return { error: "The exact Worker identity or generation changed" };
      }
    }
    return { group: group, normalized: normalized, driver: driver, target: target };
  }

  function newWorker(ownerId, msg) {
    var worker = ctx.sessions.get(msg.newWorkerId);
    if (!sameOwner(worker, ownerId) || ctx.sessions.get(worker.localId) !== worker ||
        (msg.newWorkerOriginId || null) !== (worker.sessionOriginId || null)) {
      return { error: "The exact replacement Worker identity changed" };
    }
    if (ctx.membershipGroup(worker.localId)) return { error: "The Worker already belongs to a split group" };
    return { worker: worker };
  }

  function commit(group, nextMembers, nextPair, hooks) {
    var before = clone(group);
    group.members = nextMembers;
    group.pair = nextPair;
    try { ctx.save(); }
    catch (error) {
      replace(group, before);
      return { ok: false, error: error.message || String(error) };
    }
    var committed = clone(group);
    if (hooks && typeof hooks.afterPersist === "function") {
      replace(group, before);
      var accepted;
      try { accepted = hooks.afterPersist(); }
      catch (error) { accepted = { ok: false, error: error.message || String(error) }; }
      if (!accepted || accepted.ok === false) {
        try { ctx.save(); }
        catch (rollbackError) {
          return { ok: false, error: (accepted && accepted.error || "close transaction rejected") +
            "; persistence rollback failed: " + (rollbackError.message || String(rollbackError)) };
        }
        return { ok: false, error: accepted && accepted.error || "close transaction rejected" };
      }
      replace(group, committed);
    }
    ctx.changed(group);
    return { ok: true, group: group };
  }

  function addWorker(ownerId, msg, capability) {
    var denied = rejectCapability(capability);
    if (denied) return denied;
    var exact = exactGroup(ownerId, msg || {}, false);
    if (exact.error) return { ok: false, error: exact.error };
    if (exact.normalized.workerIds.length >= splitRoles.MAX_WORKERS) {
      return { ok: false, error: "A Driver can have at most two Workers" };
    }
    var added = newWorker(ownerId, msg);
    if (added.error) return { ok: false, error: added.error };
    var workerIds = exact.normalized.workerIds.concat([added.worker.localId]);
    return commit(exact.group, [exact.driver.localId].concat(workerIds), {
      version: 2, driverId: exact.driver.localId, workerIds: workerIds,
    });
  }

  function replaceWorker(ownerId, msg, capability) {
    var denied = rejectCapability(capability);
    if (denied) return denied;
    var exact = exactGroup(ownerId, msg || {}, true);
    if (exact.error) return { ok: false, error: exact.error };
    var added = newWorker(ownerId, msg);
    if (added.error) return { ok: false, error: added.error };
    var workerIds = exact.normalized.workerIds.slice();
    workerIds[workerIds.indexOf(exact.target.localId)] = added.worker.localId;
    var pair = exact.normalized.kind === "legacy"
      ? { driverId: exact.driver.localId, workerId: added.worker.localId }
      : { version: 2, driverId: exact.driver.localId, workerIds: workerIds };
    return commit(exact.group, [exact.driver.localId].concat(workerIds), pair);
  }

  function removeWorker(ownerId, msg, capability, hooks) {
    var denied = rejectCapability(capability);
    if (denied) return denied;
    var exact = exactGroup(ownerId, msg || {}, true);
    if (exact.error) return { ok: false, error: exact.error };
    var workerIds = exact.normalized.workerIds.filter(function (id) { return id !== exact.target.localId; });
    if (workerIds.length === 0) return ctx.remove(exact.group, hooks);
    return commit(exact.group, [exact.driver.localId].concat(workerIds), {
      version: 2, driverId: exact.driver.localId, workerIds: workerIds,
    }, hooks);
  }

  return { addWorker: addWorker, replaceWorker: replaceWorker, removeWorker: removeWorker };
}

module.exports = { attachVersionedMutations: attachVersionedMutations, generationOf: generationOf };
