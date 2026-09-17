var crypto = require("crypto");
var buildShape = require("./session-spawn-mcp-server").buildShape;
var sessionProvenance = require("./session-provenance");
var workspaceSessionRef = require("./workspace-query-service").sessionRef;
var workerProposalControl = require("./worker-proposal-control");
var transaction = require("./driver-continuation-transaction");
var continuationAccess = require("./driver-continuation-access");
var continuationLease = require("./driver-continuation-lease");
var continuationStartup = require("./driver-continuation-startup");
var continuationTrigger = require("./driver-continuation-trigger");
var continuationPair = require("./driver-continuation-pair");
var attachContinuationPairTransfer = require("./driver-continuation-pair-transfer").attachContinuationPairTransfer;
var continuationRecord = require("./driver-continuation-record");
var contextKey = continuationRecord.contextKey, findProposal = continuationRecord.findProposal,
  hasEntries = continuationRecord.hasEntries, text = continuationRecord.text, toolResult = continuationRecord.toolResult;
var MAX_FIELD_CHARS = 2400;
var MAX_TOTAL_CHARS = 14000;
var ACTIVE_RUN_STATES = ["armed", "running", "reviewing", "waiting-worker", "waiting-user", "paused"];
var HANDOFF_FIELDS = ["goal", "constraints", "decisions", "rejectedApproaches", "unresolved", "nextAction", "verification", "repositoryState"];
function attachDriverContinuation(ctx) {
  var sm = ctx.sm;
  function isLiveDriver(session) {
    return continuationAccess.isLiveDriver(session, ctx.isMate, sm.sessions, ctx.isDriverOperatedSession);
  }

  function skipPermissions(session) {
    return !!(ctx.dangerouslySkipPermissions || session && (
      session.dangerouslySkipPermissions || session.permissionMode === "bypassPermissions" ||
      session.effectivePermissionMode === "bypassPermissions"
    ));
  }
  function authorize(session, ownerId) {
    if (!isLiveDriver(session) || (session.ownerId || null) !== (ownerId || null)) return false;
    try { return ctx.authorizeSession(session, ownerId) === true; }
    catch (e) { return false; }
  }
  function update(session, proposal, patch) {
    var applied = transaction.persist([{ target: proposal, patch: Object.assign({}, patch, { updatedAt: Date.now() }) }], function () {
      return sm.saveSessionFile(session);
    });
    if (!applied.ok) return false;
    sm.sendToSession(session, Object.assign({
      type: "driver_continuation_update",
      proposalId: proposal.proposalId,
      sourceSessionId: session.localId,
      sourceOriginId: proposal.sourceOriginId,
      projectSlug: ctx.projectSlug,
    }, patch));
    return true;
  }

  function updateTarget(target, patch) {
    return transaction.persist([{ target: target.driverContinuation, patch: patch }], function () {
      return sm.saveSessionFile(target);
    }).ok;
  }

  function normalizedHandoff(args) {
    var handoff = {};
    var total = 0;
    for (var i = 0; i < HANDOFF_FIELDS.length; i++) {
      var field = HANDOFF_FIELDS[i];
      handoff[field] = text(args[field], MAX_FIELD_CHARS);
      total += handoff[field].length;
    }
    if (!handoff.goal || !handoff.nextAction) return { error: "goal and nextAction are required." };
    if (total > MAX_TOTAL_CHARS) return { error: "The continuation handoff is too long." };
    return { value: handoff };
  }

  function proposalReason(args) {
    return text(args && args.reason, 800);
  }

  function propose(args, session, generation) {
    if (!authorize(session, session && session.ownerId || null)) return toolResult({ error: "Driver continuation requires an authorized live Project Driver session." });
    if (skipPermissions(session)) return toolResult({ error: "Driver continuation proposals are disabled while Skip permissions is selected or forced." });
    if (Number.isInteger(generation) && Number(session._sdkQueryGeneration || 0) !== generation) {
      return toolResult({ error: "This continuation tool belongs to an older query." });
    }
    var reason = proposalReason(args);
    var milestone = text(args && args.milestone, 1200);
    var benefit = text(args && args.benefit, 1200);
    var normalized = normalizedHandoff(args || {});
    if (normalized.error) return toolResult({ error: normalized.error });
    var eligibility = continuationTrigger.evaluate(session, ctx, {
      reason: reason, milestone: milestone, benefit: benefit, nextAction: normalized.value.nextAction,
    });
    if (eligibility.error) return toolResult({ error: eligibility.error,
      proposalId: eligibility.previous && eligibility.previous.proposalId || undefined });
    var key = contextKey(session);
    sessionProvenance.ensureOrigin(session);
    var proposal = {
      type: "driver_continuation_proposal",
      proposalId: "continuation_" + crypto.randomUUID(),
      status: "pending",
      reason: reason,
      milestone: milestone,
      benefit: benefit,
      handoff: normalized.value,
      contextKey: key,
      sourceSessionId: session.localId,
      sourceOriginId: session.sessionOriginId,
      sourceSessionRef: workspaceSessionRef(ctx.projectSlug, session),
      ownerId: session.ownerId || null,
      projectSlug: ctx.projectSlug,
      contextStatus: eligibility.status,
      triggerEvidence: eligibility.evidence,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    var posted = transaction.appendPersisted(session, proposal, function () {
      return sm.saveSessionFile(session);
    });
    if (!posted.ok) {
      return toolResult({ error: "The continuation proposal could not be persisted. No review card was posted." });
    }
    sm.sendToSession(session, proposal);
    return toolResult({
      status: "posted",
      proposalId: proposal.proposalId,
      instruction: "The continuation card is waiting for the user's explicit choice. End this turn without accepting it yourself.",
    });
  }

  function unsafeReason(session) {
    if (session.isProcessing || session._queryStarting || session._awaitingTurnResult) return "Wait for the current Driver turn to finish, then retry.";
    if (ctx.pendingMessageQueue && ctx.pendingMessageQueue.hasActive(session)) return "Pending human messages must be handled here before continuing in a new session.";
    if (session.scheduledMessage || session.rateLimitAutoContinuePending) return "A scheduled callback is still attached to this session.";
    if (session.autonomousRun && ACTIVE_RUN_STATES.indexOf(session.autonomousRun.state) !== -1) return "Until complete is still active in this session.";
    if (hasEntries(session.pendingPermissions) || hasEntries(session.pendingAskUser) ||
        hasEntries(session.pendingElicitations) || hasEntries(session.pendingUserDialogs)) {
      return "This session is waiting for a permission or user-input response.";
    }
    if (workerProposalControl.pendingProposal(session)) return "A Split Worker proposal is still waiting for a decision.";
    var pair = continuationPair.inspect(session, ctx);
    if (!pair.ok) return pair.error;
    if (!pair.group && (session._pairDelegation || continuationPair.activeFollowups(session))) {
      return "Split Worker work or follow-ups are still pending.";
    }
    if (session.pendingPush && session.pendingPush.length) return "Messages are still waiting for delivery in this session.";
    if (session.taskStopRequested || session.destroying || session._runtimeRefreshRequested) return "This session is changing state; retry when it is idle.";
    return "";
  }

  function actorForResponse(ws, source) {
    var userId = ws && ws._clayUser ? ws._clayUser.id : null;
    if (ws._clayActiveSession !== source.localId) throw new Error("The continuation decision belongs to another source session.");
    if (ctx.isMultiUser()) {
      if (!userId || source.ownerId !== userId) throw new Error("Only the source Driver owner can decide this continuation.");
    } else if (source.ownerId) {
      throw new Error("The source Driver owner is unavailable.");
    }
    if (!authorize(source, userId)) throw new Error("Driver continuation access changed.");
    return userId;
  }

  function successorFor(proposal) {
    var found = null;
    sm.sessions.forEach(function (candidate) {
      if (found || !candidate || !candidate.driverContinuation) return;
      if (candidate.driverContinuation.proposalId === proposal.proposalId &&
          candidate.driverContinuation.sourceOriginId === proposal.sourceOriginId &&
          candidate.driverContinuation.projectSlug === ctx.projectSlug &&
          (candidate.ownerId || null) === proposal.ownerId) found = candidate;
    });
    return found;
  }

  function startupProven(candidate) {
    var relation = candidate && candidate.driverContinuation;
    return !!(candidate && candidate.cliSessionId && relation &&
      relation.startupProof === "initialized" && Number.isInteger(relation.acceptedQueryGeneration));
  }

  function acceptanceError(ws, source, proposal) {
    actorForResponse(ws, source);
    if (skipPermissions(source)) return "Driver continuation is disabled while Skip permissions is selected or forced.";
    if (proposal.contextKey !== contextKey(source)) return "The source work changed after this proposal. Ask the Driver to prepare a fresh continuation.";
    return unsafeReason(source);
  }

  function releaseLease(source, lease) {
    if (!continuationLease.end(source, lease)) return false;
    if (typeof ctx.consumePendingMessage === "function") {
      setImmediate(function () { ctx.consumePendingMessage(source); });
    }
    return true;
  }

  var pairTransferControl = attachContinuationPairTransfer({ ctx: ctx, update: update,
    beginLease: continuationLease.begin, releaseLease: releaseLease });

  function commitRelation(source, proposal, target) {
    var relation = target.driverContinuation;
    var transactionId = relation.transactionId || proposal.transactionId || "transition_" + crypto.randomUUID();
    if (!startupProven(target)) {
      return { ok: false, error: "The successor has no verified startup proof." };
    }
    if (relation.status === "starting") {
      if (!updateTarget(target, { status: "prepared", transactionId: transactionId, preparedAt: Date.now() })) {
        return { ok: false, error: "The prepared successor relationship could not be persisted." };
      }
    }
    if (proposal.status !== "accepted" && proposal.transactionId !== transactionId) {
      if (!update(source, proposal, { status: "starting", transactionId: transactionId, targetSessionId: target.localId,
        targetOriginId: target.sessionOriginId, error: null })) {
        return { ok: false, error: "The source continuation relationship could not be persisted." };
      }
    }
    if (relation.status !== "accepted") {
      if (!updateTarget(target, { status: "accepted", transactionId: transactionId, acceptedAt: Date.now() })) {
        return { ok: false, error: "The accepted successor relationship could not be persisted." };
      }
    }
    if (proposal.status !== "accepted") {
      if (!update(source, proposal, { status: "accepted", transactionId: transactionId, targetSessionId: target.localId,
        targetOriginId: target.sessionOriginId, acceptedAt: Date.now(), error: null })) {
        return { ok: false, error: "The accepted source relationship could not be persisted." };
      }
    }
    if (!transaction.accepted(proposal, relation)) return { ok: false, error: "The continuation relationship is not durably complete." };
    return { ok: true };
  }

  async function accept(ws, source, proposal) {
    var ownerId = actorForResponse(ws, source);
    var reason = acceptanceError(ws, source, proposal);
    if (reason) {
      if (proposal.contextKey !== contextKey(source)) {
        update(source, proposal, { status: "superseded", error: reason });
      }
      throw new Error(reason);
    }
    var existing = successorFor(proposal);
    if (existing) {
      if (!authorize(existing, ownerId)) throw new Error("Successor continuation access changed.");
      if (!startupProven(existing)) {
        if (!existing.queryInstance && !existing.isProcessing && !existing._queryStarting) {
          sm.deleteSessionQuiet(existing.localId);
          update(source, proposal, { status: "superseded", targetSessionId: null, targetOriginId: null,
            error: "The prior successor did not survive startup. Prepare a fresh continuation proposal." });
          throw new Error("The prior successor did not survive startup. Prepare a fresh continuation proposal.");
        }
        throw new Error("The successor is still starting. Wait for initialization confirmation before retrying.");
      }
      var retainedLease = source._driverContinuationLease;
      if (!retainedLease) {
        var recoveredPair = pairTransferControl.recoverIfNeeded(source, existing, proposal);
        if (!recoveredPair.ok) throw new Error(recoveredPair.error);
        retainedLease = recoveredPair.lease;
      }
      if (retainedLease && retainedLease.proposalId === proposal.proposalId && retainedLease.target === existing) {
        var retryReason = pairTransferControl.retryError(source, existing, retainedLease, function () {
          return acceptanceError(ws, source, proposal);
        });
        if (retryReason) throw new Error(retryReason);
        var existingPairCommit = pairTransferControl.commitOrCancel(retainedLease);
        if (!existingPairCommit.ok) throw new Error(existingPairCommit.error);
      }
      var existingCommit = commitRelation(source, proposal, existing);
      if (!existingCommit.ok) throw new Error(existingCommit.error);
      if (retainedLease && retainedLease.proposalId === proposal.proposalId && retainedLease.target === existing) {
        releaseLease(source, retainedLease);
      }
      sm.switchSession(existing.localId, ws);
      return { ok: true, status: "accepted", targetSessionId: existing.localId };
    }
    if (proposal.status === "starting") {
      if (!update(source, proposal, { status: "pending", error: "The prior startup did not leave a durable successor. Retry when ready." })) {
        throw new Error("The stale startup state could not be persisted.");
      }
    }
    if (proposal.status !== "pending") throw new Error("This continuation proposal has already been resolved.");
    var target = sm.createSessionRaw({
      ownerId: source.ownerId || null,
      sessionVisibility: source.sessionVisibility,
      vendor: source.vendor,
      model: source.model,
      effort: source.effort,
      permissionMode: source.permissionMode || null,
    });
    target.mcpPermissionModeOverrides = Object.assign({}, source.mcpPermissionModeOverrides || {});
    target.effectivePermissionMode = null;
    target.title = (source.title || "Continued work") + " · Continued";
    target.driverContinuation = {
      proposalId: proposal.proposalId,
      sourceOriginId: proposal.sourceOriginId,
      sourceSessionRef: proposal.sourceSessionRef,
      projectSlug: ctx.projectSlug,
      status: "starting",
      createdAt: Date.now(),
    };
    sm.sendAndRecord(target, {
      type: "driver_continuation_context",
      proposalId: proposal.proposalId,
      sourceSessionId: source.localId,
      sourceOriginId: proposal.sourceOriginId,
      sourceSessionRef: proposal.sourceSessionRef,
      projectSlug: ctx.projectSlug,
      reason: proposal.reason,
      goal: proposal.handoff.goal,
      nextAction: proposal.handoff.nextAction,
      repositoryState: proposal.handoff.repositoryState,
      _ts: Date.now(),
    });
    if (!update(source, proposal, { status: "starting", targetSessionId: target.localId, targetOriginId: target.sessionOriginId, error: null })) {
      sm.deleteSessionQuiet(target.localId);
      var persistenceError = "The source continuation proposal could not be persisted.";
      update(source, proposal, { status: "pending", targetSessionId: null, targetOriginId: null, error: persistenceError });
      throw new Error(persistenceError);
    }
    target.isProcessing = true;
    target.sentToolResults = {};
    ctx.onProcessingChanged();
    var lease = continuationLease.begin(source, target, proposal.proposalId);
    var pairTransfer = pairTransferControl.begin(source, target, proposal, lease);
    if (!pairTransfer.ok) {
      releaseLease(source, lease);
      sm.deleteSessionQuiet(target.localId);
      update(source, proposal, { status: "pending", targetSessionId: null, targetOriginId: null, error: pairTransfer.error });
      throw new Error(pairTransfer.error);
    }
    function startupAcceptanceError() {
      return pairTransferControl.validationError(source, target, lease, function () {
        return acceptanceError(ws, source, proposal);
      });
    }
    var started = false;
    var retainTarget = false;
    var timedOut = false;
    function lateStartup(lifecycle) {
      continuationStartup.handleLate({ sm: sm, source: source, target: target, proposal: proposal, lease: lease,
        validate: startupAcceptanceError,
        commitPair: function () { return pairTransferControl.commit(lease); },
        release: function () { releaseLease(source, lease); },
        update: function (patch) { return update(source, proposal, patch); } }, lifecycle);
    }
    try {
      var sdk = ctx.getSdk();
      if (!sdk || typeof sdk.startQueryWithAcceptance !== "function") throw new Error("SDK bridge cannot confirm successor startup.");
      var lifecycle = await sdk.startQueryWithAcceptance(target, continuationStartup.compactPrompt(proposal), undefined,
        ctx.getLinuxUserForSession(target), function () {
          return continuationLease.guard(lease, startupAcceptanceError);
        }, lateStartup);
      started = !!(lifecycle && lifecycle.accepted === true);
      retainTarget = !!(lifecycle && lifecycle.initialAccepted === true && lifecycle.queryAlive === true);
      timedOut = !!(lifecycle && lifecycle.timedOut === true);
      if (!started) throw new Error(lease.error || lifecycle && lifecycle.reason || "The successor agent did not accept the compact handoff.");
      if (!Number.isInteger(lifecycle.queryGeneration)) throw new Error("The successor has no verified startup proof.");
      target.driverContinuation.acceptedQueryGeneration = lifecycle.queryGeneration;
      target.driverContinuation.acceptedInitialAt = Date.now();
      target.driverContinuation.startupProof = "initialized";
      if (!await continuationStartup.waitForDurableIdentity(sm, target, ctx.identityWaitMs)) throw new Error("The successor accepted its handoff but did not receive a durable session identity in time.");
      if (!transaction.saveObserved(function () { return sm.saveSessionFile(target); })) {
        lease.waitingCommit = true;
        throw new Error("The verified successor startup could not be persisted. Retry without starting another successor.");
      }
      try { reason = startupAcceptanceError(); }
      catch (revalidationError) { reason = revalidationError.message || String(revalidationError); }
      if (reason) {
        lease.cancel(reason);
        throw new Error(reason);
      }
      lease.waitingCommit = true;
      var pairCommitted = pairTransferControl.commit(lease);
      if (!pairCommitted.ok) {
        lease.cancel(pairCommitted.error);
        throw new Error(pairCommitted.error);
      }
      var committed = commitRelation(source, proposal, target);
      if (!committed.ok) throw new Error(committed.error);
      releaseLease(source, lease);
      sm.broadcastSessionList();
      sm.switchSession(target.localId, ws);
      return { ok: true, status: "accepted", targetSessionId: target.localId, ownerId: ownerId };
    } catch (error) {
      if (timedOut && retainTarget && !lease.cancelled) lease.waitingLateStartup = true;
      else if (!lease.waitingCommit && !lease.cancelled) {
        pairTransferControl.rollback(lease);
        releaseLease(source, lease);
      }
      if (lease.cancelled && !lease.cleanupComplete) {
        error = new Error(lease.cleanupError || error.message || String(error));
      } else if (!lease.cleanupComplete && started !== true && retainTarget !== true) {
        pairTransferControl.rollback(lease);
        sm.deleteSessionQuiet(target.localId);
      }
      if (proposal.status !== "accepted") update(source, proposal, {
        status: lease.cancelled ? "superseded" : "pending", targetSessionId: sm.sessions.has(target.localId) ? target.localId : null,
        targetOriginId: sm.sessions.has(target.localId) ? target.sessionOriginId : null,
        error: error.message || String(error),
      });
      throw error;
    }
  }
  async function respond(ws, msg) {
    var ownerId = ws && ws._clayUser ? ws._clayUser.id : null;
    var source = continuationAccess.findOwnedSessionByOrigin(sm.sessions, msg.sourceOriginId, ownerId);
    if (!source) throw new Error("The source Driver session no longer exists.");
    actorForResponse(ws, source);
    var proposal = findProposal(source, msg.proposalId);
    if (!proposal || proposal.ownerId !== (source.ownerId || null) || proposal.projectSlug !== ctx.projectSlug ||
        proposal.sourceOriginId !== source.sessionOriginId || proposal.sourceOriginId !== msg.sourceOriginId) {
      throw new Error("The exact continuation proposal was not found.");
    }
    if (msg.accepted !== true) {
      if (proposal.status !== "pending") throw new Error("This continuation proposal has already been resolved.");
      var declinedAt = Date.now();
      var declined = transaction.persist([
        { target: source, patch: { driverContinuationDecline: { proposalId: proposal.proposalId, declinedAt: declinedAt, permanent: true } } },
        { target: proposal, patch: { status: "declined", declinedAt: declinedAt, error: null, updatedAt: declinedAt } },
      ], function () { return sm.saveSessionFile(source); });
      if (!declined.ok) throw new Error("The decision to stay could not be persisted.");
      sm.sendToSession(source, { type: "driver_continuation_update", proposalId: proposal.proposalId,
        sourceSessionId: source.localId, sourceOriginId: proposal.sourceOriginId, projectSlug: ctx.projectSlug,
        status: "declined", declinedAt: declinedAt, error: null });
      return { ok: true, status: "declined", sourceSessionId: source.localId };
    }
    var result = await accept(ws, source, proposal);
    result.sourceSessionId = source.localId;
    return result;
  }

  function openSource(ws, msg) {
    var target = sm.sessions.get(ws._clayActiveSession);
    var relation = target && target.driverContinuation;
    var ownerId = ws && ws._clayUser ? ws._clayUser.id : null;
    if (!target || !relation || relation.proposalId !== msg.proposalId || relation.sourceOriginId !== msg.sourceOriginId) {
      throw new Error("The exact continuation source link is stale.");
    }
    if (!authorize(target, ownerId)) throw new Error("Continuation source access changed.");
    var source = null;
    sm.sessions.forEach(function (candidate) {
      if (source || !candidate) return;
      if (candidate.sessionOriginId === relation.sourceOriginId && (candidate.ownerId || null) === (target.ownerId || null)) source = candidate;
    });
    if (!source || !authorize(source, ownerId)) throw new Error("The original Driver session is no longer available.");
    sm.switchSession(source.localId, ws);
    return { ok: true, status: "source_opened", targetSessionId: source.localId };
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "driver_continuation_response" && msg.type !== "driver_continuation_open_source") return false;
    var requestId = text(msg.requestId, 128);
    var exactProject = text(msg.projectSlug, 200);
    var sourceOriginId = text(msg.sourceOriginId, 200);
    var operationName = msg.type === "driver_continuation_open_source" ? "open_source" : "decision";
    if (!requestId || exactProject !== ctx.projectSlug || !sourceOriginId) {
      ctx.sendTo(ws, { type: "driver_continuation_result", requestId: requestId, operation: operationName,
        projectSlug: ctx.projectSlug, sourceOriginId: sourceOriginId, proposalId: msg.proposalId,
        sourceSessionId: null, ok: false, error: "The continuation request correlation is incomplete or stale." });
      return true;
    }
    var operation = msg.type === "driver_continuation_open_source"
      ? Promise.resolve().then(function () { return openSource(ws, msg); })
      : respond(ws, msg);
    operation.then(function (result) {
      ctx.sendTo(ws, Object.assign({ type: "driver_continuation_result", requestId: requestId, operation: operationName,
        projectSlug: ctx.projectSlug, sourceOriginId: sourceOriginId, proposalId: msg.proposalId,
        sourceSessionId: null }, result));
    }).catch(function (error) {
      ctx.sendTo(ws, { type: "driver_continuation_result", requestId: requestId, operation: operationName,
        projectSlug: ctx.projectSlug, sourceOriginId: sourceOriginId, proposalId: msg.proposalId,
        sourceSessionId: null, ok: false, error: error.message || String(error) });
    });
    return true;
  }

  function getToolDefs(session, generation) {
    if (!authorize(session, session && session.ownerId || null) || skipPermissions(session)) return [];
    if (continuationTrigger.historicalProposal(session) || session.driverContinuationDecline) return [];
    return [{
      name: "propose_driver_continuation",
      description: "Propose, but never accept, the source session's one user-reviewed proactive continuation. Clay requires measured current-context pressure or a completed recorded compaction, a completed milestone, a specific reason and benefit, and a prepared next action. Never claim guaranteed savings.",
      inputSchema: buildShape({
        reason: { type: "string", description: "Why moving at this specific boundary is useful now." },
        milestone: { type: "string", description: "The concrete milestone completed before this safe transition boundary." },
        benefit: { type: "string", description: "The concrete continuity benefit, without unsupported savings claims." },
        goal: { type: "string" }, constraints: { type: "string" },
        decisions: { type: "string", description: "Decisions and why they were made." },
        rejectedApproaches: { type: "string" }, unresolved: { type: "string" },
        nextAction: { type: "string" }, verification: { type: "string" }, repositoryState: { type: "string" },
      }, ["reason", "milestone", "benefit", "goal", "nextAction"]),
      handler: function (args) { return propose(args || {}, session, generation); },
    }];
  }

  function getSystemPrompt(session) {
    if (!authorize(session, session && session.ownerId || null) || skipPermissions(session)) return "";
    if (continuationTrigger.historicalProposal(session) || session.driverContinuationDecline) return "";
    return continuationTrigger.prompt(session) + " Never propose while a Split Worker is attached or work or user input is pending. " +
      "After posting, end the turn. Same-project bounded history can be retrieved later; do not request global source reading.";
  }

  return { getSystemPrompt: getSystemPrompt, getToolDefs: getToolDefs, handleMessage: handleMessage, respond: respond, openSource: openSource };
}

module.exports = { attachDriverContinuation: attachDriverContinuation, contextKey: contextKey, findProposal: findProposal };
