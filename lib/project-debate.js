var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var matesModule = require("./mates");
var debateToolPolicy = require("./home-debate-tool-policy");

/**
 * Attach debate engine to a project context.
 *
 * ctx fields:
 *   cwd, slug, send, sendTo, sendToSession, sm, sdk,
 *   getMateProfile, loadMateClaudeMd, loadMateDigests,
 *   hydrateImageRefs, onProcessingChanged, getLinuxUserForSession, getSessionForWs,
 *   updateMemorySummary, initMemorySummary, enqueueDigest
 */
function attachDebate(ctx) {

  // For mate projects, enforce latest debate awareness prompt in CLAUDE.md
  // so mates use the propose_debate MCP tool instead of writing files.
  if (ctx.isMate) {
    var _debateClaudeMdPath = path.join(ctx.cwd, "CLAUDE.md");
    try { matesModule.enforceDebateAwareness(_debateClaudeMdPath); } catch (e) {}
  }

  // --- Helpers shared with other modules ---

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildDebateNameMap(panelists, mateCtx) {
    var nameMap = {};
    for (var i = 0; i < panelists.length; i++) {
      var mate = matesModule.getMate(mateCtx, panelists[i].mateId);
      if (!mate) continue;
      var name = (mate.profile && mate.profile.displayName) || mate.name || "";
      if (name) {
        nameMap[name] = panelists[i].mateId;
      }
    }
    return nameMap;
  }

  function detectMentions(text, nameMap) {
    var names = Object.keys(nameMap);
    // Sort by length descending to match longest name first
    names.sort(function (a, b) { return b.length - a.length; });
    var mentioned = [];
    // Strip markdown inline formatting so **@Name**, ~~@Name~~, `@Name`, [@Name](url) etc. still match
    var cleaned = text
      .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")   // [text](url) -> text
      .replace(/`([^`]*)`/g, "$1")                // `code` -> code
      .replace(/(\*{1,3}|_{1,3}|~{2})/g, "");    // bold, italic, strikethrough markers
    console.log("[debate-mention] nameMap keys:", JSON.stringify(names));
    console.log("[debate-mention] text snippet:", cleaned.slice(0, 200));
    for (var i = 0; i < names.length; i++) {
      // Match @Name followed by any non-name character (not alphanumeric, not Korean, not dash/underscore)
      var pattern = new RegExp("@" + escapeRegex(names[i]) + "(?![\\p{L}\\p{N}_-])", "iu");
      var matched = pattern.test(cleaned);
      console.log("[debate-mention] testing @" + names[i] + " pattern=" + pattern.toString() + " matched=" + matched);
      if (matched) {
        var mateId = nameMap[names[i]];
        if (mentioned.indexOf(mateId) === -1) {
          mentioned.push(mateId);
        }
      }
    }
    return mentioned;
  }

  // --- Context builders ---

  function buildModeratorContext(debate) {
    var lines = [
      "You are moderating a structured debate among your AI teammates.",
      "",
      "Topic: " + debate.topic,
      "Format: " + debate.format,
      "Context: " + debate.context,
    ];
    if (debate.specialRequests) {
      lines.push("Special requests: " + debate.specialRequests);
    }
    lines.push("");
    lines.push("Panelists:");
    for (var i = 0; i < debate.panelists.length; i++) {
      var p = debate.panelists[i];
      var profile = ctx.getMateProfile(debate.mateCtx, p.mateId);
      lines.push("- @" + profile.name + " (" + p.role + "): " + p.brief);
    }
    lines.push("");
    lines.push("RULES:");
    lines.push("1. To call on a panelist, mention them with @TheirName in your response.");
    lines.push("2. Only mention ONE panelist per response. Wait for their answer before calling the next.");
    lines.push("3. When you mention a panelist, clearly state what you want them to address.");
    lines.push("4. After hearing from all panelists, you may start additional rounds.");
    lines.push("5. When you believe the debate has reached a natural conclusion, provide a summary WITHOUT mentioning any panelist. A response with no @mention signals the end of the debate.");
    lines.push("6. If the user interjects with a comment, acknowledge it and weave it into the discussion.");
    lines.push("7. You govern debate tool access: non-mutating investigation is permitted and shown to the user, while any capability that could change the system is blocked.");
    lines.push("");
    lines.push("Begin by introducing the topic and calling on the first panelist.");
    return lines.join("\n");
  }

  function buildPanelistContext(debate, panelistInfo) {
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);
    var lines = [
      "You are participating in a structured debate as a panelist.",
      "",
      "Topic: " + debate.topic,
      "Your role: " + panelistInfo.role,
      "Your brief: " + panelistInfo.brief,
      "",
      "Other panelists:",
    ];
    for (var i = 0; i < debate.panelists.length; i++) {
      var p = debate.panelists[i];
      if (p.mateId === panelistInfo.mateId) continue;
      var profile = ctx.getMateProfile(debate.mateCtx, p.mateId);
      lines.push("- @" + profile.name + " (" + p.role + "): " + p.brief);
    }
    lines.push("");
    lines.push("The moderator is @" + moderatorProfile.name + ". They will call on you when it is your turn.");
    lines.push("");
    lines.push("RULES:");
    lines.push("1. Stay in your assigned role and perspective.");
    lines.push("2. Respond to the specific question or prompt from the moderator.");
    lines.push("3. You may reference what other panelists have said.");
    lines.push("4. Keep responses focused and substantive. Do not ramble.");
    lines.push("5. You may use investigation tools when they strengthen your argument. The moderator automatically permits non-mutating research and blocks system changes.");
    return lines.join("\n");
  }

  function buildDebateToolHandler(session, mateId) {
    return function (toolName, input, toolOpts) {
      var decision = debateToolPolicy.debateToolDecision(toolName, input);
      var debate = session && session._debate;
      var profile = debate ? ctx.getMateProfile(debate.mateCtx, mateId) : null;
      debateSendAndRecord(session, {
        type: "debate_tool_decision",
        decisionId: toolOpts && toolOpts.toolUseID ? toolOpts.toolUseID : crypto.randomUUID(),
        mateId: mateId || null,
        mateName: profile && profile.name ? profile.name : "Mate",
        toolName: debateToolPolicy.displayToolName(toolName),
        action: decision.action,
        command: decision.command,
        commandTruncated: decision.commandTruncated,
        decision: decision.allowed ? "allowed" : "blocked",
        reason: decision.reason,
      });
      return Promise.resolve({
        behavior: decision.behavior,
        updatedInput: decision.updatedInput,
        message: decision.message,
      });
    };
  }

  function participantModel(debate, mateId) {
    var selections = debate && Array.isArray(debate.participantModels) ? debate.participantModels : [];
    for (var i = 0; i < selections.length; i++) {
      if (selections[i] && selections[i].mateId === mateId) return selections[i];
    }
    return null;
  }

  // --- State persistence ---

  function persistDebateState(session) {
    if (!session._debate) return;
    var d = session._debate;
    session.debateState = {
      phase: d.phase,
      topic: d.topic,
      format: d.format,
      context: d.context || "",
      specialRequests: d.specialRequests || null,
      moderatorId: d.moderatorId,
      participantModels: Array.isArray(d.participantModels) ? d.participantModels.map(function (item) {
        return { mateId: item.mateId, vendor: item.vendor, model: item.model };
      }) : [],
      panelists: d.panelists.map(function (p) {
        return { mateId: p.mateId, role: p.role || "", brief: p.brief || "" };
      }),
      briefPath: d.briefPath || null,
      debateId: d.debateId || null,
      setupSessionId: d.setupSessionId || null,
      setupStartedAt: d.setupStartedAt || null,
      round: d.round || 1,
      awaitingConcludeConfirm: !!d.awaitingConcludeConfirm,
      awaitingUserFloor: !!d.awaitingUserFloor,
      ownerId: d.ownerId || null,
      turnSequence: d.turnSequence || 0,
    };
    ctx.sm.saveSessionFile(session);
  }

  function restoreDebateFromState(session, restoreUserId) {
    var ds = session.debateState;
    if (!ds) return null;
    var userId = restoreUserId || ds.ownerId || null;
    var mateCtx = matesModule.buildMateCtx(userId);
    var debate = {
      phase: ds.phase,
      topic: ds.topic,
      format: ds.format,
      context: ds.context || "",
      specialRequests: ds.specialRequests || null,
      moderatorId: ds.moderatorId,
      participantModels: Array.isArray(ds.participantModels) ? ds.participantModels : [],
      panelists: ds.panelists || [],
      mateCtx: mateCtx,
      moderatorSession: null,
      panelistSessions: {},
      nameMap: buildDebateNameMap(ds.panelists || [], mateCtx),
      turnInProgress: false,
      pendingComment: null,
      round: ds.round || 1,
      history: [],
      setupSessionId: ds.setupSessionId || null,
      debateId: ds.debateId || null,
      setupStartedAt: ds.setupStartedAt || null,
      briefPath: ds.briefPath || null,
      awaitingConcludeConfirm: !!ds.awaitingConcludeConfirm,
      awaitingUserFloor: !!ds.awaitingUserFloor,
      ownerId: ds.ownerId || userId,
      turnSequence: ds.turnSequence || 0,
    };

    // Fallback: if awaitingConcludeConfirm was not persisted, detect from history
    if (!debate.awaitingConcludeConfirm && ds.phase === "live") {
      var hasEnded = false;
      var hasConclude = false;
      var lastModText = null;
      for (var i = 0; i < session.history.length; i++) {
        var h = session.history[i];
        if (h.type === "debate_ended") hasEnded = true;
        if (h.type === "debate_conclude_confirm") hasConclude = true;
        if (h.type === "debate_turn_done" && h.role === "moderator") lastModText = h.text || "";
      }
      // conclude_confirm in history without a subsequent ended = still awaiting user decision
      if (hasConclude && !hasEnded) {
        debate.awaitingConcludeConfirm = true;
      } else if (!hasEnded && !hasConclude && lastModText !== null) {
        // No explicit entry yet; infer from last moderator text having no @mentions
        var mentions = detectMentions(lastModText, debate.nameMap);
        if (mentions.length === 0) {
          debate.awaitingConcludeConfirm = true;
        }
      }
    }

    session._debate = debate;
    return debate;
  }

  // --- Brief watcher ---

  function startDebateBriefWatcher(session, debate, briefPath) {
    if (!briefPath) {
      console.error("[debate] No briefPath provided to watcher");
      return;
    }
    // Persist briefPath on debate so restoration can reuse it
    debate.briefPath = briefPath;
    var watchDir = path.dirname(briefPath);
    var briefFilename = path.basename(briefPath);

    // Clean up any existing watcher
    if (debate._briefWatcher) {
      try { debate._briefWatcher.close(); } catch (e) {}
      debate._briefWatcher = null;
    }
    if (debate._briefDebounce) {
      clearTimeout(debate._briefDebounce);
      debate._briefDebounce = null;
    }

    function checkDebateBrief() {
      try {
        var raw = fs.readFileSync(briefPath, "utf8");
        var brief = JSON.parse(raw);

        // Stop watching
        if (debate._briefWatcher) { debate._briefWatcher.close(); debate._briefWatcher = null; }
        if (debate._briefDebounce) { clearTimeout(debate._briefDebounce); debate._briefDebounce = null; }

        // Clean up the brief file
        try { fs.unlinkSync(briefPath); } catch (e) {}

        // Apply brief to debate state
        debate.topic = brief.topic || debate.topic;
        debate.format = brief.format || debate.format;
        debate.context = brief.context || "";
        debate.specialRequests = brief.specialRequests || null;

        // Replace panelists with those selected in the brief
        if (brief.panelists && brief.panelists.length) {
          debate.panelists = brief.panelists.map(function (bp) {
            return { mateId: bp.mateId, role: bp.role || "", brief: bp.brief || "" };
          });
        }

        // Rebuild name map with updated roles
        var mateCtx = debate.mateCtx || matesModule.buildMateCtx(null);
        debate.nameMap = buildDebateNameMap(debate.panelists, mateCtx);

        // quickStart from DM or no setupSessionId: show brief card for user approval
        if (!debate.setupSessionId || debate.quickStart) {
          console.log("[debate] Brief picked up, entering review phase. Topic:", debate.topic);
          debate.phase = "reviewing";
          persistDebateState(session);

          var moderatorProfile = ctx.getMateProfile(mateCtx, debate.moderatorId);
          var briefReadyMsg = {
            type: "debate_brief_ready",
            debateId: debate.debateId,
            topic: debate.topic,
            format: debate.format || "free_discussion",
            context: debate.context || "",
            specialRequests: debate.specialRequests || null,
            moderatorId: debate.moderatorId,
            moderatorName: moderatorProfile.name,
            panelists: debate.panelists.map(function (p) {
              var prof = ctx.getMateProfile(mateCtx, p.mateId);
              return { mateId: p.mateId, name: prof.name, role: p.role || "", brief: p.brief || "" };
            }),
          };
          ctx.sendToSession(session.localId, briefReadyMsg);
          // Also send to setup session if client switched there (quickStart flow)
          if (debate.setupSessionId && debate.setupSessionId !== session.localId) {
            ctx.sendToSession(debate.setupSessionId, briefReadyMsg);
          }
        } else {
          console.log("[debate] Brief picked up, transitioning to live. Topic:", debate.topic);
          // Transition to live (standard flow via modal/skill)
          startDebateLive(session);
        }
      } catch (e) {
        // File not ready yet or invalid JSON, keep watching
      }
    }

    try {
      try { fs.mkdirSync(watchDir, { recursive: true }); } catch (e) {}
      debate._briefWatcher = fs.watch(watchDir, function (eventType, filename) {
        if (filename === briefFilename) {
          if (debate._briefDebounce) clearTimeout(debate._briefDebounce);
          debate._briefDebounce = setTimeout(checkDebateBrief, 300);
        }
      });
      debate._briefWatcher.on("error", function () {});
      console.log("[debate] Watching for " + briefFilename + " at " + watchDir);
    } catch (e) {
      console.error("[debate] Failed to watch " + watchDir + ":", e.message);
    }

    // Check immediately in case the file already exists (server restart scenario)
    checkDebateBrief();
  }

  // --- Restore debate on reconnect ---

  function restoreDebateState(ws) {
    // On server restart, SDK sessions are lost so debates cannot continue.
    // Clear stale debate state instead of restoring dead UI.
    ctx.sm.sessions.forEach(function (session) {
      // A live in-memory debate belongs to this daemon and must survive a
      // websocket reconnect. Persisted state without its runtime object is
      // the restart case that cannot safely resume dead mention processes.
      if (session._debate) return;
      if (session.debateState) {
        var phase = session.debateState.phase;
        if (session.homeDebatePlanning === true && (phase === "live" || phase === "ending")) {
          session.homeDebatePhase = "interrupted";
          session.debateState.phase = "interrupted";
          var lastLifecycle = null;
          for (var li = session.history.length - 1; li >= 0; li--) {
            var lifecycleType = session.history[li] && session.history[li].type;
            if (lifecycleType === "debate_started" || lifecycleType === "debate_resumed" || lifecycleType === "debate_ended") { lastLifecycle = lifecycleType; break; }
          }
          if (lastLifecycle !== "debate_ended") session.history.push({ type: "debate_ended", topic: session.debateState.topic || session.title || "Debate", rounds: session.debateState.round || 1, reason: "interrupted", _ts: Date.now() });
          ctx.sm.saveSessionFile(session);
          return;
        }
        if (phase === "preparing" || phase === "reviewing" || phase === "live") {
          console.log("[debate] Clearing stale debate state:", session.debateState.topic);
          session.debateState = null;
          ctx.sm.saveSessionFile(session);
        }
      }
    });
  }

  // --- Check for DM debate brief ---

  function checkForDmDebateBrief(session, mateId, mateCtx) {
    // Skip if there's already an active debate on this session
    if (session._debate && (session._debate.phase === "preparing" || session._debate.phase === "reviewing" || session._debate.phase === "live")) return;

    var debatesDir = path.join(ctx.cwd, ".clay", "debates");
    var dirs;
    try {
      dirs = fs.readdirSync(debatesDir);
    } catch (e) {
      return; // No debates directory
    }

    for (var i = 0; i < dirs.length; i++) {
      var briefPath = path.join(debatesDir, dirs[i], "brief.json");
      var raw;
      try {
        raw = fs.readFileSync(briefPath, "utf8");
      } catch (e) {
        continue; // No brief.json in this dir
      }

      var brief;
      try {
        brief = JSON.parse(raw);
      } catch (e) {
        continue; // Invalid JSON
      }

      // Found a valid brief - create debate state
      var debateId = dirs[i];
      console.log("[debate] Found DM debate brief from mate " + mateId + ", debateId:", debateId);

      // Clean up the brief file
      try { fs.unlinkSync(briefPath); } catch (e) {}

      var debate = {
        phase: "reviewing",
        topic: brief.topic || "Untitled debate",
        format: brief.format || "free_discussion",
        context: brief.context || "",
        specialRequests: brief.specialRequests || null,
        moderatorId: mateId,
        panelists: (brief.panelists || []).map(function (p) {
          return { mateId: p.mateId, role: p.role || "", brief: p.brief || "" };
        }),
        mateCtx: mateCtx,
        moderatorSession: null,
        panelistSessions: {},
        nameMap: null,
        turnInProgress: false,
        pendingComment: null,
        round: 1,
        history: [],
        setupSessionId: null,
        debateId: debateId,
        briefPath: briefPath,
        ownerId: mateCtx.userId || null,
      };
      debate.nameMap = buildDebateNameMap(debate.panelists, mateCtx);
      session._debate = debate;
      persistDebateState(session);

      var moderatorProfile = ctx.getMateProfile(mateCtx, mateId);
      ctx.sendToSession(session.localId, {
        type: "debate_brief_ready",
        debateId: debateId,
        topic: debate.topic,
        format: debate.format,
        context: debate.context,
        specialRequests: debate.specialRequests,
        moderatorId: mateId,
        moderatorName: moderatorProfile.name,
        panelists: debate.panelists.map(function (p) {
          var prof = ctx.getMateProfile(mateCtx, p.mateId);
          return { mateId: p.mateId, name: prof.name, role: p.role || "", brief: p.brief || "" };
        }),
      });
      return; // Only process first brief found
    }
  }

  // --- Main debate handlers ---

  function handleDebateStart(ws, msg) {
    var session = ctx.getSessionForWs(ws);
    if (!session) return;

    if (!msg.moderatorId || !msg.topic) {
      ctx.sendTo(ws, { type: "debate_error", error: "Missing required fields: moderatorId, topic." });
      return;
    }

    // delegatePanelists: moderator picks panelists, populate all available mates
    if (msg.delegatePanelists) {
      var userId = ws._clayUser ? ws._clayUser.id : null;
      var tmpCtx = matesModule.buildMateCtx(userId);
      var matesData = matesModule.loadMates(tmpCtx);
      var allMates = matesData.mates || [];
      msg.panelists = [];
      for (var mi = 0; mi < allMates.length; mi++) {
        if (allMates[mi].id !== msg.moderatorId && allMates[mi].status !== "interviewing") {
          msg.panelists.push({ mateId: allMates[mi].id, role: "", brief: "" });
        }
      }
    }

    if (!msg.panelists || !msg.panelists.length) {
      ctx.sendTo(ws, { type: "debate_error", error: "No panelists available." });
      return;
    }

    if (session._debate && (session._debate.phase === "live" || session._debate.phase === "preparing")) {
      ctx.sendTo(ws, { type: "debate_error", error: "A debate is already in progress." });
      return;
    }

    // Block mentions during debate
    if (session._mentionInProgress) {
      ctx.sendTo(ws, { type: "debate_error", error: "A mention is in progress. Wait for it to finish." });
      return;
    }

    var userId = ws._clayUser ? ws._clayUser.id : null;
    var mateCtx = matesModule.buildMateCtx(userId);
    var moderatorProfile = ctx.getMateProfile(mateCtx, msg.moderatorId);

    // --- Phase 1: Preparing (clay-debate-setup skill) ---
    var debate = {
      phase: "preparing",
      topic: msg.topic,
      format: "free_discussion",
      context: "",
      specialRequests: null,
      moderatorId: msg.moderatorId,
      panelists: msg.panelists,
      mateCtx: mateCtx,
      moderatorSession: null,
      panelistSessions: {},
      nameMap: buildDebateNameMap(msg.panelists, mateCtx),
      turnInProgress: false,
      pendingComment: null,
      round: 1,
      history: [],
      setupSessionId: null,
      ownerId: userId,
    };
    session._debate = debate;

    var debateId = "debate_" + Date.now();
    var debateDir = path.join(ctx.cwd, ".clay", "debates", debateId);
    try { fs.mkdirSync(debateDir, { recursive: true }); } catch (e) {}
    var briefPath = path.join(debateDir, "brief.json");
    console.log("[debate] cwd=" + ctx.cwd + " debateDir=" + debateDir + " briefPath=" + briefPath);

    debate.debateId = debateId;
    debate.briefPath = briefPath;

    if (msg.quickStart) {
      // --- Quick Start: moderator mate generates brief from DM context ---
      handleDebateQuickStart(ws, session, debate, msg, mateCtx, moderatorProfile, briefPath);
    } else {
      // --- Standard: clay-debate-setup skill ---
      handleDebateSkillSetup(ws, session, debate, msg, mateCtx, moderatorProfile, briefPath);
    }
  }

  // Quick start: moderator mate uses DM conversation context to generate the debate brief directly
  function handleDebateQuickStart(ws, session, debate, msg, mateCtx, moderatorProfile, briefPath) {
    debate.quickStart = true;
    var debateId = debate.debateId;

    // Create setup session (still needed for session grouping)
    var setupOpts = debate.ownerId ? { ownerId: debate.ownerId } : null;
    var setupSession = ctx.sm.createSession(setupOpts);
    setupSession.title = "Debate Setup: " + (msg.topic || "Quick").slice(0, 40);
    setupSession.debateSetupMode = true;
    setupSession.loop = { active: true, iteration: 0, role: "crafting", loopId: debateId, name: (msg.topic || "Quick").slice(0, 40), source: "debate", startedAt: Date.now() };
    ctx.sm.saveSessionFile(setupSession);
    ctx.sm.switchSession(setupSession.localId, null, ctx.hydrateImageRefs);
    debate.setupSessionId = setupSession.localId;
    debate.setupStartedAt = setupSession.loop.startedAt;
    // Share debate state with setup session so confirm_brief works from either
    setupSession._debate = debate;

    // Build DM conversation context for the moderator
    var dmContext = msg.dmContext || "";

    // Build panelist info
    var panelistInfo = msg.panelists.map(function (p) {
      var prof = ctx.getMateProfile(mateCtx, p.mateId);
      return "- " + (prof.name || p.mateId) + " (ID: " + p.mateId + ", bio: " + (prof.bio || "none") + ")";
    }).join("\n");

    var quickBriefPrompt = [
      "You are " + (moderatorProfile.name || "the moderator") + ". You were just having a DM conversation with the user, and they want to turn this into a structured debate.",
      "",
      "## Recent DM Conversation",
      dmContext,
      "",
      "## Topic Suggestion",
      msg.topic || "(Derive from conversation above)",
      "",
      "## Available Panelists",
      panelistInfo,
      "",
      "## Your Task",
      "Based on the conversation context, create a debate brief. You know the topic well because you were just discussing it.",
      msg.delegatePanelists
        ? "IMPORTANT: Select only 2-4 panelists who are most relevant to this specific topic. Do NOT include all of them. Be selective. Only pick mates whose expertise or personality directly contributes to this debate."
        : "The user already selected these panelists. Assign each one a role and perspective that will create the most productive debate.",
      "",
      "Output ONLY a valid JSON object (no markdown fences, no extra text):",
      "{",
      '  "topic": "refined debate topic",',
      '  "format": "free_discussion",',
      '  "context": "key context from DM conversation that panelists should know",',
      '  "specialRequests": "any special instructions (null if none)",',
      '  "panelists": [',
      '    { "mateId": "...", "role": "perspective/stance", "brief": "what this panelist should argue for" }',
      "  ]",
      "}",
    ].join("\n");

    // Persist and start watcher
    persistDebateState(session);
    startDebateBriefWatcher(session, debate, briefPath);

    // Notify clients
    var preparingMsg = {
      type: "debate_preparing",
      topic: debate.topic || "(Setting up...)",
      moderatorId: debate.moderatorId,
      moderatorName: moderatorProfile.name,
      setupSessionId: setupSession.localId,
      panelists: debate.panelists.map(function (p) {
        var prof = ctx.getMateProfile(mateCtx, p.mateId);
        return { mateId: p.mateId, name: prof.name };
      }),
    };
    ctx.sendTo(ws, preparingMsg);
    ctx.sendToSession(session.localId, preparingMsg);
    ctx.sendToSession(setupSession.localId, preparingMsg);

    // Use moderator's own Claude identity to generate the brief via mention session
    var claudeMd = ctx.loadMateClaudeMd(mateCtx, debate.moderatorId);
    var digests = ctx.loadMateDigests(mateCtx, debate.moderatorId, debate.topic);

    var briefText = "";
    var _modMate = matesModule.getMate(mateCtx, debate.moderatorId);
    ctx.sdk.createMentionSession({
      vendor: _modMate ? _modMate.vendor : null,
      linuxUser: mateCtx.linuxUser || undefined,
      claudeMd: claudeMd,
      initialContext: digests,
      initialMessage: quickBriefPrompt,
      onActivity: function () {},
      onDelta: function (delta) { briefText += delta; },
      onDone: function () {
        try {
          var cleaned = briefText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          // Validate it is parseable JSON
          JSON.parse(cleaned);
          // Write brief.json for the watcher to pick up
          fs.writeFileSync(briefPath, cleaned, "utf8");
          console.log("[debate-quick] Moderator generated brief, wrote to " + briefPath);
        } catch (e) {
          console.error("[debate-quick] Failed to generate brief:", e.message);
          console.error("[debate-quick] Raw output:", briefText.substring(0, 500));
          // Fall back: write a minimal brief
          var fallbackBrief = {
            topic: debate.topic || "Discussion",
            format: "free_discussion",
            context: "",
            specialRequests: null,
            panelists: debate.panelists.map(function (p) {
              var prof = ctx.getMateProfile(mateCtx, p.mateId);
              return { mateId: p.mateId, role: "participant", brief: "Share your perspective on the topic." };
            }),
          };
          try {
            fs.writeFileSync(briefPath, JSON.stringify(fallbackBrief), "utf8");
            console.log("[debate-quick] Wrote fallback brief");
          } catch (fe) {
            console.error("[debate-quick] Failed to write fallback brief:", fe.message);
            endDebate(session, "error");
          }
        }
      },
      onError: function (err) {
        console.error("[debate-quick] Moderator brief generation failed:", err);
        endDebate(session, "error");
      },
    });
  }

  // Standard debate setup via clay-debate-setup skill
  function handleDebateSkillSetup(ws, session, debate, msg, mateCtx, moderatorProfile, briefPath) {
    var debateId = debate.debateId;

    // Create a new session for the setup skill (like Ralph crafting)
    var skillSetupOpts = debate.ownerId ? { ownerId: debate.ownerId } : null;
    var setupSession = ctx.sm.createSession(skillSetupOpts);
    setupSession.title = "Debate Setup: " + msg.topic.slice(0, 40);
    setupSession.debateSetupMode = true;
    setupSession.loop = { active: true, iteration: 0, role: "crafting", loopId: debateId, name: msg.topic.slice(0, 40), source: "debate", startedAt: Date.now() };
    ctx.sm.saveSessionFile(setupSession);
    ctx.sm.switchSession(setupSession.localId, null, ctx.hydrateImageRefs);
    debate.setupSessionId = setupSession.localId;
    debate.setupStartedAt = setupSession.loop.startedAt;

    // Build panelist info for the skill prompt
    var panelistNames = msg.panelists.map(function (p) {
      var prof = ctx.getMateProfile(mateCtx, p.mateId);
      return prof.name || p.mateId;
    }).join(", ");

    var craftingPrompt = "Use the /clay-debate-setup skill to prepare a structured debate. " +
      "You MUST invoke the clay-debate-setup skill. Do NOT start the debate yourself.\n\n" +
      "## Initial Topic\n" + msg.topic + "\n\n" +
      "## Moderator\n" + (moderatorProfile.name || msg.moderatorId) + "\n\n" +
      "## Selected Panelists\n" + msg.panelists.map(function (p) {
        var prof = ctx.getMateProfile(mateCtx, p.mateId);
        return "- " + (prof.name || p.mateId) + " (ID: " + p.mateId + ")";
      }).join("\n") + "\n\n" +
      "## Debate Brief Output Path\n" +
      "When the setup is complete, write the debate brief JSON to this EXACT absolute path:\n" +
      "`" + briefPath + "`\n" +
      "This is where the debate engine watches for the file. Do NOT write it anywhere else.\n\n" +
      "## Spoken Language\nKorean (unless user switches)";

    // Persist debate state before starting watcher
    persistDebateState(session);

    // Watch for brief.json in the debate-specific directory
    startDebateBriefWatcher(session, debate, briefPath);

    // Notify clients that setup is in progress
    var preparingMsg = {
      type: "debate_preparing",
      topic: debate.topic || "(Setting up...)",
      moderatorId: debate.moderatorId,
      moderatorName: moderatorProfile.name,
      setupSessionId: setupSession.localId,
      panelists: debate.panelists.map(function (p) {
        var prof = ctx.getMateProfile(mateCtx, p.mateId);
        return { mateId: p.mateId, name: prof.name };
      }),
    };
    ctx.sendTo(ws, preparingMsg);
    ctx.sendToSession(session.localId, preparingMsg);

    // Start the setup skill session (don't send user_message to client — it's an internal prompt)
    setupSession.history.push({ type: "user_message", text: craftingPrompt, _internal: true });
    ctx.sm.appendToSessionFile(setupSession, { type: "user_message", text: craftingPrompt, _internal: true });
    setupSession.isProcessing = true;
    ctx.onProcessingChanged();
    setupSession.sentToolResults = {};
    ctx.sendToSession(setupSession.localId, { type: "status", status: "processing" });
    ctx.sdk.startQuery(setupSession, craftingPrompt, undefined, ctx.getLinuxUserForSession(setupSession));
  }

  // --- Mate strip processing indicator ---
  // Broadcast mention_processing so the correct mate's active dot lights up
  // on the mate strip during debate turns (instead of always the moderator's).
  function debateMateProcessing(mateId, active) {
    ctx.send({ type: "mention_processing", mateId: mateId, active: active });
  }

  // Persist a debate message to session history and send to clients
  function debateSendAndRecord(session, msg) {
    var debate = session._debate;
    if (debate && msg.mateId && (msg.type === "debate_turn" || msg.type === "debate_turn_done")) {
      var identity = ctx.getMateProfile(debate.mateCtx, msg.mateId);
      var identityMate = matesModule.getMate(debate.mateCtx, msg.mateId);
      var identityProfile = identityMate && identityMate.profile ? identityMate.profile : (identityMate || {});
      if (!msg.mateName) msg.mateName = identity.name;
      if (!msg.avatarStyle) msg.avatarStyle = identity.avatarStyle;
      if (!msg.avatarSeed) msg.avatarSeed = identity.avatarSeed;
      if (!msg.avatarColor) msg.avatarColor = identity.avatarColor;
      if (!msg.avatarCustom && identityProfile.avatarCustom) msg.avatarCustom = identityProfile.avatarCustom;
    }
    if (debate && msg.type === "debate_turn") {
      debate.turnSequence = (debate.turnSequence || 0) + 1;
      debate.activeTurnId = (debate.debateId || "debate") + ":" + debate.turnSequence;
      msg.turnId = debate.activeTurnId;
    } else if (debate && !msg.turnId && (msg.type === "debate_activity" || msg.type === "debate_stream" || msg.type === "debate_turn_done")) {
      msg.turnId = debate.activeTurnId || null;
    }
    ctx.sm.sendAndRecord(session, msg);
    if (debate && msg.type === "debate_turn_done") debate.activeTurnId = null;
  }

  // --- Live debate ---

  function startDebateLive(session, targetWs) {
    var debate = session._debate;
    if (!debate || debate.phase === "live") return;

    debate.phase = "live";
    debate.turnInProgress = true;
    debate.round = 1;

    var mateCtx = debate.mateCtx;
    var moderatorProfile = ctx.getMateProfile(mateCtx, debate.moderatorId);

    var reuseHomeSession = session.homeDebatePlanning === true;
    var debateSession = session;
    if (reuseHomeSession) {
      session.homeDebatePhase = "live";
      session.title = "Debate: " + debate.topic.slice(0, 42);
      session.titleManuallySet = true;
      session.isProcessing = false;
      ctx.onProcessingChanged();
      if (session.abortController) { try { session.abortController.abort(); } catch (e) {} }
      if (session.queryInstance && typeof session.queryInstance.close === "function") { try { session.queryInstance.close(); } catch (e) {} }
      session.abortController = null;
      session.queryInstance = null;
      if (session.messageQueue && typeof session.messageQueue.end === "function") { try { session.messageQueue.end(); } catch (e) {} }
      session.messageQueue = null;
      if (targetWs) targetWs._clayActiveSession = session.localId;
    } else {
      // Legacy project debates retain their dedicated live session.
      var liveOpts = debate.ownerId ? { ownerId: debate.ownerId } : null;
      debateSession = ctx.sm.createSession(liveOpts, targetWs || null);
      debateSession.title = debate.topic.slice(0, 50);
      debateSession.loop = { active: true, iteration: 1, role: "debate", loopId: debate.debateId, name: debate.topic.slice(0, 40), source: "debate", startedAt: debate.setupStartedAt || Date.now() };
      ctx.sm.saveSessionFile(debateSession);
      ctx.sm.switchSession(debateSession.localId, null, ctx.hydrateImageRefs);
      debate.liveSessionId = debateSession.localId;
      debateSession._debate = debate;
      delete session._debate;
      session.debateState = null;
      ctx.sm.saveSessionFile(session);
    }
    persistDebateState(debateSession);

    // Save to session history
    var debateStartEntry = {
      type: "debate_started",
      topic: debate.topic,
      format: debate.format,
      moderatorId: debate.moderatorId,
      moderatorName: moderatorProfile.name,
      participantModels: Array.isArray(debate.participantModels) ? debate.participantModels.map(function (item) {
        return { mateId: item.mateId, vendor: item.vendor, model: item.model };
      }) : [],
      panelists: debate.panelists.map(function (p) {
        var prof = ctx.getMateProfile(mateCtx, p.mateId);
        return { mateId: p.mateId, name: prof.name, role: p.role, avatarColor: prof.avatarColor, avatarStyle: prof.avatarStyle, avatarSeed: prof.avatarSeed };
      }),
    };
    debateSendAndRecord(debateSession, debateStartEntry);

    // Signal moderator's first turn
    debateMateProcessing(debate.moderatorId, true);
    debateSendAndRecord(debateSession, {
      type: "debate_turn",
      mateId: debate.moderatorId,
      mateName: moderatorProfile.name,
      role: "moderator",
      round: debate.round,
      avatarColor: moderatorProfile.avatarColor,
      avatarStyle: moderatorProfile.avatarStyle,
      avatarSeed: moderatorProfile.avatarSeed,
    });

    // Create moderator mention session
    var claudeMd = ctx.loadMateClaudeMd(mateCtx, debate.moderatorId);
    var digests = ctx.loadMateDigests(mateCtx, debate.moderatorId, debate.topic);
    var moderatorContext = buildModeratorContext(debate) + digests;

    var _modMate2 = matesModule.getMate(mateCtx, debate.moderatorId);
    var moderatorModel = participantModel(debate, debate.moderatorId);
    ctx.sdk.createMentionSession({
      vendor: moderatorModel ? moderatorModel.vendor : (_modMate2 ? _modMate2.vendor : null),
      model: moderatorModel ? moderatorModel.model : undefined,
      linuxUser: mateCtx.linuxUser || undefined,
      claudeMd: claudeMd,
      initialContext: moderatorContext,
      initialMessage: "Begin the debate on: " + debate.topic,
      onActivity: function (activity) {
        if (debateSession._debate && debateSession._debate.phase !== "ended") {
          debateSendAndRecord(debateSession, { type: "debate_activity", mateId: debate.moderatorId, activity: activity });
        }
      },
      onDelta: function (delta) {
        if (debateSession._debate && debateSession._debate.phase !== "ended") {
          debateSendAndRecord(debateSession, { type: "debate_stream", mateId: debate.moderatorId, mateName: moderatorProfile.name, delta: delta });
        }
      },
      onDone: function (fullText) {
        handleModeratorTurnDone(debateSession, fullText);
      },
      onError: function (errMsg) {
        console.error("[debate] Moderator error:", errMsg);
        endDebate(debateSession, "error");
      },
      canUseTool: buildDebateToolHandler(debateSession, debate.moderatorId),
    }).then(function (mentionSession) {
      if (mentionSession) {
        debate.moderatorSession = mentionSession;
      }
    }).catch(function (err) {
      console.error("[debate] Failed to create moderator session:", err.message || err);
      endDebate(debateSession, "error");
    });
  }

  // --- Turn management ---

  function handleModeratorTurnDone(session, fullText) {
    var debate = session._debate;
    if (!debate || debate.phase === "ended") return;

    debateMateProcessing(debate.moderatorId, false);
    debate.turnInProgress = false;

    // Record in debate history
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);
    debate.history.push({ speaker: "moderator", mateId: debate.moderatorId, mateName: moderatorProfile.name, text: fullText });

    // Save to session history
    var turnEntry = { type: "debate_turn_done", mateId: debate.moderatorId, mateName: moderatorProfile.name, role: "moderator", round: debate.round, text: fullText, avatarStyle: moderatorProfile.avatarStyle, avatarSeed: moderatorProfile.avatarSeed, avatarColor: moderatorProfile.avatarColor };
    debateSendAndRecord(session, turnEntry);

    // Check if user stopped the debate during this turn
    if (debate.phase === "ending") {
      endDebate(session, "user_stopped");
      return;
    }

    // Detect @mentions
    console.log("[debate] nameMap keys:", JSON.stringify(Object.keys(debate.nameMap)));
    console.log("[debate] moderator text (last 200):", fullText.slice(-200));
    var mentionedIds = detectMentions(fullText, debate.nameMap);
    console.log("[debate] detected mentions:", JSON.stringify(mentionedIds));

    if (mentionedIds.length === 0) {
      // No mentions = moderator wants to conclude. Ask user to confirm.
      console.log("[debate] No mentions detected, requesting user confirmation to end.");
      debate.turnInProgress = false;
      debate.awaitingConcludeConfirm = true;
      persistDebateState(session);
      var concludeEntry = { type: "debate_conclude_confirm", topic: debate.topic, round: debate.round };
      debateSendAndRecord(session, concludeEntry);
      return;
    }

    // Check for pending user comment before triggering panelist
    if (debate.pendingComment) {
      injectUserComment(session);
      return;
    }

    // Check if user raised hand
    if (debate.handRaised) {
      yieldFloorToUser(session);
      return;
    }

    // Trigger the first mentioned panelist
    triggerPanelist(session, mentionedIds[0], fullText);
  }

  function triggerPanelist(session, mateId, moderatorText) {
    var debate = session._debate;
    if (!debate || debate.phase === "ended") return;

    debate.turnInProgress = true;
    debate._currentTurnMateId = mateId;
    debate._currentTurnText = "";

    var profile = ctx.getMateProfile(debate.mateCtx, mateId);
    var panelistInfo = null;
    for (var i = 0; i < debate.panelists.length; i++) {
      if (debate.panelists[i].mateId === mateId) {
        panelistInfo = debate.panelists[i];
        break;
      }
    }
    if (!panelistInfo) {
      console.error("[debate] Panelist not found:", mateId);
      debateMateProcessing(mateId, false);
      debate._currentTurnMateId = null;
      // Feed error back to moderator
      feedBackToModerator(session, mateId, "[This panelist is not part of the debate panel.]");
      return;
    }

    // Notify clients of new turn
    debateMateProcessing(mateId, true);
    debateSendAndRecord(session, {
      type: "debate_turn",
      mateId: mateId,
      mateName: profile.name,
      role: panelistInfo.role,
      round: debate.round,
      avatarColor: profile.avatarColor,
      avatarStyle: profile.avatarStyle,
      avatarSeed: profile.avatarSeed,
    });

    var panelistCallbacks = {
      onActivity: function (activity) {
        if (session._debate && session._debate.phase !== "ended") {
          debateSendAndRecord(session, { type: "debate_activity", mateId: mateId, activity: activity });
        }
      },
      onDelta: function (delta) {
        if (session._debate && session._debate.phase !== "ended") {
          debate._currentTurnText += delta;
          debateSendAndRecord(session, { type: "debate_stream", mateId: mateId, mateName: profile.name, delta: delta });
        }
      },
      onDone: function (fullText) {
        handlePanelistTurnDone(session, mateId, fullText);
      },
      onError: function (errMsg) {
        console.error("[debate] Panelist error for " + mateId + ":", errMsg);
        debateMateProcessing(mateId, false);
        debate.turnInProgress = false;
        // Feed error back to moderator so the debate can continue
        feedBackToModerator(session, mateId, "[" + profile.name + " encountered an error and could not respond. Please continue with other panelists or wrap up.]");
      },
    };

    // Check for existing session
    var existing = debate.panelistSessions[mateId];
    if (existing && existing.isAlive()) {
      // Build recent debate context for continuation
      var recentHistory = "";
      var lastPanelistIdx = -1;
      for (var hi = debate.history.length - 1; hi >= 0; hi--) {
        if (debate.history[hi].mateId === mateId) {
          lastPanelistIdx = hi;
          break;
        }
      }
      if (lastPanelistIdx >= 0 && lastPanelistIdx < debate.history.length - 1) {
        recentHistory = "\n\n[Debate turns since your last response:]\n---\n";
        for (var hj = lastPanelistIdx + 1; hj < debate.history.length; hj++) {
          var h = debate.history[hj];
          recentHistory += h.mateName + " (" + (h.speaker === "moderator" ? "moderator" : h.role || h.speaker) + "): " + h.text.substring(0, 500) + "\n\n";
        }
        recentHistory += "---";
      }
      var continuationMsg = recentHistory + "\n\n[The moderator is now addressing you. Please respond.]\n\nModerator said:\n" + moderatorText;
      existing.pushMessage(continuationMsg, panelistCallbacks);
    } else {
      // Create new panelist session
      var claudeMd = ctx.loadMateClaudeMd(debate.mateCtx, mateId);
      var digests = ctx.loadMateDigests(debate.mateCtx, mateId, debate.topic);
      var panelistContext = buildPanelistContext(debate, panelistInfo) + digests;

      // Include debate history so far for context
      var historyContext = "";
      if (debate.history.length > 0) {
        historyContext = "\n\n[Debate so far:]\n---\n";
        for (var hk = 0; hk < debate.history.length; hk++) {
          var he = debate.history[hk];
          historyContext += he.mateName + " (" + (he.speaker === "moderator" ? "moderator" : he.role || he.speaker) + "): " + he.text.substring(0, 500) + "\n\n";
        }
        historyContext += "---";
      }

      var _panMate = matesModule.getMate(debate.mateCtx, mateId);
      var panelistModel = participantModel(debate, mateId);
      ctx.sdk.createMentionSession({
        vendor: panelistModel ? panelistModel.vendor : (_panMate ? _panMate.vendor : null),
        model: panelistModel ? panelistModel.model : undefined,
        linuxUser: debate.mateCtx && debate.mateCtx.linuxUser ? debate.mateCtx.linuxUser : undefined,
        claudeMd: claudeMd,
        initialContext: panelistContext + historyContext,
        initialMessage: "The moderator addresses you:\n\n" + moderatorText,
        onActivity: panelistCallbacks.onActivity,
        onDelta: panelistCallbacks.onDelta,
        onDone: panelistCallbacks.onDone,
        onError: panelistCallbacks.onError,
        canUseTool: buildDebateToolHandler(session, mateId),
      }).then(function (mentionSession) {
        if (mentionSession) {
          debate.panelistSessions[mateId] = mentionSession;
        }
      }).catch(function (err) {
        console.error("[debate] Failed to create panelist session for " + mateId + ":", err.message || err);
        debateMateProcessing(mateId, false);
        debate.turnInProgress = false;
        feedBackToModerator(session, mateId, "[" + profile.name + " is unavailable. Please continue with other panelists or wrap up.]");
      });
    }
  }

  function handlePanelistTurnDone(session, mateId, fullText) {
    var debate = session._debate;
    if (!debate || debate.phase === "ended") return;

    debateMateProcessing(mateId, false);
    debate.turnInProgress = false;
    debate._currentTurnMateId = null;
    debate._currentTurnText = "";

    var profile = ctx.getMateProfile(debate.mateCtx, mateId);
    var panelistInfo = null;
    for (var i = 0; i < debate.panelists.length; i++) {
      if (debate.panelists[i].mateId === mateId) {
        panelistInfo = debate.panelists[i];
        break;
      }
    }

    // Record in debate history
    debate.history.push({ speaker: "panelist", mateId: mateId, mateName: profile.name, role: panelistInfo ? panelistInfo.role : "", text: fullText });

    // Save to session history
    var turnEntry = { type: "debate_turn_done", mateId: mateId, mateName: profile.name, role: panelistInfo ? panelistInfo.role : "", round: debate.round, text: fullText, avatarStyle: profile.avatarStyle, avatarSeed: profile.avatarSeed, avatarColor: profile.avatarColor };
    debateSendAndRecord(session, turnEntry);

    // Check if user stopped the debate
    if (debate.phase === "ending") {
      endDebate(session, "user_stopped");
      return;
    }

    // Check for pending user comment (legacy)
    if (debate.pendingComment) {
      injectUserComment(session);
      return;
    }

    // Check if user raised hand (no comment, just wants the floor)
    if (debate.handRaised) {
      yieldFloorToUser(session);
      return;
    }

    // Feed panelist response back to moderator
    feedBackToModerator(session, mateId, fullText);
  }

  function feedBackToModerator(session, panelistMateId, panelistText) {
    var debate = session._debate;
    if (!debate || !debate.moderatorSession || debate.phase === "ended") return;

    debate.round++;
    debate.turnInProgress = true;

    var panelistProfile = ctx.getMateProfile(debate.mateCtx, panelistMateId);
    var panelistInfo = null;
    for (var i = 0; i < debate.panelists.length; i++) {
      if (debate.panelists[i].mateId === panelistMateId) {
        panelistInfo = debate.panelists[i];
        break;
      }
    }

    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);

    // Notify clients of moderator turn
    debateMateProcessing(debate.moderatorId, true);
    debateSendAndRecord(session, {
      type: "debate_turn",
      mateId: debate.moderatorId,
      mateName: moderatorProfile.name,
      role: "moderator",
      round: debate.round,
      avatarColor: moderatorProfile.avatarColor,
      avatarStyle: moderatorProfile.avatarStyle,
      avatarSeed: moderatorProfile.avatarSeed,
    });

    var feedText = "[Panelist Response]\n\n" +
      "@" + panelistProfile.name + " (" + (panelistInfo ? panelistInfo.role : "panelist") + ") responded:\n" +
      panelistText + "\n\n" +
      "Continue the debate. Call on the next panelist with @TheirName, or provide a closing summary (without any @mentions) to end the debate.";

    debate.moderatorSession.pushMessage(feedText, buildModeratorCallbacks(session));
  }

  function buildModeratorCallbacks(session) {
    var debate = session._debate;
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);
    return {
      onActivity: function (activity) {
        if (session._debate && session._debate.phase !== "ended") {
          debateSendAndRecord(session, { type: "debate_activity", mateId: debate.moderatorId, activity: activity });
        }
      },
      onDelta: function (delta) {
        if (session._debate && session._debate.phase !== "ended") {
          debateSendAndRecord(session, { type: "debate_stream", mateId: debate.moderatorId, mateName: moderatorProfile.name, delta: delta });
        }
      },
      onDone: function (fullText) {
        handleModeratorTurnDone(session, fullText);
      },
      onError: function (errMsg) {
        console.error("[debate] Moderator error:", errMsg);
        endDebate(session, "error");
      },
    };
  }

  // --- User interaction during debate ---

  function handleDebateHandRaise(ws, exactSession) {
    var session = exactSession || ctx.getSessionForWs(ws);
    if (!session) return;

    var debate = session._debate;
    if (!debate || debate.phase !== "live") return;
    if (debate.awaitingUserFloor || debate.handRaised) return;
    if (debate.awaitingConcludeConfirm) {
      if (session.homeDebatePlanning === true) debateSendAndRecord(session, { type: "debate_conclude_confirm", topic: debate.topic, round: debate.round });
      else ctx.sendTo(ws, { type: "debate_conclude_confirm", topic: debate.topic, round: debate.round });
      return;
    }

    debate.handRaised = true;
    debateSendAndRecord(session, { type: "debate_hand_raised" });

    // If no one is speaking, yield floor immediately
    if (!debate.turnInProgress) {
      yieldFloorToUser(session);
    }
    // Otherwise: current speaker finishes -> handRaised detected -> yieldFloorToUser
  }

  function handleDebateComment(ws, msg, exactSession) {
    // Legacy: kept for compatibility but now hand raise is separate
    var session = exactSession || ctx.getSessionForWs(ws);
    if (!session) return;

    var debate = session._debate;
    if (!debate || debate.phase !== "live") {
      ctx.sendTo(ws, { type: "debate_error", error: "No active debate." });
      return;
    }
    if (debate.awaitingUserFloor) return;
    if (!msg.text) return;

    debate.pendingComment = { text: msg.text };
    debate.handRaised = true;
    debateSendAndRecord(session, { type: "debate_comment_queued", text: msg.text });

    if (!debate.turnInProgress) {
      injectUserComment(session);
    }
  }

  function yieldFloorToUser(session) {
    var debate = session._debate;
    if (!debate || !debate.moderatorSession || debate.phase === "ended") return;

    debate.handRaised = false;
    debate.turnInProgress = true;
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);

    debateSendAndRecord(session, {
      type: "debate_turn",
      mateId: debate.moderatorId,
      mateName: moderatorProfile.name,
      role: "moderator",
      round: debate.round,
      avatarColor: moderatorProfile.avatarColor,
      avatarStyle: moderatorProfile.avatarStyle,
      avatarSeed: moderatorProfile.avatarSeed,
    });

    var feedText = "[The user raised their hand to speak.]\n" +
      "[Acknowledge this briefly and yield the floor to the user. Say something like " +
      "\"Go ahead\" or \"The floor is yours\". Do NOT call on any panelist (no @mentions). " +
      "The debate will pause for the user to speak.]";

    debate.moderatorSession.pushMessage(feedText, buildModeratorYieldCallbacks(session));
  }

  function injectUserComment(session) {
    var debate = session._debate;
    if (!debate || !debate.pendingComment || !debate.moderatorSession || debate.phase === "ended") return;

    var comment = debate.pendingComment;
    debate.pendingComment = null;
    debate.handRaised = false;

    // Record in debate history
    debate.history.push({ speaker: "user", mateId: null, mateName: "User", text: comment.text });

    var commentEntry = { type: "debate_comment_injected", text: comment.text };
    debateSendAndRecord(session, commentEntry);

    // Feed to moderator: yield the floor to the user
    debate.turnInProgress = true;
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);

    debateSendAndRecord(session, {
      type: "debate_turn",
      mateId: debate.moderatorId,
      mateName: moderatorProfile.name,
      role: "moderator",
      round: debate.round,
      avatarColor: moderatorProfile.avatarColor,
      avatarStyle: moderatorProfile.avatarStyle,
      avatarSeed: moderatorProfile.avatarSeed,
    });

    var feedText = "[The user raised their hand and said:]\n" +
      comment.text + "\n" +
      "[Acknowledge the user's input. Briefly respond, then YIELD THE FLOOR to the user by saying something like " +
      "\"The floor is yours\" or \"Go ahead\". Do NOT call on any panelist (no @mentions). " +
      "The debate will pause for the user to speak.]";

    debate.moderatorSession.pushMessage(feedText, buildModeratorYieldCallbacks(session));
  }

  function buildModeratorYieldCallbacks(session) {
    var debate = session._debate;
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);
    return {
      onActivity: function (activity) {
        if (session._debate && session._debate.phase !== "ended") {
          debateSendAndRecord(session, { type: "debate_activity", mateId: debate.moderatorId, activity: activity });
        }
      },
      onDelta: function (delta) {
        if (session._debate && session._debate.phase !== "ended") {
          debateSendAndRecord(session, { type: "debate_stream", mateId: debate.moderatorId, mateName: moderatorProfile.name, delta: delta });
        }
      },
      onDone: function (fullText) {
        if (!debate || debate.phase === "ended") return;
        debate.turnInProgress = false;

        // Record moderator yield turn
        debate.history.push({ speaker: "moderator", mateId: debate.moderatorId, mateName: moderatorProfile.name, text: fullText });
        var turnEntry = { type: "debate_turn_done", mateId: debate.moderatorId, mateName: moderatorProfile.name, role: "moderator", round: debate.round, text: fullText, avatarStyle: moderatorProfile.avatarStyle, avatarSeed: moderatorProfile.avatarSeed, avatarColor: moderatorProfile.avatarColor };
        debateSendAndRecord(session, turnEntry);

        // Enter user floor mode: pause debate and show input
        debate.awaitingUserFloor = true;
        persistDebateState(session);
        debateSendAndRecord(session, { type: "debate_user_floor", topic: debate.topic, round: debate.round });
      },
      onError: function (errMsg) {
        console.error("[debate] Moderator yield error:", errMsg);
        endDebate(session, "error");
      },
    };
  }

  function handleDebateUserFloorResponse(ws, msg, exactSession) {
    var session = exactSession || ctx.getSessionForWs(ws);
    if (!session) return;

    var debate = session._debate;
    if (!debate || !debate.awaitingUserFloor || debate.phase !== "live") return;

    debate.awaitingUserFloor = false;
    var userText = (msg && msg.text) ? msg.text.trim() : "";
    if (!userText) return;

    // Record user's floor contribution
    debate.history.push({ speaker: "user", mateId: null, mateName: "User", text: userText });
    var floorEntry = { type: "debate_user_floor_done", text: userText };
    debateSendAndRecord(session, floorEntry);

    // Feed to moderator to resume debate
    debate.turnInProgress = true;
    var moderatorProfile = ctx.getMateProfile(debate.mateCtx, debate.moderatorId);

    debateMateProcessing(debate.moderatorId, true);
    debateSendAndRecord(session, {
      type: "debate_turn",
      mateId: debate.moderatorId,
      mateName: moderatorProfile.name,
      role: "moderator",
      round: debate.round,
      avatarColor: moderatorProfile.avatarColor,
      avatarStyle: moderatorProfile.avatarStyle,
      avatarSeed: moderatorProfile.avatarSeed,
    });

    var feedText = "[The user took the floor and said:]\n" +
      userText + "\n" +
      "[Acknowledge the user's contribution and resume the debate. Call on the next panelist with @TheirName.]";

    debate.moderatorSession.pushMessage(feedText, buildModeratorCallbacks(session));
    persistDebateState(session);
  }

  function handleDebateConfirmBrief(ws) {
    var session = ctx.getSessionForWs(ws);
    if (!session) return;

    var debate = session._debate;
    if (!debate || debate.phase !== "reviewing") {
      ctx.sendTo(ws, { type: "debate_error", error: "No debate brief to confirm." });
      return;
    }

    console.log("[debate] User confirmed brief, transitioning to live. Topic:", debate.topic);
    startDebateLive(session);
  }

  function handleDebateStop(ws, exactSession) {
    var session = exactSession || ctx.getSessionForWs(ws);
    if (!session) return false;

    var debate = session._debate;
    if (!debate) return false;

    if (debate.phase === "reviewing") {
      endDebate(session, "user_stopped");
      return true;
    }

    if (debate.phase !== "live") return false;

    if (debate.turnInProgress) {
      // Let current turn finish, then end
      debate.phase = "ending";
      persistDebateState(session);
      debateSendAndRecord(session, { type: "debate_stop_requested", topic: debate.topic, round: debate.round });
    } else {
      endDebate(session, "user_stopped");
    }
    return true;
  }

  function handleDebateCancelStop(ws, exactSession) {
    var session = exactSession || ctx.getSessionForWs(ws);
    var debate = session && session._debate;
    if (!debate || debate.phase !== "ending") return false;
    debate.phase = "live";
    persistDebateState(session);
    debateSendAndRecord(session, { type: "debate_stop_cancelled", topic: debate.topic, round: debate.round });
    return true;
  }

  // Rebuild _debate from session history (for resume after server restart)
  function rebuildDebateState(session, ws) {
    // Find debate_started entry in history
    var startEntry = null;
    var latestPhase = null;
    var concludeEntry = null;
    var lastRound = 1;
    for (var i = 0; i < session.history.length; i++) {
      var h = session.history[i];
      if (h.type === "debate_started") { startEntry = h; latestPhase = "live"; concludeEntry = null; }
      if (h.type === "debate_resumed") { latestPhase = "live"; concludeEntry = null; }
      if (h.type === "debate_ended") { latestPhase = "ended"; concludeEntry = null; }
      if (h.type === "debate_conclude_confirm" && latestPhase === "live") concludeEntry = h;
      if (h.type === "debate_turn_done" && h.round) lastRound = h.round;
    }
    if (!startEntry) return null;

    var userId = ws._clayUser ? ws._clayUser.id : null;
    var mateCtx = matesModule.buildMateCtx(userId);

    var savedState = session.debateState || {};
    var savedPanelists = Array.isArray(savedState.panelists) && savedState.panelists.length ? savedState.panelists : (startEntry.panelists || []);
    var debate = {
      phase: session.homeDebatePhase === "ended" || session.homeDebatePhase === "interrupted" ? "ended" : (latestPhase || "live"),
      topic: savedState.topic || startEntry.topic || "",
      format: savedState.format || startEntry.format || "free_discussion",
      context: savedState.context || "",
      specialRequests: savedState.specialRequests || null,
      moderatorId: savedState.moderatorId || startEntry.moderatorId,
      participantModels: Array.isArray(savedState.participantModels) ? savedState.participantModels : (startEntry.participantModels || []),
      panelists: savedPanelists.map(function (p) {
        return { mateId: p.mateId, role: p.role || "", brief: p.brief || "" };
      }),
      mateCtx: mateCtx,
      moderatorSession: null,
      panelistSessions: {},
      nameMap: buildDebateNameMap(
        savedPanelists.map(function (p) { return { mateId: p.mateId, role: p.role || "" }; }),
        mateCtx
      ),
      turnInProgress: false,
      pendingComment: null,
      round: lastRound,
      history: [],
      awaitingConcludeConfirm: latestPhase === "live" && !!concludeEntry,
      ownerId: savedState.ownerId || userId,
      debateId: savedState.debateId || (session.loop && session.loop.loopId) || "debate_rebuilt",
    };

    // Rebuild debate.history from session history turn entries
    for (var j = 0; j < session.history.length; j++) {
      var entry = session.history[j];
      if (entry.type === "debate_turn_done") {
        debate.history.push({
          speaker: entry.role === "moderator" ? "moderator" : "panelist",
          mateId: entry.mateId,
          mateName: entry.mateName,
          role: entry.role || "",
          text: entry.text || "",
        });
      }
    }

    // If no endEntry and no concludeEntry, check if last moderator turn had no mentions (implicit conclude)
    if (debate.phase === "live" && !concludeEntry && debate.history.length > 0) {
      var lastTurn = debate.history[debate.history.length - 1];
      if (lastTurn.speaker === "moderator" && lastTurn.text) {
        var rebuildMentions = detectMentions(lastTurn.text, debate.nameMap);
        if (rebuildMentions.length === 0) {
          debate.awaitingConcludeConfirm = true;
          console.log("[debate] Last moderator turn had no mentions, setting awaitingConcludeConfirm.");
        }
      }
    }

    session._debate = debate;
    console.log("[debate] Rebuilt debate state from history. Topic:", debate.topic, "Phase:", debate.phase, "Turns:", debate.history.length);
    return debate;
  }

  function handleDebateConcludeResponse(ws, msg, exactSession) {
    var session = exactSession || ctx.getSessionForWs(ws);
    if (!session) return;
    var debate = session._debate;

    // If _debate is gone (server restart), try to rebuild from history
    if (!debate) {
      debate = rebuildDebateState(session, ws);
      if (!debate) {
        console.log("[debate] Cannot rebuild debate state for resume.");
        return;
      }
    }

    // Allow resume from both "live + awaiting confirm" and "ended" states
    var isLiveConfirm = debate.phase === "live" && debate.awaitingConcludeConfirm;
    var isResume = (debate.phase === "ended" || debate.phase === "interrupted") && msg.action === "continue";
    if (!isLiveConfirm && !isResume) return;

    debate.awaitingConcludeConfirm = false;

    if (msg.action === "end") {
      endDebate(session, "natural");
      return;
    }

    if (msg.action === "continue") {
      var wasEnded = debate.phase === "ended";
      debate.phase = "live";
      if (session.homeDebatePlanning === true) session.homeDebatePhase = "live";
      var instruction = (msg.text || "").trim();
      var mateCtx = debate.mateCtx || matesModule.buildMateCtx(ws._clayUser ? ws._clayUser.id : null);
      debate.mateCtx = mateCtx;
      var moderatorProfile = ctx.getMateProfile(mateCtx, debate.moderatorId);

      // Record user's resume message if provided
      if (instruction) {
        var resumeEntry = { type: "debate_user_resume", text: instruction };
        debateSendAndRecord(session, resumeEntry);
      }

      // Notify clients debate is back live and persist to history
      var resumedMsg = {
        type: "debate_resumed",
        topic: debate.topic,
        round: debate.round,
        moderatorId: debate.moderatorId,
        moderatorName: moderatorProfile.name,
        panelists: debate.panelists.map(function (p) {
          var prof = ctx.getMateProfile(mateCtx, p.mateId);
          return { mateId: p.mateId, name: prof.name, role: p.role, avatarColor: prof.avatarColor, avatarStyle: prof.avatarStyle, avatarSeed: prof.avatarSeed };
        }),
      };
      persistDebateState(session);
      debateSendAndRecord(session, resumedMsg);

      debate.turnInProgress = true;
      debateMateProcessing(debate.moderatorId, true);
      debateSendAndRecord(session, {
        type: "debate_turn",
        mateId: debate.moderatorId,
        mateName: moderatorProfile.name,
        role: "moderator",
        round: debate.round,
        avatarColor: moderatorProfile.avatarColor,
        avatarStyle: moderatorProfile.avatarStyle,
        avatarSeed: moderatorProfile.avatarSeed,
      });

      // Build explicit panelist list so the moderator knows who to call on
      var panelistNames = debate.panelists.map(function (p) {
        var prof = ctx.getMateProfile(mateCtx, p.mateId);
        return "@" + prof.name;
      });
      var panelistList = panelistNames.join(", ");
      var resumePrompt = instruction
        ? "[SYSTEM: The audience has requested the debate continue with new direction. You MUST call on a panelist to continue. Available panelists: " + panelistList + "]\n\nUser direction: " + instruction + "\n\n[Acknowledge this input briefly, then call on a panelist by writing their @Name to continue the discussion on this new direction. You must @mention exactly one panelist.]"
        : "[SYSTEM: The audience has requested the debate continue. You MUST call on the next panelist. Available panelists: " + panelistList + "]\n\n[Call on a panelist by writing their @Name to explore additional perspectives. You must @mention exactly one panelist.]";

      // If resuming from ended state, moderator session may be dead. Create a new one.
      if (wasEnded || !debate.moderatorSession || !debate.moderatorSession.isAlive()) {
        console.log("[debate] Creating new moderator session for resume");
        var claudeMd = ctx.loadMateClaudeMd(mateCtx, debate.moderatorId);
        var digests = ctx.loadMateDigests(mateCtx, debate.moderatorId, debate.topic);
        var moderatorContext = buildModeratorContext(debate) + digests;

        // Include debate history so moderator has context
        moderatorContext += "\n\nIMPORTANT: This debate was previously paused and is now being RESUMED. You must continue the debate by calling on a panelist with @TheirName. Do NOT conclude or summarize.\n";
        moderatorContext += "\nDebate history so far:\n---\n";
        for (var hi = 0; hi < debate.history.length; hi++) {
          var h = debate.history[hi];
          moderatorContext += (h.mateName || h.speaker || "Unknown") + " (" + (h.role || "") + "): " + (h.text || "").slice(0, 500) + "\n\n";
        }
        moderatorContext += "---\n";

        var _modMate3 = matesModule.getMate(mateCtx, debate.moderatorId);
        var resumedModeratorModel = participantModel(debate, debate.moderatorId);
        ctx.sdk.createMentionSession({
          vendor: resumedModeratorModel ? resumedModeratorModel.vendor : (_modMate3 ? _modMate3.vendor : null),
          model: resumedModeratorModel ? resumedModeratorModel.model : undefined,
          linuxUser: mateCtx.linuxUser || undefined,
          claudeMd: claudeMd,
          initialContext: moderatorContext,
          initialMessage: resumePrompt,
          onActivity: function (activity) {
            if (session._debate && session._debate.phase !== "ended") {
              debateSendAndRecord(session, { type: "debate_activity", mateId: debate.moderatorId, activity: activity });
            }
          },
          onDelta: function (delta) {
            if (session._debate && session._debate.phase !== "ended") {
              debateSendAndRecord(session, { type: "debate_stream", mateId: debate.moderatorId, mateName: moderatorProfile.name, delta: delta });
            }
          },
          onDone: function (fullText) {
            handleModeratorTurnDone(session, fullText);
          },
          onError: function (errMsg) {
            console.error("[debate] Moderator resume error:", errMsg);
            endDebate(session, "error");
          },
          canUseTool: buildDebateToolHandler(session, debate.moderatorId),
        }).then(function (mentionSession) {
          if (mentionSession) {
            debate.moderatorSession = mentionSession;
          }
        }).catch(function (err) {
          console.error("[debate] Failed to create resume moderator session:", err.message || err);
          endDebate(session, "error");
        });
      } else {
        debate.moderatorSession.pushMessage(resumePrompt, buildModeratorCallbacks(session));
      }
      return;
    }
  }

  // --- End debate ---

  function endDebate(session, reason) {
    var debate = session._debate;
    if (!debate || debate.phase === "ended") return;

    // Clear all mate strip processing dots
    debateMateProcessing(debate.moderatorId, false);
    for (var ei = 0; ei < debate.panelists.length; ei++) {
      debateMateProcessing(debate.panelists[ei].mateId, false);
    }

    debate.phase = "ended";
    debate.turnInProgress = false;
    if (session.homeDebatePlanning === true) session.homeDebatePhase = reason === "interrupted" ? "interrupted" : "ended";
    persistDebateState(session);

    // Clean up brief watcher if still active
    if (debate._briefWatcher) {
      try { debate._briefWatcher.close(); } catch (e) {}
      debate._briefWatcher = null;
    }

    // Notify clients
    debateSendAndRecord(session, {
      type: "debate_ended",
      reason: reason,
      rounds: debate.round,
      topic: debate.topic,
    });

    if (debate.homeClient && session.homeDebatePlanning !== true) {
      if (typeof ctx.unregisterHomeDebateClient === "function") ctx.unregisterHomeDebateClient(debate.homeClient);
      debate.homeClient._clayActiveSession = debate.homeClient._clayHomePreviousSessionId || null;
      debate.homeClient._clayHomePreviousSessionId = null;
      debate.homeClient._clayHomeDebateSlug = null;
      debate.homeClient = null;
    }

    // Generate digests for all participants
    digestDebateParticipant(session, debate.moderatorId, debate, "moderator");
    for (var i = 0; i < debate.panelists.length; i++) {
      digestDebateParticipant(session, debate.panelists[i].mateId, debate, debate.panelists[i].role);
    }
  }

  function digestDebateParticipant(session, mateId, debate, role) {
    var mentionSession = null;
    if (mateId === debate.moderatorId) {
      mentionSession = debate.moderatorSession;
    } else {
      mentionSession = debate.panelistSessions[mateId];
    }
    if (!mentionSession || !mentionSession.isAlive()) return;

    var mateDir = matesModule.getMateDir(debate.mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Migration: generate initial summary if missing
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFileCheck = path.join(knowledgeDir, "session-digests.jsonl");
    if (!fs.existsSync(summaryFile) && fs.existsSync(digestFileCheck)) {
      ctx.initMemorySummary(debate.mateCtx, mateId, function () {});
    }

    // Debates are user-initiated structured events. The moderator already
    // synthesizes a summary, so skip the memory gate and always create a digest.
    (function () {
      var digestPrompt = [
        "[SYSTEM: Session Digest]",
        "Summarize this conversation from YOUR perspective for your long-term memory.",
        "Output ONLY a single valid JSON object (no markdown, no code fences, no extra text).",
        "",
        "Schema:",
        "{",
        '  "date": "YYYY-MM-DD",',
        '  "type": "debate",',
        '  "topic": "short topic description",',
        '  "my_position": "what I said/recommended",',
        '  "decisions": "what was decided, or null if pending",',
        '  "open_items": "what remains unresolved",',
        '  "user_sentiment": "how the user seemed to feel",',
        '  "my_role": "' + role + '",',
        '  "other_perspectives": "key points from others",',
        '  "outcome": "how the debate concluded",',
        '  "confidence": "high | medium | low",',
        '  "revisit_later": true/false,',
        '  "tags": ["relevant", "topic", "tags"]',
        "}",
        "",
        "IMPORTANT: Output ONLY the JSON object. Nothing else.",
      ].join("\n");

      var digestText = "";
      mentionSession.pushMessage(digestPrompt, {
        onActivity: function () {},
        onDelta: function (delta) {
          digestText += delta;
        },
        onDone: function () {
          var digestObj = null;
          try {
            var cleaned = digestText.trim();
            if (cleaned.indexOf("```") === 0) {
              cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
            }
            digestObj = JSON.parse(cleaned);
          } catch (e) {
            console.error("[debate-digest] Failed to parse digest JSON for mate " + mateId + ":", e.message);
            digestObj = {
              date: new Date().toISOString().slice(0, 10),
              type: "debate",
              topic: debate.topic,
              my_role: role,
              raw: digestText.substring(0, 500),
            };
          }

          try {
            fs.mkdirSync(knowledgeDir, { recursive: true });
            var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
            fs.appendFileSync(digestFile, JSON.stringify(digestObj) + "\n");
          } catch (e) {
            console.error("[debate-digest] Failed to write digest for mate " + mateId + ":", e.message);
          }

          // Update memory summary
          ctx.updateMemorySummary(debate.mateCtx, mateId, digestObj);

          // Close the session after digest
          mentionSession.close();
        },
        onError: function (err) {
          console.error("[debate-digest] Digest generation failed for mate " + mateId + ":", err);
          mentionSession.close();
        },
      });
    })();
  }

  // --- MCP-based debate proposal approval ---

  function handleMcpDebateApproval(session, briefData, mateId, ws) {
    if (session._debate && (session._debate.phase === "preparing" || session._debate.phase === "reviewing" || session._debate.phase === "live")) {
      console.warn("[debate] Cannot start MCP debate: another debate is active on this session");
      return;
    }

    var userId = ws && ws._clayUser ? ws._clayUser.id : (session.ownerId || ctx.projectOwnerId || null);
    var mateCtx = matesModule.buildMateCtx(userId);
    var debateId = "debate_" + Date.now();

    var debate = {
      phase: "reviewing",
      topic: briefData.topic || "Untitled debate",
      format: briefData.format || "free_discussion",
      context: briefData.context || "",
      specialRequests: briefData.specialRequests || null,
      moderatorId: mateId,
      participantModels: Array.isArray(briefData.participantModels) ? briefData.participantModels : [],
      panelists: (briefData.panelists || []).map(function (p) {
        return { mateId: p.mateId, role: p.role || "", brief: p.brief || "" };
      }),
      mateCtx: mateCtx,
      moderatorSession: null,
      panelistSessions: {},
      nameMap: null,
      turnInProgress: false,
      pendingComment: null,
      round: 1,
      history: [],
      setupSessionId: null,
      debateId: debateId,
      briefPath: null,
      ownerId: userId,
    };
    debate.nameMap = buildDebateNameMap(debate.panelists, mateCtx);
    session._debate = debate;

    console.log("[debate] MCP debate approved. Topic:", debate.topic, "debateId:", debateId);
    var homeWs = ws && ws._homeChatTap && ws._homeChatTap.mateSlug === ctx.slug && ws._homeChatTap.sessionId === session.localId ? ws : null;
    startDebateLive(session, homeWs);
    return { ok: true };
  }

  function handleHomeControl(ws, msg, session) {
    if (!session || session.homeDebatePlanning !== true) return false;
    if (!session._debate && (msg.action === "conclude" || msg.action === "resume")) rebuildDebateState(session, ws);
    if (!session._debate) return false;
    if (msg.action === "hand_raise") handleDebateHandRaise(ws, session);
    else if (msg.action === "comment") handleDebateComment(ws, msg, session);
    else if (msg.action === "stop") return handleDebateStop(ws, session);
    else if (msg.action === "cancel_stop") return handleDebateCancelStop(ws, session);
    else if (msg.action === "conclude") handleDebateConcludeResponse(ws, { action: msg.response, text: msg.text || "" }, session);
    else if (msg.action === "resume") handleDebateConcludeResponse(ws, { action: "continue", text: msg.text || "" }, session);
    else if (msg.action === "user_floor") handleDebateUserFloorResponse(ws, msg, session);
    else return false;
    return true;
  }

  // --- Public API ---

  return {
    handleDebateStart: handleDebateStart,
    handleDebateHandRaise: handleDebateHandRaise,
    handleDebateComment: handleDebateComment,
    handleDebateStop: handleDebateStop,
    handleDebateCancelStop: handleDebateCancelStop,
    handleDebateConcludeResponse: handleDebateConcludeResponse,
    handleDebateConfirmBrief: handleDebateConfirmBrief,
    handleDebateUserFloorResponse: handleDebateUserFloorResponse,
    restoreDebateState: restoreDebateState,
    checkForDmDebateBrief: checkForDmDebateBrief,
    handleMcpDebateApproval: handleMcpDebateApproval,
    handleHomeControl: handleHomeControl,
  };
}

module.exports = { attachDebate: attachDebate };
