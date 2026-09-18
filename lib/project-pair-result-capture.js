function attachPairResultCapture(ctx) {
  function begin(caller, partner, token, message, projectSlug) {
    if (!ctx.resultOutbox) return { ok: true };
    var driverOriginId = ctx.resultOutbox.stableOrigin(caller), workerOriginId = ctx.resultOutbox.stableOrigin(partner);
    if (!driverOriginId || !workerOriginId) return { ok: false, error: "durable session origins are required before dispatch" };
    var started = ctx.resultOutbox.begin({ ownerId: caller.ownerId, projectSlug: projectSlug,
      driverOriginId: driverOriginId, workerOriginId: workerOriginId,
      taskId: token.taskId, generation: token.generation, driverSessionId: caller.localId,
      workerSessionId: partner.localId, historyStartIndex: token.startIndex, message: message,
      deliveryRoute: token.wait === true ? "blocking" : "callback" });
    if (started.ok) token.outboxKey = started.key;
    return started;
  }
  function finish(caller, partner, token, delivered) {
    var group = ctx.store.groupForMember(partner.localId);
    if (token._captureFinished || partner._pairDelegation !== token || !group || group.id !== token.groupId || group.members.indexOf(caller.localId) === -1 || group.members.indexOf(partner.localId) === -1 || (group.pair && (group.pair.driverId !== caller.localId || group.pair.workerId !== partner.localId)) || ctx.sm.sessions.get(caller.localId) !== caller || ctx.sm.sessions.get(partner.localId) !== partner || caller.ownerId !== partner.ownerId) return false;
    token._captureFinished = true;
    try {
      if (typeof ctx.onPartnerResult === "function") ctx.onPartnerResult(caller, partner, token);
      if (token.outboxKey && ctx.resultOutbox) {
        var finalized = ctx.resultOutbox.markFinalized(token.outboxKey);
        if (!finalized.ok) throw new Error(finalized.error || "completed result finalization could not be saved");
      }
      ctx.finishDelegation(group, caller, partner, token);
      if (typeof ctx.onStateChange === "function" && token.outboxKey) ctx.onStateChange(caller, ctx.resultOutbox.get(token.outboxKey));
    } catch (error) {
      token._captureFinished = false;
      token._capturePending = true;
      token._captureHookError = error.message || String(error);
      if (token.outboxKey && ctx.resultOutbox) {
        var failed = ctx.resultOutbox.markFinalizationFailure(token.outboxKey, token._captureHookError);
        if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, Object.assign({}, failed.record || ctx.resultOutbox.get(token.outboxKey), {
          finalizationState: "failed", finalizationError: token._captureHookError, persistenceError: failed.ok ? null : failed.error,
        }));
      }
      return false;
    }
    delete token._capturePending;
    var resumed = delivered ? true : ctx.resumeDriverWithResult(caller, partner, token);
    ctx.drain(caller, partner);
    return resumed;
  }
  function capture(caller, partner, token, outcome) {
    if (!ctx.resultOutbox || !token.outboxKey) return finish(caller, partner, token);
    if (token._captureInProgress || token._captureComplete) return false;
    token._captureInProgress = true;
    var saved;
    try {
      saved = ctx.resultOutbox.capture(token.outboxKey, outcome, function (retryResult) {
        token._captureInProgress = false;
        if (retryResult && retryResult.ok) {
          token._captureComplete = true;
          var record = ctx.resultOutbox.get(token.outboxKey);
          if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, record);
          if (record && record.deliveryRoute === "callback") deliver(caller, partner, token);
          else finish(caller, partner, token);
        }
      });
    } catch (error) {
      token._captureInProgress = false;
      token._capturePending = true;
      token._captureHookError = error.message || String(error);
      return false;
    }
    if (saved.ok) { token._captureInProgress = false; token._captureComplete = true; }
    if (saved.ok) {
      var current = ctx.resultOutbox.get(token.outboxKey);
      if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, current);
      var delivered = current && current.deliveryRoute === "callback" ? deliver(caller, partner, token) : finish(caller, partner, token);
      return delivered === false && token._capturePending ? false : delivered;
    }
    token._capturePending = true;
    if (!token._captureFailureReported) {
      token._captureFailureReported = true;
      try { ctx.sm.sendAndRecord(caller, { type: "error", text: "The Split Worker completed, but its result could not be durably captured yet. The task remains retained for bounded server retry." }); } catch (error) { token._captureNoticeError = error.message || String(error); }
    }
    return false;
  }
  function deliver(caller, partner, token) {
    if (!ctx.delivery) return finish(caller, partner, token);
    return ctx.delivery.wake(caller, partner, token);
  }
  return { begin: begin, capture: capture, deliver: deliver, finish: finish };
}

module.exports = { attachPairResultCapture: attachPairResultCapture };
