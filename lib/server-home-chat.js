// Embedded mate chat server handler.
// Routes home_mate_* messages through whichever project socket is open and
// mirrors conversational session events into the home work hub.

var fs = require("fs");
var attachHomeModels = require("./server-home-models").attachHomeModels;
var attachHomeDebatePlanning = require("./server-home-debate-planning").attachHomeDebatePlanning;
var attachHomeMateCreation = require("./server-home-mate-creation").attachHomeMateCreation, attachHomeClaySessionLinks = require("./server-home-clay-session-links").attachHomeClaySessionLinks;
var attachHomeDebates = require("./server-home-debates").attachHomeDebates, attachHomeClayEntry = require("./server-home-clay-entry").attachHomeClayEntry;
var homeChatEvents = require("./server-home-chat-events");
var homeCapsuleCreation = require("./server-home-capsule-creation");
var sessionTitlePolicy = require("./session-title-policy");
var sessionProvenance = require("./session-provenance");
var historyToHomeChat = homeChatEvents.historyToHomeChat;
var transformEvent = homeChatEvents.transformEvent;
function attachHomeChat(deps) {
  var users = deps.users;
  var mates = deps.mates;
  var projects = deps.projects;
  var addProject = deps.addProject;
  function findMateProject(userId, mateId, ensureRegistered) {
    var mateCtx = mates.buildMateCtx(userId);
    var allMates = mates.getAllMates(mateCtx);
    var mate = null;
    for (var i = 0; i < allMates.length; i++) {
      if (!allMates[i]) continue;
      if (mateId && allMates[i].id === mateId) {
        mate = allMates[i];
        break;
      }
      if (!mateId && allMates[i].builtinKey === "clay") mate = allMates[i];
    }
    if (!mate) return null;
    var slug = "mate-" + mate.id;
    if (!projects.has(slug)) {
      if (!ensureRegistered) return null;
      var dir = mates.getMateDir(mateCtx, mate.id);
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}
      var name = (mate.profile && mate.profile.displayName) || mate.name || "Mate";
      addProject(dir, slug, name, null, mate.createdBy || userId, null, {
        isMate: true,
        mateDisplayName: name,
        isHostAgent: mate.builtinKey === "clay",
      });
    }
    var ctx = projects.get(slug);
    return ctx ? { ctx: ctx, slug: slug, mate: mate } : null;
  }
  function ownsSession(session, userId) {
    if (!session || session.hidden) return false;
    if (users.isMultiUser()) return !!userId && session.ownerId === userId;
    return !session.ownerId;
  }

  function sessionString(value, maxLength) {
    if (typeof value !== "string") return null;
    var clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return clean ? clean.slice(0, maxLength) : null;
  }

  function sessionTimestamp(value) {
    return typeof value === "number" && isFinite(value) && value >= 0 ? value : 0;
  }

  function sessionReference(session) {
    return sessionString(session.cliSessionId, 512) || "local:" + session.localId;
  }

  function resolveHomeSession(found, userId, reference) {
    if (!reference || typeof reference !== "string") return null;
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return null;
    var localMatch = reference.match(/^local:(\d+)$/);
    var candidate = localMatch ? sessionManager.sessions.get(parseInt(localMatch[1], 10)) : null;
    if (!candidate) {
      sessionManager.sessions.forEach(function (session) {
        if (!candidate && session.cliSessionId === reference) candidate = session;
      });
    }
    return ownsSession(candidate, userId) ? candidate : null;
  }

  function listHomeSessions(found, userId) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return [];
    var result = [];
    var visibleSessions = [];
    sessionManager.sessions.forEach(function (session) {
      if (!ownsSession(session, userId)) return;
      visibleSessions.push(session);
    });
    var hierarchy = sessionProvenance.hierarchyFor(visibleSessions);
    for (var vi = 0; vi < visibleSessions.length; vi++) {
      var session = visibleSessions[vi];
      if (sessionTitlePolicy.repairLegacySearchTitle(session)
          && typeof sessionManager.saveSessionFile === "function") {
        sessionManager.saveSessionFile(session);
      }
      var cliSessionId = sessionString(session.cliSessionId, 512);
      var createdAt = sessionTimestamp(session.createdAt);
      var lastActivity = sessionTimestamp(session.lastActivity) || createdAt;
      result.push({
        id: cliSessionId || "local:" + session.localId,
        cliSessionId: cliSessionId,
        localId: typeof session.localId === "number" && isFinite(session.localId) ? session.localId : null,
        title: sessionString(session.title, 240) || "New conversation",
        vendor: sessionString(session.vendor, 80),
        model: sessionString(session.model, 240),
        createdAt: createdAt,
        lastActivity: lastActivity,
        isProcessing: !!session.isProcessing,
        sessionRole: hierarchy[session.localId].role,
        parentSessionId: hierarchy[session.localId].parentSessionId == null ? null : sessionReference(sessionManager.sessions.get(hierarchy[session.localId].parentSessionId)),
        parentAvailable: hierarchy[session.localId].parentAvailable,
        workerGeneration: hierarchy[session.localId].generation,
      });
      if (session.debateSetupMode === true) result[result.length - 1].debatePlanning = true;
      if (session.homeDebatePhase) result[result.length - 1].debatePhase = session.homeDebatePhase;
      if (session.mateCreationMode === true) result[result.length - 1].mateCreation = true;
      if (session.homeMateCreationPhase) result[result.length - 1].mateCreationPhase = session.homeMateCreationPhase;
    }
    result.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
    return result;
  }
  function getLatestHomeSession(found, userId) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) return null;
    var best = null;
    sessionManager.sessions.forEach(function (session) {
      if (!ownsSession(session, userId)) return;
      if (!best || (session.lastActivity || 0) > (best.lastActivity || 0)) best = session;
    });
    return best;
  }
  function teardownTap(ws, tapKey) {
    tapKey = tapKey || "_homeChatTap";
    if (ws && ws[tapKey] && typeof ws[tapKey].unsubscribe === "function") {
      try { ws[tapKey].unsubscribe(); } catch (e) {}
    }
    if (ws) ws[tapKey] = null;
  }
  function setupTap(ws, found, sessionId, requestId, tapKey) {
    tapKey = tapKey || "_homeChatTap";
    teardownTap(ws, tapKey);
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager || typeof sessionManager.subscribeSession !== "function") return;
    var mateId = found.mate.id;
    var openedSession = sessionManager.sessions.get(sessionId);
    if (openedSession) openedSession._homeRequestId = requestId || null;
    var stableSessionId = openedSession ? sessionReference(openedSession) : null;
    var unsubscribe = sessionManager.subscribeSession(sessionId, function (event) {
      if (ws.readyState !== 1) return;
      var activeSession = sessionManager.sessions.get(sessionId);
      if (event && event.type === "session_id" && event.cliSessionId) {
        var previousSessionId = stableSessionId;
        stableSessionId = event.cliSessionId;
        sendMessage(ws, { type: "home_mate_session_identity", mateId: mateId, previousSessionId: previousSessionId, sessionId: stableSessionId, requestId: requestId || null });
        if (ws[tapKey] && ws[tapKey].sessionId === sessionId) ws[tapKey].sessionReference = stableSessionId;
        var identityUserId = ws._clayUser ? ws._clayUser.id : null;
        sendMessage(ws, { type: "home_mate_sessions_state", mateId: mateId, sessions: listHomeSessions(found, identityUserId) });
        return;
      }
      var transformed = transformEvent(event, mateId, activeSession, requestId, stableSessionId);
      if (!transformed) return;
      try { ws.send(JSON.stringify(transformed)); } catch (e) {}
      if (event.type === "result" || event.type === "done") {
        var userId = ws._clayUser ? ws._clayUser.id : null;
        sendMessage(ws, { type: "home_mate_sessions_state", mateId: mateId, sessions: listHomeSessions(found, userId) });
      }
    });
    if (!unsubscribe) return;
    ws[tapKey] = {
      unsubscribe: unsubscribe,
      sessionId: sessionId,
      sessionReference: stableSessionId,
      mateId: mateId,
      mateSlug: found.slug,
      requestId: requestId || null,
      openedAt: Date.now(),
    };
  }
  function setupSearchTap(ws, found, sessionId, requestId) { setupTap(ws, found, sessionId, requestId, "_searchClayTap"); }
  function messageTap(ws, msg) { return ws._searchClayTap && msg.requestId === ws._searchClayTap.requestId ? ws._searchClayTap : ws._homeChatTap; }
  function sendError(ws, mateId, text, requestId, sessionId, code, details) {
    if (ws.readyState !== 1) return;
    try {
      var payload = {
        type: "home_mate_error",
        mateId: mateId,
        sessionId: sessionId || null,
        requestId: requestId || null,
        code: code || null,
        text: text,
      };
      if (details && typeof details.toolId === "string") payload.toolId = details.toolId;
      ws.send(JSON.stringify(payload));
    } catch (e) {}
  }

  function sendMessage(ws, payload) {
    if (ws.readyState !== 1) return;
    try { ws.send(JSON.stringify(payload)); } catch (e) {}
  }

  var homeModels = attachHomeModels({ users: users, mates: mates, projects: projects, sendMessage: sendMessage });
  var homeDebates = attachHomeDebates({ mates: mates, findMateProject: findMateProject, ownsSession: ownsSession, sessionReference: sessionReference, sendMessage: sendMessage });
  var homeClaySessionLinks = attachHomeClaySessionLinks({
    projects: projects,
    workspaceQueryService: deps.workspaceQueryService,
    projectLogsService: deps.projectLogsService,
    sendMessage: sendMessage,
  });

  function sendHistory(ws, found, session, requestId) {
    if (ws.readyState !== 1) return;
    try {
      var payload = {
        type: "home_mate_history",
        mateId: found.mate.id,
        sessionId: sessionReference(session),
        requestId: requestId || null,
        model: session.model || null,
        vendor: session.vendor || null,
        messages: historyToHomeChat(session.history || [], session.debateSetupMode === true, session.mateCreationMode === true),
        isProcessing: session.isProcessing === true,
      };
      if (session.homeClayEntryMode === "search") {
        payload.pendingPermissions = Object.keys(session.pendingPermissions || {}).map(function (permissionRequestId) {
          var pending = session.pendingPermissions[permissionRequestId];
          return { permissionRequestId: permissionRequestId, toolName: pending.toolName, toolInput: pending.toolInput, decisionReason: pending.decisionReason || "" };
        });
      }
      if (session.debateSetupMode === true) payload.debatePlanning = true;
      if (session.homeDebatePhase) payload.debatePhase = session.homeDebatePhase;
      if (session.mateCreationMode === true) payload.mateCreation = true;
      if (session.homeMateCreationPhase) payload.mateCreationPhase = session.homeMateCreationPhase;
      ws.send(JSON.stringify(payload));
    } catch (e) {}
  }

  async function ensureSessionModel(ws, found, userId, session, resolvedMateModel) {
    if (session && typeof session.model === "string" && session.model.trim()) return session.model;
    if (!session) throw new Error("Conversation not available.");
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager || typeof sessionManager.saveSessionFile !== "function") {
      var persistError = new Error("Could not persist the conversation model. Reconnect and try again.");
      persistError.code = "model_unavailable";
      throw persistError;
    }
    var resolved = resolvedMateModel || await homeModels.resolveMateModel(ws, found, userId);
    session.vendor = resolved.vendor;
    session.model = resolved.model;
    sessionManager.saveSessionFile(session);
    return session.model;
  }

  function sendModelError(ws, found, msg, error, sessionId) {
    var text = error && error.message ? error.message : String(error || "Model unavailable.");
    sendError(ws, found.mate.id, text, msg.requestId || null, sessionId || msg.sessionId || null, error && error.code ? error.code : null);
  }

  function sendSessionList(ws, found, userId) {
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  var homeDebate = attachHomeDebatePlanning({
    findMateProject: findMateProject, resolveHomeSession: resolveHomeSession,
    sessionReference: sessionReference, setupTap: setupTap, sendHistory: sendHistory,
    sendSessionList: sendSessionList, sendError: sendError, sendModelError: sendModelError,
    homeModels: homeModels,
  });
  var homeMateCreation = attachHomeMateCreation({ findMateProject: findMateProject, resolveHomeSession: resolveHomeSession, sessionReference: sessionReference, setupTap: setupTap, sendHistory: sendHistory, sendSessionList: sendSessionList, sendError: sendError, sendModelError: sendModelError, homeModels: homeModels });
  var homeClayEntry = attachHomeClayEntry({ findMateProject: findMateProject, ownsSession: ownsSession, sessionReference: sessionReference, setupSearchTap: setupSearchTap, sendHistory: sendHistory, sendSessionList: sendSessionList, sendError: sendError, sendModelError: sendModelError, homeModels: homeModels });

  async function openExactSession(ws, found, userId, selected, msg) {
    await ensureSessionModel(ws, found, userId, selected, null);
    if (selected.debateSetupMode === true) {
      homeDebate.resume(ws, found, userId, selected, msg);
      return;
    }
    if (selected.mateCreationMode === true) { homeMateCreation.resume(ws, found, userId, selected, msg); return; }
    setupTap(ws, found, selected.localId, msg.requestId || null);
    sendHistory(ws, found, selected, msg.requestId || null);
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  async function openDefaultSession(ws, found, userId, msg) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) throw new Error("Session manager unavailable.");
    var session = getLatestHomeSession(found, userId);
    if (!session) {
      var resolved = await homeModels.resolveMateModel(ws, found, userId);
      session = sessionManager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model }, null);
    } else {
      await ensureSessionModel(ws, found, userId, session, null);
    }
    setupTap(ws, found, session.localId, msg.requestId || null);
    sendHistory(ws, found, session, msg.requestId || null);
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  async function openNewSession(ws, found, userId, msg) {
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) throw new Error("Session manager unavailable.");
    var capsuleIntent = homeCapsuleCreation.readCapsuleCreationIntent(msg.intent);
    var resolved = await homeModels.resolveMateModel(ws, found, userId);
    var fresh = sessionManager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model }, null);
    setupTap(ws, found, fresh.localId, msg.requestId || null);
    if (capsuleIntent) {
      await sendHomeMessage(ws, found, userId, {
        mateId: found.mate.id,
        sessionId: sessionReference(fresh),
        requestId: msg.requestId || null,
        text: capsuleIntent.description,
      }, {
        queryText: homeCapsuleCreation.buildCapsuleCreationPrompt(capsuleIntent.description),
        onRecorded: function (session) {
          sendHistory(ws, found, session, msg.requestId || null);
          sendSessionList(ws, found, userId);
        },
      });
      return;
    }
    sendHistory(ws, found, fresh, msg.requestId || null);
    sendMessage(ws, { type: "home_mate_sessions_state", mateId: found.mate.id, sessions: listHomeSessions(found, userId) });
  }

  async function sendHomeMessage(ws, found, userId, msg, options) {
    options = options || {};
    var text = (msg.text || "").trim();
    if (!text) return;
    var tap = messageTap(ws, msg);
    var requestId = msg.requestId || (tap && tap.requestId) || null;
    var sessionReferenceValue = msg.sessionId || (tap && tap.sessionReference) || null;
    var sessionManager = found.ctx.getSessionManager();
    if (!sessionManager) throw new Error("Session manager unavailable.");
    var sessionId = tap && tap.mateId === found.mate.id ? tap.sessionId : null;
    var activeSession = sessionId ? sessionManager.sessions.get(sessionId) : null;
    if (!activeSession) {
      var resolved = await homeModels.resolveMateModel(ws, found, userId);
      activeSession = getLatestHomeSession(found, userId);
      if (!activeSession) {
        activeSession = sessionManager.createSession({ ownerId: userId, vendor: resolved.vendor, model: resolved.model }, null);
      } else {
        await ensureSessionModel(ws, found, userId, activeSession, resolved);
      }
      setupTap(ws, found, activeSession.localId, requestId);
      sessionReferenceValue = sessionReference(activeSession);
    } else {
      await ensureSessionModel(ws, found, userId, activeSession, null);
    }
    if (activeSession.mateCreationMode === true) {
      var interviewError = new Error("Answer the current interview question to continue.");
      interviewError.code = "question_required";
      interviewError.sessionId = sessionReference(activeSession);
      throw interviewError;
    }
    if (!activeSession.model) {
      var missingModelError = new Error("Choose a model before sending a message.");
      missingModelError.code = "model_unavailable";
      throw missingModelError;
    }
    var sdk = found.ctx.sdk;
    if (!sdk) {
      var sdkError = new Error("Mate SDK bridge unavailable.");
      sdkError.sessionId = sessionReference(activeSession);
      throw sdkError;
    }
    if (typeof sessionManager.sendAndRecord !== "function") {
      var historyError = new Error("Conversation history is unavailable.");
      historyError.sessionId = sessionReference(activeSession);
      throw historyError;
    }
    sessionManager.sendAndRecord(activeSession, { type: "user_message", text: text });
    try {
      if (!activeSession.isProcessing) {
        activeSession.isProcessing = true;
        activeSession.sentToolResults = {};
        if (typeof options.onRecorded === "function") options.onRecorded(activeSession);
        if (!activeSession.queryInstance && (!activeSession.worker || activeSession.messageQueue !== "worker")) {
          sdk.startQuery(activeSession, options.queryText || text, null, null);
        } else {
          sdk.pushMessage(activeSession, options.queryText || text, null);
        }
      } else {
        sdk.pushMessage(activeSession, options.queryText || text, null);
      }
    } catch (error) {
      error.sessionId = sessionReference(activeSession);
      throw error;
    }
    return sessionReferenceValue;
  }

  function handleMessage(ws, msg) {
    if (!msg || typeof msg.type !== "string") return false;
    if (msg.type === "home_mate_stop" || msg.type === "home_mate_permission_response") {
      var controlUserId = ws._clayUser ? ws._clayUser.id : null;
      if (users.isMultiUser() && !controlUserId) {
        sendError(ws, msg.mateId || null, "Not authenticated.", msg.requestId || null, msg.sessionId || null);
        return true;
      }
      var controlFound = findMateProject(controlUserId, msg.mateId, true);
      var controlTap = messageTap(ws, msg);
      var controlManager = controlFound ? controlFound.ctx.getSessionManager() : null;
      var controlSession = controlManager && controlTap && controlTap.mateId === controlFound.mate.id && controlTap.requestId === msg.requestId
        ? controlManager.sessions.get(controlTap.sessionId) : null;
      var controlReference = controlSession ? sessionReference(controlSession) : null;
      if (!controlFound || !controlSession || controlReference !== msg.sessionId || !ownsSession(controlSession, controlUserId) || controlSession.homeClayEntryMode !== "search") {
        sendError(ws, msg.mateId || null, "Conversation control is no longer available.", msg.requestId || null, msg.sessionId || null, "session_not_found");
        return true;
      }
      if (msg.type === "home_mate_permission_response") {
        var controlDecision = msg.decision === "allow" ? "allow" : (msg.decision === "deny" ? "deny" : null);
        if (!controlDecision || typeof msg.permissionRequestId !== "string" || !controlSession.pendingPermissions[msg.permissionRequestId]) {
          sendError(ws, controlFound.mate.id, "This permission request is no longer pending.", msg.requestId || null, msg.sessionId || null, "permission_not_found", { toolId: msg.permissionRequestId });
          return true;
        }
        controlFound.ctx.handleHomePermissionResponse(ws, { requestId: msg.permissionRequestId, decision: controlDecision }, controlSession);
      } else {
        sendMessage(ws, { type: "home_mate_stopping", mateId: controlFound.mate.id, sessionId: controlReference, requestId: msg.requestId || null });
        controlFound.ctx.stopHomeSession(controlSession);
      }
      return true;
    }
    if (msg.type !== "home_debates_list" && msg.type !== "home_clay_ask" && msg.type !== "home_clay_session_resolve" && msg.type !== "home_clay_log_resolve" && msg.type !== "home_mate_present" && msg.type !== "home_mate_open" && msg.type !== "home_mate_sessions_list" && msg.type !== "home_mate_session_open" && msg.type !== "home_mate_send" && msg.type !== "home_mate_new_session" && msg.type !== "home_mate_debate_plan" && msg.type !== "home_debate_proposal_response" && msg.type !== "home_debate_question_response" && msg.type !== "home_debate_control" && msg.type !== "home_mate_creation_plan" && msg.type !== "home_mate_creation_question_response" && msg.type !== "home_mate_creation_proposal_response" && msg.type !== "home_mate_close" && msg.type !== "home_mate_memory_list" && msg.type !== "home_mate_knowledge_list" && msg.type !== "home_mate_models_get" && msg.type !== "home_mate_model_set") {
      return false;
    }

    if (msg.type === "home_mate_present") {
      ws._homeChatPresented = msg.visible === true;
      return true;
    }

    if (msg.type === "home_mate_close") {
      ws._homeChatPresented = false;
      teardownTap(ws);
      return true;
    }

    var userId = ws._clayUser ? ws._clayUser.id : null;
    if (users.isMultiUser() && !userId) {
      if (msg.type === "home_debates_list") sendMessage(ws, { type: "home_debates_state", requestId: msg.requestId || null, status: "error", debates: [], error: "Sign in to load your debates." });
      else if (msg.type === "home_clay_session_resolve") sendMessage(ws, { type: "home_clay_session_target", requestId: msg.requestId || null, sessionRef: msg.sessionRef || null, status: "error", error: "Sign in to open this session." });
      else if (msg.type === "home_clay_log_resolve") sendMessage(ws, { type: "home_clay_log_target", requestId: msg.requestId || null, ref: msg.ref || null, status: "error", error: "Sign in to open this log." });
      else if (msg.type === "home_mate_models_get" || msg.type === "home_mate_model_set") homeModels.sendAccessError(ws, msg, "Not authenticated.");
      else sendError(ws, msg.mateId || null, "Not authenticated.", msg.requestId || null, msg.sessionId || null);
      return true;
    }

    if (homeDebates.handle(ws, userId, msg)) return true;
    if (msg.type === "home_clay_ask") { homeClayEntry.start(ws, userId, msg); return true; }
    if (msg.type === "home_clay_session_resolve") { homeClaySessionLinks.resolve(ws, msg); return true; }
    if (msg.type === "home_clay_log_resolve") { homeClaySessionLinks.resolveLog(ws, msg); return true; }

    if (msg.type === "home_mate_debate_plan") {
      homeDebate.start(ws, userId, msg);
      return true;
    }
    if (msg.type === "home_debate_proposal_response") {
      homeDebate.respond(ws, userId, msg);
      return true;
    }
    if (msg.type === "home_debate_question_response") {
      homeDebate.respondToQuestion(ws, userId, msg);
      return true;
    }
    if (msg.type === "home_debate_control") {
      homeDebate.control(ws, userId, msg);
      return true;
    }
    if (msg.type === "home_mate_creation_plan") { homeMateCreation.start(ws, userId, msg); return true; }
    if (msg.type === "home_mate_creation_question_response") { homeMateCreation.respondToQuestion(ws, userId, msg); return true; }
    if (msg.type === "home_mate_creation_proposal_response") { homeMateCreation.respondToProposal(ws, userId, msg); return true; }

    var found = findMateProject(userId, msg.mateId, true);
    if (!found) {
      if (msg.type === "home_mate_models_get" || msg.type === "home_mate_model_set") homeModels.sendAccessError(ws, msg, "Mate not available.");
      else sendError(ws, msg.mateId || null, "Mate not available.", msg.requestId || null, msg.sessionId || null);
      return true;
    }

    if (msg.type === "home_mate_models_get") {
      homeModels.sendMateModels(ws, found, msg.requestId || null, msg.vendor || null).catch(function (error) {
        sendMessage(ws, { type: "home_mate_models_state", mateId: found.mate.id, requestId: msg.requestId || null, vendor: msg.vendor || found.mate.vendor || "claude", mateVendor: found.mate.vendor || "claude", mateModel: found.mate.model || "", model: "", models: [], vendors: [], status: "error", error: error.message || String(error) });
      });
      return true;
    }

    if (msg.type === "home_mate_model_set") {
      homeModels.setMateModel(ws, found, userId, msg).then(function (result) {
        var draft = result && result.sessionApplied ? resolveHomeSession(found, userId, result.sessionId) : null;
        if (draft && draft.debateSetupMode === true) homeDebate.resume(ws, found, userId, draft, { requestId: ws._homeChatTap ? ws._homeChatTap.requestId : null });
        if (draft && draft.mateCreationMode === true) homeMateCreation.resume(ws, found, userId, draft, { requestId: ws._homeChatTap ? ws._homeChatTap.requestId : null });
      }).catch(function (error) {
        sendMessage(ws, { type: "home_mate_model_result", mateId: found.mate.id, requestId: msg.requestId || null, ok: false, error: error.message || String(error) });
      });
      return true;
    }

    if (msg.type === "home_mate_memory_list") {
      var memory = found.ctx.getMemoryState();
      sendMessage(ws, {
        type: "home_mate_memory_state",
        mateId: found.mate.id,
        requestId: msg.requestId || null,
        entries: memory.entries,
        summary: memory.summary,
      });
      return true;
    }

    if (msg.type === "home_mate_knowledge_list") {
      sendMessage(ws, {
        type: "home_mate_knowledge_state",
        mateId: found.mate.id,
        requestId: msg.requestId || null,
        files: found.ctx.listKnowledgeFiles(),
      });
      return true;
    }

    if (msg.type === "home_mate_sessions_list") {
      sendMessage(ws, {
        type: "home_mate_sessions_state",
        mateId: found.mate.id,
        sessions: listHomeSessions(found, userId),
      });
      return true;
    }

    if (msg.type === "home_mate_session_open") {
      var selected = resolveHomeSession(found, userId, msg.sessionId);
      if (!selected) {
        sendError(ws, found.mate.id, "Conversation not available.", msg.requestId || null, msg.sessionId || null, "session_not_found");
        return true;
      }
      openExactSession(ws, found, userId, selected, msg).catch(function (error) {
        sendModelError(ws, found, msg, error, sessionReference(selected));
      });
      return true;
    }

    if (msg.type === "home_mate_open") {
      openDefaultSession(ws, found, userId, msg).catch(function (error) {
        sendModelError(ws, found, msg, error, null);
      });
      return true;
    }

    if (msg.type === "home_mate_new_session") {
      openNewSession(ws, found, userId, msg).catch(function (error) {
        sendModelError(ws, found, msg, error, null);
      });
      return true;
    }

    if (msg.type === "home_mate_send") {
      var sendTap = messageTap(ws, msg);
      var sendRequestId = msg.requestId || (sendTap && sendTap.requestId) || null;
      var sendSessionReference = msg.sessionId || (sendTap && sendTap.sessionReference) || null;
      sendHomeMessage(ws, found, userId, msg).catch(function (error) {
        sendError(ws, found.mate.id, error.message || String(error), sendRequestId, error.sessionId || sendSessionReference, error.code || null);
      });
      return true;
    }
    return false;
  }
  function handleDisconnection(ws) {
    ws._homeChatPresented = false;
    teardownTap(ws);
    teardownTap(ws, "_searchClayTap");
  }
  return { handleMessage: handleMessage, handleDisconnection: handleDisconnection, findMateProject: findMateProject };
}
module.exports = { attachHomeChat: attachHomeChat };
