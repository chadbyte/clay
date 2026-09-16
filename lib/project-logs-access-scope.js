// Authorization and record scoping for a Project Logs binding. Worktree-only
// principals share storage with the parent but never inherit its ledger view.

function attachProjectLogsAccessScope(ctx) {
  var projectFor = ctx.projectFor;
  var isMultiUser = ctx.isMultiUser;
  var canAccessProject = ctx.canAccessProject;
  var hasFullProjectAccess = ctx.hasFullProjectAccess;
  var openStore = ctx.openStore;

  function effectiveStatus(status) {
    if (!status || status.isWorktree !== true || !status.parentSlug) return status;
    var parent = projectFor(status.parentSlug);
    if (!parent) return status;
    return parent.getStatus() || status;
  }

  function ownsProject(principal, status) {
    if (!status) return false;
    if (isMultiUser()) return !!principal.userId && status.projectOwnerId === principal.userId;
    return !status.projectOwnerId || (!!principal.singleUserOwnerId && status.projectOwnerId === principal.singleUserOwnerId);
  }

  function projectAuthorization(principal, status) {
    var denied = { allowed: false, worktreeOnly: false };
    if (!status || status.isMate === true) return denied;
    var governing = effectiveStatus(status);
    if (ownsProject(principal, governing)) return { allowed: true, worktreeOnly: false };
    if (!isMultiUser() || !principal.userId || typeof canAccessProject !== "function") return denied;
    if (canAccessProject(principal.userId, status) !== true) return denied;
    var full = status.isWorktree !== true;
    if (!full && typeof hasFullProjectAccess === "function") {
      full = hasFullProjectAccess(principal.userId, status) === true;
    }
    return { allowed: true, worktreeOnly: !full };
  }

  function authorizedProject(principal, status) {
    return projectAuthorization(principal, status).allowed === true;
  }

  function storeForStatus(status) {
    var governing = effectiveStatus(status);
    if (!governing || !governing.path) throw new Error("Project Logs are unavailable for this project.");
    return openStore(governing.path, { projectKnowledgeId: governing.projectKnowledgeId || null });
  }

  function recordContext(status) {
    if (!status || status.isWorktree !== true || !status.changeSetId) return null;
    return {
      kind: "worktree",
      changeSetId: status.changeSetId,
      branch: status.branch || null,
      baseCommit: status.baseCommit || null,
      headCommit: status.headCommit || null,
      status: "active",
    };
  }

  function scopedArgs(args, status, worktreeOnly) {
    var out = Object.assign({}, args || {});
    if (worktreeOnly) {
      out.contextMode = "current";
      out.exactChangeSet = true;
    } else if (!out.contextMode) {
      out.contextMode = status && status.isWorktree ? "current" : "project";
    }
    out.currentChangeSetId = status && status.changeSetId || null;
    return out;
  }

  function visibleEntry(store, ref, status, worktreeOnly) {
    var entry = store.read(ref, false);
    if (!entry) throw new Error("Log entry not found.");
    if (worktreeOnly) {
      var changeSetId = entry.context && entry.context.changeSetId;
      if (!changeSetId || changeSetId !== status.changeSetId) throw new Error("Log entry not found.");
    }
    return entry;
  }

  return {
    effectiveStatus: effectiveStatus,
    ownsProject: ownsProject,
    projectAuthorization: projectAuthorization,
    authorizedProject: authorizedProject,
    storeForStatus: storeForStatus,
    recordContext: recordContext,
    scopedArgs: scopedArgs,
    visibleEntry: visibleEntry,
  };
}

module.exports = { attachProjectLogsAccessScope: attachProjectLogsAccessScope };
