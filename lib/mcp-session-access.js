// A shared Driver must not reach personal connections indirectly through its Worker.
function canUsePersonalConnections(session, sessions) {
  if (!session || sessions.get(session.localId) !== session || !session.ownerId) return false;
  if (session.sessionVisibility === 'shared' || session._mcpForeignInput) return false;
  if ((session.history || []).some(function (entry) { return entry.type === 'user_message' && entry.from && entry.from !== session.ownerId; })) return false;
  var provenance = session.sessionProvenance;
  if (provenance && provenance.kind === 'worker') {
    var parents = Array.from(sessions.values()).filter(function (candidate) { return candidate.sessionOriginId && candidate.sessionOriginId === provenance.parentSessionOriginId; });
    var parent = parents.length === 1 && parents[0];
    if (!parent || parent.ownerId !== session.ownerId || (parent.sessionProvenance && parent.sessionProvenance.kind === 'worker')) return false;
    return canUsePersonalConnections(parent, sessions);
  }
  return !session.delegated && !session._delegatedBy && !session._pairDelegation;
}
module.exports = { canUsePersonalConnections: canUsePersonalConnections };
