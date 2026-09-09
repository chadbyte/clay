var yoke = require("./yoke");
var contextBuilder = require("./session-handoff-context");
var sessionHandoffMcp = require("./session-handoff-mcp-server");

var MAX_HANDOFF_CHAIN_DEPTH = 5;

function toolResult(text) {
  return Promise.resolve({ content: [{ type: "text", text: text }] });
}

function toolError(message) {
  return Promise.resolve({
    content: [{ type: "text", text: "Error: " + message }],
    isError: true,
  });
}

function hasUserContext(session) {
  var history = (session && session.history) || [];
  for (var i = 0; i < history.length; i++) {
    if (history[i] && history[i].type === "user_message" && history[i].text) return true;
    if (history[i] && history[i].type === "handoff_context" && history[i].request) return true;
  }
  return false;
}

function attachSessionHandoff(ctx) {
  var sm = ctx.sm;

  function sendResult(ws, ok, details) {
    ctx.sendTo(ws, Object.assign({ type: "session_handoff_result", ok: ok }, details || {}));
  }

  function validate(ws, source, targetVendor) {
    if (ctx.isMate) throw new Error("Session handoff is only available in projects.");
    if (!source) throw new Error("No active session was found.");
    if (ctx.splitStore && ctx.splitStore.groupForMember(source.localId)) {
      throw new Error("Open the session by itself before continuing it in another agent.");
    }
    if (source.isProcessing || source._queryStarting) {
      throw new Error("Wait for the current response to finish before continuing in another agent.");
    }
    if (!hasUserContext(source)) throw new Error("This session does not have any conversation to continue.");
    if (!targetVendor) throw new Error("Choose an agent for the handoff.");
    if (!ctx.adapters[targetVendor] || (sm.installedVendors || []).indexOf(targetVendor) === -1) {
      throw new Error("The selected coding agent is not installed.");
    }
    var linuxUser = ctx.getLinuxUserForSession(source);
    var vendorInfo = yoke.getVendorInfo(targetVendor);
    if (linuxUser && vendorInfo && vendorInfo.osUserIsolation === false) {
      throw new Error((vendorInfo.displayName || targetVendor) + " is not available for OS-isolated users.");
    }
    var ownerId = ws._clayUser && ctx.usersModule.isMultiUser() ? ws._clayUser.id : null;
    if ((source.ownerId || null) !== ownerId) throw new Error("Session access denied.");
    return { linuxUser: linuxUser, vendorInfo: vendorInfo };
  }

  function quietRecord(session, entry) {
    session.history.push(entry);
    sm.appendToSessionFile(session, entry);
  }

  function handoff(ws, msg) {
    var source = sm.sessions.get(ws._clayActiveSession) || null;
    var targetVendor = typeof msg.targetVendor === "string" ? msg.targetVendor.trim() : "";
    var targetModel = typeof msg.model === "string" ? msg.model.trim() : "";
    var validation;
    try {
      validation = validate(ws, source, targetVendor);
    } catch (err) {
      sendResult(ws, false, { error: err.message || String(err) });
      return;
    }

    var targetEffort = yoke.clampEffort(
      targetVendor,
      msg.effort || (sm.currentEffortByVendor && sm.currentEffortByVendor[targetVendor]) || sm.currentEffort || "medium"
    ) || null;
    var target = sm.createSessionRaw({
      ownerId: source.ownerId || null,
      sessionVisibility: "private",
      vendor: targetVendor,
      model: targetModel || null,
      effort: targetEffort,
    });
    var targetName = (yoke.getVendorInfo(targetVendor) || {}).displayName || targetVendor;
    target.title = (source.title || "Continued session") + " · " + targetName;
    target.handoff = {
      sourceSessionId: source.localId,
      sourceVendor: source.vendor || sm.defaultVendor || "claude",
      createdAt: Date.now(),
      mode: "context",
      sourceHistoryIndex: source.history.length,
    };

    var sourceEntry = {
      type: "handoff_created",
      targetSessionId: target.localId,
      targetVendor: targetVendor,
      targetTitle: target.title,
      _ts: Date.now(),
    };
    var targetEntry = {
      type: "handoff_context",
      sourceSessionId: source.localId,
      sourceVendor: target.handoff.sourceVendor,
      sourceTitle: source.title || "Untitled session",
      targetVendor: targetVendor,
      request: contextBuilder.latestUserRequest(source.history),
      _ts: Date.now(),
    };
    quietRecord(source, sourceEntry);
    quietRecord(target, targetEntry);

    var prompt = contextBuilder.buildHandoffContext({
      cwd: ctx.cwd,
      source: source,
      targetVendor: targetVendor,
      sourceReadTool: (validation.vendorInfo || {}).sessionBoundTools !== false,
    });
    target.isProcessing = true;
    target.lastActivity = Date.now();
    target.sentToolResults = {};
    sm.switchSession(target.localId, ws);
    if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
    sendResult(ws, true, {
      sourceSessionId: source.localId,
      targetSessionId: target.localId,
      targetVendor: targetVendor,
    });

    var sdk = ctx.getSdk();
    function failStart(err) {
      target.isProcessing = false;
      sm.sendAndRecord(target, { type: "error", text: "Could not start the handoff session: " + (err.message || String(err)) });
      if (typeof ctx.onProcessingChanged === "function") ctx.onProcessingChanged();
      sm.broadcastSessionList();
    }
    if (!sdk || typeof sdk.startQuery !== "function") {
      failStart(new Error("SDK bridge is not ready."));
      return;
    }
    target._queryStartTs = Date.now();
    var startPromise;
    try {
      startPromise = sdk.startQuery(target, prompt, undefined, validation.linuxUser);
    } catch (err) {
      failStart(err);
      return;
    }
    Promise.resolve(startPromise).catch(failStart);
  }

  function handleMessage(ws, msg) {
    if (msg.type === "handoff_session_options") {
      ctx.sendTo(ws, {
        type: "handoff_session_options",
        installedVendors: sm.installedVendors || [],
        modelsByVendor: sm.modelsByVendor || {},
        capabilitiesByVendor: sm.capabilitiesByVendor || {},
      });
      return true;
    }
    if (msg.type === "handoff_session") {
      handoff(ws, msg);
      return true;
    }
    return false;
  }

  function resolveSourceChain(boundSession) {
    var chain = [];
    var visited = new Set();
    var sourceSessionId = boundSession.handoff.sourceSessionId;
    var ownerId = boundSession.ownerId || null;
    for (var depth = 0; depth < MAX_HANDOFF_CHAIN_DEPTH; depth++) {
      var visitKey = String(sourceSessionId);
      if (visited.has(visitKey)) break;
      visited.add(visitKey);
      var source = sm.sessions.get(sourceSessionId);
      if (!source) return { error: "Source session was not found: " + sourceSessionId };
      if ((source.ownerId || null) !== ownerId) return { error: "Source session owner does not match this session" };
      chain.push(source);
      if (!source.handoff || source.handoff.sourceSessionId === undefined || source.handoff.sourceSessionId === null) break;
      sourceSessionId = source.handoff.sourceSessionId;
    }
    return { chain: chain };
  }

  function findSource(chain, requestedId) {
    if (requestedId === undefined || requestedId === null || requestedId === "") return chain[0] || null;
    for (var i = 0; i < chain.length; i++) {
      if (String(chain[i].localId) === String(requestedId)) return chain[i];
    }
    return null;
  }

  function boundedInteger(value, fallback, min, max) {
    if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
    return Math.min(max, Math.max(min, Math.floor(value)));
  }

  function formatHistory(source, args) {
    var history = Array.isArray(source.history) ? source.history : [];
    var limit = boundedInteger(args.limit, 30, 1, 100);
    var offset = typeof args.offset === "number" && Number.isFinite(args.offset)
      ? boundedInteger(args.offset, 0, 0, history.length)
      : Math.max(0, history.length - limit);
    var slice = history.slice(offset, offset + limit);
    var end = offset + slice.length;
    var out = [];
    out.push("# " + (source.title || "Untitled session") + " — " + (source.vendor || "unknown") + "/" + source.localId);
    out.push("Showing entries " + (slice.length ? offset + 1 : 0) + "-" + end + " of " + history.length + "\n");
    for (var i = 0; i < slice.length; i++) {
      var entry = slice[i];
      if (!entry) continue;
      var label;
      var text = "";
      if (entry.type === "user_message") {
        label = "USER";
        text = entry.text || "";
      } else if (entry.type === "delta") {
        label = "ASSISTANT";
        text = entry.text || "";
      } else if (entry.type === "tool_executing" || entry.type === "tool_result") {
        label = "TOOL";
        text = (entry.name || "") + (entry.input ? " " + JSON.stringify(entry.input).substring(0, 120) : "");
      } else {
        continue;
      }
      if (text.length > 800) text = text.substring(0, 800) + "...";
      out.push("[" + label + "] " + text);
    }
    return out.join("\n");
  }

  function readHandoffSource(args, boundSession) {
    if (!boundSession) return toolError("read_handoff_source requires a session-bound tool server");
    if (!boundSession.handoff) return toolError("this session does not have a handoff source");
    var resolved = resolveSourceChain(boundSession);
    if (resolved.error) return toolError(resolved.error);
    var source = findSource(resolved.chain, args.sourceSessionId);
    if (!source) return toolError("sourceSessionId is not in this session's handoff chain");
    return toolResult(formatHistory(source, args));
  }

  function getToolDefs(boundSession) {
    if (ctx.isMate) return [];
    if (boundSession && !boundSession.handoff) return [];
    return sessionHandoffMcp.getToolDefs({
      read: function (args) { return readHandoffSource(args, boundSession || null); },
    });
  }

  function createMcpServer(adapter, boundSession) {
    if (ctx.isMate || !adapter || typeof adapter.createToolServer !== "function") return null;
    var tools = getToolDefs(boundSession || null);
    if (tools.length === 0) return null;
    return adapter.createToolServer({
      name: "clay-handoff",
      version: "1.0.0",
      tools: tools,
    });
  }

  function getSystemPrompt() {
    return "";
  }

  return {
    createMcpServer: createMcpServer,
    getSystemPrompt: getSystemPrompt,
    getToolDefs: getToolDefs,
    handleMessage: handleMessage,
  };
}

module.exports = {
  attachSessionHandoff: attachSessionHandoff,
  hasUserContext: hasUserContext,
};
