// Authorization and capability bindings for the Phase 1 Issues backend.

var issuesStore = require("./issues-store");
var schema = require("./issues-schema");
var provenance = require("./session-provenance");
var commitVerification = require("./issues-commit-verification");
var accessScope = require("./project-logs-access-scope").attachProjectLogsAccessScope;

var PUBLIC_FIELDS = { title: true, summary: true, body: true, resolutionSummary: true,
  type: true, priority: true, status: true, closeReason: true };

function clone(value) { return value == null ? value : JSON.parse(JSON.stringify(value)); }

function attachIssuesService(ctx) {
  var context = ctx || {};
  var projects = context.getProjects;
  var multiUser = context.isMultiUser || function () { return false; };
  var findUserById = context.findUserById || function () { return null; };
  var stores = new Map();
  var verify = commitVerification.injectedVerifier(context.verifyCommit);
  var scope;

  function projectFor(slug) {
    var list = typeof projects === "function" ? projects() : null;
    return typeof slug === "string" && list && typeof list.get === "function" ? list.get(slug) || null : null;
  }

  function statusFor(project) {
    var status;
    if (!project || typeof project.getStatus !== "function") return null;
    try { status = project.getStatus(); } catch (e) { return null; }
    if (!status || typeof status !== "object" || Array.isArray(status)) return null;
    if (typeof status.slug !== "string" || !status.slug || typeof status.path !== "string" || !status.path) return null;
    if (typeof status.projectKnowledgeId !== "string" || !status.projectKnowledgeId) return null;
    if (status.projectOwnerId != null && typeof status.projectOwnerId !== "string") return null;
    if (status.isWorktree === true && (typeof status.changeSetId !== "string" || !status.changeSetId || typeof status.parentSlug !== "string" || !status.parentSlug)) return null;
    return status;
  }

  function governingStatus(status) {
    if (!status || status.isWorktree !== true) return status;
    return statusFor(projectFor(status.parentSlug));
  }

  function ownerKnown(status) {
    return !multiUser() || !!status.projectOwnerId && !!findUserById(status.projectOwnerId);
  }

  function openStore(status) {
    var governing = governingStatus(status);
    if (!governing || !governing.path || !governing.projectKnowledgeId) throw new Error("Issues are unavailable for this project.");
    var key = governing.projectKnowledgeId;
    if (!stores.has(key)) stores.set(key, issuesStore.createIssuesStore({ projectKnowledgeId: key, baseDir: context.baseDir }));
    return stores.get(key);
  }

  function issueContext(status) {
    if (!status || status.isWorktree !== true || !status.changeSetId) return null;
    return { kind: "worktree", changeSetId: status.changeSetId, branch: status.branch || null,
      baseCommit: status.baseCommit || null, headCommit: status.headCommit || null };
  }

  function author(user, type, session) {
    return { type: type, userId: user ? user.id || null : null,
      displayName: user && (user.displayName || user.username) || null,
      sessionKey: session ? session.cliSessionId || "local:" + session.localId : null,
      sessionOriginId: session ? session.sessionOriginId || null : null,
      vendor: session ? session.vendor || null : null, at: Date.now() };
  }

  function cleanPublic(input, controls, allowCloseReason) {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new Error("Issue arguments are required.");
    var keys = Object.keys(input);
    var result = {};
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      if (Object.prototype.hasOwnProperty.call(controls, key)) continue;
      if (!Object.prototype.hasOwnProperty.call(PUBLIC_FIELDS, key) || (key === "closeReason" && !allowCloseReason)) throw new Error("Unknown or server-owned issue field: " + key + ".");
      result[key] = input[key];
    }
    return result;
  }

  function osUsersEnabled() {
    return typeof context.osUsersEnabled === "function" ? context.osUsersEnabled() === true : context.osUsersEnabled === true;
  }

  function osIdentity(state) {
    if (!osUsersEnabled()) return null;
    var identity = typeof context.getOsUserInfoForActor === "function" ? context.getOsUserInfoForActor(state.user) : null;
    if (!identity || typeof identity !== "object") throw new Error("An OS identity is required for commit verification.");
    return clone(identity);
  }

  scope = accessScope({ projectFor: projectFor, isMultiUser: multiUser,
    canAccessProject: context.canAccessProject, hasFullProjectAccess: context.hasFullProjectAccess,
    openStore: function () { return null; } });

  function bindingState(project, session, userId, originId) {
    var status = statusFor(project);
    if (!status || status.isMate === true) return null;
    var governing = governingStatus(status);
    if (!governing || !ownerKnown(governing)) return null;
    var user = null;
    if (multiUser()) {
      if (!userId || !(user = findUserById(userId))) return null;
    } else {
      user = userId ? findUserById(userId) : null;
      if (!user) user = { id: userId || status.projectOwnerId || null };
    }
    if (session) {
      var manager = project.getSessionManager ? project.getSessionManager() : project.sm;
      if (!manager || !manager.sessions || manager.sessions.get(session.localId) !== session) return null;
      if ((session.ownerId || null) !== (userId || null) || (session.sessionOriginId || null) !== originId) return null;
      if (multiUser() && !session.ownerId) return null;
      if (provenance.isWorker(session) || session.hidden === true || session.delegated === true || session._pairDelegation || session._delegatedBy) return null;
    }
    var principal = multiUser() ? { userId: user.id, singleUserOwnerId: null }
      : { userId: null, singleUserOwnerId: user.id || status.projectOwnerId || null };
    var authorization;
    try { authorization = scope.projectAuthorization(principal, status); } catch (e) { return null; }
    if (!authorization.allowed || (authorization.worktreeOnly && !status.changeSetId)) return null;
    principal.isProjectOwner = scope.ownsProject(principal, governing);
    return { project: project, status: status, session: session, user: user,
      principal: principal, worktreeOnly: authorization.worktreeOnly };
  }

  function bind(source, isSession) {
    if (!source || typeof source.projectSlug !== "string") return null;
    var initialSlug = source.projectSlug;
    var initialProject = projectFor(initialSlug);
    var initialSession = isSession ? source.session : null;
    if (!initialProject || (isSession && !initialSession)) return null;
    if (initialSession) provenance.ensureOrigin(initialSession);
    var initialUserId = initialSession ? initialSession.ownerId || null : source.userId || null;
    var initialOrigin = initialSession ? initialSession.sessionOriginId || null : null;
    var initial = bindingState(initialProject, initialSession, initialUserId, initialOrigin);
    if (!initial) return null;

    function current() {
      if (projectFor(initialSlug) !== initialProject) throw new Error("This Issues binding is no longer valid.");
      var live = bindingState(initialProject, initialSession, initialUserId, initialOrigin);
      if (!live) throw new Error("This Issues binding is no longer valid.");
      return live;
    }

    function visibleIssue(store, ref, state) {
      var result = store.read(ref);
      if (state.worktreeOnly && (!result.context || result.context.changeSetId !== state.status.changeSetId)) throw new Error("Issue not found.");
      return result;
    }
    function scopedIssue(store, ref, state) {
      var result = store.read(ref, true);
      if (state.worktreeOnly && (!result.context || result.context.changeSetId !== state.status.changeSetId)) throw new Error("Issue not found.");
      return result;
    }

    function scopedOptions(state, args) {
      var result = Object.assign({}, args || {});
      if (state.worktreeOnly) {
        if (!state.status.changeSetId) throw new Error("Issues are unavailable without a change set.");
        result.changeSetId = state.status.changeSetId;
      }
      return result;
    }

    function operation(state, needsIdentity) {
      var governing = governingStatus(state.status);
      return { project: state.project, session: state.session, userId: state.user.id || null,
        path: state.status.path, knowledgeId: governing.projectKnowledgeId,
        changeSetId: state.status.changeSetId || null, worktreeOnly: state.worktreeOnly,
        recordContext: clone(issueContext(state.status)),
        actor: clone(author(state.user, state.session ? "session" : "user", state.session)),
        osIdentity: needsIdentity ? osIdentity(state) : null };
    }

    function recheck(before, needsIdentity) {
      var fresh = current();
      var governing = governingStatus(fresh.status);
      var liveIdentity = needsIdentity ? osIdentity(fresh) : null;
      if (fresh.project !== before.project || fresh.session !== before.session || (fresh.user.id || null) !== before.userId ||
          fresh.status.path !== before.path || !governing || governing.projectKnowledgeId !== before.knowledgeId ||
          (fresh.status.changeSetId || null) !== before.changeSetId || fresh.worktreeOnly !== before.worktreeOnly ||
          JSON.stringify(liveIdentity) !== JSON.stringify(before.osIdentity)) throw new Error("Issue authorization changed during the operation.");
      return fresh;
    }

    function evidence(before, sha) {
      return verify(before.path, sha, before.knowledgeId, before.osIdentity).then(function (proof) {
        var normalized = schema.normalizeVerifiedCommit(proof);
        if (normalized.repository !== before.knowledgeId) throw new Error("Verified commit evidence belongs to a different repository.");
        return normalized;
      });
    }

    return {
      linkWorkSession: function (args, session) {
        var state = current();
        var manager = state.project.getSessionManager();
        if (!args || !Number.isInteger(args.expectedRevision)) throw new Error("expectedRevision is required.");
        if (!session || manager.sessions.get(session.localId) !== session || provenance.isWorker(session) || session.hidden === true ||
            session.delegated === true || session._pairDelegation || session._delegatedBy ||
            (session.ownerId || null) !== (state.user.id || null)) throw new Error("Invalid work session.");
        provenance.ensureOrigin(session);
        var target = openStore(state.status);
        var entry = visibleIssue(target, args.ref, state);
        if (entry.revision !== args.expectedRevision) throw new Error("Issue revision conflict.");
        if (entry.status === "resolved" || entry.status === "closed") throw new Error("Reopen this issue before starting work.");
        var links = entry.linkedWorkSessions || [];
        if (links.some(function (link) { return link.sessionId === session.sessionOriginId; })) return entry;
        var link = { sessionId: session.sessionOriginId, role: "driver", issueRevision: args.expectedRevision };
        if (args.requestId !== undefined) link.requestId = schema.text(args.requestId, "work request id", 200, true);
        return target.update(args.ref, { linkedWorkSessions: links.concat([link]), status: "in_progress" }, args.expectedRevision, author(state.user, "user", null));
      },
      resolveWorkSession: function (args) {
        var state = current();
        var entry = visibleIssue(openStore(state.status), args.ref, state);
        if (!(entry.linkedWorkSessions || []).some(function (link) { return link.sessionId === args.sessionOriginId; })) throw new Error("Work session unavailable.");
        var found = null;
        state.project.getSessionManager().sessions.forEach(function (session) {
          if (session.sessionOriginId === args.sessionOriginId && (session.ownerId || null) === (state.user.id || null) &&
              !provenance.isWorker(session) && session.hidden !== true && session.delegated !== true && !session._pairDelegation && !session._delegatedBy) found = session;
        });
        if (!found) throw new Error("Work session unavailable.");
        return found;
      },
      scopeId: "project/" + governingStatus(initial.status).projectKnowledgeId + "/issues",
      canComment: true,
      canDelete: initial.principal.isProjectOwner === true,
      listIssues: function (args) { var state = current(); return openStore(state.status).list(scopedOptions(state, args)); },
      searchIssues: function (args) { var state = current(); return openStore(state.status).search(scopedOptions(state, args)); },
      readIssue: function (args) { var state = current(); return visibleIssue(openStore(state.status), args && args.ref, state); },
      readIssueTombstone: function (args) { var state = current(); return scopedIssue(openStore(state.status), args && args.ref, state); },
      issueHistory: function (args) { var state = current(); var store = openStore(state.status); var history = store.history(args && args.ref); if (state.worktreeOnly) { var historical = scopedIssue(store, args && args.ref, state); if (!historical.context || historical.context.changeSetId !== state.status.changeSetId) throw new Error("Issue not found."); } return history; },
      readIssueRevision: function (args) { var state = current(); var store = openStore(state.status); visibleIssue(store, args && args.ref, state); return store.readRevision(args.ref, args.revision); },
      commentIssue: function (args) { var state = current(); var target = openStore(state.status); visibleIssue(target, args && args.ref, state); return target.comment(args.ref, args.body, author(state.user, "user", null)); },
      listIssueFeedback: function (args) {
        if (!isSession) throw new Error("Only the Project Driver can review issue comments.");
        var state = current(); var target = openStore(state.status); var out = []; var feedbackLimit = args && args.limit === undefined ? 200 : Number(args.limit);
        if (!Number.isInteger(feedbackLimit) || feedbackLimit < 1 || feedbackLimit > 200) throw new Error("Feedback limit must be between 1 and 200.");
        var position = { issueCursor: null, issueIndex: 0, commentOffset: 0 };
        if (args && args.cursor) {
          try {
            if (/^\d+$/.test(String(args.cursor))) position.issueCursor = String(args.cursor);
            else position = JSON.parse(Buffer.from(String(args.cursor), "base64url").toString("utf8"));
          } catch (e) { throw new Error("Invalid issue feedback cursor."); }
          if (!position || (position.issueCursor !== null && typeof position.issueCursor !== "string") || !Number.isInteger(position.issueIndex) || position.issueIndex < 0 || !Number.isInteger(position.commentOffset) || position.commentOffset < 0) throw new Error("Invalid issue feedback cursor.");
        }
        var nextCursor = null; var scanned = 0;
        while (out.length < feedbackLimit && scanned < 500) {
          var result = target.list(scopedOptions(state, { limit: 50, cursor: position.issueCursor }));
          if (!result.issues.length) break;
          scanned += result.issues.length;
          var firstIssueIndex = position.issueIndex;
          if (firstIssueIndex >= result.issues.length) throw new Error("Invalid issue feedback cursor.");
          for (var i = firstIssueIndex; i < result.issues.length && out.length < feedbackLimit; i++) {
            var entry = visibleIssue(target, result.issues[i].ref, state);
            var waiting = (entry.comments || []).filter(function (item) { return item.status === "pending"; });
            var start = i === position.issueIndex ? position.commentOffset : 0;
            var j = start;
            for (; j < waiting.length && out.length < feedbackLimit; j++) out.push({ ref: entry.ref, title: entry.title, commentId: waiting[j].id, body: waiting[j].body, author: waiting[j].author, at: waiting[j].at });
            if (out.length >= feedbackLimit) {
              if (j < waiting.length) nextCursor = Buffer.from(JSON.stringify({ issueCursor: position.issueCursor, issueIndex: i, commentOffset: j })).toString("base64url");
              else if (i + 1 < result.issues.length) nextCursor = Buffer.from(JSON.stringify({ issueCursor: position.issueCursor, issueIndex: i + 1, commentOffset: 0 })).toString("base64url");
              else if (result.nextCursor) nextCursor = Buffer.from(JSON.stringify({ issueCursor: result.nextCursor, issueIndex: 0, commentOffset: 0 })).toString("base64url");
            }
          }
          if (nextCursor || !result.nextCursor) break;
          if (scanned >= 500) {
            nextCursor = Buffer.from(JSON.stringify({ issueCursor: result.nextCursor, issueIndex: 0, commentOffset: 0 })).toString("base64url");
            break;
          }
          position.issueCursor = result.nextCursor; position.issueIndex = 0; position.commentOffset = 0;
        }
        return { feedback: out, total: out.length, nextCursor: nextCursor, truncated: !!nextCursor };
      },
      reviewIssueComment: function (args) {
        if (!isSession) throw new Error("Only the Project Driver can review issue comments.");
        var state = current(); var target = openStore(state.status); var entry = visibleIssue(target, args && args.ref, state);
        if (args.action === "incorporate") {
          if (!Number.isInteger(args.expectedRevision)) throw new Error("expectedRevision is required to incorporate a comment.");
          var data = cleanPublic(args, { ref: true, expectedRevision: true, commentId: true, action: true, response: true, commitSha: true }, true);
          if (data.status === "resolved") throw new Error("Use update_issue with verified commit evidence before resolving this Issue.");
          return target.incorporate(entry.ref, args.commentId, data, args.expectedRevision, args.response, author(state.user, "session", state.session));
        }
        return target.review(entry.ref, args.commentId, args.action, args.response, author(state.user, "session", state.session));
      },
      removeIssue: function (args) {
        var state = current();
        if (!state.principal.isProjectOwner) throw new Error("Only the project owner can delete Issues.");
        var target = openStore(state.status); var entry = visibleIssue(target, args && args.ref, state);
        if (!Number.isInteger(args && args.expectedRevision) || entry.revision !== args.expectedRevision) throw new Error("Issue revision conflict.");
        return target.remove(entry.ref, author(state.user, "user", null), args.expectedRevision);
      },
      createIssue: function (args) {
        if (!isSession) throw new Error("People cannot create issues directly. Ask the Project Driver to create one.");
        var data = cleanPublic(args, { commitSha: true }, true);
        var status = data.status === undefined ? "open" : data.status;
        if (schema.STATUSES.indexOf(status) === -1) throw new Error("Invalid status.");
        var state = current();
        if (status !== "resolved") return Promise.resolve(openStore(state.status).create(data,
          author(state.user, state.session ? "session" : "user", state.session), issueContext(state.status)));
        if (typeof data.resolutionSummary !== "string" || !data.resolutionSummary.trim()) throw new Error("resolutionSummary is required when resolving an issue.");
        var before = operation(state, true);
        return evidence(before, args.commitSha).then(function (proof) {
          var after = recheck(before, true);
          return openStore(after.status).create(data, before.actor, before.recordContext, proof);
        });
      },
      updateIssue: function (args) {
        var data = cleanPublic(args, { ref: true, expectedRevision: true, commitSha: true }, true);
        if (!Number.isInteger(args.expectedRevision)) throw new Error("expectedRevision is required.");
        if (data.status !== undefined && schema.STATUSES.indexOf(data.status) === -1) throw new Error("Invalid status.");
        var ref = args.ref;
        var expectedRevision = args.expectedRevision;
        var state = current();
        var target = openStore(state.status);
        var existing = visibleIssue(target, ref, state);
        if (existing.revision !== expectedRevision) throw new Error("Issue revision conflict.");
        if (data.status !== "resolved") return Promise.resolve(target.update(ref, data, expectedRevision,
          author(state.user, state.session ? "session" : "user", state.session)));
        if (typeof data.resolutionSummary !== "string" || !data.resolutionSummary.trim()) throw new Error("resolutionSummary is required when resolving an issue.");
        var before = operation(state, true);
        return evidence(before, args.commitSha).then(function (proof) {
          var after = recheck(before, true);
          var afterStore = openStore(after.status);
          visibleIssue(afterStore, ref, after);
          return afterStore.update(ref, data, expectedRevision, before.actor, null, proof);
        });
      },
    };
  }

  return { bindUser: function (source) { return bind(source, false); },
    bindProjectSession: function (source) { return bind(source, true); },
    issueScopeIdForKnowledgeId: issuesStore.issueScopeIdForKnowledgeId };
}

module.exports = { attachIssuesService: attachIssuesService };
