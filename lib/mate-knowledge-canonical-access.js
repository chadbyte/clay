var personal = require('./mcp-session-access');
var provenance = require('./session-provenance');
function assertCanonicalKnowledgeQuery(source, project, multiUser, generation, findUser) {
  var session = source.session, manager = project && project.getSessionManager();
  if (!session || !manager || manager.sessions.get(session.localId) !== session || Number(session._sdkQueryGeneration || 0) !== generation) throw new Error('This canonical Knowledge query is stale.');
  if (session.destroying || session.hidden || session.taskStopRequested || session.abortController && session.abortController.signal.aborted || session.spawn || provenance.isWorker(session) || session.homeDebatePlanning || session.debateSetupMode || session._mentionInProgress || session.mateCreationMode || session.sessionVisibility === 'shared' || session._mcpForeignInput || session.delegated || session._delegatedBy || session._pairDelegation) throw new Error('Canonical Knowledge requires a live private owner-authored query.');
  if (multiUser && (!source.projectOwnerId || session.ownerId !== source.projectOwnerId || !personal.canUsePersonalConnections(session, manager.sessions) || findUser && !findUser(source.projectOwnerId))) throw new Error('Canonical Knowledge owner access changed.');
  if (!multiUser && (session.ownerId || (session.history || []).some(function (entry) { return entry.type === 'user_message' && entry.from && entry.from !== 'default'; }))) throw new Error('Foreign input cannot authorize canonical Knowledge.');
}
module.exports = { assertCanonicalKnowledgeQuery: assertCanonicalKnowledgeQuery };
