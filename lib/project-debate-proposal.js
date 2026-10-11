var path = require("path");
var debateMcp = require("./debate-mcp-server");
var debateModels = require("./debate-model-selection");

function attachDebateProposal(ctx) {
  var pendingProposals = {};

  function hasHomeDebateTopicAnswer(session) {
    if (session && typeof session.homeDebateInitialTopic === "string" && session.homeDebateInitialTopic.trim()) return true;
    var history = session && Array.isArray(session.history) ? session.history : [];
    var firstQuestionId = null;
    for (var i = 0; i < history.length; i++) {
      var event = history[i];
      if (!firstQuestionId && event && event.type === "tool_executing" && event.name === "AskUserQuestion") firstQuestionId = event.id || null;
      if (firstQuestionId && event && event.type === "ask_user_answered" && event.toolId === firstQuestionId) return true;
    }
    return false;
  }

  function publicProposal(briefData) {
    return {
      proposalId: briefData.proposalId,
      topic: briefData.topic || "Untitled debate",
      format: briefData.format || "free_discussion",
      context: briefData.context || "",
      specialRequests: briefData.specialRequests || null,
      moderatorId: briefData.moderatorId || null,
      modelSelections: Array.isArray(briefData.modelSelections) ? briefData.modelSelections : [],
      panelists: Array.isArray(briefData.panelists) ? briefData.panelists.map(function (panelist) {
        return { mateId: panelist.mateId, role: panelist.role || "", brief: panelist.brief || "" };
      }) : [],
    };
  }

  function record(session, event) {
    if (typeof ctx.recordSessionEvent === "function") ctx.recordSessionEvent(session, event);
  }

  function getToolDefs(boundSession) {
    return debateMcp.getToolDefs(function onPropose(briefData) {
      if (!boundSession) {
        return Promise.resolve({
          action: "error",
          error: "Debate proposals require an active Clay session.",
        });
      }
      var projectOwnerId = typeof ctx.getProjectOwnerId === "function" ? ctx.getProjectOwnerId() : null;
      if (boundSession.homeDebatePlanning === true
          && (ctx.isHostAgent !== true || ctx.isMate !== true || boundSession.debateSetupMode !== true
            || !boundSession.ownerId || (projectOwnerId && boundSession.ownerId !== projectOwnerId))) {
        return Promise.resolve({
          action: "error",
          error: "This Home debate proposal is not bound to an owned Clay planning session.",
        });
      }
      if (boundSession.homeDebatePlanning === true && !hasHomeDebateTopicAnswer(boundSession)) {
        return Promise.resolve({ action: "error", error: "Ask the user for a debate topic before proposing a debate." });
      }
      return new Promise(function (resolve) {
        var proposalId = "dp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        briefData.proposalId = proposalId;
        var moderatorId = ctx.isMate ? path.basename(ctx.cwd) : briefData.moderatorId;
        var userId = boundSession.ownerId || (typeof ctx.getProjectOwnerId === "function" ? ctx.getProjectOwnerId() : null);
        var mateCtx = ctx.buildMateCtx(userId);
        function register(selections) {
          briefData.modelSelections = selections;
          pendingProposals[proposalId] = {
            resolve: resolve,
            briefData: briefData,
            session: boundSession,
          };
          record(boundSession, { type: "debate_proposal", proposal: publicProposal(briefData) });
        }
        if (typeof ctx.getVendorModelCatalog !== "function" && typeof ctx.getVendorModelCatalogForSession !== "function") register([]);
        else debateModels.loadSelections(ctx, null, mateCtx, moderatorId, briefData.panelists || [], boundSession).then(register).catch(function () { register([]); });
      });
    });
  }

  function createMcpServer(adapter, boundSession) {
    var toolDefs = getToolDefs(boundSession);

    return adapter.createToolServer({
      name: "clay-debate",
      version: "1.0.0",
      tools: toolDefs,
    });
  }

  function getBridgeTools(boundSession, normalizeSchema) {
    if (!boundSession) return [];
    var toolDefs = getToolDefs(boundSession);
    return toolDefs.map(function (tool) {
      return {
        server: "clay-debate",
        name: tool.name,
        description: tool.description || tool.name,
        inputSchema: normalizeSchema(tool.inputSchema),
      };
    });
  }

  function callBridgeTool(boundSession, toolName, args) {
    if (!boundSession) return Promise.reject(new Error("Debate proposals require a valid Clay session."));
    var toolDefs = getToolDefs(boundSession);
    for (var i = 0; i < toolDefs.length; i++) {
      if (toolDefs[i].name === toolName && typeof toolDefs[i].handler === "function") {
        return Promise.resolve(toolDefs[i].handler(args || {}));
      }
    }
    return Promise.reject(new Error("Session tool not found: clay-debate/" + toolName));
  }

  function findPendingProposal(ws, msg) {
    var keys = Object.keys(pendingProposals);
    if (keys.length === 0) return null;
    var key = msg.proposalId || null;
    if (!key && ws && Number.isInteger(ws._clayActiveSession)) {
      for (var i = keys.length - 1; i >= 0; i--) {
        var candidate = pendingProposals[keys[i]];
        if (candidate.session && candidate.session.localId === ws._clayActiveSession) {
          key = keys[i];
          break;
        }
      }
    }
    if (!key) key = keys[keys.length - 1];
    var pending = pendingProposals[key];
    if (!pending) return null;
    return { key: key, pending: pending };
  }

  function rejectProposal(ws, pending, error) {
    try {
      ctx.sendTo(ws, { type: "debate_error", error: error });
    } catch (sendErr) {
      console.error("[debate] Failed to send proposal error:", sendErr && sendErr.message ? sendErr.message : sendErr);
    }
    record(pending.session, { type: "debate_proposal_resolved", proposalId: pending.briefData.proposalId, action: "error", error: error });
    pending.resolve({ action: "error", error: error });
  }

  function validateProposal(ws, pending) {
    var briefData = pending.briefData;
    var moderatorId = ctx.isMate ? path.basename(ctx.cwd) : briefData.moderatorId;
    if (!moderatorId || typeof moderatorId !== "string") {
      return { error: "A valid Mate moderator is required to start this debate." };
    }

    var userId = ws && ws._clayUser
      ? ws._clayUser.id
      : (pending.session.ownerId || ctx.getProjectOwnerId() || null);
    var mateCtx = ctx.buildMateCtx(userId);
    if (!ctx.getMate(mateCtx, moderatorId)) {
      return { error: "The selected debate moderator is unavailable." };
    }

    var panelists = briefData.panelists;
    if (!Array.isArray(panelists) || panelists.length === 0) {
      return { error: "At least one valid panelist is required to start this debate." };
    }

    var seen = {};
    for (var i = 0; i < panelists.length; i++) {
      var panelistId = panelists[i] && panelists[i].mateId;
      if (!panelistId || typeof panelistId !== "string" || !ctx.getMate(mateCtx, panelistId)) {
        return { error: "One or more selected debate panelists are unavailable." };
      }
      if (panelistId === moderatorId) {
        return { error: "The debate moderator cannot also be a panelist." };
      }
      if (seen[panelistId]) {
        return { error: "The same Mate cannot be added to a debate more than once." };
      }
      seen[panelistId] = true;
    }

    return { moderatorId: moderatorId };
  }

  async function startApprovedProposal(ws, msg, found) {
    var pending = found.pending;
    if (pending.responding) return;
    pending.responding = true;
    if (msg.action !== "start") {
      delete pendingProposals[found.key];
      record(pending.session, { type: "debate_proposal_resolved", proposalId: pending.briefData.proposalId, action: "cancel" });
      pending.resolve({ action: "cancel" });
      return;
    }

    var validated = validateProposal(ws, pending);
    if (validated.error) {
      delete pendingProposals[found.key];
      rejectProposal(ws, pending, validated.error);
      return;
    }

    var userId = ws && ws._clayUser ? ws._clayUser.id : (pending.session.ownerId || ctx.getProjectOwnerId() || null);
    var mateCtx = ctx.buildMateCtx(userId);
    var modelResult = await debateModels.validateSelections(ctx, ws, mateCtx, validated.moderatorId, pending.briefData.panelists, msg.modelOverrides, pending.session);
    if (modelResult.error) {
      delete pendingProposals[found.key];
      rejectProposal(ws, pending, modelResult.error);
      return;
    }
    pending.briefData.participantModels = modelResult.selections;
    delete pendingProposals[found.key];

    try {
      var result = ctx.startDebate(pending.session, pending.briefData, validated.moderatorId, ws);
      if (result && result.error) {
        rejectProposal(ws, pending, result.error);
        return true;
      }
      record(pending.session, { type: "debate_proposal_resolved", proposalId: pending.briefData.proposalId, action: "start" });
      pending.resolve({ action: "start" });
    } catch (err) {
      var detail = err && err.message ? err.message : String(err);
      console.error("[debate] Failed to start approved proposal:", detail);
      rejectProposal(ws, pending, "The debate could not be started. Check the server logs for details.");
    }
  }

  function handleMessage(ws, msg) {
    if (msg.type !== "debate_proposal_response") return false;

    var found = findPendingProposal(ws, msg);
    if (!found) return true;
    if (msg.sessionId != null && (String(found.pending.session.localId) !== String(msg.sessionId)
        || String(ws._clayActiveSession) !== String(msg.sessionId)
        || (found.pending.session.ownerId && (!ws._clayUser || ws._clayUser.id !== found.pending.session.ownerId)))) {
      ctx.sendTo(ws, { type: "debate_error", error: "This proposal belongs to a different session." });
      return true;
    }
    startApprovedProposal(ws, msg, found).catch(function (error) {
      delete pendingProposals[found.key];
      rejectProposal(ws, found.pending, error && error.message ? error.message : "The selected debate models could not be verified.");
    });
    return true;
  }

  function handleHomeMessage(ws, msg, expectedSession) {
    var found = findPendingProposal(ws, msg);
    if (!found || found.pending.session !== expectedSession) return false;
    if (expectedSession.ownerId && (!ws || !ws._clayUser || ws._clayUser.id !== expectedSession.ownerId)) return false;
    return handleMessage(ws, msg);
  }

  return {
    createMcpServer: createMcpServer,
    getToolDefs: getToolDefs,
    getBridgeTools: getBridgeTools,
    callBridgeTool: callBridgeTool,
    handleMessage: handleMessage,
    handleHomeMessage: handleHomeMessage,
  };
}

module.exports = { attachDebateProposal: attachDebateProposal };
