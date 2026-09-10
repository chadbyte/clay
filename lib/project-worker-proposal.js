var crypto = require("crypto");
var yoke = require("./yoke");
var buildShape = require("./session-spawn-mcp-server").buildShape;
var driverEligibility = require("./session-driver-eligibility");
var driverOrchestration = require("./session-driver-orchestration");
var proposalControl = require("./worker-proposal-control");
var runtimeCatalog = require("./worker-runtime-catalog");
var MAX_SUMMARY_CHARS = 600, MAX_PLAN_CHARS = 6000, MAX_TASK_CHARS = 30000, MAX_RATIONALE_CHARS = 1000;
var EVALUATION_OUTCOMES = ["succeeded", "partial", "failed", "abandoned"];
function normalizeEvaluation(raw) {
  if (raw == null) return null;
  var input = typeof raw === "string" ? { outcome: raw } : raw;
  if (!input || typeof input !== "object") return { error: "evaluation must be an outcome string or object" };
  var outcome = typeof input.outcome === "string" ? input.outcome.trim().toLowerCase() : "";
  if (EVALUATION_OUTCOMES.indexOf(outcome) === -1) {
    return { error: "evaluation outcome must be one of: " + EVALUATION_OUTCOMES.join(", ") };
  }
  var note = typeof input.note === "string" ? input.note.replace(/\s+/g, " ").trim().slice(0, 400) : "";
  return { value: { outcome: outcome, note: note } };
}
function modelValue(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.value || entry.id) || "";
}
function modelLabel(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.displayName || entry.name || entry.value || entry.id) || "";
}
function toolResult(value) { return Promise.resolve({ content: [{ type: "text", text: JSON.stringify(value) }] }); }
function attachWorkerProposal(ctx) {
  var sm = ctx.sm;
  var store = ctx.splitStore;
  var catalogErrors = {};
  function isLiveSession(session) {
    return !!session && sm.sessions.get(session.localId) === session;
  }
  function canOffer(session) { return !ctx.isMate && isLiveSession(session) && driverEligibility.isEligibleDriverSession(session, sm); }
  function isEligible(session) {
    return canOffer(session) && !store.groupForMember(session.localId);
  }
  function safeModelsByVendor(installed) {
    var result = {};
    for (var i = 0; i < installed.length; i++) {
      var vendor = installed[i];
      var source = (sm.modelsByVendor && sm.modelsByVendor[vendor]) || [];
      result[vendor] = source.map(function (entry) {
        if (typeof entry === "string") return entry;
        return {
          value: modelValue(entry),
          displayName: modelLabel(entry),
          supportedEffortLevels: entry.supportedEffortLevels || null,
        };
      });
    }
    return result;
  }
  function proposalOptions() {
    var installed = (sm.installedVendors || []).slice();
    var capabilities = {};
    for (var i = 0; i < installed.length; i++) {
      var source = (sm.capabilitiesByVendor && sm.capabilitiesByVendor[installed[i]]) || {};
      var vendorInfo = yoke.getVendorInfo(installed[i]) || {};
      var supportsEffort = Array.isArray(vendorInfo.effortLevels) && vendorInfo.effortLevels.length > 0;
      capabilities[installed[i]] = { effort: source.effort === undefined ? supportsEffort : source.effort !== false };
    }
    return {
      installedVendors: installed,
      modelsByVendor: safeModelsByVendor(installed),
      capabilitiesByVendor: capabilities,
      unavailableReasons: Object.assign({}, catalogErrors),
      availableVendors: Array.isArray(sm.availableVendors) ? sm.availableVendors.slice() : null,
    };
  }
  async function ensureModelCatalogs() {
    var installed = sm.installedVendors || [];
    sm.modelsByVendor = sm.modelsByVendor || {};
    for (var i = 0; i < installed.length; i++) {
      var vendor = installed[i];
      if (sm.modelsByVendor[vendor] && sm.modelsByVendor[vendor].length > 0) continue;
      var adapter = ctx.adapters && ctx.adapters[vendor];
      if (!adapter || typeof adapter.supportedModels !== "function") continue;
      try { sm.modelsByVendor[vendor] = await adapter.supportedModels(); delete catalogErrors[vendor]; }
      catch (err) { catalogErrors[vendor] = err.message || String(err); console.warn("[worker-proposal] Could not load " + vendor + " models:", catalogErrors[vendor]); }
    }
  }
  function modelIsAvailable(options, vendor, model) {
    if (!model) return true;
    var models = options.modelsByVendor[vendor] || [];
    for (var i = 0; i < models.length; i++) {
      if (modelValue(models[i]) === model) return true;
    }
    return false;
  }
  function effortIsAvailable(options, vendor, model, effort) {
    var capabilities = options.capabilitiesByVendor[vendor] || {};
    if (capabilities.effort === false) return !effort;
    var clamped = yoke.clampEffort(vendor, effort) || "";
    if (!effort || clamped !== effort) return false;
    var models = options.modelsByVendor[vendor] || [];
    for (var i = 0; i < models.length; i++) {
      if (modelValue(models[i]) !== model) continue;
      var levels = models[i] && models[i].supportedEffortLevels;
      return !Array.isArray(levels) || levels.length === 0 || levels.indexOf(effort) !== -1;
    }
    return true;
  }
  function chooseRecommendation(args, session, options) {
    var installed = options.installedVendors;
    var vendor = args.recommendedVendor;
    if (installed.indexOf(vendor) === -1) {
      if (installed.indexOf("codex") !== -1) vendor = "codex";
      else {
        vendor = installed[0] || session.vendor || "claude";
        for (var i = 0; i < installed.length; i++) {
          if (installed[i] !== session.vendor) { vendor = installed[i]; break; }
        }
      }
    }
    var models = options.modelsByVendor[vendor] || [];
    var model = modelIsAvailable(options, vendor, args.recommendedModel) ? (args.recommendedModel || "") : "";
    var currentModel = session.model || (sm.defaultModelByVendor || {})[session.vendor || "claude"] || "";
    if (vendor === session.vendor && model === currentModel) model = "";
    if (!model && models.length > 0) {
      for (var j = 0; j < models.length; j++) {
        if (vendor === session.vendor && modelValue(models[j]) === currentModel) continue;
        model = modelValue(models[j]);
        break;
      }
    }
    if (!model && models.length > 0 && vendor !== session.vendor) model = modelValue(models[0]);
    var effort = yoke.clampEffort(vendor, args.recommendedEffort || "medium") || "";
    return { vendor: vendor, model: model, effort: effort };
  }
  function skipPermissionsEnabled(session) {
    return !!(session && (session.permissionMode === "bypassPermissions" ||
      session.dangerouslySkipPermissions || ctx.dangerouslySkipPermissions));
  }
  function recommendationCanAutoAccept(args, recommendation, options) {
    var requestedVendor = typeof args.recommendedVendor === "string" ? args.recommendedVendor.trim() : "";
    var requestedModel = typeof args.recommendedModel === "string" ? args.recommendedModel.trim() : "";
    var requestedEffort = typeof args.recommendedEffort === "string" ? args.recommendedEffort.trim() : "";
    if (!requestedVendor || requestedVendor !== recommendation.vendor) return false;
    if (!requestedModel || requestedModel !== recommendation.model ||
        !modelIsAvailable(options, requestedVendor, requestedModel)) return false;
    var capabilities = options.capabilitiesByVendor[requestedVendor] || {};
    if (capabilities.effort === false) return !requestedEffort && !recommendation.effort;
    return requestedEffort === recommendation.effort &&
      effortIsAvailable(options, requestedVendor, requestedModel, requestedEffort);
  }
  function autoAcceptanceWs(session) {
    return {
      _clayActiveSession: session.localId,
      _clayUser: session.ownerId ? { id: session.ownerId } : null,
    };
  }
  function updateProposal(session, proposal, patch) {
    Object.assign(proposal, patch, { updatedAt: Date.now() });
    sm.saveSessionFile(session);
    sm.sendToSession(session, Object.assign({
      type: "worker_proposal_update",
      proposalId: proposal.proposalId,
    }, patch));
  }
  async function propose(args, session) {
    if (!isEligible(session)) return toolResult({ error: "Split Worker proposals are only available in an eligible unpaired Driver session." });
    var superseded = proposalControl.pendingProposal(session);
    var supersedeId = typeof args.supersedeProposalId === "string" ? args.supersedeProposalId.trim() : "";
    if (superseded && superseded.proposalId !== supersedeId) return toolResult({ error: "A Split Worker suggestion is already awaiting a decision. Inspect it or supply its exact id to supersede it." });
    if (!superseded && supersedeId) return toolResult({ error: "The Split Worker suggestion to supersede is no longer pending." });
    if (superseded && superseded.status !== "pending") return toolResult({ error: "The Split Worker suggestion is already starting and cannot be superseded." });
    var summary = typeof args.summary === "string" ? args.summary.trim() : "";
    var plan = typeof args.plan === "string" ? args.plan.trim() : "";
    var task = typeof args.message === "string" ? args.message.trim() : "";
    var rationale = typeof args.recommendationRationale === "string" ? args.recommendationRationale.trim() : "";
    if (!summary || !plan || !task || !rationale) {
      return toolResult({ error: "summary, plan, message, and recommendationRationale are required." });
    }
    if (task.length > MAX_TASK_CHARS) return toolResult({ error: "The Split Worker task is too long." });
    await ensureModelCatalogs();
    if (!isEligible(session)) {
      return toolResult({ error: "The Driver session changed while Split Worker runtimes were loading." });
    }
    var currentPending = proposalControl.pendingProposal(session);
    if (currentPending !== superseded) return toolResult({ error: "The pending Split Worker suggestion changed while runtimes were loading." });
    var options = proposalOptions();
    if (options.installedVendors.length === 0) return toolResult({ error: "No coding agent is installed for a Split Worker session." });
    var recommendation = chooseRecommendation(args, session, options);
    var proposal = {
      type: "worker_proposal",
      proposalId: "worker_" + crypto.randomUUID(),
      summary: summary.slice(0, MAX_SUMMARY_CHARS),
      plan: plan.slice(0, MAX_PLAN_CHARS),
      message: task,
      status: "pending",
      createdAt: Date.now(),
      recommendedVendor: recommendation.vendor,
      recommendedModel: recommendation.model,
      recommendedEffort: recommendation.effort,
      recommendationRationale: rationale.slice(0, MAX_RATIONALE_CHARS),
      options: options,
    };
    if (superseded) updateProposal(session, superseded, { status: "superseded", supersededBy: proposal.proposalId });
    sm.sendAndRecord(session, proposal);
    if (skipPermissionsEnabled(session) && recommendationCanAutoAccept(args, recommendation, options)) {
      var accepted = await acceptProposal(session, proposal, {
        vendor: recommendation.vendor,
        model: recommendation.model,
        effort: recommendation.effort,
      }, autoAcceptanceWs(session), true);
      return toolResult({
        status: accepted.ok ? "auto_accepted" : "posted",
        proposalId: proposal.proposalId,
        instruction: accepted.ok
          ? "The recorded Split Worker configuration was auto-accepted under the Driver session's full-access mode. End this turn now while the exact paired Worker runs."
          : "The automatic decision failed closed. The configuration card remains pending for the user; end this turn and wait for their decision.",
      });
    }
    return toolResult({
      status: "posted",
      proposalId: proposal.proposalId,
      instruction: "The Split Worker suggestion is visible in the chat. End this turn now and wait for the user's decision.",
    });
  }
  async function proposeReplacement(args, session) {
    var group = session && store.groupForMember(session.localId);
    if (ctx.isMate || !isLiveSession(session) || !driverEligibility.isEligibleDriverSession(session, sm) || !group ||
        !group.pair || group.pair.driverId !== session.localId) {
      return toolResult({ error: "Split Worker replacement proposals require the exact paired Driver session." });
    }
    var sourceGroupId = group.id;
    var sourceWorkerId = group.pair.workerId;
    var superseded = proposalControl.pendingProposal(session);
    var supersedeId = typeof args.supersedeProposalId === "string" ? args.supersedeProposalId.trim() : "";
    if (superseded && superseded.proposalId !== supersedeId) return toolResult({ error: "A Split Worker proposal is already awaiting a decision. Inspect it or supply its exact id to supersede it." });
    if (!superseded && supersedeId) return toolResult({ error: "The Split Worker proposal to supersede is no longer pending." });
    if (superseded && superseded.status !== "pending") return toolResult({ error: "The Split Worker proposal is already starting and cannot be superseded." });
    var task = typeof args.message === "string" ? args.message.trim() : "";
    var rationale = typeof args.recommendationRationale === "string" ? args.recommendationRationale.trim() : "";
    if (!task) return toolResult({ error: "message is required so an accepted replacement delegates exactly once." });
    if (!rationale) return toolResult({ error: "recommendationRationale is required for the replacement audit trail." });
    if (task.length > MAX_TASK_CHARS) return toolResult({ error: "The Split Worker task is too long." });
    var normalizedEvaluation = normalizeEvaluation(args.evaluation);
    if (normalizedEvaluation && normalizedEvaluation.error) return toolResult({ error: normalizedEvaluation.error });
    await ensureModelCatalogs();
    var liveGroup = store.groupForMember(session.localId);
    if (!isLiveSession(session) || !driverEligibility.isEligibleDriverSession(session, sm) ||
        !liveGroup || liveGroup.id !== sourceGroupId || !liveGroup.pair ||
        liveGroup.pair.driverId !== session.localId || liveGroup.pair.workerId !== sourceWorkerId) {
      return toolResult({ error: "The Driver/Split Worker pair changed while replacement runtimes were loading." });
    }
    var currentPending = proposalControl.pendingProposal(session);
    if (currentPending !== superseded) return toolResult({ error: "The pending Split Worker proposal changed while runtimes were loading." });
    var options = proposalOptions();
    if (options.installedVendors.length === 0) return toolResult({ error: "No coding agent is installed for a Split Worker session." });
    var recommendationArgs = {
      recommendedVendor: args.workerVendor,
      recommendedModel: args.workerModel,
      recommendedEffort: args.workerEffort,
    };
    var recommendation = chooseRecommendation(recommendationArgs, session, options);
    var proposal = {
      type: "worker_proposal",
      proposalId: "worker_" + crypto.randomUUID(),
      action: "replace",
      summary: "Replace the current Split Worker before the next delegated task.",
      plan: "1. Preserve the current Worker's session and history\n2. Create the selected replacement runtime\n3. Delegate the next task exactly once",
      message: task,
      status: "pending",
      createdAt: Date.now(),
      recommendedVendor: recommendation.vendor,
      recommendedModel: recommendation.model,
      recommendedEffort: recommendation.effort,
      recommendationRationale: rationale.slice(0, MAX_RATIONALE_CHARS),
      options: options,
      sourceGroupId: sourceGroupId,
      sourceWorkerId: sourceWorkerId,
      interrupt: args.interrupt === true,
      evaluation: normalizedEvaluation ? normalizedEvaluation.value : null,
      transactionId: "replace_" + crypto.randomUUID(),
    };
    if (superseded) updateProposal(session, superseded, { status: "superseded", supersededBy: proposal.proposalId });
    sm.sendAndRecord(session, proposal);
    if (skipPermissionsEnabled(session) && recommendationCanAutoAccept(recommendationArgs, recommendation, options)) {
      var accepted = await acceptProposal(session, proposal, {
        vendor: recommendation.vendor,
        model: recommendation.model,
        effort: recommendation.effort,
      }, autoAcceptanceWs(session), true);
      return toolResult({
        status: accepted.ok ? "auto_accepted" : "posted",
        proposalId: proposal.proposalId,
        instruction: accepted.ok
          ? "The recorded replacement configuration was auto-accepted under the Driver session's full-access mode."
          : "The automatic replacement failed closed. The card remains pending for the user.",
      });
    }
    return toolResult({
      status: "posted",
      proposalId: proposal.proposalId,
      instruction: "The replacement configuration is visible in the chat. End this turn now and wait for the user's decision.",
    });
  }
  function resumeDriver(session, text) {
    var sdk = ctx.getSdk();
    if (!sdk) return Promise.reject(new Error("SDK bridge is not ready"));
    var message = { type: "user_message", text: text, _internal: true };
    sm.sendAndRecord(session, message);
    session.sentToolResults = {};
    if (!session.isProcessing) {
      session.isProcessing = true;
      ctx.onProcessingChanged();
      sm.sendToSession(session, { type: "status", status: "processing" });
    }
    if (sdk.pushMessage(session, text)) return Promise.resolve();
    return Promise.resolve(sdk.startQuery(session, text, undefined, ctx.getLinuxUserForSession(session)));
  }

  function parsePartnerResult(result) {
    if (!result || result.isError || !result.content || !result.content[0]) {
      return { status: "error", error: "Split Worker execution failed." };
    }
    try { return JSON.parse(result.content[0].text); }
    catch (e) { return { status: "error", error: result.content[0].text || "Split Worker execution failed." }; }
  }

  async function runWorker(session, proposal) {
    var result = parsePartnerResult(await ctx.sendToPartner({ message: proposal.message, wait: true, timeoutSeconds: 900 }, session));
    var status = result.status === "complete" ? "completed" : result.status;
    updateProposal(session, proposal, {
      status: status || "error",
      resultPreview: result.response ? result.response.slice(0, 1200) : "",
      error: result.error || null,
    });
    var followup;
    if (result.status === "complete") {
      followup = "[Split Worker execution completed]\nReview and verify the Split Worker's result. The Split Worker session remains available: if the implementation needs corrections or additional edits, send a follow-up with send_to_partner instead of taking over the Split Worker-owned files yourself. If that Split Worker is no longer available, keep the work in the visible Split Worker flow and use send_to_partner again after the stale pair is removed; never substitute a background Sub-agent.\n\n" + (result.response || "The Split Worker completed without a text summary.");
    } else if (result.status === "interrupted") {
      followup = "[Split Worker execution interrupted]\nThe Split Worker stopped mid-turn. Its work is PARTIAL and unverified — do not treat it as finished. Check partner_status before deciding next steps; this result alone does not identify who interrupted it. If the human stopped it, do not retry until a new human Driver message. Otherwise continue within the user's authorized task.";
    } else if (result.status === "running") {
      followup = "[Split Worker execution is still running]\nUse read_partner to inspect progress before completing the task.";
    } else {
      followup = "[Split Worker execution failed]\nInspect the failure and delegate a narrower follow-up to the Split Worker when implementation work remains.\n\n" + (result.error || result.response || "Unknown Split Worker error.");
    }
    await resumeDriver(session, followup);
  }

  function sessionForResponse(ws) {
    var session = sm.sessions.get(ws._clayActiveSession);
    if (!session) throw new Error("active Driver session not found");
    if (ctx.usersModule.isMultiUser()) {
      var userId = ws._clayUser && ws._clayUser.id;
      if (!userId || session.ownerId !== userId) throw new Error("Driver session access denied");
    }
    return session;
  }

  async function acceptProposal(session, proposal, msg, ws, trustedAutoAcceptance) {
    if (!isLiveSession(session)) throw new Error("The Driver session is no longer live");
    if (proposal.action !== "replace" && !isEligible(session)) {
      throw new Error("The Driver is no longer eligible to create this Split Worker");
    }
    var approvedGroup = null;
    if (proposal.action === "replace") {
      approvedGroup = store.groupForMember(session.localId);
      if (!driverEligibility.isEligibleDriverSession(session, sm) || !approvedGroup ||
          approvedGroup.id !== proposal.sourceGroupId || !approvedGroup.pair ||
          approvedGroup.pair.driverId !== session.localId || approvedGroup.pair.workerId !== proposal.sourceWorkerId) {
        throw new Error("The Driver/Split Worker pair changed before the replacement was approved");
      }
    }
    var options = proposalOptions();
    var vendor = msg.vendor || proposal.recommendedVendor;
    var model = msg.model || "";
    if (options.installedVendors.indexOf(vendor) === -1) throw new Error("Selected Split Worker vendor is not installed");
    if (!modelIsAvailable(options, vendor, model)) throw new Error("Selected Split Worker model is unavailable");
    var requestedEffort = msg.effort || proposal.recommendedEffort || "medium";
    var effort = yoke.clampEffort(vendor, requestedEffort) || "";
    if ((msg.effort && effort !== msg.effort) || !effortIsAvailable(options, vendor, model, effort)) {
      throw new Error("Selected Split Worker reasoning effort is unavailable");
    }
    var autoAccepted = trustedAutoAcceptance === true;
    var startingPatch = {
      status: "starting",
      selectedVendor: vendor,
      selectedModel: model,
      selectedEffort: effort,
      autoAccepted: autoAccepted,
      decisionMode: autoAccepted ? "driver_recommendation" : "user",
      decidedAt: Date.now(),
    };
    updateProposal(session, proposal, startingPatch);
    try {
      if (proposal.action === "replace") {
        var liveGroup = approvedGroup;
        var replaced = await ctx.replacePartner({
          interrupt: proposal.interrupt === true,
          workerVendor: vendor,
          workerModel: model,
          workerEffort: effort,
          evaluation: proposal.evaluation || undefined,
          transactionId: proposal.transactionId,
        }, session);
        liveGroup = store.groupForMember(session.localId);
        updateProposal(session, proposal, { status: "running", groupId: liveGroup.id, workerId: replaced.workerSessionId });
        runWorker(session, proposal).catch(function (err) {
          updateProposal(session, proposal, { status: "error", error: err.message || String(err) });
          resumeDriver(session, "[Split Worker execution failed]\n" + (err.message || String(err))).catch(function () {});
        });
        return { ok: true, status: "running", group: liveGroup, replacement: replaced };
      }
      var created = ctx.createPairRecord(ws, {
        driver: { sessionId: session.localId },
        worker: { vendor: vendor, model: model, effort: effort },
      });
      ctx.recordGenerationStart(session, created.worker);
      updateProposal(session, proposal, { status: "running", groupId: created.group.id, workerId: created.worker.localId });
      ctx.sendTo(ws, { type: "pair_session_created", ok: true, group: created.group });
      runWorker(session, proposal).catch(function (err) {
        updateProposal(session, proposal, { status: "error", error: err.message || String(err) });
        resumeDriver(session, "[Split Worker execution failed]\n" + (err.message || String(err))).catch(function () {});
      });
      return { ok: true, status: "running", group: created.group };
    } catch (err) {
      if (proposal.action === "replace") {
        var restoredGroup = store.groupForMember(session.localId);
        if (restoredGroup && restoredGroup.pair && restoredGroup.pair.driverId === session.localId &&
            restoredGroup.pair.workerId === proposal.sourceWorkerId) {
          proposal.sourceGroupId = restoredGroup.id;
        }
        proposal.transactionId = "replace_" + crypto.randomUUID();
      }
      updateProposal(session, proposal, {
        status: "pending",
        error: err.message || String(err),
        autoAccepted: false,
        decisionMode: null,
        decidedAt: null,
      });
      return { ok: false, status: "pending", error: err.message || String(err) };
    }
  }

  async function respondToProposal(ws, msg) {
    var session = sessionForResponse(ws);
    var proposal = proposalControl.findProposal(session, msg.proposalId);
    if (!proposal) throw new Error("Split Worker suggestion not found");
    if (proposal.status !== "pending") throw new Error("Split Worker suggestion has already been resolved");
    if (!msg.accepted) {
      updateProposal(session, proposal, { status: "declined" });
      var declinedText = proposal.action === "replace"
        ? "[Split Worker replacement declined]\nContinue with the existing Split Worker and the current task."
        : "[Split Worker proposal declined]\nContinue this task in the current Driver session using the plan you already prepared.";
      await resumeDriver(session, declinedText);
      return { ok: true, status: "declined" };
    }
    return acceptProposal(session, proposal, msg, ws);
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "worker_proposal_response") return false;
    respondToProposal(ws, msg).catch(function (err) {
      ctx.sendTo(ws, { type: "worker_proposal_update", proposalId: msg.proposalId, status: "pending", error: err.message || String(err) });
    });
    return true;
  }

  function getToolDefs(session, options) {
    var persistent = !!(options && options.persistent);
    var controlsOnly = !!(options && options.controlsOnly);
    if (!isEligible(session) && !(persistent && canOffer(session))) return [];
    var proposalTools = controlsOnly ? [] : [{
      name: "propose_worker",
      description: "Propose a visible Split Worker for implementation-heavy execution. This non-mutating tool only shows the user a card where they choose vendor, model, and effort. It never creates a session or delegates work until the user accepts.",
      inputSchema: buildShape({
        summary: { type: "string", description: "One short sentence explaining why a Split Worker is useful for this task." },
        plan: { type: "string", description: "A concise numbered implementation plan to show in the approval card." },
        message: { type: "string", description: "Complete execution instructions for the Split Worker, including scope, constraints, validation, and expected result." },
        recommendedVendor: { type: "string", description: "Optional installed vendor id for the Split Worker." },
        recommendedModel: { type: "string", description: "Optional exact Split Worker model id. Omit when uncertain." },
        recommendedEffort: { type: "string", description: "Optional reasoning effort: minimal, low, medium, high, xhigh, or max." },
        recommendationRationale: { type: "string", description: "Concise Driver-authored explanation of why the recommended vendor, model, and effort fit this exact task." },
        supersedeProposalId: { type: "string", description: "Exact pending proposal id to resolve as superseded when posting this replacement suggestion." },
      }, ["summary", "plan", "message", "recommendationRationale"]),
      handler: function (args) { return propose(args || {}, session); },
    }];
    return proposalTools.concat(proposalControl.getToolDefs({
      inspect: function () { return toolResult(isLiveSession(session) ? proposalControl.projection(proposalControl.pendingProposal(session)) : { status: "rejected", reason: "The Driver session is no longer live." }); },
      cancel: function (args) {
        if (!isLiveSession(session)) return toolResult({ status: "rejected", proposalId: args.proposalId || null, reason: "The Driver session is no longer live." });
        var proposal = proposalControl.findProposal(session, args.proposalId);
        if (!proposal || proposal.status !== "pending") return toolResult({ status: "rejected", proposalId: args.proposalId || null, reason: "The exact proposal is not pending." });
        updateProposal(session, proposal, { status: "cancelled" });
        return toolResult({ status: "cancelled", proposalId: proposal.proposalId });
      },
      catalog: function () { return ensureModelCatalogs().then(function () {
        return toolResult(runtimeCatalog.build(proposalOptions(), skipPermissionsEnabled(session), function (vendor, model, effort) {
          return ctx.preflightWorkerForDriver ? ctx.preflightWorkerForDriver(session, { workerVendor: vendor, workerModel: model, workerEffort: effort || "" }) : null;
        }));
      }); },
    }));
  }

  function getSystemPrompt(session) {
    if (!isEligible(session) || !driverOrchestration.isHighTierDriverSession(session, sm)) return "";
    return "For implementation-heavy work, use propose_worker before substantial execution. Work is implementation-heavy when it spans multiple modules, crosses client/server/data boundaries, requires a migration, or contains independent investigation and execution. Do not skip delegation merely because you can implement it yourself; preserve the Driver for decomposition, runtime selection, judgment, review, and integration. The user's explicit request to work directly takes precedence, and work that must remain sequential in this session stays here. Recommend an exact available vendor, model, and effort, and give a concise recommendationRationale explaining why all three fit the task. Clay always records and shows the runtime configuration card. In full-access mode Clay may auto-accept that exact validated recommendation; otherwise it waits for the user's explicit choice. After posting, end the turn. If accepted, Clay creates the exact Driver/Split Worker pair and delegates the proposed task once. If declined, continue in this Driver session. Do not call send_to_partner while unpaired.";
  }
  return { getToolDefs: getToolDefs, getSystemPrompt: getSystemPrompt, proposeReplacement: proposeReplacement,
    handleMessage: handleMessage, respondToProposal: respondToProposal,
    proposalStatus: function (session) { return proposalControl.projection(proposalControl.pendingProposal(session)); } };
}
module.exports = { attachWorkerProposal: attachWorkerProposal };
