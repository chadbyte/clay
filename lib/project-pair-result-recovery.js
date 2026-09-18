var crypto = require("crypto");
var splitRoles = require("./session-split-group-roles");

function attachPairResultRecovery(ctx) {
  var scheduled = Object.create(null);
  var runtimeStatus = Object.create(null);

  function opaqueId(key) {
    return crypto.createHash("sha256").update(String(key)).digest("hex").slice(0, 24);
  }
  function ownerId(session) { return session && session.ownerId || null; }
  function findOrigin(originId) {
    var found = null, duplicate = false;
    ctx.sm.sessions.forEach(function (session) {
      if (!session || session.sessionOriginId !== originId) return;
      if (found) duplicate = true;
      else found = session;
    });
    return duplicate ? null : found;
  }
  function resolve(record) {
    if (!record || record.projectSlug !== ctx.projectSlug) return { ok: false, code: "project", reason: "This completed result belongs to a different project." };
    var driver = findOrigin(record.driverOriginId), worker = findOrigin(record.workerOriginId);
    if (!driver || !worker) return { ok: false, code: "session", reason: "The original Driver or Split Worker session is unavailable." };
    if (ownerId(driver) !== (record.ownerId || null) || ownerId(worker) !== (record.ownerId || null)) return { ok: false, code: "owner", reason: "The original session owner no longer matches." };
    var group = ctx.store.groupForMember(driver.localId);
    var roles = splitRoles.resolveLiveRoles(ctx.sm, group);
    if (!group || ctx.store.groupForMember(worker.localId) !== group || !roles ||
        roles.driver !== driver || roles.workers.indexOf(worker) === -1) {
      return { ok: false, code: "pair", reason: "The original Driver and Split Worker pair is no longer active." };
    }
    var provenance = worker.sessionProvenance;
    if (!provenance || provenance.kind !== "worker" || provenance.parentSessionOriginId !== record.driverOriginId || provenance.generation !== record.generation) {
      return { ok: false, code: "generation", reason: "The Split Worker generation no longer matches this completed result." };
    }
    if (worker._pairDelegation && (worker._pairDelegation.outboxKey !== record.key || worker._pairDelegation.taskId !== record.taskId)) {
      return { ok: false, code: "active_task", reason: "A newer Split Worker task is active, so this result cannot be restored automatically." };
    }
    return { ok: true, driver: driver, worker: worker, group: group };
  }
  function tokenFor(record, resolved) {
    var token = resolved.worker._pairDelegation;
    if (token && token.outboxKey === record.key) {
      if (Number(record.manualRetryEpoch || 0) > Number(token._manualRetryEpochApplied || 0)) {
        if (token._deliveryTimer && token._deliveryTimer.timer) clearTimeout(token._deliveryTimer.timer);
        delete token._deliveryTimer; delete token._deliveryUncertain; delete token._deliveryAccepted;
        delete token._deliveryStartupAttemptId;
        token._manualRetryEpochApplied = Number(record.manualRetryEpoch || 0);
      }
      return token;
    }
    token = {
      outboxKey: record.key, taskId: record.taskId, generation: record.generation,
      workerSessionId: resolved.worker.localId, workerId: resolved.worker.localId,
      from: resolved.driver.localId, groupId: resolved.group.id,
      startIndex: Number.isInteger(record.historyStartIndex) ? record.historyStartIndex : resolved.worker.history.length,
      message: record.message || "", wait: record.deliveryRoute === "blocking",
      detached: record.deliveryRoute === "callback", detachRequested: record.deliveryRoute === "callback",
      response: record.outcome && record.outcome.response || "",
      failure: record.outcome && record.outcome.error || null,
      interrupted: !!(record.outcome && record.outcome.status === "interrupted"),
      _captureComplete: true,
      _manualRetryEpochApplied: Number(record.manualRetryEpoch || 0),
    };
    resolved.worker._pairDelegation = token;
    resolved.worker._delegatedBy = resolved.driver.localId;
    return token;
  }
  function block(record, reason, code) {
    if (record.deliveryState === "accepted" && record.finalized) return;
    var saved = ctx.outbox.markBlocked(record.key, reason, code);
    if (saved.ok) changed();
  }
  function process(key, allowDelivery) {
    delete scheduled[key];
    var record = ctx.outbox.get(key);
    if (!record || !record.outcome) return { ok: false, deferred: true };
    if (record.finalized) return { ok: true, finalized: true };
    if (record.blockedCode === "human_stop") return { ok: false, blocked: true };
    var resolved = resolve(record);
    if (!resolved.ok) {
      block(record, resolved.reason, resolved.code);
      return { ok: false, blocked: true };
    }
    var stopReason = typeof ctx.blockedReason === "function" ? ctx.blockedReason(resolved.driver) : null;
    if (stopReason) {
      block(record, stopReason, "human_stop");
      return { ok: false, blocked: true };
    }
    if (record.finalizationState === "failed") return { ok: false, blocked: true };
    var token = tokenFor(record, resolved);
    if (record.deliveryRoute === "blocking" || record.deliveryState === "accepted") {
      var finished = ctx.resultCapture.finish(resolved.driver, resolved.worker, token, record.deliveryState === "accepted");
      changed(resolved.driver);
      return { ok: finished !== false, finalized: finished !== false };
    }
    if (record.deliveryState === "uncertain") return { ok: false, uncertain: true };
    if (!allowDelivery) return { ok: false, deferred: true };
    var result = ctx.wake(resolved.driver, resolved.worker, token);
    changed(resolved.driver);
    return result;
  }
  function schedule(key) {
    if (scheduled[key]) return;
    scheduled[key] = true;
    setImmediate(function () { process(key, true); });
  }
  function healthyLiveDispatch(record) {
    if (!record || record.outcome || record.state === "blocked") return false;
    var resolved = resolve(record);
    if (!resolved.ok) return false;
    var token = resolved.worker._pairDelegation;
    return !!(token && token.outboxKey === record.key && token.taskId === record.taskId && token.generation === record.generation &&
      token.from === resolved.driver.localId && token.groupId === resolved.group.id && !token._capturePending && !token._captureHookError &&
      (resolved.worker.isProcessing || resolved.worker._queryStarting));
  }
  function recordsFor(session) {
    if (!session) return [];
    var originId = session.sessionOriginId, currentOwner = ownerId(session);
    return ctx.outbox.list().map(function (record) {
      return runtimeStatus[record.key] ? Object.assign({}, record, runtimeStatus[record.key]) : record;
    }).filter(function (record) {
      if (record.projectSlug !== ctx.projectSlug || record.driverOriginId !== originId || (record.ownerId || null) !== currentOwner) return false;
      if (record.state === "close_prepared") return false;
      if (healthyLiveDispatch(record)) return false;
      if (record.finalized) return false;
      if (record.deliveryState === "accepted") return record.state === "blocked" || record.finalizationState === "failed";
      return true;
    });
  }
  function publicItem(record) {
    var completed = !!record.outcome;
    var finalizationFailed = record.finalizationState === "failed";
    var state = record.state === "blocked" || finalizationFailed ? "blocked" : record.deliveryState;
    if (state === "attempting") state = "uncertain";
    if (!completed && state !== "blocked") state = "uncertain";
    var exhausted = state === "pending" && Number(record.deliveryAttemptCount || 0) >= ctx.outbox.maxDeliveryAttempts;
    return {
      id: opaqueId(record.key), state: exhausted ? "pending" : state,
      message: record.blockedReason || record.finalizationError || (!completed ? "The Split Worker task was retained, but no durable completed result is available yet." :
        (state === "uncertain" ? "Delivery could not be confirmed. The Driver may already have received this result." :
        (exhausted ? "Automatic delivery could not complete. The finished result is retained." : "The finished Split Worker result is waiting to be delivered."))),
      response: completed ? record.outcome.response || "" : "", error: completed ? record.outcome.error || null : null,
      hasCompletedResult: completed,
      canRetry: completed && !finalizationFailed && record.blockedCode !== "human_stop" && Number(record.manualRetryCount || 0) < 1 && (state === "uncertain" || exhausted),
      confirmDuplicate: completed && state === "uncertain",
    };
  }
  function canRead(ws, session) {
    if (!ws || !session || ws._clayActiveSession !== session.localId) return false;
    if (ownerId(session)) return !!(ws._clayUser && String(ws._clayUser.id) === String(ownerId(session)));
    return !ws._clayUser || !ctx.isMultiUser();
  }
  function sendState(session, ws, sendFn) {
    if (!canRead(ws, session)) return false;
    var items = recordsFor(session).map(publicItem);
    (sendFn || ctx.sendTo.bind(null, ws))({ type: "pair_result_status", sessionId: session.localId, items: items });
    return true;
  }
  function changed(driver) {
    var targets = typeof ctx.getClients === "function" ? ctx.getClients() : [];
    for (var ws of targets) {
      var session = driver || ctx.sm.sessions.get(ws._clayActiveSession);
      if (session) sendState(session, ws);
    }
  }
  function stateChanged(driver, record) {
    if (record && record.key && record.persistenceError) runtimeStatus[record.key] = {
      finalizationState: record.finalizationState, finalizationError: record.finalizationError,
    };
    if (record && record.key && record.finalized) delete runtimeStatus[record.key];
    changed(driver);
    if (record && !record.finalized && record.finalizationState !== "failed" && (record.deliveryState === "accepted" || record.deliveryRoute === "blocking")) schedule(record.key);
  }
  function available(session) {
    if (!session) return;
    var origin = session.sessionOriginId;
    var records = ctx.outbox.list();
    for (var i = 0; i < records.length; i++) {
      if (records[i].driverOriginId === origin && records[i].outcome && records[i].deliveryState === "pending" && records[i].state !== "blocked") schedule(records[i].key);
    }
  }
  function reconcile() {
    var records = ctx.outbox.list();
    for (var i = 0; i < records.length; i++) {
      var record = records[i];
      if (!record.outcome) continue;
      if (record.deliveryState === "attempting") {
        var uncertain = ctx.outbox.markRestartUncertain(record.key);
        if (uncertain.ok && uncertain.record) record = uncertain.record;
      }
      process(record.key, false);
      record = ctx.outbox.get(record.key);
      if (record && record.deliveryState === "pending" && record.state !== "blocked" && record.finalizationState !== "failed") schedule(record.key);
    }
  }
  function beginHumanTurn(session) {
    var records = recordsFor(session);
    for (var i = 0; i < records.length; i++) {
      if (records[i].blockedCode !== "human_stop") continue;
      var saved = ctx.outbox.authorizeHumanTurn(records[i].key);
      if (saved.ok && saved.record.outcome && (saved.record.deliveryState === "pending" || saved.record.deliveryState === "accepted")) schedule(records[i].key);
    }
    changed(session);
  }
  function handleMessage(ws, msg) {
    if (!msg || (msg.type !== "pair_result_state_request" && msg.type !== "pair_result_retry")) return false;
    var session = ctx.sm.sessions.get(ws._clayActiveSession);
    if (!canRead(ws, session)) return true;
    if (msg.sessionId != null && msg.sessionId !== session.localId) return true;
    if (msg.projectSlug && msg.projectSlug !== ctx.projectSlug) return true;
    if (msg.type === "pair_result_state_request") { sendState(session, ws); return true; }
    var records = recordsFor(session), record = null;
    for (var i = 0; i < records.length; i++) if (opaqueId(records[i].key) === msg.id) record = records[i];
    if (!record) { sendState(session, ws); return true; }
    if (record.deliveryState === "uncertain" && msg.confirmDuplicate !== true) { sendState(session, ws); return true; }
    var granted = ctx.outbox.grantManualRetry(record.key);
    if (granted.ok) schedule(record.key);
    changed(session);
    return true;
  }
  if (ctx.sm && typeof ctx.sm.addOnSessionViewed === "function") {
    ctx.sm.addOnSessionViewed(function (session, ws, sendFn) { available(session); sendState(session, ws, sendFn); });
  }
  return { available: available, beginHumanTurn: beginHumanTurn, changed: changed, stateChanged: stateChanged, handleMessage: handleMessage,
    reconcile: reconcile, sendState: sendState, process: process };
}

module.exports = { attachPairResultRecovery: attachPairResultRecovery };
