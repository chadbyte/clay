var provenance = require('./session-provenance');
var personal = require('./mcp-session-access');
// Catalog eligibility is registry-only; content always requires a live private query.
function queryGuard(source, projectFor, multiUser, findUser) {
  var session = source.session, project = projectFor(source.projectSlug);
  var generation = session && Number(session._sdkQueryGeneration || 0);
  return function () {
    var manager = project && (project.getSessionManager ? project.getSessionManager() : project.sm);
    if (!session || projectFor(source.projectSlug) !== project || !manager || manager.sessions.get(session.localId) !== session || Number(session._sdkQueryGeneration || 0) !== generation) throw new Error('This Project Logs query is no longer valid.');
    if (session.taskStopRequested || session.abortController && session.abortController.signal.aborted || session.destroying || session.hidden || session.spawn || provenance.isWorker(session) || session.homeDebatePlanning || session.debateSetupMode || session._mentionInProgress || session.mateCreationMode || session._mcpForeignInput || session.sessionVisibility === 'shared' || session.delegated || session._delegatedBy || session._pairDelegation) throw new Error('Project Logs require a live private canonical Clay query.');
    if (multiUser()) {
      if (!findUser(source.projectOwnerId) || session.ownerId !== source.projectOwnerId || !personal.canUsePersonalConnections(session, manager.sessions)) throw new Error('Foreign input cannot authorize Project Logs.');
    } else if (session.ownerId || (session.history || []).some(function (entry) { return entry.type === 'user_message' && entry.from && entry.from !== 'default'; })) throw new Error('Foreign input cannot authorize Project Logs.');
  };
}
module.exports = { queryGuard: queryGuard };
