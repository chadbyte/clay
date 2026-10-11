var mateCreationMcp = require("./mate-creation-mcp-server");
var selectCatalogModel = require("./project-models").selectCatalogModel;

function attachMateCreationProposal(ctx) {
  var pending = {};

  function clean(value, maxLength) {
    if (typeof value !== "string") return "";
    return value.replace(/\u0000/g, "").trim().slice(0, maxLength);
  }

  function publicProposal(source) {
    return {
      proposalId: source.proposalId,
      name: clean(source.name, 80),
      bio: clean(source.bio, 280),
      relationship: clean(source.relationship, 120),
      activities: Array.isArray(source.activities) ? source.activities.slice(0, 12) : [],
      communicationStyle: Array.isArray(source.communicationStyle) ? source.communicationStyle.slice(0, 12) : [],
      autonomy: clean(source.autonomy, 500),
      identityMarkdown: clean(source.identityMarkdown, 30000),
    };
  }

  function record(session, event) {
    if (typeof ctx.recordSessionEvent === "function") ctx.recordSessionEvent(session, event);
  }

  function validateBoundSession(session) {
    var projectOwnerId = typeof ctx.getProjectOwnerId === "function" ? ctx.getProjectOwnerId() : null;
    var ownerValid = typeof ctx.isMultiUser === "function" && ctx.isMultiUser() ? !!(session && session.ownerId && (!projectOwnerId || session.ownerId === projectOwnerId)) : !!(session && !session.ownerId);
    return !!(session && ctx.isMate === true && ctx.isHostAgent === true && session.mateCreationMode === true
      && ownerValid);
  }

  function hasInterviewAnswer(session) {
    var history = session && Array.isArray(session.history) ? session.history : [];
    for (var i = history.length - 1; i >= 0; i--) if (history[i] && history[i].type === "ask_user_answered") return true;
    return false;
  }

  function getToolDefs(boundSession) {
    if (!boundSession || boundSession.mateCreationMode !== true) return [];
    return mateCreationMcp.getToolDefs(function (definition) {
      if (!validateBoundSession(boundSession)) return Promise.resolve({ action: "error", error: "Mate proposals require an owned Clay creation interview." });
      if (!hasInterviewAnswer(boundSession)) return Promise.resolve({ action: "error", error: "Interview the user before proposing a Mate." });
      return new Promise(function (resolve) {
        var proposalId = "mp_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
        definition.proposalId = proposalId;
        pending[proposalId] = { resolve: resolve, definition: definition, session: boundSession };
        record(boundSession, { type: "mate_creation_proposal", proposal: publicProposal(definition) });
      });
    });
  }

  function createMcpServer(adapter, boundSession) {
    return adapter.createToolServer({ name: "clay-mate-creation", version: "1.0.0", tools: getToolDefs(boundSession) });
  }

  function getBridgeTools(boundSession, normalizeSchema) {
    if (!boundSession) return [];
    return getToolDefs(boundSession).map(function (tool) {
      return { server: "clay-mate-creation", name: tool.name, description: tool.description || tool.name, inputSchema: normalizeSchema(tool.inputSchema) };
    });
  }

  function callBridgeTool(boundSession, toolName, args) {
    var tools = getToolDefs(boundSession);
    for (var i = 0; i < tools.length; i++) if (tools[i].name === toolName) return Promise.resolve(tools[i].handler(args || {}));
    return Promise.reject(new Error("Session tool not found: clay-mate-creation/" + toolName));
  }

  function handleHomeMessage(ws, msg, session) {
    var entry = msg && msg.proposalId ? pending[msg.proposalId] : null;
    if (!entry || entry.session !== session || !validateBoundSession(session)) return false;
    delete pending[msg.proposalId];
    if (msg.action !== "create") {
      record(session, { type: "mate_creation_proposal_resolved", proposalId: msg.proposalId, action: "cancel" });
      entry.resolve({ action: "cancel" });
      return true;
    }
    if (typeof ctx.createReadyMate !== "function") {
      var unavailable = "Mate creation is unavailable.";
      record(session, { type: "mate_creation_proposal_resolved", proposalId: msg.proposalId, action: "error", error: unavailable });
      entry.resolve({ action: "error", error: unavailable });
      return true;
    }
    var vendor = session.vendor || "claude";
    if (typeof ctx.getVendorModelCatalog !== "function") {
      var catalogUnavailable = "The Mate model catalog is unavailable.";
      record(session, { type: "mate_creation_proposal_resolved", proposalId: msg.proposalId, action: "error", error: catalogUnavailable });
      entry.resolve({ action: "error", error: catalogUnavailable });
      return true;
    }
    Promise.resolve(ctx.getVendorModelCatalog(ws, vendor)).then(function (catalog) {
      var selected = catalog && catalog.status === "ready" ? selectCatalogModel(catalog.models || [], catalog.defaultModel, "deep") : null;
      if (!selected) throw new Error((catalog && catalog.error) || "No high-capability Mate model is available for " + vendor + ".");
      return ctx.createReadyMate(ws, session.ownerId || null, Object.assign({}, entry.definition, { vendor: vendor, model: selected.value }));
    }).then(function (mate) {
      session.homeMateCreationPhase = "created";
      if (typeof ctx.persistSession === "function") ctx.persistSession(session);
      record(session, { type: "mate_creation_proposal_resolved", proposalId: msg.proposalId, action: "create", mateId: mate.id, mateName: (mate.profile && mate.profile.displayName) || mate.name || "Mate" });
      entry.resolve({ action: "create", mateId: mate.id });
    }).catch(function (error) {
      var text = error && error.message ? error.message : "The Mate could not be created.";
      record(session, { type: "mate_creation_proposal_resolved", proposalId: msg.proposalId, action: "error", error: text });
      entry.resolve({ action: "error", error: text });
    });
    return true;
  }

  return {
    createMcpServer: createMcpServer,
    getToolDefs: getToolDefs,
    getBridgeTools: getBridgeTools,
    callBridgeTool: callBridgeTool,
    handleHomeMessage: handleHomeMessage,
  };
}

module.exports = { attachMateCreationProposal: attachMateCreationProposal };
