function createProjection(deps) {
  var canonicalTurns = deps.canonicalTurns;
  var sanitizedHistory = deps.sanitizedHistory;
  var cleanMetadata = deps.cleanMetadata;
  var sessionRef = deps.sessionRef;

  function sanitizedProject(project, turnLimit) {
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
          history: sanitizedHistory(canonicalTurns(session.history, turnLimit)),
        };
      }),
    };
  }

  return { sanitizedProject: sanitizedProject };
}

module.exports = { createProjection: createProjection };
