const crypto = require("crypto");
var fs = require("fs");
var path = require("path");
var execSync = require("child_process").execSync;
var execFileSync = require("child_process").execFileSync;
var usersModule = require("./users");
var { getCodexConfig } = require("./codex-defaults");
var { getKiroConfig } = require("./kiro-defaults");
var { splitShellSegments, attachSkillDiscovery } = require("./sdk-skill-discovery");
var { isSafeBashSegment } = require("./safe-bash-commands");
var { createMessageQueue } = require("./sdk-message-queue");
var { attachMessageProcessor } = require("./sdk-message-processor");
var homeDebateToolPolicy = require("./home-debate-tool-policy");
var yoke = require("./yoke");
var sessionTitlePolicy = require("./session-title-policy");

// Extract serializable tool descriptors from MCP server instances.
// Used for IPC to worker processes (McpSdkServerConfigWithInstance is not serializable).
function extractMcpDescriptors(mcpServers) {
  if (!mcpServers) return null;
  var toJSONSchema;
  try { toJSONSchema = require("zod").toJSONSchema; } catch (e) { return null; }
  var descriptors = [];
  var names = Object.keys(mcpServers);
  for (var i = 0; i < names.length; i++) {
    var serverName = names[i];
    var server = mcpServers[serverName];
    if (!server || !server.instance || !server.instance._registeredTools) continue;
    var tools = [];
    var toolNames = Object.keys(server.instance._registeredTools);
    for (var j = 0; j < toolNames.length; j++) {
      var toolName = toolNames[j];
      var toolDef = server.instance._registeredTools[toolName];
      var inputSchema = { type: "object", properties: {} };
      try {
        if (toolDef.inputSchema) inputSchema = toJSONSchema(toolDef.inputSchema);
      } catch (e) { /* fallback to empty schema */ }
      tools.push({
        name: toolName,
        description: toolDef.description || toolName,
        inputSchema: inputSchema,
      });
    }
    if (tools.length > 0) descriptors.push({ serverName: serverName, tools: tools });
  }
  return descriptors.length > 0 ? descriptors : null;
}

// Call an MCP tool handler by server name and tool name.
// Returns a promise that resolves with the tool result.
function callMcpToolHandler(mcpServers, serverName, toolName, args) {
  if (!mcpServers || !mcpServers[serverName]) {
    return Promise.reject(new Error("MCP server not found: " + serverName));
  }
  var server = mcpServers[serverName];
  if (!server.instance || !server.instance._registeredTools || !server.instance._registeredTools[toolName]) {
    return Promise.reject(new Error("MCP tool not found: " + serverName + "/" + toolName));
  }
  var handler = server.instance._registeredTools[toolName].handler;
  if (typeof handler !== "function") {
    return Promise.reject(new Error("MCP tool handler not a function: " + serverName + "/" + toolName));
  }
  try {
    return Promise.resolve(handler(args));
  } catch (e) {
    return Promise.reject(e);
  }
}

// Merge in-process MCP servers with remote (extension-bridged) MCP servers.
// Returns the merged object, or null if no servers exist.
function mergeMcpServers(localServers, getRemoteFn) {
  var merged = {};
  var hasAny = false;
  if (localServers) {
    var lk = Object.keys(localServers);
    for (var i = 0; i < lk.length; i++) {
      merged[lk[i]] = localServers[lk[i]];
      hasAny = true;
    }
    console.log("[mergeMcpServers] local servers:", lk.join(", ") || "(none)");
  } else {
    console.log("[mergeMcpServers] local servers: null");
  }
  if (typeof getRemoteFn === "function") {
    var remote = getRemoteFn();
    if (remote) {
      var rk = Object.keys(remote);
      console.log("[mergeMcpServers] remote servers:", rk.join(", ") || "(none)");
      for (var j = 0; j < rk.length; j++) {
        merged[rk[j]] = remote[rk[j]];
        hasAny = true;
      }
    } else {
      console.log("[mergeMcpServers] remote servers: null/empty");
    }
  } else {
    console.log("[mergeMcpServers] getRemoteFn not a function");
  }
  console.log("[mergeMcpServers] merged result:", Object.keys(merged).join(", ") || "(none)");
  return hasAny ? merged : null;
}

function createSDKBridge(opts) {
  var cwd = opts.cwd;
  var slug = opts.slug || "";
  var sm = opts.sessionManager;   // session manager instance
  var send = opts.send;           // broadcast to all clients
  var pushModule = opts.pushModule;
  var getNotificationsModule = opts.getNotificationsModule || function () { return null; };
  var adapter = opts.adapter;
  var adapters = opts.adapters || {};
  var getRuntimeEnv = opts.getRuntimeEnv || function () { return process.env; };
  var mateDisplayName = opts.mateDisplayName || "";
  var isMate = opts.isMate || (slug.indexOf("mate-") === 0);
  var osUsers = !!opts.osUsers;
  var dangerouslySkipPermissions = opts.dangerouslySkipPermissions || false;
  // mcpServers may be either a static object or a getter function. The
  // getter form lets callers gate individual servers at call time (e.g.
  // clay-browser is only exposed while the Chrome extension is connected)
  // and bind session-scoped servers (clay-sessions) to the querying session.
  var _mcpServersSrc = opts.mcpServers || null;
  function getMcpServers(forSession) {
    if (typeof _mcpServersSrc === "function") return _mcpServersSrc(forSession) || null;
    return _mcpServersSrc;
  }
  var getRemoteMcpServers = opts.getRemoteMcpServers || null;
  var clayPort = opts.clayPort || 2633;
  var clayTls = opts.clayTls || false;
  var clayAuthToken = opts.clayAuthToken || null;
  var getSessionToolDefs = opts.getSessionToolDefs || function () { return []; };
  // Split Worker permission routing. A getter because the pair module is
  // constructed before this bridge exists.
  var getWorkerPermissionRouter = opts.getWorkerPermissionRouter || function () { return null; };
  var onProcessingChanged = opts.onProcessingChanged || function () {};
  var _cachedFreshAuthState = null;
  var _cachedFreshAuthAt = 0;

  function getAcpMcpServers(session) {
    if (!session) return [];
    var bridgeArgs = [
      path.join(__dirname, "yoke", "mcp-bridge-server.js"),
      "--port", String(clayPort),
      "--slug", slug,
      "--session", String(session.localId),
      "--session-only",
    ];
    if (clayTls) bridgeArgs.push("--tls");
    var env = [];
    if (clayAuthToken) env.push({ name: "CLAY_AUTH_TOKEN", value: clayAuthToken });
    return [{
      name: "clay-tools",
      command: process.execPath,
      args: bridgeArgs,
      env: env,
    }];
  }

  function getFreshAuthState(force) {
    var now = Date.now();
    if (!force && _cachedFreshAuthState && now - _cachedFreshAuthAt < 15000) {
      return _cachedFreshAuthState;
    }
    if (force) yoke.invalidateAuthCache();
    _cachedFreshAuthState = yoke.checkAuth();
    _cachedFreshAuthAt = now;
    return _cachedFreshAuthState;
  }

  function isAuthErrorMessage(errDetail) {
    if (!errDetail) return false;
    var errLower = String(errDetail).toLowerCase();
    return errLower.indexOf("not logged in") !== -1
      || errLower.indexOf("unauthenticated") !== -1
      || errLower.indexOf("authentication") !== -1
      || errLower.indexOf("sign in") !== -1
      || errLower.indexOf("log in") !== -1
      || errLower.indexOf("please login") !== -1;
  }

  function getLoginCommand(vendor) {
    var info = yoke.getVendorInfo(vendor);
    return (info && info.loginCommand) || "claude login";
  }

  function supportsOsUserIsolation(vendor) {
    var info = yoke.getVendorInfo(vendor);
    return !info || info.osUserIsolation !== false;
  }

  function notifyAuthRequired(session, title, body, authLinuxUser, canAutoLogin, loginCommand) {
    var _nm = getNotificationsModule();
    if (!_nm) return false;
    _nm.notify("auth_required", {
      title: title,
      body: body,
      slug: slug,
      sessionId: session.localId,
      ownerId: session.ownerId || null,
      vendor: session.vendor || (adapter && adapter.vendor) || "claude",
      loginCommand: loginCommand,
      linuxUser: authLinuxUser,
      canAutoLogin: canAutoLogin,
    });
    return true;
  }

  function logAuthDecision(stage, session, errDetail, authState) {
    var vendor = session && session.vendor ? session.vendor : "(none)";
    var errSnippet = errDetail ? String(errDetail).replace(/\s+/g, " ").slice(0, 180) : "";
    var authSummary = authState ? JSON.stringify(authState) : "(none)";
    console.warn("[sdk-bridge] auth decision [" + stage + "] vendor=" + vendor + " auth=" + authSummary + (errSnippet ? " err=" + errSnippet : ""));
  }

  function getModelsForVendor(vendor) {
    if (vendor && sm.modelsByVendor && sm.modelsByVendor[vendor]) return sm.modelsByVendor[vendor];
    return sm.availableModels || [];
  }

  // Model list entries may be plain strings (Codex) or { value, displayName }
  // objects (Claude SDK). Normalize to the identifier string.
  function modelEntryValue(entry) {
    if (!entry) return "";
    if (typeof entry === "string") return entry;
    return entry.value || entry.id || "";
  }

  function modelListContains(list, modelId) {
    if (!list || !modelId) return false;
    for (var mi = 0; mi < list.length; mi++) {
      if (modelEntryValue(list[mi]) === modelId) return true;
    }
    return false;
  }

  // Resolve a shorthand model name (e.g. "opus[1m]") to its full ID
  // in the vendor model list (e.g. "claude-opus-4.6[1m]").
  function resolveModelInList(list, modelId) {
    if (!list || !modelId) return null;
    var lc = modelId.toLowerCase();
    for (var mi = 0; mi < list.length; mi++) {
      var val = modelEntryValue(list[mi]);
      if (val === modelId) return val;
    }
    for (var mi = 0; mi < list.length; mi++) {
      var val = modelEntryValue(list[mi]);
      if (!val || val === "default") continue;
      var vlc = val.toLowerCase();
      if (vlc.indexOf(lc) !== -1 || lc.indexOf(vlc) !== -1) return val;
    }
    return null;
  }

  function defaultModelForVendor(vendor) {
    return (sm.defaultModelByVendor && sm.defaultModelByVendor[vendor]) || "";
  }

  function sendModelInfoForVendor(session, vendor, model) {
    var resolvedVendor = vendor || (adapter && adapter.vendor) || "claude";
    var message = {
      type: "model_info",
      model: model || "",
      models: getModelsForVendor(resolvedVendor),
      vendor: resolvedVendor,
      sessionId: session ? session.localId : null,
      capabilities: (sm.capabilitiesByVendor && sm.capabilitiesByVendor[resolvedVendor]) || {},
      availableVendors: sm.availableVendors || [],
      installedVendors: sm.installedVendors || [],
    };
    if (session) sendToSession(session, message);
    else send(message);
  }

  function rememberAdapterReady(vendor, result) {
    if (!vendor || !result) return;
    sm.modelsByVendor = sm.modelsByVendor || {};
    sm.capabilitiesByVendor = sm.capabilitiesByVendor || {};
    if (Array.isArray(result.models)) sm.modelsByVendor[vendor] = result.models;
    sm.capabilitiesByVendor[vendor] = result.capabilities || {};
  }
  var onTurnDone = opts.onTurnDone || null;

  // --- Idle session reaper ---
  // In single-user (in-process) mode, each session's Claude child process stays
  // alive between turns because the messageQueue push-stream is never ended.
  // Without a reaper, processes accumulate indefinitely as users switch between
  // sessions and projects. This reaper ends the messageQueue for sessions that
  // have been idle for IDLE_TIMEOUT_MS, allowing processQueryStream's finally
  // block to clean up the child process. Session state on disk is preserved —
  // the next startQuery() call resumes with a fresh process.
  var IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
  var IDLE_CHECK_INTERVAL_MS = 60 * 1000; // check every 60 seconds
  var _idleReaperTimer = null;

  function startIdleReaper() {
    if (_idleReaperTimer) return;
    _idleReaperTimer = setInterval(function () {
      var now = Date.now();
      sm.sessions.forEach(function (session) {
        // Skip sessions that are actively processing, have no query,
        // or are single-turn (Ralph Loop — managed by onQueryComplete).
        if (session.isProcessing) return;
        if (!session.queryInstance) return;
        if (session.singleTurn) return;
        if (session.destroying) return;

        var lastActivity = session.lastActivityAt || 0;
        if (now - lastActivity > IDLE_TIMEOUT_MS) {
          console.log("[sdk-bridge] Reaping idle session " + session.localId +
            " (idle " + Math.round((now - lastActivity) / 60000) + "min)" +
            (session.title ? " title=" + JSON.stringify(session.title) : ""));
          // End the query so the for-await loop in processQueryStream
          // exits naturally, triggering the finally block cleanup.
          // Works for both in-process (messageQueue.end) and worker (handle.close) paths.
          if (session.queryInstance && typeof session.queryInstance.close === "function") {
            try { session.queryInstance.close(); } catch (e) {}
          } else if (session.messageQueue && typeof session.messageQueue.end === "function") {
            try { session.messageQueue.end(); } catch (e) {}
          }
        }
      });
    }, IDLE_CHECK_INTERVAL_MS);
    // Don't prevent process exit
    if (_idleReaperTimer.unref) _idleReaperTimer.unref();
  }

  function stopIdleReaper() {
    if (_idleReaperTimer) {
      clearInterval(_idleReaperTimer);
      _idleReaperTimer = null;
    }
  }

  // --- Skill discovery (extracted to sdk-skill-discovery.js) ---
  var skills = attachSkillDiscovery({ cwd: cwd });
  var discoverSkillDirs = skills.discoverSkillDirs;
  var mergeSkills = skills.mergeSkills;

  // --- Message processing (extracted to sdk-message-processor.js) ---
  function getSessionLinuxUser(session) {
    if (!osUsers || !session) return null;
    if (session.lastLinuxUser) return session.lastLinuxUser;
    if (!session.ownerId) return null;
    var owner = usersModule.findUserById(session.ownerId);
    return owner && owner.linuxUser ? owner.linuxUser : null;
  }

  // Auto-generate a session title via YOKE adapter.generateTitle().
  // Triggered by sdk-message-processor after AUTO_TITLE_TURN_THRESHOLD turns.
  function autoGenerateTitle(session) {
    var sessionAdapter = getAdapterForSession(session);
    if (typeof sessionAdapter.generateTitle !== "function") {
      console.log("[auto-title] adapter.generateTitle not available for vendor=" + sessionAdapter.vendor);
      return;
    }
    var userMessages = [];
    for (var i = 0; i < session.history.length; i++) {
      var entry = session.history[i];
      if (entry.type === "user_message" && entry.text) {
        userMessages.push(entry.text.substring(0, 200));
        if (userMessages.length >= 5) break;
      }
    }
    if (userMessages.length === 0) {
      console.log("[auto-title] No user messages found in session " + session.localId);
      return;
    }
    console.log("[auto-title] Calling adapter.generateTitle with " + userMessages.length + " messages for session " + session.localId);

    sessionAdapter.generateTitle(userMessages, {
      cwd: cwd,
      linuxUser: getSessionLinuxUser(session) || undefined,
      env: getRuntimeEnv(session),
    }).then(function(title) {
      if (!title || title.length < 2) return;
      title = title.substring(0, 100);
      if (!session.titleManuallySet) {
        session.title = title;
        session.titleAutoGenerated = true;
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
        if (session.cliSessionId && typeof adapter.renameSession === "function") {
          adapter.renameSession(session.cliSessionId, title, { dir: cwd }).catch(function () {});
        }
        console.log("[auto-title] Generated title for session " + session.localId + ": " + title);
      }
    }).catch(function(e) {
      console.error("[auto-title] Failed:", e.message || e);
    });
  }

  var msgProcessor = attachMessageProcessor({
    sm: sm,
    send: send,
    slug: slug,
    cwd: cwd,
    isMate: isMate,
    mateDisplayName: mateDisplayName,
    pushModule: pushModule,
    getNotificationsModule: getNotificationsModule,
    shouldSuppressResponseNotification: opts.shouldSuppressResponseNotification,
    adapter: adapter,
    saveImageFile: opts.saveImageFile,
    getSessionLinuxUser: getSessionLinuxUser,
    onProcessingChanged: onProcessingChanged,
    onTurnDone: onTurnDone,
    onAutoTitle: function (session) { autoGenerateTitle(session); },
    opts: opts,
    discoverSkillDirs: discoverSkillDirs,
    mergeSkills: mergeSkills,
  });
  var processSDKMessage = msgProcessor.processSDKMessage;
  var sendAndRecord = msgProcessor.sendAndRecord;
  var sendToSession = msgProcessor.sendToSession;

  // --- MCP elicitation ---

  function handleElicitation(session, request, opts) {
    // Ralph Loop: auto-reject elicitation in autonomous mode
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      return Promise.resolve({ action: "reject" });
    }

    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      if (!session.pendingElicitations) session.pendingElicitations = {};
      session.pendingElicitations[requestId] = {
        resolve: resolve,
        request: request,
      };
      sendAndRecord(session, {
        type: "elicitation_request",
        requestId: requestId,
        serverName: request.serverName,
        message: request.message,
        mode: request.mode || "form",
        url: request.url || null,
        elicitationId: request.elicitationId || null,
        requestedSchema: request.requestedSchema || null,
      });

      if (pushModule) {
        pushModule.sendPush({
          type: "elicitation",
          slug: slug,
          title: (request.serverName || "MCP Server") + " needs input",
          body: request.message || "Waiting for your response",
          tag: "claude-elicitation",
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingElicitations[requestId];
          resolve({ action: "reject" });
        });
      }
    });
  }

  // --- Host user dialog ---
  // Mirrors handleElicitation: the adapter invokes onUserDialog with an opaque
  // { dialogKind, payload }, we forward a user_dialog_request to the client, and
  // resolve once the client answers. Which dialog kinds exist is the adapter's
  // concern; the relay just transports them. Unknown kinds / autonomous mode
  // resolve to { behavior: "cancelled" } (the no-dialog default).

  function handleUserDialog(session, request, opts) {
    // Ralph Loop: auto-cancel host dialogs in autonomous mode (CLI falls back
    // to the no-dialog default, e.g. the classic refusal error).
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      return Promise.resolve({ behavior: "cancelled" });
    }

    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      if (!session.pendingUserDialogs) session.pendingUserDialogs = {};
      session.pendingUserDialogs[requestId] = {
        resolve: resolve,
        request: request,
      };
      sendAndRecord(session, {
        type: "user_dialog_request",
        requestId: requestId,
        dialogKind: request.dialogKind,
        payload: request.payload || {},
        toolUseId: request.toolUseID || null,
      });

      if (pushModule) {
        pushModule.sendPush({
          type: "user_dialog",
          slug: slug,
          title: "Claude needs a decision",
          body: "Waiting for your response",
          tag: "claude-user-dialog",
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingUserDialogs[requestId];
          resolve({ behavior: "cancelled" });
        });
      }
    });
  }


  // --- Linux user project directory setup ---
  // Ensures the linux user's .claude project directory exists and is writable,
  // then pre-copies CLI session file if needed. Called before starting a query
  // so the worker can resume from the correct session file.
  function ensureLinuxUserProjectDir(linuxUser, session) {
    try {
      var configMod = require("./config");
      var osUsersMod = require("./os-users");
      var originalHome = configMod.REAL_HOME || require("os").homedir();
      var linuxUserHome = osUsersMod.getLinuxUserHome(linuxUser);
      var uid = osUsersMod.getLinuxUserUid(linuxUser);
      if (originalHome !== linuxUserHome && uid != null) {
        var projectSlug = (cwd || "").replace(/\//g, "-");
        var dstDir = path.join(linuxUserHome, ".claude", "projects", projectSlug);
        // Create and chown the project directory once
        if (!fs.existsSync(dstDir)) {
          fs.mkdirSync(dstDir, { recursive: true });
          try { execFileSync("chown", ["-R", String(uid), path.join(linuxUserHome, ".claude")]); } catch (e2) {}
        } else {
          try {
            var dirStat = fs.statSync(dstDir);
            if (dirStat.uid !== uid) {
              execFileSync("chown", [String(uid), dstDir]);
            }
          } catch (e2) {}
        }
        // Pre-copy CLI session file so the worker can resume the conversation
        if (session.cliSessionId) {
          var sessionFileName = session.cliSessionId + ".jsonl";
          var srcFile = path.join(originalHome, ".claude", "projects", projectSlug, sessionFileName);
          var dstFile = path.join(dstDir, sessionFileName);
          if (fs.existsSync(srcFile) && !fs.existsSync(dstFile)) {
            fs.copyFileSync(srcFile, dstFile);
            try { execFileSync("chown", [String(uid), dstFile]); } catch (e2) {}
            console.log("[sdk-bridge] Pre-copied CLI session " + session.cliSessionId + " to " + linuxUser);
          }
        }
      }
    } catch (copyErr) {
      console.log("[sdk-bridge] Dir setup / session pre-copy skipped:", copyErr.message);
    }
  }

  // --- SDK query lifecycle ---

  // Check if a tool should be auto-approved based on whitelist rules.
  // Returns { behavior: "allow", updatedInput } if whitelisted, or null if not.
  // Shared by handleCanUseTool and mate mention canUseTool handlers.
  function checkToolWhitelist(toolName, input) {
    // Auto-approve read-only tools for ALL sessions.
    // These tools only inspect files and fetch data — no side effects.
    var readOnlyTools = { Read: true, Glob: true, Grep: true, WebFetch: true, WebSearch: true };
    if (readOnlyTools[toolName]) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-approve safe browser MCP tools.
    // Only watch/unwatch: user explicitly chose which tab to share.
    // Everything else (screenshot, read_page, list_tabs, etc.) can expose
    // content from tabs the user didn't intend to share, so require approval.
    var safeBrowserTools = { browser_watch_tab: true, browser_unwatch_tab: true };
    if (toolName.indexOf("mcp__") === 0 && toolName.indexOf("__browser_") !== -1) {
      var mcpToolName = toolName.substring(toolName.lastIndexOf("__") + 2);
      if (safeBrowserTools[mcpToolName]) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    // Auto-approve debate MCP tools (propose_debate).
    // These are user-facing tools that show inline approval cards,
    // so the permission prompt is redundant.
    if (toolName.indexOf("mcp__clay-debate__") === 0) {
      return { behavior: "allow", updatedInput: input };
    }
    if (toolName.indexOf("mcp__clay-mate-creation__") === 0) {
      return { behavior: "allow", updatedInput: input };
    }
    // Structured user input only presents a question and waits for the user's
    // answer. Yoke may expose the same query-bound capability as a native
    // dynamic tool, its MCP fallback, or the legacy Clay MCP name.
    if (toolName === "ask_user_questions"
        || toolName === "mcp__yoke-user-input__ask_user_questions"
        || toolName === "mcp__clay-ask-user__ask_user_questions") {
      return { behavior: "allow", updatedInput: input };
    }

    var safeCapsuleTools = {
      clay_tool_list: true,
      clay_tool_snapshot: true,
      clay_tool_act: true,
      clay_tool_set: true,
      clay_tool_source: true,
    };
    if (toolName.indexOf("mcp__clay-tools__") === 0
        && safeCapsuleTools[toolName.substring(toolName.lastIndexOf("__") + 2)]) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-approve the non-mutating configuration proposal and the visible
    // Driver/Split Worker pair tools, including the Driver's answer to a Worker
    // permission request. Creation and replacement still require a separate
    // human decision in the proposal card; skip-permissions is never treated as
    // that product choice. Every handler is confined to the caller's exact
    // session/pair and re-checks eligibility, ownership and live identity.
    //
    // spawn_sessions is deliberately absent: it creates arbitrary sessions.
    //
    // Only the two name forms the bridge can genuinely emit are accepted:
    //
    //   mcp__clay-sessions__<tool>  every MCP-mounted vendor. The server
    //                              segment is matched exactly, so a tool of
    //                              the same name on another MCP server is
    //                              never auto-approved.
    //   <tool>                      a Codex dynamic tool. Codex canonicalizes
    //                              send_to_partner and read_partner to the MCP
    //                              form itself, so only the remaining names
    //                              can legitimately arrive bare.
    var PAIR_MCP_PREFIX = "mcp__clay-sessions__";
    var pairMcpTools = {
      propose_worker: true,
      send_to_partner: true,
      read_partner: true,
      partner_status: true,
      replace_partner: true,
      interrupt_partner: true,
      close_partner: true,
      record_partner_evaluation: true,
      respond_to_worker_permission: true,
    };
    var pairDynamicTools = {
      propose_worker: true,
      partner_status: true,
      replace_partner: true,
      interrupt_partner: true,
      close_partner: true,
      record_partner_evaluation: true,
      respond_to_worker_permission: true,
    };
    if (toolName.indexOf("mcp__") === 0) {
      if (toolName.indexOf(PAIR_MCP_PREFIX) === 0
          && pairMcpTools[toolName.slice(PAIR_MCP_PREFIX.length)]) {
        return { behavior: "allow", updatedInput: input };
      }
    } else if (pairDynamicTools[toolName]) {
      return { behavior: "allow", updatedInput: input };
    }

    // Sticky-note operations are immediately visible and reversible on the
    // shared board. The exact session-bound handlers still enforce ownership,
    // lifecycle rules, and input validation, so a provider prompt adds no
    // authority. Keep this confined to the exact Clay Notes namespace.
    var NOTES_MCP_PREFIX = "mcp__clay-notes__";
    var notesTools = {
      list_notes: true,
      write_note: true,
      close_note: true,
      reopen_note: true,
      remove_note: true,
    };
    if (toolName.indexOf(NOTES_MCP_PREFIX) === 0
        && notesTools[toolName.slice(NOTES_MCP_PREFIX.length)]) {
      return { behavior: "allow", updatedInput: input };
    }

    // Project Logs are exact-session, project-bound tools whose authority is
    // enforced again by the server binding. Canonical changes are append-only
    // revisions, and the surface exposes no destructive delete operation, so
    // a second provider permission prompt adds no additional safety.
    if (toolName.indexOf("mcp__clay-logs__") === 0) {
      return { behavior: "allow", updatedInput: input };
    }

    // This tool only prepares a read-only UI projection for the document the
    // agent is about to edit. The subsequent Edit/Write keeps its own normal
    // permission behavior.
    if (toolName.indexOf("mcp__clay-documents__present_markdown_edit") === 0 ||
        toolName.indexOf("clay-documents__present_markdown_edit") !== -1) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-approve read-only email MCP tools.
    // These only read data from accounts the user explicitly checked.
    // Write operations (send, reply, mark_read) still require permission.
    var safeEmailTools = {
      clay_read_email: true,
      clay_read_email_body: true,
      clay_search_email: true,
      clay_list_labels: true,
    };
    if (toolName.indexOf("mcp__clay-email__") === 0) {
      var emailToolName = toolName.substring(toolName.lastIndexOf("__") + 2);
      if (safeEmailTools[emailToolName]) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    // Workspace inspection and proposal posting are session-bound. Keep this
    // list exact so a future execution/mutation tool cannot inherit approval.
    var safeWorkspaceTools = {
      "mcp__clay-workspace__list_projects": true,
      "mcp__clay-workspace__list_project_sessions": true,
      "mcp__clay-workspace__search_project_history": true,
      "mcp__clay-workspace__read_project_session": true,
      "mcp__clay-workspace__search_workspace_history": true,
      "mcp__clay-workspace__list_workspace_activity": true,
      "mcp__clay-workspace__propose_project_assignment": true,
      "mcp__clay-workspace__propose_project_follow_up": true,
      "mcp__clay-workspace__get_assignment_status": true,
    };
    if (safeWorkspaceTools[toolName] || toolName.indexOf("mcp__clay-history__") === 0) {
      return { behavior: "allow", updatedInput: input };
    }

    // Auto-approve remote MCP tools that the user explicitly enabled in project settings.
    // These are user-owned local MCP servers, so no additional permission prompt needed.
    if (toolName.indexOf("mcp__") === 0 && getRemoteMcpServers) {
      var _rmcp = getRemoteMcpServers();
      if (_rmcp) {
        var _mcpParts = toolName.split("__");
        var _mcpServerName = _mcpParts.length >= 2 ? _mcpParts[1] : "";
        if (_rmcp[_mcpServerName]) {
          return { behavior: "allow", updatedInput: input };
        }
      }
    }

    // Auto-approve safe Bash commands (read-only, non-destructive)
    // Applies to ALL sessions (mates and regular projects alike).
    // These are purely read-only commands that cannot modify files, install
    // packages, or change system state. Functionally equivalent to the
    // Read/Glob/Grep built-in tools which are already auto-approved.
    if (toolName === "Bash" && input && input.command) {
      var cmd = input.command.trim();
      // Split compound commands on operators (&&, ||, ;, |) while respecting
      // quoted strings and subshells (so grep -E "(a|b)" is not split), then
      // require every segment to pass the shared safe-command policy. The
      // policy lives in safe-bash-commands.js so the TUI allow-list
      // (claude-hook-installer.js) stays in lockstep with this path.
      var segments = splitShellSegments(cmd);
      var allSafe = true;
      for (var si = 0; si < segments.length; si++) {
        if (!isSafeBashSegment(segments[si])) { allSafe = false; break; }
      }
      if (allSafe) {
        return { behavior: "allow", updatedInput: input };
      }
    }

    return null; // Not whitelisted
  }

  function handleCanUseTool(session, toolName, input, opts) {
    var debateDecision = homeDebateToolPolicy.initialToolDecision(session, toolName, input);
    if (debateDecision) return Promise.resolve(debateDecision);
    // The dynamic proposal tool is bound to this exact query session. It only
    // posts the inline proposal; starting the debate still requires the user.
    if (session.homeDebatePlanning === true && toolName === "propose_debate") {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    // Mate creation proposals only present the exact-session approval card;
    // creating the Mate still requires the user's explicit action there.
    if (session.mateCreationMode === true && toolName === "propose_mate") {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }
    // Full-auto mode: auto-approve everything except AskUserQuestion
    // (which still needs to go through the user interaction flow).
    var clayPermissionMode = session.permissionMode || sm.currentPermissionMode;
    // A configured Split Worker is Driver-operated, so it runs under its
    // Driver's permission mode, re-resolved from the live pair on every single
    // decision. Nothing is copied at creation and the Worker's own persisted
    // setting is never written, so toggling skip permissions on the Driver
    // applies to the Worker's next call in either direction, mid-turn included.
    var _wpMode = getWorkerPermissionRouter();
    if (_wpMode && typeof _wpMode.inheritedPermissionMode === "function") {
      var inherited = _wpMode.inheritedPermissionMode(session);
      if (inherited) clayPermissionMode = inherited;
    }
    // AskUserQuestion is genuine user input, not an authorization, so it is
    // excluded here exactly as it always was: a Driver in skip mode still
    // cannot silently answer a question addressed to the person.
    if (clayPermissionMode === "bypassPermissions" && toolName !== "AskUserQuestion") {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Ralph Loop execution: auto-approve all tools, deny interactive ones.
    // Crafting sessions are interactive — user and Claude collaborate to build PROMPT.md / JUDGE.md.
    if (session.loop && session.loop.active && session.loop.role !== "crafting") {
      if (toolName === "AskUserQuestion") {
        return Promise.resolve({ behavior: "deny", message: "Autonomous mode. Make your own decision." });
      }
      if (toolName === "EnterPlanMode") {
        return Promise.resolve({ behavior: "deny", message: "Do not enter plan mode. Execute directly." });
      }
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // Check shared whitelist (read-only tools, safe browser tools, safe bash commands)
    var whitelisted = checkToolWhitelist(toolName, input);
    if (whitelisted) {
      return Promise.resolve(whitelisted);
    }

    // Auto-approve if tool was previously allowed for session
    if (session.allowedTools && session.allowedTools[toolName]) {
      return Promise.resolve({ behavior: "allow", updatedInput: input });
    }

    // A visible Split Worker's remaining prompts belong to its paired Driver,
    // not to the Worker pane. This sits below every auto-decision above, so
    // skip permissions, the whitelist, allowedTools and the loop/debate
    // policies all still resolve first and never wait on a Driver.
    var _wp = getWorkerPermissionRouter();
    if (_wp) {
      var routed = _wp.routeIfWorker(session, {
        toolName: toolName,
        input: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
        signal: opts.signal,
      });
      if (routed) return routed;
    }

    // Regular tool permission request: send to client and wait
    return new Promise(function(resolve) {
      var requestId = crypto.randomUUID();
      sm.permissionRequestIndex[requestId] = session.localId;
      session.pendingPermissions[requestId] = {
        resolve: resolve,
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
      };

      var permMsg = {
        type: "permission_request",
        requestId: requestId,
        toolName: toolName,
        toolInput: input,
        toolUseId: opts.toolUseID,
        decisionReason: opts.decisionReason || "",
        vendor: session.vendor || (adapter && adapter.vendor) || "claude",
      };
      sendAndRecord(session, permMsg);
      onProcessingChanged(); // update cross-project permission badge

      if (pushModule) {
        pushModule.sendPush({
          type: "permission_request",
          slug: slug,
          requestId: requestId,
          title: permissionPushTitle(toolName, input),
          body: permissionPushBody(toolName, input),
        });
      }

      var _nm = getNotificationsModule();
      if (_nm) {
        _nm.notify("permission_request", {
          title: permissionPushTitle(toolName, input),
          body: permissionPushBody(toolName, input),
          slug: slug,
          sessionId: session.localId,
          ownerId: session.ownerId || null,
          requestId: requestId,
          toolName: toolName,
          toolInput: input,
        });
      }

      if (opts.signal) {
        opts.signal.addEventListener("abort", function() {
          delete session.pendingPermissions[requestId];
          delete sm.permissionRequestIndex[requestId];
          sendAndRecord(session, { type: "permission_cancel", requestId: requestId });
          onProcessingChanged(); // update cross-project permission badge
          resolve({ behavior: "deny", message: "Request cancelled" });
        });
      }
    });
  }

  /**
   * Detect running Claude Code CLI processes that may conflict with our SDK queries.
   * Only returns processes whose cwd matches our project directory.
   * Returns an array of { pid, command } for each conflicting process found.
   */
  function findConflictingClaude() {
    try {
      var output = execFileSync("ps", ["ax", "-o", "pid,command"], { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] });
      var lines = output.trim().split("\n");
      var candidates = [];
      for (var i = 1; i < lines.length; i++) { // skip header
        var line = lines[i].trim();
        var m = line.match(/^(\d+)\s+(.+)/);
        if (!m) continue;
        var pid = parseInt(m[1], 10);
        var cmd = m[2];
        // Skip our own process
        if (pid === process.pid) continue;
        // Skip node processes (our daemon, dev watchers, etc.)
        if (/\bnode\b/.test(cmd.split(/\s/)[0])) continue;
        // Match actual claude binary (e.g. /Users/x/.claude/local/claude, /usr/local/bin/claude)
        if (/\/claude(\s|$)/.test(cmd) || /^claude(\s|$)/.test(cmd)) {
          candidates.push({ pid: pid, command: cmd.substring(0, 200) });
        }
      }

      // Filter to only processes whose cwd matches our project
      var results = [];
      for (var j = 0; j < candidates.length; j++) {
        var c = candidates[j];
        try {
          // Use /proc/<pid>/cwd symlink (always available on Linux, no lsof dependency)
          var procCwd = fs.readlinkSync("/proc/" + c.pid + "/cwd");
          if (procCwd === cwd) {
            results.push(c);
          }
        } catch (e) {
          // /proc read failed — include as candidate anyway (conservative)
          results.push(c);
        }
      }
      return results;
    } catch (e) {
      return [];
    }
  }

  /**
   * Verify that a PID is actually a claude binary process (not arbitrary).
   */
  function isClaudeProcess(pid) {
    try {
      var output = execFileSync("ps", ["-p", String(pid), "-o", "command="], { encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] }).trim();
      return /\/claude(\s|$)/.test(output) || /^claude(\s|$)/.test(output);
    } catch (e) {
      return false;
    }
  }

  async function processQueryStream(session) {
    // Capture references at start so we only clean up OUR resources in finally,
    // not resources from a newer query that may have been created after an abort.
    var myQueryInstance = session.queryInstance;
    var myAbortController = session.abortController;
    var myMessageQueue = session.messageQueue;
    console.log("[sdk-bridge] processQueryStream: starting for-await loop, vendor=" + (session.vendor || adapter.vendor));
    try {
      for await (var msg of myQueryInstance) {
        if (msg && msg.yokeType !== "text_delta" && msg.yokeType !== "thinking_delta" && msg.yokeType !== "tool_input_delta") {
          console.log("[sdk-bridge] processQueryStream: received event yokeType=" + msg.yokeType);
        }
        // Handle worker meta events (context_usage, model_changed, etc.)
        if (msg && msg.type === "_worker_meta") {
          var metaData = msg.data || {};
          switch (msg.subtype) {
            case "context_usage":
              session.lastContextUsage = metaData.data;
              sendToSession(session, { type: "context_usage", data: metaData.data });
              break;
            case "model_changed":
              session.model = metaData.model;
              sm.saveSessionFile(session);
              sm.defaultModelByVendor = sm.defaultModelByVendor || {};
              sm.defaultModelByVendor[session.vendor || "claude"] = metaData.model;
              sendModelInfoForVendor(session, session.vendor || (adapter && adapter.vendor) || "claude", metaData.model);
              sendToSession(session, { type: "config_state", model: session.model || defaultModelForVendor(session.vendor || "claude"), vendor: session.vendor || "claude", sessionId: session.localId, mode: session.permissionMode || sm.currentPermissionMode || "default", effort: session.effort || sm.currentEffort || "medium", betas: sm.currentBetas || [] });
              break;
            case "effort_changed":
              session.effort = metaData.effort;
              sm.saveSessionFile(session);
              sm.currentEffort = metaData.effort;
              sendToSession(session, { type: "config_state", model: session.model || defaultModelForVendor(session.vendor || "claude"), vendor: session.vendor || "claude", sessionId: session.localId, mode: session.permissionMode || sm.currentPermissionMode || "default", effort: session.effort, betas: sm.currentBetas || [] });
              break;
            case "permission_mode_changed":
              sm.currentPermissionMode = metaData.mode;
              sendToSession(session, { type: "config_state", model: session.model || defaultModelForVendor(session.vendor || "claude"), vendor: session.vendor || "claude", sessionId: session.localId, mode: session.permissionMode || sm.currentPermissionMode, effort: session.effort || sm.currentEffort || "medium", betas: sm.currentBetas || [] });
              break;
            case "worker_error":
              send({ type: "error", text: metaData.error });
              break;
          }
          continue;
        }
        processSDKMessage(session, msg);
      }
      // (getContextUsage moved to processSDKMessage result handler -- fire-and-forget)
      // Stream ended normally after a task stop — no "result" message was sent,
      // so the session is still marked as processing. Send interrupted feedback.
      console.log("[sdk-bridge] processQueryStream ended: isProcessing=" + session.isProcessing + " taskStopRequested=" + session.taskStopRequested);
      var stillOwnsRuntime = session.queryInstance === myQueryInstance;
      if (session.isProcessing && session.taskStopRequested && stillOwnsRuntime) {
        session._lastTurnInterrupted = true;
        session.isProcessing = false;
        session._awaitingTurnResult = false;
        session._queuedTurnCount = 0;
        onProcessingChanged();
        send({ type: "status", processing: false });
        sendAndRecord(session, { type: "thinking_stop" });
        var interruptMsg = (session.vendor && session.vendor !== "claude")
          ? "\u25a0 Conversation interrupted - tell the model what to do differently."
          : "Interrupted \u00b7 What should Claude do instead?";
        sendAndRecord(session, { type: "info", text: interruptMsg });
        sendAndRecord(session, { type: "done", code: 0 });
        sm.broadcastSessionList();
      } else if (session.isProcessing && stillOwnsRuntime) {
        // Codex and Kiro can report a protocol error and then close their
        // iterator without a result event. Treat any result-less stream end as
        // a failed turn so the UI cannot remain on processing forever.
        session.isProcessing = false;
        session._awaitingTurnResult = false;
        session._queuedTurnCount = 0;
        onProcessingChanged();
        if (!session._lastAdapterError) {
          sendAndRecord(session, {
            type: "error",
            text: "The agent connection ended before completing the response.",
          });
        }
        session._lastAdapterError = null;
        sendAndRecord(session, { type: "done", code: 1 });
        sm.broadcastSessionList();
      }
    } catch (err) {
      if (session.isProcessing && session.queryInstance === myQueryInstance) {
        session.isProcessing = false;
        session._awaitingTurnResult = false;
        session._queuedTurnCount = 0;
        onProcessingChanged();
        if (err.name === "AbortError" || (myAbortController && myAbortController.signal.aborted) || session.taskStopRequested) {
          session._lastTurnInterrupted = true;
          if (!session.destroying) {
            sendAndRecord(session, { type: "thinking_stop" });
            var interruptMsg2 = (session.vendor && session.vendor !== "claude")
              ? "\u25a0 Conversation interrupted - tell the model what to do differently."
              : "Interrupted \u00b7 What should Claude do instead?";
            sendAndRecord(session, { type: "info", text: interruptMsg2 });
            sendAndRecord(session, { type: "done", code: 0 });
          }
        } else if (session.destroying) {
          // Suppress error messages during shutdown
          console.log("[sdk-bridge] Suppressing stream error during shutdown for session " + session.localId);
        } else {
          var errDetail = err.message || String(err);
          if (err.stderr) errDetail += "\nstderr: " + err.stderr;
          if (err.exitCode != null) errDetail += " (exitCode: " + err.exitCode + ")";
          console.error("[sdk-bridge] Query stream error for session " + session.localId + ":", errDetail);
          console.error("[sdk-bridge] Stack:", err.stack || "(no stack)");

          // Check for conflicting Claude processes only on exit code 1
          var isExitCode1 = err.exitCode === 1 || (err.message && err.message.indexOf("exited with code 1") !== -1);
          var conflicts = isExitCode1 ? findConflictingClaude() : [];
          if (conflicts.length > 0) {
            console.error("[sdk-bridge] Found " + conflicts.length + " conflicting Claude process(es):", conflicts.map(function(c) { return "PID " + c.pid; }).join(", "));
            sendAndRecord(session, {
              type: "process_conflict",
              text: "Another Claude Code process is already running in this project.",
              processes: conflicts,
            });
          } else {
            var errLower = errDetail.toLowerCase();
            var isContextOverflow = errLower.indexOf("prompt is too long") !== -1
              || errLower.indexOf("context_length") !== -1
              || errLower.indexOf("maximum context length") !== -1;
            var isAuthError = isAuthErrorMessage(errDetail);
            if (isContextOverflow) {
              sendAndRecord(session, {
                type: "context_overflow",
                text: "Conversation too long to continue.",
              });
            } else if (isAuthError) {
              var freshAuth = getFreshAuthState();
              logAuthDecision("catch-auth-error", session, errDetail, freshAuth);
              if (freshAuth[session.vendor]) {
                sendAndRecord(session, {
                  type: "error",
                  text: "Authentication looked fine, but " + (session.vendor || "the vendor") + " returned an auth-like error.",
                });
                sendAndRecord(session, { type: "done", code: 1 });
                sm.broadcastSessionList();
                return;
              }
              var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
              var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
              var canAutoLogin = !usersModule.isMultiUser()
                || !!authLinuxUser
                || (authUser && authUser.role === "admin");
              var authInfo = yoke.getVendorInfo(session.vendor);
              var authVendorLabel = (authInfo && authInfo.displayName) || "Claude Code";
              var authTitle = authVendorLabel + " is not logged in.";
              var authMsg = {
                type: "auth_required",
                text: authTitle,
                vendor: session.vendor || (adapter && adapter.vendor) || "claude",
                loginCommand: getLoginCommand(session.vendor || (adapter && adapter.vendor) || "claude"),
                linuxUser: authLinuxUser,
                canAutoLogin: canAutoLogin,
              };
              sendAndRecord(session, authMsg);
              if (!notifyAuthRequired(
                session,
                authTitle,
                "Open a terminal, then click the URL and follow the instructions.",
                authLinuxUser,
                canAutoLogin,
                getLoginCommand(session.vendor || (adapter && adapter.vendor) || "claude")
              )) {
                // chat message already sent above
              }
            } else {
              sendAndRecord(session, { type: "error", text: "Claude process error: " + err.message });
            }
          }
          sendAndRecord(session, { type: "done", code: 1 });
        }
        sm.broadcastSessionList();
      }
    } finally {
      // Close the SDK query to terminate the underlying claude child process.
      // Without this, the process stays alive indefinitely (single-user mode).
      // Only clean up if the session still references OUR resources.
      // A rewind + new startQuery may have already replaced these with
      // a newer query — clobbering them would kill the new query.
      var ownsRuntime = session.queryInstance === myQueryInstance;
      if (ownsRuntime) {
        try {
          if (typeof session.queryInstance.close === "function") {
            session.queryInstance.close();
          }
        } catch (e) {}
        session.queryInstance = null;
      }
      if (session.messageQueue === myMessageQueue) session.messageQueue = null;
      if (session.abortController === myAbortController) session.abortController = null;
      if (ownsRuntime) {
        session.taskStopRequested = false;
        session.pendingPermissions = {};
        // Preserve only restored legacy MCP entries. Canonical Yoke requests
        // hold a live provider callback and must be cancelled with their query.
        var keepAskUser = {};
        for (var _tid in session.pendingAskUser) {
          var _pending = session.pendingAskUser[_tid];
          if (_pending && _pending.mode === "mcp") keepAskUser[_tid] = _pending;
          else if (_pending && _pending.mode === "yoke" && _pending.respond && typeof _pending.respond.cancel === "function") {
            _pending.respond.cancel("Query closed");
          }
        }
        session.pendingAskUser = keepAskUser;
        session.pendingElicitations = {};

        // Auto-continue on rate limit (scheduler sessions, or user setting)
        // Mark session as done processing so the late rate_limit_event handler
        // can detect the race condition and schedule auto-continue itself.
        session.isProcessing = false;

        var didScheduleAutoContinue = false;
        var acEnabled = session.onQueryComplete || (typeof opts.getAutoContinueSetting === "function" && opts.getAutoContinueSetting(session));
        if (session.rateLimitResetsAt && session.rateLimitResetsAt > Date.now()
            && acEnabled && !session.destroying) {
          var acResetsAt = session.rateLimitResetsAt;
          session.rateLimitResetsAt = null;
          session.rateLimitAutoContinuePending = true;
          didScheduleAutoContinue = true;
          console.log("[sdk-bridge] Rate limited, scheduling auto-continue via scheduleMessage for session " + session.localId);
          if (typeof opts.scheduleMessage === "function") {
            opts.scheduleMessage(session, "continue", acResetsAt);
          }
        } else if (acEnabled && !session.destroying) {
          // Log why auto-continue was not scheduled (for debugging)
          console.log("[sdk-bridge] Query done, auto-continue enabled but not scheduled: rateLimitResetsAt=" +
            session.rateLimitResetsAt + " (will rely on late rate_limit_event handler)");
        }

        // Ralph Loop: notify completion so loop orchestrator can proceed
        if (session.onQueryComplete && !didScheduleAutoContinue) {
          console.log("[sdk-bridge] Calling onQueryComplete for session " + session.localId + " (title: " + (session.title || "?") + ")");
          try {
            session.onQueryComplete(session);
          } catch (err) {
            console.error("[sdk-bridge] onQueryComplete error:", err.message || err);
          }
        }
      }
    }
  }

  async function getOrCreateRewindQuery(session) {
    if (session.queryInstance) return { query: session.queryInstance, isTemp: false, cleanup: function() {} };

    var handle;
    try {
      handle = await adapter.createQuery({
        cwd: cwd,
        resumeSessionId: session.cliSessionId,
        env: getRuntimeEnv(session),
        adapterOptions: {
          CLAUDE: {
            settingSources: ["user", "project", "local"],
            enableFileCheckpointing: true,
          },
        },
      });
    } catch (e) {
      sendAndRecord(session, { type: "error", text: "Failed to load Claude SDK: " + (e.message || e) });
      throw e;
    }

    // Drain messages in background (stream stays alive until close)
    (async function() {
      try { for await (var msg of handle) {} } catch(e) {}
    })();

    return {
      query: handle,
      isTemp: true,
      cleanup: function() { try { handle.close(); } catch(e) {} },
    };
  }

  // --- Unified rewind/fork interface (adapter-agnostic) ---

  async function rewindPreview(session, uuid) {
    var sessionAdapter = getAdapterForSession(session);
    // Adapters with rollbackThread (e.g. Codex) do chat-only rewind, no file diffs
    if (sessionAdapter && typeof sessionAdapter.rollbackThread === "function") {
      return { preview: { filesChanged: [] }, diffs: {}, chatOnly: true };
    }
    // Claude path: use rewindFiles with dryRun
    var result = await getOrCreateRewindQuery(session);
    try {
      var preview = await result.query.rewindFiles(uuid, { dryRun: true });
      var diffs = {};
      var changedFiles = preview.filesChanged || [];
      for (var f = 0; f < changedFiles.length; f++) {
        try {
          diffs[changedFiles[f]] = require("child_process").execFileSync(
            "git", ["diff", "HEAD", "--", changedFiles[f]],
            { cwd: cwd, encoding: "utf8", timeout: 5000 }
          ) || "";
        } catch (e) { diffs[changedFiles[f]] = ""; }
      }
      return { preview: preview, diffs: diffs, chatOnly: false };
    } finally {
      if (result.isTemp) result.cleanup();
    }
  }

  async function rewindExecuteFiles(session, uuid) {
    var sessionAdapter = getAdapterForSession(session);
    // Adapters with rollbackThread skip file restoration
    if (sessionAdapter && typeof sessionAdapter.rollbackThread === "function") return;
    // Claude path: restore files
    var result = await getOrCreateRewindQuery(session);
    try {
      await result.query.rewindFiles(uuid, { dryRun: false });
    } finally {
      if (result.isTemp) result.cleanup();
    }
  }

  async function rollbackConversation(session, numTurns) {
    var sessionAdapter = getAdapterForSession(session);
    if (sessionAdapter && typeof sessionAdapter.rollbackThread === "function") {
      await sessionAdapter.rollbackThread(session.cliSessionId, numTurns, {
        linuxUser: getSessionLinuxUser(session) || undefined,
      });
    }
    // Claude: conversation rollback is handled by rewindFiles + local history trim
  }

  function getAdapterForSession(session) {
    var vendor = session.vendor || sm.defaultVendor || "claude";
    return adapters[vendor] || adapter;
  }

  async function forkSessionUnified(session, uuid) {
    var sessionAdapter = getAdapterForSession(session);
    var result = await sessionAdapter.forkSession(session.cliSessionId, {
      upToMessageId: uuid,
      dir: cwd,
      linuxUser: getSessionLinuxUser(session) || undefined,
    });
    if (!result || !result.sessionId) throw new Error("Fork returned no session id");

    // Adapters with rollbackThread (e.g. Codex) use local history copy
    if (typeof sessionAdapter.rollbackThread === "function") {
      return { sessionId: result.sessionId, useLocalHistory: true };
    }
    // Claude: read history from CLI session files
    return { sessionId: result.sessionId, useLocalHistory: false };
  }

  // Wrapper: marks the boot window so pushMessage can buffer instead of
  // dropping messages that arrive while createQuery is still awaiting.
  async function startQuery(session, text, images, linuxUser) {
    delete session._lastTurnInterrupted;
    session._queryStarting = true;
    try {
      return await startQueryInner(session, text, images, linuxUser);
    } finally {
      session._queryStarting = false;
      if (!session.queryInstance && session.pendingPush && session.pendingPush.length) {
        // The query never came up (auth/adapter failure already reported to
        // the user). Drop the backlog rather than leaking it into a future
        // unrelated query.
        session.pendingPush = [];
      }
    }
  }

  async function startQueryInner(session, text, images, linuxUser) {
    var sessionRuntimeEnv = getRuntimeEnv(session);
    async function ensureVendorReady(vendor) {
      if (!vendor) return null;
      if (linuxUser && !supportsOsUserIsolation(vendor)) return null;
      var vendorAdapter = adapters[vendor] || null;
      if (!vendorAdapter) {
        vendorAdapter = await yoke.lazyCreateAdapter(adapters, vendor, {
          cwd: cwd,
          dangerouslySkipPermissions: dangerouslySkipPermissions,
          linuxUser: linuxUser || undefined,
          clayPort: clayPort,
          clayTls: clayTls,
          clayAuthToken: clayAuthToken,
          slug: slug,
          env: sessionRuntimeEnv,
        });
      }
      var needsReadyMetadata = !sm.capabilitiesByVendor || !sm.capabilitiesByVendor[vendor]
        || !sm.modelsByVendor || !sm.modelsByVendor[vendor];
      if (vendorAdapter && needsReadyMetadata && typeof vendorAdapter.init === "function") {
        var readyResult = await vendorAdapter.init({
          cwd: cwd,
          dangerouslySkipPermissions: dangerouslySkipPermissions,
          linuxUser: linuxUser || undefined,
          clayPort: clayPort,
          clayTls: clayTls,
          clayAuthToken: clayAuthToken,
          slug: slug,
          env: sessionRuntimeEnv,
        });
        rememberAdapterReady(vendor, readyResult);
      }
      if (vendorAdapter) {
        sm.availableVendors = getAvailableVendors(linuxUser);
        sm.modelsByVendor = sm.modelsByVendor || {};
        if (!sm.modelsByVendor[vendor] && typeof vendorAdapter.supportedModels === "function") {
          sm.modelsByVendor[vendor] = await vendorAdapter.supportedModels();
        }
        var vendorModels = getModelsForVendor(vendor);
        var modelForVendor = resolveModelInList(vendorModels, defaultModelForVendor(vendor))
          || modelEntryValue(vendorModels[0])
          || "";
        sendModelInfoForVendor(session, vendor, modelForVendor);
      }
      return vendorAdapter;
    }

    // Kiro ACP currently spawns as the daemon user. Running it for an
    // OS-isolated session would expose the daemon user's HOME and Kiro
    // credentials to another user, so refuse until the adapter has a
    // per-user worker path.
    if (linuxUser && !supportsOsUserIsolation(session.vendor)) {
      var isolatedVendorInfo = yoke.getVendorInfo(session.vendor);
      var isolatedVendorName = (isolatedVendorInfo && isolatedVendorInfo.displayName) || session.vendor || "This vendor";
      console.error("[sdk-bridge] Refusing " + isolatedVendorName + " for OS-isolated user " + linuxUser + ": per-user spawning is not implemented");
      sendAndRecord(session, {
        type: "error",
        text: isolatedVendorName + " is not available for OS-isolated users yet.",
      });
      sendAndRecord(session, { type: "done", code: 1 });
      return;
    }

    // If vendor is set but adapter not ready, try lazy creation (user may have logged in)
    if (session.vendor && !adapters[session.vendor]) {
      var lazyAdapter = await ensureVendorReady(session.vendor);
      if (lazyAdapter) {
        console.log("[sdk-bridge] Lazy adapter created for " + session.vendor);
      }
    } else if (session.vendor) {
      await ensureVendorReady(session.vendor);
    }
    if (session.vendor && !adapters[session.vendor]) {
      var freshAuth = getFreshAuthState();
      logAuthDecision("pre-auth-required", session, null, freshAuth);
      if (freshAuth[session.vendor]) {
        var recoveredAdapter = await ensureVendorReady(session.vendor);
        if (recoveredAdapter) {
          console.log("[sdk-bridge] Auth recheck recovered adapter for " + session.vendor);
        }
      }
    }
    // If still not available after lazy check, send auth_required
    if (session.vendor && !adapters[session.vendor]) {
      var missingVendorInfo = yoke.getVendorInfo(session.vendor);
      var vendorName = (missingVendorInfo && missingVendorInfo.displayName)
        || session.vendor.charAt(0).toUpperCase() + session.vendor.slice(1);
      var authUser = session.ownerId ? usersModule.findUserById(session.ownerId) : null;
      var authLinuxUser = authUser && authUser.linuxUser ? authUser.linuxUser : null;
      var canAutoLogin = !usersModule.isMultiUser()
        || !!authLinuxUser
        || (authUser && authUser.role === "admin");
      var authState = getFreshAuthState();
      logAuthDecision("emit-auth-required", session, "missing adapter", authState);
      if (authState[session.vendor]) {
        sendAndRecord(session, {
          type: "error",
          text: vendorName + " auth is available, but the adapter could not be initialized.",
        });
        sendAndRecord(session, { type: "done", code: 1 });
        return;
      }
      var authMsg2 = {
        type: "auth_required",
        text: vendorName + " is not logged in.",
        vendor: session.vendor,
        loginCommand: getLoginCommand(session.vendor),
        linuxUser: authLinuxUser,
        canAutoLogin: canAutoLogin,
      };
      sendAndRecord(session, authMsg2);
      if (!notifyAuthRequired(
        session,
        vendorName + " is not logged in.",
        "Open a terminal, then click the URL and follow the instructions.",
        authLinuxUser,
        canAutoLogin,
        getLoginCommand(session.vendor)
      )) {
        // chat message already sent above
      }
      sendAndRecord(session, { type: "done", code: 1 });
      return;
    }
    // Select adapter based on session vendor (fallback to default)
    var sessionAdapter = (session.vendor && adapters[session.vendor]) || adapter;
    console.log("[sdk-bridge] startQuery: vendor=" + sessionAdapter.vendor + " session=" + session.localId + " text=" + (text || "").substring(0, 50));
    // Remember linuxUser for auto-continue after rate limit
    session.lastLinuxUser = linuxUser || null;

    var t0 = session._queryStartTs || Date.now();

    // Wait for previous worker to fully exit before spawning a new one.
    // Without this, the new worker may try to resume the SDK session file
    // while the old worker is still flushing it to disk, causing
    // "no conversation found" and losing all prior context.
    // Harmless if null (no previous worker).
    if (session._workerExitPromise) {
      var exitWait = session._workerExitPromise;
      session._workerExitPromise = null;
      await Promise.race([
        exitWait,
        new Promise(function(resolve) { setTimeout(resolve, 3000); }),
      ]);
    }

    // Ensure Linux user project directory exists (runs in parallel with worker boot)
    if (linuxUser) {
      ensureLinuxUserProjectDir(linuxUser, session);
    }

    session.blocks = {};
    session.sentToolResults = {};
    session.activeTaskToolIds = {};
    session.pendingElicitations = {};
    session.streamedText = false;
    session.responsePreview = "";
    session._lastAdapterError = null;

    // For in-process path, create AbortController. For worker path, the adapter
    // handles abort internally and exposes it via handle.abort().
    if (!linuxUser) {
      session.abortController = new AbortController();
    }

    // Build Claude-specific adapter options
    var claudeOpts = {
      settingSources: ["user", "project", "local"],
      includePartialMessages: true,
      enableFileCheckpointing: true,
      extraArgs: { "replay-user-messages": null },
      promptSuggestions: true,
      agentProgressSummaries: true,
    };

    // Per-loop settings override global defaults when present
    var ls = session.loopSettings || {};

    if (sm.currentBetas && sm.currentBetas.length > 0) {
      claudeOpts.betas = sm.currentBetas;
    }
    var thinkingMode = ls.thinking || sm.currentThinking;
    if (thinkingMode === "disabled") {
      claudeOpts.thinking = { type: "disabled" };
    } else if (thinkingMode === "budget") {
      var budgetTokens = ls.thinkingBudget || sm.currentThinkingBudget;
      if (budgetTokens) claudeOpts.thinking = { type: "enabled", budgetTokens: budgetTokens };
    } else {
      // Adaptive (the default). Request summarized display explicitly:
      // current models default thinking.display to "omitted", which streams
      // thinking blocks whose text is an EMPTY string -- the UI's thinking
      // section stays blank even though thinking happens and is billed.
      // (SDK ThinkingAdaptive: { type: "adaptive", display?: "summarized" | "omitted" })
      claudeOpts.thinking = { type: "adaptive", display: "summarized" };
    }

    if (ls.permissionMode) {
      session._loopPermissionMode = ls.permissionMode;
    }

    // Pass through any extra SDK settings from LOOP.json
    if (ls.disableAllHooks !== undefined) {
      claudeOpts.settings = Object.assign({}, claudeOpts.settings || {}, { disableAllHooks: ls.disableAllHooks });
    }

    if (dangerouslySkipPermissions || (session.mode === "tui" && session.dangerouslySkipPermissions)) {
      claudeOpts.allowDangerouslySkipPermissions = true;
      claudeOpts.permissionMode = "bypassPermissions";
    } else {
      var globalMode = session.permissionMode || sm.currentPermissionMode || "default";
      var effectiveDefault;
      // GUI full access stays inside Clay's canUseTool callback. Passing the
      // SDK bypass mode would require its process-level dangerous escape hatch
      // and would skip Clay's permission policy entirely.
      if (globalMode === "bypassPermissions") effectiveDefault = "default";
      else if (session.acceptEditsAfterStart) effectiveDefault = "acceptEdits";
      else effectiveDefault = globalMode;
      var modeToApply = session._loopPermissionMode || effectiveDefault;
      if (modeToApply && modeToApply !== "default") {
        claudeOpts.permissionMode = modeToApply;
      }
    }
    // Clear one-shot acceptEditsAfterStart regardless of which branch ran above,
    // so the flag does not linger into subsequent turns.
    if (session.acceptEditsAfterStart) delete session.acceptEditsAfterStart;
    if (session.cliSessionId && session.lastRewindUuid) {
      claudeOpts.resumeSessionAt = session.lastRewindUuid;
      delete session.lastRewindUuid;
      sm.saveSessionFile(session);
    }

    // Pass linuxUser to adapter for worker-based queries
    if (linuxUser) {
      claudeOpts.linuxUser = linuxUser;
      claudeOpts.singleTurn = !!session.singleTurn;
      claudeOpts.originalHome = require("./config").REAL_HOME || null;
      claudeOpts.projectPath = session.cwd || null;
      claudeOpts._perfT0 = t0;
      // Pass previous worker state for reuse
      if (session._adapterWorkerState) {
        claudeOpts._workerState = session._adapterWorkerState;
        session._adapterWorkerState = null;
      }
    }

    // Pick a model from the session or its vendor-specific default, then
    // validate it against the session vendor's known model list.
    var queryModel = (ls.model && ls.model !== "default" ? ls.model : null) || session.model || defaultModelForVendor(session.vendor || "claude") || undefined;
    var sessionVendor = session.vendor || (adapter && adapter.vendor) || null;
    if (sessionVendor) {
      var vendorModels = (sm.modelsByVendor && sm.modelsByVendor[sessionVendor]) || [];
      if (vendorModels.length > 0 && queryModel && !modelListContains(vendorModels, queryModel)) {
        var resolved = resolveModelInList(vendorModels, queryModel);
        queryModel = resolved || modelEntryValue(vendorModels[0]);
      }
    }
    // Guard against anything upstream having set queryModel to an object
    // (e.g. a cached ModelInfo leaked through). Always coerce to string id.
    if (queryModel && typeof queryModel !== "string") {
      queryModel = modelEntryValue(queryModel) || undefined;
    }

    // Bind the resolved model to the session so it survives a daemon
    // restart. This preserves a session-specific selection across restarts.
    if (queryModel && session.model !== queryModel) {
      session.model = queryModel;
      sm.saveSessionFile(session);
    }

    var codexConfig = getCodexConfig(sm);
    var kiroConfig = getKiroConfig(sm);
    var requestedUserInputMode = session.debateSetupMode || session.mateCreationMode ? "fallback" : "auto";
    var selectedUserInputMode = yoke.userInput.selectMode(sessionAdapter, requestedUserInputMode);
    var sessionUserInputHandler = function(request, respond) {
      if (request.presentation === "elicitation" && request.diagnostics && request.diagnostics.elicitation) {
        var elicitationController = new AbortController();
        if (respond && typeof respond.onSettle === "function") {
          respond.onSettle(function (result) {
            if (result.status !== "submitted") elicitationController.abort();
          });
        }
        return handleElicitation(session, request.diagnostics.elicitation, { signal: elicitationController.signal }).then(function(result) {
          if (result && result.action === "accept") return respond.submitContent(result.content || {});
          return respond.cancel("Elicitation rejected");
        });
      }
      if (typeof opts.onUserInputRequest !== "function") return respond.cancel("Structured user input is unavailable.");
      return opts.onUserInputRequest(session, request, respond);
    };
    var localMcpServers = getMcpServers(session);
    if (selectedUserInputMode === "fallback") {
      var userInputServer = yoke.userInput.createFallbackServer(sessionAdapter, sessionUserInputHandler, { force: true });
      if (userInputServer) {
        localMcpServers = Object.assign({}, localMcpServers || {});
        localMcpServers[userInputServer.name || "yoke-user-input"] = userInputServer;
      }
    }
    var mergedMcpServers = mergeMcpServers(localMcpServers, getRemoteMcpServers) || undefined;
    var sessionToolDefs = getSessionToolDefs(session) || [];
    if (selectedUserInputMode === "fallback") {
      sessionToolDefs = sessionToolDefs.concat(yoke.userInput.fallbackToolDefs(sessionUserInputHandler));
    }
    function findSessionToolDef(toolName) {
      // Codex restores a thread's original dynamic-tool catalog on resume, but
      // pair state can change after this query starts. Resolve live session
      // handlers first so the dispatcher cannot lag behind that catalog. Keep
      // the query snapshot as a fallback for query-bound tools such as the
      // structured-input fallback, whose handler exists only for this turn.
      var liveToolDefs = getSessionToolDefs(session) || [];
      for (var liveIndex = 0; liveIndex < liveToolDefs.length; liveIndex++) {
        if (liveToolDefs[liveIndex].name === toolName) return liveToolDefs[liveIndex];
      }
      for (var snapshotIndex = 0; snapshotIndex < sessionToolDefs.length; snapshotIndex++) {
        if (sessionToolDefs[snapshotIndex].name === toolName) return sessionToolDefs[snapshotIndex];
      }
      return null;
    }

    // Give fresh queries an immediate provisional label. The visible user
    // message in history wins over `text`, which may contain an internal
    // provider wrapper rather than what the person typed.
    // Only applied to NEW sessions (no cliSessionId yet) — when resuming,
    // the SDK ignores Options.title in favor of the persisted title.
    var initialTitle = null;
    var initialTitleProvisional = false;
    if (!session.cliSessionId && !session.titleManuallySet && !session.titleAutoGenerated) {
      var initialTitleChoice = sessionTitlePolicy.selectInitialTitle(session, text);
      initialTitle = initialTitleChoice.title;
      initialTitleProvisional = initialTitleChoice.provisional;
    }

    var queryOpts = {
      cwd: cwd,
      linuxUser: linuxUser || undefined,
      env: sessionRuntimeEnv,
      // appendSystemPrompt, NOT systemPrompt: a plain-string systemPrompt
      // REPLACES the entire Claude Code system prompt (sdk.d.ts:2096), which
      // would strip the driver session down to the two-sentence pair preset.
      // Adapters map this to their additive mechanism (claude: preset+append,
      // codex/kiro: prepend to the first message).
      appendSystemPrompt: typeof opts.getSessionSystemPrompt === "function" ? (opts.getSessionSystemPrompt(session) || undefined) : undefined,
      model: queryModel,
      // Effort is remembered per vendor and clamped to the session vendor's
      // supported levels: a global value would leak codex "minimal" into
      // Claude queries (and Claude "max" into codex) after vendor switches.
      effort: yoke.clampEffort(
        session.vendor || sm.defaultVendor || "claude",
        ls.effort
          || session.effort
          || (sm.currentEffortByVendor && sm.currentEffortByVendor[session.vendor || sm.defaultVendor || "claude"])
          || sm.currentEffort
      ) || undefined,
      title: initialTitle || undefined,
      toolServers: mergedMcpServers,
      toolServerDescriptors: extractMcpDescriptors(mergedMcpServers) || undefined,
      dynamicTools: sessionToolDefs,
      callDynamicTool: function (toolName, args) {
        var toolDef = findSessionToolDef(toolName);
        if (toolDef && typeof toolDef.handler === "function") {
          return toolDef.handler(args || {});
        }
        return Promise.reject(new Error("Session tool not found: " + toolName));
      },
      resumeSessionId: session.cliSessionId || undefined,
      abortController: linuxUser ? undefined : session.abortController,
      canUseTool: function(toolName, input, toolOpts) {
        var permissionName = toolName;
        var permissionToolDef = findSessionToolDef(toolName);
        if (permissionToolDef && permissionToolDef.permissionName) permissionName = permissionToolDef.permissionName;
        return handleCanUseTool(session, permissionName, input, toolOpts);
      },
      onUserInputRequest: function(request, respond) {
        return sessionUserInputHandler(request, respond);
      },
      userInputMode: selectedUserInputMode,
      onElicitation: function(request, elicitOpts) {
        return handleElicitation(session, request, elicitOpts);
      },
      onUserDialog: function(dialogRequest, dialogOpts) {
        return handleUserDialog(session, dialogRequest, dialogOpts);
      },
      callMcpTool: function(serverName, toolName, args) {
        return callMcpToolHandler(mergedMcpServers, serverName, toolName, args);
      },
      adapterOptions: {
        CLAUDE: claudeOpts,
        CODEX: {
          // Always use "never" (auto-approve) because Clay handles tool
          // permissions via its own UI (checkToolWhitelist + handleCanUseTool).
          // Codex's native approval prompts are terminal-based and cannot be
          // relayed through Clay's web UI, causing MCP tool calls to hang.
          approvalPolicy: "never",
          sandboxMode: codexConfig.sandbox,
          webSearchMode: codexConfig.webSearch,
        },
        ACP: {
          mcpServers: getAcpMcpServers(session),
        },
        ANTIGRAVITY: {
          dangerouslySkipPermissions: dangerouslySkipPermissions
            || session.permissionMode === "bypassPermissions",
        },
        KIRO: {
          engine: kiroConfig.engine,
          mode: kiroConfig.mode,
          // ACP accepts additional stdio MCP servers per session. The bridge is
          // bound to this Clay session so partner calls cannot leak across
          // concurrent Kiro sessions or users.
          mcpServers: getAcpMcpServers(session),
        },
      },
    };

    var handle;
    console.log("[sdk-bridge] calling adapter.createQuery... vendor=" + sessionAdapter.vendor);
    try {
      handle = await sessionAdapter.createQuery(queryOpts);
      console.log("[sdk-bridge] createQuery returned handle, vendor=" + sessionAdapter.vendor);
      // SDK accepted the explicit title. Provisional labels remain eligible
      // for semantic generation after the first Home exchange (or the normal
      // project threshold); seeded titles remain fixed.
      if (initialTitle && !session.title) {
        session.title = initialTitle;
        session.titleAutoGenerated = !initialTitleProvisional;
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
      } else if (initialTitle && session.title === initialTitle) {
        session.titleAutoGenerated = !initialTitleProvisional;
        sm.saveSessionFile(session);
      }
    } catch (e) {
      console.error("[sdk-bridge] Failed to create query for session " + session.localId + ":", e.message || e);
      console.error("[sdk-bridge] cliSessionId:", session.cliSessionId, "resume:", !!session.cliSessionId);
      console.error("[sdk-bridge] Stack:", e.stack || "(no stack)");
      session.isProcessing = false;
      session._awaitingTurnResult = false;
      session._queuedTurnCount = 0;
      onProcessingChanged();
      session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      sendAndRecord(session, { type: "error", text: "Failed to start query: " + (e.message || e) });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }

    // Store adapter worker state for reuse on next query
    if (handle._adapterState) {
      session._adapterWorkerState = handle._adapterState;
      // Keep session.worker reference for external code (sessions.js, project.js)
      // that needs to kill the worker on session destroy.
      if (handle._adapterState.worker) {
        session.worker = handle._adapterState.worker;
      }
    }

    // For worker path, create an abortController wrapper that delegates to handle.abort()
    if (linuxUser) {
      session.abortController = {
        abort: function() { handle.abort(); },
        signal: { aborted: false, addEventListener: function() {} },
      };
    }

    // Store QueryHandle on session for iteration and control.
    session.queryInstance = handle;

    // Push initial user message through the QueryHandle
    console.log("[sdk-bridge] pushing initial message via handle.pushMessage...");
    var initialMessageAccepted = handle.pushMessage(text, images) !== false;
    if (!initialMessageAccepted) {
      console.error("[sdk-bridge] Query rejected initial message for session " + session.localId);
      try { handle.close(); } catch (e) {}
      if (session.queryInstance === handle) session.queryInstance = null;
      session.messageQueue = null;
      session.abortController = null;
      session.isProcessing = false;
      session._awaitingTurnResult = false;
      session._queuedTurnCount = 0;
      onProcessingChanged();
      sendAndRecord(session, { type: "error", text: "The agent connection closed before it received your message. Please send it again." });
      sendAndRecord(session, { type: "done", code: 1 });
      sm.broadcastSessionList();
      return;
    }
    session._awaitingTurnResult = true;
    session._queuedTurnCount = 0;
    console.log("[sdk-bridge] pushMessage done, starting processQueryStream...");

    // Flush messages that arrived while createQuery was still awaiting
    // (pushMessage buffers them during the boot window). Synchronous with
    // the handle assignment above, so ordering vs new pushes is safe.
    if (session.pendingPush && session.pendingPush.length) {
      var backlog = session.pendingPush;
      session.pendingPush = [];
      console.log("[sdk-bridge] flushing " + backlog.length + " buffered message(s) into new query");
      for (var bi = 0; bi < backlog.length; bi++) {
        if (handle.pushMessage(backlog[bi].text, backlog[bi].images) !== false) {
          session._queuedTurnCount++;
        }
      }
    }

    // For single-turn sessions (Ralph Loop), end the message queue so the SDK
    // query finishes after processing the one message. Without this, the query
    // stream stays open forever waiting for more messages, and onQueryComplete
    // never fires.
    if (session.singleTurn) {
      handle.endInput();
    }

    session.lastActivityAt = Date.now();
    session.streamPromise = processQueryStream(session).catch(function(err) {
    });
  }

  // Returns true when the message has a consumer (delivered to a live
  // handle, or buffered for the query currently booting). Returns false
  // when there is nothing to deliver to -- callers must fall back to
  // startQuery instead of assuming delivery. The old void version silently
  // dropped messages in both gap windows, which is what made a session show
  // the processing indicator without ever answering until a second send.
  function pushMessage(session, text, images) {
    session.lastActivityAt = Date.now();
    if (session._runtimeRefreshRequested && !session._queryStarting) {
      session._runtimeRefreshRequested = false;
      var staleQuery = session.queryInstance;
      if (staleQuery && typeof staleQuery.close === "function") {
        try { staleQuery.close(); } catch (e) {}
      }
      session.queryInstance = null;
      session.abortController = null;
      session.messageQueue = null;
      return false;
    }
    // Route through QueryHandle (works for both in-process and worker paths)
    if (session.queryInstance && typeof session.queryInstance.pushMessage === "function") {
      var activeQuery = session.queryInstance;
      var activeAbortController = session.abortController;
      var activeMessageQueue = session.messageQueue;
      var delivered = false;
      try {
        // Older third-party adapters returned undefined. Preserve compatibility
        // while requiring built-in adapters to return false for a closed input.
        delivered = activeQuery.pushMessage(text, images) !== false;
      } catch (e) {
        console.error("[sdk-bridge] QueryHandle rejected message for session " + session.localId + ":", e.message || e);
      }
      if (delivered) {
        delete session._lastTurnInterrupted;
        if (session._awaitingTurnResult) {
          session._queuedTurnCount = (session._queuedTurnCount || 0) + 1;
        } else {
          session._awaitingTurnResult = true;
        }
        return true;
      }

      // The handle object can outlive its underlying input queue or worker.
      // Retire it before the caller starts a resumed replacement query; the
      // old stream's finally block compares object identity and cannot clobber
      // the replacement resources.
      try {
        if (typeof activeQuery.close === "function") activeQuery.close();
      } catch (e) {}
      if (session.queryInstance === activeQuery) session.queryInstance = null;
      if (session.abortController === activeAbortController) session.abortController = null;
      if (session.messageQueue === activeMessageQueue) session.messageQueue = null;
      return false;
    }
    if (session._queryStarting) {
      session.pendingPush = session.pendingPush || [];
      session.pendingPush.push({ text: text, images: images || null });
      return true;
    }
    return false;
  }

  function refreshSessionRuntime(session) {
    if (!session) return false;
    session._runtimeRefreshRequested = true;
    if (!session.isProcessing && !session._queryStarting) {
      var staleQuery = session.queryInstance;
      if (staleQuery && typeof staleQuery.close === "function") {
        try { staleQuery.close(); } catch (e) {}
      }
      session.queryInstance = null;
      session.abortController = null;
      session.messageQueue = null;
      session._runtimeRefreshRequested = false;
    }
    return true;
  }

  function refreshEnvironmentRuntime() {
    if (sm && sm.sessions) {
      sm.sessions.forEach(function (session) { refreshSessionRuntime(session); });
    }
    var vendorNames = Object.keys(adapters);
    for (var i = 0; i < vendorNames.length; i++) {
      var runtime = adapters[vendorNames[i]];
      if (!runtime || typeof runtime.shutdownIfIdle !== "function") continue;
      Promise.resolve(runtime.shutdownIfIdle(0)).catch(function () {});
    }
    return true;
  }

  function permissionPushTitle(toolName, input) {
    if (!input) return "Claude wants to use " + toolName;
    var file = input.file_path ? input.file_path.split(/[/\\]/).pop() : "";
    switch (toolName) {
      case "Bash": return "Claude wants to run a command";
      case "Edit": return "Claude wants to edit " + (file || "a file");
      case "Write": return "Claude wants to write " + (file || "a file");
      case "Read": return "Claude wants to read " + (file || "a file");
      case "Grep": return "Claude wants to search files";
      case "Glob": return "Claude wants to find files";
      case "WebFetch": return "Claude wants to fetch a URL";
      case "WebSearch": return "Claude wants to search the web";
      case "Task": return "Claude wants to launch an agent";
      default: return "Claude wants to use " + toolName;
    }
  }

  function permissionPushBody(toolName, input) {
    if (!input) return "";
    var text = "";
    if (toolName === "Bash" && input.command) {
      text = input.command;
    } else if (toolName === "Edit" && input.file_path) {
      text = input.file_path.split(/[/\\]/).pop() + ": " + (input.old_string || "").substring(0, 40) + " \u2192 " + (input.new_string || "").substring(0, 40);
    } else if (toolName === "Write" && input.file_path) {
      text = input.file_path;
    } else if (input.file_path) {
      text = input.file_path;
    } else if (input.command) {
      text = input.command;
    } else if (input.url) {
      text = input.url;
    } else if (input.query) {
      text = input.query;
    } else if (input.pattern) {
      text = input.pattern;
    } else if (input.description) {
      text = input.description;
    }
    if (text.length > 120) text = text.substring(0, 120) + "...";
    return text;
  }

  // Detect which vendor binaries are installed for this user.
  // In multi-user mode, runs checks as the specific Linux user.
  function detectInstalledVendors(linuxUser) {
    var execFileSync = require("child_process").execFileSync;
    var fs = require("fs");
    var result = [];

    function tryLookup(name) {
      try {
        if (linuxUser) {
          execFileSync("su", ["-", linuxUser, "-c", "which " + name], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
        } else {
          if (process.platform === "win32") execFileSync("where", [name], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
          else execFileSync("which", [name], { timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
        }
        return true;
      } catch (e) {
        return false;
      }
    }

    // Claude: check if binary is in PATH
    if (tryLookup(yoke.getVendorInfo("claude").binaryName)) result.push("claude");

    // Codex: check bundled binary or PATH
    var codexBin = null;
    try {
      codexBin = require("./yoke/codex-app-server").findCodexPath();
    } catch (e) {}
    if ((codexBin && fs.existsSync(codexBin)) || tryLookup(yoke.getVendorInfo("codex").binaryName)) result.push("codex");

    var subprocessVendorKeys = ["antigravity", "opencode", "kimi", "grok", "copilot", "qwen", "junie"];
    var acpProfiles = require("./yoke/acp-agent-profiles");
    for (var subprocessVendorIndex = 0; subprocessVendorIndex < subprocessVendorKeys.length; subprocessVendorIndex++) {
      var subprocessVendor = subprocessVendorKeys[subprocessVendorIndex];
      var subprocessInfo = yoke.getVendorInfo(subprocessVendor);
      if (!linuxUser || subprocessInfo.osUserIsolation) {
        if (subprocessVendor === "antigravity") {
          if (tryLookup(subprocessInfo.binaryName)) result.push(subprocessVendor);
        } else {
          var acpProfile = acpProfiles.getAcpAgentProfile(subprocessVendor);
          if (acpProfiles.findAcpAgentPath(acpProfile)) result.push(subprocessVendor);
        }
      } else {
        console.log("[sdk-bridge] " + subprocessInfo.displayName + " hidden for OS-isolated user " + linuxUser + ": per-user spawning is not implemented");
      }
    }

    // Kiro has no per-user ACP spawn path yet. Do not advertise the daemon's
    // binary to an OS-isolated user, even if that user also has Kiro installed.
    var kiroInfo = yoke.getVendorInfo("kiro");
    if (!linuxUser || kiroInfo.osUserIsolation) {
      var kiroBin = null;
      try {
        kiroBin = require("./yoke/kiro-acp-server").findKiroPath();
      } catch (e) {}
      if ((kiroBin && fs.existsSync(kiroBin)) || tryLookup(kiroInfo.binaryName)) result.push("kiro");
    } else {
      console.log("[sdk-bridge] " + kiroInfo.displayName + " hidden for OS-isolated user " + linuxUser + ": per-user spawning is not implemented");
    }

    return result;
  }

  function getAvailableVendors(linuxUser) {
    return Object.keys(adapters).filter(function(vendor) {
      return !(linuxUser && !supportsOsUserIsolation(vendor));
    });
  }

  // SDK warmup: initialize all available adapters and collect models.
  // The default adapter is initialized first for slash_commands and skills.
  // Passes linuxUser to adapter for worker-based warmup when OS isolation is needed.
  async function warmup(linuxUser) {
    var defaultVendor = adapter ? adapter.vendor : "claude";
    sm.defaultVendor = defaultVendor;

    // Installation detection is independent of adapter initialization. Publish
    // it before warmup so a new project does not render the initial empty state
    // as if every CLI were missing while the default adapter starts up.
    sm.installedVendors = detectInstalledVendors(linuxUser);
    sm.availableVendors = getAvailableVendors(linuxUser);
    sendModelInfoForVendor(null, defaultVendor, defaultModelForVendor(defaultVendor));

    // Initialize default adapter first (provides skills, slash commands, etc.)
    if (adapter) {
      try {
        var result = await adapter.init({
          cwd: cwd,
          dangerouslySkipPermissions: dangerouslySkipPermissions,
          linuxUser: linuxUser || undefined,
          clayPort: clayPort,
          clayTls: clayTls,
          clayAuthToken: clayAuthToken,
          slug: slug,
        });

        var fsSkills = discoverSkillDirs();
        sm.skillNames = mergeSkills(result.skills, fsSkills);
        if (result.slashCommands) {
          var seen = new Set();
          var combined = [];
          var all = result.slashCommands.concat(Array.from(sm.skillNames));
          for (var k = 0; k < all.length; k++) {
            if (!seen.has(all[k])) {
              seen.add(all[k]);
              combined.push(all[k]);
            }
          }
          sm.slashCommands = combined;
          sm.setSlashCommandsForVendor(defaultVendor, combined);
          send({ type: "slash_commands", commands: combined, vendor: defaultVendor });
        }
        if (result.defaultModel) {
          sm.defaultModelByVendor = sm.defaultModelByVendor || {};
          sm.defaultModelByVendor[defaultVendor] = sm.defaultModelByVendor[defaultVendor] || result.defaultModel;
        }
        sm.availableModels = result.models || [];
        // Store per-vendor models and capabilities
        rememberAdapterReady(defaultVendor, result);
      } catch (e) {
        if (e && e.name !== "AbortError" && !(e.message && e.message.indexOf("aborted") !== -1)) {
          send({ type: "error", text: "Failed to load " + defaultVendor + " SDK: " + (e.message || e) });
        }
      }
    }

    // Non-default adapters are NOT eagerly initialized here. Doing so used
    // to spawn a CodexAppServer and an mcp-bridge child per project even
    // when the user never touched that vendor. Lazy paths cover the gap:
    //   - get_vendor_models (project.js) inits a vendor when the user
    //     opens its model picker.
    //   - ensureVendorReady (this file) inits a vendor when a session
    //     actually issues a query with it.
    sm.modelsByVendor = sm.modelsByVendor || {};

    // Send the fully initialized state to the client.
    sendModelInfoForVendor(null, defaultVendor, defaultModelForVendor(defaultVendor));
  }

  async function setModel(session, model) {
    // Normalize to string id in case a { value, displayName } object slips in
    if (model && typeof model !== "string") {
      model = modelEntryValue(model);
    }
    if (!session.queryInstance) {
      // No active query — just store the model for next startQuery
      session.model = model;
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
      sm.defaultModelByVendor = sm.defaultModelByVendor || {};
      // Confirm against the session vendor so a non-default vendor does not
      // receive model metadata labeled as the project's default adapter.
      var pendingVendor = session.vendor || (adapter && adapter.vendor) || "claude";
      sm.defaultModelByVendor[pendingVendor] = model;
      sendModelInfoForVendor(session, pendingVendor, model);
      sendToSession(session, { type: "config_state", model: model, vendor: pendingVendor, sessionId: session.localId, mode: session.permissionMode || sm.currentPermissionMode || "default", effort: session.effort || sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return { ok: true, model: model };
    }
    try {
      await session.queryInstance.setModel(model);
      session.model = model;
      sm.saveSessionFile(session);
      sm.broadcastSessionList();
      sm.defaultModelByVendor = sm.defaultModelByVendor || {};
      var sessionVendor = session.vendor || (adapter && adapter.vendor) || "claude";
      sm.defaultModelByVendor[sessionVendor] = model;
      sendModelInfoForVendor(session, sessionVendor, model);
      sendToSession(session, { type: "config_state", model: model, vendor: sessionVendor, sessionId: session.localId, mode: session.permissionMode || sm.currentPermissionMode || "default", effort: session.effort || sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return { ok: true, model: model };
    } catch (e) {
      send({ type: "error", text: "Failed to switch model: " + (e.message || e) });
      return { ok: false, model: session.model || "", error: e.message || String(e) };
    }
  }

  async function setEffort(session, effort) {
    // Remember the pick per vendor (clamped) so vendor switches don't leak
    // unsupported levels across sessions; sm.currentEffort stays as the
    // display value for the session the user just configured.
    var effortVendor = session.vendor || sm.defaultVendor || "claude";
    var clamped = yoke.clampEffort(effortVendor, effort) || effort;
    sm.currentEffortByVendor = sm.currentEffortByVendor || {};
    sm.currentEffortByVendor[effortVendor] = clamped;
    session.effort = clamped;
    sm.saveSessionFile(session);
    sm.broadcastSessionList();
    sm.currentEffort = clamped;
    if (!session.queryInstance) {
      return clamped;
    }
    // Route through QueryHandle (works for both in-process and worker paths)
    if (typeof session.queryInstance.setEffort === "function") {
      await session.queryInstance.setEffort(clamped);
    }
    return clamped;
  }

  async function setPermissionMode(session, mode) {
    if (!session.queryInstance) {
      // No active query — just store the mode for next startQuery
      sm.currentPermissionMode = mode;
      sendToSession(session, { type: "config_state", model: session.model || defaultModelForVendor(session.vendor || "claude"), vendor: session.vendor || "claude", sessionId: session.localId, mode: sm.currentPermissionMode, effort: session.effort || sm.currentEffort || "medium", betas: sm.currentBetas || [] });
      return;
    }
    try {
      // Route through QueryHandle (works for both in-process and worker paths)
      await session.queryInstance.setPermissionMode(mode);
      sm.currentPermissionMode = mode;
      sendToSession(session, { type: "config_state", model: session.model || defaultModelForVendor(session.vendor || "claude"), vendor: session.vendor || "claude", sessionId: session.localId, mode: sm.currentPermissionMode, effort: session.effort || sm.currentEffort || "medium", betas: sm.currentBetas || [] });
    } catch (e) {
      sendToSession(session, { type: "error", text: "Failed to set permission mode: " + (e.message || e) });
    }
  }

  async function stopTask(taskId) {
    var session = sm.getActiveSession();
    if (!session) return;
    session.taskStopRequested = true;
    if (!session.queryInstance) return;
    try {
      // Route through QueryHandle (works for both in-process and worker paths)
      await session.queryInstance.stopTask(taskId);
    } catch (e) {
      console.error("[sdk-bridge] stopTask error:", e.message);
    }
    // SDK stopTask doesn't reliably stop the sub-agent, so abort the entire
    // session as a fallback to ensure the process actually stops.
    if (session.abortController) {
      session.abortController.abort();
    }
  }

  // Hot-reload skills/MCP/agents on the active query without a restart.
  async function reloadSkills(session) {
    if (!session || !session.queryInstance) return;
    try {
      // Route through QueryHandle (works for both in-process and worker paths)
      await session.queryInstance.reloadSkills();
      send({ type: "system_info", text: "Skills reloaded." });
    } catch (e) {
      send({ type: "error", text: "Failed to reload skills: " + (e.message || e) });
    }
  }

  // Override the permission mode for one MCP server on the active query.
  async function setMcpPermissionModeOverride(session, serverName, mode) {
    if (!session || !session.queryInstance) return;
    try {
      // Route through QueryHandle (works for both in-process and worker paths)
      await session.queryInstance.setMcpPermissionModeOverride(serverName, mode);
    } catch (e) {
      send({ type: "error", text: "Failed to set MCP permission mode: " + (e.message || e) });
    }
  }

  // --- @Mention: persistent read-only session for a mentioned Mate ---
  // Creates a mention session that can be reused across multiple mentions
  // within a conversation flow (session continuity).
  async function createMentionSession(opts) {
    // opts: { vendor, linuxUser, claudeMd, initialContext, initialMessage, onDelta, onDone, onError, onActivity }
    var abortController = new AbortController();

    // Current response callbacks (swapped on each pushMessage)
    var currentOnDelta = opts.onDelta;
    var currentOnDone = opts.onDone;
    var currentOnError = opts.onError;
    var currentOnActivity = opts.onActivity || null;
    var responseFullText = "";
    var responseStreamedText = false;
    var mentionBlocks = {};
    var alive = true;

    // Use the mate's vendor adapter if specified, otherwise default
    var mentionAdapter = (opts.vendor && adapters[opts.vendor]) || adapter;

    var handle;
    try {
      handle = await mentionAdapter.createQuery({
        cwd: cwd,
        linuxUser: opts.linuxUser || undefined,
        env: getRuntimeEnv(opts.session || { linuxUser: opts.linuxUser || null }),
        systemPrompt: opts.claudeMd,
        model: opts.model || undefined,
        toolServers: opts.includeMcpServers ? (mergeMcpServers(getMcpServers(), getRemoteMcpServers) || undefined) : undefined,
        abortController: abortController,
        canUseTool: opts.canUseTool || function (toolName, input) {
          var whitelisted = checkToolWhitelist(toolName, input);
          if (whitelisted) {
            return Promise.resolve(whitelisted);
          }
          return Promise.resolve({
            behavior: "deny",
            message: "Read-only access. You cannot make changes via @mention.",
          });
        },
        adapterOptions: {
          CLAUDE: {
            settingSources: ["user"],
            includePartialMessages: true,
          },
        },
      });
    } catch (e) {
      opts.onError("Failed to create mention query: " + (e.message || e));
      return null;
    }
    var query = handle;

    // Push the initial message (context + question, with optional images)
    var initialPrompt = opts.initialContext + "\n\n" + opts.initialMessage;
    handle.pushMessage(initialPrompt, opts.initialImages || null);

    // Background stream processing loop (consumes flattened yokeType events)
    (async function () {
      try {
        for await (var msg of query) {
          // Track content blocks for activity reporting
          if (msg.yokeType === "thinking_start") {
            mentionBlocks[msg.blockId] = { type: "thinking" };
            if (currentOnActivity) currentOnActivity("thinking");
          } else if (msg.yokeType === "tool_start") {
            mentionBlocks[msg.blockId] = { type: "tool_use", name: msg.toolName, inputJson: "" };
            var toolLabel = msg.toolName;
            if (toolLabel === "Read") toolLabel = "Reading file...";
            else if (toolLabel === "Grep") toolLabel = "Searching code...";
            else if (toolLabel === "Glob") toolLabel = "Finding files...";
            if (currentOnActivity) currentOnActivity(toolLabel);
          } else if (msg.yokeType === "text_start") {
            mentionBlocks[msg.blockId] = { type: "text" };

          } else if (msg.yokeType === "text_delta" && typeof msg.text === "string") {
            responseStreamedText = true;
            responseFullText += msg.text;
            if (currentOnActivity) currentOnActivity(null);
            if (currentOnDelta) currentOnDelta(msg.text);
          } else if (msg.yokeType === "tool_input_delta" && mentionBlocks[msg.blockId]) {
            mentionBlocks[msg.blockId].inputJson += msg.partialJson;

          } else if (msg.yokeType === "block_stop") {
            var blk = mentionBlocks[msg.blockId];
            if (blk && blk.type === "tool_use") {
              var toolInput = {};
              try { toolInput = JSON.parse(blk.inputJson); } catch (e) {}
              if (blk.name === "Read" && toolInput.file_path) {
                var fname = toolInput.file_path.split(/[/\\]/).pop();
                if (currentOnActivity) currentOnActivity("Reading " + fname + "...");
              } else if (blk.name === "Grep" && toolInput.pattern) {
                if (currentOnActivity) currentOnActivity("Searching: " + toolInput.pattern.substring(0, 30) + "...");
              } else if (blk.name === "Glob" && toolInput.pattern) {
                if (currentOnActivity) currentOnActivity("Finding: " + toolInput.pattern.substring(0, 30) + "...");
              }
            }
            delete mentionBlocks[msg.blockId];

          } else if (msg.yokeType === "message" && msg.messageRole === "assistant" && !responseStreamedText && msg.content) {
            // Fallback: if text was not streamed via deltas, extract from assistant message
            var content = msg.content;
            if (Array.isArray(content)) {
              for (var ci = 0; ci < content.length; ci++) {
                if (content[ci].type === "text" && content[ci].text) {
                  responseFullText += content[ci].text;
                  if (currentOnDelta) currentOnDelta(content[ci].text);
                }
              }
            }

          } else if (msg.yokeType === "result") {
            // One response complete. Signal done and reset for next message.
            if (currentOnActivity) currentOnActivity(null);
            var doneRef = currentOnDone;
            if (doneRef) {
              doneRef(responseFullText);
            }
            // Only reset if pushMessage was not called during onDone
            // (pushMessage swaps callbacks and resets state itself)
            if (currentOnDone === doneRef) {
              currentOnDelta = null;
              currentOnDone = null;
              currentOnError = null;
              currentOnActivity = null;
              mentionBlocks = {};
              responseFullText = "";
              responseStreamedText = false;
            }
          }
        }
      } catch (err) {
        if (currentOnError) {
          if (err.name === "AbortError" || (abortController && abortController.signal.aborted)) {
            currentOnError("Mention query was cancelled.");
          } else {
            currentOnError(err.message || String(err));
          }
        }
      }
      alive = false;
    })();

    return {
      // Push a follow-up message to the existing mention session
      pushMessage: function (text, callbacks, images) {
        currentOnDelta = callbacks.onDelta;
        currentOnDone = callbacks.onDone;
        currentOnError = callbacks.onError;
        currentOnActivity = callbacks.onActivity || null;
        mentionBlocks = {};
        responseFullText = "";
        responseStreamedText = false;
        handle.pushMessage(text, images || null);
      },
      abort: function () {
        try { abortController.abort(); } catch (e) {}
      },
      close: function () {
        alive = false;
        try { handle.close(); } catch (e) {}
      },
      isAlive: function () { return alive; },
    };
  }

  return {
    createMessageQueue: createMessageQueue,
    processSDKMessage: processSDKMessage,
    checkToolWhitelist: checkToolWhitelist,
    handleCanUseTool: handleCanUseTool,
    handleElicitation: handleElicitation,
    processQueryStream: processQueryStream,
    getOrCreateRewindQuery: getOrCreateRewindQuery,
    rewindPreview: rewindPreview,
    rewindExecuteFiles: rewindExecuteFiles,
    rollbackConversation: rollbackConversation,
    forkSession: forkSessionUnified,
    startQuery: startQuery,
    pushMessage: pushMessage,
    refreshSessionRuntime: refreshSessionRuntime,
    refreshEnvironmentRuntime: refreshEnvironmentRuntime,
    setModel: setModel,
    setEffort: setEffort,
    setPermissionMode: setPermissionMode,
    isClaudeProcess: isClaudeProcess,
    permissionPushTitle: permissionPushTitle,
    permissionPushBody: permissionPushBody,
    warmup: warmup,
    stopTask: stopTask,
    reloadSkills: reloadSkills,
    setMcpPermissionModeOverride: setMcpPermissionModeOverride,
    createMentionSession: createMentionSession,
    startIdleReaper: startIdleReaper,
    stopIdleReaper: stopIdleReaper,
  };
}

module.exports = { createSDKBridge, createMessageQueue };
