var workspaceMcp = require("./workspace-query-mcp-server");
var clayHistoryMcp = require("./clay-history-mcp-server");

function attachProjectWorkspaceQuery(ctx) {
  var service = ctx.service;
  var sm = ctx.sm;
  var projectSlug = ctx.projectSlug;
  var getProjectOwnerId = ctx.getProjectOwnerId || function () { return null; };
  var isMate = ctx.isMate;
  var mateId = ctx.mateId;

  function binding(session) {
    if (!service || isMate !== true || !mateId) return null;
    if (session && (!sm || !sm.sessions || sm.sessions.get(session.localId) !== session)) return null;
    if (session && (session.homeDebatePlanning === true || session.debateSetupMode === true || session._mentionInProgress === true || session.spawn)) return null;
    return service.bindSource({
      projectSlug: projectSlug,
      projectOwnerId: getProjectOwnerId(),
      isMate: true,
      mateId: mateId,
      session: session || null,
    });
  }

  function getToolDefs(session) {
    var bound = session ? binding(session) : null;
    if (session && !bound) return [];
    return workspaceMcp.getToolDefs(bound, !!(bound && bound.isClay));
  }

  function createMcpServer(adapter, session) {
    if (!service || isMate !== true) return null;
    var bound = session ? binding(session) : null;
    if (session && !bound) return null;
    var projectBound = binding(null);
    if (!projectBound) return null;
    return workspaceMcp.createMcpServer(adapter, bound, projectBound.isClay);
  }

  function createHistoryMcpServer(adapter, session) {
    if (!adapter || typeof adapter.createToolServer !== "function") return null;
    var bound = session ? binding(session) : null;
    if (session && !bound) return null;
    var projectBound = binding(null);
    if (!projectBound || projectBound.isClay !== true) return null;
    return adapter.createToolServer({
      name: "clay-history",
      version: "2.0.0",
      tools: clayHistoryMcp.getToolDefs({ workspace: bound }),
    });
  }

  function getLateSessionMcpServers(adapter, session, startupServers, boundServers) {
    var servers = {};
    if (!session) return servers;
    if (isMate && !Object.prototype.hasOwnProperty.call(startupServers || {}, "clay-workspace") && !boundServers["clay-workspace"]) {
      try {
        var workspace = createMcpServer(adapter, session);
        if (workspace) servers["clay-workspace"] = workspace;
      } catch (e) {
        console.error("[project-workspace-query] Failed to late-bind clay-workspace MCP server:", e.message);
      }
    }
    if (isMate && !Object.prototype.hasOwnProperty.call(startupServers || {}, "clay-history") && !boundServers["clay-history"]) {
      try {
        var history = createHistoryMcpServer(adapter, session);
        if (history) servers["clay-history"] = history;
      } catch (e) {
        console.error("[project-workspace-query] Failed to late-bind clay-history MCP server:", e.message);
      }
    }
    return servers;
  }

  function isAuthoritativeClay() {
    var bound = binding(null);
    return !!(bound && bound.isClay === true);
  }

  function getBridgeTools(session, normalizeSchema) {
    if (!session) return [];
    var defs = getToolDefs(session);
    var tools = [];
    for (var i = 0; i < defs.length; i++) {
      tools.push({
        server: "clay-workspace",
        name: defs[i].name,
        description: defs[i].description || defs[i].name,
        inputSchema: normalizeSchema(defs[i].inputSchema),
      });
    }
    return tools;
  }

  function getDynamicToolDefs(session) {
    return getToolDefs(session).map(function (tool) {
      tool.permissionName = "mcp__clay-workspace__" + tool.name;
      return tool;
    });
  }

  function getHistoryDynamicToolDefs(session) {
    var bound = session ? binding(session) : null;
    if (!bound || bound.isClay !== true) return [];
    return clayHistoryMcp.getToolDefs({ workspace: bound }).map(function (tool) {
      tool.permissionName = "mcp__clay-history__" + tool.name;
      return tool;
    });
  }

  function getHistoryBridgeTools(session, normalizeSchema) {
    if (!session) return [];
    var bound = binding(session);
    if (!bound || bound.isClay !== true) return [];
    var defs = clayHistoryMcp.getToolDefs({ workspace: bound });
    var tools = [];
    for (var i = 0; i < defs.length; i++) {
      tools.push({
        server: "clay-history",
        name: defs[i].name,
        description: defs[i].description || defs[i].name,
        inputSchema: normalizeSchema(defs[i].inputSchema),
      });
    }
    return tools;
  }

  function callBridgeTool(session, toolName, args) {
    if (!session) return Promise.reject(new Error("Workspace tools require a valid Clay session."));
    var defs = getToolDefs(session);
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].name === toolName) return Promise.resolve(defs[i].handler(args || {}));
    }
    return Promise.reject(new Error("Workspace tool not found: " + toolName));
  }

  function callHistoryBridgeTool(session, toolName, args) {
    var bound = session ? binding(session) : null;
    if (!bound || bound.isClay !== true) return Promise.reject(new Error("Clay history requires a valid builtin Clay session."));
    var defs = clayHistoryMcp.getToolDefs({ workspace: bound });
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].name === toolName) return Promise.resolve(defs[i].handler(args || {}));
    }
    return Promise.reject(new Error("Clay history tool not found: " + toolName));
  }

  function getMemorySessions(session, excludeSource) {
    var bound = session && service && typeof service.bindProjectSession === "function"
      ? service.bindProjectSession({ projectSlug: projectSlug, session: session })
      : binding(null);
    return bound ? bound.getMemorySessions(excludeSource) : [];
  }

  return {
    createMcpServer: createMcpServer,
    createHistoryMcpServer: createHistoryMcpServer,
    getLateSessionMcpServers: getLateSessionMcpServers,
    isAuthoritativeClay: isAuthoritativeClay,
    getBridgeTools: getBridgeTools,
    getHistoryBridgeTools: getHistoryBridgeTools,
    getDynamicToolDefs: getDynamicToolDefs,
    getHistoryDynamicToolDefs: getHistoryDynamicToolDefs,
    callBridgeTool: callBridgeTool,
    callHistoryBridgeTool: callHistoryBridgeTool,
    getMemorySessions: getMemorySessions,
  };
}

module.exports = { attachProjectWorkspaceQuery: attachProjectWorkspaceQuery };
