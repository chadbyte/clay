// Project Logs message handling and session-bound MCP wiring.
//
// Every capability here is derived server-side. The WebSocket path binds from
// ws._clayUser plus this project's own slug, and the MCP path binds from the
// exact live session object. Neither accepts identity or project scope from
// the message, so a client cannot widen its own reach by asking.
//
// Authorship is split deliberately. Canonical entries are created and revised
// only by this project's agent sessions through `clay-logs`; a connected human
// reads the ledger, appends attributed comments, and lets the project owner
// delete an entry. That keeps the log an honest record rather than a wiki.

var logsMcp = require("./project-logs-mcp-server");

var LIST_LIMIT = 50;
var MAX_NOTICE_TITLE_CHARS = 160;
var MAX_NOTICE_SUMMARY_CHARS = 240;

// Canonical writes that move the ledger forward. A plain comment, a
// clarification, and a decline are participation, not revisions, so they never
// notify.
var NOTIFYING_OPS = ["create", "update", "link", "incorporate", "revert", "delete"];

function clip(value, max) {
  if (typeof value !== "string") return "";
  return value.length > max ? value.substring(0, max) : value;
}

// Bounded ledger metadata only. No body, no comment text, no author identity
// beyond the vendor that wrote it.
function updateNotice(entry, op) {
  return {
    type: "project_log_updated",
    ref: entry.ref,
    revision: entry.revisions,
    op: op,
    category: entry.category,
    priority: entry.priority,
    title: clip(entry.title, MAX_NOTICE_TITLE_CHARS),
    summary: clip(entry.summary, MAX_NOTICE_SUMMARY_CHARS),
    at: entry.updatedAt,
    vendor: (entry.updatedBy && entry.updatedBy.vendor) || null,
  };
}

var SYSTEM_PROMPT_LABEL = "--- Project Logs (durable project record; manage via clay-logs tools) ---";

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string" || !value.trim()) return undefined;
  var parsed;
  try {
    parsed = JSON.parse(value);
  } catch (e) {
    throw new Error("Expected a JSON array.");
  }
  if (!Array.isArray(parsed)) throw new Error("Expected a JSON array.");
  return parsed;
}

// The tool surface accepts JSON-encoded arrays because MCP shapes are flat
// scalars. The service and store only ever see real arrays.
function coerceToolArgs(args) {
  var out = Object.assign({}, args || {});
  if (out.tags !== undefined) out.tags = parseJsonArray(out.tags);
  if (out.links !== undefined) out.links = parseJsonArray(out.links);
  return out;
}

var HANDLED_TYPES = [
  "project_logs_list",
  "project_log_read",
  "project_log_comment",
  "project_log_delete",
  "scheduled_task_result_mark_read",
  "scheduled_task_result_open_session",
  // Retired human mutations. Still claimed so an older client gets an
  // explicit refusal rather than silence.
  "project_log_create",
  "project_log_update",
];

var RETIRED_TYPES = ["project_log_create", "project_log_update"];

function attachProjectLogs(ctx) {
  var service = ctx.service;
  var sm = ctx.sm;
  var slug = ctx.projectSlug;
  var isMate = ctx.isMate === true;
  var mateId = ctx.mateId || null;
  var sendTo = ctx.sendTo;
  var getClients = ctx.getClients || function () { return []; };
  var getProjectOwnerId = ctx.getProjectOwnerId || function () { return null; };
  var onFeedback = ctx.onFeedback || function () {};

  // Every socket in this project's client set passed the project access check
  // at WebSocket upgrade, so a broadcast here is already scoped to authorized
  // human users of this project. Nothing is read from any payload. Pane
  // connections are excluded, matching how sticky notes broadcast.
  function broadcastUpdate(entry, op) {
    if (isMate || !entry) return;
    if (NOTIFYING_OPS.indexOf(op) === -1) return;
    var notice = updateNotice(entry, op);
    var clients = getClients();
    for (var client of clients) {
      if (!client || client.readyState !== 1 || client._clayPane) continue;
      sendTo(client, notice);
    }
  }

  function broadcastCommentReview(entry, request) {
    if (isMate || !entry || !request || !request.commentId) return;
    var notice = {
      type: "project_log_comment_reviewed",
      ref: entry.ref,
      commentId: request.commentId,
      action: request.action,
    };
    var clients = getClients();
    for (var client of clients) {
      if (!client || client.readyState !== 1 || client._clayPane) continue;
      sendTo(client, notice);
    }
  }

  // Wrap a canonical write so a successful one notifies. A throw never reaches
  // here, so a failed or no-op write is silent.
  function notifying(op, run) {
    return function (args) {
      var result = run(args);
      broadcastUpdate(result, op);
      return result;
    };
  }

  // --- Bindings --------------------------------------------------------

  function sessionBinding(session) {
    if (!service) return null;
    if (isMate) {
      if (!mateId) return null;
      if (session && (!sm || !sm.sessions || sm.sessions.get(session.localId) !== session)) return null;
      return service.bindMate({
        projectSlug: slug,
        projectOwnerId: getProjectOwnerId(),
        isMate: true,
        mateId: mateId,
        session: session || null,
      });
    }
    if (!session) return null;
    return service.bindProjectSession({ projectSlug: slug, session: session });
  }

  function userBinding(ws) {
    if (!service || isMate) return null;
    return service.bindUser({ projectSlug: slug, user: (ws && ws._clayUser) || null });
  }

  function scheduledResultState(bound, autoFocus) {
    var state = bound.scheduledResultsState();
    return { type: "scheduled_task_results_state", unreadCount: state.count, newestUnreadRef: state.newestRef, autoFocus: autoFocus === true };
  }

  function sendScheduledResultState(ws) {
    if (!ws || ws._clayPane) return false;
    var bound = userBinding(ws);
    if (!bound) return false;
    try { sendTo(ws, scheduledResultState(bound, true)); return true; } catch (e) { return false; }
  }

  function broadcastScheduledResultState(sourceWs) {
    var sourceUserId = sourceWs && sourceWs._clayUser ? sourceWs._clayUser.id : null;
    var clients = getClients();
    for (var client of clients) {
      if (!client || client.readyState !== 1 || client._clayPane) continue;
      var clientUserId = client._clayUser ? client._clayUser.id : null;
      if (clientUserId !== sourceUserId) continue;
      var bound = userBinding(client);
      if (!bound) continue;
      try { sendTo(client, scheduledResultState(bound)); } catch (e) {}
    }
  }

  // --- WebSocket surface -----------------------------------------------

  function fail(ws, requestId, message) {
    sendTo(ws, { type: "project_logs_error", requestId: requestId || null, message: message });
  }

  // Search already returns the ledger row shape, so a query needs no per-hit
  // read and neither path dumps a record body into the list.
  // Returns both the rows and this project's live category vocabulary, so the
  // filter is populated solely from what this project actually uses.
  function listEntries(bound, query, category, contextMode) {
    var options = { kind: category, limit: LIST_LIMIT, contextMode: contextMode };
    if (query) {
      options.query = query;
      var hits = bound.searchLogs(options);
      return {
        entries: hits.results,
        categories: hits.categories || [],
        contextMode: hits.contextMode,
        currentChangeSetId: hits.currentChangeSetId,
        isWorktree: hits.isWorktree,
      };
    }
    var listed = bound.listLogs(options);
    return {
      entries: listed.entries,
      categories: listed.categories || [],
      contextMode: listed.contextMode,
      currentChangeSetId: listed.currentChangeSetId,
      isWorktree: listed.isWorktree,
    };
  }

  function handleLogsMessage(ws, msg) {
    if (!msg || typeof msg.type !== "string") return false;
    if (HANDLED_TYPES.indexOf(msg.type) === -1) return false;

    var requestId = typeof msg.requestId === "string" ? msg.requestId : null;
    if (isMate) {
      fail(ws, requestId, "Project Logs are available in projects, not in Mate conversations.");
      return true;
    }

    // Canonical authorship belongs to the project's agent sessions. A human
    // asking to create or revise is refused before any binding is attempted,
    // so no privilege level can reach the canonical writers.
    if (RETIRED_TYPES.indexOf(msg.type) !== -1) {
      fail(ws, requestId, "Project Logs are written by this project's agent sessions. Add a comment instead.");
      return true;
    }

    var bound = userBinding(ws);
    if (!bound) {
      fail(ws, requestId, "Project Logs are not available for this project.");
      return true;
    }

    try {
      if (msg.type === "project_logs_list") {
        var query = typeof msg.query === "string" ? msg.query.trim() : "";
        // A view preference, not an authorization input: the store validates it.
        var category = typeof msg.category === "string" && msg.category ? msg.category : null;
        var contextMode = typeof msg.contextMode === "string" ? msg.contextMode : null;
        var listing = listEntries(bound, query, category, contextMode);
        sendTo(ws, {
          type: "project_logs_state",
          requestId: requestId,
          entries: listing.entries,
          categories: listing.categories,
          contextMode: listing.contextMode,
          currentChangeSetId: listing.currentChangeSetId,
          isWorktree: listing.isWorktree === true,
          canDelete: bound.canDelete === true,
        });
        return true;
      }

      if (msg.type === "project_log_read") {
        sendTo(ws, { type: "project_log_entry", requestId: requestId, entry: bound.readLog({ ref: msg.ref }), canDelete: bound.canDelete === true });
        return true;
      }

      if (msg.type === "project_log_delete") {
        var removed = bound.removeLog({ ref: msg.ref });
        sendTo(ws, { type: "project_log_deleted", requestId: requestId, ref: removed.ref });
        broadcastUpdate(removed, "delete");
        return true;
      }

      if (msg.type === "project_log_comment") {
        var commented = bound.commentLog({ ref: msg.ref, body: msg.body });
        var reviewQueued = false;
        try { reviewQueued = onFeedback(commented) === true; } catch (deliveryError) {
          console.error("[project-logs] Failed to deliver comment:", deliveryError.message || deliveryError);
        }
        sendTo(ws, { type: "project_log_commented", requestId: requestId, entry: commented, reviewQueued: reviewQueued });
        return true;
      }

      if (msg.type === "scheduled_task_result_mark_read") {
        bound.markScheduledResultRead({ ref: msg.ref });
        broadcastScheduledResultState(ws);
        return true;
      }

      if (msg.type === "scheduled_task_result_open_session") {
        var resultEntry = bound.readLog({ ref: msg.ref });
        var resultMeta = resultEntry && resultEntry.scheduledResult;
        if (!resultMeta) throw new Error("Scheduled result not found.");
        var target = null;
        sm.sessions.forEach(function (session) {
          if (target || !session || session.sessionOriginId !== resultMeta.driverOriginId) return;
          var marker = session.scheduledTaskRun;
          if ((session.ownerId || null) === (resultMeta.ownerId || null) && marker && marker.role === "driver" && marker.runId === resultMeta.runId && marker.scheduleId === resultMeta.scheduleId) target = session;
        });
        if (!target) throw new Error("This scheduled session is no longer available.");
        sendTo(ws, { type: "scheduled_task_result_session", requestId: requestId, ref: resultEntry.ref, sessionId: target.localId });
        return true;
      }
    } catch (e) {
      fail(ws, requestId, (e && e.message) || "Project Logs could not complete the request.");
      return true;
    }

    return false;
  }

  // --- MCP surface ------------------------------------------------------

  function toolHandlers(bound) {
    if (!bound) return null;
    return {
      listLogs: function (args) { return bound.listLogs(args || {}); },
      searchLogs: function (args) { return bound.searchLogs(args || {}); },
      readLog: function (args) { return bound.readLog(args || {}); },
      logHistory: function (args) { return bound.logHistory(args || {}); },
      readLogRevision: function (args) { return bound.readLogRevision(args || {}); },
      listLogFeedback: function (args) { return bound.listLogFeedback(args || {}); },
      reviewLogComment: function (args) {
        var request = coerceToolArgs(args);
        var result = bound.reviewLogComment(request);
        broadcastCommentReview(result, request);
        // Only an incorporation is a canonical revision; clarify and decline
        // resolve a comment and change nothing.
        if (request && request.action === "incorporate") broadcastUpdate(result, "incorporate");
        return result;
      },
      revertLog: notifying("revert", function (args) { return bound.revertLog(args || {}); }),
      createLog: notifying("create", function (args) { return bound.createLog(coerceToolArgs(args)); }),
      updateLog: notifying("update", function (args) { return bound.updateLog(coerceToolArgs(args)); }),
      linkLog: notifying("link", function (args) { return bound.linkLog(coerceToolArgs(args)); }),
    };
  }

  // A Mate project advertises tools only when the registry confirms
  // authoritative builtin Clay, and then only the read-only cross-project set.
  function includeGlobal() {
    if (!isMate) return false;
    var projectBound = sessionBinding(null);
    return !!(projectBound && projectBound.isClay === true);
  }

  function getToolDefs(session) {
    if (!service) return [];
    if (isMate && !includeGlobal()) return [];
    var bound = session ? sessionBinding(session) : null;
    if (session && !bound) return [];
    return logsMcp.getToolDefs(toolHandlers(bound), isMate);
  }

  function createMcpServer(adapter, session) {
    if (!service) return null;
    if (isMate && !includeGlobal()) return null;
    if (!isMate && session && !sessionBinding(session)) {
      // A session that cannot bind still gets the fail-closed descriptor
      // rather than a silently missing server.
      return logsMcp.createMcpServer(adapter, null, false);
    }
    var bound = session ? sessionBinding(session) : null;
    return logsMcp.createMcpServer(adapter, toolHandlers(bound), isMate);
  }

  function getDynamicToolDefs(session) {
    return getToolDefs(session).map(function (tool) {
      tool.permissionName = "mcp__clay-logs__" + tool.name;
      return tool;
    });
  }

  function getBridgeTools(session, normalizeSchema) {
    if (!session) return [];
    var defs = getToolDefs(session);
    var tools = [];
    for (var i = 0; i < defs.length; i++) {
      tools.push({
        server: "clay-logs",
        name: defs[i].name,
        description: defs[i].description || defs[i].name,
        inputSchema: normalizeSchema(defs[i].inputSchema),
      });
    }
    return tools;
  }

  function callBridgeTool(session, toolName, args) {
    if (!session) return Promise.reject(new Error("Project Logs require a valid session."));
    var defs = getToolDefs(session);
    for (var i = 0; i < defs.length; i++) {
      if (defs[i].name === toolName) return Promise.resolve(defs[i].handler(args || {}));
    }
    return Promise.reject(new Error("Project Logs tool not found: " + toolName));
  }

  // A count only. The comment bodies stay in the tool, so a pending queue is
  // discoverable on the next turn without dumping the discussion into context
  // and without starting a turn of its own.
  function pendingFeedbackSignal(session) {
    if (!session) return "";
    var bound = sessionBinding(session);
    if (!bound || typeof bound.listLogFeedback !== "function") return "";
    var total = 0;
    try {
      total = bound.listLogFeedback({ limit: 1 }).total || 0;
    } catch (e) {
      return "";
    }
    if (!total) return "";
    return "\n" + total + (total === 1 ? " comment awaits" : " comments await") +
      " your review. Call list_log_feedback to see them.";
  }

  function getSystemPrompt(session) {
    if (!service) return "";
    if (isMate) {
      if (!includeGlobal() || (session && !sessionBinding(session))) return "";
      return SYSTEM_PROMPT_LABEL + "\n" + logsMcp.CLAY_READ_CONTRACT;
    }
    if (session && !sessionBinding(session)) return "";
    return SYSTEM_PROMPT_LABEL + "\n" + logsMcp.LOGS_CONTRACT +
      "\n" + logsMcp.LEARNING_CONTRACT +
      "\n" + logsMcp.ATTENTION_CONTRACT +
      "\n" + logsMcp.REVIEW_CONTRACT + pendingFeedbackSignal(session);
  }

  function recordScheduledResult(data) {
    if (!service || isMate) return null;
    var result = service.recordScheduledResult(Object.assign({}, data || {}, { projectSlug: slug }));
    if (!result || !result.entry || !result.created) return result;
    var clients = getClients();
    for (var client of clients) {
      if (!client || client.readyState !== 1 || client._clayPane) continue;
      if (result.entry.scheduledResult.ownerId && (!client._clayUser || client._clayUser.id !== result.entry.scheduledResult.ownerId)) continue;
      var bound = userBinding(client);
      if (!bound) continue;
      try { bound.readLog({ ref: result.entry.ref }); } catch (e) { continue; }
      sendTo(client, {
        type: "scheduled_task_result_created", ref: result.entry.ref,
        title: result.entry.title, summary: result.entry.summary,
        outcome: result.entry.scheduledResult.outcome,
      });
    }
    return result;
  }

  return {
    handleLogsMessage: handleLogsMessage,
    createMcpServer: createMcpServer,
    getToolDefs: getToolDefs,
    getDynamicToolDefs: getDynamicToolDefs,
    getBridgeTools: getBridgeTools,
    callBridgeTool: callBridgeTool,
    getSystemPrompt: getSystemPrompt,
    recordScheduledResult: recordScheduledResult,
    sendScheduledResultState: sendScheduledResultState,
  };
}

module.exports = {
  SYSTEM_PROMPT_LABEL: SYSTEM_PROMPT_LABEL,
  NOTIFYING_OPS: NOTIFYING_OPS,
  updateNotice: updateNotice,
  HANDLED_TYPES: HANDLED_TYPES,
  RETIRED_TYPES: RETIRED_TYPES,
  attachProjectLogs: attachProjectLogs,
  coerceToolArgs: coerceToolArgs,
};
