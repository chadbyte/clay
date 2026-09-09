var pairMcp = require("./session-pair-mcp-server"), pairPrompts = require("./session-pair-prompts");
var { attachPairFactory } = require("./session-pair-factory"), { attachPairLifecycle } = require("./project-pair-lifecycle"),
  { attachPairTurnControl } = require("./session-pair-turn-control");
var driverEligibility = require("./session-driver-eligibility"), driverOrchestration = require("./session-driver-orchestration");
var { attachWorkerPermission } = require("./project-worker-permission"), { attachWorkerProposal } = require("./project-worker-proposal");
var { attachPairMessage } = require("./project-pair-message"), { attachPairTaskControl } = require("./project-pair-task-control");
var pairHistory = require("./session-pair-history"), responseText = pairHistory.responseText, errorSince = pairHistory.errorSince, recentTurns = pairHistory.recentTurns, operationFingerprint = require("./session-pair-operation").fingerprint;
function toolResult(value) { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] }); }
function toolError(err) {
  return Promise.resolve({ content: [{ type: "text", text: "Error: " + (err.message || err) }], isError: true });
}
function attachSessionPair(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;
  var workerProposal;
  var workerPermission;
  var lifecycle;
  var taskControl;
  var turnControl = attachPairTurnControl({ sm: sm, splitStore: store });
  function groupAndPartner(caller, missingPairMessage) {
    if (!caller) throw new Error("partner tools require a session-bound tool server");
    if (sm.sessions.get(caller.localId) !== caller) {
      throw new Error("this session is no longer live; the partner tools are bound to an exact session");
    }
    var group = store.groupForMember(caller.localId);
    if (!group) throw new Error(missingPairMessage || "this session is not in a split group");
    if (group.pair && group.pair.driverId !== caller.localId) {
      throw new Error("only the configured Driver can direct this pair");
    }
    var partnerId = group.members[0] === caller.localId ? group.members[1] : group.members[0];
    var partner = sm.sessions.get(partnerId);
    if (!partner) throw new Error("split partner session was not found");
    if (caller.ownerId !== partner.ownerId) throw new Error("split partner access denied");
    return { group: group, partner: partner };
  }
  function rolesFor(session) {
    if (!session || sm.sessions.get(session.localId) !== session) return null;
    var group = store.groupForMember(session.localId);
    if (!group || !group.pair) return null;
    var driver = sm.sessions.get(group.pair.driverId);
    var worker = sm.sessions.get(group.pair.workerId);
    if (!driver || !worker || driver.ownerId !== worker.ownerId) return null;
    return { group: group, driver: driver, worker: worker };
  }
  var pairMessage = attachPairMessage({
    sm: sm,
    getSdk: ctx.getSdk,
    resolvePair: groupAndPartner,
    turnControl: turnControl,
  });
  taskControl = attachPairTaskControl({
    sm: sm, resolvePair: groupAndPartner, rolesFor: rolesFor, turnControl: turnControl,
    sendFollowup: function (args, caller) { return sendToPartner(args, caller); },
  });
  function broadcastDelegation(group, caller, partner, active) {
    var message = { type: "split_delegation", groupId: group.id, from: caller.localId,
      to: partner.localId, active: !!active };
    if (typeof ctx.broadcastDelegation === "function") ctx.broadcastDelegation(group, message);
    else ctx.send(message);
  }
  function finishDelegation(group, caller, partner, token) {
    if (partner._pairDelegation !== token) return;
    delete partner._pairDelegation;
    delete partner._delegatedBy;
    broadcastDelegation(group, caller, partner, false);
  }
  function completeInterruptedTask(partner, caller, token) {
    if (!token) return null;
    return taskControl.complete(partner, caller, token, "interrupted",
      responseText(partner.history || [], token.startIndex), null);
  }
  function resumeDriverWithMessage(caller, text, meta) {
    if (!caller || caller.destroying) return false;
    if (turnControl.blockedReason(caller)) return false;
    var record = {
      type: "user_message",
      text: text,
      _internal: true,
    };
    if (meta) {
      var keys = Object.keys(meta);
      for (var i = 0; i < keys.length; i++) record[keys[i]] = meta[keys[i]];
    }
    sm.sendAndRecord(caller, record);
    caller.lastActivity = Date.now();
    var sdk = ctx.getSdk();
    if (!sdk) {
      sm.sendAndRecord(caller, { type: "error", text: "Could not resume the Driver: SDK bridge is not ready" });
      return false;
    }
    if (!caller.isProcessing) {
      caller.isProcessing = true;
      caller.sentToolResults = {};
      ctx.onProcessingChanged();
      sm.sendToSession(caller, { type: "status", status: "processing" });
    }
    if (!sdk.pushMessage(caller, text)) {
      caller._queryStartTs = Date.now();
      Promise.resolve(sdk.startQuery(caller, text, undefined, ctx.getLinuxUserForSession(caller))).catch(function (err) {
        caller.isProcessing = false;
        sm.sendAndRecord(caller, { type: "error", text: err.message || String(err) });
        ctx.onProcessingChanged();
      });
    }
    sm.broadcastSessionList();
    return true;
  }
  function resumeDriverWithResult(caller, partner, token) {
    if (!token.detached || token.delivered || caller.destroying) return false;
    token.delivered = true;
    var failure = token.failure || null;
    var response = token.response || "";
    var text;
    if (token.interrupted) {
      text = "[Split Worker execution interrupted] The user interrupted the Split Worker mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Review what was done and decide next steps with the user.";
    } else {
      text = "A Split Worker task delegated through send_to_partner has finished.\n\n" +
        "Original task:\n" + token.message + "\n\n" +
        (failure ? "Split Worker error:\n" + failure : "Split Worker result:\n" + (response || "(No text response was recorded.)")) +
        "\n\nReview the result, verify it as needed, and continue the task.";
    }
    return resumeDriverWithMessage(caller, text, {
      partnerResult: true,
      partnerSessionId: partner.localId,
    });
  }
  function requestDetach(worker) {
    var token = worker && worker._pairDelegation;
    if (!token || token.detached || token.detachRequested) return false;
    token.detachRequested = true;
    return true;
  }
  function handleTurnDone(partner) {
    var token = partner && partner._pairDelegation;
    if (!token) return false;
    var group = store.groupForMember(partner.localId);
    if (!group || group.id !== token.groupId || group.members.indexOf(token.from) === -1) return false;
    var caller = sm.sessions.get(token.from);
    if (!caller || caller.ownerId !== partner.ownerId) return false;
    if (group.pair && (group.pair.driverId !== caller.localId || group.pair.workerId !== partner.localId)) {
      finishDelegation(group, caller, partner, token);
      return false;
    }
    token.response = responseText(partner.history || [], token.startIndex);
    token.failure = errorSince(partner.history || [], token.startIndex);
    token.interrupted = !token.failure && !!partner._lastTurnInterrupted;
    if (token.interrupted) taskControl.ensureSystemInterruption(partner, token);
    taskControl.complete(partner, caller, token, token.failure ? "failed" : (token.interrupted ? "interrupted" : "completed"), token.response, token.failure);
    finishDelegation(group, caller, partner, token);
    var resumed = resumeDriverWithResult(caller, partner, token);
    taskControl.drain(caller, partner);
    return resumed;
  }
  function waitForPartner(group, caller, partner, token, timeoutSeconds) {
    return new Promise(function (resolve, reject) {
      var deadline = Date.now() + timeoutSeconds * 1000;
      var timer = setInterval(function () {
        var currentGroup = store.groupForMember(caller.localId);
        if (!currentGroup || currentGroup.id !== group.id || currentGroup.members.indexOf(partner.localId) === -1) {
          clearInterval(timer);
          finishDelegation(group, caller, partner, token);
          reject(new Error("the split group was dissolved while waiting for the partner"));
          return;
        }
        if (!partner.isProcessing && !partner._queryStarting) {
          clearInterval(timer);
          finishDelegation(group, caller, partner, token);
          var failure = errorSince(partner.history || [], token.startIndex);
          var interrupted = !failure && !!partner._lastTurnInterrupted;
          var response = responseText(partner.history || [], token.startIndex);
          if (interrupted) taskControl.ensureSystemInterruption(partner, token);
          var outcome = taskControl.complete(partner, caller, token, failure ? "failed" : (interrupted ? "interrupted" : "completed"), response, failure);
          resolve({
            status: failure ? "error" : (outcome.status === "completed" ? "complete" : outcome.status),
            taskId: token.taskId,
            generation: token.generation,
            response: response,
            error: failure || undefined,
            outcome: outcome,
          });
          taskControl.drain(caller, partner);
          return;
        }
        if (Date.now() >= deadline || token.detachRequested) {
          clearInterval(timer);
          token.detached = true;
          monitorPartner(group, caller, partner, token);
          resolve({ status: "running", taskId: token.taskId, generation: token.generation, response: responseText(partner.history || [], token.startIndex), hint: "The completed result will be pushed back automatically. Use read_partner only for an interim status check." });
        }
      }, 500);
    });
  }
  function monitorPartner(group, caller, partner, token) {
    var timer = setInterval(function () {
      var currentGroup = store.groupForMember(caller.localId);
      if (!currentGroup || currentGroup.id !== group.id || (!partner.isProcessing && !partner._queryStarting)) {
        clearInterval(timer);
        if (currentGroup && currentGroup.id === group.id) handleTurnDone(partner);
        else finishDelegation(group, caller, partner, token);
      }
    }, 500);
  }
  async function sendToPartner(args, caller) {
    try {
      if (caller && caller._delegatedBy) throw new Error("delegated turns cannot delegate to another session");
      var resolved = groupAndPartner(caller,
        "send_to_partner requires an exact existing Driver/Split Worker pair; call propose_worker while unpaired");
      var message = typeof args.message === "string" ? args.message.trim() : "";
      if (!message) throw new Error("message is required");
      turnControl.assertWorkerAction(caller);
      var wait = args.wait !== false;
      var timeout = Number.isFinite(args.timeoutSeconds) ? Math.floor(args.timeoutSeconds) : 300;
      timeout = Math.max(1, Math.min(900, timeout));
      var partner = resolved.partner;
      if (partner._pairDelegation) throw new Error("the partner is already handling a delegated task");
      delete partner._pairInterruption; delete partner._lastInterruptedPairTask;
      var task = taskControl.begin(partner, caller, message, args.taskId);
      var token = Object.assign(task, { from: caller.localId, groupId: resolved.group.id, startIndex: partner.history.length });
      partner._pairDelegation = token;
      partner._delegatedBy = caller.localId;
      sm.sendAndRecord(partner, {
        type: "user_message",
        text: message,
        delegated: true,
        delegatedBy: caller.localId,
        delegatedByTitle: caller.title || "Driver",
        delegatedByVendor: caller.vendor || "claude",
        delegatedTaskId: token.taskId,
        delegatedGeneration: token.generation,
      });
      partner.lastActivity = Date.now();
      partner.sentToolResults = {};
      broadcastDelegation(resolved.group, caller, partner, true);
      var sdk = ctx.getSdk();
      if (!sdk) throw new Error("SDK bridge is not ready");
      if (!partner.isProcessing) {
        partner.isProcessing = true;
        ctx.onProcessingChanged();
        sm.sendToSession(partner, { type: "status", status: "processing" });
      }
      var runtimeMessage = "[Split Worker taskId=" + token.taskId + " generation=" + (token.generation === null ? "unknown" : token.generation) + "]\n" + message + "\n\nBefore finishing, call report_partner_outcome with this exact taskId and only Worker-observed evidence.";
      if (!sdk.pushMessage(partner, runtimeMessage)) {
        partner._queryStartTs = Date.now();
        Promise.resolve(sdk.startQuery(partner, runtimeMessage, undefined, ctx.getLinuxUserForSession(partner))).catch(function (err) {
          partner.isProcessing = false;
          sm.sendAndRecord(partner, { type: "error", text: err.message || String(err) });
        });
      }
      sm.broadcastSessionList();
      if (!wait) {
        token.detached = true;
        monitorPartner(resolved.group, caller, partner, token);
        return toolResult({ status: "running", partnerId: partner.localId, taskId: token.taskId, generation: token.generation, hint: "The completed result will be pushed back automatically. Use read_partner only for an interim status check." });
      }
      if (!partner.isProcessing && !partner._queryStarting) {
        finishDelegation(resolved.group, caller, partner, token);
        var immediateFailure = errorSince(partner.history || [], token.startIndex);
        var immediateResponse = responseText(partner.history || [], token.startIndex);
        var immediateOutcome = taskControl.complete(partner, caller, token, immediateFailure ? "failed" : "completed", immediateResponse, immediateFailure);
        taskControl.drain(caller, partner);
        return toolResult({
          status: immediateFailure ? "error" : (immediateOutcome.status === "completed" ? "complete" : immediateOutcome.status),
          taskId: token.taskId,
          generation: token.generation,
          response: immediateResponse,
          error: immediateFailure || undefined,
          outcome: immediateOutcome,
        });
      }
      var completed = await waitForPartner(resolved.group, caller, partner, token, timeout);
      return toolResult(completed);
    } catch (e) {
      if (caller) {
        var group = store.groupForMember(caller.localId);
        if (group) {
          var partnerId = group.members[0] === caller.localId ? group.members[1] : group.members[0];
          var partner = sm.sessions.get(partnerId);
          if (partner && partner._pairDelegation && partner._pairDelegation.from === caller.localId && !partner.isProcessing) {
            finishDelegation(group, caller, partner, partner._pairDelegation);
          }
        }
      }
      return toolError(e);
    }
  }
  function readPartner(args, caller) {
    try {
      var resolved = groupAndPartner(caller);
      var count = Number.isFinite(args.lastTurns) ? Math.floor(args.lastTurns) : 1;
      count = Math.max(0, Math.min(5, count));
      var payload = {
        status: resolved.partner.isProcessing ? "running" : (resolved.partner._lastTurnInterrupted ? "interrupted" : "idle"),
        partnerId: resolved.partner.localId,
        title: resolved.partner.title || "New Session",
        turns: count > 0 ? recentTurns(resolved.partner, count) : [],
      };
      payload.capacity = lifecycle.optionalStatus(caller);
      return toolResult(payload);
    } catch (e) {
      return toolError(e);
    }
  }
  function interruptPartner(args, caller) {
    try {
      var resolved = groupAndPartner(caller);
      var partner = resolved.partner;
      if (!partner.isProcessing && !partner._queryStarting) {
        return toolResult({ status: "idle", partnerId: partner.localId, title: partner.title || "New Session" });
      }
      taskControl.markInterruption(partner, "driver", args.reason || "The Driver interrupted the active task.");
      partner.taskStopRequested = true;
      if (partner.abortController) partner.abortController.abort();
      return toolResult({ status: "interrupting", partnerId: partner.localId, title: partner.title || "New Session" });
    } catch (e) {
      return toolError(e);
    }
  }
  function closePartner(args, caller) {
    try {
      var resolved = groupAndPartner(caller);
      var partner = resolved.partner;
      var interrupted = !!(partner.isProcessing || partner._queryStarting);
      if (interrupted) {
        taskControl.markInterruption(partner, "driver", "The Driver closed the Split Worker pair.");
        partner.taskStopRequested = true;
        if (partner.abortController) partner.abortController.abort();
      }
      if (partner._pairDelegation) {
        completeInterruptedTask(partner, caller, partner._pairDelegation);
        finishDelegation(resolved.group, caller, partner, partner._pairDelegation);
      }
      workerPermission.cancelForSession(partner, "The Driver closed the Split Worker pair.");
      var ws = { _clayUser: caller.ownerId ? { id: caller.ownerId } : null };
      var result = store.dissolve(ws, { id: resolved.group.id });
      if (!result.ok) throw new Error(result.error || "could not close the Worker pair");
      return toolResult({ status: "closed", partnerId: partner.localId, interrupted: interrupted, historyPreserved: true });
    } catch (e) {
      return toolError(e);
    }
  }
  function handleHumanStop(session) {
    var roles = turnControl.markHumanStop(session);
    if (!roles) return false;
    taskControl.markInterruption(roles.worker, "user", "The human stopped this Split Worker turn.");
    workerPermission.cancelForSession(roles.worker, "The human stopped this Split Worker turn.");
    return true;
  }
  function beginHumanTurn(session) {
    var resumed = turnControl.beginHumanTurn(session);
    var roles = resumed && rolesFor(session);
    if (roles) taskControl.drain(roles.driver, roles.worker);
    return resumed;
  }
  function getToolDefs(boundSession) {
    if (!boundSession) return pairMcp.getToolDefs({
      send: function () { return toolError(new Error("send_to_partner requires a session-bound tool server")); },
      read: function () { return toolError(new Error("read_partner requires a session-bound tool server")); },
      message: function () { return toolError(new Error("message_partner requires a session-bound tool server")); },
      interrupt: function () { return toolError(new Error("interrupt_partner requires a session-bound tool server")); },
      close: function () { return toolError(new Error("close_partner requires a session-bound tool server")); },
      status: function () { return toolError(new Error("partner_status requires a session-bound tool server")); },
      replace: function () { return toolError(new Error("replace_partner requires a session-bound tool server")); },
      evaluate: function () { return toolError(new Error("record_partner_evaluation requires a session-bound tool server")); },
    });
    var group = store.groupForMember(boundSession.localId);
    if (group && group.pair && group.pair.driverId !== boundSession.localId) return taskControl.workerToolDefs(boundSession);
    var adHocSplit = !!(group && !group.pair);
    if (!driverEligibility.isEligibleDriverSession(boundSession, sm)) return [];
    var persistentCatalog = boundSession.vendor === "codex" && (!group || !!group.pair);
    if (!group && !persistentCatalog) {
      return workerProposal.getToolDefs(boundSession)
        .concat(workerPermission.getToolDefs(boundSession, { dormantDriver: true }));
    }
    var lifecycleHandlers = lifecycle.toolHandlers(boundSession);
    var tools = pairMcp.getToolDefs({
      send: function (args) {
        return turnControl.runOperation(boundSession, "send", args && args.operationId, function () {
          return sendToPartner(args || {}, boundSession);
        }, operationFingerprint(args, ["message", "wait", "timeoutSeconds", "taskId"])).catch(toolError);
      },
      read: function (args) { return readPartner(args, boundSession); },
      message: function (args) {
        return turnControl.runOperation(boundSession, "message", args && args.requestId, function () {
          return pairMessage.send(args || {}, boundSession);
        }, pairMessage.fingerprint(args || {})).catch(function (err) {
          return toolResult({ status: "rejected", requestId: args && args.requestId || null, reason: err.message || String(err) });
        });
      },
      interrupt: function (args) { return interruptPartner(args, boundSession); },
      close: function (args) { return closePartner(args, boundSession); },
      status: lifecycleHandlers.status,
      replace: function (args) {
        return turnControl.runOperation(boundSession, "replace", args && args.operationId, function () {
          return workerProposal.proposeReplacement(args || {}, boundSession);
        }, operationFingerprint(args, ["interrupt", "message", "workerVendor", "workerModel", "workerEffort", "recommendationRationale", "evaluation", "supersedeProposalId"])).catch(toolError);
      },
      evaluate: lifecycleHandlers.evaluate,
    }, { lifecycle: persistentCatalog || !adHocSplit });
    if (!adHocSplit) tools = tools.concat(taskControl.driverToolDefs({
      queue: function (args) { return taskControl.queue(args || {}, boundSession); },
      inspect: function (args) { return taskControl.inspect(args || {}, boundSession); },
      cancel: function (args) { return taskControl.cancel(args || {}, boundSession); },
      replace: function (args) { return taskControl.replaceTask(args || {}, boundSession); },
      resume: function (args) { return taskControl.resumeTask(args || {}, boundSession); },
    }));
    if (persistentCatalog) {
      return workerProposal.getToolDefs(boundSession, { persistent: true })
        .concat(tools)
        .concat(workerPermission.getToolDefs(boundSession, { dormantDriver: true }));
    }
    return tools.concat(adHocSplit ? [] : workerProposal.getToolDefs(boundSession, { persistent: true, controlsOnly: true }))
      .concat(workerPermission.getToolDefs(boundSession, { dormantDriver: false }));
  }
  var factory = attachPairFactory(ctx), createPairRecord = factory.createPairRecord,
    createWorkerForDriver = factory.createWorkerForDriver, createPair = factory.createPair,
    preflightWorkerForDriver = factory.preflightWorkerForDriver;
  lifecycle = attachPairLifecycle({
    sm: sm,
    splitStore: store,
    createWorkerForDriver: function (driver, args) { return createWorkerForDriver(driver, args); },
    preflightWorkerForDriver: function (driver, args) { return preflightWorkerForDriver(driver, args); },
    sendToPartner: function (args, caller) { return sendToPartner(args, caller); },
    finishDelegation: finishDelegation,
    completeInterruptedTask: completeInterruptedTask,
    cancelWorkerPermissions: function (worker, reason) { return workerPermission.cancelForSession(worker, reason); },
    markInterruption: function (worker, by, reason) { return taskControl.markInterruption(worker, by, reason); },
    taskStatus: function (worker) { return taskControl.status(worker); },
    proposalStatus: function (driver) { return workerProposal ? workerProposal.proposalStatus(driver) : null; },
    turnControl: turnControl,
  });
  workerPermission = attachWorkerPermission({
    sm: sm,
    splitStore: store,
    onProcessingChanged: ctx.onProcessingChanged,
    resumeDriverWithMessage: resumeDriverWithMessage,
    requestDetach: requestDetach,
  });
  workerProposal = attachWorkerProposal({
    sm: sm,
    isMate: ctx.isMate,
    splitStore: store,
    getSdk: ctx.getSdk,
    sendTo: ctx.sendTo,
    usersModule: ctx.usersModule,
    getLinuxUserForSession: ctx.getLinuxUserForSession,
    onProcessingChanged: ctx.onProcessingChanged,
    adapters: ctx.adapters,
    dangerouslySkipPermissions: ctx.dangerouslySkipPermissions,
    createPairRecord: createPairRecord,
    recordGenerationStart: function (driver, worker) { return lifecycle.recordGenerationStart(driver, worker); },
    sendToPartner: sendToPartner,
    replacePartner: function (args, session) { return lifecycle.replacePartner(args, session); },
    preflightWorkerForDriver: preflightWorkerForDriver,
  });
  function handleMessage(ws, msg) {
    if (workerProposal.handleMessage(ws, msg)) return true;
    if (msg.type === "pair_session_options") {
      if (ctx.isMate) return false;
      ctx.sendTo(ws, {
        type: "pair_session_options",
        installedVendors: sm.installedVendors || [],
        modelsByVendor: sm.modelsByVendor || {},
        capabilitiesByVendor: sm.capabilitiesByVendor || {},
        lastVendor: sm.lastVendor || null,
      });
      return true;
    }
    if (msg.type === "pair_session_create") {
      createPair(ws, msg);
      return true;
    }
    return false;
  }
  function getSystemPrompt(session) {
    var roles = rolesFor(session);
    if (roles && roles.worker === session) {
      var taskId = session._pairDelegation && session._pairDelegation.taskId || "unknown";
      return pairPrompts.worker(taskId);
    }
    var group = store.groupForMember(session.localId);
    var pairPrompt = "";
    if (group && group.pair && group.pair.driverId === session.localId) {
      pairPrompt = pairPrompts.DRIVER_CORE;
      if (driverOrchestration.isHighTierDriverSession(session, sm)) {
        pairPrompt += " " + pairPrompts.DRIVER_DELEGATION;
      }
    } else if (!group && !ctx.isMate && driverEligibility.isEligibleDriverSession(session, sm) &&
      driverOrchestration.isHighTierDriverSession(session, sm)) {
      pairPrompt = pairPrompts.UNPAIRED + " " + workerProposal.getSystemPrompt(session);
    }
    return pairPrompt;
  }
  return { beginHumanTurn: beginHumanTurn, getToolDefs: getToolDefs, handleHumanStop: handleHumanStop,
    handleMessage: handleMessage, handleTurnDone: handleTurnDone, getSystemPrompt: getSystemPrompt,
    respondToWorkerProposal: workerProposal.respondToProposal, workerPermission: workerPermission };
}
module.exports = { attachSessionPair: attachSessionPair, responseText: responseText, recentTurns: recentTurns };
