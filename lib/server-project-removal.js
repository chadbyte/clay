// Shared runtime removal used by the server callback and lifecycle controls.
function removeProjectRuntime(projects, slug, awaitCompletion, registryRefresh) {
  var project = projects.get(slug);
  if (!project) return false;
  var wasMate = project.getStatus().isMate;
  var shutdownResult = project.destroy();
  if (!awaitCompletion) projects.delete(slug);
  if (shutdownResult && typeof shutdownResult.catch === 'function') {
    shutdownResult.catch(function (error) {
      console.error('[server] Project destroy failed for ' + slug + ':', error && error.message ? error.message : error);
    });
  }
  if (!wasMate && registryRefresh) registryRefresh();
  if (awaitCompletion) return Promise.resolve(shutdownResult).then(function (result) {
    if (result !== true) throw new Error('Project runtime shutdown did not complete successfully: ' + slug);
    if (projects.get(slug) !== project) throw new Error('Project runtime was replaced during shutdown: ' + slug);
    projects.delete(slug);
    return true;
  });
  return true;
}
module.exports = { removeProjectRuntime: removeProjectRuntime };
