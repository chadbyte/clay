var test = require("node:test");
var assert = require("node:assert/strict");
var visibility = require("../lib/session-visibility");
var access = require("../lib/daemon-project-access");
var createSessionManager = require("../lib/sessions").createSessionManager;
var attachSessions = require("../lib/project-sessions").attachSessions;
var spawnSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/project-session-spawn.js"), "utf8");
var delegatedSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/project-delegated-session.js"), "utf8");
var feedbackSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/project-log-feedback-delivery.js"), "utf8");
var projectSessionsSource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/project-sessions.js"), "utf8");

function users(user) {
  return {
    isMultiUser: function() { return true; },
    findUserById: function() { return user; },
    getEffectivePermissions: function() { return { projectSettings: !!user.canSet }; },
  };
}

test("new ordinary sessions default private unless the project explicitly shares", function() {
  assert.equal(visibility.defaultForProject(null), "private");
  assert.equal(visibility.defaultForProject({}), "private");
  assert.equal(visibility.defaultForProject({ sessionVisibilityDefault: "private" }), "private");
  assert.equal(visibility.defaultForProject({ sessionVisibilityDefault: "shared" }), "shared");
  assert.deepEqual(visibility.resolveNewSessionVisibility({ sessionVisibilityDefault: "shared" }, {}, false), { visibility: "shared" });
  assert.deepEqual(visibility.resolveNewSessionVisibility({ sessionVisibilityDefault: "shared" }, { sessionVisibility: "private" }, false), { visibility: "private" });
  assert.deepEqual(visibility.resolveNewSessionVisibility({ sessionVisibilityDefault: "private" }, { sessionVisibility: "shared" }, false), { visibility: "shared" });
  assert.match(visibility.resolveNewSessionVisibility({}, { sessionVisibility: "public" }, false).error, /private or shared/);
  assert.deepEqual(visibility.resolveNewSessionVisibility({ sessionVisibilityDefault: "shared" }, { sessionVisibility: "shared" }, true), { visibility: "private" });
});

test("only the authorized owner can change the default, including an administrator owner", function() {
  var changes = [];
  var messages = [];
  var ctx = {
    slug: "alpha", osUsers: false, getProjectAccess: function() { return { ownerId: "owner" }; },
    opts: { onSetProjectSessionVisibilityDefault: function(slug, value) { changes.push([slug, value]); return { ok: true, visibility: value }; } },
    sendTo: function(ws, message) { messages.push(message); },
  };
  var member = { id: "member", role: "member", canSet: true };
  ctx.usersModule = users(member);
  visibility.handleDefaultChange(ctx, { _clayUser: member }, { slug: "alpha", visibility: "shared" });
  assert.deepEqual(changes, []);
  assert.equal(messages[0].ok, false);
  var owner = { id: "owner", role: "member", canSet: true };
  ctx.usersModule = users(owner);
  visibility.handleDefaultChange(ctx, { _clayUser: owner }, { slug: "alpha", visibility: "shared", requestId: "visibility-owner" });
  assert.deepEqual(changes, [["alpha", "shared"]]);
  assert.equal(messages[messages.length - 1].requestId, "visibility-owner");
  assert.equal(messages[messages.length - 1].slug, "alpha");
  var admin = { id: "admin", role: "admin", canSet: true };
  ctx.usersModule = users(admin);
  visibility.handleDefaultChange(ctx, { _clayUser: admin }, { slug: "alpha", visibility: "private" });
  assert.deepEqual(changes, [["alpha", "shared"]]);
  assert.equal(messages[messages.length - 1].ok, false);
  admin.id = "owner";
  visibility.handleDefaultChange(ctx, { _clayUser: admin }, { slug: "alpha", visibility: "private" });
  assert.deepEqual(changes, [["alpha", "shared"], ["alpha", "private"]]);
  visibility.handleDefaultChange(ctx, { _clayUser: admin }, { slug: "alpha", visibility: "public" });
  assert.equal(changes.length, 2);
  assert.equal(messages[messages.length - 1].slug, "alpha");
  assert.equal(messages[messages.length - 1].ok, false);
  visibility.handleDefaultChange(ctx, { _clayUser: admin }, { slug: "beta", visibility: "shared", requestId: "visibility-beta" });
  assert.equal(changes.length, 2);
  assert.equal(messages[messages.length - 1].slug, "beta");
  assert.equal(messages[messages.length - 1].requestId, "visibility-beta");
  assert.equal(messages[messages.length - 1].ok, false);
});

test("another project is authorised from its own access record, never from the client slug", function() {
  var changes = [], messages = [];
  var records = { beta: { ownerId: "owner" }, shared: { ownerId: "someone" }, wt: { ownerId: "owner", isWorktree: true }, gone: { error: "unknown" } };
  var accessible = { beta: true, shared: true, wt: true, gone: true };
  var user = { id: "owner", role: "member", canSet: true };
  var ctx = {
    slug: "alpha", osUsers: false, usersModule: users(user), getProjectAccess: function() { return { ownerId: "owner" }; },
    getTargetAccess: function(slug) { return records[slug]; },
    canAccessProjectSlug: function(ws, slug) { return accessible[slug] === true; },
    opts: { onSetProjectSessionVisibilityDefault: function(slug, value) { changes.push([slug, value]); return { ok: true, visibility: value }; } },
    sendTo: function(ws, message) { messages.push(message); },
  };
  var ws = { _clayUser: user };
  visibility.handleDefaultChange(ctx, ws, { slug: "beta", visibility: "shared", requestId: "b1" });
  assert.deepEqual(changes, [["beta", "shared"]], "only the targeted project changes");
  assert.equal(messages[0].slug, "beta"); assert.equal(messages[0].requestId, "b1"); assert.equal(messages[0].ok, true);
  visibility.handleDefaultChange(ctx, ws, { slug: "alpha", visibility: "private" });
  assert.deepEqual(changes, [["beta", "shared"], ["alpha", "private"]]);
  [["shared", /not permitted/], ["wt", /inherit/], ["gone", /not permitted/], ["mate-x", /not permitted/], ["missing", /not permitted/]].forEach(function(entry) {
    visibility.handleDefaultChange(ctx, ws, { slug: entry[0], visibility: "shared" });
    assert.equal(messages[messages.length - 1].ok, false); assert.match(messages[messages.length - 1].error, entry[1]);
    assert.equal(messages[messages.length - 1].slug, entry[0]);
  });
  accessible.beta = false;
  visibility.handleDefaultChange(ctx, ws, { slug: "beta", visibility: "private" });
  assert.equal(messages[messages.length - 1].ok, false, "an inaccessible target is refused even for its owner");
  accessible.beta = true;
  user.canSet = false;
  visibility.handleDefaultChange(ctx, ws, { slug: "beta", visibility: "private" });
  assert.equal(messages[messages.length - 1].ok, false, "the projectSettings permission is still required");
  assert.equal(changes.length, 2);
  var bare = Object.assign({}, ctx, { getTargetAccess: null }); user.canSet = true;
  visibility.handleDefaultChange(bare, ws, { slug: "beta", visibility: "private" });
  assert.equal(changes.length, 2, "without the access resolver another project is never changed");
  var mateWorkspace = Object.assign({}, ctx, { isMate: true });
  visibility.handleDefaultChange(mateWorkspace, ws, { slug: "beta", visibility: "private" });
  assert.deepEqual(changes[2], ["beta", "private"], "a Mate workspace socket may still change an ordinary project it owns");
  visibility.handleDefaultChange(mateWorkspace, ws, { slug: "alpha", visibility: "private" });
  assert.equal(changes.length, 3, "but not its own Mate project");
});

test("project access persists the explicit choice and worktrees inherit it", function() {
  var config = { projects: [{ slug: "alpha", sessionVisibilityDefault: "shared" }] };
  assert.equal(access.getProjectAccess(config, "alpha", false).sessionVisibilityDefault, "shared");
  assert.equal(access.getProjectAccess(config, "alpha--branch", false).sessionVisibilityDefault, "shared");
  delete config.projects[0].sessionVisibilityDefault;
  assert.equal(access.getProjectAccess(config, "alpha", false).sessionVisibilityDefault, "private");
});

test("daemon setting persistence mutates only parent projects and survives config round-trip", function() {
  var config = { projects: [{ slug: "alpha", sessionVisibilityDefault: "shared", title: "Alpha" }] };
  assert.deepEqual(access.setSessionVisibilityDefault(config, "alpha", "private"), { ok: true, visibility: "private" });
  assert.equal(config.projects[0].sessionVisibilityDefault, undefined);
  var restored = JSON.parse(JSON.stringify(config));
  assert.equal(access.getProjectAccess(restored, "alpha", false).sessionVisibilityDefault, "private");
  assert.match(access.setSessionVisibilityDefault(restored, "alpha--feature", "shared").error, /inherit/);
  assert.equal(restored.projects[0].sessionVisibilityDefault, undefined);
});

function sessionsFixture(isMate) {
  var accessState = { ownerId: "owner", sessionVisibilityDefault: "shared" };
  var created = [];
  var existing = null;
  var sent = [];
  var manager = {
    defaultVendor: "codex", currentEffort: "low", lastVendor: "codex",
    sweepBlankSessions: function() {},
    findReusableBlankSession: function() { return existing; },
    createSession: function(options) { var session = Object.assign({ localId: created.length + 1 }, options); created.push(session); return session; },
    switchSession: function() {},
    setSessionVisibility: function() { throw new Error("Must not mutate an existing blank"); },
  };
  var handler = attachSessions({
    cwd: "/tmp", slug: "alpha", isMate: !!isMate, sm: manager, sdk: {}, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function() { return true; } }, getProjectAccess: function() { return accessState; },
    send: function() {}, sendTo: function(ws, message) { sent.push(message); },
    userPresence: { setPresence: function() {}, sessionIdForPersistence: function(session) { return session.localId; } },
    broadcastPresence: function() {},
  });
  return {
    create: function(fields) { handler.handleSessionsMessage({ _clayUser: { id: "owner" } }, Object.assign({ type: "new_session", vendor: "codex", mode: "gui" }, fields || {})); return created[created.length - 1]; },
    access: accessState, setExisting: function(value) { existing = value; }, created: created, sent: sent,
  };
}

test("real new_session dispatch honors valid overrides and preserves existing/Mate privacy", function() {
  var f = sessionsFixture(false);
  assert.equal(f.create().sessionVisibility, "shared");
  assert.equal(f.create({ sessionVisibility: "private" }).sessionVisibility, "private");
  var count = f.created.length;
  f.create({ sessionVisibility: "public" });
  assert.equal(f.created.length, count);
  assert.match(f.sent[0].text, /private or shared/);
  var blank = { localId: 44, vendor: "codex", sessionVisibility: "private", sessionVisibilityExplicit: true };
  f.setExisting(blank);
  f.create();
  assert.equal(blank.sessionVisibility, "private");
  var mate = sessionsFixture(true);
  assert.equal(mate.create({ sessionVisibility: "shared" }).sessionVisibility, "private");
});

test("a shared default is stamped onto a new session and survives a later default change", function(t) {
  var fs = require("node:fs");
  var os = require("node:os");
  var path = require("node:path");
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-default-visibility-"));
  t.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
  var opts = { cwd: root, sessionsBase: path.join(root, "sessions"), cliSessionsDir: path.join(root, "cli"), send: function() {} };
  var sm = createSessionManager(opts);
  var session = sm.createSessionRaw({ ownerId: "owner", sessionVisibility: visibility.defaultForProject({ sessionVisibilityDefault: "shared" }) });
  session.cliSessionId = "new-shared-session";
  sm.saveSessionFile(session);
  assert.equal(session.sessionVisibility, "shared");
  assert.equal(session.sessionVisibilityExplicit, true);
  assert.equal(visibility.defaultForProject({ sessionVisibilityDefault: "private" }), "private");
  var restored = createSessionManager(opts);
  assert.equal(Array.from(restored.sessions.values())[0].sessionVisibility, "shared");
});

test("internal and delegated creation paths retain explicit private visibility", function() {
  assert.match(spawnSource, /sessionVisibility: "private"/);
  assert.match(delegatedSource, /sessionVisibility: "private"/);
  assert.match(feedbackSource, /sessionVisibility: "private"/);
  assert.match(projectSessionsSource, /sessionVisibility: "private"/);
  assert.match(projectSessionsSource, /sessionVisibility\.resolveNewSessionVisibility\(getProjectAccess\(\), msg, isMate\)/);
});

test("forks inherit their source visibility instead of reading the project default", function() {
  var historySource = require("node:fs").readFileSync(require("node:path").join(__dirname, "../lib/project-session-history-actions.js"), "utf8");
  assert.match(historySource, /sessionVisibility: sessionVisibility\.normalize\(session\.sessionVisibility\)/);
  assert.match(historySource, /sessionVisibilityExplicit: session\.sessionVisibilityExplicit === true/);
});


test("production local forks inherit each source visibility and reject a revoked source before creation", async function () {
  var created = [], revoked = false;
  var actions = require("../lib/project-session-history-actions").attachSessionHistoryActions({
    sm: { createSessionRaw: function (options) { var session = Object.assign({ localId: created.length + 1 }, options); created.push(session); return session; }, saveSessionFile: function () { return true; }, broadcastSessionList: function () {} },
    sdk: { forkSession: async function () { return { useLocalHistory: true, sessionId: "fixture-fork" }; } },
  });
  for (var mode of ["shared", "private"]) {
    var original = { ownerId: "owner", vendor: "codex", sessionVisibility: mode, history: [{ type: "user_message", text: "Retained" }], messageUUIDs: [] };
    var forked = await actions.fork(original, "fixture-uuid", null, function () { if (revoked) throw new Error("Source access revoked"); });
    assert.equal(forked.sessionVisibility, mode);
    assert.equal(forked.ownerId, "owner");
    assert.deepEqual(forked.history, original.history);
    revoked = true;
    await assert.rejects(actions.fork(original, "fixture-uuid", null, function () { throw new Error("Source access revoked"); }), /Source access revoked/);
    assert.equal(created.length, mode === "shared" ? 1 : 2);
    revoked = false;
  }
});
