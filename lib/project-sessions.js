var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var { execFileSync } = require("child_process");
var { CODEX_DEFAULTS, getCodexConfig } = require("./codex-defaults");
var updateSnooze = require("./update-snooze");
var yoke = require("./yoke");
var sessionVisibility = require("./session-visibility");

function vendorSupportsTui(vendor) {
  var info = yoke.getVendorInfo(vendor);
  return !!(info && info.sessionModes.indexOf("tui") !== -1);
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
  var cwd = ctx.cwd;
  var slug = ctx.slug;
  var isMate = ctx.isMate;
  var osUsers = ctx.osUsers;
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
  function stopSession(session) {
    if (!session || (!session.isProcessing && !session._queryStarting)) return false;
    if (typeof ctx.onHumanPairStop === "function") ctx.onHumanPairStop(session);
    session.taskStopRequested = true;
    if (session.abortController) session.abortController.abort();
    return true;
  }
  var hydrateImageRefs = ctx.hydrateImageRefs;
  var onProcessingChanged = ctx.onProcessingChanged;
  var broadcastPresence = ctx.broadcastPresence;
  var adapter = ctx.adapter;

  function ownsSearchSession(ws, session) {
    if (!session) return false;
    if (usersModule && typeof usersModule.isMultiUser === "function" && usersModule.isMultiUser()) {
      return !!(ws && ws._clayUser && usersModule.canAccessSession(ws._clayUser.id, session, getProjectAccess()));
    }
    return !session.ownerId;
  }

  function respondToAskUser(session, msg) {
    if (!session || !msg || !msg.toolId) return false;
    var toolId = msg.toolId;
    var answers = msg.answers || {};
    var pending = session.pendingAskUser && session.pendingAskUser[toolId];
    if (!pending) return false;
    if (pending.mode === "yoke") {
      try { yoke.userInput.normalizeAnswers(pending.request.questions, answers); }
      catch (e) { return false; }
    }
    delete session.pendingAskUser[toolId];
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

  // Resolve the active user's Claude open-mode preference ('gui' or 'tui').
  // Multi-user mode reads per-user storage; single-user mode falls back to
  // the daemon-level default ('gui').
  function getClaudeOpenModeForWs(ws) {
    if (!usersModule || typeof usersModule.getClaudeOpenMode !== "function") return "gui";
    var uid = ws && ws._clayUser ? ws._clayUser.id : null;
    if (!uid) return "gui";
    try { return usersModule.getClaudeOpenMode(uid) || "gui"; } catch (e) { return "gui"; }
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
    try { watcher = require("./claude-jsonl-watcher"); } catch (e) { return; }
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
          var newIndex = require("./tui-transcript-index").readAssistantIndex(resolveSessionHome(s), cwd, s.cliSessionId);
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

  // Spawn a transient PTY for "view this Claude GUI session as TUI" (the
  // user's claudeOpenMode is 'tui'). The session itself stays a GUI session
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
  // disk so that flipping claudeOpenMode back to 'tui' later restores the
  // embedded-terminal experience instead of locking the session as GUI.
  //
  // Idempotent: if the PTY is already gone and history is populated, this
  // is a no-op (avoids re-reading jsonl and re-writing the session file on
  // every click while the user is reading the session in GUI mode).
  function prepareTuiSessionForGuiView(session) {
    if (!session || session.cliSessionId == null) return;
    var cliSess;
    try { cliSess = require("./cli-sessions"); } catch (e) { return; }
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
    try { sm.saveSessionFile(session); } catch (e) {}
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
    var pref = getClaudeOpenModeForWs(ws);
    // A LIVE runtime always wins over the viewer's claudeOpenMode pref:
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
    // Cold session: apply the viewer's pref.
    if (session.mode === "tui") {
      if (pref === "gui") {
        prepareTuiSessionForGuiView(session);
        session.runtimeMode = "gui";
        session.runtimeTerminalId = null;
        session.tuiSuspended = false;
      } else {
        prepareTuiSessionForGuiView(session);
        session.runtimeMode = null;
        session.runtimeTerminalId = null;
        session.tuiSuspended = true;
      }
    } else {
      // Born-GUI: always GUI. We no longer auto-convert a GUI session to a
      // `claude --resume` terminal on a pref=tui click - that hijacked shared
      // GUI sessions in multi-user. Such sessions render as their SDK chat.
      session.runtimeMode = null;
      session.tuiSuspended = false;
    }
  }

  function handleSessionsMessage(ws, msg) {

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
      var items = session.history.slice(from, to).map(hydrateImageRefs);
      sendTo(ws, {
        type: "history_prepend",
        items: items,
        meta: { from: from, to: to, hasMore: from > 0 },
      });
      return true;
    }

    if (msg.type === "new_session") {
      // Opportunistic hygiene: drop blanks that sat untouched past the grace
      // period before deciding whether to reuse or create.
      sm.sweepBlankSessions();
      var sessionOpts = {};
      if (ws._clayUser && usersModule.isMultiUser()) sessionOpts.ownerId = ws._clayUser.id;
      sessionOpts.sessionVisibility = sessionVisibility.normalize(msg.sessionVisibility);
      if (msg.vendor) sessionOpts.vendor = msg.vendor;
      // Mode resolution: vendors without a TUI session mode are always GUI.
      // TUI-capable sessions honor the explicit msg.mode if provided, otherwise
      // fall back to the user's claudeOpenMode preference. This is what
      // makes the sidebar's "Claude" icon button create the right kind of
      // session without the client needing to know the preference.
      var requestedMode;
      if (msg.vendor && !vendorSupportsTui(msg.vendor)) {
        requestedMode = "gui";
      } else if (msg.mode === "tui" || msg.mode === "gui") {
        requestedMode = msg.mode;
      } else {
        requestedMode = getClaudeOpenModeForWs(ws);
      }
      var newSess;
      if (requestedMode === "tui") {
        // TUI sessions own their cliSessionId up-front so we can launch
        // `claude --session-id <uuid>` and resume the same conversation
        // from external terminals (claude --resume <uuid>) and from the
        // jsonl watcher (~/.claude/projects/<cwd>/<uuid>.jsonl).
        //
        // Construction order matters: createSession() fires session_switched
        // synchronously, so we must populate terminalId on the record before
        // switching. Use createSessionRaw + switchSession to get the right
        // ordering and avoid an extra rebroadcast.
        sessionOpts.mode = "tui";
        sessionOpts.cliSessionId = crypto.randomUUID();
        sessionOpts.vendor = sessionOpts.vendor || "claude";
        // Per-session bypass-permissions: TUI shell command only. The flag is
        // persisted on the session so lazy-resume re-spawns the same way.
        if (msg.dangerouslySkipPermissions) sessionOpts.dangerouslySkipPermissions = true;
        newSess = sm.createSessionRaw(sessionOpts);
        if (tm) {
          var tuiSid = newSess.cliSessionId;
          var tuiLocalId = newSess.localId;
          var tuiSkip = newSess.dangerouslySkipPermissions ? " --dangerously-skip-permissions" : "";
          var tuiCmd = "claude --session-id " + tuiSid + tuiSkip + "; exit\n";
          var tuiTerm = tm.create(80, 24, getOsUserInfoForWs(ws), ws, {
            initialInput: tuiCmd,
            kind: "tui-session",
            title: "claude " + tuiSid.slice(0, 8),
            onExit: function (termSession) {
              var s = sm.sessions.get(tuiLocalId);
              if (!s) return;
              if (termSession && termSession.reclaimed) {
                // Reclaimed (idle sweep or explicit Close), not a real /exit:
                // keep the session (its jsonl transcript stays on disk and
                // lazy-resume can re-spawn claude). Just drop the dead PTY link.
                s.terminalId = null;
                try { sm.saveSessionFile(s); } catch (e) {}
                try { sm.broadcastSessionList(); } catch (e) {}
              } else {
                try { sm.deleteSessionQuiet(tuiLocalId); } catch (e) {}
                try { sm.broadcastSessionList(); } catch (e) {}
              }
            },
            onData: makeTuiActivityHook(tuiLocalId),
          });
          if (tuiTerm) {
            newSess.terminalId = tuiTerm.id;
          }
        }
        // Persist immediately so the session reappears in the sidebar
        // after a daemon restart (the SDK path saves on stream events,
        // but TUI sessions never produce any so this is our only chance).
        try { sm.saveSessionFile(newSess); } catch (e) {}
        startTitleWatcher(newSess);
        sm.switchSession(newSess.localId, ws);
      } else {
        var newSessionVendor = sessionOpts.vendor || sm.defaultVendor || "claude";
        sessionOpts.effort = yoke.clampEffort(
          newSessionVendor,
          (sm.currentEffortByVendor && sm.currentEffortByVendor[newSessionVendor]) || sm.currentEffort || "medium"
        ) || null;
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
          sm.setSessionVisibility(reusable.localId, sessionOpts.sessionVisibility);
          sessionVisibility.revokeViewers(ctx, reusable);
          sm.switchSession(reusable.localId, ws);
          newSess = reusable;
        } else {
          newSess = sm.createSession(sessionOpts, ws);
        }
      }
      ws._clayActiveSession = newSess.localId;
      // Remember the vendor only when the client asked for one explicitly.
      // new_session without a vendor (mate sidebar, notification banner,
      // debate) falls through to the default adapter and must not clobber
      // the user's remembered pick.
      if (msg.vendor && sm.lastVendor !== msg.vendor) {
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

    if (msg.type === "set_session_bookmark") {
      if (typeof msg.sessionId === "number") {
        var bookmarkTarget = sm.sessions.get(msg.sessionId);
        if (!bookmarkTarget) return true;
        if (usersModule.isMultiUser() && ws._clayUser) {
          if (!usersModule.canAccessSession(ws._clayUser.id, bookmarkTarget, { visibility: "public" })) return true;
        }
        sm.setSessionBookmarked(msg.sessionId, !!msg.bookmarked);
      }
      return true;
    }

    if (msg.type === "reorder_session_bookmarks") {
      if (typeof msg.sourceId === "number" && typeof msg.targetId === "number" && msg.sourceId !== msg.targetId) {
        var source = sm.sessions.get(msg.sourceId);
        var target = sm.sessions.get(msg.targetId);
        if (!source || !target) return true;
        if (usersModule.isMultiUser() && ws._clayUser) {
          if (!usersModule.canAccessSession(ws._clayUser.id, source, { visibility: "public" })) return true;
          if (!usersModule.canAccessSession(ws._clayUser.id, target, { visibility: "public" })) return true;
        }
        sm.reorderBookmarkedSessions(msg.sourceId, msg.targetId, msg.insertBefore !== false);
      }
      return true;
    }

    if (msg.type === "bulk_delete_sessions") {
      if (!Array.isArray(msg.sessionIds) || msg.sessionIds.length === 0) return true;
      var deletableIds = [];
      for (var di = 0; di < msg.sessionIds.length; di++) {
        var bulkId = msg.sessionIds[di];
        if (typeof bulkId !== "number") continue;
        var bulkTarget = sm.sessions.get(bulkId);
        if (!bulkTarget) continue;
        if (usersModule.isMultiUser() && ws._clayUser) {
          if (!usersModule.canAccessSession(ws._clayUser.id, bulkTarget, { visibility: "public" })) continue;
        }
        deletableIds.push(bulkId);
      }
      if (deletableIds.length > 0) {
        // TUI sessions: kill their PTYs and stop title watchers before the
        // records are wiped.
        for (var bdi = 0; bdi < deletableIds.length; bdi++) {
          var bdTarget = sm.sessions.get(deletableIds[bdi]);
          if (!bdTarget) continue;
          if (tm && bdTarget.mode === "tui" && typeof bdTarget.terminalId === "number") {
            try { tm.close(bdTarget.terminalId); } catch (e) {}
          }
          stopTitleWatcher(bdTarget);
        }
        sm.deleteSessionsBulk(deletableIds, ws);
      }
      return true;
    }

    if (msg.type === "transfer_project_owner") {
      // Home directory projects: ownership is permanently locked
      if (osUsers && osUsers.length > 0 && /^\/home\/[^/]+\//.test(cwd)) {
        sendTo(ws, { type: "error", text: "Cannot transfer ownership of home directory projects." });
        return true;
      }
      var projectOwnerId = getProjectOwnerId();
      var isAdmin = ws._clayUser && ws._clayUser.role === "admin";
      var isProjectOwner = ws._clayUser && projectOwnerId && ws._clayUser.id === projectOwnerId;
      if (!ws._clayUser || (!isAdmin && !isProjectOwner)) {
        sendTo(ws, { type: "error", text: "Only project owners or admins can transfer ownership." });
        return true;
      }
      var targetUser = msg.userId ? usersModule.findUserById(msg.userId) : null;
      if (!targetUser) {
        sendTo(ws, { type: "error", text: "User not found." });
        return true;
      }
      setProjectOwnerId(targetUser.id);
      // Persist via daemon callback
      if (opts.onProjectOwnerChanged) {
        opts.onProjectOwnerChanged(slug, targetUser.id);
      }
      send({ type: "project_owner_changed", ownerId: targetUser.id, ownerName: targetUser.displayName || targetUser.username });
      return true;
    }

    // Note: the old `resume_session` and `list_cli_sessions` WS handlers
    // were removed when CLI sessions started being auto-adopted into the
    // unified session list on server start (see sessions.js
    // adoptOrphanedCliSessions). Click a session in the sidebar instead.

    if (msg.type === "switch_session") {
      if (msg.id && sm.sessions.has(msg.id)) {
        // resolveSessionForView sets runtimeMode / runtimeTerminalId /
        // tuiSuspended (and hydrates the transcript) before sm.switchSession
        // broadcasts session_switched. A live runtime keeps its actual mode
        // for every viewer; only cold sessions follow the clicker's
        // claudeOpenMode pref. Nothing is spawned here.
        var xmTarget = sm.sessions.get(msg.id);
        if (xmTarget && (!xmTarget.vendor || vendorSupportsTui(xmTarget.vendor))) {
          // Single source of truth: live runtime wins (tui stays tui, gui stays
          // gui); only cold sessions follow the viewer's pref. No PTY is spawned
          // on switch - born-TUI resumes lazily via the Resume bar
          // (resume_tui_session), and born-GUI never auto-converts to a terminal.
          resolveSessionForView(xmTarget, ws);
        }
        var switchTargetSess = sm.sessions.get(msg.id);
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
          ws._clayActiveSession = msg.id;
          sm.switchSession(msg.id, ws, hydrateImageRefs);
          if (!ws._clayPane) broadcastPresence();
        } else {
          ws._clayActiveSession = msg.id;
          sm.switchSession(msg.id, ws, hydrateImageRefs);
        }
        // Send per-session context sources
        if (typeof loadContextSources === "function") {
          var switchedSources = loadContextSources(slug, msg.id);
          sendTo(ws, { type: "context_sources_state", active: switchedSources });
        }
        var swPresKey = ws._clayUser ? ws._clayUser.id : "_default";
        if (!ws._clayPane) userPresence.setPresence(slug, swPresKey, userPresence.sessionIdForPersistence(switchTargetSess), null);
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
        var tprIndex = require("./tui-transcript-index").readAssistantIndex(resolveSessionHome(tprSess), cwd, tprSess.cliSessionId);
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
      if (ws._clayUser) {
        var sdPerms = usersModule.getEffectivePermissions(ws._clayUser, osUsers);
        if (!sdPerms.sessionDelete) {
          sendTo(ws, { type: "error", text: "You do not have permission to delete sessions" });
          return true;
        }
      }
      if (msg.id && sm.sessions.has(msg.id)) {
        // TUI session: kill the underlying PTY before deleting the session
        // record so the `claude` process is reaped and not left orphaned.
        var dsTarget = sm.sessions.get(msg.id);
        if (dsTarget && dsTarget.mode === "tui" && typeof dsTarget.terminalId === "number" && tm) {
          try { tm.close(dsTarget.terminalId); } catch (e) {}
        }
        if (dsTarget) stopTitleWatcher(dsTarget);
        sm.deleteSession(msg.id, ws);
      }
      return true;
    }

    if (msg.type === "rename_session") {
      if (msg.id && sm.sessions.has(msg.id) && msg.title) {
        var s = sm.sessions.get(msg.id);
        s.title = String(msg.title).substring(0, 100);
        s.titleManuallySet = true;
        sm.saveSessionFile(s);
        sm.notifySessionRenamed(s.localId);
        sm.broadcastSessionList();
        // Sync title to SDK session
        if (s.cliSessionId) {
          adapter.renameSession(s.cliSessionId, s.title, { dir: cwd }).catch(function(e) {
            console.error("[project] SDK renameSession failed:", e.message);
          });
        }
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
      if (!updateSnooze.isUpdateAdmin(ws, usersModule)) return true;
      var newChannel = msg.channel === "beta" ? "beta" : "stable";
      setUpdateChannel(newChannel);
      setLatestVersion(null);
      if (typeof opts.onSetUpdateChannel === "function") {
        opts.onSetUpdateChannel(newChannel);
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
      }).catch(function () {});
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
      stopSession(session);
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
      if (!sdk.isClaudeProcess(pid)) {
        console.error("[project] Refused to kill PID " + pid + ": not a claude process");
        sendTo(ws, { type: "error", text: "Process " + pid + " is not a Claude process." });
        return true;
      }
      try {
        process.kill(pid, "SIGTERM");
        console.log("[project] Sent SIGTERM to conflicting Claude process PID " + pid);
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

    if (msg.type === "set_mcp_permission_mode_override" && msg.serverName) {
      var session = getSessionForWs(ws);
      if (session && sdk.setMcpPermissionModeOverride) {
        // mode: "default" | "auto" | null (null clears the override)
        var mcpMode = (msg.mode === "auto" || msg.mode === "default") ? msg.mode : null;
        sdk.setMcpPermissionModeOverride(session, msg.serverName, mcpMode);
      }
      return true;
    }

    if (msg.type === "set_vendor" && msg.vendor) {
      var vendorSession = getSessionForWs(ws);
      if (vendorSession) {
        // Refuse to rebind vendor on a session that is already bound to a
        // different CLI (cliSessionId is vendor-specific). This prevents a
        // stale client-side vendor state from clobbering the persisted vendor
        // on page reload / server restart.
        var alreadyBound = vendorSession.cliSessionId && vendorSession.vendor && vendorSession.vendor !== msg.vendor;
        if (alreadyBound) {
          console.warn("[project] set_vendor ignored: session " + vendorSession.localId +
            " is bound to '" + vendorSession.vendor + "', refused rebind to '" + msg.vendor + "'");
        } else {
          vendorSession.vendor = msg.vendor;
          if (vendorSession.vendor !== msg.vendor) vendorSession.model = "";
          sm.saveSessionFile(vendorSession);
          sm.broadcastSessionList();
        }
      }
      if (msg.vendor) {
        var vendorModels = (sm.modelsByVendor && sm.modelsByVendor[msg.vendor]) || [];
        sendTo(ws, {
          type: "model_info",
          model: "",
          models: vendorModels,
          vendor: msg.vendor, sessionId: vendorSession ? vendorSession.localId : null,
          availableVendors: sm.availableVendors || [],
          installedVendors: sm.installedVendors || [],
        });
        send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode || "default", effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      }
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

    if (msg.type === "set_permission_mode" && msg.mode) {
      sm.currentPermissionMode = msg.mode;
      var session = getSessionForWs(ws);
      if (session) {
        session.permissionMode = msg.mode;
        sm.saveSessionFile(session);
        sm.broadcastSessionList();
        sdk.setPermissionMode(session, msg.mode);
      }
      send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
      return true;
    }

    if (msg.type === "set_session_full_access") {
      var fullAccessSession = msg.id ? sm.sessions.get(Number(msg.id)) : getSessionForWs(ws);
      var fullAccessEnabled = msg.enabled === true;
      var fullAccessMode = fullAccessSession && (fullAccessSession.runtimeMode || fullAccessSession.mode || "gui");
      if (!fullAccessSession || fullAccessMode !== "gui") {
        sendTo(ws, { type: "session_full_access_result", ok: false, id: msg.id || null, error: "Skip Permissions is only available for GUI sessions." });
        return true;
      }
      if (usersModule.isMultiUser() && ws._clayUser &&
          !usersModule.canAccessSession(ws._clayUser.id, fullAccessSession, { visibility: "public" })) {
        sendTo(ws, { type: "session_full_access_result", ok: false, id: fullAccessSession.localId, error: "You do not have access to this session." });
        return true;
      }

      var previousFullAccess = fullAccessSession.permissionMode === "bypassPermissions";
      var previousPermissionMode = fullAccessSession.permissionMode || null;
      var previousRestoreMode = fullAccessSession.permissionModeBeforeFullAccess || null;
      if (fullAccessEnabled) {
        if (!previousFullAccess) {
          fullAccessSession.permissionModeBeforeFullAccess = fullAccessSession.permissionMode || sm.currentPermissionMode || "default";
        }
        fullAccessSession.permissionMode = "bypassPermissions";
      } else {
        fullAccessSession.permissionMode = fullAccessSession.permissionModeBeforeFullAccess || "default";
        fullAccessSession.permissionModeBeforeFullAccess = null;
      }

      (async function () {
        try {
          // Clay's common canUseTool callback owns permission skipping for
          // every vendor. If an adapter supports native mode switching, keep
          // it in a normal mode so Clay remains the single approval layer.
          if (fullAccessSession.queryInstance && typeof fullAccessSession.queryInstance.setPermissionMode === "function") {
            await fullAccessSession.queryInstance.setPermissionMode(fullAccessEnabled ? "default" : fullAccessSession.permissionMode);
          }
          sm.saveSessionFile(fullAccessSession);
          sm.broadcastSessionList();
          send({ type: "session_full_access_changed", id: fullAccessSession.localId, enabled: fullAccessEnabled, permissionMode: fullAccessSession.permissionMode });
          sendTo(ws, { type: "session_full_access_result", ok: true, id: fullAccessSession.localId, enabled: fullAccessEnabled });
        } catch (e) {
          fullAccessSession.permissionMode = previousPermissionMode;
          fullAccessSession.permissionModeBeforeFullAccess = previousRestoreMode;
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
        sdk.setEffort(session, sessionEffort).catch(function (e) {
          sendTo(ws, { type: "error", text: "Failed to change reasoning effort: " + (e.message || e) });
        });
        sm.sendToSession(session, { type: "config_state", model: session.model || ((sm.defaultModelByVendor || {})[effortVendor]) || "", vendor: effortVendor, sessionId: session.localId, mode: session.permissionMode || sm.currentPermissionMode || "default", effort: sessionEffort, betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
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

    // Codex-specific settings (stored on sessionManager, passed to adapter via adapterOptions)
    if (msg.type === "set_codex_approval") {
      sm.codexApproval = getCodexConfig({ codexApproval: msg.approval }).approval;
      send(Object.assign({ type: "codex_config" }, getCodexConfig(sm)));
      return true;
    }
    if (msg.type === "set_codex_sandbox") {
      sm.codexSandbox = msg.sandbox || CODEX_DEFAULTS.sandbox;
      send(Object.assign({ type: "codex_config" }, getCodexConfig(sm)));
      return true;
    }
    if (msg.type === "set_codex_websearch") {
      sm.codexWebSearch = msg.webSearch || CODEX_DEFAULTS.webSearch;
      send(Object.assign({ type: "codex_config" }, getCodexConfig(sm)));
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
      session._rewindInProgress = true;
      var mode = msg.mode || "both";

      (async function () {
        try {
          // File restoration (delegated to adapter via sdk-bridge)
          if (mode !== "chat") {
            await sdk.rewindExecuteFiles(session, msg.uuid);
          }

          // Conversation rollback (skip for files-only mode)
          if (mode !== "files") {
            var targetIdx = -1;
            for (var i = 0; i < session.messageUUIDs.length; i++) {
              if (session.messageUUIDs[i].uuid === msg.uuid) {
                targetIdx = i;
                break;
              }
            }

            // Count turns to roll back BEFORE trimming local history
            var turnsToRollBack = 0;
            if (targetIdx >= 0) {
              for (var ri = targetIdx; ri < session.messageUUIDs.length; ri++) {
                if (session.messageUUIDs[ri].type === "user") turnsToRollBack++;
              }
            }

            if (targetIdx >= 0) {
              var trimTo = session.messageUUIDs[targetIdx].historyIndex;
              for (var k = trimTo - 1; k >= 0; k--) {
                if (session.history[k].type === "user_message") {
                  trimTo = k;
                  break;
                }
              }
              session.history = session.history.slice(0, trimTo);
              session.messageUUIDs = session.messageUUIDs.slice(0, targetIdx);
              // Reset digest checkpoint if it points past the trimmed history
              if (typeof session._dmLastDigestedIndex === "number" && session._dmLastDigestedIndex > trimTo) {
                session._dmLastDigestedIndex = trimTo;
              }
            }

            // Notify adapter of conversation rollback (e.g. Codex thread/rollback)
            if (turnsToRollBack > 0) {
              try {
                await sdk.rollbackConversation(session, turnsToRollBack);
              } catch (rbErr) {
                console.error("[project-sessions] conversation rollback failed:", rbErr.message || rbErr);
              }
            }

            var kept = session.messageUUIDs;
            session.lastRewindUuid = kept.length > 0 ? kept[kept.length - 1].uuid : null;
          }

          if (session.abortController) {
            try { session.abortController.abort(); } catch (e) {}
          }
          if (session.messageQueue) {
            try { session.messageQueue.end(); } catch (e) {}
          }
          session.queryInstance = null;
          session.messageQueue = null;
          session.abortController = null;
          session.blocks = {};
          session.sentToolResults = {};
          session.pendingPermissions = {};
          cancelPendingAskUser(session, "Conversation rewound");
          session.isProcessing = false;
          onProcessingChanged();

          sm.saveSessionFile(session);
          sm.switchSession(session.localId, ws, hydrateImageRefs);
          sm.sendAndRecord(session, { type: "rewind_complete", mode: mode });
          sm.broadcastSessionList();
        } catch (err) {
          sendTo(ws, { type: "rewind_error", text: "Rewind failed: " + err.message });
        } finally {
          session._rewindInProgress = false;
        }
      })();
      return true;
    }

    if (msg.type === "fork_session" && msg.uuid) {
      var session = getSessionForWs(ws);
      if (!session || !session.cliSessionId) {
        sendTo(ws, { type: "error", text: "Cannot fork: no CLI session" });
        return true;
      }
      var forkTitle = (session.title || "New Session") + " (fork)";

      sdk.forkSession(session, msg.uuid).then(function(result) {
        if (result.useLocalHistory) {
          // Copy local history up to the target UUID
          var targetIdx = -1;
          for (var fi = 0; fi < session.messageUUIDs.length; fi++) {
            if (session.messageUUIDs[fi].uuid === msg.uuid) { targetIdx = fi; break; }
          }
          var forkHistory = [];
          if (targetIdx >= 0) {
            var trimTo = session.messageUUIDs[targetIdx].historyIndex;
            forkHistory = session.history.slice(0, trimTo);
          } else {
            forkHistory = session.history.slice();
          }
          var forked = sm.createSession({ vendor: session.vendor, ownerId: session.ownerId || null }, ws);
          forked.cliSessionId = result.sessionId;
          forked.title = forkTitle;
          forked.history = forkHistory;
          forked.messageUUIDs = [];
          for (var hi = 0; hi < forkHistory.length; hi++) {
            if (forkHistory[hi].type === "message_uuid") {
              forked.messageUUIDs.push({ uuid: forkHistory[hi].uuid, type: forkHistory[hi].messageType, historyIndex: hi });
            }
          }
          sm.saveSessionFile(forked);
          sm.switchSession(forked.localId, ws, hydrateImageRefs);
          sendTo(ws, { type: "fork_complete", sessionId: forked.localId });
          sm.broadcastSessionList();
        } else {
          // Read history from CLI session files
          var cliSess = require("./cli-sessions");
          return cliSess.readCliSessionHistory(resolveSessionHome(session), cwd, result.sessionId).then(function(history) {
            var forked = sm.resumeSession(result.sessionId, { history: history, title: forkTitle }, ws);
            if (forked) {
              ws._clayActiveSession = forked.localId;
              sendTo(ws, { type: "fork_complete", sessionId: forked.localId });
            }
          });
        }
      }).catch(function(e) {
        sendTo(ws, { type: "error", text: "Fork failed: " + (e.message || e) });
      });
      return true;
    }

    if (msg.type === "ask_user_response") {
      var session = getSessionForWs(ws);
      if (session) respondToAskUser(session, msg);
      return true;
    }

    if (msg.type === "input_sync") {
      sendToSessionOthers(ws, ws._clayActiveSession, msg);
      return true;
    }

    if (msg.type === "cursor_move" || msg.type === "cursor_leave" || msg.type === "text_select") {
      if (!usersModule.isMultiUser() || !ws._clayUser) return true;
      var u = ws._clayUser;
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
      var pending = session.pendingPermissions[requestId];
      if (!pending) return true;
      delete sm.permissionRequestIndex[requestId];
      delete session.pendingPermissions[requestId];
      onProcessingChanged(); // update cross-project permission badge

      // --- Plan approval: "allow_accept_edits" -- approve + switch to acceptEdits mode ---
      if (decision === "allow_accept_edits") {
        sdk.setPermissionMode(session, "acceptEdits");
        sm.currentPermissionMode = "acceptEdits";
        send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });
        pending.resolve({ behavior: "allow", updatedInput: pending.toolInput });
        sm.sendAndRecord(session, { type: "permission_resolved", requestId: requestId, decision: decision });
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

        // Update permission mode for the new session
        sm.currentPermissionMode = "acceptEdits";
        send({ type: "config_state", vendor: null, sessionId: null, mode: sm.currentPermissionMode, effort: sm.currentEffort || "medium", betas: sm.currentBetas || [], thinking: sm.currentThinking || "adaptive", thinkingBudget: sm.currentThinkingBudget || 10000 });

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
            var userMsg = { type: "user_message", text: feedback };
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
      var pending = session.pendingElicitations && session.pendingElicitations[msg.requestId];
      if (!pending) return true;
      delete session.pendingElicitations[msg.requestId];
      if (msg.action === "accept") {
        pending.resolve({ action: "accept", content: msg.content || {} });
      } else {
        pending.resolve({ action: "reject" });
      }
      sm.sendAndRecord(session, {
        type: "elicitation_resolved",
        requestId: msg.requestId,
        action: msg.action,
      });
      return true;
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
      // Multi-user mode: non-admins can only browse their home directory
      if (osUsers && osUsers.length > 0 && ws._clayUser && ws._clayUser.role !== "admin") {
        var browseHome = ws._clayUser.linuxUser ? "/home/" + ws._clayUser.linuxUser : null;
        if (!browseHome || (absTarget !== browseHome && (absTarget + "/").indexOf(browseHome + "/") !== 0)) {
          sendTo(ws, { type: "browse_dir_result", path: msg.path, entries: [], error: "Access restricted to your home directory" });
          return true;
        }
      }
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
      try {
        var dirItems = fs.readdirSync(parentDir, { withFileTypes: true });
        var dirEntries = [];
        for (var di = 0; di < dirItems.length; di++) {
          var d = dirItems[di];
          if (!d.isDirectory()) continue;
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
      // Multi-user mode: normal users restricted to their home directory
      if (osUsers && osUsers.length > 0 && ws._clayUser && ws._clayUser.role !== "admin") {
        if (!ws._clayUser.linuxUser) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "No Linux user assigned" });
          return true;
        }
        var userHome = "/home/" + ws._clayUser.linuxUser;
        if (addAbs !== userHome && (addAbs + "/").indexOf(userHome + "/") !== 0) {
          sendTo(ws, { type: "add_project_result", ok: false, error: "Path not allowed. You can only add directories under " + userHome });
          return true;
        }
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
        sendTo(ws, { type: "add_project_result", ok: result.ok, slug: result.slug, error: result.error, existing: result.existing });
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
        sendTo(ws, { type: "add_project_result", ok: createResult.ok, slug: createResult.slug, error: createResult.error });
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
      if (!checkSlug) {
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
      // If client chose to move tasks to another project before removing
      if (msg.moveTasksTo) {
        moveAllSchedulesToProject(removeSlug, msg.moveTasksTo);
      }
      if (typeof opts.onRemoveProject === "function") {
        // Send result before removing so the WS is still open
        sendTo(ws, { type: "remove_project_result", ok: true, slug: removeSlug });
        var removeUserId = ws._clayUser ? ws._clayUser.id : null;
        opts.onRemoveProject(removeSlug, removeUserId);
      } else {
        sendTo(ws, { type: "remove_project_result", ok: false, error: "Not supported" });
      }
      return true;
    }

    // --- Move a single schedule to another project ---
    if (msg.type === "schedule_move") {
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
        sendTo(ws, { type: "set_project_title_result", ok: titleResult.ok, slug: msg.slug, error: titleResult.error });
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
        var _wsUser = ws._clayUser;
        if (!_wsUser || _wsUser.role !== "admin") {
          sendTo(ws, { type: "error", message: "Admin access required" });
          return true;
        }
      }
    }

    if (msg.type === "get_daemon_config") {
      if (typeof opts.onGetDaemonConfig === "function") {
        var daemonConfig = opts.onGetDaemonConfig();
        sendTo(ws, { type: "daemon_config", config: daemonConfig });
      }
      return true;
    }

    if (msg.type === "set_pin") {
      if (typeof opts.onSetPin === "function") {
        var pinResult = opts.onSetPin(msg.pin || null);
        sendTo(ws, { type: "set_pin_result", ok: pinResult.ok, pinEnabled: pinResult.pinEnabled });
      }
      return true;
    }

    if (msg.type === "set_keep_awake") {
      if (typeof opts.onSetKeepAwake === "function") {
        var kaResult = opts.onSetKeepAwake(msg.value);
        sendTo(ws, { type: "set_keep_awake_result", ok: kaResult.ok, keepAwake: kaResult.keepAwake });
        send({ type: "keep_awake_changed", keepAwake: kaResult.keepAwake });
      }
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

    if (msg.type === "set_inherit_groups") {
      if (typeof opts.onSetInheritGroups === "function") {
        var igResult = opts.onSetInheritGroups(msg.value);
        sendTo(ws, { type: "set_inherit_groups_result", ok: igResult.ok, inheritGroups: igResult.inheritGroups });
        send({ type: "inherit_groups_changed", inheritGroups: igResult.inheritGroups });
      }
      return true;
    }

    if (msg.type === "get_claude_allow_list") {
      var galUid = ws._clayUser ? ws._clayUser.id : null;
      var galManaged = [];
      var galUser = [];
      try {
        var galInstaller = require("./claude-hook-installer");
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
      try {
        var salInstaller = require("./claude-hook-installer");
        var salHome = null;
        if (osUsers && ws._clayUser && ws._clayUser.linuxUser) {
          try {
            var salInfo = require("./os-users").resolveOsUserInfo(ws._clayUser.linuxUser);
            if (salInfo && salInfo.home) salHome = salInfo.home;
          } catch (e) {}
        }
        if (!salHome) salHome = require("os").homedir();
        var salMerged = (salInstaller.CLAY_MANAGED_ALLOW || []).concat(salResult.claudeUserAllowList);
        salInstaller.installAllowList({ homeDirs: [salHome], patterns: salMerged });
      } catch (e) {}
      sendTo(ws, { type: "set_claude_user_allow_list_result", ok: true, patterns: salResult.claudeUserAllowList });
      return true;
    }

    if (msg.type === "whats_new_seen") {
      // Persist that the current user dismissed a What's New entry so it
      // is not shown again on future connects.
      var wnUserId = ws._clayUser ? ws._clayUser.id : null;
      if (!wnUserId) {
        sendTo(ws, { type: "whats_new_seen_result", ok: false, error: "no_user" });
        return true;
      }
      var wnSvc = require("./whats-new");
      var wnResult = wnSvc.markSeen(wnUserId, msg.id);
      if (wnResult && wnResult.ok) {
        sendTo(ws, { type: "whats_new_seen_result", ok: true, id: msg.id });
      } else {
        sendTo(ws, { type: "whats_new_seen_result", ok: false, error: (wnResult && wnResult.error) || "unknown" });
      }
      return true;
    }

    if (msg.type === "set_claude_open_mode") {
      // Per-user preference: when Clay opens a Claude session, render it as
      // the SDK-driven custom chat ("gui") or as an embedded `claude` TUI
      // ("tui"). Applies to the next session open; currently displayed
      // sessions are not re-rendered retroactively.
      var comUserId = ws._clayUser ? ws._clayUser.id : null;
      if (!comUserId) {
        sendTo(ws, { type: "set_claude_open_mode_result", ok: false, error: "no_user" });
        return true;
      }
      var comResult = usersModule.setClaudeOpenMode(comUserId, msg.value);
      if (comResult && comResult.ok) {
        sendTo(ws, { type: "set_claude_open_mode_result", ok: true, claudeOpenMode: comResult.claudeOpenMode });
        // Echo as a "changed" broadcast for this user's other tabs/devices.
        sendTo(ws, { type: "claude_open_mode_changed", claudeOpenMode: comResult.claudeOpenMode });
      } else {
        sendTo(ws, { type: "set_claude_open_mode_result", ok: false, error: (comResult && comResult.error) || "unknown" });
      }
      return true;
    }

    if (msg.type === "set_image_retention") {
      if (typeof opts.onSetImageRetention === "function") {
        var irResult = opts.onSetImageRetention(msg.days);
        sendTo(ws, { type: "set_image_retention_result", ok: irResult.ok, days: irResult.days });
      }
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
    handleSessionsMessage: handleSessionsMessage,
    resolveSessionForView: resolveSessionForView,
    respondToAskUser: respondToAskUser,
    respondToHomePermission: function (ws, msg, session) {
      if (!session || !msg || !session.pendingPermissions || !session.pendingPermissions[msg.requestId]) return false;
      var indexedSessionId = sm.permissionRequestIndex[msg.requestId];
      if (indexedSessionId !== session.localId || sm.sessions.get(indexedSessionId) !== session) return false;
      return handleSessionsMessage(ws, { type: "permission_response", requestId: msg.requestId, decision: msg.decision });
    },
    stopHomeSession: stopSession,
  };
}

module.exports = { attachSessions: attachSessions };
