// Authorization and binding layer for Project Logs.
//
// Modeled on workspace-query-service.js: a caller never states who it is.
// Every binder re-derives the principal from authoritative server state and
// returns null when anything fails to line up, so an unbound or stale caller
// gets no capability rather than a degraded one.
//
// Product rules enforced here:
//   - Project Logs are project records. Mate projects have none.
//   - Ordinary Mates cannot reach project Logs at all.
//   - Authoritative builtin Clay may read Logs, and only for projects the
//     owning user is authorized to see. It may never write.
//   - A project session is bound to exactly its own project's Logs.
//   - Canonical authorship belongs to Project Driver sessions alone. A human,
//     however privileged, may read and comment but may never create or revise
//     a canonical entry. The project owner may delete an entry.
//   - Members of a shared project read each other's entries and comments with
//     attribution.
//   - A worktree resolves to its parent project for both authorization and
//     storage, so worktree work never forks project knowledge.

var builtinMates = require("./builtin-mates");
var logsStore = require("./project-logs-store");
var attachProjectLogsAccessScope = require("./project-logs-access-scope").attachProjectLogsAccessScope;
var LOG_REF_PATTERN = /^log:[A-Za-z0-9_-]{24}$/;

function readOnly() {
  throw new Error("Project Logs are read-only for builtin Clay.");
}

// Canonical entries are written by the project's own agent sessions. A human
// participates by commenting, which is a separate, append-only surface.
function agentOnly() {
  throw new Error("Project Logs are written by this project's agent sessions. Add a comment instead.");
}

// Reviewing feedback and moving the record between revisions are the Driver's
// judgement calls. A human cannot review their own comment into the record,
// and Clay cannot review another project's.
function driverOnly() {
  throw new Error("Only this project's agent sessions can review feedback or change revisions.");
}

function ownerOnly() {
  throw new Error("Only the project owner can delete Project Logs.");
}

// Bounded discovery of comments still waiting on the Driver. The store owns the
// one-pass scan over every live entry, so nothing here imposes a ceiling that
// could hide a pending comment on an older record.
function attachProjectLogsService(ctx) {
  var context = ctx || {};
  var getProjects = context.getProjects;
  var isMultiUser = context.isMultiUser;
  var resolveMate = context.resolveMate;
  var findUserById = context.findUserById || function () { return null; };
  var storeCache = new Map();

  var openStore = context.openStore || function (cwd, storeOptions) {
    var options = storeOptions || {};
    var key = options.projectKnowledgeId || cwd;
    if (!storeCache.has(key)) {
      storeCache.set(key, logsStore.createProjectLogsStore({
        cwd: cwd,
        baseDir: context.baseDir,
        projectKnowledgeId: options.projectKnowledgeId || null,
      }));
    }
    return storeCache.get(key);
  };

  function projectFor(slug) {
    if (!slug || typeof slug !== "string") return null;
    var projects = getProjects();
    return (projects && projects.get(slug)) || null;
  }

  var logScope = attachProjectLogsAccessScope({
    projectFor: projectFor,
    isMultiUser: isMultiUser,
    canAccessProject: context.canAccessProject,
    hasFullProjectAccess: context.hasFullProjectAccess,
    openStore: openStore,
  });
  var effectiveStatus = logScope.effectiveStatus;
  var ownsProject = logScope.ownsProject;
  var projectAuthorization = logScope.projectAuthorization;
  var authorizedProject = logScope.authorizedProject;
  var storeForStatus = logScope.storeForStatus;
  var recordContext = logScope.recordContext;
  var scopedArgs = logScope.scopedArgs;
  var visibleEntry = logScope.visibleEntry;

  function statusFor(principal, slug) {
    var project = projectFor(slug);
    if (!project) throw new Error("Project not found.");
    var status = project.getStatus();
    if (!authorizedProject(principal, status)) throw new Error("Project Logs are not available for this project.");
    return status;
  }

  function displayNameFor(userId) {
    if (!userId) return null;
    var user = findUserById(userId);
    if (!user) return null;
    return user.displayName || user.username || null;
  }

  function sessionAuthor(session) {
    return {
      type: "session",
      userId: session.ownerId || null,
      displayName: displayNameFor(session.ownerId),
      sessionKey: session.cliSessionId || "local:" + session.localId,
      vendor: session.vendor || null,
    };
  }

  function userAuthor(user) {
    return {
      type: "user",
      userId: (user && user.id) || null,
      displayName: (user && (user.displayName || user.username)) || null,
      sessionKey: null,
      vendor: null,
    };
  }

  // --- Binders ---------------------------------------------------------

  // Exact session object identity, not a caller-supplied session id. A session
  // handed in from a stale or forged reference is rejected even when its
  // localId matches a live session.
  function resolveProjectSession(source) {
    if (!source || !source.projectSlug || !source.session) return null;
    var project = projectFor(source.projectSlug);
    if (!project) return null;
    var status = project.getStatus();
    if (!status || status.isMate === true) return null;
    var manager = project.getSessionManager ? project.getSessionManager() : project.sm;
    if (!manager || !manager.sessions || manager.sessions.get(source.session.localId) !== source.session) return null;

    var principal;
    if (isMultiUser()) {
      // Fail closed: an unattributed session in multi-user mode gets nothing.
      if (!source.session.ownerId) return null;
      principal = { userId: source.session.ownerId, singleUserOwnerId: null };
    } else {
      if (source.session.ownerId && status.projectOwnerId && source.session.ownerId !== status.projectOwnerId) return null;
      principal = { userId: null, singleUserOwnerId: source.session.ownerId || status.projectOwnerId || null };
    }
    if (!authorizedProject(principal, status)) return null;

    principal.kind = "session";
    principal.projectSlug = source.projectSlug;
    principal.isClay = false;
    return { principal: principal, status: status, author: sessionAuthor(source.session) };
  }

  // A tool handler captured earlier stays valid only while its exact source
  // still resolves. Session identity and project authorization are both
  // re-derived on every call, so a session dropped from the manager, or
  // replaced by a different object with the same id, loses the capability
  // immediately rather than continuing to work through a captured handler.
  function bindProjectSession(source) {
    var initial = resolveProjectSession(source);
    if (!initial) return null;
    function revalidate() {
      var current = resolveProjectSession(source);
      if (!current || current.principal.projectSlug !== initial.principal.projectSlug) {
        throw new Error("This Project Logs binding is no longer valid for the current session.");
      }
      return current;
    }
    return createProjectBound(initial, revalidate);
  }

  function bindUser(source) {
    if (!source || !source.projectSlug) return null;
    var project = projectFor(source.projectSlug);
    if (!project) return null;
    var status = project.getStatus();
    if (!status || status.isMate === true) return null;
    var user = source.user || null;

    var principal;
    if (isMultiUser()) {
      if (!user || !user.id) return null;
      principal = { userId: user.id, singleUserOwnerId: null };
    } else {
      principal = { userId: null, singleUserOwnerId: (user && user.id) || status.projectOwnerId || null };
    }
    if (!authorizedProject(principal, status)) return null;

    principal.kind = "user";
    principal.projectSlug = source.projectSlug;
    principal.isClay = false;
    principal.isProjectOwner = ownsProject(principal, status);
    var envelope = { principal: principal, status: status, author: userAuthor(user) };
    return createProjectBound(envelope, function () { return envelope; });
  }

  // Ordinary Mates get null. Only the authoritative builtin Clay host agent,
  // confirmed against the server Mate registry rather than a project flag,
  // receives a read-only cross-project binding.
  function resolveMateSource(source) {
    if (!source || source.isMate !== true || !source.mateId || typeof resolveMate !== "function") return null;
    var sourceProject = projectFor(source.projectSlug);
    if (!sourceProject) return null;
    var sourceStatus = sourceProject.getStatus();
    if (!sourceStatus || sourceStatus.isMate !== true) return null;
    if (sourceStatus.mateId !== source.mateId || sourceStatus.projectOwnerId !== source.projectOwnerId) return null;
    if (source.session) {
      var manager = sourceProject.getSessionManager ? sourceProject.getSessionManager() : sourceProject.sm;
      if (!manager || !manager.sessions || manager.sessions.get(source.session.localId) !== source.session) return null;
    }
    var mate = resolveMate(source.projectOwnerId || null, source.mateId);
    if (!mate || mate.id !== source.mateId) return null;
    if (isMultiUser() && (!source.projectOwnerId || mate.createdBy !== source.projectOwnerId)) return null;

    var def = mate.builtinKey ? builtinMates.getBuiltinByKey(mate.builtinKey) : null;
    var isClay = !!(mate.builtinKey === "clay" && def && def.hostAgent === true);
    if (!isClay) return null;
    if (isMultiUser() && !source.projectOwnerId) return null;

    return {
      kind: "clay",
      userId: isMultiUser() ? source.projectOwnerId : null,
      singleUserOwnerId: isMultiUser() ? null : (source.projectOwnerId || null),
      projectSlug: null,
      mateId: mate.id,
      isClay: true,
    };
  }

  // Clay keeps its authoritative registry and user authorization checks on
  // every call, so a Mate that is deleted, demoted out of builtin Clay, or
  // reassigned to another user loses the read view immediately.
  function bindMate(source) {
    var initial = resolveMateSource(source);
    if (!initial) return null;
    function revalidate() {
      var current = resolveMateSource(source);
      if (!current || current.mateId !== initial.mateId || current.userId !== initial.userId) {
        throw new Error("This Project Logs binding is no longer valid for the current session.");
      }
      return current;
    }
    return createClayBound(revalidate);
  }

  // --- Bound capability surfaces ---------------------------------------

  function createProjectBound(initial, revalidate) {
    var store = storeForStatus(initial.status);

    // Identity, authorization, and the target store are all re-derived per
    // call. revalidate() re-checks exact session identity where there is one;
    // the project authorization check then catches a visibility change.
    function live() {
      var current = revalidate();
      var project = projectFor(current.principal.projectSlug);
      if (!project) throw new Error("Project not found.");
      var currentStatus = project.getStatus();
      if (!authorizedProject(current.principal, currentStatus)) throw new Error("Project Logs are not available for this project.");
      return storeForStatus(currentStatus);
    }

    function author() {
      return revalidate().author;
    }

    function currentStatus() {
      var current = revalidate();
      var project = projectFor(current.principal.projectSlug);
      if (!project) throw new Error("Project not found.");
      return project.getStatus();
    }

    function currentScope() {
      var current = revalidate();
      var project = projectFor(current.principal.projectSlug);
      var status = project && project.getStatus();
      var decision = projectAuthorization(current.principal, status);
      if (!decision.allowed) throw new Error("Project Logs are not available for this project.");
      return { status: status, worktreeOnly: decision.worktreeOnly };
    }

    function scopedEntry(args) {
      var scope = currentScope();
      return visibleEntry(live(), args && args.ref, scope.status, scope.worktreeOnly);
    }

    function mutationContext() {
      return recordContext(currentStatus());
    }

    // A session may write canonically; a user may only comment. The capability
    // is decided by the binder that produced this envelope, never by a flag on
    // the request.
    var canonical = initial.principal.kind === "session";
    var canDelete = canonical || initial.principal.isProjectOwner === true;
    return {
      isClay: false,
      canWrite: canonical,
      canComment: true,
      canDelete: canDelete,
      projectSlug: initial.principal.projectSlug,
      scopeId: store.scopeId,
      root: store.root,
      author: initial.author,
      listLogs: function (args) {
        var scope = currentScope();
        var status = scope.status;
        var options = scopedArgs(args, status, scope.worktreeOnly);
        var result = live().list(options);
        result.contextMode = options.contextMode;
        result.currentChangeSetId = status.changeSetId || null;
        result.isWorktree = status.isWorktree === true;
        return result;
      },
      searchLogs: function (args) {
        var scope = currentScope();
        var status = scope.status;
        var options = scopedArgs(args, status, scope.worktreeOnly);
        var result = live().search(options);
        result.contextMode = options.contextMode;
        result.currentChangeSetId = status.changeSetId || null;
        result.isWorktree = status.isWorktree === true;
        return result;
      },
      readLog: function (args) {
        return scopedEntry(args);
      },
      logHistory: function (args) { scopedEntry(args); return live().history(args && args.ref, args || {}); },
      commentLog: function (args) { scopedEntry(args); return live().comment(args && args.ref, args || {}, author(), mutationContext()); },
      readLogRevision: function (args) { scopedEntry(args); return live().readRevision(args && args.ref, args && args.revision); },
      listLogFeedback: canonical ? function (args) {
        var scope = currentScope();
        return live().feedback(scopedArgs(args, scope.status, scope.worktreeOnly));
      } : driverOnly,
      reviewLogComment: canonical ? function (args) { scopedEntry(args); return live().review(args && args.ref, args || {}, author(), mutationContext()); } : driverOnly,
      revertLog: canonical
        ? function (args) { scopedEntry(args); return live().revert(args && args.ref, args && args.revision, args && args.reason, author(), mutationContext()); }
        : driverOnly,
      createLog: canonical ? function (args) { return live().create(args || {}, author(), mutationContext()); } : agentOnly,
      updateLog: canonical ? function (args) { scopedEntry(args); return live().update(args && args.ref, args || {}, author(), mutationContext()); } : agentOnly,
      linkLog: canonical ? function (args) { scopedEntry(args); return live().link(args && args.ref, args && args.links, author(), mutationContext()); } : agentOnly,
      removeLog: canDelete ? function (args) {
        var current = revalidate();
        var project = projectFor(current.principal.projectSlug);
        var currentStatus = project && project.getStatus();
        if (!project || !authorizedProject(current.principal, currentStatus)) {
          throw new Error("Project Logs are not available for this project.");
        }
        visibleEntry(storeForStatus(currentStatus), args && args.ref, currentStatus, projectAuthorization(current.principal, currentStatus).worktreeOnly);
        if (current.principal.kind !== "session" && !ownsProject(current.principal, currentStatus)) ownerOnly();
        return storeForStatus(currentStatus).remove(args && args.ref, current.author, recordContext(currentStatus));
      } : ownerOnly,
    };
  }

  function setContextState(projectSlug, status) {
    var project = projectFor(projectSlug);
    var projectStatus = project && project.getStatus();
    if (!projectStatus || !projectStatus.isWorktree || !projectStatus.changeSetId) return false;
    return storeForStatus(projectStatus).setContextState(recordContext(projectStatus), status);
  }

  function createClayBound(revalidate) {
    function target(args) {
      var principal = revalidate();
      var slug = args && args.projectSlug;
      if (!slug) throw new Error("An exact project slug is required.");
      var status = statusFor(principal, slug);
      var decision = projectAuthorization(principal, status);
      return { store: storeForStatus(status), status: status, worktreeOnly: decision.worktreeOnly };
    }

    function targetEntry(args) {
      var selected = target(args);
      return {
        selected: selected,
        entry: visibleEntry(selected.store, args && args.ref, selected.status, selected.worktreeOnly),
      };
    }

    function resolveLogNavigation(args) {
      var principal = revalidate();
      var ref = args && args.ref;
      if (!LOG_REF_PATTERN.test(ref || "")) throw new Error("Invalid log reference.");
      var projects = getProjects();
      var seenScopes = new Set();
      var match = null;
      if (!projects || typeof projects.forEach !== "function") throw new Error("Project Logs are unavailable.");
      projects.forEach(function (project, slug) {
        if (!project || typeof project.getStatus !== "function") return;
        var status = project.getStatus();
        var decision = projectAuthorization(principal, status);
        if (!decision.allowed) return;
        var governing = effectiveStatus(status);
        var scope = governing && (governing.projectKnowledgeId || governing.path);
        var scopeKey = decision.worktreeOnly ? scope + ":" + (status.changeSetId || slug) : scope;
        if (!scope || seenScopes.has(scopeKey)) return;
        seenScopes.add(scopeKey);
        var entry = null;
        try { entry = visibleEntry(storeForStatus(status), ref, status, decision.worktreeOnly); } catch (e) { return; }
        if (!entry) return;
        var targetSlug = decision.worktreeOnly
          ? slug
          : (status.isWorktree && status.parentSlug && projectFor(status.parentSlug) ? status.parentSlug : slug);
        if (match && match.projectSlug !== targetSlug) throw new Error("Log reference is ambiguous.");
        match = { projectSlug: targetSlug, ref: ref };
      });
      if (!match) throw new Error("Log entry not found.");
      return match;
    }

    return {
      isClay: true,
      canWrite: false,
      canComment: false,
      canDelete: false,
      projectSlug: null,
      author: null,
      listLogs: function (args) {
        var selected = target(args);
        return selected.store.list(scopedArgs(args, selected.status, selected.worktreeOnly));
      },
      searchLogs: function (args) {
        var selected = target(args);
        return selected.store.search(scopedArgs(args, selected.status, selected.worktreeOnly));
      },
      readLog: function (args) {
        return targetEntry(args).entry;
      },
      logHistory: function (args) {
        var selected = targetEntry(args).selected;
        return selected.store.history(args && args.ref, args || {});
      },
      commentLog: readOnly,
      readLogRevision: function (args) {
        var selected = targetEntry(args).selected;
        return selected.store.readRevision(args && args.ref, args && args.revision);
      },
      resolveLogNavigation: resolveLogNavigation,
      listLogFeedback: readOnly,
      reviewLogComment: readOnly,
      revertLog: readOnly,
      createLog: readOnly,
      updateLog: readOnly,
      linkLog: readOnly,
      removeLog: readOnly,
    };
  }

  return {
    bindProjectSession: bindProjectSession,
    bindUser: bindUser,
    bindMate: bindMate,
    setContextState: setContextState,
  };
}

module.exports = { attachProjectLogsService: attachProjectLogsService };
