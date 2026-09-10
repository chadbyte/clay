var sessionSearch = require("./session-search");

function attachPalette(ctx) {
  var users = ctx.users;
  var projects = ctx.projects;
  var getMultiUserFromReq = ctx.getMultiUserFromReq;
  var onGetProjectAccess = ctx.onGetProjectAccess;
  var canUserAccessSlug = ctx.canUserAccessSlug;

  function accessFor(user, slug, status) {
    if (!user) return { visibility: "public" };
    if (typeof canUserAccessSlug !== "function" || !canUserAccessSlug(user.id, slug)) return null;
    if (status && status.isMate) {
      return { visibility: "private", ownerId: status.projectOwnerId || null, allowedUsers: [] };
    }
    var access = onGetProjectAccess ? onGetProjectAccess(slug) : null;
    return access && !access.error ? access : null;
  }

  function handleRequest(req, res, fullUrl) {
    if (req.method !== "GET" || fullUrl !== "/api/palette/search") return false;

    var paletteUser = null;
    if (users.isMultiUser()) {
      paletteUser = getMultiUserFromReq(req);
      if (!paletteUser) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end('{"error":"unauthorized"}');
        return true;
      }
    }
    var pqs = req.url.indexOf("?") >= 0 ? req.url.substring(req.url.indexOf("?")) : "";
    var pQuery = new URLSearchParams(pqs).get("q") || "";
    var pResults = [];

    if (!pQuery) {
      // Recent mode: return all sessions sorted by lastActivity
      projects.forEach(function (pCtx, pSlug) {
        var status = pCtx.getStatus();
        var pAccess = accessFor(paletteUser, pSlug, status);
        if (paletteUser && !pAccess) return;
        pCtx.sm.sessions.forEach(function (session) {
          if (session.hidden) return;
          if (paletteUser) {
            if (users.isMultiUser()) {
              if (!users.canAccessSession(paletteUser.id, session, pAccess)) return;
            }
          } else {
            if (session.ownerId) return;
          }
          var pItem = {
            projectSlug: pSlug,
            projectTitle: status.title || status.project,
            projectIcon: status.icon || null,
            sessionId: session.localId,
            sessionTitle: session.title || "New Session",
            lastActivity: session.lastActivity || session.createdAt || 0,
            matchType: null,
            snippet: null
          };
          if (status.isMate) {
            pItem.isMate = true;
            pItem.mateId = status.mateId || null;
          }
          pResults.push(pItem);
        });
      });
      pResults.sort(function (a, b) { return b.lastActivity - a.lastActivity; });
      if (pResults.length > 30) pResults = pResults.slice(0, 30);
    } else {
      // Search mode: BM25 ranked search across all sessions
      var projectSessions = [];
      projects.forEach(function (pCtx, pSlug) {
        var status = pCtx.getStatus();
        var pAccess = accessFor(paletteUser, pSlug, status);
        if (paletteUser && !pAccess) return;
        var accessibleSessions = [];
        pCtx.sm.sessions.forEach(function (session) {
          if (session.hidden) return;
          if (paletteUser) {
            if (users.isMultiUser()) {
              if (!users.canAccessSession(paletteUser.id, session, pAccess)) return;
            }
          } else {
            if (session.ownerId) return;
          }
          accessibleSessions.push(session);
        });
        if (accessibleSessions.length > 0) {
          projectSessions.push({
            projectSlug: pSlug,
            projectTitle: status.title || status.project,
            projectIcon: status.icon || null,
            isMate: status.isMate || false,
            mateId: status.mateId || null,
            sessions: accessibleSessions
          });
        }
      });
      pResults = sessionSearch.searchPalette(projectSessions, pQuery, { maxResults: 30 });
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ results: pResults }));
    return true;
  }

  return {
    handleRequest: handleRequest,
  };
}

module.exports = { attachPalette: attachPalette };
