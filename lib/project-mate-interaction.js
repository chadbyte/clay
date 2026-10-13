var resolveMateIdentityFile = require('./mate-identity-file').resolveMateIdentityFile;
var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var mateSync = require("./mate-knowledge-sync");
var dmDigestCursor = require("./dm-digest-cursor");

// Mirror a Mate-owned journal into the Clay-wide Knowledge backend after the
// legacy append has already succeeded. Reconciling the whole journal keeps the
// new scope current whether the write added, rewrote, or removed lines.
function mirrorMateJournal(mateDir, fileName, job) {
  mateSync.syncQuietly({
    mateDir: mateDir,
    fileName: fileName,
    actor: { type: "agent", vendor: (job && job.vendor) || null, sessionKey: (job && job.sessionKey) || null },
  });
}

function attachMateInteraction(ctx) {
  var cwd = ctx.cwd;
  var slug = ctx.slug || "";
  var sm = ctx.sm;
  var sdk = ctx.sdk;
  var send = ctx.send;
  var sendTo = ctx.sendTo;
  var sendToSession = ctx.sendToSession;
  var sendToSessionOthers = ctx.sendToSessionOthers;
  var matesModule = ctx.matesModule;
  var isMate = ctx.isMate;
  var projectOwnerId = ctx.projectOwnerId;
  var getSessionForWs = ctx.getSessionForWs;
  var getLinuxUserForSession = ctx.getLinuxUserForSession;
  var saveImageFile = ctx.saveImageFile;
  var hydrateImageRefs = ctx.hydrateImageRefs;
  var onProcessingChanged = ctx.onProcessingChanged;
  var loadMateDigests = ctx.loadMateDigests;
  var updateMemorySummary = ctx.updateMemorySummary;
  var initMemorySummary = ctx.initMemorySummary;
  var getNotificationsModule = ctx.getNotificationsModule || function () { return null; };
  // checkForDmDebateBrief is accessed via ctx at call time because
  // it comes from the debate module initialized after this one.

  // --- @Mention handler ---
  var MENTION_WINDOW = 20; // turns to check for session continuity (recency check only)
  var MENTION_CONTEXT_BUDGET = 32 * 1024; // 32KB total budget for prior turns fed into mention context
  var MENTION_CONTEXT_MAX_TURNS = 200; // hard safety cap so we never walk the entire session

  // Plain @mention targets: vendor-only mentions with no persona, no memory,
  // no digest write-back. Lets users in a Claude session ask raw Codex (and
  // vice versa) for a second opinion without spinning up a real Mate.
  var PLAIN_MENTIONS = {
    "plain:claude": {
      vendor: "claude",
      name: "Claude Code",
      avatarColor: "#cc785c",
      avatarStyle: "imprint",
      avatarSeed: "plain-claude",
    },
    "plain:codex": {
      vendor: "codex",
      name: "Codex",
      avatarColor: "#10a37f",
      avatarStyle: "imprint",
      avatarSeed: "plain-codex",
    },
  };
  function isPlainMentionId(id) {
    return typeof id === "string" && Object.prototype.hasOwnProperty.call(PLAIN_MENTIONS, id);
  }

  // Walk session history backwards collecting full turns (no per-turn truncation)
  // until either maxTurns is reached or byteBudget is exhausted. Each turn keeps
  // its full text; we drop older turns first when the budget runs out.
  function getRecentTurns(session, maxTurns, byteBudget) {
    var turns = [];
    var totalBytes = 0;
    var history = session.history;
    var assistantBuffer = "";

    function tryPush(turn) {
      var size = (turn.text || "").length + (turn.role || "").length + 4;
      // Always keep at least one turn so a single long message still gets through.
      if (byteBudget && turns.length > 0 && totalBytes + size > byteBudget) return false;
      turns.push(turn);
      totalBytes += size;
      return true;
    }

    for (var i = history.length - 1; i >= 0 && turns.length < maxTurns; i--) {
      var entry = history[i];
      if (entry.type === "user_message") {
        if (assistantBuffer) {
          if (!tryPush({ role: "assistant", text: assistantBuffer.trim() })) { assistantBuffer = ""; break; }
          assistantBuffer = "";
        }
        if (!tryPush({ role: "user", text: entry.text || "" })) break;
      } else if (entry.type === "delta" || entry.type === "text") {
        assistantBuffer = (entry.text || "") + assistantBuffer;
      } else if (entry.type === "mention_response") {
        if (assistantBuffer) {
          if (!tryPush({ role: "assistant", text: assistantBuffer.trim() })) { assistantBuffer = ""; break; }
          assistantBuffer = "";
        }
        if (!tryPush({ role: "@" + (entry.mateName || "Mate"), text: entry.text || "", mateId: entry.mateId })) break;
      } else if (entry.type === "mention_user") {
        if (assistantBuffer) {
          if (!tryPush({ role: "assistant", text: assistantBuffer.trim() })) { assistantBuffer = ""; break; }
          assistantBuffer = "";
        }
        if (!tryPush({ role: "user", text: "@" + (entry.mateName || "Mate") + " " + (entry.text || ""), mateId: entry.mateId })) break;
      }
    }
    if (assistantBuffer && turns.length < maxTurns) {
      tryPush({ role: "assistant", text: assistantBuffer.trim() });
    }
    turns.reverse();
    return turns;
  }

  // Check if the given mate has a mention response within the most recent
  // `windowSize` turns. Continuity is recency-based, even when getRecentTurns
  // returns more turns to satisfy the byte budget.
  function hasMateInWindow(recentTurns, mateId, windowSize) {
    var start = windowSize ? Math.max(0, recentTurns.length - windowSize) : 0;
    for (var i = start; i < recentTurns.length; i++) {
      if (recentTurns[i].mateId === mateId && recentTurns[i].role.charAt(0) === "@") {
        return true;
      }
    }
    return false;
  }

  // Build context for continued (follow-up) mention sessions
  function buildMiddleContext(recentTurns, mateId) {
    var lines = [];
    var found = false;
    for (var i = recentTurns.length - 1; i >= 0; i--) {
      var t = recentTurns[i];
      if (t.mateId === mateId && t.role.charAt(0) === "@") { found = true; break; }
      if (t.role === "user") {
        lines.unshift("[User said after your last reply: " + t.text + "]");
      } else if (t.role === "assistant") {
        lines.unshift("[Session agent replied: " + t.text + "]");
      } else if (t.role.charAt(0) === "@") {
        lines.unshift("[@" + t.role.substring(1) + " replied: " + t.text + "]");
      }
    }
    if (!found || lines.length === 0) return "";
    return "[Conversation since your last reply]\n" + lines.join("\n");
  }

  // Build initial mention context from recent turns
  function buildMentionContext(userName, recentTurns) {
    if (recentTurns.length === 0) return "";
    var lines = ["[Recent conversation context]"];
    for (var i = 0; i < recentTurns.length; i++) {
      var t = recentTurns[i];
      var label = t.role === "user" ? userName : t.role === "assistant" ? "Session Agent" : t.role;
      lines.push(label + ": " + t.text);
    }
    return lines.join("\n") + "\n\n";
  }

  function getHostMateId() {
    if (typeof slug === "string" && slug.indexOf("mate-") === 0) {
      return slug.substring(5) || null;
    }
    return null;
  }

  function notifyMentionResponse(session, mentionMateId, mentionMateName, fullText) {
    var notificationsModule = getNotificationsModule();
    var hostMateId = getHostMateId();
    var preview = (fullText || "").replace(/\s+/g, " ").trim();
    if (preview.length > 140) preview = preview.substring(0, 140) + "...";
    if (!notificationsModule || !hostMateId) return;
    notificationsModule.notify("mention_response", {
      title: (mentionMateName || "Mate") + " responded",
      preview: preview,
      slug: slug,
      sessionId: session.localId,
      mateId: hostMateId,
      avatarMateId: mentionMateId || null,
      ownerId: session.ownerId || null,
    });
  }

  // --- Shared digest worker: one reusable Haiku session for gate+digest ---
  // Combines gate check and digest generation into a single prompt,
  // processes jobs sequentially from a queue, reuses the session across calls.
  // Session is recycled after DIGEST_WORKER_MAX_TURNS to prevent context bloat.
  var _digestWorker = null;
  var _digestQueue = [];
  var _digestBusy = false;
  var _digestWorkerTurns = 0;
  var _digestWorkerLinuxUser = null;
  var DIGEST_WORKER_MAX_TURNS = 20;

  function enqueueDigest(job) {
    _digestQueue.push(job);
    if (!_digestBusy) processDigestQueue();
  }

  function processDigestQueue() {
    if (_digestQueue.length === 0) { _digestBusy = false; return; }
    _digestBusy = true;
    var job = _digestQueue.shift();

    if (_digestWorker && _digestWorkerLinuxUser !== (job.linuxUser || null)) {
      try { _digestWorker.close(); } catch (e) {}
      _digestWorker = null;
      _digestWorkerTurns = 0;
      _digestWorkerLinuxUser = null;
    }

    var mateDir = matesModule.getMateDir(job.mateCtx, job.mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Load mate role for gate context
    var mateRole = "";
    try {
      var yamlRaw = fs.readFileSync(path.join(mateDir, "mate.yaml"), "utf8");
      var roleMatch = yamlRaw.match(/^relationship:\s*(.+)$/m);
      if (roleMatch) mateRole = roleMatch[1].trim();
    } catch (e) {}

    // Combined gate + digest in one prompt (saves a full round-trip vs separate gate)
    var promptParts = [
      "[SYSTEM: Memory Gate + Digest]",
      "You are a memory system for an AI Mate (role: " + (mateRole || "assistant") + ").",
      "",
    ];
    if (job.priorSummary) {
      promptParts.push("Prior conversation context (memory summary so far):");
      promptParts.push(job.priorSummary);
      promptParts.push("");
    }
    promptParts.push("Conversation (" + job.type + "):");
    promptParts.push(job.conversationContent);
    var prompt = promptParts.concat([
      "",
      "STEP 1: Should this be saved to memory?",
      'Answer "no" ONLY if the entire conversation is trivial (e.g. just "hi"/"hello").',
      "When in doubt, save it.",
      "",
      'STEP 2: If yes, output a JSON digest. If no, output exactly: {"skip":true}',
      "",
      "JSON schema (output ONLY the JSON, no markdown, no fences):",
      "{",
      '  "date": "YYYY-MM-DD",',
      '  "type": "' + job.type + '",',
      '  "topic": "short topic description",',
      '  "summary": "2-3 sentence summary",',
      '  "key_quotes": ["user quotes, verbatim, max 5"],',
      '  "user_context": "personal/project context or null",',
      '  "my_position": "what I said/recommended",',
      job.type === "dm" ? '  "user_intent": "what the user wanted",' : '  "other_perspectives": "key points from others",',
      '  "decisions": "what was decided or null",',
      '  "open_items": "what remains unresolved",',
      '  "user_sentiment": "how user felt",',
      '  "confidence": "high|medium|low",',
      '  "revisit_later": true/false,',
      '  "tags": ["topic", "tags"],',
      '  "user_observations": [{"category":"pattern|decision|reaction|preference","observation":"...","evidence":"..."}]',
      "}",
      "",
      "user_observations: OPTIONAL array. Include ONLY if you noticed meaningful patterns about the USER themselves (not the topic).",
      "Categories: pattern (repeated behavior 2+ times), decision (explicit choice with reasoning), reaction (emotional/attitude signal), preference (tool/style/communication preference).",
      "Omit the field entirely if nothing notable about the user.",
    ]).join("\n");

    function handleResult(text) {
      var cleaned = text.trim();
      if (cleaned.indexOf("```") === 0) {
        cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
      }

      var digestObj = null;
      try { digestObj = JSON.parse(cleaned); } catch (e) {
        console.error("[digest-worker] Parse failed for " + job.mateId + ":", e.message);
        digestObj = { date: new Date().toISOString().slice(0, 10), topic: "parse_failed", raw: text.substring(0, 500) };
      }

      if (digestObj && digestObj.skip) {
        console.log("[digest-worker] Gate declined for " + job.mateId);
        if (job.onDone) job.onDone();
        processDigestQueue();
        return;
      }

      try {
        fs.mkdirSync(knowledgeDir, { recursive: true });
        var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
        fs.appendFileSync(digestFile, JSON.stringify(digestObj) + "\n");
        mirrorMateJournal(mateDir, "session-digests.jsonl", job);
      } catch (e) {
        console.error("[digest-worker] Write failed for " + job.mateId + ":", e.message);
        if (job.onError) job.onError(e);
        processDigestQueue();
        return;
      }

      // Write user observations if present
      if (digestObj.user_observations && digestObj.user_observations.length > 0) {
        try {
          var obsFile = path.join(knowledgeDir, "user-observations.jsonl");
          var obsMate = matesModule.getMate(job.mateCtx, job.mateId);
          var obsMateName = (obsMate && obsMate.name) || job.mateId;
          var obsLines = [];
          for (var oi = 0; oi < digestObj.user_observations.length; oi++) {
            var obs = digestObj.user_observations[oi];
            obsLines.push(JSON.stringify({
              date: digestObj.date || new Date().toISOString().slice(0, 10),
              category: obs.category || "pattern",
              observation: obs.observation || "",
              evidence: obs.evidence || "",
              confidence: digestObj.confidence || "medium",
              mateName: obsMateName,
              mateId: job.mateId
            }));
          }
          fs.appendFileSync(obsFile, obsLines.join("\n") + "\n");
          mirrorMateJournal(mateDir, "user-observations.jsonl", job);
        } catch (e) {
          console.error("[digest-worker] Observations write failed for " + job.mateId + ":", e.message);
        }
      }

      // Skip summary update for failed parses -- the fallback digest would degrade quality
      if (digestObj.topic !== "parse_failed") {
        updateMemorySummary(job.mateCtx, job.mateId, digestObj);
        maybeSynthesizeUserProfile(job.mateCtx, job.mateId);
        if (job.onDone) job.onDone();
      } else {
        if (job.onError) job.onError(new Error("parse_failed"));
      }
      processDigestQueue();
    }

    // Recycle worker session if it has exceeded max turns
    if (_digestWorker && _digestWorkerTurns >= DIGEST_WORKER_MAX_TURNS) {
      try { _digestWorker.close(); } catch (e) {}
      _digestWorker = null;
      _digestWorkerTurns = 0;
      _digestWorkerLinuxUser = null;
    }

    var responseText = "";
    if (_digestWorker && _digestWorker.isAlive()) {
      _digestWorkerTurns++;
      _digestWorker.pushMessage(prompt, {
        onActivity: function () {},
        onDelta: function (d) { responseText += d; },
        onDone: function () { handleResult(responseText); },
        onError: function (err) {
          console.error("[digest-worker] Error:", err);
          _digestWorker = null;
          _digestWorkerTurns = 0;
          _digestWorkerLinuxUser = null;
          if (job.onError) job.onError(err);
          processDigestQueue();
        },
      });
    } else {
      sdk.createMentionSession({
        linuxUser: job.linuxUser || undefined,
        claudeMd: "",
        model: "haiku",
        initialContext: "[Digest Worker] You generate memory digests. Respond with ONLY JSON.",
        initialMessage: prompt,
        onActivity: function () {},
        onDelta: function (d) { responseText += d; },
        onDone: function () { handleResult(responseText); },
        onError: function (err) {
          console.error("[digest-worker] Create error:", err);
          _digestWorker = null;
          _digestWorkerLinuxUser = null;
          if (job.onError) job.onError(err);
          processDigestQueue();
        },
      }).then(function (ws) {
        _digestWorker = ws;
        _digestWorkerTurns = 1;
        _digestWorkerLinuxUser = job.linuxUser || null;
      }).catch(function (err) {
        if (job.onError) job.onError(err || new Error("digest worker creation failed"));
        processDigestQueue();
      });
    }
  }

  function digestMentionSession(session, mateId, mateCtx, mateResponse, userQuestion) {
    if (!session._mentionSessions || !session._mentionSessions[mateId]) return;
    var mentionSession = session._mentionSessions[mateId];
    if (!mentionSession.isAlive()) return;

    mentionSession._digesting = true;

    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Migration: generate initial summary if missing
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
    if (!fs.existsSync(summaryFile) && fs.existsSync(digestFile)) {
      initMemorySummary(mateCtx, mateId, function () {});
    }

    var userQ = userQuestion || "(unknown)";
    var mateR = mateResponse || "(unknown)";
    var conversationContent = "User: " + (userQ.length > 2000 ? userQ.substring(0, 2000) + "..." : userQ) +
      "\nMate: " + (mateR.length > 2000 ? mateR.substring(0, 2000) + "..." : mateR);

    enqueueDigest({
      mateCtx: mateCtx,
      linuxUser: mateCtx.linuxUser || undefined,
      mateId: mateId,
      type: "mention",
      conversationContent: conversationContent,
      onDone: function () { mentionSession._digesting = false; },
      onError: function () { mentionSession._digesting = false; },
    });
  }

  // Digest DM turn for mate projects - uses shared digest worker.
  // Delta-based: only collects new turns since the last successful digest.
  // Concurrency debounce: turns that arrive while a digest is in-flight
  // are naturally batched into the next flush.
  var _dmDigestPending = new WeakSet();
  function digestDmTurn(session) {
    if (!isMate || _dmDigestPending.has(session)) return;
    var mateId = path.basename(cwd);
    var mateCtx = matesModule.buildMateCtx(projectOwnerId);
    if (!matesModule.isMate(mateCtx, mateId)) return;

    // Recover the exact next unread position. Legacy index-only checkpoints
    // remain readable and are treated as fully consumed entries.
    var digestState = dmDigestCursor.readState(session.history);
    var startCursor = digestState.cursor;
    var chunk = dmDigestCursor.collectChunk(session.history, startCursor);
    if (!chunk.conversationContent) return;

    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    var knowledgeDir = path.join(mateDir, "knowledge");

    // Migration: if memory-summary.md missing but digests exist, generate initial summary
    var summaryFile = path.join(knowledgeDir, "memory-summary.md");
    var digestFile = path.join(knowledgeDir, "session-digests.jsonl");
    if (!fs.existsSync(summaryFile) && fs.existsSync(digestFile)) {
      initMemorySummary(mateCtx, mateId, function () {
        console.log("[memory-migrate] Initial summary generated for mate " + mateId);
      });
    }

    // Read existing summary to give the digest worker context for delta content
    var priorSummary = "";
    try {
      if (fs.existsSync(summaryFile)) {
        priorSummary = fs.readFileSync(summaryFile, "utf8").trim();
      }
    } catch (e) {}

    _dmDigestPending.add(session);
    var checkpointCursor = chunk.cursor;

    enqueueDigest({
      mateCtx: mateCtx,
      linuxUser: mateCtx.linuxUser || undefined,
      mateId: mateId,
      type: "dm",
      priorSummary: priorSummary || "",
      conversationContent: chunk.conversationContent,
      onDone: function () {
        // Journal and checkpoint are separate appends: if this append fails,
        // retry may duplicate the saved digest, but must never skip its input.
        var checkpoint = { type: "digest_checkpoint", cursor: checkpointCursor };
        var saved = false;
        try { saved = sm.appendToSessionFile(session, checkpoint) !== false; } catch (e) {
          console.error("[dm-digest] Checkpoint append failed:", e.message);
        }
        if (!saved) {
          _dmDigestPending.delete(session);
          return;
        }
        session.history.push(checkpoint);
        _dmDigestPending.delete(session);
        if (dmDigestCursor.hasPending(session.history, checkpointCursor)) {
          setImmediate(function () { digestDmTurn(session, ""); });
        }
      },
      onError: function () {
        _dmDigestPending.delete(session);
      },
    });
  }

  function handleMention(ws, msg) {
    if (!msg.mateId) return;
    if (!msg.text && (!msg.images || msg.images.length === 0) && (!msg.pastes || msg.pastes.length === 0)) return;

    var session = getSessionForWs(ws);
    if (!session) return;

    // Block mentions during an active debate
    if (session._debate && session._debate.phase === "live") {
      sendTo(ws, { type: "mention_error", mateId: msg.mateId, error: "Cannot use @mentions during an active debate." });
      return;
    }

    // Check if a mention is already in progress for this session
    if (session._mentionInProgress) {
      sendTo(ws, { type: "mention_error", mateId: msg.mateId, error: "A mention is already in progress." });
      return;
    }

    var userId = ws._clayUser ? ws._clayUser.id : null;
    var mateCtx = matesModule.buildMateCtx(userId);
    var isPlain = isPlainMentionId(msg.mateId);
    var mate;
    if (isPlain) {
      var pCfg = PLAIN_MENTIONS[msg.mateId];
      mate = {
        id: msg.mateId,
        vendor: pCfg.vendor,
        name: pCfg.name,
        profile: {
          displayName: pCfg.name,
          avatarColor: pCfg.avatarColor,
          avatarStyle: pCfg.avatarStyle,
          avatarSeed: pCfg.avatarSeed,
        },
      };
    } else {
      mate = matesModule.getMate(mateCtx, msg.mateId);
      if (!mate) {
        sendTo(ws, { type: "mention_error", mateId: msg.mateId, error: "Mate not found" });
        return;
      }
    }

    var mateName = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
    var avatarColor = (mate.profile && mate.profile.avatarColor) || "#5857fc";
    var avatarStyle = (mate.profile && mate.profile.avatarStyle) || "imprint";
    var avatarSeed = (mate.profile && mate.profile.avatarSeed) || mate.id;

    // Build full mention text (include pasted content)
    var mentionFullInput = msg.text || "";
    if (msg.pastes && msg.pastes.length > 0) {
      for (var pi = 0; pi < msg.pastes.length; pi++) {
        if (mentionFullInput) mentionFullInput += "\n\n";
        mentionFullInput += msg.pastes[pi];
      }
    }

    // Save images to disk (same pattern as regular messages)
    var imageRefs = [];
    if (msg.images && msg.images.length > 0) {
      for (var imgIdx = 0; imgIdx < msg.images.length; imgIdx++) {
        var img = msg.images[imgIdx];
        var savedName = saveImageFile(img.mediaType, img.data, getLinuxUserForSession(session));
        if (savedName) {
          imageRefs.push({ mediaType: img.mediaType, file: savedName });
        }
      }
    }

    // Save mention user message to session history
    var mentionUserEntry = { type: "mention_user", text: msg.text, mateId: msg.mateId, mateName: mateName };
    if (msg.pastes && msg.pastes.length > 0) mentionUserEntry.pastes = msg.pastes;
    if (imageRefs.length > 0) mentionUserEntry.imageRefs = imageRefs;
    session.history.push(mentionUserEntry);
    sm.appendToSessionFile(session, mentionUserEntry);
    sendToSessionOthers(ws, session.localId, hydrateImageRefs(mentionUserEntry));

    // Extract recent turns for continuity check
    var recentTurns = getRecentTurns(session, MENTION_CONTEXT_MAX_TURNS, MENTION_CONTEXT_BUDGET);

    // Determine user name for context
    var userName = "User";
    if (ws._clayUser) {
      var p = ws._clayUser.profile || {};
      userName = p.name || ws._clayUser.displayName || ws._clayUser.username || "User";
    }

    session._mentionInProgress = true;
    session._mentionActiveMateId = msg.mateId;

    // Send mention start indicator
    sendToSession(session.localId, {
      type: "mention_start",
      mateId: msg.mateId,
      mateName: mateName,
      avatarColor: avatarColor,
      avatarStyle: avatarStyle,
      avatarSeed: avatarSeed,
    });

    // Broadcast to all tabs so mate avatar shows activity indicator
    send({ type: "mention_processing", mateId: msg.mateId, active: true });

    // Shared callbacks for both new and continued sessions
    var mentionCallbacks = {
      onActivity: function (activity) {
        sendToSession(session.localId, {
          type: "mention_activity",
          mateId: msg.mateId,
          activity: activity,
        });
      },
      onDelta: function (delta) {
        sendToSession(session.localId, {
          type: "mention_stream",
          mateId: msg.mateId,
          mateName: mateName,
          delta: delta,
        });
      },
      onDone: function (fullText) {
        session._mentionInProgress = false;
        session._mentionActiveMateId = null;

        // Save mention response to session history
        var mentionResponseEntry = {
          type: "mention_response",
          mateId: msg.mateId,
          mateName: mateName,
          text: fullText,
          avatarColor: avatarColor,
          avatarStyle: avatarStyle,
          avatarSeed: avatarSeed,
        };
        session.history.push(mentionResponseEntry);
        sm.appendToSessionFile(session, mentionResponseEntry);

        // Queue mention context for injection into the current agent's next turn
        if (!session.pendingMentionContexts) session.pendingMentionContexts = [];
        session.pendingMentionContexts.push(
          "[Context: @" + mateName + " was mentioned and responded]\n\n" +
          "User asked @" + mateName + ": " + msg.text + "\n" +
          mateName + " responded: " + fullText + "\n\n" +
          "[End of @mention context. This is for your reference only. Do not re-execute or repeat this response.]"
        );

        sendToSession(session.localId, { type: "mention_done", mateId: msg.mateId });
        send({ type: "mention_processing", mateId: msg.mateId, active: false });

        if (isMate && !isPlain) {
          notifyMentionResponse(session, msg.mateId, mateName, fullText);
        }

        if (!isPlain) {
          // Check if the mate wrote a debate brief during this turn
          ctx.checkForDmDebateBrief(session, msg.mateId, mateCtx);

          // Generate session digest for mate's long-term memory
          digestMentionSession(session, msg.mateId, mateCtx, fullText, msg.text);
        }
      },
      onError: function (errMsg) {
        session._mentionInProgress = false;
        session._mentionActiveMateId = null;
        // Clean up dead session
        if (session._mentionSessions && session._mentionSessions[msg.mateId]) {
          delete session._mentionSessions[msg.mateId];
        }
        console.error("[mention] Error for mate " + msg.mateId + ":", errMsg);
        sendToSession(session.localId, { type: "mention_error", mateId: msg.mateId, error: errMsg });
        send({ type: "mention_processing", mateId: msg.mateId, active: false });
      },
    };

    // Initialize mention sessions map if needed
    if (!session._mentionSessions) session._mentionSessions = {};

    // Session continuity: check if this mate has a response in the recent window
    var existingSession = session._mentionSessions[msg.mateId];
    // Don't reuse a session that's still generating a digest (would mix digest output into mention stream)
    var canContinue = existingSession && existingSession.isAlive() && !existingSession._digesting && hasMateInWindow(recentTurns, msg.mateId, MENTION_WINDOW);

    if (canContinue) {
      // Continue existing mention session with middle context
      var middleContext = buildMiddleContext(recentTurns, msg.mateId);
      var continuationText = middleContext ? middleContext + "\n\n" + mentionFullInput : mentionFullInput;
      existingSession.pushMessage(continuationText, mentionCallbacks, msg.images);
    } else {
      // Clean up old session if it exists
      if (existingSession) {
        existingSession.close();
        delete session._mentionSessions[msg.mateId];
      }

      var claudeMd = "";
      var recentDigests = "";
      if (isPlain) {
        // Plain @mention: route to the vendor with just enough framing so the
        // model understands it is a sidebar response, not the primary agent.
        claudeMd =
          "A user is working with another coding assistant and has @mentioned you for a second opinion on the current exchange.\n" +
          "The recent conversation between the user and that other assistant is included as context below.\n" +
          "Read it, then answer the user's question directly. Be concise and give your honest take.\n" +
          "You are not driving the session, so do not run tools or take actions unless the user explicitly asks; commenting and advising is the default.";
      } else {
        // Load Mate AGENTS.md
        var mateDir = matesModule.getMateDir(mateCtx, msg.mateId);
        try {
          claudeMd = fs.readFileSync(resolveMateIdentityFile(mateDir), "utf8");
        } catch (e) {
          // AGENTS.md may not exist for new mates
        }

        // Load session digests (unified: uses memory-summary.md if available)
        // Pass user's message as query for BM25 search of relevant past sessions
        recentDigests = loadMateDigests(mateCtx, msg.mateId, mentionFullInput);
      }

      // Build initial mention context
      var mentionContext = buildMentionContext(userName, recentTurns) + recentDigests;

      // Create new persistent mention session
      sdk.createMentionSession({
        vendor: mate.vendor || null,
        linuxUser: getLinuxUserForSession(session) || undefined,
        claudeMd: claudeMd,
        initialContext: mentionContext,
        initialMessage: mentionFullInput,
        initialImages: msg.images || null,
        onActivity: mentionCallbacks.onActivity,
        onDelta: mentionCallbacks.onDelta,
        onDone: mentionCallbacks.onDone,
        onError: mentionCallbacks.onError,
        canUseTool: function (toolName, input, toolOpts) {
          // Read the caller's live mode so reused mentions follow session changes.
          if ((session.permissionMode || sm.currentPermissionMode) === "bypassPermissions" && toolName !== "AskUserQuestion") {
            return Promise.resolve({ behavior: "allow", updatedInput: input });
          }
          // Use the shared whitelist from sdk-bridge (read-only tools + safe bash commands)
          var whitelisted = sdk.checkToolWhitelist(toolName, input);
          if (whitelisted) return Promise.resolve(whitelisted);
          // Not whitelisted: route through the project session's permission system
          return new Promise(function (resolve) {
            var requestId = crypto.randomUUID();
            session.pendingPermissions[requestId] = {
              resolve: resolve,
              requestId: requestId,
              toolName: toolName,
              toolInput: input,
              toolUseId: toolOpts ? toolOpts.toolUseID : undefined,
              decisionReason: (toolOpts && toolOpts.decisionReason) || "",
              mateId: msg.mateId,
            };
            sendToSession(session.localId, {
              type: "permission_request",
              requestId: requestId,
              toolName: toolName,
              toolInput: input,
              toolUseId: toolOpts ? toolOpts.toolUseID : undefined,
              decisionReason: (toolOpts && toolOpts.decisionReason) || "",
              mateId: msg.mateId,
            });
            onProcessingChanged();
            if (toolOpts && toolOpts.signal) {
              toolOpts.signal.addEventListener("abort", function () {
                delete session.pendingPermissions[requestId];
                sendToSession(session.localId, { type: "permission_cancel", requestId: requestId });
                onProcessingChanged();
                resolve({ behavior: "deny", message: "Request cancelled" });
              });
            }
          });
        },
      }).then(function (mentionSession) {
        if (mentionSession) {
          session._mentionSessions[msg.mateId] = mentionSession;
        }
      }).catch(function (err) {
        session._mentionInProgress = false;
        session._mentionActiveMateId = null;
        console.error("[mention] Failed to create session for mate " + msg.mateId + ":", err.message || err);
        sendToSession(session.localId, { type: "mention_error", mateId: msg.mateId, error: "Failed to create mention session." });
      });
    }
  }

  // --- Shared mate helpers (used by debate module and other code) ---

  function getMateProfile(mateCtx, mateId) {
    var mate = matesModule.getMate(mateCtx, mateId);
    if (!mate) return { name: "Mate", avatarColor: "#5857fc", avatarStyle: "imprint", avatarSeed: mateId };
    return {
      name: (mate.profile && mate.profile.displayName) || mate.name || "Mate",
      avatarColor: (mate.profile && mate.profile.avatarColor) || "#5857fc",
      avatarStyle: (mate.profile && mate.profile.avatarStyle) || "imprint",
      avatarSeed: (mate.profile && mate.profile.avatarSeed) || mateId,
    };
  }

  function loadMateClaudeMd(mateCtx, mateId) {
    var mateDir = matesModule.getMateDir(mateCtx, mateId);
    try {
      return fs.readFileSync(resolveMateIdentityFile(mateDir), "utf8");
    } catch (e) {
      return "";
    }
  }

  // User profile synthesis: collect observations from all mates, synthesize unified profile
  var USER_PROFILE_SYNTHESIS_THRESHOLD = 8;

  function maybeSynthesizeUserProfile(mateCtx, mateId) {
    var mate = matesModule.getMate(mateCtx, mateId);
    if (!mate || !mate.globalSearch) return; // Only primary/globalSearch mates synthesize

    var matesRoot = matesModule.resolveMatesRoot(mateCtx);
    var profilePath = path.join(matesRoot, "user-profile.md");
    var obsCountPath = path.join(matesRoot, ".user-profile-obs-count");

    // Check if enough new observations have accumulated
    var lastObsCount = 0;
    try {
      if (fs.existsSync(obsCountPath)) {
        lastObsCount = parseInt(fs.readFileSync(obsCountPath, "utf8").trim(), 10) || 0;
      }
    } catch (e) {}

    // Collect all observations from all mates
    var allObs = [];
    try {
      var allMates = matesModule.getAllMates(mateCtx);
      for (var mi = 0; mi < allMates.length; mi++) {
        var moDir = matesModule.getMateDir(mateCtx, allMates[mi].id);
        var moFile = path.join(moDir, "knowledge", "user-observations.jsonl");
        try {
          if (fs.existsSync(moFile)) {
            var lines = fs.readFileSync(moFile, "utf8").trim().split("\n").filter(function (l) { return l.trim(); });
            for (var li = 0; li < lines.length; li++) {
              try { allObs.push(JSON.parse(lines[li])); } catch (e) {}
            }
          }
        } catch (e) {}
      }
    } catch (e) {}

    if (allObs.length - lastObsCount < USER_PROFILE_SYNTHESIS_THRESHOLD) return;

    // Sort by date descending, cap at 100
    allObs.sort(function (a, b) { return (b.date || "").localeCompare(a.date || ""); });
    var recentObs = allObs.slice(0, 100);

    var existingProfile = "";
    try {
      if (fs.existsSync(profilePath)) {
        existingProfile = fs.readFileSync(profilePath, "utf8").trim();
      }
    } catch (e) {}

    var synthesisContext = [
      "[SYSTEM: User Profile Synthesis]",
      "You are synthesizing a unified user profile from observations collected by multiple AI Mates.",
      "",
      existingProfile ? "Current profile:\n" + existingProfile : "No existing profile yet.",
      "",
      "Recent observations (" + recentObs.length + "):",
      recentObs.map(function (o) {
        return "- [" + (o.date || "?") + "] [@" + (o.mateName || "?") + "] [" + (o.category || "?") + "] " +
          (o.observation || "") + (o.evidence ? " (evidence: " + o.evidence + ")" : "");
      }).join("\n"),
    ].join("\n");

    var synthesisPrompt = [
      "Create or update the user profile. Structure:",
      "",
      "# User Profile",
      "Last updated: YYYY-MM-DD",
      "",
      "## Who They Are",
      "(role, background, what they work on)",
      "## Communication Style",
      "(how they communicate, language preferences)",
      "## Work Patterns",
      "(when they work, how they approach tasks)",
      "## Preferences",
      "(tools, frameworks, styles they prefer)",
      "## Values & Priorities",
      "(what they care about, what frustrates them)",
      "## Key Relationships",
      "(team members, collaborators mentioned)",
      "",
      "Keep it factual and evidence-based. Max 8 bullet points per section.",
      "Merge new observations with existing profile, removing contradictions.",
      "Output ONLY the markdown. Nothing else.",
    ].join("\n");

    sdk.createMentionSession({
      linuxUser: mateCtx.linuxUser || undefined,
      claudeMd: "",
      model: "haiku",
      initialContext: synthesisContext,
      initialMessage: synthesisPrompt,
      onActivity: function () {},
      onDelta: function () {},
      onDone: function (fullText) {
        try {
          var cleaned = fullText.trim();
          if (cleaned.indexOf("```") === 0) {
            cleaned = cleaned.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "").trim();
          }
          fs.writeFileSync(profilePath, cleaned + "\n", "utf8");
          fs.writeFileSync(obsCountPath, String(allObs.length), "utf8");
          console.log("[user-profile] Synthesized user profile from " + allObs.length + " observations");
        } catch (e) {
          console.error("[user-profile] Failed to write user-profile.md:", e.message);
        }
      },
      onError: function (err) {
        console.error("[user-profile] Synthesis failed:", err);
      },
    }).catch(function (err) {
      console.error("[user-profile] Failed to create synthesis session:", err);
    });
  }

  return {
    handleMention: handleMention,
    getMateProfile: getMateProfile,
    loadMateClaudeMd: loadMateClaudeMd,
    digestDmTurn: digestDmTurn,
    enqueueDigest: enqueueDigest,
  };
}

module.exports = { attachMateInteraction };
