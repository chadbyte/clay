// User-scoped durable index for Home debate planning and live sessions.

function attachHomeDebates(deps) {
  var mates = deps.mates;
  var findMateProject = deps.findMateProject;
  var ownsSession = deps.ownsSession;
  var sessionReference = deps.sessionReference;
  var sendMessage = deps.sendMessage;

  function cleanText(value, fallback, maxLength) {
    if (typeof value !== "string") return fallback;
    var clean = value.replace(/[\u0000-\u001f\u007f]/g, " ").trim();
    return clean ? clean.slice(0, maxLength) : fallback;
  }

  function normalizedPhase(session) {
    var phase = session && session.homeDebatePhase;
    if (phase === "planning" || phase === "live" || phase === "ended" || phase === "interrupted") return phase;
    return session && session.homeDebatePlanning === true ? "planning" : null;
  }

  function isHomeDebate(session) {
    return !!normalizedPhase(session);
  }

  function mateName(mate) {
    var profile = mate && mate.profile ? mate.profile : {};
    return cleanText(profile.displayName || (mate && (mate.displayName || mate.name)), "Mate", 120);
  }

  function mateIndex(allMates) {
    var result = {};
    for (var i = 0; i < allMates.length; i++) {
      if (allMates[i] && allMates[i].id) result[allMates[i].id] = allMates[i];
    }
    return result;
  }

  function addParticipant(result, seen, source, fallbackMates, fallbackRole) {
    if (!source || !source.mateId || seen[source.mateId]) return;
    seen[source.mateId] = true;
    var mate = fallbackMates[source.mateId];
    result.push({
      mateId: source.mateId,
      name: cleanText(source.name || source.mateName, mateName(mate), 120),
      role: cleanText(source.role, fallbackRole || "panelist", 120),
    });
  }

  function debateDetails(session, moderatorMate, matesById) {
    var history = Array.isArray(session.history) ? session.history : [];
    var topic = cleanText(session && session.homeDebateInitialTopic, null, 300);
    var format = null;
    var round = null;
    var moderator = null;
    var panelists = [];
    for (var i = 0; i < history.length; i++) {
      var event = history[i];
      if (!event) continue;
      if (event.type === "debate_proposal" && event.proposal) {
        topic = cleanText(event.proposal.topic, topic, 300);
        format = cleanText(event.proposal.format, format, 80);
        moderator = event.proposal.moderatorId ? { mateId: event.proposal.moderatorId, role: "moderator" } : moderator;
        if (Array.isArray(event.proposal.panelists)) panelists = event.proposal.panelists;
      }
      if (event.type === "debate_started") {
        topic = cleanText(event.topic, topic, 300);
        format = cleanText(event.format, format, 80);
        moderator = event.moderatorId ? { mateId: event.moderatorId, name: event.moderatorName, role: "moderator" } : moderator;
        if (Array.isArray(event.panelists)) panelists = event.panelists;
      }
      if ((event.type === "debate_turn" || event.type === "debate_turn_done") && typeof event.round === "number") round = Math.max(round || 0, event.round);
      if (event.type === "debate_ended") {
        topic = cleanText(event.topic, topic, 300);
        if (typeof event.rounds === "number") round = Math.max(round || 0, event.rounds);
      }
    }
    if (!moderator && moderatorMate) moderator = { mateId: moderatorMate.id, name: mateName(moderatorMate), role: "moderator" };
    var participants = [];
    var seen = {};
    addParticipant(participants, seen, moderator, matesById, "moderator");
    for (var j = 0; j < panelists.length; j++) addParticipant(participants, seen, panelists[j], matesById, "panelist");
    return {
      topic: topic,
      format: format,
      round: round,
      participants: participants,
    };
  }

  function list(userId) {
    var mateCtx = mates.buildMateCtx(userId);
    var allMates = mates.getAllMates(mateCtx).filter(function (mate) { return !!mate && !mate.archived; });
    var matesById = mateIndex(allMates);
    var debates = [];
    for (var i = 0; i < allMates.length; i++) {
      var found = findMateProject(userId, allMates[i].id, true);
      if (!found || !found.ctx || typeof found.ctx.getSessionManager !== "function") continue;
      var manager = found.ctx.getSessionManager();
      if (!manager || !manager.sessions) continue;
      manager.sessions.forEach(function (session) {
        if (!ownsSession(session, userId) || !isHomeDebate(session)) return;
        var details = debateDetails(session, found.mate, matesById);
        var createdAt = typeof session.createdAt === "number" ? session.createdAt : 0;
        var lastActivity = typeof session.lastActivity === "number" ? session.lastActivity : createdAt;
        debates.push({
          mateId: found.mate.id,
          projectSlug: found.slug,
          localId: session.localId,
          sessionId: sessionReference(session),
          title: details.topic || "Debate planning",
          topic: details.topic,
          phase: normalizedPhase(session),
          participants: details.participants,
          format: details.format,
          round: details.round,
          createdAt: createdAt,
          lastActivity: lastActivity,
        });
      });
    }
    debates.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
    return debates;
  }

  function handle(ws, userId, msg) {
    if (!msg || msg.type !== "home_debates_list") return false;
    try {
      sendMessage(ws, { type: "home_debates_state", requestId: msg.requestId || null, status: "ready", debates: list(userId) });
    } catch (error) {
      sendMessage(ws, { type: "home_debates_state", requestId: msg.requestId || null, status: "error", debates: [], error: "Debates could not be loaded. Try again." });
    }
    return true;
  }

  return { handle: handle, list: list };
}

module.exports = { attachHomeDebates: attachHomeDebates };
