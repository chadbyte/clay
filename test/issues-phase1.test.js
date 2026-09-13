var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var execFileSync = require("node:child_process").execFileSync;
var test = require("node:test");

var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-issues-home-"));
process.env.CLAY_HOME = home;
process.env.CLAY_DEV = "";

var temporaryPaths = [home];

function temporary(prefix) {
  var result = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  temporaryPaths.push(result);
  return result;
}

test.after(function () {
  for (var i = 0; i < temporaryPaths.length; i++) fs.rmSync(temporaryPaths[i], { recursive: true, force: true });
});

var issueStore = require("../lib/issues-store");
var issueService = require("../lib/issues-service").attachIssuesService;
var verifier = require("../lib/issues-commit-verification");
var logsStore = require("../lib/project-logs-store");

function repository() {
  var root = temporary("clay-issues-repo-");
  function git(args) { return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim(); }
  git(["init", "-q"]);
  git(["config", "user.email", "issues@example.com"]);
  git(["config", "user.name", "Issues Test"]);
  fs.writeFileSync(path.join(root, "app.js"), "var value = 1;\n");
  git(["add", "app.js"]);
  git(["commit", "-qm", "test: initialize issue repository"]);
  var sha = git(["rev-parse", "HEAD"]);
  return { root: root, sha: sha };
}

function store() {
  return issueStore.createIssuesStore({ projectKnowledgeId: "pk_issues", baseDir: temporary("clay-issues-records-") });
}

function author() { return { type: "user", userId: "u1", displayName: "User One" }; }

test("Issues use a separate namespace and preserve revisions across reload", function () {
  var dir = temporary("clay-issues-store-");
  var first = issueStore.createIssuesStore({ projectKnowledgeId: "pk_issues", baseDir: dir });
  var created = first.create({ title: "Crash", summary: "Fails on launch", body: "Details", type: "bug" }, author());
  assert.match(first.scopeId, /^project\/pk_issues\/issues$/);
  assert.match(created.ref, /^issue:[A-Za-z0-9_-]{24}$/);
  assert.equal(created.revision, 1);
  assert.equal(first.list({}).issues[0].body, undefined);
  var updated = first.update(created.ref, { status: "in_progress", summary: "Investigating" }, 1, author());
  assert.equal(updated.revision, 2);
  var reopened = issueStore.createIssuesStore({ projectKnowledgeId: "pk_issues", baseDir: dir });
  assert.equal(reopened.read(created.ref).revision, 2);
  assert.equal(reopened.history(created.ref).revisions.length, 2);
  assert.equal(reopened.readRevision(created.ref, 1).summary, "Fails on launch");
});

test("Issues and Project Logs use isolated append-only namespaces", function () {
  var baseDir = temporary("clay-issues-isolated-");
  var issues = issueStore.createIssuesStore({ projectKnowledgeId: "pk_shared", baseDir: baseDir });
  var logs = logsStore.createProjectLogsStore({ root: "/srv/shared", projectKnowledgeId: "pk_shared", baseDir: baseDir });
  issues.create({ title: "Issue record", summary: "Only an issue" }, author());
  logs.create({ title: "Log record", summary: "Only a log", kind: "progress" }, author());
  assert.equal(issues.scopeId, "project/pk_shared/issues");
  assert.equal(logs.scopeId, "project/pk_shared");
  assert.notEqual(issues.filePath, logs.filePath);
  assert.equal(issues.list({}).total, 1);
  assert.equal(logs.list({}).total, 1);
});

test("Issues reject stale revisions and support bounded filters", function () {
  var current = store();
  var issue = current.create({ title: "Feature", summary: "Add it", type: "feature", priority: "important" }, author());
  assert.throws(function () { current.update(issue.ref, { summary: "stale" }, 0, author()); }, /conflict/);
  assert.equal(current.read(issue.ref).summary, "Add it");
  current.create({ title: "Plan", summary: "Plan it", type: "plan", status: "open" }, author());
  assert.equal(current.list({ type: "feature" }).total, 1);
  assert.equal(current.list({ status: "open", limit: 1 }).issues.length, 1);
  assert.throws(function () { current.list({ type: "nope" }); }, /Invalid issue type/);
  assert.throws(function () { current.create({ title: "Null status", status: null }, author()); }, /Invalid status/);
});

test("Issue incorporation validates before one append and replays its review", function () {
  var directory = temporary("clay-issues-incorporate-");
  var current = issueStore.createIssuesStore({ projectKnowledgeId: "pk_issues", baseDir: directory });
  var entry = current.create({ title: "Before", summary: "Context" }, author());
  var comment = current.comment(entry.ref, "Please improve this.", { type: "user", userId: "u2", displayName: "Reviewer" });
  var commentId = comment.comments[0].id;
  var beforeRecords = current.records.all().length;
  assert.throws(function () {
    current.incorporate(entry.ref, commentId, { title: "After" }, 1, "x".repeat(4001), author());
  }, /response exceeds 4000/);
  assert.equal(current.read(entry.ref).revision, 1);
  assert.equal(current.read(entry.ref).comments[0].status, "pending");
  assert.equal(current.records.all().length, beforeRecords);
  var incorporated = current.incorporate(entry.ref, commentId, { title: "After" }, 1, "Accepted.", author());
  assert.equal(incorporated.revision, 2);
  assert.equal(incorporated.title, "After");
  assert.equal(incorporated.comments[0].status, "incorporated");
  assert.equal(current.records.all().length, beforeRecords + 1);
  var secondComment = current.comment(entry.ref, "No actual change.", { type: "user", userId: "u2", displayName: "Reviewer" });
  assert.throws(function () { current.incorporate(entry.ref, secondComment.comments[1].id, { title: "After" }, 2, "No-op", author()); }, /must change/);
  var reopened = issueStore.createIssuesStore({ projectKnowledgeId: "pk_issues", baseDir: directory });
  assert.equal(reopened.read(entry.ref).title, "After");
  assert.equal(reopened.read(entry.ref).comments[0].status, "incorporated");
});

test("resolution requires verified commit evidence and reopen retains history", async function () {
  var repo = repository();
  var current = store();
  var evidence = await verifier.verifyCommit(repo.root, repo.sha, "pk_issues");
  var issue = current.create({ title: "Fix", summary: "Fixed", resolutionSummary: "Fixed and verified", status: "resolved" }, author(), null, evidence);
  assert.equal(issue.verifiedCommit.sha, repo.sha);
  var reopened = current.update(issue.ref, { status: "open" }, 1, author());
  assert.equal(reopened.status, "open");
  assert.equal(reopened.verifiedCommit, undefined);
  assert.equal(reopened.resolutionHistory.length, 1);
  assert.throws(function () { current.create({ title: "Bad", summary: "No proof", status: "resolved" }, author()); }, /verified commit/);
  var closed = current.update(issue.ref, { status: "closed", closeReason: "duplicate" }, 2, author());
  assert.equal(closed.closeReason, "duplicate");
});

test("context is immutable, body is searchable, and history reports exact changed fields", function () {
  var current = store();
  var context = { kind: "worktree", changeSetId: "cs-1", branch: "feature/issues" };
  var issue = current.create({ title: "Search", summary: "Short", body: "needle only in analysis" }, author(), context);
  var updated = current.update(issue.ref, { context: null, body: "revised body" }, 1, author());
  assert.deepEqual(updated.context, context);
  assert.equal(current.search({ query: "revised body" }).total, 1);
  assert.deepEqual(current.history(issue.ref).revisions[1].changed, ["body"]);
});

test("every resolution stores fresh full commit evidence and reopen clears only current evidence", async function () {
  var repo = repository();
  var current = store();
  var proof = await verifier.verifyCommit(repo.root, repo.sha, "pk_issues");
  var issue = current.create({ title: "Repeat", summary: "Tracking", resolutionSummary: "First fix", status: "resolved" }, author(), null, proof);
  var open = current.update(issue.ref, { status: "open" }, 1, author());
  assert.equal(open.resolutionSummary, "");
  assert.equal(open.verifiedCommit, undefined);
  assert.equal(open.resolutionHistory.length, 1);
  var resolved = current.update(issue.ref, { status: "resolved", resolutionSummary: "Second fix" }, 2, author(), null, proof);
  assert.equal(resolved.resolutionHistory.length, 2);
  assert.equal(resolved.resolutionHistory[1].verifiedCommit.sha, repo.sha);
  assert.throws(function () {
    current.update(issue.ref, { status: "resolved", resolutionSummary: "No new proof" }, 3, author());
  }, /verified commit/);
  assert.throws(function () {
    current.create({ title: "Fallback forbidden", summary: "Must not become resolution", status: "resolved" }, author(), null, proof);
  }, /resolutionSummary|summary/);
});

function fixture(options) {
  var user = { id: "u1", displayName: "User One" };
  var owner = { id: "owner", displayName: "Project Owner" };
  var session = Object.assign({ localId: 1, ownerId: "u1", cliSessionId: "cli-1", sessionProvenance: null }, options && options.session || {});
  var status = Object.assign({ slug: "app", path: "/tmp/app", projectKnowledgeId: "pk_issues", projectOwnerId: "owner", isMate: false, isWorktree: false }, options && options.status || {});
  var sessions = new Map([[session.localId, session]]);
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return { sessions: sessions }; } };
  var projects = new Map([[status.slug, project]]);
  var currentUser = user;
  var service = issueService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    findUserById: function (id) { if (id === owner.id) return owner; return currentUser && id === currentUser.id ? currentUser : null; },
    canAccessProject: function (id) { return id === "u1"; },
    hasFullProjectAccess: function () { return false; },
    baseDir: temporary("clay-issues-service-"),
    verifyCommit: function () { return Promise.resolve({ sha: "a".repeat(40), subject: "test: verified", verifiedAt: Date.now(), repository: "pk_issues" }); },
  });
  return { service: service, session: session, project: project, status: status, users: { user: user, revoke: function () { currentUser = null; } }, projects: projects };
}

test("service revalidates users, sessions, workers, and worktree scope", async function () {
  var f = fixture({ status: { projectOwnerId: "u1" } });
  var userBound = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  assert.ok(userBound);
  var created = await userBound.createIssue({ title: "Driver issue", summary: "Visible" });
  assert.equal(userBound.readIssue({ ref: created.ref }).title, "Driver issue");
  f.users.revoke();
  assert.throws(function () { userBound.listIssues({}); }, /no longer valid/);

  var g = fixture({ status: { projectOwnerId: "u1" } });
  var bound = g.service.bindProjectSession({ projectSlug: "app", session: g.session });
  assert.ok(bound);
  g.session.sessionProvenance = { kind: "worker" };
  assert.throws(function () { bound.listIssues({}); }, /no longer valid/);

  var h = fixture({ status: { projectOwnerId: "owner", isWorktree: true, parentSlug: "app", changeSetId: "cs-1" } });
  var worktreeBound = h.service.bindProjectSession({ projectSlug: "app", session: h.session });
  assert.ok(worktreeBound, "an authorized exact worktree member may bind");
  h.session.sessionProvenance = { kind: "worker" };
  assert.throws(function () { worktreeBound.listIssues({}); }, /no longer valid/);

  var mate = fixture({ status: { isMate: true } });
  assert.equal(mate.service.bindUser({ projectSlug: "app", userId: "u1" }), null);
});

test("commit verification rejects malformed, short, non-commit, and out-of-repository inputs", async function () {
  var repo = repository();
  await assert.rejects(verifier.verifyCommit(repo.root, "not-a-sha", "pk_issues"), /7 to 64/);
  var short = await verifier.verifyCommit(repo.root, repo.sha.substring(0, 7), "pk_issues");
  assert.equal(short.sha, repo.sha);
  var blob = execFileSync("git", ["hash-object", "-w", "--stdin"], { cwd: repo.root, input: "blob", encoding: "utf8" }).trim();
  await assert.rejects(verifier.verifyCommit(repo.root, blob, "pk_issues"), /Command failed/);
  var other = repository();
  fs.writeFileSync(path.join(other.root, "other.js"), "var other = true;\n");
  execFileSync("git", ["add", "other.js"] , { cwd: other.root });
  execFileSync("git", ["commit", "-qm", "test: make repository distinct"], { cwd: other.root });
  other.sha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: other.root, encoding: "utf8" }).trim();
  await assert.rejects(verifier.verifyCommit(repo.root, other.sha, "pk_issues"), /Command failed/);
  var valid = await verifier.verifyCommit(repo.root, repo.sha, "pk_issues");
  assert.equal(valid.sha, repo.sha);
  assert.equal(valid.subject, "test: initialize issue repository");
  assert.equal(valid.repository, "pk_issues");
});

test("awaited commit verification rechecks authorization and conflicts before append", async function () {
  var gateResolve;
  var gate = new Promise(function (resolve) { gateResolve = resolve; });
  var f = fixture({ status: { projectOwnerId: "u1" } });
  var bound = f.service.bindUser({ projectSlug: "app", userId: "u1" });
  var original = bound;
  var delayed = issueService({
    getProjects: function () { return f.projects; }, isMultiUser: function () { return true; },
    findUserById: function () { return f.users.user; }, canAccessProject: function (id) { return id === "u1" && f.status.projectOwnerId === "u1"; },
    baseDir: temporary("clay-issues-await-"),
    verifyCommit: function () { return gate.then(function () { return { sha: "b".repeat(40), subject: "test: delayed", verifiedAt: Date.now(), repository: "pk_issues" }; }); },
  }).bindProjectSession({ projectSlug: "app", session: f.session });
  var pending = delayed.createIssue({ title: "Awaited", summary: "Pending", resolutionSummary: "Verified fix", status: "resolved", commitSha: "abcdef0" });
  f.status.projectOwnerId = "revoked-owner";
  gateResolve();
  await assert.rejects(pending, /no longer valid/);

  var g = fixture({ status: { projectOwnerId: "u1" } });
  var gBound = g.service.bindProjectSession({ projectSlug: "app", session: g.session });
  var created = await gBound.createIssue({ title: "Conflict", summary: "Original" });
  var first = gBound.updateIssue({ ref: created.ref, expectedRevision: 1, summary: "Changed", status: "in_progress" });
  await first;
  assert.throws(function () {
    gBound.updateIssue({ ref: created.ref, expectedRevision: 1, summary: "Concurrent", status: "in_progress" });
  }, /conflict|revision/i);
});

test("parent and restricted worktree bindings share storage but filter before totals and paging", async function () {
  var owner = { id: "owner", displayName: "Owner" };
  var member = { id: "u1", displayName: "Member" };
  var parentStatus = { slug: "app", path: "/tmp/app", projectKnowledgeId: "pk_parent", projectOwnerId: "owner", isMate: false, isWorktree: false };
  var firstStatus = { slug: "app-wt-1", path: "/tmp/app-wt-1", projectKnowledgeId: "pk_child_1", projectOwnerId: "owner", isMate: false, isWorktree: true, parentSlug: "app", changeSetId: "cs-1" };
  var secondStatus = { slug: "app-wt-2", path: "/tmp/app-wt-2", projectKnowledgeId: "pk_child_2", projectOwnerId: "owner", isMate: false, isWorktree: true, parentSlug: "app", changeSetId: "cs-2" };
  var parentSession = { localId: 1, ownerId: "owner" };
  var firstSession = { localId: 2, ownerId: "u1" };
  var secondSession = { localId: 3, ownerId: "u1" };
  function project(status, session) { var sessions = new Map([[session.localId, session]]); return { getStatus: function () { return status; }, getSessionManager: function () { return { sessions: sessions }; } }; }
  var projects = new Map([["app", project(parentStatus, parentSession)], ["app-wt-1", project(firstStatus, firstSession)], ["app-wt-2", project(secondStatus, secondSession)]]);
  var service = issueService({
    getProjects: function () { return projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "owner" ? owner : id === "u1" ? member : null; },
    canAccessProject: function (id) { return id === "u1"; }, hasFullProjectAccess: function () { return false; },
    baseDir: temporary("clay-issues-scopes-"),
  });
  var parent = service.bindProjectSession({ projectSlug: "app", session: parentSession });
  var first = service.bindProjectSession({ projectSlug: "app-wt-1", session: firstSession });
  var second = service.bindProjectSession({ projectSlug: "app-wt-2", session: secondSession });
  assert.equal(parent.scopeId, "project/pk_parent/issues");
  assert.equal(first.scopeId, parent.scopeId);
  var parentIssue = await parent.createIssue({ title: "Parent", summary: "Project wide" });
  var firstIssue = await first.createIssue({ title: "First", summary: "First change set" });
  await second.createIssue({ title: "Second", summary: "Second change set" });
  assert.equal(parent.listIssues({}).total, 3);
  var restricted = first.listIssues({ limit: 1 });
  assert.equal(restricted.total, 1);
  assert.equal(restricted.issues[0].ref, firstIssue.ref);
  assert.equal(restricted.nextCursor, null);
  assert.throws(function () { first.readIssue({ ref: parentIssue.ref }); }, /not found/i);
  var updated = await first.updateIssue({ ref: firstIssue.ref, expectedRevision: 1, status: "in_progress" });
  assert.equal(updated.context.changeSetId, "cs-1");
  var missing = Object.assign({}, firstStatus, { slug: "missing", changeSetId: null });
  projects.set("missing", project(missing, firstSession));
  assert.equal(service.bindUser({ projectSlug: "missing", userId: "u1" }), null);
});

test("public mutations reject forged fields, stale revisions, and invisible refs before Git", async function () {
  var calls = 0;
  var f = fixture({ status: { projectOwnerId: "u1" } });
  var service = issueService({
    getProjects: function () { return f.projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? f.users.user : null; },
    canAccessProject: function () { return true; }, baseDir: temporary("clay-issues-forged-"),
    verifyCommit: function () { calls++; return Promise.resolve({ sha: "c".repeat(40), subject: "fix: valid proof", verifiedAt: Date.now(), repository: "pk_issues" }); },
  });
  var bound = service.bindProjectSession({ projectSlug: "app", session: f.session });
  var issue = await bound.createIssue({ title: "Protected", summary: "Original" });
  var forbidden = ["context", "verifiedCommit", "resolutionHistory", "linkedWorkSessions", "visibility"];
  for (var i = 0; i < forbidden.length; i++) {
    var args = { ref: issue.ref, expectedRevision: 1, status: "resolved", resolutionSummary: "Done", commitSha: "abcdef0" };
    args[forbidden[i]] = forbidden[i] === "linkedWorkSessions" || forbidden[i] === "resolutionHistory" ? [] : {};
    assert.throws(function (value) { return function () { bound.updateIssue(value); }; }(args), /server-owned|Unknown/);
  }
  assert.throws(function () {
    bound.updateIssue({ ref: "issue:" + "z".repeat(24), expectedRevision: 1, status: "resolved", resolutionSummary: "Done", commitSha: "abcdef0" });
  }, /not found/i);
  assert.throws(function () {
    bound.updateIssue({ ref: issue.ref, expectedRevision: 0, status: "resolved", resolutionSummary: "Done", commitSha: "abcdef0" });
  }, /conflict/i);
  assert.equal(calls, 0);

  var wrongProof = issueService({
    getProjects: function () { return f.projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? f.users.user : null; }, canAccessProject: function () { return true; },
    baseDir: temporary("clay-issues-wrong-proof-"),
    verifyCommit: function () { return { sha: "c".repeat(40), subject: "fix: wrong repository", verifiedAt: Date.now(), repository: "pk_other" }; },
  }).bindProjectSession({ projectSlug: "app", session: f.session });
  await assert.rejects(wrongProof.createIssue({ title: "Wrong proof", summary: "Denied", resolutionSummary: "Done", status: "resolved", commitSha: "abcdef0" }), /different repository/);
  assert.equal(wrongProof.listIssues({}).total, 0);
});

test("bindings retain exact project and session identity and deny malformed or unknown owners", function () {
  var f = fixture({ status: { projectOwnerId: "u1" } });
  var source = { projectSlug: "app", session: f.session };
  var bound = f.service.bindProjectSession(source);
  assert.ok(bound);
  source.projectSlug = "elsewhere";
  source.session = { localId: 99, ownerId: "u1" };
  assert.equal(bound.listIssues({}).total, 0);
  f.session.ownerId = "owner";
  assert.throws(function () { bound.listIssues({}); }, /no longer valid/);

  var replacement = fixture({ status: { projectOwnerId: "u1" } });
  var replacementBound = replacement.service.bindUser({ projectSlug: "app", userId: "u1" });
  replacement.projects.set("app", { getStatus: function () { return replacement.status; } });
  assert.throws(function () { replacementBound.listIssues({}); }, /no longer valid/);

  var malformedProject = { getStatus: function () { return null; } };
  var unknownStatus = { slug: "unknown", path: "/tmp/unknown", projectKnowledgeId: "pk_unknown", projectOwnerId: "ghost", isMate: false };
  var unknownProject = { getStatus: function () { return unknownStatus; } };
  var projects = new Map([["malformed", malformedProject], ["unknown", unknownProject]]);
  var service = issueService({ getProjects: function () { return projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? { id: "u1" } : null; }, canAccessProject: function () { return true; } });
  assert.equal(service.bindUser({ projectSlug: "malformed", userId: "u1" }), null);
  assert.equal(service.bindUser({ projectSlug: "unknown", userId: "u1" }), null);

  var worktreeStatus = { slug: "wt", path: "/tmp/wt", projectKnowledgeId: "pk_wt", projectOwnerId: "u1", isMate: false, isWorktree: true, parentSlug: "broken-parent", changeSetId: "cs-1" };
  projects.set("wt", { getStatus: function () { return worktreeStatus; } });
  projects.set("broken-parent", { getStatus: function () { throw new Error("broken status"); } });
  assert.equal(service.bindUser({ projectSlug: "wt", userId: "u1" }), null);
});

test("single-user ownerless bindings work and OS-user policy is evaluated live", async function () {
  var status = { slug: "solo", path: "/tmp/solo", projectKnowledgeId: "pk_solo", projectOwnerId: null, isMate: false, isWorktree: false };
  var session = { localId: 1, ownerId: null };
  var sessions = new Map([[session.localId, session]]);
  var project = { getStatus: function () { return status; }, getSessionManager: function () { return { sessions: sessions }; } };
  var enabled = false;
  var seenIdentity = "unset";
  var service = issueService({
    getProjects: function () { return new Map([["solo", project]]); }, isMultiUser: function () { return false; },
    osUsersEnabled: function () { return enabled; }, baseDir: temporary("clay-issues-single-"),
    verifyCommit: function (cwd, sha, identity, osIdentity) {
      seenIdentity = osIdentity;
      return Promise.resolve({ sha: "d".repeat(40), subject: "fix: ownerless", verifiedAt: Date.now(), repository: identity });
    },
  });
  var bound = service.bindProjectSession({ projectSlug: "solo", session: session });
  assert.ok(bound);
  await bound.createIssue({ title: "Ownerless", summary: "Single user", resolutionSummary: "Done", status: "resolved", commitSha: "abcdef0" });
  assert.equal(seenIdentity, null);
  enabled = true;
  assert.throws(function () {
    bound.createIssue({ title: "Needs OS", summary: "Denied", resolutionSummary: "Done", status: "resolved", commitSha: "abcdef0" });
  }, /OS identity/);
});

test("deferred verification snapshots actor and args and rejects in-place authorization changes", async function () {
  var gateResolve;
  var gate = new Promise(function (resolve) { gateResolve = resolve; });
  var f = fixture({ status: { projectOwnerId: "u1" } });
  var service = issueService({
    getProjects: function () { return f.projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? f.users.user : null; }, canAccessProject: function () { return true; },
    baseDir: temporary("clay-issues-snapshot-"),
    verifyCommit: function () { return gate.then(function () { return { sha: "e".repeat(40), subject: "fix: deferred", verifiedAt: Date.now(), repository: "pk_issues" }; }); },
  });
  var bound = service.bindProjectSession({ projectSlug: "app", session: f.session });
  var args = { title: "Snapshot", summary: "Before", resolutionSummary: "Original resolution", status: "resolved", commitSha: "abcdef0" };
  var pending = bound.createIssue(args);
  f.users.user.displayName = "Mutated Name";
  args.title = "Mutated title";
  args.resolutionSummary = "Mutated resolution";
  gateResolve();
  var created = await pending;
  assert.equal(created.title, "Snapshot");
  assert.equal(created.resolutionSummary, "Original resolution");
  assert.equal(created.createdBy.displayName, "User One");

  var secondResolve;
  var secondGate = new Promise(function (resolve) { secondResolve = resolve; });
  var second = fixture({ status: { projectOwnerId: "u1" } });
  var secondService = issueService({
    getProjects: function () { return second.projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? second.users.user : null; }, canAccessProject: function () { return true; },
    baseDir: temporary("clay-issues-inplace-"),
    verifyCommit: function () { return secondGate.then(function () { return { sha: "f".repeat(40), subject: "fix: changed auth", verifiedAt: Date.now(), repository: "pk_issues" }; }); },
  });
  var secondBound = secondService.bindProjectSession({ projectSlug: "app", session: second.session });
  var denied = secondBound.createIssue({ title: "Denied", summary: "Pending", resolutionSummary: "Done", status: "resolved", commitSha: "abcdef0" });
  second.status.path = "/tmp/retargeted";
  secondResolve();
  await assert.rejects(denied, /authorization changed/);
  assert.equal(secondBound.listIssues({}).total, 0);
});

test("deferred update verification rejects user revocation and exact project replacement", async function () {
  async function run(change) {
    var release;
    var gate = new Promise(function (resolve) { release = resolve; });
    var f = fixture({ status: { projectOwnerId: "u1" } });
    var liveUser = f.users.user;
    var baseDir = temporary("clay-issues-deferred-update-");
    var service = issueService({
      getProjects: function () { return f.projects; }, isMultiUser: function () { return true; },
      findUserById: function (id) { return id === "u1" ? liveUser : null; }, canAccessProject: function () { return true; },
      baseDir: baseDir,
      verifyCommit: function () { return gate.then(function () { return { sha: "1".repeat(40), subject: "fix: delayed update", verifiedAt: Date.now(), repository: "pk_issues" }; }); },
    });
    var bound = service.bindProjectSession({ projectSlug: "app", session: f.session });
    var issue = await bound.createIssue({ title: "Update target", summary: "Open" });
    var args = { ref: issue.ref, expectedRevision: 1, status: "resolved", resolutionSummary: "Finished", commitSha: "abcdef0" };
    var pending = bound.updateIssue(args);
    args.ref = "issue:" + "q".repeat(24);
    args.expectedRevision = 99;
    change(f, function () { liveUser = null; });
    release();
    await assert.rejects(pending, /no longer valid|authorization changed/);
    var raw = issueStore.createIssuesStore({ projectKnowledgeId: "pk_issues", baseDir: baseDir });
    assert.equal(raw.read(issue.ref).revision, 1);
  }

  await run(function (f, revoke) { revoke(); });
  await run(function (f) {
    f.projects.set("app", { getStatus: function () { return f.status; } });
  });
});

test("deferred verification rejects an in-place OS identity mutation", async function () {
  var release;
  var gate = new Promise(function (resolve) { release = resolve; });
  var identity = { uid: 501, gid: 20, user: "user-one", home: "/tmp/user-one" };
  var f = fixture({ status: { projectOwnerId: "u1" } });
  var service = issueService({
    getProjects: function () { return f.projects; }, isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "u1" ? f.users.user : null; }, canAccessProject: function () { return true; },
    osUsersEnabled: true, getOsUserInfoForActor: function () { return identity; },
    baseDir: temporary("clay-issues-os-mutation-"),
    verifyCommit: function () { return gate.then(function () { return { sha: "2".repeat(40), subject: "fix: OS mutation", verifiedAt: Date.now(), repository: "pk_issues" }; }); },
  });
  var bound = service.bindProjectSession({ projectSlug: "app", session: f.session });
  var pending = bound.createIssue({ title: "OS mutation", summary: "Pending", resolutionSummary: "Done", status: "resolved", commitSha: "abcdef0" });
  identity.uid = 502;
  release();
  await assert.rejects(pending, /authorization changed/);
  assert.equal(bound.listIssues({}).total, 0);
});

test("a storage append failure does not advance the visible issue", function () {
  var current = store();
  var issue = current.create({ title: "Stable", summary: "Before failure" }, author());
  var originalAppend = current.records.append;
  current.records.append = function () { throw new Error("storage unavailable"); };
  assert.throws(function () { current.update(issue.ref, { summary: "After failure" }, 1, author()); }, /storage unavailable/);
  current.records.append = originalAppend;
  assert.equal(current.read(issue.ref).revision, 1);
  assert.equal(current.read(issue.ref).summary, "Before failure");
});
