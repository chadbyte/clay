// Authoritative project access for workspace queries.
//
// getStatus() reports slug, path, title, and owner, but carries no visibility
// and no allowedUsers. Rebuilding an access record from it therefore defaults
// every project to public, and users-permissions treats a record with no
// visibility as public, which authorizes any authenticated user against any
// project. Access is resolved here from the record onGetProjectAccess()
// returns, and every failure path denies.
//
// The record is re-read on every evaluation rather than captured at bind time,
// so a project turning private, changing owner, or dropping a user from
// allowedUsers takes effect on that caller's next query.

function attachWorkspaceQueryAccess(deps) {
  var settings = deps || {};
  var isMultiUser = settings.isMultiUser;
  var resolveMate = settings.resolveMate;
  var onGetProjectAccess = settings.onGetProjectAccess;
  var canAccessProject = settings.canAccessProject;

  // The authoritative record for a project, or null. A missing slug, a missing
  // resolver, a throwing resolver, a non-record return, and an error record all
  // resolve to null, which denies.
  function record(status) {
    if (!status || typeof status.slug !== "string" || !status.slug) return null;
    if (typeof onGetProjectAccess !== "function") return null;
    var access;
    try {
      access = onGetProjectAccess(status.slug);
    } catch (e) {
      return null;
    }
    if (!access || typeof access !== "object" || Array.isArray(access)) return null;
    if (access.error) return null;
    return access;
  }

  // The permission predicate is only ever consulted with a real record, and
  // anything other than an explicit true denies.
  function permitted(userId, access) {
    if (!userId || !access) return false;
    if (typeof canAccessProject !== "function") return false;
    try {
      return canAccessProject(userId, access) === true;
    } catch (e) {
      return false;
    }
  }

  // Single-user ownership. There are no visibility rules and no access records
  // to consult in this mode, so the project's own owner field is authoritative.
  // Unchanged from the behaviour this module replaced.
  function ownsSingleUser(principal, status) {
    if (!status.projectOwnerId) return true;
    return !!principal.singleUserOwnerId && status.projectOwnerId === principal.singleUserOwnerId;
  }

  // A Mate project belongs to whoever the Mate registry says created the Mate.
  //
  // This is not a convenience: Mate projects are registered directly on the
  // running server and are never written to the persisted project list, so
  // onGetProjectAccess() has no record for them at all. The registry is the
  // authority for Mate ownership, and resolveMate is already scoped to the
  // asking user, so this path can only ever grant a Mate its own project.
  function ownsMateProject(principal, status) {
    if (!status || status.isMate !== true || !status.mateId) return false;
    if (!principal.userId || typeof resolveMate !== "function") return false;
    var mate;
    try {
      mate = resolveMate(principal.userId, status.mateId);
    } catch (e) {
      return false;
    }
    if (!mate || mate.id !== status.mateId) return false;
    return !!mate.createdBy && mate.createdBy === principal.userId;
  }

  // `accessible` decides whether the container is visible at all; `owned`
  // drives the separate rule that an accessible container holding no session of
  // the caller's own is omitted. Exact worktree grants are resolved from their
  // own authoritative access record rather than inferred from the parent.
  function evaluate(principal, status) {
    var denied = { owned: false, accessible: false };
    if (!principal || !status) return denied;
    if (typeof isMultiUser !== "function" || !isMultiUser()) {
      var owned = ownsSingleUser(principal, status);
      return { owned: owned, accessible: owned };
    }
    if (!principal.userId) return denied;
    if (ownsMateProject(principal, status)) return { owned: true, accessible: true };
    // status.projectOwnerId is never trusted on its own in multi-user mode: it
    // is a snapshot that can outlive a transfer or a revocation, so treating it
    // as ownership would let a stale status skip the authoritative record.
    var access = record(status);
    if (!access) return denied;
    if (access.ownerId && access.ownerId === principal.userId) return { owned: true, accessible: true };
    return { owned: false, accessible: permitted(principal.userId, access) };
  }

  return { evaluate: evaluate, getProjectAccess: record };
}

module.exports = { attachWorkspaceQueryAccess: attachWorkspaceQueryAccess };
