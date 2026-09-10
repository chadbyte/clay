var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");

var attachService = require("../lib/project-logs-service").attachProjectLogsService;
var projectLogs = require("../lib/project-logs");
var attachProjectLogs = projectLogs.attachProjectLogs;
var logsMcp = require("../lib/project-logs-mcp-server");
var logsStore = require("../lib/project-logs-store");
var schema = require("../lib/ws-schema").schema;

var PROJECT_TOOLS = ["list_logs", "search_logs", "read_log", "log_history", "create_log", "update_log", "list_log_feedback", "review_log_comment", "read_log_revision", "revert_log", "link_log"];
var CLAY_TOOLS = ["list_project_logs", "search_project_logs", "read_project_log_revision", "read_project_log", "project_log_history"];

function storeFactory() {
  var base = fs.mkdtempSync(path.join(os.tmpdir(), "clay-logs-wire-"));
  var cache = new Map();
  return function (cwd) {
    if (!cache.has(cwd)) cache.set(cwd, logsStore.createProjectLogsStore({ root: cwd, baseDir: base }));
    return cache.get(cwd);
  };
}

function handle(status, sessions) {
  var manager = { sessions: new Map() };
  for (var i = 0; i < (sessions || []).length; i++) manager.sessions.set(sessions[i].localId, sessions[i]);
  return { getStatus: function () { return status; }, getSessionManager: function () { return manager; } };
}

function fixture(opts) {
  var options = opts || {};
  var session = { localId: 11, cliSessionId: "cli-11", ownerId: "owner", vendor: "claude" };
  var otherSession = { localId: 12, cliSessionId: "cli-12", ownerId: "member", vendor: "codex" };
  var mateSession = { localId: 21, cliSessionId: "cli-21", ownerId: "owner", vendor: "claude" };

  var projects = new Map();
  projects.set("app", handle({ slug: "app", path: "/srv/app", projectOwnerId: "owner", visibility: "private", allowedUsers: ["member"] }, [session, otherSession]));
  projects.set("secret", handle({ slug: "secret", path: "/srv/secret", projectOwnerId: "stranger", visibility: "private", allowedUsers: [] }, []));
  projects.set("mate-home", handle({ slug: "mate-home", path: "/srv/mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }, [mateSession]));

  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function (ownerId, mateId) {
      return { id: mateId, createdBy: ownerId, builtinKey: options.builtinKey || "clay" };
    },
    canAccessProject: function (userId, status) {
      if (!status) return false;
      if (status.projectOwnerId === userId) return true;
      return (status.allowedUsers || []).indexOf(userId) >= 0;
    },
    findUserById: function (id) {
      if (id === "owner") return { id: "owner", displayName: "Owner" };
      if (id === "member") return { id: "member", displayName: "Member" };
      return null;
    },
    openStore: storeFactory(),
  });

  var sent = [];
  var feedback = [];
  var attached = attachProjectLogs({
    service: service,
    sm: projects.get(options.mate ? "mate-home" : "app").getSessionManager(),
    projectSlug: options.mate ? "mate-home" : "app",
    getProjectOwnerId: function () { return "owner"; },
    isMate: !!options.mate,
    mateId: options.mate ? "mate-id" : null,
    sendTo: function (ws, message) { sent.push(message); },
    onFeedback: function (entry) {
      feedback.push(entry);
      return options.feedbackQueued === true;
    },
  });

  return { attached: attached, sent: sent, feedback: feedback, session: session, otherSession: otherSession, mateSession: mateSession, service: service, projects: projects };
}

function ws(user) {
  return { _clayUser: user || null, readyState: 1 };
}

function last(sent) {
  return sent[sent.length - 1];
}

// --- WebSocket protocol ------------------------------------------------

// Canonical entries exist only because an agent session wrote them, so every
// WS test seeds through a session binding first.
function seed(f, overrides) {
  var bound = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  return bound.createLog(Object.assign({
    kind: "decision", priority: "urgent",
    title: "Cache decision", summary: "Adopted an append-only log for the cache.",
    body: "Adopted an append-only log.",
  }, overrides || {}));
}

test("worktree bindings share one project ledger while defaulting to their current change set", function () {
  var parentSession = { localId: 31, cliSessionId: "cli-parent", ownerId: "owner", vendor: "claude" };
  var worktreeSession = { localId: 32, cliSessionId: "cli-worktree", ownerId: "owner", vendor: "codex" };
  var projects = new Map();
  projects.set("app", handle({
    slug: "app", path: "/srv/app", projectOwnerId: "owner", visibility: "private", projectKnowledgeId: "pk_app",
  }, [parentSession]));
  projects.set("app--feature", handle({
    slug: "app--feature", path: "/srv/app-feature", projectOwnerId: "owner", visibility: "private",
    projectKnowledgeId: "pk_app", isWorktree: true, parentSlug: "app", changeSetId: "cs_feature", branch: "feature/log-context",
  }, [worktreeSession]));
  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    canAccessProject: function (userId, status) { return status.projectOwnerId === userId; },
    openStore: storeFactory(),
  });
  var parent = service.bindProjectSession({ projectSlug: "app", session: parentSession });
  var worktree = service.bindProjectSession({ projectSlug: "app--feature", session: worktreeSession });
  parent.createLog({ kind: "decision", title: "Project rule", summary: "Applies to every checkout." });
  var changed = worktree.createLog({ kind: "progress", title: "Feature work", summary: "Belongs to this logical change." });

  assert.equal(parent.listLogs({}).total, 1, "the main project defaults to project-wide entries");
  assert.equal(worktree.listLogs({}).total, 2, "the worktree sees project-wide context and its own change");
  assert.equal(worktree.listLogs({ contextMode: "project" }).total, 1);
  assert.equal(parent.listLogs({ contextMode: "all" }).total, 2);
  assert.equal(worktree.readLog({ ref: changed.ref }).context.changeSetId, "cs_feature");
});

test("an exact-worktree member sees only that change set in the shared ledger", function () {
  var parentSession = { localId: 41, cliSessionId: "cli-parent", ownerId: "owner", vendor: "claude" };
  var exactSession = { localId: 42, cliSessionId: "cli-exact", ownerId: "user-c", vendor: "codex" };
  var siblingSession = { localId: 43, cliSessionId: "cli-sibling", ownerId: "owner", vendor: "codex" };
  var projects = new Map();
  projects.set("app", handle({
    slug: "app", path: "/srv/app", projectOwnerId: "owner", projectKnowledgeId: "pk_app",
  }, [parentSession]));
  projects.set("app--feature-c", handle({
    slug: "app--feature-c", path: "/srv/app-c", projectOwnerId: "owner", projectKnowledgeId: "pk_app",
    isWorktree: true, parentSlug: "app", changeSetId: "cs_feature_c",
  }, [exactSession]));
  projects.set("app--feature-d", handle({
    slug: "app--feature-d", path: "/srv/app-d", projectOwnerId: "owner", projectKnowledgeId: "pk_app",
    isWorktree: true, parentSlug: "app", changeSetId: "cs_feature_d",
  }, [siblingSession]));

  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    canAccessProject: function (userId, status) {
      return userId === "owner" || (userId === "user-c" && status.slug === "app--feature-c");
    },
    hasFullProjectAccess: function (userId) { return userId === "owner"; },
    openStore: storeFactory(),
  });

  var parent = service.bindProjectSession({ projectSlug: "app", session: parentSession });
  var exact = service.bindProjectSession({ projectSlug: "app--feature-c", session: exactSession });
  var sibling = service.bindProjectSession({ projectSlug: "app--feature-d", session: siblingSession });
  var projectEntry = parent.createLog({ kind: "decision", title: "Parent policy", summary: "Visible to full project members." });
  var exactEntry = exact.createLog({ kind: "progress", title: "Feature C", summary: "Visible inside the exact worktree." });
  var siblingEntry = sibling.createLog({ kind: "progress", title: "Feature D", summary: "Visible inside the sibling worktree." });

  assert.deepEqual(exact.listLogs({ contextMode: "all" }).entries.map(function (entry) { return entry.ref; }), [exactEntry.ref]);
  assert.deepEqual(exact.searchLogs({ query: "Visible", contextMode: "all" }).results.map(function (entry) { return entry.ref; }), [exactEntry.ref]);
  assert.throws(function () { exact.readLog({ ref: projectEntry.ref }); }, /not found/i);
  assert.throws(function () { exact.readLog({ ref: siblingEntry.ref }); }, /not found/i);
  assert.throws(function () { exact.logHistory({ ref: projectEntry.ref }); }, /not found/i);
  assert.throws(function () { exact.readLogRevision({ ref: siblingEntry.ref, revision: 1 }); }, /not found/i);
  assert.throws(function () { exact.updateLog({ ref: projectEntry.ref, summary: "Forged parent edit." }); }, /not found/i);
  assert.equal(exact.readLog({ ref: exactEntry.ref }).title, "Feature C");
});

test("the WebSocket round trip emits exactly the client protocol payloads", function () {
  var f = fixture();
  var owner = ws({ id: "owner", displayName: "Owner" });
  var entry = seed(f);

  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r2", query: "" });
  var state = last(f.sent);
  assert.equal(state.type, "project_logs_state");
  assert.equal(state.requestId, "r2");
  assert.equal(state.entries.length, 1);
  assert.equal(state.canDelete, true, "the project owner receives the delete capability");
  assert.deepEqual(state.categories, ["decision"], "the client is told this project's live vocabulary");
  var row = state.entries[0];
  assert.equal(row.ref, entry.ref);
  assert.equal(row.summary, "Adopted an append-only log for the cache.");
  assert.equal(row.priority, "urgent");
  assert.equal(row.category, "decision");
  assert.equal(row.commentCount, 0);
  assert.equal(row.revisions, 1);
  assert.equal(row.body, undefined, "the ledger never dumps a record body");

  f.attached.handleLogsMessage(owner, { type: "project_log_read", requestId: "r3", ref: entry.ref });
  var entryMsg = last(f.sent);
  assert.equal(entryMsg.type, "project_log_entry");
  assert.equal(entryMsg.requestId, "r3");
  assert.equal(entryMsg.entry.ref, entry.ref);
  assert.equal(entryMsg.entry.body, "Adopted an append-only log.", "detail carries the body");
  assert.deepEqual(entryMsg.entry.comments, []);

  // Commenting is the only human mutation.
  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "r4", ref: entry.ref, body: "Confirmed." });
  var commented = last(f.sent);
  assert.equal(commented.type, "project_log_commented");
  assert.equal(commented.requestId, "r4");
  assert.equal(commented.entry.commentCount, 1);
  assert.equal(commented.entry.comments[0].body, "Confirmed.");
  assert.equal(commented.entry.comments[0].author.userId, "owner");
  assert.equal(commented.entry.revisions, 1, "a comment is not a revision");
  assert.equal(f.feedback.length, 1, "the exact persisted entry is handed to immediate delivery");
  assert.equal(f.feedback[0].ref, entry.ref);
  assert.equal(commented.reviewQueued, false, "the client sees when no reviewer was started");

  // A valid category this project has never used narrows to nothing rather
  // than erroring, and the vocabulary is still reported.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r5", query: "", category: "security" });
  assert.equal(last(f.sent).type, "project_logs_state");
  assert.equal(last(f.sent).entries.length, 0);
  assert.deepEqual(last(f.sent).categories, ["decision"]);
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r6", query: "", category: "decision" });
  assert.equal(last(f.sent).entries.length, 1);

  // Search returns the same ledger row shape.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r7", query: "append-only" });
  var searched = last(f.sent);
  assert.equal(searched.entries.length, 1);
  assert.equal(searched.entries[0].commentCount, 1);
  assert.equal(searched.entries[0].body, undefined);
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r8", query: "nothing matches this" });
  assert.deepEqual(last(f.sent).entries, []);

  f.attached.handleLogsMessage(owner, { type: "project_log_delete", requestId: "r9", ref: entry.ref });
  var deleted = last(f.sent);
  assert.equal(deleted.type, "project_log_deleted");
  assert.equal(deleted.requestId, "r9");
  assert.equal(deleted.ref, entry.ref);
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "r10", query: "" });
  assert.equal(last(f.sent).entries.length, 0, "the deleted entry leaves the live ledger");
});

test("comment acknowledgement reports an immediately started review", function () {
  var f = fixture({ feedbackQueued: true });
  var entry = seed(f);
  var owner = ws({ id: "owner", displayName: "Owner" });

  f.attached.handleLogsMessage(owner, {
    type: "project_log_comment",
    requestId: "queued-review",
    ref: entry.ref,
    body: "Please review this now.",
  });

  var commented = last(f.sent);
  assert.equal(commented.type, "project_log_commented");
  assert.equal(commented.reviewQueued, true);
  assert.equal(f.feedback.length, 1, "delivery is attempted exactly once");
});

test("humans cannot create or update canonical entries over the WebSocket", function () {
  var f = fixture();
  var entry = seed(f);
  var owner = ws({ id: "owner", displayName: "Owner" });

  var attempts = [
    { type: "project_log_create", requestId: "d1", kind: "decision", title: "Human entry", summary: "Nope.", body: "x" },
    { type: "project_log_update", requestId: "d2", ref: entry.ref, title: "Human edit", body: "x" },
  ];
  for (var i = 0; i < attempts.length; i++) {
    assert.equal(f.attached.handleLogsMessage(owner, attempts[i]), true, "the message is claimed, not ignored");
    var refused = last(f.sent);
    assert.equal(refused.type, "project_logs_error");
    assert.equal(refused.requestId, attempts[i].requestId);
    assert.match(refused.message, /agent sessions/);
  }

  // Nothing changed.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "d3", query: "" });
  var rows = last(f.sent).entries;
  assert.equal(rows.length, 1, "no entry was created");
  assert.equal(rows[0].revisions, 1, "no revision was applied");
  assert.equal(rows[0].title, "Cache decision");

  // The retired types are still registered so the refusal is documented.
  assert.equal(schema["project_log_create"].direction, "c2s");
  assert.match(schema["project_log_create"].description, /Retired/);
  assert.match(schema["project_log_update"].description, /Retired/);
});

test("identity and project scope are never taken from the message", function () {
  var f = fixture();
  seed(f);
  var member = ws({ id: "member", displayName: "Member" });
  var entry = f.service.bindUser({ projectSlug: "app", user: { id: "member" } }).listLogs({}).entries[0];

  // Every spoofable field is present and must be ignored.
  f.attached.handleLogsMessage(member, {
    type: "project_log_comment", requestId: "s1", ref: entry.ref, body: "Spoof attempt",
    userId: "owner", user: { id: "owner" }, author: { userId: "owner", displayName: "Owner" },
    projectSlug: "secret", slug: "secret",
  });
  var commented = last(f.sent);
  assert.equal(commented.type, "project_log_commented");
  assert.equal(commented.entry.comments[0].author.userId, "member", "attribution comes from ws._clayUser");
  assert.equal(commented.entry.comments[0].author.displayName, "Member");

  var stranger = ws({ id: "stranger" });
  f.attached.handleLogsMessage(stranger, { type: "project_logs_list", requestId: "s3", query: "" });
  assert.equal(last(f.sent).type, "project_logs_error");

  f.attached.handleLogsMessage(stranger, { type: "project_log_comment", requestId: "s4", ref: entry.ref, body: "no" });
  assert.equal(last(f.sent).type, "project_logs_error", "an unauthorized user cannot comment");

  var anonymous = ws(null);
  f.attached.handleLogsMessage(anonymous, { type: "project_log_read", requestId: "s5", ref: entry.ref });
  assert.equal(last(f.sent).type, "project_logs_error", "multi-user mode fails closed without an identified user");
});

test("shared-project members comment with attribution preserved", function () {
  var f = fixture();
  var entry = seed(f, { title: "Retry storm", summary: "Root cause pending." });
  var owner = ws({ id: "owner", displayName: "Owner" });
  var member = ws({ id: "member", displayName: "Member" });

  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "a1", ref: entry.ref, body: "From the owner." });
  f.attached.handleLogsMessage(member, { type: "project_log_comment", requestId: "a2", ref: entry.ref, body: "From a member." });
  var latest = last(f.sent).entry;
  assert.equal(latest.commentCount, 2);
  assert.deepEqual(latest.comments.map(function (c) { return c.author.displayName; }), ["Owner", "Member"]);
  assert.equal(latest.createdBy.type, "session", "canonical authorship is unchanged by discussion");

  f.attached.handleLogsMessage(member, { type: "project_logs_list", requestId: "a3", query: "" });
  assert.equal(last(f.sent).canDelete, false);
  f.attached.handleLogsMessage(member, { type: "project_log_delete", requestId: "a4", ref: entry.ref });
  assert.equal(last(f.sent).type, "project_logs_error");
  assert.match(last(f.sent).message, /project owner/);
});

test("Mate projects deny the Logs UI path and errors stay correlated", function () {
  var f = fixture({ mate: true });
  var owner = ws({ id: "owner" });

  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "m1", query: "" }), true);
  var denied = last(f.sent);
  assert.equal(denied.type, "project_logs_error");
  assert.equal(denied.requestId, "m1");
  assert.match(denied.message, /Mate conversations/);

  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "m2", ref: "log:x", body: "No" });
  assert.equal(last(f.sent).type, "project_logs_error");

  assert.equal(f.attached.handleLogsMessage(owner, { type: "note_create" }), false);
  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_log_delete", requestId: "m3" }), true);
  assert.equal(last(f.sent).type, "project_logs_error");
});

test("a store error is reported as a correlated error, not a thrown handler", function () {
  var f = fixture();
  var owner = ws({ id: "owner" });
  assert.equal(f.attached.handleLogsMessage(owner, { type: "project_log_read", requestId: "e1", ref: "not-a-ref" }), true);
  assert.equal(last(f.sent).type, "project_logs_error");

  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "e2", ref: "log:aaaaaaaaaaaaaaaaaaaaaaaa", body: "x" });
  assert.equal(last(f.sent).type, "project_logs_error");

  var entry = seed(f);
  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "e3", ref: entry.ref, body: "   " });
  assert.equal(last(f.sent).type, "project_logs_error");
});

// --- MCP surface --------------------------------------------------------

test("a bound project session gets project-scoped tools with no projectSlug argument", function () {
  var f = fixture();
  var defs = f.attached.getToolDefs(f.session);
  assert.deepEqual(defs.map(function (d) { return d.name; }), PROJECT_TOOLS);
  for (var i = 0; i < defs.length; i++) {
    assert.equal(Object.keys(defs[i].inputSchema).indexOf("projectSlug"), -1, defs[i].name + " must not accept a project argument");
  }

  var adapter = { createToolServer: function (definition) { return definition; } };
  var server = f.attached.createMcpServer(adapter, f.session);
  assert.equal(server.name, "clay-logs");
  assert.equal(server.tools.length, PROJECT_TOOLS.length);
});

test("session-bound MCP writes are attributed to the session and scoped to its project", async function () {
  var f = fixture();
  var defs = f.attached.getToolDefs(f.session);
  function tool(name) {
    for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
    throw new Error("missing tool " + name);
  }

  var created = JSON.parse((await tool("create_log").handler({ kind: "operations", summary: "Recorded for the ledger.", title: "Restart the daemon", body: "steps", tags: "[\"ops\",\"ops\"]" })).content[0].text);
  assert.equal(created.createdBy.type, "session");
  assert.equal(created.createdBy.sessionKey, "cli-11");
  assert.equal(created.createdBy.userId, "owner");
  assert.deepEqual(created.tags, ["ops"], "a JSON-encoded tag array is parsed and de-duplicated");

  var listed = JSON.parse((await tool("list_logs").handler({})).content[0].text);
  assert.equal(listed.total, 1);

  var found = JSON.parse((await tool("search_logs").handler({ query: "restart" })).content[0].text);
  assert.equal(found.total, 1);

  var linked = JSON.parse((await tool("link_log").handler({ ref: created.ref, links: "[{\"ref\":\"session:abc\",\"label\":\"triage\"}]" })).content[0].text);
  assert.equal(linked.links[0].ref, "session:abc");

  var history = JSON.parse((await tool("log_history").handler({ ref: created.ref })).content[0].text);
  assert.deepEqual(history.revisions.map(function (r) { return r.op; }), ["create", "link"]);

  var badTags = await tool("create_log").handler({ kind: "decision", summary: "Recorded for the ledger.", title: "Bad tags", tags: "not json" });
  assert.equal(badTags.isError, true);

  // A different session in the same project sees the same Logs.
  var otherDefs = f.attached.getToolDefs(f.otherSession);
  var otherList = JSON.parse((await otherDefs[0].handler({})).content[0].text);
  assert.equal(otherList.total, 1);
});

test("static and impostor descriptors fail closed", async function () {
  var f = fixture();
  var adapter = { createToolServer: function (definition) { return definition; } };

  var staticServer = f.attached.createMcpServer(adapter, null);
  assert.equal(staticServer.tools.length, PROJECT_TOOLS.length, "a descriptor is still advertised before a session is known");
  for (var i = 0; i < staticServer.tools.length; i++) {
    var result = await staticServer.tools[i].handler({});
    assert.equal(result.isError, true, staticServer.tools[i].name + " must fail closed when unbound");
  }

  var impostor = { localId: 11, cliSessionId: "cli-11", ownerId: "owner" };
  assert.deepEqual(f.attached.getToolDefs(impostor), [], "a session object that is not the live one gets no tools");
  var impostorServer = f.attached.createMcpServer(adapter, impostor);
  assert.equal((await impostorServer.tools[0].handler({})).isError, true);

  var unattributed = { localId: 13, ownerId: null };
  assert.deepEqual(f.attached.getToolDefs(unattributed), []);
});

test("ordinary Mates receive no Project Logs tools at all", function () {
  var ordinary = fixture({ mate: true, builtinKey: "researcher" });
  var adapter = { createToolServer: function (definition) { return definition; } };
  assert.deepEqual(ordinary.attached.getToolDefs(ordinary.mateSession), []);
  assert.deepEqual(ordinary.attached.getToolDefs(null), []);
  assert.equal(ordinary.attached.createMcpServer(adapter, ordinary.mateSession), null);
  assert.equal(ordinary.attached.createMcpServer(adapter, null), null, "no descriptor is advertised either");
  assert.deepEqual(ordinary.attached.getBridgeTools(ordinary.mateSession, function () { return {}; }), []);
  assert.equal(ordinary.attached.getSystemPrompt(ordinary.mateSession), "");
});

test("authoritative builtin Clay gets only the read-only cross-project tools", async function () {
  var project = fixture();
  project.service.bindProjectSession({ projectSlug: "app", session: project.session })
    .createLog({ kind: "decision", title: "Adopt append-only logs", summary: "One append-only backend for all Knowledge.", body: "one backend" });

  // Clay reads through the same service instance, so it sees that write.
  var clay = attachProjectLogs({
    service: project.service,
    sm: project.projects.get("mate-home").getSessionManager(),
    projectSlug: "mate-home",
    getProjectOwnerId: function () { return "owner"; },
    isMate: true,
    mateId: "mate-id",
    sendTo: function () {},
  });

  var defs = clay.getToolDefs(project.mateSession);
  var clayPrompt = clay.getSystemPrompt(project.mateSession);
  assert.match(clayPrompt, /search its Project Logs before answering/);
  assert.match(clayPrompt, /prior work, decisions, defects, status, rationale, or unfinished work/);
  assert.match(clayPrompt, /\[clayos\/<ref> — short label\]/);
  assert.match(clayPrompt, /Do not search Logs for unrelated general questions/);
  assert.deepEqual(defs.map(function (d) { return d.name; }), CLAY_TOOLS);
  for (var i = 0; i < defs.length; i++) {
    assert.equal(PROJECT_TOOLS.indexOf(defs[i].name), -1, "no tool name is advertised by both sets");
    assert.ok(Object.keys(defs[i].inputSchema).indexOf("projectSlug") !== -1, defs[i].name + " requires an explicit slug");
  }
  assert.equal(defs.filter(function (d) { return /create|update|link|review|revert/.test(d.name); }).length, 0, "Clay is advertised no write or review tool");

  function tool(name) {
    for (var j = 0; j < defs.length; j++) if (defs[j].name === name) return defs[j];
    throw new Error("missing tool " + name);
  }

  var listed = JSON.parse((await tool("list_project_logs").handler({ projectSlug: "app" })).content[0].text);
  assert.equal(listed.total, 1);
  assert.equal(listed.entries[0].createdBy.userId, "owner");

  var searched = JSON.parse((await tool("search_project_logs").handler({ projectSlug: "app", query: "append-only" })).content[0].text);
  assert.equal(searched.total, 1);

  var read = JSON.parse((await tool("read_project_log").handler({ projectSlug: "app", ref: listed.entries[0].ref })).content[0].text);
  assert.equal(read.title, "Adopt append-only logs");

  var history = JSON.parse((await tool("project_log_history").handler({ projectSlug: "app", ref: listed.entries[0].ref })).content[0].text);
  assert.equal(history.total, 1);

  // Unauthorized and Mate projects are refused, and a missing slug is refused.
  assert.equal((await tool("list_project_logs").handler({ projectSlug: "secret" })).isError, true);
  assert.equal((await tool("list_project_logs").handler({ projectSlug: "mate-home" })).isError, true);
  assert.equal((await tool("list_project_logs").handler({})).isError, true);

  var adapter = { createToolServer: function (definition) { return definition; } };
  assert.equal(clay.createMcpServer(adapter, project.mateSession).tools.length, CLAY_TOOLS.length);
});

test("bridge advertising and dispatch mirror the adapter path without duplicates", async function () {
  var f = fixture();
  var normalize = function () { return { type: "object", properties: {} }; };
  var bridge = f.attached.getBridgeTools(f.session, normalize);
  assert.equal(bridge.length, PROJECT_TOOLS.length);
  var names = {};
  for (var i = 0; i < bridge.length; i++) {
    assert.equal(bridge[i].server, "clay-logs");
    assert.equal(names[bridge[i].name], undefined, "no duplicate advertised tool");
    names[bridge[i].name] = true;
  }
  assert.deepEqual(Object.keys(names), PROJECT_TOOLS);
  assert.deepEqual(f.attached.getBridgeTools(null, normalize), []);

  var created = JSON.parse((await f.attached.callBridgeTool(f.session, "create_log", { kind: "progress", summary: "Recorded for the ledger.", title: "Bridge write", body: "x" })).content[0].text);
  assert.equal(created.createdBy.sessionKey, "cli-11");
  await assert.rejects(function () { return f.attached.callBridgeTool(f.session, "delete_log", {}); }, /not found/);
  await assert.rejects(function () { return f.attached.callBridgeTool(null, "list_logs", {}); }, /require a valid session/);

  var dynamic = f.attached.getDynamicToolDefs(f.session);
  assert.equal(dynamic.length, PROJECT_TOOLS.length);
  for (var d = 0; d < dynamic.length; d++) {
    assert.equal(dynamic[d].permissionName, "mcp__clay-logs__" + dynamic[d].name);
  }
});

test("system prompt guidance preserves user-directed work for Driver continuity", function () {
  var f = fixture();
  var prompt = f.attached.getSystemPrompt(f.session);
  assert.ok(prompt.indexOf(projectLogs.SYSTEM_PROMPT_LABEL) === 0);
  assert.match(prompt, /durable work-continuity record/);
  assert.match(prompt, /newly created Driver/);
  assert.match(prompt, /every concrete user work instruction/);
  assert.match(prompt, /not only unusually important work/);
  assert.match(prompt, /requested outcome and material constraints/);
  assert.match(prompt, /what was changed, discovered, or decided/);
  assert.match(prompt, /affected area, verification, and the current result/);
  assert.match(prompt, /remaining work and next action explicitly/);
  assert.match(prompt, /routine work still belongs in the ledger at normal priority/);
  assert.match(prompt, /one entry per turn/);
  assert.match(prompt, /Repository history may show the code change but usually does not preserve the user's intent/);
  assert.match(prompt, /clean Driver handoff/);
  assert.match(prompt, /You are the only author/);
  assert.match(prompt, /concise meaningful title/);
  assert.match(prompt, /one or two sentence summary/);
  assert.match(prompt, /Prefer updating an existing entry/);
  assert.doesNotMatch(prompt, /Do not log conversation summaries/);
  assert.doesNotMatch(prompt, /restatements of the request/);
  assert.doesNotMatch(prompt, /completed-work announcements/);
  assert.match(prompt, /You are the only author/, "authorship is stated plainly");
  assert.doesNotMatch(prompt, /you are an? [a-z]/i, "no character or role description");
  assert.doesNotMatch(prompt, /your (personality|identity|character|voice)/i, "no persona framing");
  assert.doesNotMatch(prompt, /\bI\b/, "the guidance must not speak in the first person");

  assert.equal(f.attached.getSystemPrompt({ localId: 11, ownerId: "owner" }), "", "an unbindable session gets no guidance");
  assert.equal(fixture({ mate: true, builtinKey: "researcher" }).attached.getSystemPrompt(null), "");
});

test("write tools request one evolving task-handoff record", function () {
  var tools = logsMcp.getToolDefs(null, false);
  var create = tools.filter(function (tool) { return tool.name === "create_log"; })[0];
  var update = tools.filter(function (tool) { return tool.name === "update_log"; })[0];

  assert.match(create.description, /new coherent user-directed task/);
  assert.match(create.description, /Search first/);
  assert.doesNotMatch(create.description, /weeks from now/);
  assert.match(create.inputSchema.summary.description, /user's requested outcome with the current result or status/);
  var createBodyDescription = create.inputSchema.body.unwrap().description;
  var updateBodyDescription = update.inputSchema.body.unwrap().description;
  assert.match(createBodyDescription, /requested outcome and constraints/);
  assert.match(createBodyDescription, /work\/result, affected area, verification, current status/);
  assert.match(createBodyDescription, /next action when unfinished/);
  assert.match(update.description, /work progresses, completes, becomes blocked/);
  assert.match(updateBodyDescription, /request, current result, verification/);
});

test("a service-less attachment is inert rather than failing open", function () {
  var sent = [];
  var inert = attachProjectLogs({
    service: null, sm: { sessions: new Map() }, projectSlug: "app",
    isMate: false, sendTo: function (w, m) { sent.push(m); },
  });
  assert.equal(inert.handleLogsMessage(ws({ id: "owner" }), { type: "project_logs_list", requestId: "z1" }), true);
  assert.equal(last(sent).type, "project_logs_error");
  assert.deepEqual(inert.getToolDefs({ localId: 1 }), []);
  assert.equal(inert.createMcpServer({ createToolServer: function (d) { return d; } }, null), null);
  assert.equal(inert.getSystemPrompt(null), "");
});

test("every Project Logs message type is registered in the WebSocket schema", function () {
  var c2s = ["project_logs_list", "project_log_read", "project_log_comment", "project_log_delete", "project_log_create", "project_log_update"];
  var s2c = ["project_logs_state", "project_log_entry", "project_log_commented", "project_log_comment_reviewed", "project_log_deleted", "project_logs_error"];
  for (var i = 0; i < c2s.length; i++) {
    assert.ok(schema[c2s[i]], c2s[i] + " is missing from ws-schema");
    assert.equal(schema[c2s[i]].direction, "c2s");
    assert.equal(schema[c2s[i]].handler, "lib/project-logs.js");
  }
  for (var j = 0; j < s2c.length; j++) {
    assert.ok(schema[s2c[j]], s2c[j] + " is missing from ws-schema");
    assert.equal(schema[s2c[j]].direction, "s2c");
  }
  assert.equal(schema["project_log_saved"], undefined, "the retired save response is gone");
});

test("tool argument coercion accepts arrays and rejects non-array JSON", function () {
  assert.deepEqual(projectLogs.coerceToolArgs({ tags: ["a"] }).tags, ["a"]);
  assert.deepEqual(projectLogs.coerceToolArgs({ tags: "[\"a\"]" }).tags, ["a"]);
  assert.equal(projectLogs.coerceToolArgs({ tags: "" }).tags, undefined);
  assert.equal(projectLogs.coerceToolArgs({}).tags, undefined);
  assert.throws(function () { projectLogs.coerceToolArgs({ links: "{\"ref\":\"x\"}" }); }, /JSON array/);
  assert.throws(function () { projectLogs.coerceToolArgs({ links: "nope" }); }, /JSON array/);
});

test("the MCP tool sets are disjoint and the contract is shared", function () {
  var projectDefs = logsMcp.getToolDefs(null, false);
  var clayDefs = logsMcp.getToolDefs(null, true);
  assert.deepEqual(projectDefs.map(function (d) { return d.name; }), PROJECT_TOOLS);
  assert.deepEqual(clayDefs.map(function (d) { return d.name; }), CLAY_TOOLS);
  var REVIEW_TOOLS = ["list_log_feedback", "review_log_comment"];
  for (var i = 0; i < projectDefs.length; i++) {
    var expected = REVIEW_TOOLS.indexOf(projectDefs[i].name) !== -1
      ? logsMcp.REVIEW_CONTRACT
      : logsMcp.LOGS_CONTRACT;
    assert.ok(projectDefs[i].description.indexOf(expected) === 0, projectDefs[i].name + " carries the right contract");
  }
  // The review guidance rejects both obedience and nitpicking.
  assert.match(logsMcp.REVIEW_CONTRACT, /never an automatic change/);
  assert.match(logsMcp.REVIEW_CONTRACT, /Do not simply obey/);
  assert.match(logsMcp.REVIEW_CONTRACT, /Do not nitpick/);
  assert.match(logsMcp.REVIEW_CONTRACT, /materially change the durable record/);
  assert.match(logsMcp.REVIEW_CONTRACT, /Decline transparently/i);
  assert.equal(logsMcp.createMcpServer(null, null, false), null);
});


// --- Adaptive vocabulary over the WebSocket -------------------------------

test("the list response carries this project's own evolving vocabulary", function () {
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  agent.createLog({ kind: "decision", title: "Pick a datastore", summary: "Chose JSONL." });
  agent.createLog({ kind: "Release Process", title: "Weekly train", summary: "Cut weekly." });
  var owner = ws({ id: "owner", displayName: "Owner" });

  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v1", query: "" });
  var state = last(f.sent);
  assert.deepEqual(state.categories, ["decision", "release-process"],
    "a coined category is normalized and appears in the vocabulary");
  assert.equal(state.entries.length, 2);

  // Filtering by the coined category works, and by an unused one returns none.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v2", query: "", category: "release-process" });
  assert.equal(last(f.sent).entries.length, 1);
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v3", query: "", category: "never-used" });
  assert.equal(last(f.sent).type, "project_logs_state");
  assert.equal(last(f.sent).entries.length, 0);

  // A supplied malformed category is refused with a correctable message rather
  // than silently widening the ledger back to everything.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v4", query: "", category: "../etc/passwd" });
  var refused = last(f.sent);
  assert.equal(refused.type, "project_logs_error", "a hostile filter is refused, not ignored");
  assert.equal(refused.requestId, "v4");
  assert.match(refused.message, /path characters/);

  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v6", query: "", category: "!!!" });
  assert.equal(last(f.sent).type, "project_logs_error");

  // An absent category is still simply no filter.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v7", query: "" });
  assert.equal(last(f.sent).type, "project_logs_state");
  assert.equal(last(f.sent).entries.length, 2);

  // Search reports the vocabulary too.
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "v5", query: "datastore" });
  assert.deepEqual(last(f.sent).categories, ["decision", "release-process"]);
});

test("a shared project shares one vocabulary because it shares one store", function () {
  var f = fixture();
  // Two different sessions in the same project write different categories.
  f.service.bindProjectSession({ projectSlug: "app", session: f.session })
    .createLog({ kind: "decision", title: "From the owner session", summary: "One." });
  f.service.bindProjectSession({ projectSlug: "app", session: f.otherSession })
    .createLog({ kind: "clinical-safety", title: "From the member session", summary: "Two." });

  var owner = ws({ id: "owner", displayName: "Owner" });
  var member = ws({ id: "member", displayName: "Member" });
  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "sh1", query: "" });
  var ownerView = last(f.sent).categories;
  f.attached.handleLogsMessage(member, { type: "project_logs_list", requestId: "sh2", query: "" });
  var memberView = last(f.sent).categories;

  assert.deepEqual(ownerView, ["clinical-safety", "decision"]);
  assert.deepEqual(memberView, ownerView, "both members of a shared project see the same vocabulary");
});

test("the MCP schemas constrain category by shape, never by enum", function () {
  var project = logsMcp.getToolDefs(null, false);
  var clay = logsMcp.getToolDefs(null, true);
  var all = project.concat(clay);
  for (var i = 0; i < all.length; i++) {
    var shape = all[i].inputSchema || {};
    var kind = shape.kind;
    if (!kind) continue;
    // buildShape turns an enum into a zod enum; a plain string stays a string.
    // Serializing the whole definition catches an enum however it is nested.
    var described = JSON.stringify(kind._def || {});
    assert.equal(/"type":"enum"|entries/.test(described), false, all[i].name + " must not enumerate categories");
    assert.match(described, /"type":"string"/, all[i].name + " constrains category by shape");
  }
  // Priority remains an enum, because urgency is a fixed scale.
  var create = project.filter(function (t) { return t.name === "create_log"; })[0];
  assert.ok(create.inputSchema.priority, "priority is still constrained");
  assert.match(JSON.stringify(create.inputSchema.priority._def), /"type":"enum"/, "priority is still an enum");
  // The category guidance lives on the parameter the agent actually fills in.
  var kindDescription = create.inputSchema.kind.description || "";
  assert.match(kindDescription, /this project's own vocabulary, not a fixed list/i);
  assert.match(kindDescription, /reuse an established category/i);
  assert.match(kindDescription, /coin a new concise one only when/i);
  assert.match(kindDescription, /dry metadata, never a persona/i);
  assert.match(kindDescription, /lowercase hyphen-separated/i);
  assert.match(kindDescription, /any script/i);
  assert.match(create.description, /this project's own evolving vocabulary rather than a fixed list/i);
  assert.equal(logsMcp.CATEGORIES, undefined, "no global category set is exported");
  assert.ok(logsMcp.SEED_CATEGORIES.length > 0, "seeds exist as guidance only");
  assert.match(logsMcp.LOGS_CONTRACT, /evolving vocabulary rather than a fixed list/);
});


test("a malformed category filter is refused through the MCP tools too", async function () {
  var f = fixture();
  f.service.bindProjectSession({ projectSlug: "app", session: f.session })
    .createLog({ kind: "decision", title: "Seed", summary: "Seeded." });
  var defs = f.attached.getToolDefs(f.session);
  function tool(name) {
    for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
    throw new Error("missing " + name);
  }

  var listed = await tool("list_logs").handler({ kind: "../etc" });
  assert.equal(listed.isError, true, "the agent is told its filter was invalid");
  assert.match(listed.content[0].text, /path characters/);
  var searched = await tool("search_logs").handler({ query: "seed", kind: "!!!" });
  assert.equal(searched.isError, true);

  // Valid-but-unused still returns an ordinary empty result with the vocabulary.
  var unused = JSON.parse((await tool("list_logs").handler({ kind: "never-used" })).content[0].text);
  assert.equal(unused.total, 0);
  assert.deepEqual(unused.categories, ["decision"]);

  // Absent is no filter.
  var all = JSON.parse((await tool("list_logs").handler({})).content[0].text);
  assert.equal(all.total, 1);
});

// --- Review workflow surfaces --------------------------------------------

test("the pending-feedback signal is a count, never comment bodies", function () {
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var entry = agent.createLog({ kind: "decision", title: "Adopt X", summary: "Chose X." });

  var quiet = f.attached.getSystemPrompt(f.session);
  assert.equal(/awaits? your review/.test(quiet), false, "no signal when nothing is pending");
  assert.match(quiet, /Project Logs are this project's durable work-continuity record/);
  assert.match(quiet, /never an automatic change/, "the review contract is present from the start");

  var owner = ws({ id: "owner", displayName: "Owner" });
  f.attached.handleLogsMessage(owner, {
    type: "project_log_comment", requestId: "p1", ref: entry.ref,
    body: "SECRET-COMMENT-TEXT that must never reach the prompt.",
  });

  var signalled = f.attached.getSystemPrompt(f.session);
  assert.match(signalled, /1 comment awaits your review\. Call list_log_feedback to see them\./);
  assert.equal(signalled.indexOf("SECRET-COMMENT-TEXT"), -1, "the body stays in the tool");
  assert.equal(signalled.indexOf(entry.ref), -1, "not even the ref is dumped");

  // Plural form, and the signal drains once reviewed.
  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "p2", ref: entry.ref, body: "Second." });
  assert.match(f.attached.getSystemPrompt(f.session), /2 comments await your review/);
  // A clarification hands the ball to the user, so it leaves the count.
  var beforeClarify = agent.listLogFeedback({});
  agent.reviewLogComment({ ref: entry.ref, commentId: beforeClarify.feedback[0].commentId, action: "clarify", response: "Which part?" });
  assert.match(f.attached.getSystemPrompt(f.session), /1 comment awaits your review/);
  var open = agent.listLogFeedback({});
  agent.reviewLogComment({ ref: entry.ref, commentId: open.feedback[0].commentId, action: "decline", response: "Out of scope." });
  assert.equal(/awaits? your review/.test(f.attached.getSystemPrompt(f.session)), false);
});

test("review and revision tools are Driver-only over MCP", async function () {
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var entry = agent.createLog({ kind: "decision", title: "Adopt X", summary: "Chose X." });
  f.service.bindUser({ projectSlug: "app", user: { id: "owner" } })
    .commentLog({ ref: entry.ref, body: "Please mention Y." });

  var defs = f.attached.getToolDefs(f.session);
  function tool(name) {
    for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
    throw new Error("missing " + name);
  }

  var feedback = JSON.parse((await tool("list_log_feedback").handler({})).content[0].text);
  assert.equal(feedback.total, 1);
  assert.equal(feedback.feedback[0].title, "Adopt X");
  assert.ok(feedback.feedback[0].commentId);

  // Clarify creates no revision.
  var clarified = JSON.parse((await tool("review_log_comment").handler({
    ref: entry.ref, commentId: feedback.feedback[0].commentId, action: "clarify", response: "Which Y?",
  })).content[0].text);
  assert.equal(clarified.revisions, 1);
  assert.equal(clarified.comments[0].status, "clarification-needed");

  // Incorporate requires an actual change.
  var second = JSON.parse((await tool("read_log").handler({ ref: entry.ref })).content[0].text);
  assert.ok(second.history, "read_log carries bounded history metadata");
  assert.equal(second.history[0].body, undefined, "history never carries bodies");

  var revision = JSON.parse((await tool("read_log_revision").handler({ ref: entry.ref, revision: 1 })).content[0].text);
  assert.equal(revision.snapshot.title, "Adopt X");

  await tool("update_log").handler({ ref: entry.ref, title: "Adopt X, revised" });
  var reverted = JSON.parse((await tool("revert_log").handler({
    ref: entry.ref, revision: 1, reason: "The revision was premature.",
  })).content[0].text);
  assert.equal(reverted.title, "Adopt X");
  assert.equal(reverted.revisions, 3, "a revert is a new revision, not an erasure");

  var noop = await tool("revert_log").handler({ ref: entry.ref, revision: 3, reason: "again" });
  assert.equal(noop.isError, true);
  var noReason = await tool("revert_log").handler({ ref: entry.ref, revision: 1 });
  assert.equal(noReason.isError, true);

  // Clay is advertised none of these.
  var clayNames = logsMcp.getToolDefs(null, true).map(function (t) { return t.name; });
  ["list_log_feedback", "review_log_comment", "revert_log"].forEach(function (name) {
    assert.equal(clayNames.indexOf(name), -1, "Clay must not see " + name);
  });
  assert.ok(clayNames.indexOf("read_project_log_revision") !== -1, "but Clay can read a revision");
});

test("ledger rows report pending feedback without comment bodies", function () {
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var entry = agent.createLog({ kind: "decision", title: "Adopt X", summary: "Chose X." });
  var owner = ws({ id: "owner", displayName: "Owner" });
  f.attached.handleLogsMessage(owner, { type: "project_log_comment", requestId: "c1", ref: entry.ref, body: "BODY-TEXT" });

  f.attached.handleLogsMessage(owner, { type: "project_logs_list", requestId: "c2", query: "" });
  var row = last(f.sent).entries[0];
  assert.equal(row.pendingFeedbackCount, 1);
  assert.equal(row.commentCount, 1);
  assert.equal(row.comments, undefined, "a row never carries comment bodies");
  assert.equal(JSON.stringify(row).indexOf("BODY-TEXT"), -1);

  // The detail read does carry them, with review state.
  f.attached.handleLogsMessage(owner, { type: "project_log_read", requestId: "c3", ref: entry.ref });
  var detail = last(f.sent).entry;
  assert.equal(detail.comments[0].body, "BODY-TEXT");
  assert.equal(detail.comments[0].status, "pending");
  assert.ok(Array.isArray(detail.history), "and bounded revision metadata");
});


test("the prompt count reflects every live entry, not just the first page", function () {
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var oldest = agent.createLog({ kind: "decision", title: "The oldest entry", summary: "Written first." });
  var owner = ws({ id: "owner", displayName: "Owner" });
  f.attached.handleLogsMessage(owner, {
    type: "project_log_comment", requestId: "d1", ref: oldest.ref, body: "Needs a correction.",
  });

  for (var i = 0; i < 60; i++) {
    agent.createLog({ kind: "progress", title: "Later " + i, summary: "Filler." });
  }

  // The oldest entry is far off the first page, and the signal still finds it.
  assert.match(f.attached.getSystemPrompt(f.session), /1 comment awaits your review/);
  var feedback = agent.listLogFeedback({});
  assert.equal(feedback.total, 1);
  assert.equal(feedback.feedback[0].ref, oldest.ref);
  assert.equal(feedback.feedback[0].title, "The oldest entry");

  // Still a count only.
  var prompt = f.attached.getSystemPrompt(f.session);
  assert.equal(prompt.indexOf("Needs a correction"), -1);
  assert.equal(prompt.indexOf(oldest.ref), -1);
});

// --- Learning moments ----------------------------------------------------

test("the guidance names both kinds of learning moment", function () {
  var learning = logsMcp.LEARNING_CONTRACT;

  assert.match(learning, /exclusively about the user's learning/i);
  assert.match(learning, /never a record of something you, the Driver, learned or discovered/i);

  // (a) a direct conceptual question.
  assert.match(learning, /user asks a conceptual question directly/i);
  assert.match(learning, /durable and relevant to this project/i);

  // (b) the vague intuition that gets a precise name, which is the easy one to miss.
  assert.match(learning, /user describes something in their own approximate words/i);
  assert.match(learning, /precise term, model, or mechanism/i);
  assert.match(learning, /easier to miss/i);

  // The worked example is present and correct in both directions.
  assert.match(learning, /the background is transparent and blurry/i, "the person's original wording");
  assert.match(learning, /backdrop blur/i, "the concept it maps to");
  assert.match(learning, /backdrop-filter/i, "and the precise mechanism");
  assert.match(learning, /should not evaporate/i);

  // The four things a learning entry must record.
  assert.match(learning, /original wording or mental model/i);
  assert.match(learning, /the precise concept it corresponds to/i);
  assert.match(learning, /why and how it applies in this project/i);
  assert.match(learning, /boundary or common misconception/i);
  assert.match(learning, /teach at a glance/i);
});

test("capture is the default, without fabrication or grading", function () {
  var learning = logsMcp.LEARNING_CONTRACT;
  assert.match(learning, /always capture once these criteria are met/i);
  assert.match(learning, /the default rather than a judgement call/i);

  // Honesty guards.
  assert.match(learning, /Never fabricate a learning moment/i);
  assert.match(learning, /never claim someone learned something they did not actually engage with/i);

  // Respectful attribution, not assessment of the person.
  assert.match(learning, /clarified in discussion/i);
  assert.match(learning, /Never grade, rank, or characterise/i);
  assert.equal(/\b(the user|they) (failed|did not know|was ignorant|struggled)/i.test(learning), false,
    "the guidance never characterises the person's knowledge");
});

test("noise exclusions and the update-not-duplicate rule are explicit", function () {
  var learning = logsMcp.LEARNING_CONTRACT;
  assert.match(learning, /engineering lessons/i);
  assert.match(learning, /repository discoveries/i);
  assert.match(learning, /investigation outcomes/i);
  assert.match(learning, /defect causes/i);
  assert.match(learning, /implementation insights/i);
  assert.match(learning, /use an appropriate category such as `investigation`, `defect`, `decision`, or `reference`/i);
  assert.match(learning, /routine command syntax/i);
  assert.match(learning, /trivial confirmations/i);
  assert.match(learning, /facts the user clearly already knows/i);
  assert.match(learning, /every explanation you happen to give/i);
  assert.match(learning, /user's conceptual model becomes measurably more precise/i);
  assert.match(learning, /refines or supersedes an existing learning entry, revise that entry/i);
  assert.match(learning, /instead of adding a near-duplicate/i);
});

test("learning stays an adaptive category, never an enum", function () {
  assert.match(logsMcp.LEARNING_CONTRACT, /normally under the category `learning`/,
    "learning is a suggested default, not a required value");

  // The category argument is still a plain string constrained only by shape.
  var create = logsMcp.getToolDefs(null, false).filter(function (t) { return t.name === "create_log"; })[0];
  var described = JSON.stringify(create.inputSchema.kind._def || {});
  assert.equal(/"type":"enum"|entries/.test(described), false, "still no enumeration");
  assert.match(described, /"type":"string"/);
  assert.equal(logsMcp.SEED_CATEGORIES.indexOf("learning"), -1,
    "learning is not bolted onto the seed list either");
  assert.match(create.inputSchema.kind.description, /this project's own vocabulary, not a fixed list/i);
  assert.match(create.inputSchema.kind.description, /learning.*only for a user learning moment/i);
  assert.match(create.inputSchema.kind.description, /never for knowledge or lessons acquired by the Driver/i);

  // A project may actually use it, and it normalizes like any other label.
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var entry = agent.createLog({
    kind: "Learning", priority: "normal",
    title: "Blurred translucent backgrounds are backdrop blur",
    summary: "Concept clarified in discussion: the translucent blurred panel effect is backdrop blur, applied with CSS backdrop-filter.",
    body: "Original wording: the background is transparent and blurry.\\n\\nConcept: backdrop blur via `backdrop-filter`.\\n\\nBoundary: `filter` blurs the element itself; `backdrop-filter` blurs what is behind it.",
  });
  assert.equal(entry.category, "learning", "free text normalizes to the project-local label");
  assert.equal(agent.listLogs({ kind: "learning" }).total, 1);
  assert.ok(agent.listLogs({}).categories.indexOf("learning") !== -1,
    "and it joins this project's vocabulary like any other category");
});

test("the learning guidance reaches the Driver without injecting record content", function () {
  var f = fixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  agent.createLog({
    kind: "learning",
    title: "Backdrop blur",
    summary: "Concept clarified in discussion.",
    body: "PRIVATE-LEARNING-BODY that must never reach the prompt.",
  });

  var prompt = f.attached.getSystemPrompt(f.session);
  assert.match(prompt, /Capture durable user learning moments as Project Logs/);
  assert.match(prompt, /backdrop-filter/, "the worked example is guidance, so it is expected");

  // Guidance only: no ledger content, refs, titles, or counts of records.
  assert.equal(prompt.indexOf("PRIVATE-LEARNING-BODY"), -1, "no record body is injected");
  assert.equal(prompt.indexOf("Concept clarified in discussion."), -1, "no record summary is injected");
  assert.equal(/log:[A-Za-z0-9_-]{24}/.test(prompt), false, "no entry reference is injected");

  // An unbound or Mate session gets nothing at all.
  assert.equal(f.attached.getSystemPrompt({ localId: 11, ownerId: "owner" }), "");
  assert.equal(fixture({ mate: true, builtinKey: "researcher" }).attached.getSystemPrompt(null), "");
});

test("learning capture does not alter who may author or review", function () {
  var f = fixture();
  var owner = ws({ id: "owner", displayName: "Owner" });
  // A human still cannot write a learning entry canonically.
  f.attached.handleLogsMessage(owner, {
    type: "project_log_create", requestId: "l1", kind: "learning",
    title: "Human learning entry", summary: "No.", body: "No.",
  });
  assert.equal(last(f.sent).type, "project_logs_error");
  assert.match(last(f.sent).message, /agent sessions/);

  // Ordinary Mates still see no Logs tools, and Clay stays read-only.
  var ordinary = fixture({ mate: true, builtinKey: "researcher" });
  assert.deepEqual(ordinary.attached.getToolDefs(ordinary.mateSession), []);
  var clayNames = logsMcp.getToolDefs(null, true).map(function (t) { return t.name; });
  assert.equal(clayNames.filter(function (n) { return /create|update|review|revert/.test(n); }).length, 0);
});

// --- Canonical update broadcast ------------------------------------------

// The fixture's sendTo pushes to one array; a broadcast fixture needs to see
// which sockets were written to.
function broadcastFixture(opts) {
  var options = opts || {};
  var session = { localId: 11, cliSessionId: "cli-11", ownerId: "owner", vendor: "claude" };
  var mateSession = { localId: 21, cliSessionId: "cli-21", ownerId: "owner", vendor: "claude" };
  var projects = new Map();
  projects.set("app", handle({ slug: "app", path: "/srv/app", projectOwnerId: "owner", visibility: "private", allowedUsers: ["member"] }, [session]));
  projects.set("mate-home", handle({ slug: "mate-home", path: "/srv/mate-home", projectOwnerId: "owner", isMate: true, mateId: "mate-id" }, [mateSession]));

  var service = attachService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function (ownerId, mateId) { return { id: mateId, createdBy: ownerId, builtinKey: "clay" }; },
    canAccessProject: function (userId, status) {
      if (!status) return false;
      if (status.projectOwnerId === userId) return true;
      return (status.allowedUsers || []).indexOf(userId) >= 0;
    },
    findUserById: function (id) { return { id: id, displayName: id }; },
    openStore: storeFactory(),
  });

  // Two authorized humans and one pane connection on the same project.
  var owner = { _clayUser: { id: "owner", displayName: "Owner" }, readyState: 1, sent: [] };
  var member = { _clayUser: { id: "member", displayName: "Member" }, readyState: 1, sent: [] };
  var pane = { _clayUser: { id: "owner" }, readyState: 1, _clayPane: true, sent: [] };
  var closed = { _clayUser: { id: "owner" }, readyState: 3, sent: [] };
  var clients = [owner, member, pane, closed];

  var attached = attachProjectLogs({
    service: service,
    sm: projects.get(options.mate ? "mate-home" : "app").getSessionManager(),
    projectSlug: options.mate ? "mate-home" : "app",
    getProjectOwnerId: function () { return "owner"; },
    isMate: !!options.mate,
    mateId: options.mate ? "mate-id" : null,
    sendTo: function (target, message) { target.sent.push(message); },
    getClients: function () { return clients; },
  });

  return { attached: attached, service: service, session: session, mateSession: mateSession,
    owner: owner, member: member, pane: pane, closed: closed };
}

function notices(socket) {
  return socket.sent.filter(function (m) { return m.type === "project_log_updated"; });
}

function reviewNotices(socket) {
  return socket.sent.filter(function (m) { return m.type === "project_log_comment_reviewed"; });
}

test("every canonical write notifies authorized project humans with bounded metadata", function () {
  var f = broadcastFixture();
  var defs = f.attached.getToolDefs(f.session);
  function tool(name) {
    for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
    throw new Error("missing " + name);
  }

  tool("create_log").handler({
    kind: "decision", title: "Adopt append-only logs",
    summary: "Chose an append-only journal.", body: "SECRET-BODY-TEXT",
  });

  assert.equal(notices(f.owner).length, 1);
  assert.equal(notices(f.member).length, 1, "a shared-project member is notified too");
  assert.equal(notices(f.pane).length, 0, "pane connections are excluded");
  assert.equal(notices(f.closed).length, 0, "a closed socket is skipped");

  var notice = notices(f.owner)[0];
  assert.deepEqual(Object.keys(notice).sort(),
    ["at", "category", "op", "priority", "ref", "revision", "summary", "title", "type", "vendor"].sort());
  assert.equal(notice.op, "create");
  assert.equal(notice.revision, 1);
  assert.equal(notice.category, "decision");
  assert.equal(notice.title, "Adopt append-only logs");
  assert.equal(notice.vendor, "claude");
  assert.match(notice.ref, logsStore.REF_PATTERN);

  // No body, no comments, no identity.
  var serialized = JSON.stringify(notice);
  assert.equal(serialized.indexOf("SECRET-BODY-TEXT"), -1, "never the record body");
  assert.equal(/body|comments|userId|displayName|sessionKey/.test(serialized), false,
    "no body, comment text, or human identity");

  // Every canonical op notifies, each with its own revision number.
  var ref = notice.ref;
  tool("update_log").handler({ ref: ref, title: "Adopt append-only logs (revised)" });
  tool("link_log").handler({ ref: ref, links: "[{\"ref\":\"session:abc\"}]" });
  tool("revert_log").handler({ ref: ref, revision: 1, reason: "Premature." });
  var ops = notices(f.owner).map(function (m) { return m.op; });
  assert.deepEqual(ops, ["create", "update", "link", "revert"]);
  assert.deepEqual(notices(f.owner).map(function (m) { return m.revision; }), [1, 2, 3, 4]);
});

test("participation and failed writes never notify", function () {
  var f = broadcastFixture();
  var agent = f.service.bindProjectSession({ projectSlug: "app", session: f.session });
  var entry = agent.createLog({ kind: "decision", title: "Adopt X", summary: "Chose X." });
  var defs = f.attached.getToolDefs(f.session);
  function tool(name) {
    for (var i = 0; i < defs.length; i++) if (defs[i].name === name) return defs[i];
    throw new Error("missing " + name);
  }
  f.owner.sent = [];

  // A human comment is not a canonical write.
  f.attached.handleLogsMessage(f.owner, {
    type: "project_log_comment", requestId: "n1", ref: entry.ref, body: "A note.",
  });
  assert.equal(notices(f.owner).length, 0, "a comment does not notify");
  var commentId = f.owner.sent[f.owner.sent.length - 1].entry.comments[0].id;

  tool("review_log_comment").handler({ ref: entry.ref, commentId: commentId, action: "clarify", response: "Which part?" });
  assert.equal(notices(f.owner).length, 0, "a clarification does not notify");
  assert.deepEqual(reviewNotices(f.owner)[0], {
    type: "project_log_comment_reviewed", ref: entry.ref, commentId: commentId, action: "clarify",
  });
  assert.equal(reviewNotices(f.member).length, 1, "shared project viewers receive the review result");
  assert.equal(reviewNotices(f.pane).length, 0, "pane connections remain excluded");

  var second = agent.commentLog({ ref: entry.ref, body: "Second." }).comments[1].id;
  tool("review_log_comment").handler({ ref: entry.ref, commentId: second, action: "decline", response: "Out of scope." });
  assert.equal(notices(f.owner).length, 0, "a decline does not notify");
  assert.equal(reviewNotices(f.owner)[1].action, "decline");

  // An incorporation does, because it is a revision.
  var third = agent.commentLog({ ref: entry.ref, body: "Summary is thin." }).comments[2].id;
  tool("review_log_comment").handler({
    ref: entry.ref, commentId: third, action: "incorporate", response: "Expanded.", summary: "Chose X, expanded.",
  });
  assert.equal(notices(f.owner).length, 1);
  assert.equal(notices(f.owner)[0].op, "incorporate");
  assert.equal(notices(f.owner)[0].revision, 2);
  assert.equal(reviewNotices(f.owner)[2].action, "incorporate");

  // Failures and no-ops are silent.
  f.owner.sent = [];
  tool("update_log").handler({ ref: entry.ref });
  tool("revert_log").handler({ ref: entry.ref, revision: 2, reason: "no change" });
  tool("create_log").handler({ kind: "decision", title: "No summary" });
  assert.equal(notices(f.owner).length, 0, "a rejected write never notifies");
});

test("a Mate project never broadcasts a ledger update", function () {
  var f = broadcastFixture({ mate: true });
  assert.deepEqual(f.attached.getToolDefs(f.mateSession).map(function (t) { return t.name; }), CLAY_TOOLS,
    "Clay sees only read tools, so there is nothing that could notify");
  assert.equal(notices(f.owner).length, 0);
  assert.equal(notices(f.member).length, 0);
  assert.equal(logsMcp.getToolDefs(null, true).filter(function (t) {
    return /create|update|link|review|revert/.test(t.name);
  }).length, 0);
});

test("the update message is registered and carries no body by contract", function () {
  assert.ok(schema["project_log_updated"], "registered in ws-schema");
  assert.equal(schema["project_log_updated"].direction, "s2c");
  assert.match(schema["project_log_updated"].description, /bounded ledger metadata only/i);
  assert.deepEqual(projectLogs.NOTIFYING_OPS, ["create", "update", "link", "incorporate", "revert", "delete"]);
  assert.ok(schema["project_log_comment_reviewed"], "comment review completion is registered");
  assert.equal(schema["project_log_comment_reviewed"].direction, "s2c");

  // The notice builder clips long text and drops everything else.
  var notice = projectLogs.updateNotice({
    ref: "log:aaaaaaaaaaaaaaaaaaaaaaaa", revisions: 3, category: "decision", priority: "urgent",
    title: "T".repeat(500), summary: "S".repeat(900), body: "SECRET", updatedAt: 42,
    updatedBy: { type: "session", vendor: "codex", userId: "owner", displayName: "Owner" },
    comments: [{ body: "SECRET-COMMENT" }],
  }, "update");
  assert.equal(notice.title.length, 160);
  assert.equal(notice.summary.length, 240);
  assert.equal(notice.vendor, "codex");
  assert.equal(notice.body, undefined);
  assert.equal(notice.comments, undefined);
  assert.equal(JSON.stringify(notice).indexOf("SECRET"), -1);
  assert.equal(JSON.stringify(notice).indexOf("Owner"), -1, "no human identity in the payload");
});
