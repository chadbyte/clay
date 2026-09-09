var test = require("node:test");
var assert = require("node:assert/strict");
var attachWorkspaceQueryService = require("../lib/workspace-query-service").attachWorkspaceQueryService;
var clayHistory = require("../lib/clay-history-mcp-server");
var workspaceMcp = require("../lib/workspace-query-mcp-server");
var canonicalTurns = require("../lib/workspace-query-service").canonicalTurns;
var attachPermissions = require("../lib/users-permissions").attachPermissions;

// The real RBAC predicate, so tests exercise the actual rule that a record
// carrying no visibility field is treated as public.
var permissions = attachPermissions({
  loadUsers: function () { return { users: [] }; },
  saveUsers: function () {},
  findUserById: function (userId) { return userId === "admin-user" ? { id: "admin-user", role: "admin" } : { id: userId, role: "user" }; },
});

function project(slug, ownerId, sessions, extra) {
  var status = Object.assign({ slug: slug, projectOwnerId: ownerId, title: slug + "\nTitle", icon: "icon\u0000" }, extra || {});
  return {
    getStatus: function () { return status; },
    getSessionManager: function () { return { sessions: new Map(sessions.map(function (session) { return [session.localId, session]; })) }; },
  };
}

function multiUserFixture() {
  var projects = new Map();
  var owned = {
    localId: 11, cliSessionId: "runtime-secret-id", ownerId: "user-a", title: "Owned\nSession\u0000",
    vendor: "claude\nforged", model: "sonnet\u0000", createdAt: 10, lastActivity: 20,
    history: [
      { type: "user_message", text: "Canonical planning request" },
      { type: "tool_executing", input: { path: "/private/path", token: "TOOL_SECRET" } },
      { type: "tool_result", text: "TOOL_RESULT_SECRET" },
      { type: "user_message", text: "HIDDEN_SECRET", hidden: true },
      { type: "user_message", text: "INTERNAL_SECRET", _internal: true },
      { type: "delta", text: "Canonical assistant answer" },
      { type: "result" },
    ],
  };
  var other = { localId: 12, ownerId: "user-b", sessionVisibility: "shared", title: "Other user", history: [{ type: "user_message", text: "OTHER_SECRET" }] };
  var legacy = { localId: 13, ownerId: null, title: "Legacy", history: [{ type: "user_message", text: "LEGACY_SECRET" }] };
  projects.set("owned", project("owned", "user-a", [owned, other, legacy], { visibility: "public" }));
  projects.set("other-public", project("other-public", "user-b", [{ localId: 21, ownerId: "user-b", title: "Public other", history: [{ type: "user_message", text: "PUBLIC_SECRET" }] }], { visibility: "public" }));
  projects.set("other-shared", project("other-shared", "user-b", [{ localId: 22, ownerId: "user-b", title: "Shared other", history: [] }], { allowedUsers: ["user-a"] }));
  projects.set("public-container", project("public-container", null, [
    { localId: 23, ownerId: "user-a", title: "Project work", lastActivity: 15, history: [{ type: "user_message", text: "PROJECT_SESSION_MATCH" }] },
    { localId: 24, ownerId: "user-b", title: "Foreign project work", history: [{ type: "user_message", text: "FOREIGN_PROJECT_SECRET" }] },
  ], { visibility: "public" }));
  projects.set("worktree", project("worktree", "user-a", [{ localId: 31, ownerId: "user-a", history: [] }], { isWorktree: true }));
  projects.set("mate-a", project("mate-a", "user-a", [{ localId: 41, ownerId: "user-a", title: "Clay source", history: [] }], { isMate: true, mateId: "clay-a" }));
  projects.set("mate-custom", project("mate-custom", "user-a", [{ localId: 42, ownerId: "user-a", title: "Custom source", history: [] }], { isMate: true, mateId: "custom-a" }));
  // The authoritative project records. Mate projects are deliberately absent:
  // in production they are registered on the running server and never written
  // to the persisted project list, so no record exists for them.
  var accessRecords = {
    "owned": { slug: "owned", visibility: "public", ownerId: "user-a", allowedUsers: [] },
    "other-public": { slug: "other-public", visibility: "public", ownerId: "user-b", allowedUsers: [] },
    "other-shared": { slug: "other-shared", visibility: "private", ownerId: "user-b", allowedUsers: ["user-a"] },
    "public-container": { slug: "public-container", visibility: "public", ownerId: null, allowedUsers: [] },
    "worktree": { slug: "worktree", visibility: "public", ownerId: "user-a", allowedUsers: [] },
  };
  var mates = {
    "user-a:clay-a": { id: "clay-a", createdBy: "user-a", builtinKey: "clay" },
    "user-a:custom-a": { id: "custom-a", createdBy: "user-a" },
    "user-b:clay-a": { id: "clay-a", createdBy: "user-b", builtinKey: "clay" },
  };
  var assignmentCalls = [];
  var service = attachWorkspaceQueryService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    onGetProjectAccess: function (slug) { return accessRecords[slug] || { error: "Project not found" }; },
    canAccessProject: function (userId, access) { return permissions.canAccessProject(userId, access); },
    resolveMate: function (userId, mateId) { return mates[userId + ":" + mateId] || null; },
    assignmentService: {
      propose: function (principal, args) { assignmentCalls.push({ method: "new", principal: principal, args: args }); return { assignmentId: "new" }; },
      proposeFollowUp: function (principal, args) { assignmentCalls.push({ method: "follow_up", principal: principal, args: args }); return { assignmentId: "follow" }; },
      getStatus: function () { return { status: "proposed" }; },
    },
  });
  var bound = service.bindSource({ projectSlug: "mate-a", projectOwnerId: "user-a", isMate: true, mateId: "clay-a", session: projects.get("mate-a").getSessionManager().sessions.get(41) });
  return { service: service, bound: bound, owned: owned, assignmentCalls: assignmentCalls, projects: projects, accessRecords: accessRecords, mates: mates };
}

test("workspace binding derives an exact owner from authoritative Mate and session state", function () {
  var f = multiUserFixture();
  assert.ok(f.bound);
  assert.equal(f.bound.isClay, true);
  assert.equal(f.service.bindSource({ projectSlug: "mate-a", projectOwnerId: "user-a", isMate: true, mateId: "clay-a", session: { ownerId: "user-b" } }), null);
  assert.equal(f.service.bindSource({ projectSlug: "mate-a", projectOwnerId: "user-a", isMate: false, mateId: "clay-a" }), null);
  assert.equal(f.service.bindSource({ projectSlug: "mate-a", projectOwnerId: "user-a", isMate: true, mateId: "missing" }), null);
});

test("multi-user workspace includes exact-owned sessions in accessible project containers", function () {
  var f = multiUserFixture();
  var projects = f.bound.listProjects({ limit: 50 }).projects;
  assert.deepEqual(projects.map(function (item) { return item.projectSlug; }).sort(), ["mate-a", "mate-custom", "owned", "public-container", "worktree"]);
  var sessions = f.bound.listProjectSessions({ projectSlug: "owned" }).sessions;
  assert.deepEqual(sessions.map(function (item) { return item.title; }), ["Owned Session"]);
  assert.equal(sessions[0].vendor, "claude forged");
  assert.equal(sessions[0].model, "sonnet");
  assert.match(sessions[0].sessionRef, /^session:[A-Za-z0-9_-]{24}$/);
  assert.doesNotMatch(sessions[0].sessionRef, /11|runtime-secret-id/);
  var projectSessions = f.bound.listProjectSessions({ projectSlug: "public-container" }).sessions;
  assert.deepEqual(projectSessions.map(function (item) { return item.title; }), ["Project work"]);
  assert.equal(f.bound.searchWorkspaceHistory({ query: "PROJECT_SESSION_MATCH", limit: 50 }).results.length, 1);
  assert.deepEqual(f.bound.searchWorkspaceHistory({ query: "FOREIGN_PROJECT_SECRET", limit: 50 }).results, []);
  assert.throws(function () { f.bound.listProjectSessions({ projectSlug: "other-public" }); }, /owned workspace/);
});

test("opaque session references survive local-ID reloads and arbitrary raw IDs are denied", function () {
  var f = multiUserFixture();
  var first = f.bound.listProjectSessions({ projectSlug: "owned" }).sessions[0].sessionRef;
  f.owned.localId = 99;
  var second = f.bound.listProjectSessions({ projectSlug: "owned" }).sessions[0].sessionRef;
  assert.equal(second, first);
  assert.throws(function () { f.bound.readProjectSession({ projectSlug: "owned", sessionRef: "11" }); }, /Session not found/);
  assert.throws(function () { f.bound.readProjectSession({ projectSlug: "owned", sessionRef: "local:11" }); }, /Session not found/);
  assert.throws(function () { f.bound.readProjectSession({ projectSlug: "owned", sessionRef: "session:arbitrary" }); }, /Session not found/);
});

test("opaque references resolve to owner-validated navigation without trusting caller identity", function () {
  var f = multiUserFixture();
  var ref = f.bound.listProjectSessions({ projectSlug: "owned" }).sessions[0].sessionRef;
  var target = f.bound.resolveSessionNavigation({ sessionRef: ref });
  assert.deepEqual(target, {
    projectSlug: "owned",
    projectTitle: "owned Title",
    isMate: false,
    mateId: null,
    sessionId: 11,
    homeSessionId: "runtime-secret-id",
    title: "Owned Session",
  });
  assert.throws(function () { f.bound.resolveSessionNavigation({ sessionRef: "session:arbitrary" }); }, /Invalid session reference/);
  assert.throws(function () { f.bound.resolveSessionNavigation({ sessionRef: "session:AAAAAAAAAAAAAAAAAAAAAAAA" }); }, /owned workspace/);
});

test("local-only references are opaque but explicitly ephemeral", function () {
  var f = multiUserFixture();
  f.owned.cliSessionId = null;
  var session = f.bound.listProjectSessions({ projectSlug: "owned" }).sessions[0];
  assert.equal(session.durable, false);
  assert.match(session.sessionRef, /^session:[A-Za-z0-9_-]{24}$/);
  assert.doesNotMatch(session.sessionRef, /11/);
});

test("bounded reads and search expose canonical user and assistant text only", function () {
  var f = multiUserFixture();
  var ref = f.bound.listProjectSessions({ projectSlug: "owned" }).sessions[0].sessionRef;
  var read = f.bound.readProjectSession({ projectSlug: "owned", sessionRef: ref, limit: 50 });
  assert.deepEqual(read.turns, [
    { role: "user", text: "Canonical planning request" },
    { role: "assistant", text: "Canonical assistant answer" },
  ]);
  assert.equal(read.total, 2);
  assert.equal(f.bound.searchWorkspaceHistory({ query: "Canonical", limit: 50 }).results.length, 1);
  assert.deepEqual(f.bound.searchWorkspaceHistory({ query: "TOOL_SECRET", limit: 50 }).results, []);
  assert.deepEqual(f.bound.searchWorkspaceHistory({ query: "TOOL_RESULT_SECRET", limit: 50 }).results, []);
  assert.deepEqual(f.bound.searchWorkspaceHistory({ query: "HIDDEN_SECRET", limit: 50 }).results, []);
  assert.deepEqual(f.bound.searchWorkspaceHistory({ query: "OTHER_SECRET", limit: 50 }).results, []);
  assert.deepEqual(f.bound.searchWorkspaceHistory({ query: "PUBLIC_SECRET", limit: 50 }).results, []);
});

test("workspace projections never recast delegated work as user speech", function () {
  var turns = canonicalTurns([
    { type: "delegated_work", text: "Agent-created initial task" },
    { type: "delta", text: "Initial result" },
    { type: "result" },
    { type: "delegated_follow_up", text: "Agent-created follow-up" },
    { type: "delta", text: "Follow-up result" },
    { type: "done" },
  ]);
  assert.deepEqual(turns, [
    { role: "assistant", text: "Initial result" },
    { role: "assistant", text: "Follow-up result" },
  ]);
});

test("workspace activity and project pagination are bounded and newest-first", function () {
  var f = multiUserFixture();
  var first = f.bound.listProjects({ limit: 1 });
  assert.equal(first.projects[0].projectSlug, "owned");
  assert.ok(first.nextCursor);
  var second = f.bound.listProjects({ limit: 1, cursor: first.nextCursor });
  assert.equal(second.projects[0].projectSlug, "public-container");
  var third = f.bound.listProjects({ limit: 1, cursor: second.nextCursor });
  assert.equal(third.projects[0].projectSlug, "mate-a");
  var activity = f.bound.listWorkspaceActivity({ limit: 50 });
  assert.deepEqual(activity.sessions.map(function (session) { return session.lastActivity; }), [20, 15, 0, 0, 0]);
});

test("custom Mates receive project tools but cannot claim builtin Clay global authority", function () {
  var f = multiUserFixture();
  var customProject = f.service.bindSource({ projectSlug: "mate-custom", projectOwnerId: "user-a", isMate: true, mateId: "custom-a", session: null });
  var custom = customProject;
  assert.ok(custom);
  assert.equal(custom.isClay, false);
  assert.throws(function () { custom.searchWorkspaceHistory({ query: "Canonical" }); }, /only to builtin Clay/);
  assert.deepEqual(custom.getMemorySessions(true), []);
  var ordinaryNames = workspaceMcp.getToolDefs(custom, false).map(function (tool) { return tool.name; });
  var clayNames = workspaceMcp.getToolDefs(f.bound, true).map(function (tool) { return tool.name; });
  assert.equal(ordinaryNames.indexOf("search_workspace_history"), -1);
  assert.notEqual(clayNames.indexOf("search_workspace_history"), -1);
});

test("follow-up MCP delegates only through the exact bound workspace principal", async function () {
  var f = multiUserFixture();
  var tool = workspaceMcp.getToolDefs(f.bound, true).filter(function (item) { return item.name === "propose_project_follow_up"; })[0];
  var args = { projectSlug: "owned", targetSessionRef: "session:opaque", title: "Continue", task: "Inspect the next step." };
  var result = await tool.handler(args);
  assert.equal(JSON.parse(result.content[0].text).assignmentId, "follow");
  assert.equal(f.assignmentCalls.length, 1);
  assert.equal(f.assignmentCalls[0].method, "follow_up");
  assert.equal(f.assignmentCalls[0].principal.userId, "user-a");
  assert.deepEqual(f.assignmentCalls[0].args, args);
});

test("unbound workspace MCP tools advertise safely and fail closed on invocation", async function () {
  var tools = workspaceMcp.getToolDefs(null, false);
  var result = await tools[0].handler({});
  assert.equal(result.isError, true);
  assert.match(result.content[0].text, /exact session-bound Mate query/);
});

test("legacy single-user mode permits only ownerless projects and sessions", function () {
  var projects = new Map();
  projects.set("legacy", project("legacy", null, [
    { localId: 1, ownerId: null, title: "Legacy", history: [{ type: "user_message", text: "Legacy text" }] },
    { localId: 2, ownerId: "stale-user", title: "Bound", history: [] },
  ], { isMate: true, mateId: "clay" }));
  projects.set("owned", project("owned", "stale-user", [{ localId: 3, ownerId: "stale-user", history: [] }]));
  var service = attachWorkspaceQueryService({
    getProjects: function () { return projects; }, isMultiUser: function () { return false; },
    resolveMate: function () { return { id: "clay", createdBy: null, builtinKey: "clay" }; },
  });
  var legacySession = projects.get("legacy").getSessionManager().sessions.get(1);
  var bound = service.bindSource({ projectSlug: "legacy", projectOwnerId: null, isMate: true, mateId: "clay", session: legacySession });
  assert.deepEqual(bound.listProjects({}).projects.map(function (item) { return item.projectSlug; }), ["legacy"]);
  assert.deepEqual(bound.listProjectSessions({ projectSlug: "legacy" }).sessions.map(function (item) { return item.title; }), ["Legacy"]);
  assert.equal(service.bindSource({ projectSlug: "legacy", projectOwnerId: null, isMate: true, mateId: "clay", session: { ownerId: "stale-user" } }), null);
});

test("clay-history compatibility delegates to the owner-bound canonical service", async function () {
  var f = multiUserFixture();
  var tools = clayHistory.getToolDefs({ workspace: f.bound });
  var search = tools.filter(function (tool) { return tool.name === "search_clay_history"; })[0];
  var readTool = tools.filter(function (tool) { return tool.name === "read_session"; })[0];
  var searchResult = await search.handler({ query: "Canonical planning", maxResults: 5 });
  var matches = JSON.parse(searchResult.content[0].text);
  assert.equal(matches.results.length, 1);
  var readResult = await readTool.handler({ projectSlug: "owned", sessionId: matches.results[0].sessionRef, limit: 10 });
  var body = JSON.parse(readResult.content[0].text);
  assert.deepEqual(body.turns.map(function (turn) { return turn.role; }), ["user", "assistant"]);
  assert.doesNotMatch(readResult.content[0].text, /TOOL_SECRET|runtime-secret-id/);
});
