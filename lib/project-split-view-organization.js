// Saved presentation metadata never changes member-session organization.
function attachOrganization(deps) {
  function organize(ownerId, linuxUser, input) {
    var prepared = deps.prepare(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    var view = prepared.record.views.find(function (item) { return item.id === input.id; });
    if (!view || view.revision !== input.expectedViewRevision) return { ok: false, code: 'conflict', error: 'Split view changed. Reload and try again.' };
    if (!(input.folderId === null || typeof input.folderId === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(input.folderId)) || typeof input.favorite !== 'boolean') return { ok: false, code: 'invalid', error: 'Invalid Split view organization.' };
    view.folderId = input.folderId; view.favorite = input.favorite;
    return deps.commit(ownerId, prepared.record, view);
  }
  function reconcileFolders(ownerId, linuxUser, folderIds) {
    var current = deps.state(ownerId, linuxUser);
    if (!current.ok || !current.views.some(function (view) { return view.folderId && folderIds.indexOf(view.folderId) < 0; })) return current;
    var prepared = deps.prepare(ownerId, linuxUser, current.revision);
    if (!prepared.ok) return prepared;
    var changed = [];
    prepared.record.views.forEach(function (view) { if (view.folderId && folderIds.indexOf(view.folderId) < 0) { view.folderId = null; changed.push(view); } });
    return deps.commit(ownerId, prepared.record, changed);
  }
  return { organize: organize, reconcileFolders: reconcileFolders };
}
module.exports = { attachOrganization: attachOrganization };
