// Split Worker lifecycle internals: bounded status, transactional replacement,
// and the per-generation evaluation ledger. The Driver-facing tool posts a
// user-controlled runtime card before accepted replacement reaches this module.
//
// Everything is bound to the exact live pair. The Driver is re-resolved from
// the split store on every call, its structural capability is re-checked every time, and
// ownership must match on both sessions. No active-tab or global-session
// fallback exists in this module.
//
// What replacement deliberately does NOT do: delete history. Dissolving a pair
// leaves both sessions in the project exactly as close_partner already does, so
// the previous Worker's conversation stays browsable and recoverable under the
// existing session semantics. There is no archive concept in the repo to hook
// into, and inventing a destructive one would lose work.

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

// The current task, as a bounded preview of the delegated instruction only.
// Never the transcript: a Driver deciding reuse needs to know what the Worker
// is on, not to re-read its conversation.
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

  // Per-Driver ledger of the Worker generations it has run, newest last.
  // Lives on the live Driver session object: it informs the Driver's next
  // choice within this session and is deliberately not persisted, because a
  // bounded observation of a session that no longer exists would only be
  // misleading after a restart.
  function ledgerFor(driver) {
    if (!Array.isArray(driver._workerGenerations)) driver._workerGenerations = [];
    return driver._workerGenerations;
  }

  function recordGenerationStart(driver, worker) {
    var ledger = ledgerFor(driver);
    var generation = ledger.length + 1;
    ledger.push({
      generation: generation,
      workerSessionId: worker.localId,
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
    return generation;
  }

  function findGeneration(driver, workerSessionId) {
    var ledger = ledgerFor(driver);
    for (var i = ledger.length - 1; i >= 0; i--) {
      if (ledger[i].workerSessionId === workerSessionId) return ledger[i];
    }
    return null;
  }

  // Objective signals the server already has. Recorded when a generation ends
  // so the Driver's next decision can use them without a transcript.
  function closeGeneration(driver, worker) {
    var record = findGeneration(driver, worker.localId);
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
    return record;
  }

  // The exact pair, with the Driver's structural capability re-checked on every call.
  function resolveDriverPair(caller) {
    if (!caller) throw new Error("pair lifecycle tools require a session-bound tool server");
    // Exact live object identity, before anything is read off the caller. A
    // tool handler captured by a query outlives the session it was bound to, so
    // a stale object — or a different object that happens to carry the same
    // localId — must not be able to act as the Driver.
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

  // Bounded status for the reuse-vs-replace decision. Exact pair only; no
  // other user's data and no transcript.
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

  // Transactional replacement. Rejects an active Worker unless interrupt is
  // explicitly true, cancels anything the old Worker was waiting on, dissolves
  // the exact pair without deleting history, and creates a fresh Worker.
  // Idempotent in the sense that it either completes or leaves the existing
  // pair untouched; it never half-dissolves.
  function replacePartner(args, caller) {
    var resolved = resolveDriverPair(caller);
    var group = resolved.group;
    var oldWorker = resolved.worker;
    turnControl.assertWorkerAction(caller);
    var replacementEntry = replacementState.begin(caller, args.transactionId, oldWorker, replacementFingerprint(args, oldWorker));
    var replay = replacementState.replayValue(replacementEntry);
    if (replay) return Promise.resolve(replay);

    // Validate the replacement while the old pair is still fully intact. An
    // uninstalled vendor, an unavailable model or an unsupported effort must
    // never cost the user their running Worker, so this precedes the interrupt,
    // the permission cancellation and the dissolve.
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

    // Any permission decision the old Worker was waiting on dies with the pair.
    replacementState.stage(replacementEntry.transaction, "cancelling_source_waits");
    if (typeof ctx.cancelWorkerPermissions === "function") {
      ctx.cancelWorkerPermissions(oldWorker, "The Driver replaced this Split Worker.");
    }

    var ws = { _clayUser: caller.ownerId ? { id: caller.ownerId } : null };
    replacementState.stage(replacementEntry.transaction, "dissolving_source_pair");
    var dissolved = store.dissolve(ws, { id: group.id });
    if (!dissolved.ok) {
      turnControl.releaseCreation(creationTicket);
      replacementState.fail(replacementEntry.transaction, "dissolve_failed", new Error(dissolved.error || "could not dissolve"), "not_required");
      throw new Error(dissolved.error || "could not dissolve the existing pair");
    }

    // History is preserved: the old Worker session stays in the project.
    //
    // Preflight already cleared every input, but the group write itself can
    // still fail, so the dissolve is rolled back rather than leaving the Driver
    // with no pair at all. The restored group is an equivalent record with the
    // same members and roles; its group id is newly issued.
    //
    // What rollback can and cannot undo:
    //   - Idle replacement failure is fully recoverable. The Worker session,
    //     its history and its still-open ledger generation are all preserved,
    //     and the pair is restored.
    //   - An explicit interrupt=true is NOT reversible. Stopping a mid-turn
    //     Worker aborts its query and cancels the permission decisions it was
    //     waiting on; a later creation failure cannot resume that turn. The
    //     session and its history survive, but the interrupted work does not
    //     come back. The error says so rather than implying a clean restore.
    var created;
    try {
      replacementState.stage(replacementEntry.transaction, "creating_target");
      created = ctx.createWorkerForDriver(caller, {
        workerVendor: typeof args.workerVendor === "string" ? args.workerVendor : "",
        workerModel: typeof args.workerModel === "string" ? args.workerModel : "",
        workerEffort: typeof args.workerEffort === "string" ? args.workerEffort : "",
      });
    } catch (e) {
      var restored = store.create(ws, {
        members: [caller.localId, oldWorker.localId],
        pair: { driverId: caller.localId, workerId: oldWorker.localId },
      });
      var restoreNote = restored && restored.ok
        ? "The previous pair was restored with its session, history and open generation intact."
        : "The previous pair could not be restored; both sessions are intact and unpaired.";
      var interruptNote = blocked
        ? " Its interrupted turn cannot be resumed, because stopping it was explicitly requested."
        : "";
      turnControl.releaseCreation(creationTicket);
      replacementState.fail(replacementEntry.transaction, "creation_failed", e, restored && restored.ok ? "source_pair_restored" : "source_pair_restore_failed");
      throw new Error("could not create the replacement Split Worker: " + (e.message || String(e)) +
        ". " + restoreNote + interruptNote);
    }
    var closed = closeGeneration(caller, oldWorker);
    if (closed && args.evaluation) applyEvaluation(closed, args.evaluation);
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

  // Shape check only; writes nothing. Lets a caller that is about to destroy
  // something reject a malformed assessment first.
  function validateEvaluation(raw) {
    var input = raw && typeof raw === "object" ? raw : {};
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

  // Attach a bounded assessment to one exact Worker generation. The Driver
  // supplies the judgement; the server supplies the objective observations and
  // refuses anything outside the enum. No global or cross-user ranking is
  // formed from this.
  function recordEvaluation(args, caller) {
    var resolved = resolveDriverPair(caller);
    var target = Number.isInteger(args.generation)
      ? (function () {
        var ledger = ledgerFor(caller);
        for (var i = 0; i < ledger.length; i++) {
          if (ledger[i].generation === args.generation) return ledger[i];
        }
        return null;
      })()
      : findGeneration(caller, resolved.worker.localId);
    if (!target) throw new Error("no such Split Worker generation for this Driver");
    var evaluation = applyEvaluation(target, args);
    return {
      status: "recorded",
      generation: target.generation,
      vendor: target.vendor,
      model: target.model,
      evaluation: evaluation,
      observed: target.observed,
    };
  }

  // Tool handlers for the three lifecycle tools, with this module's own error
  // shaping. Kept here so the pair coordinator only wires names to handlers.
  // partnerStatus, or null when this session cannot legitimately ask for it.
  // Lets read_partner fold the capacity report in without duplicating the
  // guard chain or swallowing errors inline at the call site.
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
