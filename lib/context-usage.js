// Shared request ordering for routine estimates and user-requested details.
var requests = new WeakMap();

function readUsage(session, detail) {
  var query = session.queryInstance;
  if (!query || typeof query.getContextUsage !== "function") return Promise.resolve(null);
  var state = requests.get(session);
  if (!state || state.query !== query || state.turn !== session.turnCount) {
    state = { query: query, turn: session.turnCount, sequence: 0, pending: {} };
    requests.set(session, state);
  }
  var level = detail === "full" ? "full" : "summary";
  if (state.pending[level]) return state.pending[level];
  var sequence = ++state.sequence;
  var request = Promise.resolve().then(function() {
    return query.getContextUsage({ detail: level });
  }).then(function(data) {
    if (!data || session.queryInstance !== query || requests.get(session) !== state || state.sequence !== sequence) return null;
    session.lastContextUsage = data;
    return data;
  }).finally(function() { delete state.pending[level]; });
  state.pending[level] = request;
  return request;
}

function attachContextUsage(ctx) {
  function allowed(ws, session) {
    if (!session || ctx.getSessionForWs(ws) !== session) return false;
    if (!ctx.usersModule || !ctx.usersModule.isMultiUser()) return true;
    return !!(ws._clayUser && ctx.usersModule.canAccessSession(ws._clayUser.id, session, ctx.getProjectAccess ? ctx.getProjectAccess() : { visibility: "public" }));
  }
  return {
    handleMessage: function(ws, message) {
      if (message.type !== "context_usage_request") return false;
      var session = ctx.getSessionForWs(ws);
      if (!allowed(ws, session) || message.sessionId !== session.localId) return true;
      readUsage(session, "full").then(function(data) {
        if (data && allowed(ws, session) && ctx.sm.sessions.get(session.localId) === session) {
          ctx.sendTo(ws, { type: "context_usage", sessionId: session.localId, data: data });
        }
      }).catch(function(error) { console.error("[context-usage] Detail request failed:", error.message); });
      return true;
    },
  };
}

module.exports = { readUsage: readUsage, attachContextUsage: attachContextUsage };
