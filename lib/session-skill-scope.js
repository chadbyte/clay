// Bind personal instruction reads to the existing live session/query authority.
function bind(session, sessions, options, valid, multiUser, excludeSkills) {
  var owner = session.ownerId || null;
  return Object.assign({}, options, excludeSkills && excludeSkills.length ? { excludeSkills: excludeSkills } : {}, { isAvailable: function() {
    if (!sessions || typeof sessions.get !== "function" || sessions.get(session.localId) !== session || !valid() || (session.ownerId || null) !== owner || session.youCurator || session.sessionVisibility === "shared" || session._mcpForeignInput) return false;
    if (owner) return require("./mcp-session-access").canUsePersonalConnections(session, sessions);
    return !multiUser && !session.delegated && !session._delegatedBy && !session._pairDelegation
      && !(session.history || []).some(function(entry) { return entry.type === "user_message" && entry.from && entry.from !== "default"; });
  } });
}
module.exports = { bind: bind };
