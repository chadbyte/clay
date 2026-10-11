var test = require("node:test");
var assert = require("node:assert");
var folders = require("../lib/session-folders");
var attachSessions = require("../lib/project-sessions").attachSessions;

// A real project-sessions handler with fake collaborators: the session manager
// records what would be created, the installed providers are injected, and folder and
// project-default storage are in memory.
function fixture(options) {
  options = options || {};
  var created = [];
  var sent = [];
  var broadcasts = [];
  var storedFolders = {};
  var projectDefault = options.initialDefault || null;
  var defaultCalls = [];
  var sessions = new Map();
  var terminals = [];
  var multi = !!options.multiUser;
  var users = {
    owner: { id: "owner", role: "user", permissions: { projectSettings: true } },
    plain: { id: "plain", role: "user", permissions: { projectSettings: false } },
    admin: { id: "admin", role: "admin", permissions: {} },
  };
  var manager = {
    defaultVendor: "claude", currentEffort: options.currentEffort || "medium", lastVendor: null, sessions: sessions,
    sweepBlankSessions: function () {},
    findReusableBlankSession: function () { return options.blank || null; },
    createSessionRaw: function (opts) { var session = Object.assign({ localId: created.length + 1 }, opts); created.push(session); sessions.set(session.localId, session); return session; },
    saveSessionFile: function () {},
    createSession: function (opts) {
      var session = Object.assign({ localId: created.length + 1 }, opts);
      created.push(session);
      sessions.set(session.localId, session);
      return session;
    },
    switchSession: function () {},
  };
  var usersModule = {
    isMultiUser: function () { return multi; },
    findUserById: function (id) { return users[id] || null; },
    canAccessSession: function () { return true; },
    getEffectivePermissions: function (user) { return user.role === "admin" ? { projectSettings: true } : (user.permissions || {}); },
    getSessionFolders: function (uid, slug) { return folders.normalizeState(storedFolders[uid + "/" + slug]); },
    setSessionFolders: function (uid, slug, st) { storedFolders[uid + "/" + slug] = folders.normalizeState(st); return { ok: true, state: storedFolders[uid + "/" + slug] }; },
  };
  var access = { visibility: "public", ownerId: "owner", isWorktree: !!options.worktree };
  var ws = multi ? { _clayUser: { id: options.userId || "owner" } } : {};
  var handler = attachSessions({
    cwd: "/tmp", slug: "alpha", isMate: !!options.isMate, sm: manager, sdk: {}, tm: { create: function (cols, rows, user, ws, o) { terminals.push(o); return { id: 7 }; } }, clients: new Set([ws]), osUsers: null,
    opts: {
      onGetProjectNewSessionDefault: function () { return { preference: projectDefault }; },
      onSetProjectNewSessionDefault: function (slug, preference) {
        defaultCalls.push({ slug: slug, preference: preference });
        if (options.failDefaultSave) return { ok: false, error: "Project not found" };
        projectDefault = preference;
        return { ok: true };
      },
    },
    usersModule: Object.assign(usersModule, options.claudeMode ? { getClaudeOpenMode: function () { return options.claudeMode; } } : {}), getProjectAccess: function () { return access; },
    send: function (message) { broadcasts.push(message); },
    sendTo: function (ws, message) { sent.push(message); },
    userPresence: { setPresence: function () {}, sessionIdForPersistence: function (s) { return s.localId; } },
    broadcastPresence: function () {}, getOsUserInfoForWs: function () { return null; },
    resolveMateSessionDefaults: options.resolveMateSessionDefaults,
    getVendorAvailability: function () { return [
      { id: "claude", displayName: "Claude Code", installed: true },
      { id: "codex", displayName: "Codex", installed: true },
      { id: "broken", displayName: "Broken", installed: true },
      { id: "kiro", displayName: "Kiro", installed: false },
    ]; },
      });
  var f = { terminals: terminals, created: created, sent: sent, broadcasts: broadcasts, defaultCalls: defaultCalls, ws: ws, stored: storedFolders, manager: manager };
  f.send = function (msg) { handler.handleSessionsMessage(ws, Object.assign({ slug: "alpha" }, msg)); return new Promise(function (r) { setImmediate(r); }); };
  f.last = function (type, rid) {
    for (var i = sent.length - 1; i >= 0; i--) if (sent[i].type === type && (rid === undefined || sent[i].requestId === rid)) return sent[i];
    return null;
  };
  f.folder = async function (name) {
    var rid = "mk-" + name;
    await f.send({ type: "session_folders_op", requestId: rid, op: { op: "create_folder", name: name } });
    return f.last("session_folders_state", rid).folderId;
  };
  f.currentDefault = function () { return projectDefault; };
  return f;
}

test("options list every known provider with installed flags, the project default provider and the setting permission", async function () {
  var f = fixture({ initialDefault: { vendor: "codex" } });
  await f.send({ type: "new_session_options_get", requestId: "o1" });
  var options = f.last("new_session_options", "o1");
  assert.deepStrictEqual(options.vendors.map(function (v) { return v.id + ":" + v.installed; }), ["claude:true", "codex:true", "broken:true", "kiro:false"], "every provider the server knows is listed, with its per-user installed flag");
  assert.strictEqual(options.projectDefault, "codex");
  assert.strictEqual(options.canSetProjectDefault, true);
  assert.strictEqual(JSON.stringify(options).indexOf("model"), -1, "no model data in the reply");
  await f.send({ type: "new_session_options_get", slug: "beta", requestId: "o2" });
  assert.match(f.last("new_session_options", "o2").error, /different project/);
});

test("the model catalog messages no longer exist", async function () {
  var f = fixture();
  await f.send({ type: "new_session_catalog_get", requestId: "c1", vendor: "claude" });
  assert.strictEqual(f.sent.length, 0);
});

test("a provider-only new_session creates with the existing defaults and ignores any model or effort the client adds", async function () {
  var f = fixture({ currentEffort: "high" });
  await f.send({ type: "new_session", requestId: "n1", vendor: "codex", model: "evil", effort: "low", forceNew: true, mode: "gui" });
  assert.strictEqual(f.created.length, 1);
  assert.strictEqual(f.created[0].vendor, "codex");
  assert.strictEqual(f.created[0].model, undefined, "no client-chosen model reaches the session");
  assert.strictEqual(f.created[0].effort, "high", "the existing effort default applies");
  assert.strictEqual(f.last("new_session_result", "n1").ok, true);
});

test("a Mate new_session resolves its live configured defaults on the server and preserves its folder", async function () {
  var resolveCalls = 0;
  var f = fixture({
    isMate: true,
    currentEffort: "low",
    resolveMateSessionDefaults: function () {
      resolveCalls++;
      return Promise.resolve({ vendor: "codex", model: "gpt-5.2-codex", effort: "high" });
    },
  });
  var work = await f.folder("Work");
  await f.send({ type: "new_session", requestId: "mate-1", mateDefaults: true, vendor: "claude", model: "client-override", effort: "low", forceNew: true, folderId: work, folderSlug: "alpha" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(resolveCalls, 1);
  assert.strictEqual(f.created.length, 1);
  assert.strictEqual(f.created[0].vendor, "codex");
  assert.strictEqual(f.created[0].model, "gpt-5.2-codex");
  assert.strictEqual(f.created[0].effort, "high");
  assert.strictEqual(f.last("new_session_result", "mate-1").folderId, work);
  assert.strictEqual(f.last("session_folders_state").state.assignments[f.created[0].localId], work);
  assert.strictEqual(f.manager.lastVendor, null, "server-resolved Mate defaults do not become a project picker preference");
});

test("Mate default resolution deduplicates pending requests and failures create nothing", async function () {
  var release;
  var f = fixture({
    isMate: true,
    resolveMateSessionDefaults: function () {
      return new Promise(function (resolve) { release = resolve; });
    },
  });
  var msg = { type: "new_session", requestId: "mate-dup", mateDefaults: true, forceNew: true, folderId: null, folderSlug: "alpha" };
  f.send(msg);
  f.send(msg);
  await new Promise(function (resolve) { setImmediate(resolve); });
  release({ vendor: "codex", model: "gpt-5.2-codex", effort: "medium" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(f.created.length, 1);

  var failed = fixture({
    isMate: true,
    resolveMateSessionDefaults: function () { return Promise.reject(new Error("Configured Mate model is unavailable.")); },
  });
  await failed.send({ type: "new_session", requestId: "mate-fail", mateDefaults: true, forceNew: true, folderId: null, folderSlug: "alpha" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.strictEqual(failed.created.length, 0);
  assert.match(failed.last("new_session_result", "mate-fail").error, /unavailable/);

  var ordinary = fixture();
  await ordinary.send({ type: "new_session", requestId: "not-mate", mateDefaults: true, forceNew: true });
  assert.strictEqual(ordinary.created.length, 0);
  assert.match(ordinary.last("new_session_result", "not-mate").error, /Mate defaults/);
});

test("the same request id creates only one session", async function () {
  var f = fixture();
  var msg = { type: "new_session", requestId: "dup", vendor: "claude", forceNew: true, mode: "gui" };
  await f.send(msg);
  await f.send(msg);
  assert.strictEqual(f.created.length, 1);
});

test("creating inside a real folder files it there and Favorites is refused", async function () {
  var f = fixture();
  var work = await f.folder("Work");
  await f.send({ type: "new_session", requestId: "w1", vendor: "claude", forceNew: true, mode: "gui", folderId: work, folderSlug: "alpha" });
  var result = f.last("new_session_result", "w1");
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.folderPlaced, true);
  assert.strictEqual(result.folderId, work);
  assert.strictEqual(f.last("session_folders_state").state.assignments[result.sessionId], work);
  await f.send({ type: "new_session", requestId: "fav", vendor: "claude", forceNew: true, mode: "gui", folderId: "favorites", folderSlug: "alpha" });
  assert.strictEqual(f.last("new_session_result", "fav").ok, false);
  assert.match(f.last("new_session_result", "fav").error, /Favorites is a tag/);
  assert.strictEqual(f.created.length, 1, "a crafted Favorites destination creates nothing");
  await f.send({ type: "new_session", requestId: "un", vendor: "claude", forceNew: true, mode: "gui", folderId: null, folderSlug: "alpha" });
  assert.strictEqual(f.last("new_session_result", "un").folderId, "unfiled");
});

test("a removed, unknown or wrong-project folder refuses without creating a session", async function () {
  var f = fixture();
  var work = await f.folder("Work");
  await f.send({ type: "session_folders_op", op: { op: "delete_folder", folderId: work } });
  await f.send({ type: "new_session", requestId: "stale", vendor: "claude", forceNew: true, mode: "gui", folderId: work, folderSlug: "alpha" });
  assert.match(f.last("new_session_result", "stale").error, /no longer exists/);
  await f.send({ type: "new_session", requestId: "other", vendor: "claude", forceNew: true, mode: "gui", folderId: "unfiled", folderSlug: "beta" });
  assert.match(f.last("new_session_result", "other").error, /different project/);
  assert.strictEqual(f.created.length, 0);
});

test("Use as project default saves the provider for this project only", async function () {
  var f = fixture();
  await f.send({ type: "new_session_default_set", requestId: "d1", vendor: "codex", model: "ignored" });
  assert.strictEqual(f.last("new_session_default_result", "d1").ok, true);
  assert.deepStrictEqual(f.defaultCalls, [{ slug: "alpha", preference: { vendor: "codex" } }]);
  assert.strictEqual(f.broadcasts[f.broadcasts.length - 1].projectDefault, "codex");
  await f.send({ type: "new_session_options_get", requestId: "o" });
  assert.strictEqual(f.last("new_session_options", "o").projectDefault, "codex");
  assert.strictEqual(f.created.length, 0, "saving a default never creates a session");
});

test("an uninstalled, unknown, wrong-project or unsavable default is refused and stores nothing", async function () {
  var f = fixture();
  await f.send({ type: "new_session_default_set", requestId: "x1", vendor: "kiro" });
  assert.match(f.last("new_session_default_result", "x1").error, /not installed/);
  await f.send({ type: "new_session_default_set", requestId: "x2", vendor: "" });
  assert.strictEqual(f.last("new_session_default_result", "x2").ok, false);
  await f.send({ type: "new_session_default_set", slug: "beta", requestId: "x3", vendor: "claude" });
  assert.match(f.last("new_session_default_result", "x3").error, /different project/);
  assert.deepStrictEqual(f.defaultCalls, []);
  var failing = fixture({ failDefaultSave: true });
  await failing.send({ type: "new_session_default_set", requestId: "x4", vendor: "claude" });
  assert.strictEqual(failing.last("new_session_default_result", "x4").ok, false);
  assert.strictEqual(failing.broadcasts.length, 0);
});

test("project default permission: owner with project settings or admin, never others, worktrees or Mates", async function () {
  var owner = fixture({ multiUser: true, userId: "owner" });
  await owner.send({ type: "new_session_options_get", requestId: "p" });
  assert.strictEqual(owner.last("new_session_options", "p").canSetProjectDefault, true);
  var admin = fixture({ multiUser: true, userId: "admin" });
  await admin.send({ type: "new_session_default_set", requestId: "a", vendor: "claude" });
  assert.strictEqual(admin.last("new_session_default_result", "a").ok, true);
  var plain = fixture({ multiUser: true, userId: "plain" });
  await plain.send({ type: "new_session_options_get", requestId: "q" });
  assert.strictEqual(plain.last("new_session_options", "q").canSetProjectDefault, false);
  await plain.send({ type: "new_session_default_set", requestId: "b", vendor: "claude" });
  assert.match(plain.last("new_session_default_result", "b").error, /not permitted/);
  var ghost = fixture({ multiUser: true, userId: "ghost" });
  await ghost.send({ type: "new_session_default_set", requestId: "g", vendor: "claude" });
  assert.match(ghost.last("new_session_default_result", "g").error, /no longer available/);
  var tree = fixture({ multiUser: true, userId: "owner", worktree: true });
  await tree.send({ type: "new_session_default_set", requestId: "t", vendor: "claude" });
  assert.match(tree.last("new_session_default_result", "t").error, /parent project/);
  var mate = fixture({ isMate: true });
  await mate.send({ type: "new_session_default_set", requestId: "m", vendor: "claude" });
  assert.strictEqual(mate.last("new_session_default_result", "m").ok, false);
  assert.deepStrictEqual(plain.defaultCalls.concat(tree.defaultCalls, mate.defaultCalls, ghost.defaultCalls), []);
});

test("a plain new_session with a blank to reuse still reuses it; forceNew does not", async function () {
  var blank = { localId: 90, vendor: "claude", model: "", effort: "low" };
  var f = fixture({ blank: blank });
  await f.send({ type: "new_session", requestId: "r2", vendor: "claude", mode: "gui" });
  assert.strictEqual(f.created.length, 0);
  assert.strictEqual(f.last("new_session_result", "r2").sessionId, 90);
  await f.send({ type: "new_session", requestId: "r3", vendor: "claude", mode: "gui", forceNew: true });
  assert.strictEqual(f.created.length, 1);
});

test("a provider that is not installed or authorized is refused before anything is created", async function () {
  var f = fixture();
  await f.send({ type: "new_session", requestId: "u1", vendor: "kiro", forceNew: true, mode: "gui" });
  assert.strictEqual(f.created.length, 0);
  assert.match(f.last("new_session_result", "u1").error, /not installed or authorized/);
  await f.send({ type: "new_session", requestId: "u2", vendor: "made-up", forceNew: true, mode: "gui" });
  assert.strictEqual(f.created.length, 0);
  await f.send({ type: "new_session", requestId: "u3", vendor: "codex", forceNew: true, mode: "gui" });
  assert.strictEqual(f.created.length, 1, "an installed provider still works");
  await f.send({ type: "new_session", vendor: "kiro", forceNew: true, mode: "gui" });
  assert.strictEqual(f.created.length, 2, "legacy requests without a request id are unchanged");
});
