var sessionSearch = require("./session-search");
var builtinMates = require("./builtin-mates");
var workspaceQueryAccess = require("./workspace-query-access");
var crypto = require("crypto");

var MAX_PAGE = 50;
var MAX_TURN_CHARS = 12000;
var MAX_SNIPPET_CHARS = 320;
var DECISION_PATTERNS = [
  /\bdecided\s+to\b/i, /\bdecision\b/i, /\bgoing\s+with\b/i,
  /\bsettled\s+on\b/i, /\bchose\s+to\b/i, /\bwill\s+go\s+with\b/i,
  /\blet'?s\s+go\s+with\b/i, /\b결정\b/, /\b정했\b/, /\b이걸로\s+가/,
];

function cleanText(value, max) {
  if (typeof value !== "string") return "";
  var text = value.replace(/\u0000/g, "").trim();
  if (text.length > max) text = text.substring(0, max) + "...";
  return text;
}

function cleanMetadata(value, max) {
  return cleanText(value, max).replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
}

function parseLimit(value, fallback) {
  var limit = Number(value);
  if (!Number.isFinite(limit)) limit = fallback;
  return Math.max(1, Math.min(MAX_PAGE, Math.floor(limit)));
}

function encodeCursor(offset) {
  return offset > 0 ? Buffer.from(String(offset), "utf8").toString("base64url") : null;
}

function decodeCursor(value) {
  if (!value) return 0;
  try {
    var parsed = Number(Buffer.from(String(value), "base64url").toString("utf8"));
    return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
  } catch (e) {
    return 0;
  }
}

function sessionRef(projectSlug, session) {
  var localId = session && session.localId != null ? String(session.localId) : "";
  var identity = session && session.cliSessionId
    ? "cli\u0000" + String(session.vendor || "") + "\u0000" + String(session.cliSessionId)
    : "local\u0000" + localId;
  var digest = crypto.createHash("sha256").update(String(projectSlug || "") + "\u0000" + identity).digest("base64url");
  return "session:" + digest.substring(0, 24);
}

function canonicalTurns(history) {
  var turns = [];
  var assistant = "";

  function flushAssistant() {
    var text = cleanText(assistant, MAX_TURN_CHARS);
    if (text) turns.push({ role: "assistant", text: text });
    assistant = "";
  }

  for (var i = 0; i < (history || []).length; i++) {
    var event = history[i];
    if (!event || event.hidden === true || event._internal === true || event.internal === true) continue;
    if (event.type === "delegated_work" || event.type === "delegated_follow_up") {
      flushAssistant();
    } else if (event.type === "user_message") {
      flushAssistant();
      var userText = cleanText(event.text, MAX_TURN_CHARS);
      if (userText) turns.push({ role: "user", text: userText });
    } else if (event.type === "delta" && typeof event.text === "string") {
      assistant += event.text;
      if (assistant.length > MAX_TURN_CHARS * 2) assistant = assistant.substring(0, MAX_TURN_CHARS * 2);
    } else if (event.type === "result" || event.type === "done" || event.type === "error") {
      flushAssistant();
    }
  }
  flushAssistant();
  return turns;
}

function sanitizedHistory(turns) {
  var history = [];
  for (var i = 0; i < turns.length; i++) {
    history.push({ type: turns[i].role === "user" ? "user_message" : "delta", text: turns[i].text });
    if (turns[i].role === "assistant") history.push({ type: "result" });
  }
  return history;
}

function sessionActivity(session) {
  if (session.isProcessing) return "processing";
  if (session.pendingPermissions && Object.keys(session.pendingPermissions).length > 0) return "waiting_for_approval";
  return "idle";
}

function attachWorkspaceQueryService(ctx) {
  var getProjects = ctx.getProjects;
  var isMultiUser = ctx.isMultiUser;
  var resolveMate = ctx.resolveMate;
  // Ownership and access both come from here, never from getStatus().
  var projectAccess = workspaceQueryAccess.attachWorkspaceQueryAccess({
    isMultiUser: isMultiUser,
    resolveMate: resolveMate,
    onGetProjectAccess: ctx.onGetProjectAccess,
    canAccessProject: ctx.canAccessProject,
  });

  function authoritativeMate(source) {
    if (!source || source.isMate !== true || !source.mateId || typeof resolveMate !== "function") return null;
    var sourceProject = getProjects().get(source.projectSlug);
    if (!sourceProject) return null;
    var sourceStatus = sourceProject.getStatus();
    if (!sourceStatus || sourceStatus.isMate !== true || sourceStatus.mateId !== source.mateId || sourceStatus.projectOwnerId !== source.projectOwnerId) return null;
    if (source.session) {
      var manager = sourceProject.getSessionManager ? sourceProject.getSessionManager() : sourceProject.sm;
      if (!manager || !manager.sessions || manager.sessions.get(source.session.localId) !== source.session) return null;
    }
    var mate = resolveMate(source.projectOwnerId || null, source.mateId);
    if (!mate || mate.id !== source.mateId) return null;
    if (isMultiUser() && (!source.projectOwnerId || mate.createdBy !== source.projectOwnerId)) return null;
    return mate;
  }

  function bindSource(source) {
    var mate = authoritativeMate(source);
    if (!mate) return null;
    if (isMultiUser()) {
      if (!source.projectOwnerId) return null;
      if (source.session && source.session.ownerId !== source.projectOwnerId) return null;
    } else if (source.session && source.session.ownerId && source.session.ownerId !== source.projectOwnerId) {
      return null;
    }
    var def = mate.builtinKey ? builtinMates.getBuiltinByKey(mate.builtinKey) : null;
    var principal = {
      userId: isMultiUser() ? source.projectOwnerId : null,
      singleUserOwnerId: isMultiUser() ? null : (source.projectOwnerId || null),
      sourceProjectSlug: source.projectSlug,
      sourceSessionId: source.session ? source.session.localId : null,
      sourceSessionRef: source.session ? sessionRef(source.projectSlug, source.session) : null,
      sourceRequestId: source.session ? source.session._homeRequestId || null : null,
      mateId: mate.id,
      isClay: !!(mate.builtinKey === "clay" && def && def.hostAgent === true),
    };
    return createBound(principal);
  }

  function bindProjectSession(source) {
    if (!source || !source.projectSlug || !source.session) return null;
    var project = getProjects().get(source.projectSlug);
    if (!project) return null;
    var manager = project.getSessionManager ? project.getSessionManager() : project.sm;
    if (!manager || !manager.sessions || manager.sessions.get(source.session.localId) !== source.session) return null;
    if (isMultiUser()) {
      if (!source.session.ownerId) return null;
    } else if (source.session.ownerId) {
      return null;
    }
    return createBound({
      userId: isMultiUser() ? source.session.ownerId : null,
      sourceProjectSlug: source.projectSlug,
      sourceSessionId: source.session.localId,
      sourceSessionRef: sessionRef(source.projectSlug, source.session),
      singleUserOwnerId: null,
      sourceRequestId: source.session._homeRequestId || null,
      mateId: null,
      isClay: false,
    });
  }

  function ownsSession(principal, session) {
    if (!session || session.hidden) return false;
    if (isMultiUser()) return !!principal.userId && session.ownerId === principal.userId;
    return !session.ownerId || (!!principal.singleUserOwnerId && session.ownerId === principal.singleUserOwnerId);
  }

  function collect(principal) {
    var projects = [];
    getProjects().forEach(function (project, slug) {
      var status = project.getStatus();
      if (!status) return;
      // Authorized here rather than at bind time, so an already-created tool
      // handler loses a project the moment its access record changes.
      var verdict = projectAccess.evaluate(principal, status);
      if (!verdict.accessible) return;
      var projectOwned = verdict.owned;
      var manager = project.getSessionManager ? project.getSessionManager() : project.sm;
      if (!manager || !manager.sessions) return;
      var sessions = [];
      manager.sessions.forEach(function (session) {
        if (ownsSession(principal, session)) sessions.push(session);
      });
      // An accessible shared/public container grants no history visibility by
      // itself. Include it only when the exact principal owns a session there.
      if (!projectOwned && sessions.length === 0) return;
      projects.push({
        projectSlug: slug,
        projectTitle: cleanMetadata(status.title || status.project || slug, 160),
        projectIcon: cleanMetadata(status.icon || "", 80) || null,
        isMate: !!status.isMate,
        mateId: status.isMate ? (status.mateId || null) : null,
        sessions: sessions,
      });
    });
    return projects;
  }

  function findProject(principal, slug) {
    var projects = collect(principal);
    for (var i = 0; i < projects.length; i++) if (projects[i].projectSlug === slug) return projects[i];
    return null;
  }

  function findSession(project, ref) {
    if (!project || typeof ref !== "string") return null;
    for (var i = 0; i < project.sessions.length; i++) {
      var session = project.sessions[i];
      if (sessionRef(project.projectSlug, session) === ref) return session;
    }
    return null;
  }

  function projectSummary(project) {
    var lastActivity = 0;
    var processing = 0;
    for (var i = 0; i < project.sessions.length; i++) {
      var session = project.sessions[i];
      lastActivity = Math.max(lastActivity, session.lastActivity || session.createdAt || 0);
      if (session.isProcessing) processing++;
    }
    return {
      projectSlug: project.projectSlug,
      title: project.projectTitle,
      icon: project.projectIcon,
      isMate: project.isMate,
      mateId: project.mateId,
      sessionCount: project.sessions.length,
      processingCount: processing,
      lastActivity: lastActivity,
    };
  }

  function sessionSummary(project, session) {
    var ref = sessionRef(project.projectSlug, session);
    return {
      projectSlug: project.projectSlug,
      sessionRef: ref,
      durable: !!session.cliSessionId,
      title: cleanMetadata(session.title || "New Session", 160),
      status: sessionActivity(session),
      createdAt: session.createdAt || 0,
      lastActivity: session.lastActivity || session.createdAt || 0,
      vendor: cleanMetadata(session.vendor || "", 40) || null,
      model: cleanMetadata(session.model || "", 160) || null,
    };
  }

  function page(items, args) {
    var offset = decodeCursor(args && args.cursor);
    var limit = parseLimit(args && args.limit, 20);
    var sliced = items.slice(offset, offset + limit);
    return { items: sliced, nextCursor: offset + limit < items.length ? encodeCursor(offset + limit) : null, total: items.length };
  }

  function searchProjects(principal, args) {
    var query = cleanText(args && args.query || "", 200).toLowerCase();
    var summaries = collect(principal).map(projectSummary).filter(function (project) {
      return !query || project.projectSlug.toLowerCase().indexOf(query) !== -1 || project.title.toLowerCase().indexOf(query) !== -1;
    });
    summaries.sort(function (a, b) { return b.lastActivity - a.lastActivity || a.title.localeCompare(b.title); });
    var result = page(summaries, args || {});
    return { projects: result.items, nextCursor: result.nextCursor, total: result.total };
  }

  function listSessions(principal, args) {
    var project = findProject(principal, args && args.projectSlug);
    if (!project) throw new Error("Project not found in the owned workspace.");
    var sessions = project.sessions.map(function (session) { return sessionSummary(project, session); });
    sessions.sort(function (a, b) { return b.lastActivity - a.lastActivity || a.title.localeCompare(b.title); });
    var result = page(sessions, args || {});
    return { project: { projectSlug: project.projectSlug, title: project.projectTitle }, sessions: result.items, nextCursor: result.nextCursor, total: result.total };
  }

  function sanitizedProject(project) {
    return {
      projectSlug: project.projectSlug,
      projectTitle: project.projectTitle,
      projectIcon: project.projectIcon,
      isMate: project.isMate,
      mateId: project.mateId,
      sessions: project.sessions.map(function (session) {
        return {
          localId: sessionRef(project.projectSlug, session),
          title: cleanMetadata(session.title || "New Session", 160),
          createdAt: session.createdAt || 0,
          lastActivity: session.lastActivity || session.createdAt || 0,
          history: sanitizedHistory(canonicalTurns(session.history)),
        };
      }),
    };
  }

  function searchHistory(principal, projectSlug, args) {
    var query = cleanText(args && args.query || "", 500);
    if (!query) throw new Error("A search query is required.");
    // One authorization snapshot for the whole call. Resolving hits back to
    // their project through findProject() would re-authorize every project once
    // per hit, so the visible set is captured once and indexed.
    var visible;
    if (projectSlug) {
      var project = findProject(principal, projectSlug);
      if (!project) throw new Error("Project not found in the owned workspace.");
      visible = [project];
    } else {
      visible = collect(principal);
    }
    var bySlug = {};
    for (var v = 0; v < visible.length; v++) bySlug[visible[v].projectSlug] = visible[v];
    var projects = visible.map(sanitizedProject);
    var max = Math.min(100, decodeCursor(args && args.cursor) + parseLimit(args && args.limit, 20) + 20);
    var ranked = sessionSearch.searchPalette(projects, query, { maxResults: max });
    var offset = decodeCursor(args && args.cursor);
    var limit = parseLimit(args && args.limit, 20);
    var selected = ranked.slice(offset, offset + limit);
    var results = [];
    for (var i = 0; i < selected.length; i++) {
      var hit = selected[i];
      var projectForHit = bySlug[hit.projectSlug] || null;
      var session = projectForHit ? findSession(projectForHit, String(hit.sessionId)) : null;
      if (!session) continue;
      results.push({
        projectSlug: hit.projectSlug,
        projectTitle: hit.projectTitle,
        sessionRef: sessionRef(projectForHit.projectSlug, session),
        durable: !!session.cliSessionId,
        sessionTitle: cleanMetadata(hit.sessionTitle || "New Session", 160),
        lastActivity: hit.lastActivity || 0,
        matchType: hit.matchType || "content",
        snippet: cleanMetadata(hit.snippet || "", MAX_SNIPPET_CHARS) || null,
        score: hit.score || 0,
      });
    }
    return { results: results, nextCursor: offset + limit < ranked.length ? encodeCursor(offset + limit) : null };
  }

  function readSession(principal, args) {
    var project = findProject(principal, args && args.projectSlug);
    if (!project) throw new Error("Project not found in the owned workspace.");
    var session = findSession(project, args && (args.sessionRef || args.sessionId));
    if (!session) throw new Error("Session not found in the owned workspace.");
    var turns = canonicalTurns(session.history);
    var result = page(turns, args || {});
    return {
      project: { projectSlug: project.projectSlug, title: project.projectTitle },
      session: sessionSummary(project, session),
      turns: result.items,
      nextCursor: result.nextCursor,
      total: result.total,
    };
  }

  function workspaceActivity(principal, args) {
    var entries = [];
    var projects = collect(principal);
    for (var p = 0; p < projects.length; p++) {
      for (var s = 0; s < projects[p].sessions.length; s++) entries.push(sessionSummary(projects[p], projects[p].sessions[s]));
    }
    if (args && args.status) entries = entries.filter(function (entry) { return entry.status === args.status; });
    entries.sort(function (a, b) { return b.lastActivity - a.lastActivity || a.title.localeCompare(b.title); });
    var result = page(entries, args || {});
    return { sessions: result.items, nextCursor: result.nextCursor, total: result.total };
  }

  function resolveSessionNavigation(principal, ref) {
    if (typeof ref !== "string" || !/^session:[A-Za-z0-9_-]{24}$/.test(ref)) throw new Error("Invalid session reference.");
    var projects = collect(principal);
    for (var p = 0; p < projects.length; p++) {
      var session = findSession(projects[p], ref);
      if (!session) continue;
      return {
        projectSlug: projects[p].projectSlug,
        projectTitle: projects[p].projectTitle,
        isMate: projects[p].isMate,
        mateId: projects[p].mateId,
        sessionId: session.localId,
        homeSessionId: session.cliSessionId || "local:" + session.localId,
        title: cleanMetadata(session.title || "New Session", 160),
      };
    }
    throw new Error("Session not found in the owned workspace.");
  }

  function recentDecisions(principal, args) {
    var hits = [];
    var projects = collect(principal);
    var projectSlug = args && args.projectSlug;
    var since = args && args.since ? new Date(args.since).getTime() : null;
    var until = args && args.until ? new Date(args.until).getTime() : null;
    for (var p = 0; p < projects.length; p++) {
      if (projectSlug && projects[p].projectSlug !== projectSlug) continue;
      for (var s = 0; s < projects[p].sessions.length; s++) {
        var session = projects[p].sessions[s];
        var activity = session.lastActivity || session.createdAt || 0;
        if (Number.isFinite(since) && activity < since) continue;
        if (Number.isFinite(until) && activity > until) continue;
        var turns = canonicalTurns(session.history);
        for (var t = 0; t < turns.length; t++) {
          var matched = false;
          for (var d = 0; d < DECISION_PATTERNS.length; d++) {
            if (DECISION_PATTERNS[d].test(turns[t].text)) { matched = true; break; }
          }
          if (!matched) continue;
          hits.push({
            projectSlug: projects[p].projectSlug,
            projectTitle: projects[p].projectTitle,
            sessionRef: sessionRef(projects[p].projectSlug, session),
            sessionTitle: cleanMetadata(session.title || "New Session", 160),
            lastActivity: activity,
            role: turns[t].role,
            text: cleanText(turns[t].text, MAX_SNIPPET_CHARS),
          });
        }
      }
    }
    hits.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
    var result = page(hits, args || {});
    return { results: result.items, nextCursor: result.nextCursor, total: result.total };
  }

  function memorySessions(principal, excludeSource) {
    var out = [];
    var projects = collect(principal);
    for (var p = 0; p < projects.length; p++) {
      if (excludeSource && projects[p].projectSlug === principal.sourceProjectSlug) continue;
      var sanitized = sanitizedProject(projects[p]);
      for (var s = 0; s < sanitized.sessions.length; s++) {
        sanitized.sessions[s]._projectTitle = sanitized.projectTitle;
        sanitized.sessions[s]._projectSlug = sanitized.projectSlug;
        out.push(sanitized.sessions[s]);
      }
    }
    return out;
  }

  function createBound(principal) {
    return {
      isClay: principal.isClay,
      listProjects: function (args) { return searchProjects(principal, args || {}); },
      listProjectSessions: function (args) { return listSessions(principal, args || {}); },
      searchProjectHistory: function (args) { return searchHistory(principal, args && args.projectSlug, args || {}); },
      readProjectSession: function (args) { return readSession(principal, args || {}); },
      searchWorkspaceHistory: function (args) {
        if (!principal.isClay) throw new Error("Workspace-wide search is available only to builtin Clay.");
        return searchHistory(principal, args && args.projectSlug ? args.projectSlug : null, args || {});
      },
      listWorkspaceActivity: function (args) {
        if (!principal.isClay) throw new Error("Workspace-wide activity is available only to builtin Clay.");
        return workspaceActivity(principal, args || {});
      },
      resolveSessionNavigation: function (args) { return resolveSessionNavigation(principal, args && args.sessionRef); },
      listRecentDecisions: function (args) {
        if (!principal.isClay) throw new Error("Workspace decisions are available only to builtin Clay.");
        return recentDecisions(principal, args || {});
      },
      getMemorySessions: function (excludeSource) {
        if (excludeSource && !principal.isClay) return [];
        return memorySessions(principal, excludeSource);
      },
      proposeProjectAssignment: function (args) {
        if (!ctx.assignmentService) throw new Error("Project assignments are unavailable.");
        return ctx.assignmentService.propose(principal, args || {});
      },
      proposeProjectFollowUp: function (args) {
        if (!ctx.assignmentService) throw new Error("Project follow-ups are unavailable.");
        return ctx.assignmentService.proposeFollowUp(principal, args || {});
      },
      getAssignmentStatus: function (args) {
        if (!ctx.assignmentService) throw new Error("Project assignments are unavailable.");
        return ctx.assignmentService.getStatus(principal, args && args.assignmentId);
      },
    };
  }

  return {
    bindSource: bindSource,
    bindProjectSession: bindProjectSession,
    canonicalTurns: canonicalTurns,
    sessionRef: sessionRef,
  };
}

module.exports = {
  attachWorkspaceQueryService: attachWorkspaceQueryService,
  canonicalTurns: canonicalTurns,
  sessionRef: sessionRef,
};
