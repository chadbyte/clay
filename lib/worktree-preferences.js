// Worktree display preferences are parent-owned and bound to the Git change set.
function entry(config, parentSlug, slug) {
  var parent = (config.projects || []).find(function (item) { return item.slug === parentSlug; });
  return parent && parent.worktreePreferences && parent.worktreePreferences[slug];
}
function matches(record, targetPath, changeSetId) {
  return !!record && record.path === targetPath && record.changeSetId === changeSetId;
}
function icon(config, parentSlug, slug, targetPath, changeSetId) {
  var record = entry(config, parentSlug, slug);
  return matches(record, targetPath, changeSetId) ? record.icon || null : null;
}
function blocked(config, parentSlug, slug, targetPath, changeSetId) {
  var record = entry(config, parentSlug, slug);
  return matches(record, targetPath, changeSetId) && (record.excluded || record.lifecycleState);
}
// A durable shutdown reservation fences parent mutations even if a display record is replaced.
function pendingRemoval(config, parentSlug) {
  var parent = (config.projects || []).find(function (item) { return item.slug === parentSlug; });
  return !!parent && Object.values(config.projectLifecycleOperations || {}).some(function (operation) {
    return operation.phase === 'pending' && operation.action === 'remove' &&
      operation.projectKnowledgeId === parent.projectKnowledgeId && operation.slug.indexOf(parentSlug + '--') === 0;
  });
}
module.exports = { pendingRemoval: pendingRemoval, entry: entry, matches: matches, icon: icon, blocked: blocked };
