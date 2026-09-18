var multiWorkerFeature = require("./multi-worker-feature");
var splitRoles = require("./session-split-group-roles");
var generationOf = require("./session-split-group-v2-store").generationOf;

function attachPairWorkerClose(ctx) {
  function result(ws, msg, ok, error) {
    ctx.sendTo(ws, {
      type: "split_worker_close_result",
      requestId: typeof msg.requestId === "string" ? msg.requestId : null,
      ok: ok,
      error: error || null,
      groupId: typeof msg.groupId === "string" ? msg.groupId : null,
      workerId: Number.isInteger(msg.workerId) ? msg.workerId : null,
    });
  }

  function validate(ws, msg) {
    if (ctx.isMate || !multiWorkerFeature.isEnabled(ctx.multiWorkerFeature)) {
      throw new Error("Multi-Worker close is unavailable in this project");
    }
    if (!ctx.hasSocket(ws) || ws.readyState !== 1) throw new Error("The project socket is no longer active");
    if (msg.projectSlug !== ctx.projectSlug) throw new Error("The project changed before the Worker was closed");
    if (!Number.isInteger(msg.driverId) || ws._clayActiveSession !== msg.driverId) {
      throw new Error("The active session must be the configured Driver");
    }
    var driver = ctx.sm.sessions.get(msg.driverId);
    if (!driver || ctx.sm.sessions.get(driver.localId) !== driver) throw new Error("The exact Driver session is no longer live");
    var actorId = ws._clayUser && ws._clayUser.id || null;
    if ((driver.ownerId || null) !== actorId) throw new Error("The Driver owner does not match this socket");
    if ((msg.driverOriginId || null) !== (driver.sessionOriginId || null)) throw new Error("The exact Driver identity changed");
    var group = ctx.splitStore.groupForMember(driver.localId);
    if (!group || group.id !== msg.groupId || (group.ownerId || null) !== actorId) throw new Error("The exact split group changed");
    var roles = splitRoles.normalizePair(group.pair, group.members);
    if (!roles.ok || roles.kind !== "versioned" || roles.driverId !== driver.localId) {
      throw new Error("The configured Driver or Worker roles changed");
    }
    if (!Array.isArray(msg.expectedWorkerIds) || msg.expectedWorkerIds.join(",") !== roles.workerIds.join(",")) {
      throw new Error("The configured Worker membership changed");
    }
    if (!Number.isInteger(msg.workerId) || roles.workerIds.indexOf(msg.workerId) === -1) {
      throw new Error("The selected Worker changed");
    }
    var worker = ctx.sm.sessions.get(msg.workerId);
    if (!worker || ctx.sm.sessions.get(worker.localId) !== worker || (worker.ownerId || null) !== actorId) {
      throw new Error("The exact Worker session is no longer live");
    }
    if ((msg.workerOriginId || null) !== (worker.sessionOriginId || null) || msg.generation !== generationOf(worker)) {
      throw new Error("The exact Worker identity or generation changed");
    }
    return { driver: driver, worker: worker };
  }

  function handleMessage(ws, msg) {
    if (!msg || msg.type !== "split_worker_close") return false;
    try {
      var exact = validate(ws, msg);
      ctx.closeWorker({ workerId: exact.worker.localId }, exact.driver);
      result(ws, msg, true, null);
    } catch (error) {
      result(ws, msg, false, error.message || String(error));
    }
    return true;
  }

  return { handleMessage: handleMessage, validate: validate };
}

module.exports = { attachPairWorkerClose: attachPairWorkerClose };
