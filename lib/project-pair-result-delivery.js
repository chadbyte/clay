var RETRY_DELAY_MS = 50;
var DEFAULT_ACCEPTANCE_TIMEOUT_MS = 15000;

function attachPairResultDelivery(ctx) {
  function recordMatches(caller, partner, token, record) {
    return !!(record && record.key === token.outboxKey && record.ownerId === (caller.ownerId || null) &&
      record.driverOriginId === ctx.outbox.stableOrigin(caller) && record.workerOriginId === ctx.outbox.stableOrigin(partner) &&
      record.taskId === token.taskId && record.generation === token.generation && record.deliveryRoute === "callback");
  }
  function valid(caller, partner, token) {
    var group = ctx.store.groupForMember(partner.localId), record = ctx.outbox.get(token.outboxKey);
    return !!(group && group.id === token.groupId && group.members.indexOf(caller.localId) !== -1 &&
      group.members.indexOf(partner.localId) !== -1 && group.pair && group.pair.driverId === caller.localId &&
      group.pair.workerId === partner.localId && ctx.sm.sessions.get(caller.localId) === caller &&
      ctx.sm.sessions.get(partner.localId) === partner && caller.ownerId === partner.ownerId &&
      !caller.destroying && !partner.destroying && !ctx.blockedReason(caller) && partner._pairDelegation === token &&
      recordMatches(caller, partner, token, record));
  }
  function currentAttempt(caller, partner, token, attemptId) {
    var record = ctx.outbox.get(token.outboxKey);
    return valid(caller, partner, token) && record && record.deliveryState === "attempting" && record.attemptId === attemptId;
  }
  function textFor(partner, token) {
    var failure = token.failure || null, response = token.response || "";
    if (token.interrupted) return "[Split Worker execution interrupted] The user interrupted the Split Worker mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Review what was done and decide next steps with the user.";
    return "A Split Worker task delegated through send_to_partner has finished.\n\nOriginal task:\n" + token.message + "\n\n" + (failure ? "Split Worker error:\n" + failure : "Split Worker result:\n" + (response || "(No text response was recorded.)")) + "\n\nReview the result, verify it as needed, and continue the task.";
  }
  function finish(caller, partner, token) { return ctx.finish(caller, partner, token, true); }
  function clearAttemptTimer(token, attemptId) {
    if (!token._deliveryTimer || token._deliveryTimer.attemptId !== attemptId) return;
    clearTimeout(token._deliveryTimer.timer);
    delete token._deliveryTimer;
  }
  function retry(caller, partner, token, attemptId, reason) {
    clearAttemptTimer(token, attemptId);
    if (!currentAttempt(caller, partner, token, attemptId)) return { ok: false, stale: true };
    var pending = ctx.outbox.markDelivery(token.outboxKey, attemptId, "pending", { deliveryError: reason || null });
    if (!pending.ok) {
      if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, ctx.outbox.get(token.outboxKey));
      return { ok: false, error: pending.error, stale: pending.stale };
    }
    if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, pending.record);
    if (pending.record.deliveryAttemptCount < ctx.outbox.maxDeliveryAttempts) {
      setTimeout(function () { wake(caller, partner, token); }, RETRY_DELAY_MS * pending.record.deliveryAttemptCount);
    }
    return { ok: false, pending: true };
  }
  function uncertain(caller, partner, token, attemptId, reason) {
    clearAttemptTimer(token, attemptId);
    if (!currentAttempt(caller, partner, token, attemptId)) return false;
    token._deliveryUncertain = true;
    var saved = ctx.outbox.markDelivery(token.outboxKey, attemptId, "uncertain", { deliveryError: reason || "delivery acceptance is uncertain" });
    if (saved.ok && typeof ctx.onStateChange === "function") ctx.onStateChange(caller, saved.record);
    return false;
  }
  function accepted(caller, partner, token, attemptId) {
    clearAttemptTimer(token, attemptId);
    if (!currentAttempt(caller, partner, token, attemptId)) return { ok: false, stale: true };
    var saved = ctx.outbox.markDelivery(token.outboxKey, attemptId, "accepted", { acceptedAt: Date.now() });
    if (!saved.ok) {
      token._deliveryUncertain = true;
      if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, ctx.outbox.get(token.outboxKey));
      return { ok: false, uncertain: true, error: saved.error };
    }
    token._deliveryAccepted = true;
    if (typeof ctx.onStateChange === "function") ctx.onStateChange(caller, saved.record);
    return { ok: true, accepted: true, finished: finish(caller, partner, token) !== false };
  }
  function recordTranscript(caller, token, message, attemptId) {
    var outboxRecord = ctx.outbox.get(token.outboxKey);
    if (outboxRecord && outboxRecord.transcriptPersisted) return { ok: true };
    var matches = function (entry) { return !!(entry && entry.pairResultOutboxKey === token.outboxKey); };
    var existing = caller.history && caller.history.some(matches);
    var durable = existing && typeof ctx.sm.hasDurableSessionRecord === "function" && ctx.sm.hasDurableSessionRecord(caller, matches);
    if (!durable) {
      var record = { type: "user_message", text: message, _internal: true, partnerResult: true,
        pairResultOutboxKey: token.outboxKey, pairResultAttemptId: attemptId };
      var saved;
      try {
        if (typeof ctx.sm.sendAndRecordDurably !== "function") return { ok: false, error: "Durable Driver transcript recording is unavailable" };
        saved = ctx.sm.sendAndRecordDurably(caller, record);
      } catch (error) { return { ok: false, error: error.message || String(error) }; }
      if (saved !== true) {
        if (caller.history && caller.history[caller.history.length - 1] === record) caller.history.pop();
        return { ok: false, error: "Driver transcript persistence failed" };
      }
    }
    var marked = ctx.outbox.markTranscript(token.outboxKey, attemptId);
    return marked.ok ? { ok: true } : { ok: false, error: marked.error, stale: marked.stale };
  }
  function wake(caller, partner, token) {
    if (!token || token._deliveryUncertain || token._deliveryAccepted) return { ok: false, deferred: true };
    if (ctx.blockedReason(caller)) {
      var blocked = ctx.outbox.markBlocked(token.outboxKey, ctx.blockedReason(caller), "human_stop");
      if (blocked.ok && typeof ctx.onStateChange === "function") ctx.onStateChange(caller, blocked.record);
      return { ok: false, blocked: true };
    }
    if (!valid(caller, partner, token)) return { ok: false, deferred: true };
    if (caller._queryStarting) return { ok: false, deferred: true, reason: "query_starting" };
    var started = ctx.outbox.beginDelivery(token.outboxKey);
    if (!started.ok) return { ok: false, pending: true, error: started.error };
    if (started.terminal || started.inFlight || started.blocked || started.exhausted) return { ok: true, terminal: !!started.terminal, exhausted: !!started.exhausted };
    var attemptId = started.attemptId, message = textFor(partner, token);
    var transcript = recordTranscript(caller, token, message, attemptId);
    if (!transcript.ok) return retry(caller, partner, token, attemptId, transcript.error);
    var sdk = ctx.getSdk();
    if (!sdk || typeof sdk.pushMessage !== "function" || typeof sdk.startQuery !== "function") {
      return retry(caller, partner, token, attemptId, "SDK bridge is unavailable");
    }
    try {
      if (caller.queryInstance) {
        if (sdk.pushMessage(caller, message) === true) {
          return accepted(caller, partner, token, attemptId);
        }
        return retry(caller, partner, token, attemptId, "Driver query rejected the result");
      }
      token._deliveryStartupAttemptId = attemptId;
      var beforePush = function () { return token._deliveryStartupAttemptId === attemptId && currentAttempt(caller, partner, token, attemptId); };
      var onAccepted = function () { accepted(caller, partner, token, attemptId); };
      var timeoutMs = Number(ctx.acceptanceTimeoutMs || DEFAULT_ACCEPTANCE_TIMEOUT_MS);
      token._deliveryTimer = { attemptId: attemptId, timer: setTimeout(function () {
        uncertain(caller, partner, token, attemptId, "delivery acceptance timed out");
      }, timeoutMs) };
      var startup = sdk.startQuery(caller, message, undefined, ctx.getLinuxUserForSession(caller), beforePush, onAccepted);
      Promise.resolve(startup).then(function (result) {
        if (!currentAttempt(caller, partner, token, attemptId)) return;
        if (result === false) retry(caller, partner, token, attemptId, "Driver query rejected the result");
      }, function (error) {
        if (currentAttempt(caller, partner, token, attemptId)) uncertain(caller, partner, token, attemptId, error.message || String(error));
      });
      return { ok: false, pending: true };
    } catch (error) {
      return uncertain(caller, partner, token, attemptId, error.message || String(error));
    }
  }
  return { wake: wake };
}

module.exports = { attachPairResultDelivery: attachPairResultDelivery };
