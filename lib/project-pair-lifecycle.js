var eligibility = require("./session-driver-eligibility");
var replacementState = require("./project-pair-replacement-state");
var pairUsage = require("./project-pair-usage");
var contextStatus = pairUsage.contextStatus;
var firstNumber = pairUsage.firstNumber;

var MAX_GENERATIONS = 5;
var MAX_NOTE_CHARS = 400;
var MAX_TASK_PREVIEW_CHARS = 200;

var EVALUATION_OUTCOMES = ["succeeded", "partial", "failed", "abandoned"];

function toolResult(value) {
  return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] });
}

function toolError(message) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + message }],
    isError: true,
  });
}

function clampText(value, max) {
  var text = typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";
  if (text.length > max) text = text.slice(0, max - 1) + "…";
  return text;
}

function replacementFingerprint(args, worker) {
  return JSON.stringify({ sourceWorkerId: worker.localId, interrupt: args.interrupt === true,
    vendor: args.workerVendor || "", model: args.workerModel || "", effort: args.workerEffort || "",
    message: args.message || "", evaluation: args.evaluation || null });
}

function continuityStatus(session) {
  var history = session.history || [];
  var userTurns = 0;
  var errors = 0;
  for (var i = 0; i < history.length; i++) {
    if (!history[i]) continue;
    if (history[i].type === "user_message") userTurns++;
    else if (history[i].type === "error") errors++;
  }
  var lastActivity = typeof session.lastActivity === "number" ? session.lastActivity : null;
  return {
    historyEntries: history.length,
    userTurns: userTurns,
    errorEntries: errors,
    idleSeconds: lastActivity ? Math.max(0, Math.round((Date.now() - lastActivity) / 1000)) : null,
  };
}

function activityStatus(session) {
  var token = session._pairDelegation || null;
  return {
    isProcessing: !!(session.isProcessing || session._queryStarting),
    delegated: !!token,
    currentTask: token ? clampText(token.message, MAX_TASK_PREVIEW_CHARS) : "",
    currentTaskId: token && token.taskId || null,
    interruption: session._pairInterruption || null,
    lastTurnInterrupted: !!session._lastTurnInterrupted,
  };
}

function attachPairLifecycle(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;
  var turnControl = ctx.turnControl;

  function ledgerFor(driver) {
    if (!Array.isArray(driver._workerGenerations)) driver._workerGenerations = [];
    var group = store.groupForMember(driver.localId);
    var worker = group && group.pair && sm.sessions.get(group.pair.workerId);
    var generation = worker && (worker._pairGeneration || worker.sessionProvenance && worker.sessionProvenance.generation);
    if (worker && Number.isInteger(generation) && generation > 0 && !findGeneration(driver, worker)) {
      driver._workerGenerations.push({
        generation: generation,
        workerSessionId: worker.localId,
        workerOriginId: worker.sessionOriginId || null,
        vendor: worker.vendor || null,
        model: worker.model || null,
        effort: worker.effort || null,
        startedAt: worker.sessionProvenance && worker.sessionProvenance.createdAt || Date.now(),
        endedAt: null,
        observed: null,
        evaluation: null,
      });
      while (driver._workerGenerations.length > MAX_GENERATIONS) driver._workerGenerations.shift();
    }
    return driver._workerGenerations;
  }
  function recordGenerationStart(driver, worker) {
    var ledger = ledgerFor(driver);
    var existing = findGeneration(driver, worker);
    if (existing && !existing.endedAt) {
      worker._pairGeneration = existing.generation;
      return existing.generation;
    }
    var generation = 1;
    for (var i = 0; i < ledger.length; i++) {
      if (Number.isInteger(ledger[i].generation) && ledger[i].generation >= generation) generation = ledger[i].generation + 1;
    }
    if (worker.sessionProvenance && Number.isInteger(worker.sessionProvenance.generation) &&
        worker.sessionProvenance.generation >= generation) {
      generation = worker.sessionProvenance.generation;
    }
    ledger.push({
      generation: generation,
      workerSessionId: worker.localId,
      workerOriginId: worker.sessionOriginId || null,
      vendor: worker.vendor || null,
      model: worker.model || null,
      effort: worker.effort || null,
      startedAt: Date.now(),
      endedAt: null,
      observed: null,
      evaluation: null,
    });
    while (ledger.length > MAX_GENERATIONS) ledger.shift();
    worker._pairGeneration = generation;
    if (worker.sessionProvenance) worker.sessionProvenance.generation = generation;
    if (typeof sm.saveSessionFile === "function") {
      sm.saveSessionFile(driver);
      sm.saveSessionFile(worker);
    }
    return generation;
  }
  function findGeneration(driver, worker) {
    var ledger = Array.isArray(driver._workerGenerations) ? driver._workerGenerations : [];
    var originId = worker && worker.sessionOriginId || null;
    for (var i = ledger.length - 1; i >= 0; i--) {
      if (originId && ledger[i].workerOriginId === originId) {
        ledger[i].workerSessionId = worker.localId;
        return ledger[i];
      }
    }
    if (!worker || !originId) return null;
    var generation = worker._pairGeneration || worker.sessionProvenance && worker.sessionProvenance.generation;
    if (!Number.isInteger(generation) || generation < 1) return null;
    var candidates = [];
    for (var j = 0; j < ledger.length; j++) {
      if (!ledger[j].workerOriginId && ledger[j].generation === generation) candidates.push(ledger[j]);
    }
    if (candidates.length !== 1) return null;
    candidates[0].workerOriginId = originId;
    candidates[0].workerSessionId = worker.localId;
    if (typeof sm.saveSessionFile === "function") sm.saveSessionFile(driver);
    return candidates[0];
  }
  function closeGeneration(driver, worker) {
    ledgerFor(driver);
    var record = findGeneration(driver, worker);
    if (!record || record.endedAt) return record;
    var continuity = continuityStatus(worker);
    var context = contextStatus(worker);
    record.endedAt = Date.now();
    record.observed = {
      userTurns: continuity.userTurns,
      errorEntries: continuity.errorEntries,
      interrupted: !!worker._lastTurnInterrupted,
      usedTokens: context.current.usedTokens,
      usedRatio: context.current.usedRatio,
    };
    if (typeof sm.saveSessionFile === "function") sm.saveSessionFile(driver);
    return record;
  }
  function resolveDriverPair(caller) {
    if (!caller) throw new Error("pair lifecycle tools require a session-bound tool server");
    if (sm.sessions.get(caller.localId) !== caller) {
      throw new Error("this session is no longer live; the pair tools are bound to an exact session");
    }
    var verdict = eligibility.evaluateDriverSession(caller, sm);
    if (!verdict.ok) throw new Error(verdict.error);
    var group = store.groupForMember(caller.localId);
    if (!group) throw new Error("this session is not in a split group");
    if (!group.pair) throw new Error("this split group has no Driver/Split Worker roles");
    if (group.pair.driverId !== caller.localId) throw new Error("only the configured Driver can direct this pair");
    var worker = sm.sessions.get(group.pair.workerId);
    if (!worker) throw new Error("split partner session was not found");
    if ((caller.ownerId || null) !== (worker.ownerId || null)) throw new Error("split partner access denied");
    return { group: group, worker: worker };
  }

  function replaceBlockedReason(worker) {
    if (worker.isProcessing || worker._queryStarting) return "the Split Worker is mid-turn";
    if (worker._pairDelegation) return "a delegated task is still open";
    return null;
  }

  function partnerStatus(caller) {
    var resolved = resolveDriverPair(caller);
    var worker = resolved.worker;
    var blocked = turnControl.blockedReason(caller) || replaceBlockedReason(worker);
    var resumeBlocked = turnControl.blockedReason(caller) || (worker.isProcessing || worker._queryStarting ? "the Split Worker is mid-turn" : (!worker._pairInterruption ? "the Split Worker has no interrupted task" : null));
    var ledger = ledgerFor(caller).map(function (record) {
      return {
        generation: record.generation,
        vendor: record.vendor,
        model: record.model,
        effort: record.effort,
        observed: record.observed,
        evaluation: record.evaluation,
      };
    });
    return {
      identity: {
        sessionId: worker.localId,
        originId: worker.sessionOriginId || null,
        kind: worker.sessionProvenance && worker.sessionProvenance.kind || "worker",
        generation: worker._pairGeneration || worker.sessionProvenance && worker.sessionProvenance.generation || null,
      },
      configuration: {
        vendor: worker.vendor || null,
        model: worker.model || null,
        effort: worker.effort || null,
        permissionMode: worker.permissionMode || null,
      },
      time: {
        observedAt: Date.now(),
        createdAt: worker.sessionProvenance && worker.sessionProvenance.createdAt || null,
        lastActivityAt: firstNumber(worker.lastActivityAt, worker.lastActivity),
      },
      worker: {
        sessionId: worker.localId,
        title: worker.title || "New Session",
        vendor: worker.vendor || null,
        model: worker.model || null,
        effort: worker.effort || null,
        generation: worker._pairGeneration || null,
      },
      activity: activityStatus(worker),
      context: contextStatus(worker),
      continuity: continuityStatus(worker),
      orchestration: turnControl.status(caller),
      replaceSafe: !blocked,
      replaceBlockedReason: blocked,
      canReplace: !blocked,
      canReplaceBlockedReason: blocked,
      canResume: !resumeBlocked,
      resumeBlockedReason: resumeBlocked,
      tasks: ctx.taskStatus ? ctx.taskStatus(worker) : null,
      replacement: caller._lastPairReplacement || null,
      proposal: ctx.proposalStatus ? ctx.proposalStatus(caller) : null,
      generations: ledger,
    };
  }

  function sourcePairRegistered(caller, worker) {
    try {
      if (sm.sessions.get(caller.localId) !== caller || sm.sessions.get(worker.localId) !== worker) return false;
      if ((caller.ownerId || null) !== (worker.ownerId || null)) return false;
      var group = store.groupForMember(caller.localId);
      return !!(group && group.pair && group.pair.driverId === caller.localId &&
        group.pair.workerId === worker.localId && group.members.indexOf(caller.localId) !== -1 &&
        group.members.indexOf(worker.localId) !== -1);
    } catch (e) { return false; }
  }

  function restoreSourcePair(ws, caller, worker) {
    try {
      return store.create(ws, {
        members: [caller.localId, worker.localId],
        pair: { driverId: caller.localId, workerId: worker.localId },
      });
    } catch (e) { return { ok: false, error: e.message || String(e) }; }
  }

  function replacementTargetRegistered(caller, oldWorker) {
    try {
      if (sm.sessions.get(caller.localId) !== caller || sm.sessions.get(oldWorker.localId) !== oldWorker) return null;
      var group = store.groupForMember(caller.localId);
      if (!group || !group.pair || group.pair.driverId !== caller.localId ||
          group.pair.workerId === oldWorker.localId) return null;
      var target = sm.sessions.get(group.pair.workerId);
      if (!target || sm.sessions.get(target.localId) !== target) return null;
      return (caller.ownerId || null) === (target.ownerId || null) ? target : null;
    } catch (e) { return null; }
  }

  function replacePartner(args, caller) {
    var resolved = resolveDriverPair(caller);
    var group = resolved.group;
    var oldWorker = resolved.worker;
    ledgerFor(caller);
    turnControl.assertWorkerAction(caller);
    var replacementEntry = replacementState.begin(caller, args.transactionId, oldWorker, replacementFingerprint(args, oldWorker));
    var replay = replacementState.replayValue(replacementEntry);
    if (replay) return Promise.resolve(replay);

    try {
      ctx.preflightWorkerForDriver(caller, {
        workerVendor: args.workerVendor,
        workerModel: args.workerModel,
        workerEffort: args.workerEffort,
      });
    } catch (preflightError) {
      replacementState.fail(replacementEntry.transaction, "preflight_failed", preflightError, "not_required");
      throw preflightError;
    }

    var blocked = replaceBlockedReason(oldWorker);
    if (blocked && args.interrupt !== true) {
      replacementState.fail(replacementEntry.transaction, "preflight_failed", new Error(blocked), "not_required");
      throw new Error("cannot replace the Split Worker because " + blocked +
        "; call again with interrupt set to true to stop it first");
    }

    var creationTicket;
    try {
      if (args.evaluation) validateEvaluation(args.evaluation);
      creationTicket = turnControl.reserveCreation(caller, "replace");
    } catch (validationError) {
      replacementState.fail(replacementEntry.transaction, "preflight_failed", validationError, "not_required");
      throw validationError;
    }

    var ws = { _clayUser: caller.ownerId ? { id: caller.ownerId } : null };
    try {
      if (blocked) {
        replacementState.stage(replacementEntry.transaction, "stopping_source");
        replacementEntry.transaction.sourceStopped = true;
        if (ctx.markInterruption) ctx.markInterruption(oldWorker, "driver", "The Driver accepted replacement of this Worker generation.");
        oldWorker.taskStopRequested = true;
        if (oldWorker.abortController) {
          try { oldWorker.abortController.abort(); } catch (e) {}
        }
        if (oldWorker._pairDelegation && typeof ctx.finishDelegation === "function") {
          if (typeof ctx.completeInterruptedTask === "function") ctx.completeInterruptedTask(oldWorker, caller, oldWorker._pairDelegation);
          ctx.finishDelegation(group, caller, oldWorker, oldWorker._pairDelegation);
        }
      }

      replacementState.stage(replacementEntry.transaction, "cancelling_source_waits");
      if (typeof ctx.cancelWorkerPermissions === "function") {
        ctx.cancelWorkerPermissions(oldWorker, "The Driver replaced this Split Worker.");
      }

      replacementState.stage(replacementEntry.transaction, "dissolving_source_pair");
      var dissolved = store.dissolve(ws, { id: group.id });
      if (!dissolved.ok) throw new Error(dissolved.error || "could not dissolve the existing pair");
    } catch (precreateError) {
      var sourceIntact = sourcePairRegistered(caller, oldWorker);
      var precreateRestored = sourceIntact ? { ok: true } : restoreSourcePair(ws, caller, oldWorker);
      var rollback = precreateRestored && precreateRestored.ok ? (sourceIntact ? "safe_retry" : "source_pair_restored") : "source_pair_restore_failed";
      turnControl.releaseCreation(creationTicket);
      replacementState.fail(replacementEntry.transaction, "precreate_failed", precreateError, rollback);
      throw precreateError;
    }

    var created;
    try {
      replacementState.stage(replacementEntry.transaction, "creating_target");
      created = ctx.createWorkerForDriver(caller, {
        workerVendor: typeof args.workerVendor === "string" ? args.workerVendor : "",
        workerModel: typeof args.workerModel === "string" ? args.workerModel : "",
        workerEffort: typeof args.workerEffort === "string" ? args.workerEffort : "",
      });
    } catch (e) {
      var target = replacementTargetRegistered(caller, oldWorker);
      if (target) {
        var targetClosed = closeGeneration(caller, oldWorker);
        var targetGeneration = recordGenerationStart(caller, target);
        replacementEntry.transaction.targetWorkerId = target.localId;
        replacementEntry.transaction.targetGeneration = targetGeneration;
        replacementEntry.transaction.previousGeneration = targetClosed ? targetClosed.generation : null;
        replacementState.fail(replacementEntry.transaction, "postcommit_delivery_failed", e, "target_created");
        throw new Error("the replacement Split Worker was created, but its delivery confirmation failed. Reuse Worker " + target.localId + " generation " + targetGeneration + " with send_to_partner; do not replace it again. " + (e.message || String(e)));
      }
      var restored = restoreSourcePair(ws, caller, oldWorker);
      var restoredLive = restored && restored.ok && sourcePairRegistered(caller, oldWorker);
      var restoreNote = restoredLive
        ? "The previous pair was restored with its session, history and open generation intact."
        : "The previous pair could not be restored; both sessions are intact and unpaired.";
      var interruptNote = blocked
        ? " Its interrupted turn cannot be resumed, because stopping it was explicitly requested."
        : "";
      turnControl.releaseCreation(creationTicket);
      replacementState.fail(replacementEntry.transaction, "creation_failed", e, restoredLive ? "source_pair_restored" : "source_pair_restore_failed");
      throw new Error("could not create the replacement Split Worker: " + (e.message || String(e)) +
        ". " + restoreNote + interruptNote);
    }
    var closed = closeGeneration(caller, oldWorker);
    if (closed && args.evaluation) {
      applyEvaluation(closed, args.evaluation);
      if (typeof sm.saveSessionFile === "function") sm.saveSessionFile(caller);
    }
    var generation = recordGenerationStart(caller, created.worker);
    var result = {
      status: "replaced",
      previousWorkerSessionId: oldWorker.localId,
      previousWorkerHistoryPreserved: true,
      previousWorkerFilesPreserved: true,
      previousGeneration: closed ? closed.generation : null,
      interrupted: !!blocked,
      workerSessionId: created.worker.localId,
      generation: generation,
      vendor: created.worker.vendor || null,
      model: created.worker.model || null,
      effort: created.worker.effort || null,
      transactionId: replacementEntry.transaction.transactionId,
    };
    replacementState.complete(replacementEntry.transaction, result);

    var message = typeof args.message === "string" ? args.message.trim() : "";
    if (!message) return Promise.resolve(result);
    return Promise.resolve(ctx.sendToPartner({ message: message, wait: args.wait, timeoutSeconds: args.timeoutSeconds }, caller))
      .then(function (delivered) {
        result.delivery = delivered;
        return result;
      });
  }

  function validateEvaluation(raw) {
    var input = typeof raw === "string" ? { outcome: raw } : (raw && typeof raw === "object" ? raw : {});
    var outcome = typeof input.outcome === "string" ? input.outcome.trim().toLowerCase() : "";
    if (EVALUATION_OUTCOMES.indexOf(outcome) === -1) {
      throw new Error('evaluation outcome must be one of: ' + EVALUATION_OUTCOMES.join(", "));
    }
    return { outcome: outcome, note: clampText(input.note, MAX_NOTE_CHARS) };
  }
  function applyEvaluation(record, raw) {
    var clean = validateEvaluation(raw);
    record.evaluation = {
      outcome: clean.outcome,
      note: clean.note,
      recordedAt: Date.now(),
    };
    return record.evaluation;
  }

  function recordEvaluation(args, caller) {
    var resolved = resolveDriverPair(caller);
    var ledger = ledgerFor(caller);
    var target = Number.isInteger(args.generation)
      ? (function () {
        for (var i = 0; i < ledger.length; i++) {
          if (ledger[i].generation === args.generation) return ledger[i];
        }
        return null;
      })()
      : findGeneration(caller, resolved.worker);
    if (!target) throw new Error("no such Split Worker generation for this Driver");
    var evaluation = applyEvaluation(target, args);
    if (typeof sm.saveSessionFile === "function") sm.saveSessionFile(caller);
    return {
      status: "recorded",
      generation: target.generation,
      vendor: target.vendor,
      model: target.model,
      evaluation: evaluation,
      observed: target.observed,
    };
  }

  function optionalStatus(boundSession) {
    try { return partnerStatus(boundSession); } catch (e) { return null; }
  }

  function toolHandlers(boundSession) {
    return {
      status: function () {
        try { return toolResult(partnerStatus(boundSession)); }
        catch (e) { return toolError(e.message || String(e)); }
      },
      replace: function (args) {
        try {
          return Promise.resolve(replacePartner(args || {}, boundSession))
            .then(toolResult, function (e) { return toolError(e.message || String(e)); });
        } catch (e) { return toolError(e.message || String(e)); }
      },
      evaluate: function (args) {
        try { return toolResult(recordEvaluation(args || {}, boundSession)); }
        catch (e) { return toolError(e.message || String(e)); }
      },
    };
  }

  return {
    EVALUATION_OUTCOMES: EVALUATION_OUTCOMES,
    optionalStatus: optionalStatus,
    toolHandlers: toolHandlers,
    closeGeneration: closeGeneration,
    contextStatus: contextStatus,
    ledgerFor: ledgerFor,
    partnerStatus: partnerStatus,
    recordEvaluation: recordEvaluation,
    recordGenerationStart: recordGenerationStart,
    replacePartner: replacePartner,
    resolveDriverPair: resolveDriverPair,
  };
}

module.exports = {
  EVALUATION_OUTCOMES: EVALUATION_OUTCOMES,
  attachPairLifecycle: attachPairLifecycle,
  contextStatus: contextStatus,
};
