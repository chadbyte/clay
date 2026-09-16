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

test("only an authorized owner or administrator can change the default", function() {
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
  assert.match(projectSessionsSource, /sessionVisibility: sessionVisibility\.normalize\(session\.sessionVisibility\)/);
  assert.match(projectSessionsSource, /sessionVisibilityExplicit: session\.sessionVisibilityExplicit === true/);
});
