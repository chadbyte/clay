// Server-owned entry from global search into a fresh builtin Clay session.

function attachHomeClayEntry(ctx) {
  function providerPrompt(text) {
    return "This conversation began in Clay Studio's global search. Respond as Clay. When the user is trying to locate a conversation, use search_workspace_history before any other investigation. When the user asks about a project's prior work, decisions, defects, status, rationale, or unfinished work, identify the project and search_project_logs before answering; use conversation history as additional evidence when useful. Search by meaning, related terms, and context, using at most three focused search passes. Do not use Bash, filesystem scans, or generic agents to search Clay history. Give the user useful findings promptly, and do not mention tools or internal search mechanics. Do not force a workspace or Logs search when the request is a general question or task.\n\nUser request:\n" + text;
  }

  function findExisting(manager, userId, requestId) {
    var match = null;
    if (!requestId) return null;
    manager.sessions.forEach(function (session) {
      if (!match && ctx.ownsSession(session, userId) && session.homeClayEntryRequestId === requestId) match = session;
    });
    return match;
  }

  async function start(ws, userId, msg) {
    var text = typeof msg.text === "string" ? msg.text.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 12000) : "";
    var requestId = typeof msg.requestId === "string" ? msg.requestId.slice(0, 240) : null;
    var found = ctx.findMateProject(userId, null, true);
    if (!found || found.mate.builtinKey !== "clay") {
      ctx.sendError(ws, null, "Clay is not available.", requestId, null, "mate_unavailable");
      return;
    }
    if (!text || !requestId) {
      ctx.sendError(ws, found.mate.id, "Enter something for Clay to find.", requestId, null, "invalid_request");
      return;
    }
    var manager = found.ctx.getSessionManager();
    if (!manager || typeof manager.sendAndRecord !== "function") {
      ctx.sendError(ws, found.mate.id, "Conversation history is unavailable.", requestId, null, "session_unavailable");
      return;
    }
    var existing = findExisting(manager, userId, requestId);
    if (existing) {
      ctx.setupSearchTap(ws, found, existing.localId, requestId);
      ctx.sendHistory(ws, found, existing, requestId);
      ctx.sendSessionList(ws, found, userId);
      return;
    }
    var session = null;
    try {
      var resolved = await ctx.homeModels.resolveMateModel(ws, found, userId);
      if (ctx.isActorLive && !ctx.isActorLive(ws, userId)) throw new Error("Your account is no longer available.");
      var liveFound = ctx.findMateProject(userId, null, true);
      if (!liveFound || liveFound.ctx !== found.ctx || !liveFound.mate || liveFound.mate.builtinKey !== "clay") throw new Error("Clay is no longer available.");
      session = manager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model, effort: resolved.effort || null }, null);
      session.homeClayEntryRequestId = requestId;
      session.homeClayEntryMode = "search";
      manager.sendAndRecord(session, { type: "user_message", text: text });
      session.isProcessing = true;
      session.sentToolResults = {};
      if (typeof manager.saveSessionFile === "function") manager.saveSessionFile(session);
      ctx.setupSearchTap(ws, found, session.localId, requestId);
      ctx.sendHistory(ws, found, session, requestId);
      ctx.sendSessionList(ws, found, userId);
      if (!found.ctx.sdk) throw new Error("Clay SDK bridge unavailable.");
      found.ctx.sdk.startQuery(session, providerPrompt(text), null, null);
    } catch (error) {
      if (session) session.isProcessing = false;
      ctx.sendModelError(ws, found, msg, error, session ? ctx.sessionReference(session) : null);
    }
  }

  return { start: start };
}

module.exports = { attachHomeClayEntry: attachHomeClayEntry };
