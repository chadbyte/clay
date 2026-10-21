var fs = require("fs");
var path = require("path");
var crypto = require("crypto");
var layout = require("./split-view-layout");
var workspace = require("./project-view-workspace");
var checkInput = require("./project-view-input").check;
var names = require("./project-split-view-names");
var validDocument = require("./project-split-view-document").validDocument;
function clone(value) { return JSON.parse(JSON.stringify(value)); }
function ownerKey(ownerId) { return ownerId == null ? "default" : "user:" + String(ownerId); }
function emptyDocument() { return { version: 1, projects: {} }; }
function emptyOwner(ownerId, linuxUser) { return { ownerId: ownerId == null ? null : String(ownerId), linuxUser: linuxUser || null, revision: 0, views: [] }; }
function createSplitViewsStore(opts) {
  var slug = opts.slug;
  var sessionsDir = opts.sessionsDir;
  var filePath = opts.filePath || path.join(sessionsDir, "presentation-split-views.json");
  var fsImpl = opts.fs || fs;
  var persist = opts.persist || null;
  var document = emptyDocument();
  var loadError = null;
  try {
    var loaded = JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
    if (!validDocument(loaded)) throw new Error("Stored Split view data is invalid");
    document = loaded;
  } catch (error) {
    if (!error || error.code !== "ENOENT") loadError = error;
  }
  function projectRecord(source, create) {
    if (!source.projects[slug] && create) source.projects[slug] = { owners: {} };
    return source.projects[slug] || null;
  }
  function ownerRecord(source, ownerId, linuxUser, create) {
    var project = projectRecord(source, create);
    if (!project) return null;
    var key = ownerKey(ownerId), record = project.owners[key];
    if (!record && create) { record = emptyOwner(ownerId, linuxUser); project.owners[key] = record; }
    if (record && (record.ownerId !== (ownerId == null ? null : String(ownerId)) || record.linuxUser !== (linuxUser || null))) return { identityMismatch: true };
    return record || null;
  }
  function save(next) {
    if (!validDocument(next)) throw new Error("Split view state failed validation");
    var serialized = JSON.stringify(next, null, 2) + "\n";
    if (persist) {
      if (persist(filePath, serialized) === false) throw new Error("Split view persistence returned false");
      return;
    }
    fsImpl.mkdirSync(sessionsDir, { recursive: true });
    var tempPath = filePath + ".tmp." + process.pid + "." + crypto.randomBytes(4).toString("hex");
    try {
      fsImpl.writeFileSync(tempPath, serialized, { encoding: "utf8", flag: "wx", mode: 0o600 });
      if (process.platform !== "win32") try { fsImpl.chmodSync(tempPath, 0o600); } catch (e) {}
      fsImpl.renameSync(tempPath, filePath);
    } catch (error) {
      try { fsImpl.unlinkSync(tempPath); } catch (e) {}
      throw error;
    }
  }
  function state(ownerId, linuxUser) {
    if (loadError) return { ok: false, error: "Stored Split view data could not be read; no changes were made", code: "storage", revision: 0, views: [] };
    var record = ownerRecord(document, ownerId, linuxUser, false);
    if (record && record.identityMismatch) return { ok: false, error: "Split view owner or OS identity changed", code: "identity", revision: 0, views: [] };
    return record ? { ok: true, revision: record.revision, activeViewId: record.activeViewId || null, views: record.views.map(workspace.normalized) } : { ok: true, revision: 0, views: [] };
  }
  function conflict(actual) { return { ok: false, error: "Split view state changed. Reload and try again.", code: "conflict", revision: actual }; }
  function validateRevision(value) { return Number.isSafeInteger(value) && value >= 0; }
  function prepareRecord(ownerId, linuxUser, expectedRevision) {
    var current = state(ownerId, linuxUser);
    if (!current.ok) return current;
    if (!validateRevision(expectedRevision) || expectedRevision !== current.revision) return conflict(current.revision);
    var next = clone(document), record = ownerRecord(next, ownerId, linuxUser, true);
    return { ok: true, next: next, record: record };
  }
  function commit(ownerId, record, changedView) {
    record.revision++;
    if (Array.isArray(changedView)) changedView.forEach(function (view) { if (view) view.revision = record.revision; });
    else if (changedView) changedView.revision = record.revision;
    try { save(documentForOwner(record, ownerId)); }
    catch (error) { return { ok: false, error: error.message || String(error), code: "storage", revision: state(ownerId, record.linuxUser).revision }; }
    document = documentForOwner(record, ownerId);
    var resultView = Array.isArray(changedView) ? changedView[changedView.length - 1] : changedView;
    return { ok: true, revision: record.revision, view: resultView ? workspace.normalized(resultView) : null, views: record.views.map(workspace.normalized) };
  }
  function documentForOwner(record, ownerId) {
    var next = clone(document), project = projectRecord(next, true);
    project.owners[ownerKey(ownerId)] = clone(record);
    return next;
  }
  function validExpectedView(record, id) {
    if (typeof id !== "string" || !id) return { error: "Split view not found" };
    var index = record.views.findIndex(function (view) { return view.id === id; });
    if (index === -1) return { error: "Split view not found" };
    return { index: index, view: record.views[index] };
  }
  function refsFor(origins, resolvedRefs) {
    if (!Array.isArray(origins) || origins.length > layout.MAX_SESSIONS ||
        origins.some(function (origin) { return !layout.validOrigin(origin); }) || new Set(origins).size !== origins.length) return { error: "A View supports zero to eight unique session origins" };
    if (!Array.isArray(resolvedRefs) || resolvedRefs.length !== origins.length) return { error: "One or more exact sessions could not be resolved" };
    var refs = [];
    for (var i = 0; i < origins.length; i++) {
      var ref = resolvedRefs.find(function (item) { return item && item.originId === origins[i]; });
      if (!ref) return { error: "One or more exact sessions could not be resolved" };
      refs.push({ originId: ref.originId, ownerId: ref.ownerId == null ? null : String(ref.ownerId), linuxUser: ref.linuxUser || null });
    }
    return { refs: refs };
  }
  function validateComposition(input, refs) {
    var origins = refs.map(function (ref) { return ref.originId; }), tree = layout.validateTree(input.tree, origins), preset = input.layout;
    if (!tree.ok) return { error: tree.error };
    if (!layout.validatePreset(preset)) return { error: "Unknown Split view layout" };
    if (origins.length ? typeof input.activeSessionOriginId !== "string" || origins.indexOf(input.activeSessionOriginId) === -1 : input.activeSessionOriginId !== null) return { error: "Active session must belong to the Split view" };
    if (input.workspace !== undefined) {
      var checked = workspace.validate(input.workspace, { tree: input.tree, sessionRefs: refs });
      if (!checked.ok) return { error: checked.error };
    }
    return { origins: origins };
  }
  function uniqueMembership(views, refs, exceptId, secondExceptId) {
    var used = [];
    views.forEach(function (view) {
      if (view.id === exceptId || view.id === secondExceptId) return;
      view.sessionRefs.forEach(function (ref) { used.push(ref.originId); });
    });
    return refs.every(function (ref) { return used.indexOf(ref.originId) === -1; });
  }
  function create(ownerId, linuxUser, input, resolvedRefs, destinationFolderId) {
    input = input || {};
    var prepared = prepareRecord(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    var identity = checkInput(input, slug, ownerId, input.workspace !== undefined || Array.isArray(input.sessionOrigins) && input.sessionOrigins.length < 2);
    if (!identity.ok) return identity;
    var name = layout.validateName(input.name), refs = refsFor(input.sessionOrigins, resolvedRefs);
    if (!name.ok) return name;
    if (refs.error) return { ok: false, error: refs.error };
    var composition = validateComposition(input, refs.refs);
    if (composition.error) return { ok: false, error: composition.error };
    if (!uniqueMembership(prepared.record.views, refs.refs)) return { ok: false, error: "A session can belong to only one Split view" };
    var nameMode = input.nameMode === "custom" ? "custom" : "automatic";
    var view = { id: crypto.randomUUID(), name: nameMode === "automatic" ? names.automaticName(input.liveSessions) : name.name, nameMode: nameMode,
      folderId: destinationFolderId || null, favorite: false, revision: prepared.record.revision + 1, layout: input.layout,
      activeSessionOriginId: input.activeSessionOriginId, tree: clone(input.tree), sessionRefs: refs.refs };
    if (input.workspace !== undefined || refs.refs.length < 2) view.workspace = input.workspace === undefined ? workspace.legacy(view) : clone(input.workspace);
    prepared.record.views.push(view);
    if (input.active === true) prepared.record.activeViewId = view.id;
    return commit(ownerId, prepared.record, view);
  }
  function update(ownerId, linuxUser, input, resolvedRefs, destinationFolderId) {
    input = input || {};
    var prepared = prepareRecord(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    var found = validExpectedView(prepared.record, input.id, input.expectedRevision);
    if (found.error) return { ok: false, error: found.error };
    if (found.conflict) return conflict(found.revision);
    var identity = checkInput(input, slug, ownerId, found.view.workspace !== undefined || input.workspace !== undefined || Array.isArray(input.sessionOrigins) && input.sessionOrigins.length < 2, found.view);
    if (!identity.ok) return identity;
    var refs = refsFor(input.sessionOrigins, resolvedRefs);
    if (refs.error) return { ok: false, error: refs.error };
    if (found.view.workspace && input.workspace === undefined) return { ok: false, code: "workspace_required", error: "Update the complete workspace to preserve pane identities and layout" };
    var ordered = names.update(found.view, refs.refs, input.liveSessions);
    if (!ordered) return { ok: false, error: "One or more exact sessions could not be resolved" };
    refs.refs = ordered.refs; input.liveSessions = ordered.sessions;
    var composition = validateComposition(input, refs.refs);
    if (composition.error) return { ok: false, error: composition.error };
    if (input.workspace !== undefined) {
      var transitioned = workspace.transition(workspace.normalized(found.view).workspace, input.workspace);
      if (!transitioned.ok) return transitioned;
    }
    if (!uniqueMembership(prepared.record.views, refs.refs, input.id)) return { ok: false, error: "A session can belong to only one Split view" };
    if (names.mode(found.view) === "automatic") found.view.name = names.automaticName(input.liveSessions);
    found.view.layout = input.layout; found.view.activeSessionOriginId = input.activeSessionOriginId;
    found.view.tree = clone(input.tree); found.view.sessionRefs = refs.refs;
    if (destinationFolderId !== undefined) found.view.folderId = destinationFolderId;
    if (input.workspace !== undefined || refs.refs.length < 2) found.view.workspace = input.workspace === undefined ? workspace.legacy(found.view) : clone(input.workspace);
    if (input.active === true) prepared.record.activeViewId = found.view.id;
    return commit(ownerId, prepared.record, found.view);
  }
  function rename(ownerId, linuxUser, input) {
    input = input || {};
    var prepared = prepareRecord(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    var found = validExpectedView(prepared.record, input.id, input.expectedRevision);
    if (found.error) return { ok: false, error: found.error };
    if (found.conflict) return conflict(found.revision);
    var identity = checkInput(input, slug, ownerId, found.view.workspace !== undefined || input.workspace !== undefined || Array.isArray(input.sessionOrigins) && input.sessionOrigins.length < 2, found.view);
    if (!identity.ok) return identity;
    var name = layout.validateName(input.name);
    if (!name.ok) return name;
    found.view.name = name.name;
    found.view.nameMode = "custom";
    if (input.active === true) prepared.record.activeViewId = found.view.id;
    return commit(ownerId, prepared.record, found.view);
  }
  function separate(ownerId, linuxUser, input) {
    input = input || {};
    var prepared = prepareRecord(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    var found = validExpectedView(prepared.record, input.id, input.expectedRevision);
    if (found.error) return { ok: false, error: found.error };
    if (found.conflict) return conflict(found.revision);
    var identity = checkInput(input, slug, ownerId, found.view.workspace !== undefined || input.workspace !== undefined || Array.isArray(input.sessionOrigins) && input.sessionOrigins.length < 2, found.view);
    if (!identity.ok) return identity;
    var removed = prepared.record.views.splice(found.index, 1)[0];
    if (prepared.record.activeViewId === removed.id) prepared.record.activeViewId = null;
    return commit(ownerId, prepared.record, null);
  }
  function move(ownerId, linuxUser, input, resolvedSourceRefs, resolvedTargetRefs, destinationFolderId) {
    input = input || {};
    var prepared = prepareRecord(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    if (typeof input.sourceSessionOriginId !== "string" || !layout.validOrigin(input.sourceSessionOriginId)) return { ok: false, error: "A valid source session is required", code: "invalid" };
    var source = validExpectedView(prepared.record, input.sourceViewId);
    if (source.error) return { ok: false, error: "Source Split view not found", code: "not_found", revision: prepared.record.revision };
    if ((source.view.workspace || input.workspace !== undefined) && input.targetWorkspace === undefined) return { ok: false, code: "workspace_required", error: "Legacy move does not support workspace Views" };
    var identity = checkInput(input, slug, ownerId, !!input.targetWorkspace, source.view);
    if (!identity.ok) return identity;
    var sourceOrigins = source.view.sessionRefs.map(function (ref) { return ref.originId; });
    if (sourceOrigins.indexOf(input.sourceSessionOriginId) === -1) return { ok: false, error: "Source session does not belong to the source Split view", code: "session", revision: prepared.record.revision };
    if (!Array.isArray(resolvedSourceRefs) || resolvedSourceRefs.length !== source.view.sessionRefs.length) return { ok: false, error: "Source sessions could not be resolved", code: "session", revision: prepared.record.revision };
    for (var i = 0; i < source.view.sessionRefs.length; i++) {
      var storedSource = source.view.sessionRefs[i], liveSource = resolvedSourceRefs.find(function (ref) { return ref && ref.originId === storedSource.originId; });
      if (!liveSource || (liveSource.ownerId || null) !== (storedSource.ownerId || null) || (liveSource.linuxUser || null) !== (storedSource.linuxUser || null)) {
        return { ok: false, error: "A source session was replaced or changed identity", code: "session", revision: prepared.record.revision };
      }
    }
    var target = null, targetSessionOriginId = input.targetSessionOriginId;
    var hasTargetView = typeof input.targetViewId === "string" && input.targetViewId.length > 0;
    var hasStandaloneTarget = typeof targetSessionOriginId === "string" && layout.validOrigin(targetSessionOriginId);
    if (hasTargetView === hasStandaloneTarget || (input.targetViewId != null && !hasTargetView)) {
      return { ok: false, error: "Choose exactly one target Split view or standalone session", code: "invalid", revision: prepared.record.revision };
    }
    if (hasTargetView) {
      target = validExpectedView(prepared.record, input.targetViewId);
      if (target.error || target.view.id === source.view.id) return { ok: false, error: "Target Split view is unavailable", code: "not_found", revision: prepared.record.revision };
    }
    if (target && target.view.workspace && input.targetWorkspace === undefined) return { ok: false, code: "workspace_required", error: "Legacy move does not support workspace Views" };
    if (Array.isArray(input.targetSessionOrigins) && input.targetSessionOrigins.length > layout.MAX_SESSIONS) {
      return { ok: false, error: "A Split view can contain at most eight sessions", code: "limit", revision: prepared.record.revision };
    }
    var targetRefs = refsFor(input.targetSessionOrigins, resolvedTargetRefs);
    if (targetRefs.error) return { ok: false, error: targetRefs.error, code: "session", revision: prepared.record.revision };
    var requestedTargetOrigins = targetRefs.refs.map(function (ref) { return ref.originId; });
    if (requestedTargetOrigins.indexOf(input.sourceSessionOriginId) === -1) return { ok: false, error: "Target layout must include the moved source session", code: "invalid", revision: prepared.record.revision };
    if (target) {
      var requestedPriorOrigins = target.view.sessionRefs.map(function (ref) { return ref.originId; });
      if (requestedTargetOrigins.length !== requestedPriorOrigins.length + 1 || requestedPriorOrigins.some(function (origin) { return requestedTargetOrigins.indexOf(origin) === -1; })) {
        return { ok: false, error: "Target layout must preserve every existing target session", code: "invalid", revision: prepared.record.revision };
      }
      if (!uniqueMembership(prepared.record.views, targetRefs.refs, target.view.id, source.view.id)) return { ok: false, error: "A target session belongs to another Split view", code: "membership", revision: prepared.record.revision };
    } else if (targetSessionOriginId === input.sourceSessionOriginId || requestedTargetOrigins.length !== 2 || requestedTargetOrigins.indexOf(targetSessionOriginId) === -1) {
      return { ok: false, error: "A standalone target transfer requires exactly the target and moved sessions", code: "invalid", revision: prepared.record.revision };
    } else if (!uniqueMembership(prepared.record.views, targetRefs.refs, source.view.id)) {
      return { ok: false, error: "A standalone target session already belongs to a Split view", code: "membership", revision: prepared.record.revision };
    }
    if (target) { var orderedTarget = names.append(target.view, targetRefs.refs, input.liveSessions, input.sourceSessionOriginId);
      if (!orderedTarget) return { ok: false, error: "Target layout must preserve existing sessions and include the moved source exactly once", code: "invalid", revision: prepared.record.revision };
      targetRefs.refs = orderedTarget.refs; input.liveSessions = orderedTarget.sessions; }
    else { var orderedStandalone = names.targetFirst(targetRefs.refs, input.liveSessions, targetSessionOriginId, input.sourceSessionOriginId);
      if (!orderedStandalone) return { ok: false, error: "A standalone target transfer requires exactly the target and moved sessions", code: "invalid", revision: prepared.record.revision };
      targetRefs.refs = orderedStandalone.refs; input.liveSessions = orderedStandalone.sessions; }
    var targetOrigins = targetRefs.refs.map(function (ref) { return ref.originId; });
    if (!layout.validatePreset(input.layout) || !layout.validateTree(input.tree, targetOrigins).ok || targetOrigins.length > layout.MAX_SESSIONS) {
      return { ok: false, error: "Target layout is invalid or exceeds the eight-session limit", code: targetOrigins.length > layout.MAX_SESSIONS ? "limit" : "invalid", revision: prepared.record.revision };
    }
    if (typeof input.activeSessionOriginId !== "string" || targetOrigins.indexOf(input.activeSessionOriginId) === -1) {
      return { ok: false, error: "Active session must belong to the target Split view", code: "invalid", revision: prepared.record.revision };
    }
    if (!target) {
      var name = layout.validateName(input.name);
      if (!name.ok) return { ok: false, error: name.error, code: "invalid", revision: prepared.record.revision };
    }
    if (input.targetWorkspace !== undefined) {
      if (target && input.expectedTargetViewRevision !== target.view.revision) return conflict(prepared.record.revision);
      var checked = workspace.validate(input.targetWorkspace, { tree: input.tree, sessionRefs: targetRefs.refs });
      if (!checked.ok) return checked;
      var prior = target ? workspace.normalized(target.view).workspace : { panes: [] };
      if (prior.panes.some(function (pane) { return !input.targetWorkspace.panes.some(function (next) { return workspace.samePane(next, pane); }); })) return { ok: false, code: 'workspace', error: 'Move must preserve every existing target pane and binding' };
      var transitioned = workspace.transition(prior, input.targetWorkspace);
      if (!transitioned.ok) return transitioned;
      var movedPane = workspace.normalized(source.view).workspace.panes.find(function (pane) { return pane.kind === 'session' && pane.resource.originId === input.sourceSessionOriginId; });
      var destination = input.targetWorkspace.panes.find(function (pane) { return pane.kind === 'session' && pane.resource.originId === input.sourceSessionOriginId; });
      if (!movedPane || !destination || movedPane.instanceId !== destination.instanceId) return { ok: false, code: 'identity', error: 'Move must retain the exact pane instance' };
    }
    var nextSourceOrigins = sourceOrigins.filter(function (origin) { return origin !== input.sourceSessionOriginId; });
    source.view.tree = layout.removeLeaf(source.view.tree, input.sourceSessionOriginId);
    source.view.sessionRefs = source.view.sessionRefs.filter(function (ref) { return ref.originId !== input.sourceSessionOriginId; });
    if (source.view.activeSessionOriginId === input.sourceSessionOriginId) source.view.activeSessionOriginId = nextSourceOrigins[0] || null;
    workspace.removeSession(source.view, input.sourceSessionOriginId);
    if (nextSourceOrigins.length < 2 && !source.view.workspace) { prepared.record.views.splice(source.index, 1); if (prepared.record.activeViewId === source.view.id) prepared.record.activeViewId = null; }
    if (nextSourceOrigins.length >= 2 && names.mode(source.view) === "automatic") source.view.name = names.automaticName(input.sourceLiveSessions.filter(function (session) { return session.sessionOriginId !== input.sourceSessionOriginId; }));
    if (target) {
      if (destinationFolderId !== undefined) target.view.folderId = destinationFolderId;
      target.view.tree = clone(input.tree); target.view.layout = input.layout;
      target.view.activeSessionOriginId = input.activeSessionOriginId; target.view.sessionRefs = targetRefs.refs;
      if (names.mode(target.view) === "automatic") target.view.name = names.automaticName(input.liveSessions);
    } else {
      target = { index: -1, view: { id: crypto.randomUUID(), folderId: destinationFolderId || null, favorite: false, name: names.automaticName(input.liveSessions), nameMode: "automatic", revision: prepared.record.revision + 1,
        layout: input.layout, activeSessionOriginId: input.activeSessionOriginId, tree: clone(input.tree), sessionRefs: targetRefs.refs } };
      prepared.record.views.push(target.view);
    }
    if (input.targetWorkspace !== undefined) target.view.workspace = clone(input.targetWorkspace);
    if (input.active === true) prepared.record.activeViewId = target.view.id;
    var changed = [target.view];
    if (nextSourceOrigins.length >= 2 || source.view.workspace) changed.unshift(source.view);
    return commit(ownerId, prepared.record, changed);
  }
  function removeOrigin(originId) {
    var project = projectRecord(document, false), changedOwners = [], failures = [];
    if (!project) return { owners: changedOwners, failures: failures };
    var keys = Object.keys(project.owners);
    for (var i = 0; i < keys.length; i++) {
      var source = project.owners[keys[i]], next = clone(source), changed = false, retained = [];
      for (var j = 0; j < next.views.length; j++) {
        var view = next.views[j], member = view.sessionRefs.some(function (ref) { return ref.originId === originId; });
        if (!member) { retained.push(view); continue; }
        changed = true;
        var tree = layout.removeLeaf(view.tree, originId), origins = view.sessionRefs.filter(function (ref) { return ref.originId !== originId; });
        if (origins.length < 2 && !view.workspace) continue;
        view.tree = tree;
        view.sessionRefs = origins;
        if (view.activeSessionOriginId === originId) view.activeSessionOriginId = origins.length ? origins[0].originId : null;
        workspace.removeSession(view, originId);
        retained.push(view);
      }
      if (!changed) continue;
      next.views = retained;
      if (next.activeViewId && !retained.some(function (view) { return view.id === next.activeViewId; })) next.activeViewId = null;
      next.revision++;
      next.views.forEach(function (view) { view.revision = next.revision; });
      try {
        var replacement = documentForOwner(next, source.ownerId);
        save(replacement);
        document = replacement;
        changedOwners.push(source.ownerId);
      } catch (error) { failures.push({ ownerId: source.ownerId, error: error.message || String(error) }); }
    }
    return { owners: changedOwners, failures: failures };
  }
  var organization = require('./project-split-view-organization').attachOrganization({ prepare: prepareRecord, commit: commit, state: state });
  function organize(ownerId, linuxUser, input) {
    var prepared = prepareRecord(ownerId, linuxUser, input.expectedRevision);
    if (!prepared.ok) return prepared;
    var view = prepared.record.views.find(function (item) { return item.id === input.id; });
    var checked = checkInput(input, slug, ownerId, !!(view && view.workspace), view);
    return checked.ok ? organization.organize(ownerId, linuxUser, input) : checked;
  }
  return { organize: organize, reconcileFolders: organization.reconcileFolders, state: state, create: create, update: update, rename: rename, separate: separate, move: move, removeOrigin: removeOrigin,
    get filePath() { return filePath; }, get loadError() { return loadError; } };
}
module.exports = { createSplitViewsStore: createSplitViewsStore };
