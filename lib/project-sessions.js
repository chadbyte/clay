var serverSettingsMessages = require("./project-server-settings");
var fs = require("fs");
var path = require("path");
var { execFileSync } = require("child_process");
var providerSettings = require("./yoke/settings");
var updateSnooze = require("./update-snooze");
var yoke = require("./yoke");
var sessionVisibility = require("./session-visibility");
var contextUsageModule = require("./context-usage");
var sessionDeleteModule = require("./project-session-delete");
var sessionFoldersModule = require("./project-session-folders");
var elicitationResponse = require("./project-elicitation-response");
var sessionCreationModule = require("./project-session-creation");
var vendorUsageOverviewModule = require("./vendor-usage-overview");

function vendorSupportsTui(vendor) {
  var info = yoke.getVendorInfo(vendor);
  return !!(info && info.sessionModes.indexOf("tui") !== -1);
}

function catalogHasModel(models, value) {
  for (var i = 0; i < (models || []).length; i++) {
    var model = models[i];
    if (typeof model === "string" && model === value) return true;
    if (model && (model.value === value || model.id === value || model.resolvedModel === value)) return true;
  }
  return false;
}

function catalogSupportsEffort(models, modelValue, effort, vendorLevels) {
  if (!effort) return true;
  for (var i = 0; i < (models || []).length; i++) {
    var model = models[i];
    var value = typeof model === "string" ? model : model && (model.value || model.id || model.resolvedModel);
    if (value !== modelValue) continue;
    if (model && Array.isArray(model.supportedEffortLevels) && model.supportedEffortLevels.length) return model.supportedEffortLevels.indexOf(effort) !== -1;
    break;
  }
  return (vendorLevels || []).indexOf(effort) !== -1;
}

// Format a user's answer to an ask_user_questions card as a plain user
// message so the MCP path can feed it back to the agent on the next turn.
// The agent sees its own question text alongside the selected answer(s),
// which keeps the connection explicit: a bare "Phase 0" with no context
// reads as a non-sequitur to the model and triggers "I don't see an
// answer" responses, especially when a turn break sits between the tool
// call and this message.
function formatAskUserAnswerAsMessage(input, answers) {
  var questions = (input && Array.isArray(input.questions)) ? input.questions : [];
  if (questions.length === 0) {
    // Shouldn't happen, but be defensive.
    try { return "(answered with: " + JSON.stringify(answers || {}) + ")"; }
    catch (e) { return "(answered)"; }
  }
  var lines = [];
  for (var i = 0; i < questions.length; i++) {
    var q = questions[i];
    var qText = (q && q.question) ? q.question : ("Question " + (i + 1));
    var ans = (answers && answers[i] != null) ? String(answers[i]) : "";
    if (!ans) continue;
    lines.push("- " + qText + " → " + ans);
  }
  if (lines.length === 0) return "(no answer provided)";
  // Prefix tells the model "this is a structured answer to your previous
  // AskUserQuestion call", which the bare "Q → A" alone doesn't make
  // unambiguous when read out of context.
  return "[Answer to your AskUserQuestion]\n" + lines.join("\n");
}

/**
 * Attach session management, config, project management, and mid-section
 * message handlers to a project context.
 *
 * ctx fields:
 *   cwd, slug, isMate, osUsers, debug, dangerouslySkipPermissions, currentVersion,
 *   sm, sdk, tm, clients,
 *   send, sendTo, sendToAdmins, sendToSession, sendToSessionOthers,
 *   opts, usersModule, userPresence, matesModule, pushModule,
 *   getSessionForWs, getLinuxUserForSession, ensureProjectAccessForSession, getOsUserInfoForWs,
 *   hydrateImageRefs, onProcessingChanged, broadcastPresence,
 *   adapter, getProjectList, getProjectCount, getScheduleCount,
 *   moveScheduleToProject, moveAllSchedulesToProject, getHubSchedules,
 *   fetchVersion, isNewer, onCreateWorktree, IGNORED_DIRS,
 *   scheduleMessage, cancelScheduledMessage,
 *   getProjectOwnerId, setProjectOwnerId,
 *   getUpdateChannel, setUpdateChannel,
 *   getLatestVersion, setLatestVersion
 */
function attachSessions(ctx) {
  var mateDefaultsToken = {};
  var contextUsage = contextUsageModule.attachContextUsage(ctx);
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var osUsers = ctx.osUsers;
  var dangerouslySkipPermissions = ctx.dangerouslySkipPermissions === true;
  var currentVersion = ctx.currentVersion;
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var tm = ctx.tm;
  var clients = ctx.clients;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var sendToAdmins = ctx.sendToAdmins;
  var broadcastUpdateAvailable = ctx.broadcastUpdateAvailable || function () {};
  var broadcastUpdateStarted = ctx.broadcastUpdateStarted || function () {};
  var isDriverOperatedSession = ctx.isDriverOperatedSession || function () { return false; };
  var sendToUpdateUser = ctx.sendToUpdateUser || function () {};
  var sendToSession = ctx.sendToSession;
  var sendToSessionOthers = ctx.sendToSessionOthers;
  var opts = ctx.opts;
  var usersModule = ctx.usersModule;
  var getProjectAccess = ctx.getProjectAccess || function () { return { visibility: "public" }; };
  var userPresence = ctx.userPresence;
  var pushModule = ctx.pushModule;
  var getSessionForWs = ctx.getSessionForWs;
  var getLinuxUserForSession = ctx.getLinuxUserForSession;
  var ensureProjectAccessForSession = ctx.ensureProjectAccessForSession;
  var getOsUserInfoForWs = ctx.getOsUserInfoForWs;
  var hydrateSkillCatalog = ctx.hydrateSkillCatalog || function () { return []; };
  var sessionActions = require("./project-session-actions").attachSessionActions(ctx);
  var sessionVendor = require("./project-session-vendor").attachSessionVendor(ctx);
  var sessionRuntime = require("./project-session-runtime-actions").attachSessionRuntimeActions({ sm: sm, tm: tm, prepareGui: prepareTuiSessionForGuiView, isPendingQueuePaused: ctx.isPendingQueuePaused,
    publishGui: function (session) {
      clients.forEach(function (ws) {
        if (ws.readyState !== 1 || ws._clayActiveSession !== session.localId) return;
        if (usersModule.isMultiUser() && (!ws._clayUser || !usersModule.findUserById(ws._clayUser.id) || !usersModule.canAccessProject(ws._clayUser.id, getProjectAccess()) || !usersModule.canAccessSession(ws._clayUser.id, session, getProjectAccess()))) return;
        sm.switchSession(session.localId, ws, ctx.hydrateImageRefs);
      });
    },
  });
  function stopSession(session, actor) {
    if (!session) return false;
    sessionActions.stop(session, actor);
    return true;
  }
  var hydrateImageRefs = ctx.hydrateImageRefs;
  var onProcessingChanged = ctx.onProcessingChanged;
  var broadcastPresence = ctx.broadcastPresence;
  var adapter = ctx.adapter;
  var fullAccessService = ctx.fullAccessService;
  var autonomousRun = ctx.autonomousRun;

  function ownsSearchSession(ws, session) {
    if (!session) return false;
    if (usersModule && typeof usersModule.isMultiUser === "function" && usersModule.isMultiUser()) {
      return !!(ws && ws._clayUser && usersModule.canAccessSession(ws._clayUser.id, session, getProjectAccess()));
    }
    return !session.ownerId;
  }

  function respondToAskUser(session, msg, ws) {
    if (!session || !msg || !msg.toolId) return false;
    var toolId = msg.toolId;
    var answers = msg.answers || {};
    var pending = session.pendingAskUser && session.pendingAskUser[toolId];
    if (!pending) return false;
    if (pending.request && ["mcp-import", "product-control"].indexOf(pending.request.source) >= 0 &&
        (typeof pending.request.authorizeResponse !== "function" || !pending.request.authorizeResponse(ws))) return false;
    if (pending.request && ["work-primary", "mate-schedule"].indexOf(pending.request.source) >= 0 && usersModule.isMultiUser() &&
        (!ws || !ws._clayUser || ws._clayUser.id !== session.ownerId)) return false;
    if (pending.mode === "yoke") {
      try { yoke.userInput.normalizeAnswers(pending.request.questions, answers); }
      catch (e) { return false; }
    }
    delete session.pendingAskUser[toolId];
    if (autonomousRun) autonomousRun.onUserAnswer(session);
    sm.sendAndRecord(session, { type: "ask_user_answered", toolId: toolId, answers: answers });
    if (pending.mode === "yoke" && typeof pending.respond === "function") {
      pending.respond(answers);
    } else if (pending.mode === "mcp") {
      var answerText = formatAskUserAnswerAsMessage(pending.input, answers);
      var userMsg = { type: "user_message", text: answerText, askUserAnswer: true };
      session.history.push(userMsg);
      sm.appendToSessionFile(session, userMsg);
      sendToSession(session.localId, userMsg);
      if (!session.isProcessing) {
        session.isProcessing = true;
        onProcessingChanged();
        session.sentToolResults = {};
        sendToSession(session.localId, { type: "status", status: "processing" });
        if (!session.queryInstance && !session.worker) sdk.startQuery(session, answerText, undefined, ensureProjectAccessForSession(session));
        else sdk.pushMessage(session, answerText);
      } else {
        sdk.pushMessage(session, answerText);
      }
    } else {
      pending.resolve({ behavior: "deny", message: formatAskUserAnswerAsMessage(pending.input, answers) });
    }
    return true;
  }

  function cancelPendingAskUser(session, reason) {
    var pendingMap = session && session.pendingAskUser ? session.pendingAskUser : {};
    Object.keys(pendingMap).forEach(function (toolId) {
      var pending = pendingMap[toolId];
      if (pending && pending.respond && typeof pending.respond.cancel === "function") pending.respond.cancel(reason || "Cancelled");
      else if (pending && typeof pending.resolve === "function") pending.resolve({ behavior: "deny", message: reason || "Cancelled" });
    });
    if (session) session.pendingAskUser = {};
  }
  var getProjectList = ctx.getProjectList;
  var getProjectCount = ctx.getProjectCount;
  var getScheduleCount = ctx.getScheduleCount;
  var moveScheduleToProject = ctx.moveScheduleToProject;
  var moveAllSchedulesToProject = ctx.moveAllSchedulesToProject;
  var getHubSchedules = ctx.getHubSchedules;
  var fetchVersion = ctx.fetchVersion;
  var isNewer = ctx.isNewer;
  var onCreateWorktree = ctx.onCreateWorktree;
  var IGNORED_DIRS = ctx.IGNORED_DIRS;
  var scheduleMessage = ctx.scheduleMessage;
  var cancelScheduledMessage = ctx.cancelScheduledMessage;
  var getProjectOwnerId = ctx.getProjectOwnerId;
  var setProjectOwnerId = ctx.setProjectOwnerId;
  var getUpdateChannel = ctx.getUpdateChannel;
  var setUpdateChannel = ctx.setUpdateChannel;
  var getLatestVersion = ctx.getLatestVersion;
  var setLatestVersion = ctx.setLatestVersion;
  var loadContextSources = ctx.loadContextSources;

  var sessionHistory = require("./project-session-history-actions").attachSessionHistoryActions(Object.assign({}, ctx, {
    resolveSessionHome: resolveSessionHome, cancelPendingAskUser: cancelPendingAskUser,
  }));

  function canAccessProjectSlug(ws, targetSlug) {
    if (!targetSlug) return false;
    if (!usersModule || typeof usersModule.isMultiUser !== "function" || !usersModule.isMultiUser()) return true;
    var userId = ws && ws._clayUser ? ws._clayUser.id : null;
    if (!userId || typeof opts.canAccessProjectSlug !== "function") return false;
    return opts.canAccessProjectSlug(userId, targetSlug) === true;
  }

  // Resolve the home directory where Claude Code writes JSONL for a
  // given session. In OS-isolation mode each Clay user runs as a real
  // Linux account so JSONL lives under /home/clay-name; for single-user
  // installs we fall back to the daemon's own home.
  function resolveSessionHome(session) {
    var home = null;
    if (osUsers && session && session.ownerId) {
      try {
        var ownerUser = usersModule.findUserById ? usersModule.findUserById(session.ownerId) : null;
        if (ownerUser && ownerUser.linuxUser) {
          var info = require("./os-users").resolveOsUserInfo(ownerUser.linuxUser);
          if (info && info.home) home = info.home;
        }
      } catch (e) {}
    }
    return home || require("os").homedir();
  }

  // Watch the per-session jsonl Claude Code writes and mirror its auto /
  // user titles into Clay's session.title. Lets TUI sessions move past the
  // generic "New Session" label without us having to scrape the PTY output.
  // The watcher is started lazily (on TUI session creation / first click
  // after restart) and torn down on session delete via _titleWatcherStop.
  function startTitleWatcher(session) {
    if (!session || !session.cliSessionId) return;
    if (session._titleWatcherStop) return; // already watching
    var watcher;
    try { watcher = require("./yoke/claude-jsonl-watcher"); } catch (e) { return; }
    var home = resolveSessionHome(session);
    var jsonlPath = watcher.jsonlPathFor(home, cwd, session.cliSessionId);
    if (!jsonlPath) return;
    var localId = session.localId;
    var stop = watcher.start(jsonlPath, {
      onTitle: function (title) {
        var s = sm.sessions.get(localId);
        if (!s) return;
        var clean = String(title || "").trim().substring(0, 200);
        if (!clean || s.title === clean) return;
        s.title = clean;
        s.titleAutoGenerated = true;
        try { sm.saveSessionFile(s); } catch (e) {}
        try { sm.broadcastSessionList(); } catch (e) {}
      },
      // Fire a notification with the response preview so the user sees
      // claude's reply surface in the notification center / banner the
      // same way SDK sessions do via response_done. We piggyback on the
      // existing tui_attention type so the Open here / Go to session
      // buttons keep working.
      onResponse: function (text) {
        var s = sm.sessions.get(localId);
        if (!s) return;
        var preview = String(text || "").trim();
        if (!preview) return;
        // First-line preview, capped so the banner stays compact.
        var firstLine = preview.split("\n")[0];
        if (firstLine.length > 200) firstLine = firstLine.substring(0, 200) + "...";
        var termId = (typeof s.runtimeTerminalId === "number")
          ? s.runtimeTerminalId
          : (typeof s.terminalId === "number" ? s.terminalId : null);
        // Adopted external CLI sessions (a standalone `claude` run in this
        // cwd) must not banner: the user is already looking at that terminal.
        // Once they open the session in Clay a PTY attaches and banners
        // become meaningful.
        if (s.adopted && termId === null) return;
        // Don't banner a session someone is already watching — they can see
        // the reply in the TUI. Gate at the source (server) rather than relying
        // on the client's activeSessionId suppression, which isn't reliable for
        // TUI sessions and lets banners pile up for the session in view.
        var beingViewed = false;
        for (var vws of clients) {
          if (vws.readyState === 1 && vws._clayActiveSession === s.localId) {
            beingViewed = true;
            break;
          }
        }
        if (!beingViewed) {
          try {
            ctx._notifications && ctx._notifications.notify("tui_attention", {
              slug: slug,
              sessionId: s.localId,
              ownerId: s.ownerId || null,
              targetUserId: s.ownerId || null,
              title: "Claude responded",
              body: firstLine,
              terminalId: termId,
              sessionTitle: s.title || "",
              cliSessionId: s.cliSessionId || null,
            });
          } catch (e) {}
        }
        // Re-read the assistant text index and broadcast it so any client
        // with this session in view can wire hover-to-grab onto the new
        // message right away. The transcript is small enough that a full
        // re-send beats maintaining a delta protocol.
        try {
          var newIndex = require("./yoke/tui-transcript-index").readAssistantIndex(resolveSessionHome(s), cwd, s.cliSessionId);
          send({
            type: "tui_transcript_state",
            id: s.localId,
            cliSessionId: s.cliSessionId,
            messages: newIndex.messages,
          });
        } catch (e) {}
      },
    });
    session._titleWatcherStop = stop;
  }

  function stopTitleWatcher(session) {
    if (session && typeof session._titleWatcherStop === "function") {
      try { session._titleWatcherStop(); } catch (e) {}
      session._titleWatcherStop = null;
    }
  }

  var sessionDelete = sessionDeleteModule.attachSessionDelete({
    sm: sm, usersModule: usersModule, osUsers: osUsers, tm: tm, sendTo: sendTo,
    getProjectAccess: getProjectAccess, stopTitleWatcher: stopTitleWatcher,
  });

  var sessionFolders = sessionFoldersModule.attachSessionFolders({
    sm: sm, usersModule: usersModule, slug: slug, clients: clients, sendTo: sendTo, getProjectAccess: getProjectAccess,
    sessionDelete: sessionDelete,
  });

  var sessionCreation = sessionCreationModule.attachSessionCreation({
    slug: slug, isMate: isMate, osUsers: osUsers, usersModule: usersModule, opts: opts, sendTo: sendTo, send: send,
    getProjectAccess: getProjectAccess,
    getVendorAvailability: function (ws) { return ctx.getVendorAvailability(ws); },
  });
  var vendorUsage = vendorUsageOverviewModule.attachVendorUsageOverview({
    slug: slug, sm: sm, usersModule: usersModule, clients: clients, sendTo: sendTo, getProjectAccess: getProjectAccess,
    getVendorAvailability: function (ws) { return ctx.getVendorAvailability(ws); },
    adapters: ctx.adapters, osUsers: osUsers, getLinuxUserForWs: ctx.getLinuxUserForWs,
  });
  // Kick off watchers for any TUI sessions already loaded from disk so
  // their titles refresh as soon as Claude Code rewrites the jsonl, even
  // before the user clicks them.
  try {
    sm.sessions.forEach(function (s) {
      if (s.mode === "tui" && s.cliSessionId) startTitleWatcher(s);
    });
  } catch (e) {}

  // Build a PTY onData hook that mirrors SDK-style isProcessing onto the
  // Clay session record. Each output chunk marks isProcessing=true; after
  // 500ms of quiet we flip back to false. State transitions broadcast the
  // session list so the sidebar / icon-strip processing dot picks it up.
  // We track the timer on the session record itself so it can be cleared
  // on delete / mode flip without holding a separate map.
  var TUI_QUIET_MS = 500;
  function makeTuiActivityHook(localId) {
    return function onPtyData() {
      var s = sm.sessions.get(localId);
      if (!s) return;
      if (!s.isProcessing) {
        s.isProcessing = true;
        try { sm.broadcastSessionList(); } catch (e) {}
        try { if (typeof onProcessingChanged === "function") onProcessingChanged(s); } catch (e) {}
      }
      if (s._tuiQuietTimer) clearTimeout(s._tuiQuietTimer);
      s._tuiQuietTimer = setTimeout(function () {
        var s2 = sm.sessions.get(localId);
        if (!s2) return;
        s2._tuiQuietTimer = null;
        if (s2.isProcessing) {
          s2.isProcessing = false;
          try { sm.broadcastSessionList(); } catch (e) {}
          try { if (typeof onProcessingChanged === "function") onProcessingChanged(s2); } catch (e) {}
        }
      }, TUI_QUIET_MS);
    };
  }

  // Resume a legacy terminal session without rewriting its saved origin.
  // The session itself keeps its original mode
  // on disk; we only attach a runtime terminal so xterm can render
  // `claude --resume <cliSessionId>`. When the PTY dies the runtime link
  // clears and the next click can re-attach without converting the session.
  function spawnRuntimeTuiPty(session, ws) {
    if (!tm || !session || !session.cliSessionId) return null;
    if (typeof session.runtimeTerminalId === "number" && tm.has(session.runtimeTerminalId)) {
      // A previous click already spawned one and it's still alive; reuse
      // it. tm.attach will replay scrollback on the new client subscription.
      return session.runtimeTerminalId;
    }
    var sid = session.cliSessionId;
    var localId = session.localId;
    var resumeSkip = session.dangerouslySkipPermissions ? " --dangerously-skip-permissions" : "";
    // Command construction is Claude-specific. Generalize this before any
    // other vendor declares "tui" in the YOKE registry.
    var cmd = "claude --resume " + sid + resumeSkip + "; exit\n";
    var term = tm.create(80, 24, getOsUserInfoForWs(ws), ws, {
      initialInput: cmd,
      kind: "tui-session",
      title: "claude (resume) " + sid.slice(0, 8),
      onExit: function () {
        // Don't delete the session record - the underlying GUI session is
        // still real. Just drop the runtime link so the sidebar/icon can
        // refresh.
        var s = sm.sessions.get(localId);
        if (s) {
          s.runtimeTerminalId = null;
          try { sm.broadcastSessionList(); } catch (e) {}
        }
      },
      onData: makeTuiActivityHook(localId),
    });
    if (term) {
      session.runtimeTerminalId = term.id;
      return term.id;
    }
    return null;
  }

  // Prepare a born-TUI session to be rendered via the SDK GUI chat for the
  // current click. Reads the CLI jsonl transcript (cli-sessions.js),
  // populates session.history, and tears
  // down the PTY. The born-TUI marker (session.mode === 'tui') is kept on
  // disk to preserve the session's origin and compatibility metadata.
  //
  // Idempotent: if the PTY is already gone and history is populated, this
  // is a no-op (avoids re-reading jsonl and re-writing the session file on
  // every click while the user is reading the session in GUI mode).
  function prepareTuiSessionForGuiView(session, options) {
    if (!session || session.cliSessionId == null) return;
    var cliSess;
    try { cliSess = require("./yoke/cli-sessions"); } catch (e) { return; }
    // Re-read whenever the jsonl has changed since the last hydrate (a TUI
    // turn appended messages), not just when history is empty. The earlier
    // "already hydrated" short-circuit kept stale history after a
    // Resume -> chat -> Close cycle (showed A instead of A').
    var home = resolveSessionHome(session);
    var mtime = cliSess.cliSessionFileMtime(home, cwd, session.cliSessionId);
    var fresh = (typeof session.terminalId !== "number") &&
                Array.isArray(session.history) && session.history.length > 0 &&
                session._historyMtime === mtime;
    if (fresh) return;
    var history = null;
    // Synchronous read: switch_session must populate session.history before
    // the session_switched broadcast replays it. readCliSessionHistory is
    // Promise-based and would resolve too late (the transcript came up empty).
    try { history = cliSess.readCliSessionHistorySync(home, cwd, session.cliSessionId); } catch (e) { history = null; }
    if (Array.isArray(history)) {
      session.history = history;
      session._historyMtime = mtime;
    }
    if (typeof session.terminalId === "number" && tm) {
      try { tm.close(session.terminalId); } catch (e) {}
    }
    session.terminalId = null;
    if (!options || !options.deferSave) { try { sm.saveSessionFile(session); } catch (e) {} }
  }

  // Resolve how a session should be presented to a viewer WITHOUT spawning a
  // PTY or broadcasting: set runtimeMode / runtimeTerminalId / tuiSuspended and
  // hydrate the transcript for the read-only and GUI cases. Single source of
  // truth shared by switch_session (which additionally spawns for born-GUI)
  // and the connect/restore path (project-connection.js) so a refreshed
  // born-TUI session shows the same read-only + Resume view as a fresh click.
  function resolveSessionForView(session, ws) {
    if (!session) return;
    if (session.vendor && !vendorSupportsTui(session.vendor)) { session.tuiSuspended = false; return; }
    // Preserve a live runtime across this feature's retirement:
    // another user (or this user in another tab) may be in the session right
    // now, so we join it in whatever mode it is actually running and never
    // convert or kill it. "tui stays tui, gui stays gui."
    var liveNativePty = tm && typeof session.terminalId === "number" && tm.has(session.terminalId);
    var liveResumePty = tm && typeof session.runtimeTerminalId === "number" && tm.has(session.runtimeTerminalId);
    var liveSdk = !!session.queryInstance || !!session.isProcessing;
    if (liveNativePty) {
      session.runtimeMode = "tui";
      session.runtimeTerminalId = session.terminalId;
      session.tuiSuspended = false;
      return;
    }
    if (liveResumePty) {
      session.runtimeMode = "tui";
      session.tuiSuspended = false;
      return;
    }
    if (liveSdk) {
      // Actively running as a GUI/SDK session - show GUI for everyone.
      session.runtimeMode = (session.mode === "tui") ? "gui" : null;
      session.runtimeTerminalId = null;
      session.tuiSuspended = false;
      return;
    }
    // Retired terminal presentation preferences never affect an idle session.
    if (session.mode === "tui") {
      prepareTuiSessionForGuiView(session);
      session.runtimeMode = "gui";
      session.runtimeTerminalId = null;
      session.tuiSuspended = false;
    } else {
      // Chat sessions always retain their SDK presentation.
      session.runtimeMode = null;
      session.tuiSuspended = false;
    }
  }

  function scheduledRequestError(ws, msg, text) {
    if (!msg.requestId) return;
    sendTo(ws, { type: "new_session_result", requestId: String(msg.requestId).substring(0, 200), ok: false, error: text });
  }

  function scheduledSourceIsCurrent(ws, msg, sourceSession) {
    if (!sourceSession || getSessionForWs(ws) !== sourceSession) return false;
    if (typeof msg.sourceSessionId !== "number" || msg.sourceSessionId !== sourceSession.localId) return false;
    if (msg.projectSlug !== slug || msg.mode !== "gui" || msg.forceNew !== true) return false;
    return !!ctx.canCreateScheduledTaskInterview && ctx.canCreateScheduledTaskInterview(ws, sourceSession) === true;
  }

  async function prepareScheduledInterview(ws, msg) {
    var sourceSession = getSessionForWs(ws);
    var actorId = usersModule.isMultiUser() ? (ws._clayUser && ws._clayUser.id) : "default";
    if (!actorId || !scheduledSourceIsCurrent(ws, msg, sourceSession)) throw new Error("Scheduled Tasks is unavailable in the current project session.");
    if (typeof ctx.resolveDefaultAi !== "function") throw new Error("Default AI is unavailable for assisted scheduling.");
    var resolved = await ctx.resolveDefaultAi(ws);
    if (usersModule.isMultiUser()) {
      var liveId = ws._clayUser && ws._clayUser.id;
      if (liveId !== actorId || !usersModule.findUserById(actorId)) throw new Error("Your account is no longer available.");
    }
    if (!scheduledSourceIsCurrent(ws, msg, sourceSession)) throw new Error("Scheduled Tasks is no longer available in the current project session.");
    if (!resolved || !resolved.ready) throw new Error(resolved && resolved.error || "Default AI is unavailable for assisted scheduling.");
    var installed = sm.installedVendors || [];
    var vendorInfo = yoke.getVendorInfo(resolved.vendor);
    if (installed.indexOf(resolved.vendor) === -1 || !vendorInfo || yoke.sessionTools.capability(resolved.vendor).kind === "none") {
      throw new Error("The Default AI provider cannot run the Scheduled Tasks interview tools in this project.");
    }
    var models = resolved.catalog && resolved.catalog.models || [];
    if (!catalogHasModel(models, resolved.model)) throw new Error("The Default AI model is no longer available.");
    if (!catalogSupportsEffort(models, resolved.model, resolved.effort || "", vendorInfo.effortLevels)) throw new Error("The Default AI effort is unavailable for this model.");
    return { sourceSession: sourceSession, actorId: actorId, runtime: resolved };
  }

  function createScheduledInterview(ws, msg, prepared) {
    if (!scheduledSourceIsCurrent(ws, msg, prepared.sourceSession)) throw new Error("Scheduled Tasks is no longer available in the current project session.");
    if (usersModule.isMultiUser()) {
      var liveId = ws._clayUser && ws._clayUser.id;
      if (liveId !== prepared.actorId || !usersModule.findUserById(prepared.actorId)) throw new Error("Your account is no longer available.");
    }
    sm.sweepBlankSessions();
    var sessionOpts = {
      sessionVisibility: "private",
      vendor: prepared.runtime.vendor,
      model: prepared.runtime.model,
      effort: prepared.runtime.effort || null,
      mode: "gui",
    };
    if (usersModule.isMultiUser()) sessionOpts.ownerId = prepared.actorId;
    var newSession = sm.createSession(sessionOpts, ws);
    ws._clayActiveSession = newSession.localId;
    if (msg.requestId) sendTo(ws, { type: "new_session_result", requestId: String(msg.requestId).substring(0, 200), ok: true, sessionId: newSession.localId });
    var presenceKey = ws._clayUser ? ws._clayUser.id : "_default";
    if (!ws._clayPane) userPresence.setPresence(slug, presenceKey, userPresence.sessionIdForPersistence(newSession), null);
    if (usersModule.isMultiUser() && !ws._clayPane) broadcastPresence();
  }

  function handleSessionsMessage(ws, msg) {
    if (serverSettingsMessages.handleServerSettings({ opts: opts, usersModule: usersModule, sendTo: sendTo, send: send }, ws, msg)) return true;
    if (contextUsage.handleMessage(ws, msg)) return true;

    if (msg.type === "push_subscribe") {
      var _pushUserId = ws._clayUser ? ws._clayUser.id : null;
      if (pushModule && msg.subscription) pushModule.addSubscription(msg.subscription, msg.replaceEndpoint, _pushUserId);
      return true;
    }

    if (msg.type === "load_more_history") {
      var session = getSessionForWs(ws);
      if (!session || typeof msg.before !== "number") return true;
      var before = msg.before;
      var targetFrom = typeof msg.target === "number" ? msg.target : before - sm.HISTORY_PAGE_SIZE;
      var from = sm.findTurnBoundary(session.history, Math.max(0, targetFrom));
      var to = before;
      var items = session.history.slice(from, to).map(function (item, index) {
        return Object.assign({}, hydrateImageRefs(require("./yoke/usage").clientEvent(item, session.vendor || "claude")), { _historyIndex: from + index });
      });
      sendTo(ws, {
        type: "history_prepend",
        items: items,
        meta: { from: from, to: to, hasMore: from > 0 },
      });
      return true;
    }

    if (msg.type === "new_session") {
      if (msg.scheduleInterview === true) {
        var scheduledRequestId = typeof msg.requestId === "string" ? msg.requestId.substring(0, 200) : "";
        if (!scheduledRequestId) {
          scheduledRequestError(ws, msg, "A request identity is required for a Scheduled Tasks interview.");
          return true;
        }
        if (!ws._scheduledInterviewSessionRequests) ws._scheduledInterviewSessionRequests = {};
        if (ws._scheduledInterviewSessionRequests[scheduledRequestId]) return true;
        var pendingScheduled = prepareScheduledInterview(ws, msg).then(function (prepared) {
          createScheduledInterview(ws, msg, prepared);
        }).catch(function (error) {
          scheduledRequestError(ws, msg, error.message || String(error));
        }).finally(function () {
          if (ws._scheduledInterviewSessionRequests[scheduledRequestId] === pendingScheduled) delete ws._scheduledInterviewSessionRequests[scheduledRequestId];
        });
        ws._scheduledInterviewSessionRequests[scheduledRequestId] = pendingScheduled;
        return true;
      }
      if (msg.mateDefaults === true && msg._mateDefaultsToken !== mateDefaultsToken) {
        var mateRequestId = typeof msg.requestId === "string" ? msg.requestId.substring(0, 200) : "";
        if (!isMate || !mateRequestId || typeof ctx.resolveMateSessionDefaults !== "function") {
          scheduledRequestError(ws, msg, "Mate defaults are unavailable.");
          return true;
        }
        if (!ws._pendingMateSessionRequests) ws._pendingMateSessionRequests = {};
        if (ws._pendingMateSessionRequests[mateRequestId]) return true;
        var pendingMateSession = Promise.resolve(ctx.resolveMateSessionDefaults(ws)).then(function (resolved) {
          if (!resolved || !resolved.vendor || !resolved.model) throw new Error("The Mate vendor and model are not configured.");
          var resolvedMessage = Object.assign({}, msg, {
            _mateDefaultsToken: mateDefaultsToken,
            vendor: resolved.vendor,
            model: resolved.model,
            effort: resolved.effort || "",
            mode: "gui",
          });
          handleSessionsMessage(ws, resolvedMessage);
        }).catch(function (error) {
          scheduledRequestError(ws, msg, error.message || String(error));
        }).finally(function () {
          if (ws._pendingMateSessionRequests[mateRequestId] === pendingMateSession) delete ws._pendingMateSessionRequests[mateRequestId];
        });
        ws._pendingMateSessionRequests[mateRequestId] = pendingMateSession;
        return true;
      }
      var creationRequestId = typeof msg.requestId === "string" ? msg.requestId.substring(0, 200) : "";
      var creationFailed = function (text) {
        if (creationRequestId) sendTo(ws, { type: "new_session_result", requestId: creationRequestId, ok: false, error: text });
        else sendTo(ws, { type: "error", text: text });
      };
      // The same request id is created at most once per socket.
      if (creationRequestId) {
        if (!ws._createdRequests) ws._createdRequests = [];
        if (ws._createdRequests.indexOf(creationRequestId) !== -1) return true;
        ws._createdRequests.push(creationRequestId);
        if (ws._createdRequests.length > 50) ws._createdRequests.shift();
      }
      // A destination folder is checked before anything is created, so a stale
      // folder refuses the request instead of filing the session elsewhere.
      // An acknowledged creation (the sidebar rows) only runs a provider that is
      // installed and authorized for this caller.
      if (creationRequestId && msg.vendor && !sessionCreation.isInstalled(ws, msg.vendor)) {
        creationFailed("That provider is not installed or authorized.");
        return true;
      }
      var folderCheck = sessionFolders.checkNewSessionFolder(ws, msg.folderId, msg.folderSlug);
      if (!folderCheck.ok) { creationFailed(folderCheck.error); return true; }
      // Opportunistic hygiene: drop blanks that sat untouched past the grace
      // period before deciding whether to reuse or create.
      sm.sweepBlankSessions();
      var sessionOpts = {};
      if (ws._clayUser && usersModule.isMultiUser()) sessionOpts.ownerId = ws._clayUser.id;
      // Only ordinary project conversations may opt into this setting.
      // Scheduled interviews and background/worker creation paths remain explicit.
      var visibilityChoice = sessionVisibility.resolveNewSessionVisibility(getProjectAccess(), msg, isMate);
      if (visibilityChoice.error) {
        scheduledRequestError(ws, msg, visibilityChoice.error);
        if (!msg.requestId) sendTo(ws, { type: "error", text: visibilityChoice.error });
        return true;
      }
      sessionOpts.sessionVisibility = visibilityChoice.visibility;
      if (msg.vendor) sessionOpts.vendor = msg.vendor;
      if (isMate && msg._mateDefaultsToken === mateDefaultsToken) sessionOpts.model = msg.model;
      var newSess;
      var newSessionVendor = sessionOpts.vendor || sm.defaultVendor || "claude";
      var newSessionEffort = isMate && msg._mateDefaultsToken === mateDefaultsToken
        ? (msg.effort || "")
        : ((sm.currentEffortByVendor && sm.currentEffortByVendor[newSessionVendor]) || sm.currentEffort || "medium");
      sessionOpts.effort = yoke.clampEffort(newSessionVendor, newSessionEffort) || null;
      // Reuse an existing blank GUI session instead of stacking another
      // one. A vendor-less blank is acceptable: nothing has happened in it,
      // so stamping the requested vendor is equivalent to a fresh create.
      var reusable = msg.forceNew === true ? null : sm.findReusableBlankSession({
        vendor: sessionOpts.vendor || null,
        ownerId: sessionOpts.ownerId || null,
      });
      if (reusable) {
        if (sessionOpts.vendor && reusable.vendor !== sessionOpts.vendor) reusable.vendor = sessionOpts.vendor;
        if (!reusable.effort) reusable.effort = sessionOpts.effort;
        // Reusable blanks already exist; do not retroactively change them.
        sm.switchSession(reusable.localId, ws);
        newSess = reusable;
      } else {
        newSess = sm.createSession(sessionOpts, ws);
      }
      ws._clayActiveSession = newSess.localId;
      var folderPlaced = msg.folderId === undefined ? null : sessionFolders.placeNewSession(ws, newSess, msg.folderId, msg.folderSlug);
      if (msg.requestId) {
        var created = { type: "new_session_result", requestId: String(msg.requestId).substring(0, 200), ok: true, sessionId: newSess.localId };
        if (folderPlaced !== null) {
          created.folderPlaced = folderPlaced === true;
          created.folderId = msg.folderId === null ? "unfiled" : msg.folderId;
        }
        sendTo(ws, created);
      }
      // Remember the vendor only when the client asked for one explicitly.
      // new_session without a vendor (mate sidebar, notification banner,
      // debate) falls through to the default adapter and must not clobber
      // the user's remembered pick.
      if (msg.vendor && msg._mateDefaultsToken !== mateDefaultsToken && sm.lastVendor !== msg.vendor) {
        sm.lastVendor = msg.vendor;
        if (typeof opts.onSetProjectLastVendor === "function") {
          opts.onSetProjectLastVendor(slug, msg.vendor);
        }
        send({ type: "last_vendor", vendor: msg.vendor });
      }
      var nsPresKey = ws._clayUser ? ws._clayUser.id : "_default";
      if (!ws._clayPane) userPresence.setPresence(slug, nsPresKey, userPresence.sessionIdForPersistence(newSess), null);
      if (usersModule.isMultiUser() && !ws._clayPane) {
        broadcastPresence();
      }
      return true;
    }

    if (msg.type === "set_session_visibility") {
      sessionVisibility.handleChange(ctx, ws, msg);
      return true;
    }

    if (msg.type === "set_project_session_visibility_default") {
      sessionVisibility.handleDefaultChange({
        slug: slug, isMate: isMate, osUsers: osUsers, usersModule: usersModule, getProjectAccess: getProjectAccess,
        opts: opts, sendTo: sendTo,
      }, ws, msg);
      return true;
    }

    if (sessionFolders.handleMessage(ws, msg)) return true;
    if (sessionCreation.handleMessage(ws, msg)) return true;
    if (vendorUsage.handleMessage(ws, msg)) return true;

    if (msg.type === "bulk_delete_sessions") {
      sessionDelete.bulkDeleteSessions(ws, msg);
      return true;
    }

    if (msg.type === "transfer_project_owner") {
      if (isMate) {
        sendTo(ws, { type: "error", text: "Clay and Mate ownership cannot be transferred." });
        return true;
      }
      // Home directory projects: ownership is permanently locked
      if (osUsers && osUsers.length > 0 && /^\/home\/[^/]+\//.test(cwd)) {
        sendTo(ws, { type: "error", text: "Cannot transfer ownership of home directory projects." });
        return true;
      }
      var projectOwnerId = getProjectAccess().ownerId;
      var isProjectOwner = ws._clayUser && projectOwnerId && ws._clayUser.id === projectOwnerId;
      if (!ws._clayUser || !isProjectOwner) {
        sendTo(ws, { type: "error", text: "Only project owners can transfer ownership." });
        return true;
      }
      var targetUser = msg.userId ? usersModule.findUserById(msg.userId) : null;
      if (!targetUser) {
        sendTo(ws, { type: "error", text: "User not found." });
        return true;
      }
      // Persist before publishing runtime ownership.
      if (!opts.onProjectOwnerChanged) return true;
      var savedOwner = opts.onProjectOwnerChanged(slug, targetUser.id);
      if (savedOwner && savedOwner.error) { sendTo(ws, { type: "error", text: savedOwner.error }); return true; }
      setProjectOwnerId(targetUser.id);
      send({ type: "project_owner_changed", ownerId: targetUser.id, ownerName: targetUser.displayName || targetUser.username });
      return true;
    }

    // Note: the old `resume_session` and `list_cli_sessions` WS handlers
    // were removed when CLI sessions started being auto-adopted into the
    // unified session list on server start (see sessions.js
    // adoptOrphanedCliSessions). Click a session in the sidebar instead.

    if (msg.type === "switch_session") {
      var paneActivation = require('./pane-session-activation').begin(ctx, ws, msg);
      if (paneActivation === false) return true;
      if (msg.id && sm.sessions.has(msg.id)) {
        // resolveSessionForView sets runtimeMode / runtimeTerminalId /
        // tuiSuspended (and hydrates the transcript) before sm.switchSession
        // broadcasts session_switched. A live runtime keeps its actual mode
        // for every viewer; idle sessions open in chat. Nothing is spawned here.
        var xmTarget = sm.sessions.get(msg.id);
        if (usersModule.isMultiUser() && (!ws._clayUser || !usersModule.canAccessSession(ws._clayUser.id, xmTarget, getProjectAccess()))) return true;
        if (xmTarget && (!xmTarget.vendor || vendorSupportsTui(xmTarget.vendor))) {
          // Single source of truth: live runtime wins (tui stays tui, gui stays
          // gui); idle legacy sessions hydrate their transcript into chat.
          resolveSessionForView(xmTarget, ws);
        }
        var switchTargetSess = sm.sessions.get(msg.id);
        if (paneActivation && !paneActivation.validate()) return true;
        var switchTargetVendor = switchTargetSess && (switchTargetSess.vendor || sm.defaultVendor || "claude");
        if (switchTargetSess && !switchTargetSess.effort) {
          switchTargetSess.effort = yoke.clampEffort(
            switchTargetVendor,
            (sm.currentEffortByVendor && sm.currentEffortByVendor[switchTargetVendor]) || sm.currentEffort || "medium"
          ) || null;
          sm.saveSessionFile(switchTargetSess);
        }
        // Check access in multi-user mode
        if (usersModule.isMultiUser() && ws._clayUser) {
          var switchTarget = sm.sessions.get(msg.id);
          if (!usersModule.canAccessSession(ws._clayUser.id, switchTarget, { visibility: "public" })) return true;
          sm.switchSession(msg.id, ws, hydrateImageRefs, paneActivation && paneActivation.send, paneActivation && paneActivation.validate);
          if (!ws._clayPane) broadcastPresence();
        } else {
          sm.switchSession(msg.id, ws, hydrateImageRefs, paneActivation && paneActivation.send, paneActivation && paneActivation.validate);
        }
        // Send per-session context sources
        if (typeof loadContextSources === "function") {
          var switchedSources = loadContextSources(slug, msg.id);
          if (paneActivation) paneActivation.send({ type: "context_sources_state", active: switchedSources });
          else sendTo(ws, { type: "context_sources_state", active: switchedSources });
        }
        var swPresKey = ws._clayUser ? ws._clayUser.id : "_default";
        if (!ws._clayPane) userPresence.setPresence(slug, swPresKey, userPresence.sessionIdForPersistence(switchTargetSess), null);
        if (paneActivation) paneActivation.finish();
      }
      return true;
    }

    // Lazy-resume: the user clicked "Resume" on a TUI session shown read-only.
    // Spawn `claude --resume <cliSessionId>` now and re-broadcast
    // session_switched so the client swaps the transcript for the live xterm.
    if (msg.type === "resume_tui_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        var rtTarget = sm.sessions.get(msg.id);
        var rtOk = rtTarget && (!rtTarget.vendor || vendorSupportsTui(rtTarget.vendor)) &&
                   rtTarget.cliSessionId && tm;
        if (rtOk) {
          if (usersModule.isMultiUser() && ws._clayUser &&
              !usersModule.canAccessSession(ws._clayUser.id, rtTarget, { visibility: "public" })) {
            return true;
          }
          var rtRid = spawnRuntimeTuiPty(rtTarget, ws);
          if (typeof rtRid === "number") {
            rtTarget.runtimeMode = "tui";
            rtTarget.runtimeTerminalId = rtRid;
            rtTarget.tuiSuspended = false;
            startTitleWatcher(rtTarget);
          }
          ws._clayActiveSession = msg.id;
          sm.switchSession(msg.id, ws, hydrateImageRefs);
        }
      }
      return true;
    }

    // Explicit Close: the user closed a live TUI session from the title bar.
    // Kill its PTY now (don't wait for the idle sweep) but keep the session -
    // it drops to the read-only transcript + Resume bar, freeing resources
    // immediately while staying resumable.
    if (msg.type === "suspend_tui_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        var stTarget = sm.sessions.get(msg.id);
        var stOk = stTarget && (!stTarget.vendor || vendorSupportsTui(stTarget.vendor));
        if (stOk && (!usersModule.isMultiUser() || !ws._clayUser ||
            usersModule.canAccessSession(ws._clayUser.id, stTarget, { visibility: "public" }))) {
          if (tm) {
            var stTid = (typeof stTarget.terminalId === "number") ? stTarget.terminalId : null;
            var stRid = (typeof stTarget.runtimeTerminalId === "number") ? stTarget.runtimeTerminalId : null;
            if (stTid != null && tm.has(stTid)) { tm.markReclaimed(stTid); tm.close(stTid); }
            if (stRid != null && tm.has(stRid)) { tm.markReclaimed(stRid); tm.close(stRid); }
          }
          stTarget.terminalId = null;
          stTarget.runtimeTerminalId = null;
          // Hydrate the transcript so the read-only view has content, then
          // re-broadcast as suspended.
          prepareTuiSessionForGuiView(stTarget);
          stTarget.runtimeMode = null;
          stTarget.tuiSuspended = true;
          ws._clayActiveSession = msg.id;
          sm.switchSession(msg.id, ws, hydrateImageRefs);
        }
      }
      return true;
    }

    // Client asks for the assistant text index of a Claude TUI session so
    // it can wire hover-to-grab on the rendered terminal output. Only the
    // raw markdown of assistant text messages is returned — no tool calls,
    // no user prompts. Codex sessions skip the feature.
    if (msg.type === "tui_transcript_request") {
      var tprId = msg.id;
      var tprSess = (tprId && sm.sessions.has(tprId)) ? sm.sessions.get(tprId) : null;
      if (!tprSess || !tprSess.cliSessionId || tprSess.mode !== "tui") return true;
      if (tprSess.vendor && !vendorSupportsTui(tprSess.vendor)) return true;
      if (usersModule.isMultiUser() && ws._clayUser
          && !usersModule.canAccessSession(ws._clayUser.id, tprSess, { visibility: "public" })) {
        return true;
      }
      try {
        var tprIndex = require("./yoke/tui-transcript-index").readAssistantIndex(resolveSessionHome(tprSess), cwd, tprSess.cliSessionId);
        sendTo(ws, {
          type: "tui_transcript_state",
          id: tprId,
          cliSessionId: tprSess.cliSessionId,
          messages: tprIndex.messages,
        });
      } catch (e) {}
      return true;
    }

    if (msg.type === "set_mate_dm") {
      // Only store mateDm on non-mate projects (main project presence).
      // Mate projects should never hold mateDm to avoid circular restore loops.
      if (!isMate) {
        var dmPresKey = ws._clayUser ? ws._clayUser.id : "_default";
        userPresence.setMateDm(slug, dmPresKey, msg.mateId || null);
      }
      return true;
    }

    if (msg.type === "delete_session") {
      sessionDelete.deleteSession(ws, msg);
      return true;
    }

    if (msg.type === "rename_session") {
      if (msg.id && sm.sessions.has(msg.id) && msg.title) {
        var s = sm.sessions.get(msg.id);
        if (usersModule.isMultiUser() && (!ws._clayUser ||
            !usersModule.canAccessSession(ws._clayUser.id, s, getProjectAccess()))) return true;
        sessionActions.rename(s, String(msg.title).substring(0, 100));
      }
      return true;
    }

    if (msg.type === "search_sessions") {
      var results = sm.searchSessions(msg.query || "", function (session) {
        return ownsSearchSession(ws, session);
      });
      sendTo(ws, { type: "search_results", query: msg.query || "", results: results });
      return true;
    }

    if (msg.type === "search_session_content") {
      var targetSession = msg.id ? sm.sessions.get(msg.id) : getSessionForWs(ws);
      if (!ownsSearchSession(ws, targetSession)) {
        sendTo(ws, { type: "search_content_results", query: msg.query || "", sessionId: msg.id || null, hits: [], total: 0 });
        return true;
      }
      var contentResults = sm.searchSessionContent(targetSession.localId, msg.query || "");
      var searchResp = { type: "search_content_results", query: msg.query || "", sessionId: targetSession.localId, hits: contentResults.hits, total: contentResults.total };
      if (msg.source) searchResp.source = msg.source;
      sendTo(ws, searchResp);
      return true;
    }

    if (msg.type === "set_update_channel") {
      if (!updateSnooze.isUpdateAdmin(ws, usersModule)) { sendTo(ws, { type: "set_update_channel_result", ok: false, error: "Administrator access required." }); return true; }
      var newChannel = msg.channel === "beta" ? "beta" : "stable";
      try {
        if (typeof opts.onSetUpdateChannel !== "function") throw new Error("Release channel cannot be saved in this runtime.");
        opts.onSetUpdateChannel(newChannel);
        setUpdateChannel(newChannel);
        setLatestVersion(null);
        sendTo(ws, { type: "set_update_channel_result", ok: true, timing: "Future update checks use this channel." });
      } catch (error) {
        sendTo(ws, { type: "set_update_channel_result", ok: false, error: error.message });
        return true;
      }
      // Re-fetch with new channel and broadcast to admin clients, honouring
      // any snooze each of them has on the version that comes back.
      fetchVersion(newChannel).then(function (v) {
        if (v && isNewer(v, currentVersion)) {
          setLatestVersion(v);
          broadcastUpdateAvailable(v);
        }
      }).catch(function () {});
      return true;
    }

    if (msg.type === "check_update") {
      if (!updateSnooze.isUpdateAdmin(ws, usersModule)) return true;
      // A manual check is the user deliberately re-engaging, so it answers
      // truthfully and ends any snooze rather than reporting an update it
      // would then refuse to show.
      updateSnooze.clearSnooze(updateSnooze.userKeyFor(ws, usersModule));
      var updateChannel = getUpdateChannel();
      fetchVersion(updateChannel).then(function (v) {
        if (v && isNewer(v, currentVersion)) {
          setLatestVersion(v);
          sendTo(ws, { type: "update_available", version: v });
        } else {
          sendTo(ws, { type: "up_to_date", version: currentVersion });
        }
      }).catch(function () { sendTo(ws, { type: "update_check_failed", error: "Could not check for updates. Retry when the server can reach the release service." }); });
      return true;
    }

    if (msg.type === "update_snooze") {
      if (!updateSnooze.isUpdateAdmin(ws, usersModule)) return true;
      var snoozeKey = updateSnooze.userKeyFor(ws, usersModule);
      // The target is always the server's own latest version. A version named
      // in the payload is ignored, as are any timestamps or user ids.
      var snoozeResult = updateSnooze.snooze(
        snoozeKey,
        getLatestVersion(),
        msg.duration,
        Date.now(),
        msg.tzOffsetMinutes
      );
      if (!snoozeResult.ok) {
        sendTo(ws, { type: "update_snoozed", ok: false, error: snoozeResult.error });
        return true;
      }
      // Every live connection of this user, so a second device stops showing
      // a banner the user has already dealt with.
      sendToUpdateUser(snoozeKey, {
        type: "update_snoozed",
        ok: true,
        version: snoozeResult.version,
        until: snoozeResult.until,
        duration: snoozeResult.duration,
      });
      return true;
    }

    if (msg.type === "update_now") {
      if (!updateSnooze.isUpdateAdmin(ws, usersModule)) return true;
      // Installing makes any snooze moot; drop it so the record does not
      // outlive the version it referred to.
      updateSnooze.clearSnooze(updateSnooze.userKeyFor(ws, usersModule));
      broadcastUpdateStarted(getLatestVersion());
      var _ipc = require("./ipc");
      var _config = require("./config");
      _ipc.sendIPCCommand(_config.socketPath(), { cmd: "update" });
      return true;
    }

    if (msg.type === "process_stats") {
      var sessionCount = sm.sessions.size;
      var processingCount = 0;
      sm.sessions.forEach(function (s) {
        if (s.isProcessing) processingCount++;
      });
      var mem = process.memoryUsage();
      sendTo(ws, {
        type: "process_stats",
        pid: process.pid,
        uptime: process.uptime(),
        memory: {
          rss: mem.rss,
          heapUsed: mem.heapUsed,
          heapTotal: mem.heapTotal,
          external: mem.external,
        },
        sessions: sessionCount,
        processing: processingCount,
        clients: clients.size,
        terminals: tm.list().length,
      });
      return true;
    }

    if (msg.type === "stop") {
      var session = getSessionForWs(ws);
      if (msg.sessionId != null || msg.sessionOriginId != null) {
        session = sm.sessions.get(msg.sessionId);
        if (!session || session.sessionOriginId !== msg.sessionOriginId ||
            !usersModule.isMultiUser() && session.ownerId ||
            usersModule.isMultiUser() && (!ws._clayUser || !usersModule.canAccessSession(ws._clayUser.id, session, getProjectAccess()))) return true;
      }
      stopSession(session, ws && ws._clayUser);
      return true;
    }

    if (msg.type === "stop_task") {
      if (msg.taskId) {
        sdk.stopTask(msg.taskId);
      }
      return true;
    }

    if (msg.type === "kill_process") {
      var pid = msg.pid;
      if (!pid || typeof pid !== "number") return true;
      // Verify target is actually a claude process before killing
      if (!sdk.isProviderProcess(pid, getSessionForWs(ws))) {
        console.error("[project] Refused to kill PID " + pid + ": not a verified provider process");
        sendTo(ws, { type: "error", text: "Process " + pid + " is not a verified provider process." });
        return true;
      }
      try {
        process.kill(pid, "SIGTERM");
        console.log("[project] Sent SIGTERM to conflicting provider process PID " + pid);
        sendTo(ws, { type: "process_killed", pid: pid });
      } catch (e) {
        console.error("[project] Failed to kill PID " + pid + ":", e.message);
        sendTo(ws, { type: "error", text: "Failed to kill process " + pid + ": " + (e.message || e) });
      }
      return true;
    }

    if (msg.type === "reload_skills") {
      var session = getSessionForWs(ws);
      if (session && sdk.reloadSkills) {
        sdk.reloadSkills(session);
      }
      return true;
    }

    if (msg.type === "set_mcp_permission_mode_override") {
      var mcpRequestId = typeof msg.requestId === "string" && msg.requestId.length <= 128 ? msg.requestId : null;
      var mcpProjectSlug = typeof msg.projectSlug === "string" && msg.projectSlug.length <= 256 ? msg.projectSlug : null;
      var mcpSessionId = Number(msg.sessionId);
      var mcpServerName = typeof msg.serverName === "string" && msg.serverName.length > 0 && msg.serverName.length <= 256 ? msg.serverName : null;
      var mcpSession = Number.isSafeInteger(mcpSessionId) ? sm.sessions.get(mcpSessionId) : null;
      function mcpPermissionResult(ok, error, overrides) {
        sendTo(ws, {
          type: "mcp_permission_mode_result",
          ok: ok === true,
          requestId: mcpRequestId,
          projectSlug: mcpProjectSlug,
          sessionId: Number.isSafeInteger(mcpSessionId) ? mcpSessionId : null,
          serverName: mcpServerName,
          mode: ok ? mcpMode : null,
          mcpPermissionModeOverrides: ok ? overrides || {} : {},
          error: error || null,
        });
      }
      var mcpMode = msg.mode === "auto" || msg.mode === "default" ? msg.mode : null;
      var mcpModeValid = msg.mode == null || msg.mode === "" || msg.mode === "auto" || msg.mode === "default";
      if (mcpProjectSlug !== slug) {
        mcpPermissionResult(false, "The AI review request belongs to a different project.");
        return true;
      }
      if (!mcpServerName || !mcpModeValid) {
        mcpPermissionResult(false, "The AI review request is invalid.");
        return true;
      }
      var mcpRuntimeMode = mcpSession && (mcpSession.runtimeMode || mcpSession.mode || "gui");
      if (!mcpSession || !ownsSearchSession(ws, mcpSession) || mcpRuntimeMode !== "gui" || isDriverOperatedSession(mcpSession)) {
        mcpPermissionResult(false, "AI review controls are only available on an accessible Driver GUI session.");
        return true;
      }
      var mcpApplicable = (mcpSession.effectivePermissionMode === "auto" || mcpSession.effectivePermissionMode === "bypassPermissions") &&
        mcpSession.permissionCapabilities && mcpSession.permissionCapabilities.mcpOverride === true && typeof sdk.setMcpPermissionModeOverride === "function";
      if (!mcpApplicable) {
        mcpPermissionResult(false, "AI review controls are not available for this session.");
        return true;
      }
      (async function () {
        try {
          var result = await sdk.setMcpPermissionModeOverride(mcpSession, mcpServerName, mcpMode);
          if (!result || result.ok === false) {
            mcpPermissionResult(false, result && result.error || "Failed to change AI review policy.");
            return;
          }
          mcpSession.mcpPermissionModeOverrides = mcpSession.mcpPermissionModeOverrides || {};
          if (mcpMode) mcpSession.mcpPermissionModeOverrides[mcpServerName] = mcpMode;
          else delete mcpSession.mcpPermissionModeOverrides[mcpServerName];
          if (typeof sm.saveSessionFile === "function") sm.saveSessionFile(mcpSession);
          mcpPermissionResult(true, null, mcpSession.mcpPermissionModeOverrides);
        } catch (error) {
          mcpPermissionResult(false, "Failed to change AI review policy: " + (error.message || error));
        }
      })();
      return true;
    }

    if (msg.type === "set_vendor" && msg.vendor) {
      var vendorSession = getSessionForWs(ws);
      if (!vendorSession) return true;
      // Re-selecting the provider of an established thread does not rebind it.
      if (vendorSession.cliSessionId && vendorSession.vendor === msg.vendor) return true;
      try {
        var vendorResult = sessionVendor.setVendor(vendorSession, msg.vendor);
        if (vendorResult.status === "failed") sendTo(ws, { type: "error", text: vendorResult.error });
      }
      catch (error) { sendTo(ws, { type: "error", text: error.message }); }
      return true;
    }

    if (msg.type === "set_server_default_model" && msg.model) {
      if (typeof opts.onSetServerDefaultModel === "function") {
        opts.onSetServerDefaultModel(msg.model);
      }
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return true;
    }

    if (msg.type === "set_project_default_model" && msg.model) {
      if (typeof opts.onSetProjectDefaultModel === "function") {
        opts.onSetProjectDefaultModel(slug, msg.model);
      }
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setModel(session, msg.model);
      }
      return true;
    }

    if (msg.type === "set_permission_mode") {
      var permissionModes = require("./session-permission-mode");
      var requestId = typeof msg.requestId === "string" && msg.requestId.length <= 128 ? msg.requestId : null;
      var requestedProjectSlug = typeof msg.projectSlug === "string" && msg.projectSlug.length <= 256 ? msg.projectSlug : null;
      var requestedSessionId = Number(msg.sessionId);
      var session = Number.isSafeInteger(requestedSessionId) ? sm.sessions.get(requestedSessionId) : null;
      function permissionResult(ok, error, includeState) {
        var state = includeState && session ? permissionModes.clientState(session, sm.currentPermissionMode, sm.defaultVendor) : null;
        sendTo(ws, {
          type: "permission_mode_result",
          ok: ok === true,
          requestId: requestId,
          projectSlug: requestedProjectSlug,
          sessionId: Number.isSafeInteger(requestedSessionId) ? requestedSessionId : null,
          mode: state ? state.requestedPermissionMode : null,
          effectivePermissionMode: state ? state.effectivePermissionMode : null,
          permissionCapabilities: state ? state.permissionCapabilities : null,
          mcpPermissionModeOverrides: state ? state.mcpPermissionModeOverrides : {},
          error: error || null,
        });
      }
      if (requestedProjectSlug !== slug) {
        permissionResult(false, "The permission request belongs to a different project.", false);
        return true;
      }
      if (!session || !ownsSearchSession(ws, session) || isDriverOperatedSession(session)) {
        permissionResult(false, "Permissions can only be changed on an accessible Driver session.", false);
        return true;
      }
      var permissionRuntimeMode = session.runtimeMode || session.mode || "gui";
      if (permissionRuntimeMode !== "gui") {
        permissionResult(false, "Permissions can only be changed on a GUI session.", true);
        return true;
      }
      if (dangerouslySkipPermissions) {
        permissionResult(false, "Skip permissions is forced by the server setting.", true);
        return true;
      }
      var valid = permissionModes.validate(session, msg.mode, sm.defaultVendor);
      if (!valid.ok) { permissionResult(false, valid.error, true); return true; }
      (async function() {
        try {
          await sessionActions.permission(session, valid.mode, requestId);
          permissionResult(true, null, true);
        } catch (error) {
          permissionResult(false, "Failed to change permission mode: " + (error.message || error), true);
        }
      })();
      return true;
    }

    if (msg.type === "set_session_full_access") {
      var fullAccessSession = msg.id ? sm.sessions.get(Number(msg.id)) : getSessionForWs(ws);
      var fullAccessEnabled = msg.enabled === true;
      var fullAccessMode = fullAccessSession && (fullAccessSession.runtimeMode || fullAccessSession.mode || "gui");
      if (!fullAccessSession || fullAccessMode !== "gui" || isDriverOperatedSession(fullAccessSession)) {
        sendTo(ws, { type: "session_full_access_result", ok: false, id: msg.id || null, error: "Skip Permissions is only available for GUI sessions." });
        return true;
      }
      if (usersModule.isMultiUser() && ws._clayUser &&
          !usersModule.canAccessSession(ws._clayUser.id, fullAccessSession, getProjectAccess())) {
        sendTo(ws, { type: "session_full_access_result", ok: false, id: fullAccessSession.localId, error: "You do not have access to this session." });
        return true;
      }

      (async function () {
        try {
          if (!fullAccessEnabled && autonomousRun) await autonomousRun.stopForPermissionChange(fullAccessSession);
          await fullAccessService.setEnabled(fullAccessSession, fullAccessEnabled);
          sendTo(ws, { type: "session_full_access_result", ok: true, id: fullAccessSession.localId, enabled: fullAccessEnabled });
        } catch (e) {
          sendTo(ws, { type: "session_full_access_result", ok: false, id: fullAccessSession.localId, error: "Failed to change Skip Permissions: " + (e.message || e) });
        }
      })();
      return true;
    }

    if (msg.type === "set_server_default_mode" && msg.mode) {
      if (typeof opts.onSetServerDefaultMode === "function") {
        opts.onSetServerDefaultMode(msg.mode);
      }
      sm.currentPermissionMode = msg.mode;
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    if (msg.type === "set_project_default_mode" && msg.mode) {
      if (typeof opts.onSetProjectDefaultMode === "function") {
        opts.onSetProjectDefaultMode(slug, msg.mode);
      }
      sm.currentPermissionMode = msg.mode;
      var session = getSessionForWs(ws);
      if (session) {
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    if (msg.type === "set_effort" && msg.effort) {
      var session = getSessionForWs(ws);
      if (session) {
        var effortVendor = session.vendor || sm.defaultVendor || "claude";
        var sessionEffort = yoke.clampEffort(effortVendor, msg.effort);
        if (!sessionEffort) {
          sendTo(ws, { type: "error", text: "This effort level is not supported by the selected vendor." });
          return true;
        }
        sessionActions.effort(session, sessionEffort).catch(function (e) {
          sendTo(ws, { type: "error", text: "Failed to change reasoning effort: " + (e.message || e) });
        });
      }
      return true;
    }

    if (msg.type === "set_server_default_effort" && msg.effort) {
      if (typeof opts.onSetServerDefaultEffort === "function") {
        opts.onSetServerDefaultEffort(msg.effort);
      }
      sm.currentEffort = msg.effort;
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    if (msg.type === "set_project_default_effort" && msg.effort) {
      if (typeof opts.onSetProjectDefaultEffort === "function") {
        opts.onSetProjectDefaultEffort(slug, msg.effort);
      }
      sm.currentEffort = msg.effort;
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort, betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    if (msg.type === "set_betas") {
      sm.currentBetas = msg.betas || [];
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas, thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    if (msg.type === "set_thinking") {
      sm.currentThinking = msg.thinking || "adaptive";
      if (msg.budgetTokens) sm.currentThinkingBudget = msg.budgetTokens;
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    var providerChange;
    try { providerChange = providerSettings.change(msg, sm); }
    catch (error) { sendTo(ws, { type: "error", text: error.message }); return true; }
    if (providerChange) {
      Object.keys(providerChange.patch).forEach(function(key) { sm[key] = providerChange.patch[key]; });
      providerChange.messages.forEach(function(message) { send(message); });
      return true;
    }

    if (msg.type === "rewind_preview") {
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId || !msg.uuid) return true;
      if (session._rewindInProgress) return true;

      (async function () {
        try {
          var r = await sdk.rewindPreview(session, msg.uuid);
          sendTo(ws, { type: "rewind_preview_result", preview: r.preview, diffs: r.diffs, uuid: msg.uuid, chatOnly: r.chatOnly || false });
        } catch (err) {
          sendTo(ws, { type: "rewind_error", text: "Failed to preview rewind: " + err.message });
        }
      })();
      return true;
    }

    if (msg.type === "rewind_execute") {
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId || !msg.uuid) return true;
      // Guard against concurrent rewind executions
      if (session._rewindInProgress) {
        sendTo(ws, { type: "rewind_error", text: "Rewind already in progress." });
        return true;
      }
      sessionHistory.rewind(session, msg.uuid, msg.mode || "both", ws, function () {}).catch(function (error) {
        sendTo(ws, { type: "rewind_error", text: "Rewind failed: " + error.message });
      });
      return true;
    }

    if (msg.type === "fork_session" && msg.uuid) {
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId) {
        sendTo(ws, { type: "error", text: "Cannot fork: no CLI session" });
        return true;
      }
      sessionHistory.fork(session, msg.uuid, ws, function () {}).then(function (forked) {
        if (forked) sendTo(ws, { type: "fork_complete", sessionId: forked.localId });
      }).catch(function (error) {
        sendTo(ws, { type: "error", text: "Fork failed: " + error.message });
      });
      return true;
    }

    if (msg.type === "ask_user_response") {
      var session = getSessionForWs(ws);
      if (session) respondToAskUser(session, msg, ws);
      return true;
    }

    if (msg.type === "input_sync") {
      sendToSessionOthers(ws, ws._clayActiveSession, msg);
      return true;
    }

    if (msg.type === "cursor_move" || msg.type === "cursor_leave" || msg.type === "text_select") {
      if (!usersModule.isMultiUser() || !ws._clayUser) return true;
      var u = ws._clayUser;
      if (typeof usersModule.getCursorSharing === "function" && !usersModule.getCursorSharing(u.id)) {
        if (msg.type !== "cursor_leave" && !(msg.type === "text_select" && Array.isArray(msg.ranges) && msg.ranges.length === 0)) return true;
      }
      var p = u.profile || {};
      var cursorMsg = {
        type: msg.type,
        userId: u.id,
        displayName: p.name || u.displayName || u.username,
        avatarStyle: p.avatarStyle || "imprint",
        avatarSeed: p.avatarSeed || u.username,
        avatarCustom: p.avatarCustom || "",
      };
      if (msg.type === "cursor_move") {
        cursorMsg.turn = msg.turn;
        if (msg.rx != null) cursorMsg.rx = msg.rx;
        if (msg.ry != null) cursorMsg.ry = msg.ry;
      }
      if (msg.type === "text_select") {
        cursorMsg.ranges = msg.ranges || [];
      }
      sendToSessionOthers(ws, ws._clayActiveSession, cursorMsg);
      return true;
    }

    if (msg.type === "permission_response") {
      var requestId = msg.requestId;
      var decision = msg.decision;
      // Look up session by requestId index (O(1)), fall back to active session
      var sessionId = sm.permissionRequestIndex[requestId];
      var session = sessionId ? sm.sessions.get(sessionId) : getSessionForWs(ws);
      if (!session) return true;
      if (ws._clayPaneActivation && session.localId !== ws._clayPaneActivation.sessionId) return true;
      var pending = session.pendingPermissions[requestId];
      if (!pending) return true;
      delete sm.permissionRequestIndex[requestId];
      delete session.pendingPermissions[requestId];
      onProcessingChanged(); // update cross-project permission badge

      // --- Plan approval: "allow_accept_edits" -- approve + switch to acceptEdits mode ---
      if (decision === "allow_accept_edits") {
        fullAccessService.setMode(session, "acceptEdits").then(function() {
          pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
          sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });
        }).catch(function(error) {
          pending.resolve({ behavior: "deny", message: "Could not enter the accepted-edits workflow." });
          sendTo(ws, { type: "error", text: "Failed to change permission mode: " + (error.message || error) });
        });
        return true;
      }

      // --- Plan approval: "allow_clear_context" -- new session + plan as first message + acceptEdits ---
      if (decision === "allow_clear_context") {
        // Deny current plan to end the turn
        pending.resolve({ behavior: "deny", message: "User chose to clear context and restart" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Abort the old session's query -- but defer to next tick so the SDK's
        // deny write (scheduled as microtask by pending.resolve) completes first.
        // Aborting synchronously would kill the subprocess before the write,
        // causing an "Operation aborted" crash in the SDK.
        session.isProcessing = false;
        onProcessingChanged();
        session.pendingPermissions = {};
        cancelPendingAskUser(session, "Conversation restarted");
        sm.broadcastSessionList();
        setImmediate(function () {
          if (session.abortController) {
            session.abortController.abort();
          }
        });

        // Build prompt from plan content (sent from client) or plan file path
        var clientPlanContent = msg.planContent || "";
        var planPrompt;
        if (clientPlanContent) {
          planPrompt = "Execute the following plan. Do NOT re-enter plan mode -- just implement it step by step.\n\n" + clientPlanContent;
        } else {
          var planFilePath = (pending.toolInput && pending.toolInput.planFilePath) || "";
          planPrompt = "Execute the plan in " + planFilePath + ". Do NOT re-enter plan mode -- read the plan file and implement it step by step.";
        }

        // Wait for old query stream to fully terminate, then create new session + send plan
        var oldStreamPromise = session.streamPromise || Promise.resolve();
        Promise.race([
          oldStreamPromise,
          new Promise(function (resolve) { setTimeout(resolve, 3000); }),
        ]).then(function () {
          try {
            var newSession = sm.createSession(null, ws);
            newSession.permissionMode = "acceptEdits";
            // Send the plan as the first user message (with planContent for UI rendering)
            var userMsg = { type: "user_message", text: planPrompt, planContent: clientPlanContent || null };
            newSession.history.push(userMsg);
            sm.appendToSessionFile(newSession, userMsg);
            newSession.title = "Plan execution (cleared context)";
            sm.saveSessionFile(newSession);
            sm.broadcastSessionList();
            sendToSession(newSession.localId, userMsg);

            newSession.isProcessing = true;
            onProcessingChanged();
            newSession.sentToolResults = {};
            sendToSession(newSession.localId, { type: "status", status: "processing" });
            newSession.acceptEditsAfterStart = true;
            sdk.startQuery(newSession, planPrompt, undefined, ensureProjectAccessForSession(newSession));
          } catch (e) {
            console.error("[project] Error starting plan execution:", e);
            sendTo(ws, { type: "error", text: "Failed to start plan execution: " + (e.message || e) });
          }
        }).catch(function (e) {
          console.error("[project] Plan execution stream wait failed:", e.message || e);
        });
        return true;
      }

      // --- Plan approval: "deny_with_feedback" -- deny + send feedback as follow-up message ---
      if (decision === "deny_with_feedback") {
        var feedback = msg.feedback || "";
        pending.resolve({ behavior: "deny", message: feedback || "User provided feedback" });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });

        // Send feedback as next user message if there's text
        if (feedback) {
          setTimeout(function () {
            var userMsg = { type: "user_message", text: feedback, planFeedback: true };
            session.history.push(userMsg);
            sm.appendToSessionFile(session, userMsg);
            sendToSession(session.localId, userMsg);

            if (!session.isProcessing) {
              session.isProcessing = true;
              onProcessingChanged();
              session.sentToolResults = {};
              sendToSession(session.localId, { type: "status", status: "processing" });
              if (!session.queryInstance && !session.worker) {
                sdk.startQuery(session, feedback, undefined, ensureProjectAccessForSession(session));
              } else {
                sdk.pushMessage(session, feedback);
              }
            } else {
              sdk.pushMessage(session, feedback);
            }
          }, 200);
        }
        return true;
      }

      if (decision === "allow_always" && pending.suppressAlwaysAllowRule) decision = "allow";
      if (decision === "allow" || decision === "allow_always") {
        if (decision === "allow_always") {
          if (!session.allowedTools) session.allowedTools = {};
          session.allowedTools[pending.toolName] = true;
        }
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
      } else {
        pending.resolve({ behavior: "deny", message: "User denied permission" });
      }

      sm.sendAndRecord(session, {
        type: "permission_resolved",
        requestId: requestId,
        decision: decision,
      });
      return true;
    }

    // --- MCP elicitation response ---
    if (msg.type === "elicitation_response") {
      var session = getSessionForWs(ws);
      if (!session) return true;
      return elicitationResponse.handleElicitationResponse(session, ws, msg, { sendTo: sendTo, sendAndRecord: sm.sendAndRecord });
    }

    // --- Host user dialog response (SDK request_user_dialog) ---
    if (msg.type === "user_dialog_response") {
      var session = getSessionForWs(ws);
      if (!session) return true;
      var pending = session.pendingUserDialogs && session.pendingUserDialogs[msg.requestId];
      if (!pending) return true;
      delete session.pendingUserDialogs[msg.requestId];
      if (msg.behavior === "completed") {
        pending.resolve({ behavior: "completed", result: msg.result });
      } else {
        pending.resolve({ behavior: "cancelled" });
      }
      sm.sendAndRecord(session, {
        type: "user_dialog_resolved",
        requestId: msg.requestId,
        behavior: msg.behavior === "completed" ? "completed" : "cancelled",
      });
      return true;
    }

    // --- Browse directories (for add-project autocomplete) ---
    if (msg.type === "browse_dir") {
      var rawPath = (msg.path || "").replace(/^~/, require("./config").REAL_HOME);
      var absTarget = path.resolve(rawPath);
      var parentDir, prefix;
      try {
        var stat = fs.statSync(absTarget);
        if (stat.isDirectory()) {
          // Input is an existing directory -- list its children
          parentDir = absTarget;
          prefix = "";
        } else {
          parentDir = path.dirname(absTarget);
          prefix = path.basename(absTarget).toLowerCase();
        }
      } catch (e) {
        // Path doesn't exist -- list parent and filter by typed prefix
        parentDir = path.dirname(absTarget);
        prefix = path.basename(absTarget).toLowerCase();
      }
      if (opts.canUsePath && !opts.canUsePath(ws._clayUser && ws._clayUser.id, parentDir)) {
        sendTo(ws, { type: "browse_dir_result", entries: [], error: "Directory access is not permitted" });
        return true;
      }
      try {
        var dirItems = fs.readdirSync(parentDir, { withFileTypes: true });
        var dirEntries = [];
        for (var di = 0; di < dirItems.length; di++) {
          var d = dirItems[di];
          if (!d.isDirectory()) continue;
          if (opts.canUsePath && !opts.canUsePath(ws._clayUser && ws._clayUser.id, path.join(parentDir, d.name))) continue;
          if (d.name.charAt(0) === ".") continue;
          if (IGNORED_DIRS.has(d.name)) continue;
          if (prefix && !d.name.toLowerCase().startsWith(prefix)) continue;
          dirEntries.push({ name: d.name, path: path.join(parentDir, d.name) });
        }
        dirEntries.sort(function (a, b) { return a.name.localeCompare(b.name); });
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: dirEntries });
      } catch (e) {
        sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: [], error: e.message });
      }
      return true;
    }

    // --- Add project from web UI ---
    if (msg.type === "add_project") {
      var addPath = (msg.path || "").replace(/^~/, require("./config").REAL_HOME);
      var addAbs = path.resolve(addPath);
      if (opts.canUsePath && !opts.canUsePath(ws._clayUser && ws._clayUser.id, addAbs)) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Directory access is not permitted" });
        return true;
      }
      try {
        var addStat = fs.statSync(addAbs);
        if (!addStat.isDirectory()) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "Not a directory" });
          return true;
        }
      } catch (e) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Directory not found" });
        return true;
      }
      if (typeof opts.onAddProject === "function") {
        var result = opts.onAddProject(addAbs, ws._clayUser);
        sendTo(ws, Object.assign({}, result, { type: "add_project_result" }));
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Create new empty project ---
    if (msg.type === "create_project" || msg.type === "clone_project") {
      if (ws._clayUser) {
        var cpPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!cpPerms.createProject) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "You do not have permission to create projects" });
          return true;
        }
      }
    }
    if (msg.type === "create_project") {
      var createName = (msg.name || "").trim();
      if (!createName || !/^[a-zA-Z0-9_-]+$/.test(createName)) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Invalid name. Use only letters, numbers, dashes, and underscores." });
        return true;
      }
      if (typeof opts.onCreateProject === "function") {
        var createResult = opts.onCreateProject(createName, ws._clayUser);
        sendTo(ws, Object.assign({}, createResult, { type: "add_project_result" }));
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Clone project from GitHub ---
    if (msg.type === "clone_project") {
      var cloneUrl = (msg.url || "").trim();
      if (!cloneUrl || (!/^https?:\/\//.test(cloneUrl) && !/^git@/.test(cloneUrl))) {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Invalid URL. Use https:// or git@ format." });
        return true;
      }
      sendTo(ws, { type: "clone_project_progress", status: "cloning" });
      if (typeof opts.onCloneProject === "function") {
        opts.onCloneProject(cloneUrl, ws._clayUser, function (cloneResult) {
          sendTo(ws, { type: "add_project_result", ok: cloneResult.ok, slug: cloneResult.slug, error: cloneResult.error });
        });
      } else {
        sendTo(ws, { type: "add_project_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Create worktree from web UI ---
    if (msg.type === "create_worktree") {
      if (slug.indexOf("--") !== -1) {
        sendTo(ws, { type: "create_worktree_result", ok: false, error: "Cannot create a worktree from another worktree" });
        return true;
      }
      var wtBranch = (msg.branch || "").trim();
      var wtDirName = (msg.dirName || "").trim() || wtBranch.replace(/\//g, "-");
      var wtBase = (msg.baseBranch || "").trim() || null;
      if (!wtBranch || !/^[a-zA-Z0-9_\/.@-]+$/.test(wtBranch)) {
        sendTo(ws, { type: "create_worktree_result", ok: false, error: "Invalid branch name" });
        return true;
      }
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(wtDirName)) {
        sendTo(ws, { type: "create_worktree_result", ok: false, error: "Invalid worktree directory name" });
        return true;
      }
      if (typeof onCreateWorktree === "function") {
        var wtResult = onCreateWorktree(slug, wtBranch, wtDirName, wtBase, ws._clayUser);
        sendTo(ws, { type: "create_worktree_result", ok: wtResult.ok, slug: wtResult.slug, error: wtResult.error });
      } else {
        sendTo(ws, { type: "create_worktree_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Pre-check: does the project have tasks/schedules? ---
    if (msg.type === "remove_project_check") {
      var checkSlug = msg.slug;
      if (!checkSlug || !canAccessProjectSlug(ws, checkSlug)) {
        sendTo(ws, { type: "remove_project_check_result", slug: checkSlug, name: msg.name || checkSlug, count: 0 });
        return true;
      }
      var schedCount = getScheduleCount(checkSlug);
      sendTo(ws, { type: "remove_project_check_result", slug: checkSlug, name: msg.name || checkSlug, count: schedCount });
      return true;
    }

    // --- Remove project from web UI ---
    if (msg.type === "remove_project") {
      if (ws._clayUser) {
        var dpPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!dpPerms.deleteProject) {
          sendTo(ws, { type: "remove_project_result", ok: false, error: "You do not have permission to delete projects" });
          return true;
        }
      }
      var removeSlug = msg.slug;
      if (!removeSlug) {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Missing slug" });
        return true;
      }
      if (!canAccessProjectSlug(ws, removeSlug)) {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "You do not have access to this project" });
        return true;
      }
      // If client chose to move tasks to another project before removing
      if (msg.moveTasksTo) {
        if (!canAccessProjectSlug(ws, msg.moveTasksTo)) {
          sendTo(ws, { type: "remove_project_result", ok: false, error: "You do not have access to the destination project" });
          return true;
        }
        moveAllSchedulesToProject(removeSlug, msg.moveTasksTo);
      }
      if (typeof opts.onRemoveProject === "function") {
        var removeUserId = ws._clayUser ? ws._clayUser.id : null;
        Promise.resolve().then(function () { return opts.onRemoveProject(removeSlug, removeUserId); }).then(function (result) {
          sendTo(ws, { type: "remove_project_result", ok: !!result && result.ok === true, slug: removeSlug, error: result && result.error });
        }, function (error) { sendTo(ws, { type: "remove_project_result", ok: false, slug: removeSlug, error: error.message }); });
      } else {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Move a single schedule to another project ---
    if (msg.type === "schedule_move") {
      if (!canAccessProjectSlug(ws, msg.fromSlug) || !canAccessProjectSlug(ws, msg.toSlug)) {
        sendTo(ws, { type: "schedule_move_result", ok: false, error: "You do not have access to one of these projects" });
        return true;
      }
      var moveResult = moveScheduleToProject(msg.recordId, msg.fromSlug, msg.toSlug);
      if (moveResult.ok) {
        // Re-broadcast updated records to this project's clients
        send({ type: "loop_registry_updated", records: getHubSchedules() });
      }
      sendTo(ws, { type: "schedule_move_result", ok: moveResult.ok, error: moveResult.error });
      return true;
    }

    // --- Reorder projects ---
    if (msg.type === "reorder_projects") {
      var slugs = msg.slugs;
      if (!Array.isArray(slugs) || slugs.length === 0) {
        sendTo(ws, { type: "reorder_projects_result", ok: false, error: "Missing slugs" });
        return true;
      }
      if (typeof opts.onReorderProjects === "function") {
        var reorderResult = opts.onReorderProjects(slugs);
        sendTo(ws, { type: "reorder_projects_result", ok: reorderResult.ok, error: reorderResult.error });
      } else {
        sendTo(ws, { type: "reorder_projects_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Set project title (rename) ---
    if (msg.type === "set_project_title") {
      if (!msg.slug) {
        sendTo(ws, { type: "set_project_title_result", ok: false, error: "Missing slug" });
        return true;
      }
      if (typeof opts.onSetProjectTitle === "function") {
        var titleResult = opts.onSetProjectTitle(msg.slug, msg.title || null);
        sendTo(ws, Object.assign({}, titleResult, { type: "set_project_title_result", slug: msg.slug }));
      } else {
        sendTo(ws, { type: "set_project_title_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Set project icon (emoji) ---
    if (msg.type === "set_project_icon") {
      if (!msg.slug) {
        sendTo(ws, { type: "set_project_icon_result", ok: false, error: "Missing slug" });
        return true;
      }
      if (typeof opts.onSetProjectIcon === "function") {
        var iconResult = opts.onSetProjectIcon(msg.slug, msg.icon || null);
        sendTo(ws, { type: "set_project_icon_result", ok: iconResult.ok, slug: msg.slug, error: iconResult.error });
      } else {
        sendTo(ws, { type: "set_project_icon_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Daemon config / server management (admin-only in multi-user mode) ---
    if (msg.type === "get_daemon_config" || msg.type === "set_pin" || msg.type === "set_keep_awake" ||
        msg.type === "set_auto_continue" || msg.type === "set_inherit_groups" || msg.type === "set_image_retention" || msg.type === "shutdown_server" || msg.type === "restart_server") {
      if (usersModule.isMultiUser()) {
        var _wsUser = ws._clayUser && usersModule.findUserById(ws._clayUser.id);
        if (!_wsUser || _wsUser.role !== "admin") {
          sendTo(ws, { type: msg.type + "_result", ok: false, error: "Administrator access required." });
          return true;
        }
      }
    }

    if (msg.type === "get_daemon_config") {
      if (typeof opts.onGetDaemonConfig === "function") {
        try { sendTo(ws, { type: "daemon_config", config: opts.onGetDaemonConfig() }); }
        catch (error) { sendTo(ws, { type: "daemon_config", config: { error: 'Server configuration is unavailable. Close and reopen Settings to retry.' } }); }
      } else { sendTo(ws, { type: "daemon_config", config: { error: 'Server configuration is unavailable in this runtime.' } }); }
      return true;
    }





    if (msg.type === "set_auto_continue") {
      if (typeof opts.onSetAutoContinue === "function") {
        var acResult = opts.onSetAutoContinue(msg.value);
        sendTo(ws, { type: "set_auto_continue_result", ok: acResult.ok, autoContinueOnRateLimit: acResult.autoContinueOnRateLimit });
        send({ type: "auto_continue_changed", autoContinueOnRateLimit: acResult.autoContinueOnRateLimit });
      }
      return true;
    }



    if (msg.type === "get_claude_allow_list") {
      var galUid = ws._clayUser ? ws._clayUser.id : null;
      var galManaged = [];
      var galUser = [];
      try {
        var galInstaller = require("./yoke/claude-hook-installer");
        galManaged = galInstaller.CLAY_MANAGED_ALLOW || [];
      } catch (e) {}
      if (galUid) {
        try { galUser = usersModule.getClaudeUserAllowList(galUid) || []; } catch (e) {}
      }
      sendTo(ws, { type: "claude_allow_list", managed: galManaged, user: galUser });
      return true;
    }

    if (msg.type === "set_claude_user_allow_list") {
      var salUid = ws._clayUser ? ws._clayUser.id : null;
      if (!salUid) {
        sendTo(ws, { type: "set_claude_user_allow_list_result", ok: false, error: "no_user" });
        return true;
      }
      var salResult = usersModule.setClaudeUserAllowList(salUid, msg.patterns || []);
      if (!salResult || !salResult.ok) {
        sendTo(ws, { type: "set_claude_user_allow_list_result", ok: false, error: (salResult && salResult.error) || "unknown" });
        return true;
      }
      // Re-install settings.json with the updated list so the new patterns
      // take effect on the next `claude` invocation. Resolve this user's
      // home (OS-mode: getent passwd; single-user: os.homedir()).
      var salEffective = false;
      try {
        var salInstaller = require("./yoke/claude-hook-installer");
        var salHome = null;
        if (osUsers && ws._clayUser && ws._clayUser.linuxUser) {
          try {
            var salInfo = require("./os-users").resolveOsUserInfo(ws._clayUser.linuxUser);
            if (salInfo && salInfo.home) salHome = salInfo.home;
          } catch (e) {}
        }
        if (!salHome) salHome = require("os").homedir();
        var salMerged = (salInstaller.CLAY_MANAGED_ALLOW || []).concat(salResult.claudeUserAllowList);
        var salInstalled = salInstaller.installAllowList({ homeDirs: [salHome], patterns: salMerged });
        salEffective = !salInstalled.errors.length;
      } catch (e) {}
      sendTo(ws, { type: "set_claude_user_allow_list_result", ok: true, effective: salEffective, patterns: salResult.claudeUserAllowList });
      return true;
    }

    // Old clients receive an explicit refusal; stored legacy values are ignored.
    if (msg.type === "set_claude_open_mode") {
      sendTo(ws, { type: "set_claude_open_mode_result", ok: false, error: "Terminal presentation has been removed. Claude opens in Clay chat." });
      return true;
    }

    if (msg.type === "shutdown_server") {
      if (typeof opts.onShutdown === "function") {
        sendTo(ws, { type: "shutdown_server_result", ok: true });
        send({ type: "toast", level: "warn", message: "Server is shutting down..." });
        // Small delay so the response has time to reach clients
        setTimeout(function () {
          opts.onShutdown();
        }, 500);
      } else {
        sendTo(ws, { type: "shutdown_server_result", ok: false, error: "Shutdown not supported" });
      }
      return true;
    }

    if (msg.type === "restart_server") {
      if (typeof opts.onRestart === "function") {
        sendTo(ws, { type: "restart_server_result", ok: true });
        send({ type: "toast", level: "info", message: "Server is restarting..." });
        // Small delay so the response has time to reach clients
        setTimeout(function () {
          opts.onRestart();
        }, 500);
      } else {
        sendTo(ws, { type: "restart_server_result", ok: false, error: "Restart not supported" });
      }
      return true;
    }

    return false;
  }

  return {
    invalidateVendorUsage: function () { vendorUsage.invalidateAll(); },
    // Canonical read-only inspection: the caller has already proven the owner and
    // project access; the OS user is re-derived from the live user record.
    readVendorUsage: function (request) {
      var installed = null;
      if (Array.isArray(sm.installedVendors)) {
        installed = Object.create(null);
        sm.installedVendors.forEach(function (vendor) { installed[vendor] = true; });
      }
      var linuxUser = osUsers && request.owner !== "default" ? ctx.getLinuxUserForSession({ ownerId: request.owner }) : null;
      return vendorUsage.readForOwner({ owner: request.owner, linuxUser: linuxUser, installed: installed, isCurrent: request.isCurrent });
    },
    handleSessionsMessage: handleSessionsMessage,
    resolveSessionForView: resolveSessionForView,
    sendSessionFoldersState: sessionFolders.sendStateTo,
    respondToAskUser: respondToAskUser,
    respondToHomePermission: function (ws, msg, session) {
      if (!session || !msg || !session.pendingPermissions || !session.pendingPermissions[msg.requestId]) return false;
      var indexedSessionId = sm.permissionRequestIndex[msg.requestId];
      if (indexedSessionId !== session.localId || sm.sessions.get(indexedSessionId) !== session) return false;
      return handleSessionsMessage(ws, { type: "permission_response", requestId: msg.requestId, decision: msg.decision });
    },
    stopHomeSession: stopSession,
    sessionActions: sessionActions,
    sessionHistoryActions: sessionHistory,
    sessionVendorActions: sessionVendor,
    sessionRuntimeActions: sessionRuntime,
    deleteProductControlPlan: function (plan) { sessionDelete.executeOwnedDeletion(plan); },
  };
}

module.exports = { attachSessions: attachSessions };
