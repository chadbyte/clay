// Per-human-turn safety policy for Driver/Split Worker orchestration.
//
// A human Stop is a cancellation barrier, not merely an AbortController
// signal. It blocks delegation and Worker replacement until the next ordinary
// human message reaches the Driver. Internal result and permission messages do
// not clear it. Creation budgets and operation ids also make retries bounded
// and idempotent even when no Stop occurred.

var MAX_CREATIONS_PER_TURN = 2;
var MAX_REPLACEMENTS_PER_TURN = 1;
var MAX_OPERATION_ID_CHARS = 120;

function attachPairTurnControl(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;

  function stateFor(driver) {
    if (!driver._pairTurnControl) {
      driver._pairTurnControl = {
        serial: 0,
        humanStopped: false,
        stoppedAt: null,
        stoppedWorkerId: null,
        creations: 0,
        replacements: 0,
        operations: Object.create(null),
      };
    }
    return driver._pairTurnControl;
  }

  function liveSession(session) {
    return !!(session && sm.sessions.get(session.localId) === session);
  }

  function rolesFor(session) {
    if (!liveSession(session)) return null;
    var group = store.groupForMember(session.localId);
    if (!group || !group.pair) return null;
    var driver = sm.sessions.get(group.pair.driverId);
    var worker = sm.sessions.get(group.pair.workerId);
    if (!liveSession(driver) || !liveSession(worker)) return null;
    if ((driver.ownerId || null) !== (worker.ownerId || null)) return null;
    return { group: group, driver: driver, worker: worker };
  }

  function beginHumanTurn(session) {
    if (!liveSession(session)) return false;
    var roles = rolesFor(session);
    var driver = roles ? roles.driver : session;
    if (roles && roles.driver !== session) return false;
    var state = stateFor(driver);
    state.serial += 1;
    state.humanStopped = false;
    state.stoppedAt = null;
    state.stoppedWorkerId = null;
    state.creations = 0;
    state.replacements = 0;
    state.operations = Object.create(null);
    return true;
  }

  function markHumanStop(session) {
    var roles = rolesFor(session);
    if (!roles) return null;
    var state = stateFor(roles.driver);
    state.humanStopped = true;
    state.stoppedAt = Date.now();
    state.stoppedWorkerId = roles.worker.localId;
    return roles;
  }

  function blockedReason(driver) {
    if (!liveSession(driver)) return "this Driver session is no longer live";
    var state = stateFor(driver);
    if (!state.humanStopped) return null;
    return "the human stopped this Split Worker turn; Worker actions are blocked until the human sends a new message to the Driver";
  }

  function assertWorkerAction(driver) {
    var reason = blockedReason(driver);
    if (reason) throw new Error(reason);
  }

  function reserveCreation(driver, kind) {
    assertWorkerAction(driver);
    var state = stateFor(driver);
    if (kind === "replace" && state.replacements >= MAX_REPLACEMENTS_PER_TURN) {
      throw new Error("the Split Worker replacement limit for this human turn has been reached; wait for a new human message before replacing it again");
    }
    if (state.creations >= MAX_CREATIONS_PER_TURN) {
      throw new Error("the Split Worker creation limit for this human turn has been reached; wait for a new human message before creating another Worker");
    }
    state.creations += 1;
    if (kind === "replace") state.replacements += 1;
    return { driver: driver, kind: kind, active: true };
  }

  function releaseCreation(ticket) {
    if (!ticket || !ticket.active || !liveSession(ticket.driver)) return;
    ticket.active = false;
    var state = stateFor(ticket.driver);
    state.creations = Math.max(0, state.creations - 1);
    if (ticket.kind === "replace") state.replacements = Math.max(0, state.replacements - 1);
  }

  function operationId(value) {
    if (typeof value !== "string") return "";
    var clean = value.trim();
    if (!clean || clean.length > MAX_OPERATION_ID_CHARS || !/^[A-Za-z0-9._:-]+$/.test(clean)) return "";
    return clean;
  }

  function runOperation(driver, kind, rawId, fn, fingerprint) {
    var id = operationId(rawId);
    if (!id) return Promise.resolve().then(fn);
    var state = stateFor(driver);
    var key = kind + ":" + id;
    if (state.operations[key]) {
      if (fingerprint !== undefined && state.operations[key].fingerprint !== fingerprint) {
        return Promise.reject(new Error("operation id was already used with different input"));
      }
      return state.operations[key].promise;
    }
    var promise = Promise.resolve().then(fn);
    state.operations[key] = { fingerprint: fingerprint, promise: promise };
    return promise;
  }

  function status(driver) {
    var state = stateFor(driver);
    return {
      humanStopped: state.humanStopped,
      stoppedAt: state.stoppedAt,
      stoppedWorkerId: state.stoppedWorkerId,
      turnSerial: state.serial,
      creationsThisTurn: state.creations,
      replacementsThisTurn: state.replacements,
    };
  }

  return {
    assertWorkerAction: assertWorkerAction,
    beginHumanTurn: beginHumanTurn,
    blockedReason: blockedReason,
    markHumanStop: markHumanStop,
    releaseCreation: releaseCreation,
    reserveCreation: reserveCreation,
    runOperation: runOperation,
    status: status,
  };
}

module.exports = {
  MAX_CREATIONS_PER_TURN: MAX_CREATIONS_PER_TURN,
  MAX_REPLACEMENTS_PER_TURN: MAX_REPLACEMENTS_PER_TURN,
  attachPairTurnControl: attachPairTurnControl,
};
