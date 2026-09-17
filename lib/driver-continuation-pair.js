var sessionProvenance = require("./session-provenance");

var ACTIVE_RUN_STATES = ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"];

function hasEntries(value) {
  return !!(value && Object.keys(value).length > 0);
}

function activeFollowups(session) {
  var items = session && session._pairFollowups;
  if (!Array.isArray(items)) return false;
  return items.some(function (item) {
    return item && ["queued", "waiting_for_interrupt", "starting", "running"].indexOf(item.status) !== -1;
  });
}

function sessionWaitReason(session, label) {
  if (!session) return label + " no longer exists.";
  if (session.isProcessing || session._queryStarting || session._awaitingTurnResult) return label + " is still processing.";
  if (session._pairDelegation) return "The Split Worker still has an open delegation.";
  if (activeFollowups(session)) return "The Split Worker still has queued follow-ups.";
  if (session.pendingPush && session.pendingPush.length) return "The Split Worker still has messages waiting for delivery.";
  if (hasEntries(session.pendingPermissions) || hasEntries(session.pendingAskUser) ||
      hasEntries(session.pendingElicitations) || hasEntries(session.pendingUserDialogs)) {
    return label + " is waiting for a permission or user-input response.";
  }
  if (session.scheduledMessage || session.rateLimitAutoContinuePending) return label + " has a scheduled callback.";
  if (session.autonomousRun && ACTIVE_RUN_STATES.indexOf(session.autonomousRun.state) !== -1) return label + " has active Until complete work.";
  if (session.taskStopRequested || session.destroying || session._runtimeRefreshRequested) return label + " is changing state.";
  return "";
}

function inspect(source, ctx) {
  var store = ctx && ctx.splitStore;
  var group = store && source ? store.groupForMember(source.localId) : null;
  if (!group) return { ok: true, group: null, worker: null };
  if (!group.pair || group.pair.driverId !== source.localId) {
    return { ok: false, error: "Only the configured Driver can continue an attached split pair." };
  }
  var worker = ctx.sm && ctx.sm.sessions.get(group.pair.workerId);
  if (!worker || group.members.indexOf(worker.localId) === -1) return { ok: false, error: "The attached Split Worker is unavailable." };
  if ((source.ownerId || null) !== (worker.ownerId || null)) return { ok: false, error: "The attached Split Worker owner changed." };
  if (!sessionProvenance.isWorker(worker)) return { ok: false, error: "The attached split partner is not a verified Worker." };
  var reason = sessionWaitReason(worker, "The Split Worker");
  if (reason) return { ok: false, error: reason };
  return { ok: true, group: group, worker: worker };
}

function inheritState(source, target) {
  if (source._pairTurnControl) {
    target._pairTurnControl = Object.assign({}, source._pairTurnControl, {
      operations: Object.assign(Object.create(null), source._pairTurnControl.operations || {}),
    });
  }
  if (Array.isArray(source._workerGenerations)) {
    target._workerGenerations = source._workerGenerations.map(function (record) {
      return Object.assign({}, record, {
        observed: record.observed ? Object.assign({}, record.observed) : record.observed,
        evaluation: record.evaluation ? Object.assign({}, record.evaluation) : record.evaluation,
      });
    });
  }
}

function stage(source, target, ctx) {
  var inspected = inspect(source, ctx);
  if (!inspected.ok || !inspected.group) return inspected;
  if (!ctx.splitStore || typeof ctx.splitStore.beginOwnedDriverTransfer !== "function") {
    return { ok: false, error: "Split pair transfer is unavailable." };
  }
  inheritState(source, target);
  var staged = ctx.splitStore.beginOwnedDriverTransfer(source.ownerId || null, {
    id: inspected.group.id,
    sourceDriverId: source.localId,
    targetDriverId: target.localId,
    workerId: inspected.worker.localId,
  });
  if (!staged.ok) return staged;
  return { ok: true, group: staged.group, worker: inspected.worker, transaction: staged.transaction };
}

module.exports = { activeFollowups: activeFollowups, inspect: inspect, inheritState: inheritState, stage: stage };
