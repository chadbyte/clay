var fs = require("fs");
var path = require("path");

var MAX_CAPTURE_ATTEMPTS = 3;
var MAX_DELIVERY_ATTEMPTS = 3;
var RETRY_DELAY_MS = 25;

function stableOrigin(session) {
  if (session && typeof session.sessionOriginId === "string" && session.sessionOriginId) return session.sessionOriginId;
  return null;
}

function resultKey(args) {
  return [args.ownerId || "_default", args.driverOriginId, args.workerOriginId, args.taskId, args.generation == null ? "unknown" : args.generation].join("/");
}

function copy(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function attachPairResultOutbox(options) {
  options = options || {};
  var filePath = options.filePath;
  if (!filePath && options.storageDir) filePath = path.join(options.storageDir, "pair-result-outbox.json");
  if (!filePath) throw new Error("pair result outbox requires a file path");
  var records = Object.create(null);
  var captureOperations = Object.create(null);
  var lastPersistenceError = null;
  var storageCorrupt = false;

  function read() {
    try {
      var parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      if (!parsed || typeof parsed !== "object" || !parsed.records || typeof parsed.records !== "object") throw new Error("pair result outbox has an invalid format");
      records = parsed.records;
    } catch (error) {
      if (error.code !== "ENOENT") { storageCorrupt = true; lastPersistenceError = error.message || String(error); }
    }
  }
  function persist(nextRecords) {
    if (storageCorrupt) return { ok: false, error: lastPersistenceError || "pair result outbox storage is unreadable" };
    var serialized = JSON.stringify({ version: 1, records: nextRecords || records }, null, 2) + "\n";
    try {
      if (typeof options.persist === "function") {
        if (options.persist(filePath, serialized) === false) throw new Error("pair result outbox persistence returned false");
        lastPersistenceError = null;
        return { ok: true };
      }
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      var tempPath = filePath + ".tmp." + process.pid;
      fs.writeFileSync(tempPath, serialized, "utf8");
      if (process.platform !== "win32") {
        try { fs.chmodSync(tempPath, 0o600); } catch (chmodError) {}
      }
      fs.renameSync(tempPath, filePath);
      lastPersistenceError = null;
      return { ok: true };
    } catch (error) {
      lastPersistenceError = error.message || String(error);
      return { ok: false, error: lastPersistenceError };
    }
  }
  function sameOutcome(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
  function captureRecord(key, outcome) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (record.outcome) {
      if (!sameOutcome(record.outcome, outcome)) return { ok: false, conflict: true, error: "pair result outcome is immutable", record: copy(record) };
      return { ok: true, record: copy(record), duplicate: true };
    }
    var nextRecords = Object.assign({}, records), next = Object.assign({}, record, {
      outcome: copy(outcome), state: record.state === "blocked" ? "blocked" : "captured", capturedAt: Date.now(),
      preparedCloseOutcome: null,
      closePreparationState: record.preparedCloseOutcome ? "superseded_by_terminal_evidence" : record.closePreparationState || null,
    });
    nextRecords[record.key] = next;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, record: copy(next), duplicate: false };
  }
  function addCaptureCallback(operation, callback) {
    if (typeof callback === "function" && operation.callbacks.indexOf(callback) === -1) operation.callbacks.push(callback);
  }
  function notifyCapture(operation, result) {
    var callbacks = operation.callbacks.slice(); operation.callbacks = [];
    for (var i = 0; i < callbacks.length; i++) callbacks[i](result);
  }
  function retryCapture(key, operation, attempt) {
    attempt = attempt || 1;
    if (captureOperations[key] !== operation || !operation.active) return { ok: false, stale: true };
    var isCurrent = true;
    try { if (operation.isCurrent) isCurrent = operation.isCurrent() === true; } catch (error) { isCurrent = false; }
    if (!isCurrent) {
      operation.active = false;
      var stale = { ok: false, stale: true, error: "pair result capture no longer matches the live Worker task" };
      operation.lastResult = stale;
      notifyCapture(operation, stale);
      return stale;
    }
    var result = captureRecord(key, operation.outcome);
    operation.lastResult = result;
    if (result.ok) {
      operation.active = false; operation.complete = true;
      if (attempt > 1) notifyCapture(operation, result);
      else operation.callbacks = [];
      return result;
    }
    if (attempt >= MAX_CAPTURE_ATTEMPTS) {
      operation.active = false;
      notifyCapture(operation, result);
      return result;
    }
    operation.timer = (options.setTimeout || setTimeout)(function () { retryCapture(key, operation, attempt + 1); }, RETRY_DELAY_MS * attempt);
    return result;
  }
  function begin(args) {
    if (!args.driverOriginId || !args.workerOriginId) return { ok: false, error: "durable session origins are required before dispatch" };
    var key = resultKey(args);
    var existing = records[key];
    if (existing) return { ok: true, key: key, record: copy(existing), duplicate: true };
    var record = {
      key: key,
      ownerId: args.ownerId || null,
      projectSlug: args.projectSlug || null,
      driverOriginId: args.driverOriginId,
      workerOriginId: args.workerOriginId,
      taskId: args.taskId,
      generation: args.generation == null ? null : args.generation,
      driverSessionId: args.driverSessionId == null ? null : args.driverSessionId,
      workerSessionId: args.workerSessionId == null ? null : args.workerSessionId,
      groupId: typeof args.groupId === "string" ? args.groupId : null,
      workerSessionOriginId: args.workerOriginId,
      historyStartIndex: args.historyStartIndex == null ? null : args.historyStartIndex,
      message: args.message || "",
      state: "dispatching",
      deliveryState: "pending",
      deliveryRoute: args.deliveryRoute === "blocking" ? "blocking" : "callback",
      deliveryAttemptCount: 0,
      deliveryAttemptSequence: 0,
      transcriptPersisted: false,
      blockedReason: null,
      blockedCode: null,
      finalized: false,
      manualRetryCount: 0,
      manualRetryEpoch: 0,
      createdAt: Date.now(),
      capturedAt: null,
      outcome: null,
    };
    var nextRecords = Object.assign({}, records);
    nextRecords[key] = record;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, key: key, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, key: key, record: copy(record), duplicate: false };
  }
  function capture(args, outcome, callback, isCurrent) {
    var key = typeof args === "string" ? args : resultKey(args);
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (record.outcome) return captureRecord(key, outcome);
    var operation = captureOperations[key];
    if (operation) {
      if (!sameOutcome(operation.outcome, outcome)) return { ok: false, conflict: true, error: "pair result outcome is immutable" };
      addCaptureCallback(operation, callback);
      if (operation.active) return Object.assign({ inFlight: true }, operation.lastResult || { ok: false });
      if (operation.complete) return captureRecord(key, outcome);
      operation.active = true; operation.callbacks = [];
      addCaptureCallback(operation, callback);
      return retryCapture(key, operation, 1);
    }
    operation = { outcome: copy(outcome), callbacks: [], active: true, complete: false, lastResult: null, timer: null,
      isCurrent: typeof isCurrent === "function" ? isCurrent : null };
    captureOperations[key] = operation;
    addCaptureCallback(operation, callback);
    return retryCapture(key, operation, 1);
  }
  function prepareCapture(key, outcome) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (record.outcome) {
      if (!sameOutcome(record.outcome, outcome)) return { ok: false, conflict: true, error: "pair result outcome is immutable", record: copy(record) };
      return { ok: true, record: copy(record), duplicate: true, committed: true };
    }
    if (record.preparedCloseOutcome) {
      if (!sameOutcome(record.preparedCloseOutcome, outcome)) return { ok: false, conflict: true, error: "prepared close outcome changed", record: copy(record) };
      return { ok: true, record: copy(record), duplicate: true, prepared: true };
    }
    var nextRecords = Object.assign({}, records), next = Object.assign({}, record, {
      state: "close_prepared", preparedCloseOutcome: copy(outcome),
      closePreparationState: "prepared", closePreparedAt: Date.now(),
    });
    nextRecords[key] = next;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, record: copy(next), duplicate: false, prepared: true };
  }
  function finalizePreparedCapture(key, outcome) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (record.outcome) return captureRecord(key, outcome);
    if (!record.preparedCloseOutcome || !sameOutcome(record.preparedCloseOutcome, outcome)) {
      return { ok: false, error: "prepared close outcome is unavailable or changed", record: copy(record) };
    }
    var nextRecords = Object.assign({}, records), next = Object.assign({}, record, {
      outcome: copy(outcome), state: "captured", capturedAt: Date.now(),
      preparedCloseOutcome: null, closePreparationState: "committed", closeCommittedAt: Date.now(),
    });
    nextRecords[key] = next;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, record: copy(next), duplicate: false };
  }
  function rollbackPreparedCapture(key, outcome) {
    var record = records[key];
    if (!record || !sameOutcome(record.preparedCloseOutcome, outcome) || record.outcome || record.finalized || record.transcriptPersisted ||
        record.deliveryAttemptCount !== 0 || record.deliveryState !== "pending") {
      return { ok: false, error: "prepared pair result can no longer be rolled back" };
    }
    var nextRecords = Object.assign({}, records), next = Object.assign({}, record, {
      state: "dispatching", preparedCloseOutcome: null, closePreparationState: null, closePreparedAt: null,
    });
    nextRecords[key] = next;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, record: copy(next) };
  }
  function transition(key, changes) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    var nextRecords = Object.assign({}, records), next = Object.assign({}, record, changes);
    nextRecords[key] = next;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, record: copy(next) };
  }
  function lifetimeAttemptSequence(record) {
    var sequence = Math.max(Number(record.deliveryAttemptSequence || 0), Number(record.deliveryAttemptCount || 0));
    var match = typeof record.attemptId === "string" && record.attemptId.match(/:(\d+)$/);
    if (match) sequence = Math.max(sequence, Number(match[1]));
    return sequence;
  }
  function beginDelivery(key) {
    var record = records[key];
    if (!record || !record.outcome) return { ok: false, error: "pair result is not captured" };
    if (record.deliveryRoute !== "callback") return { ok: true, record: copy(record), blocked: true };
    if (record.deliveryState === "accepted" || record.deliveryState === "uncertain") return { ok: true, record: copy(record), terminal: true };
    if (record.deliveryState === "attempting") return { ok: true, record: copy(record), inFlight: true };
    var count = Number(record.deliveryAttemptCount || 0);
    if (count >= MAX_DELIVERY_ATTEMPTS) return { ok: true, record: copy(record), exhausted: true };
    var sequence = lifetimeAttemptSequence(record) + 1;
    var attemptId = key + ":" + sequence;
    var started = transition(key, { deliveryState: "attempting", deliveryAttemptCount: count + 1,
      deliveryAttemptSequence: sequence, attemptId: attemptId, attemptStartedAt: Date.now(), deliveryError: null });
    if (started.ok) started.attemptId = attemptId;
    return started;
  }
  function transitionAttempt(key, attemptId, allowedStates, changes) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (record.attemptId !== attemptId || allowedStates.indexOf(record.deliveryState) === -1) {
      return { ok: false, stale: true, record: copy(record), error: "delivery attempt is no longer current" };
    }
    return transition(key, changes);
  }
  function markTranscript(key, attemptId) {
    return transitionAttempt(key, attemptId, ["attempting"], { transcriptPersisted: true, transcriptPersistedAt: Date.now() });
  }
  function markDelivery(key, attemptId, state, changes) {
    return transitionAttempt(key, attemptId, ["attempting"], Object.assign({ deliveryState: state }, changes || {}));
  }
  function setRoute(key, route) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (route !== "blocking" && route !== "callback") return { ok: false, error: "delivery route is invalid" };
    if (record.deliveryState === "accepted" || record.deliveryState === "uncertain") return { ok: false, error: "terminal delivery route cannot change" };
    return transition(key, { deliveryRoute: route });
  }
  function recover(key, session, callback) {
    var record = records[key];
    var history = session && Array.isArray(session.history) ? session.history : [];
    var origin = stableOrigin(session);
    var boundary = record && Number.isInteger(record.historyStartIndex) ? record.historyStartIndex : 0;
    var terminal = record && origin === record.workerOriginId && session.ownerId === record.ownerId && history.slice(boundary).filter(function (entry) {
      return entry && entry.type === "pair_task_completed" && entry.ownerId === record.ownerId && entry.driverOriginId === record.driverOriginId && entry.workerOriginId === record.workerOriginId && entry.taskId === record.taskId && entry.generation === record.generation;
    }).pop();
    if (!terminal || !terminal.outcome || terminal.outcome.taskId !== record.taskId || terminal.outcome.generation !== record.generation) return { ok: false, uncertain: true, error: "stored Worker history does not prove this terminal completion" };
    return capture(key, terminal.outcome, callback);
  }
  function recoverPending(sessionMap) {
    var results = [], sessionsList = sessionMap && typeof sessionMap.values === "function" ? Array.from(sessionMap.values()) : [], keys = Object.keys(records);
    for (var i = 0; i < keys.length; i++) {
      if (records[keys[i]].state !== "dispatching" && records[keys[i]].state !== "close_prepared") continue;
      var session = sessionsList.find(function (candidate) { return stableOrigin(candidate) === records[keys[i]].workerOriginId && candidate.ownerId === records[keys[i]].ownerId; });
      if (session) results.push({ key: keys[i], result: recover(keys[i], session) });
    }
    return results;
  }
  function markBlocked(key, reason, code) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    var nextRecords = Object.assign({}, records), next = copy(record);
    next.state = "blocked";
    next.blockedReason = String(reason || "Delivery is blocked");
    next.blockedCode = code || null;
    if (code === "human_stop" && record.blockedCode !== "human_stop") {
      next.blockedDeliveryState = record.deliveryState;
      next.blockedAttemptId = record.attemptId || null;
    }
    nextRecords[key] = next;
    var saved = persist(nextRecords);
    if (!saved.ok) return { ok: false, error: saved.error, record: copy(record) };
    records = nextRecords;
    return { ok: true, record: copy(next) };
  }
  function markFinalized(key) {
    var record = records[key];
    if (!record) return { ok: false, error: "pair result outbox record was not found" };
    if (record.finalized) return { ok: true, duplicate: true, record: copy(record) };
    return transition(key, { finalized: true, finalizedAt: Date.now(), finalizationState: "complete", finalizationError: null });
  }
  function markFinalizationFailure(key, reason) {
    return transition(key, { finalizationState: "failed", finalizationError: String(reason || "Result finalization failed") });
  }
  function markRestartUncertain(key) {
    var record = records[key];
    if (!record || record.deliveryState !== "attempting") return { ok: true, stale: true, record: copy(record) };
    return transitionAttempt(key, record.attemptId, ["attempting"], {
      deliveryState: "uncertain", deliveryError: "Delivery was interrupted before acceptance could be confirmed",
    });
  }
  function authorizeHumanTurn(key) {
    var record = records[key];
    if (!record || record.blockedCode !== "human_stop") return { ok: false, stale: true, record: copy(record) };
    var deliveryState = record.blockedDeliveryState || record.deliveryState;
    if (deliveryState === "attempting") deliveryState = "uncertain";
    return transition(key, { state: record.outcome ? "captured" : "dispatching", blockedReason: null, blockedCode: null,
      blockedDeliveryState: null, blockedAttemptId: null, deliveryState: deliveryState });
  }
  function grantManualRetry(key) {
    var record = records[key];
    if (!record || !record.outcome || record.deliveryRoute !== "callback") return { ok: false, error: "completed result is unavailable" };
    if (record.blockedCode === "human_stop") return { ok: false, blocked: true, error: record.blockedReason };
    var exhausted = record.deliveryState === "pending" && Number(record.deliveryAttemptCount || 0) >= MAX_DELIVERY_ATTEMPTS;
    if (record.deliveryState !== "uncertain" && !exhausted) return { ok: false, error: "result is not eligible for manual retry" };
    if (Number(record.manualRetryCount || 0) >= 1) return { ok: false, exhausted: true, error: "manual retry was already used" };
    return transition(key, { state: "captured", blockedReason: null, blockedCode: null, deliveryState: "pending",
      deliveryAttemptCount: 0, attemptId: null, deliveryError: null, manualRetryCount: Number(record.manualRetryCount || 0) + 1,
      manualRetryEpoch: Number(record.manualRetryEpoch || 0) + 1 });
  }
  function persistedRecords() {
    var parsed;
    try { parsed = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch (error) { return []; }
    var source = parsed && parsed.records && typeof parsed.records === "object" ? parsed.records : {};
    return Object.keys(source).map(function (key) {
      var record = copy(source[key]);
      record.deliveryState = record.deliveryState || "pending";
      record.recoveryState = record.state === "dispatching" || record.state === "close_prepared" || record.deliveryState === "attempting" || record.deliveryState === "uncertain" ? "uncertain" : "known";
      record.blockedReason = record.blockedReason || null;
      return record;
    });
  }
  function status() {
    return { records: persistedRecords(), persistenceError: lastPersistenceError };
  }
  read();
  return {
    begin: begin,
    capture: capture,
    prepareCapture: prepareCapture,
    finalizePreparedCapture: finalizePreparedCapture,
    rollbackPreparedCapture: rollbackPreparedCapture,
    beginDelivery: beginDelivery,
    markTranscript: markTranscript,
    markDelivery: markDelivery,
    setRoute: setRoute,
    recover: recover,
    recoverPending: recoverPending,
    markBlocked: markBlocked,
    markFinalized: markFinalized,
    markFinalizationFailure: markFinalizationFailure,
    markRestartUncertain: markRestartUncertain,
    authorizeHumanTurn: authorizeHumanTurn,
    grantManualRetry: grantManualRetry,
    status: status,
    list: function () { return Object.keys(records).map(function (key) { return copy(records[key]); }); },
    get: function (key) { return records[key] ? copy(records[key]) : null; },
    key: resultKey,
    stableOrigin: stableOrigin,
    maxCaptureAttempts: MAX_CAPTURE_ATTEMPTS,
    maxDeliveryAttempts: MAX_DELIVERY_ATTEMPTS,
  };
}

module.exports = { attachPairResultOutbox: attachPairResultOutbox, resultKey: resultKey, stableOrigin: stableOrigin };
