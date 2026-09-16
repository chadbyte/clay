var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");

var attachWorkspaceQueryService = require("../lib/workspace-query-service").attachWorkspaceQueryService;
var attachWorkspaceQueryAccess = require("../lib/workspace-query-access").attachWorkspaceQueryAccess;
var attachPermissions = require("../lib/users-permissions").attachPermissions;

// The real RBAC predicate. Using it rather than a stand-in is the point of
// these tests: the fail-open came from feeding it a record with no visibility
// field, which it is specified to treat as public.
var permissions = attachPermissions({
  loadUsers: function () { return { users: [] }; },
  saveUsers: function () {},
  findUserById: function (userId) {
    return userId === "admin-user" ? { id: "admin-user", role: "admin" } : { id: userId, role: "user" };
  },
});

// A project status exactly as lib/project.js getStatus() produces it: slug,
// owner, title, and no visibility or allowedUsers anywhere.
function statusFor(slug, ownerId, extra) {
  return Object.assign({
    slug: slug,
    path: "/tmp/" + slug,
    project: slug,
    title: slug,
    icon: null,
    clients: 0,
    sessions: 0,
    isProcessing: false,
    pendingPermissions: 0,
    projectOwnerId: ownerId || null,
  }, extra || {});
}

function projectFor(slug, ownerId, sessions, extra) {
  var status = statusFor(slug, ownerId, extra);
  var map = new Map();
  for (var i = 0; i < sessions.length; i++) map.set(sessions[i].localId, sessions[i]);
  return {
    getStatus: function () { return status; },
    getSessionManager: function () { return { sessions: map }; },
  };
}

function session(localId, ownerId, title, text) {
  return {
    localId: localId,
    ownerId: ownerId,
    title: title,
    createdAt: 100,
    lastActivity: 200,
    history: [{ type: "user_message", text: text || title }],
  };
}

// Wires the service exactly the way lib/server.js now wires it: the
// authoritative resolver plus the record-based permission predicate.
function buildService(projects, records, options) {
  var opts = options || {};
  return attachWorkspaceQueryService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return opts.singleUser !== true; },
    onGetProjectAccess: opts.onGetProjectAccess || function (slug) {
      if (Object.prototype.hasOwnProperty.call(records, slug)) return records[slug];
      return { error: "Project not found" };
    },
    canAccessProject: function (userId, access) { return permissions.canAccessProject(userId, access); },
    resolveMate: opts.resolveMate || function () { return null; },
  });
}

function slugsFor(bound) {
  return bound.listProjects({}).projects.map(function (item) { return item.projectSlug; });
}

// --- the reported defect -------------------------------------------------

test("a private foreign project is denied even though getStatus carries no access fields", function () {
  var mine = session(1, "user-a", "My session in their project", "SHARED_HISTORY");
  var projects = new Map();
  projects.set("theirs", projectFor("theirs", "user-b", [mine]));

  // Reconstructing the record from getStatus() is what used to happen. Assert
  // first that doing so really does authorize user-a, so the test below is
  // demonstrably closing a live hole rather than restating current behaviour.
  var reconstructed = {
    ownerId: projects.get("theirs").getStatus().projectOwnerId,
    visibility: projects.get("theirs").getStatus().visibility || "public",
    allowedUsers: projects.get("theirs").getStatus().allowedUsers || [],
  };
  assert.equal(permissions.canAccessProject("user-a", reconstructed), true,
    "the old getStatus-derived record does authorize an unrelated user");

  var service = buildService(projects, {
    theirs: { slug: "theirs", visibility: "private", ownerId: "user-b", allowedUsers: [] },
  });
  var bound = service.bindProjectSession({ projectSlug: "theirs", session: mine });
  assert.ok(bound, "the session still binds; only project visibility is at stake");
  assert.deepEqual(slugsFor(bound), [], "the private project is not listed");
  assert.throws(function () { bound.listProjectSessions({ projectSlug: "theirs" }); }, /not found/);
  assert.throws(function () { bound.searchProjectHistory({ projectSlug: "theirs", query: "SHARED_HISTORY" }); }, /not found/);
  var wide = bound.searchProjectHistory({ query: "SHARED_HISTORY" });
  assert.deepEqual(wide.results, [], "and its history is unreachable by unscoped search");
});

// --- shared access does not widen session visibility ----------------------

test("a shared project shows the allowed user their own session and no one else's", function () {
  var mine = session(1, "user-a", "Mine", "MY_TEXT");
  var theirs = session(2, "user-b", "Theirs", "THEIR_SECRET");
  var projects = new Map();
  projects.set("shared", projectFor("shared", "user-b", [mine, theirs]));
  var service = buildService(projects, {
    shared: { slug: "shared", visibility: "private", ownerId: "user-b", allowedUsers: ["user-a"] },
  });
  var bound = service.bindProjectSession({ projectSlug: "shared", session: mine });

  assert.deepEqual(slugsFor(bound), ["shared"], "the shared container is visible");
  var listed = bound.listProjectSessions({ projectSlug: "shared" });
  assert.deepEqual(listed.sessions.map(function (item) { return item.title; }), ["Mine"]);
  assert.equal(listed.total, 1, "the other user's session is not even counted");
  var hits = bound.searchProjectHistory({ projectSlug: "shared", query: "THEIR_SECRET" });
  assert.deepEqual(hits.results, [], "and its content is not searchable");
});

test("an accessible public container with no session of the caller's own stays absent", function () {
  var theirs = session(2, "user-b", "Theirs", "THEIR_SECRET");
  var projects = new Map();
  projects.set("open", projectFor("open", null, [theirs]));
  var service = buildService(projects, {
    open: { slug: "open", visibility: "public", ownerId: null, allowedUsers: [] },
  });
  // Bind through a session in a different project the caller does own.
  var mine = session(1, "user-a", "Mine", "MY_TEXT");
  projects.set("home", projectFor("home", "user-a", [mine]));
  var bound = service.bindProjectSession({ projectSlug: "home", session: mine });

  assert.equal(slugsFor(bound).indexOf("open"), -1, "public access alone surfaces nothing");
});

// --- re-authorization on every call --------------------------------------

test("access revoked after binding disappears on the very next call", function () {
  var mine = session(1, "user-a", "Mine", "MY_TEXT");
  var projects = new Map();
  projects.set("shared", projectFor("shared", "user-b", [mine]));
  var records = {
    shared: { slug: "shared", visibility: "private", ownerId: "user-b", allowedUsers: ["user-a"] },
  };
  var service = buildService(projects, records);
  var bound = service.bindProjectSession({ projectSlug: "shared", session: mine });
  assert.deepEqual(slugsFor(bound), ["shared"], "visible while allowed");

  // The same already-created handler, after the record changes underneath it.
  records.shared.allowedUsers = [];
  assert.deepEqual(slugsFor(bound), [], "revoking allowedUsers takes effect immediately");
  assert.throws(function () { bound.listProjectSessions({ projectSlug: "shared" }); }, /not found/);

  records.shared.allowedUsers = ["user-a"];
  assert.deepEqual(slugsFor(bound), ["shared"], "and restoring it is equally immediate");

  records.shared.visibility = "private";
  records.shared.ownerId = "user-c";
  records.shared.allowedUsers = [];
  assert.deepEqual(slugsFor(bound), [], "an owner change is honoured too");

  delete records.shared;
  assert.deepEqual(slugsFor(bound), [], "and a project dropped from the record set is gone");
});

// --- stale status ownership cannot outrank the record ---------------------

test("a stale status owner cannot bypass the authoritative access record", function () {
  var mine = session(1, "user-a", "Mine", "MY_TEXT");
  var projects = new Map();
  // The project was transferred away, but the running status still claims
  // user-a owns it. Only the record reflects the transfer.
  projects.set("transferred", projectFor("transferred", "user-a", [mine]));
  var service = buildService(projects, {
    transferred: { slug: "transferred", visibility: "private", ownerId: "user-b", allowedUsers: [] },
  });
  var bound = service.bindProjectSession({ projectSlug: "transferred", session: mine });
  assert.deepEqual(slugsFor(bound), [], "stale status ownership grants nothing");
});

test("ownership itself is read from the record, not from status", function () {
  var mine = session(1, "user-a", "Mine", "MY_TEXT");
  var projects = new Map();
  // Status names nobody as owner; the record names user-a. Ownership must
  // follow the record, which is what makes the container visible with a
  // session present and keeps the owned-container rule intact.
  projects.set("mine", projectFor("mine", null, [mine]));
  var service = buildService(projects, {
    mine: { slug: "mine", visibility: "private", ownerId: "user-a", allowedUsers: [] },
  });
  var bound = service.bindProjectSession({ projectSlug: "mine", session: mine });
  assert.deepEqual(slugsFor(bound), ["mine"]);
});

// --- every failure path denies -------------------------------------------

test("missing, malformed, error, and throwing access lookups all fail closed", function () {
  var mine = session(1, "user-a", "Mine", "MY_TEXT");

  function boundWith(resolver) {
    var projects = new Map();
    projects.set("target", projectFor("target", "user-a", [mine]));
    var service = buildService(projects, {}, { onGetProjectAccess: resolver });
    return service.bindProjectSession({ projectSlug: "target", session: mine });
  }

  assert.deepEqual(slugsFor(boundWith(function () { return { error: "Project not found" }; })), [], "error record");
  assert.deepEqual(slugsFor(boundWith(function () { return null; })), [], "null record");
  assert.deepEqual(slugsFor(boundWith(function () { return undefined; })), [], "undefined record");
  assert.deepEqual(slugsFor(boundWith(function () { return "public"; })), [], "non-object record");
  assert.deepEqual(slugsFor(boundWith(function () { return [{ visibility: "public" }]; })), [], "array record");
  assert.deepEqual(slugsFor(boundWith(function () { throw new Error("registry down"); })), [], "throwing resolver");

  // A record with no visibility field is the exact shape that used to fail
  // open. It is still honoured as public here, because that is the documented
  // record semantics, but it can only ever come from the real registry now.
  assert.deepEqual(slugsFor(boundWith(function () { return { slug: "target", ownerId: "user-a" }; })), ["target"],
    "a genuine record without visibility keeps its documented public meaning");
});

test("a service wired with no access resolver at all denies every project", function () {
  var mine = session(1, "user-a", "Mine", "MY_TEXT");
  var projects = new Map();
  projects.set("target", projectFor("target", "user-a", [mine]));
  var service = attachWorkspaceQueryService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return true; },
    resolveMate: function () { return null; },
  });
  var bound = service.bindProjectSession({ projectSlug: "target", session: mine });
  assert.deepEqual(slugsFor(bound), [], "no resolver means no access");
});

test("a permission predicate that throws or returns a truthy non-true denies", function () {
  var status = statusFor("target", "user-b");
  function verdict(predicate) {
    return attachWorkspaceQueryAccess({
      isMultiUser: function () { return true; },
      resolveMate: function () { return null; },
      onGetProjectAccess: function () { return { slug: "target", visibility: "private", ownerId: "user-b", allowedUsers: ["user-a"] }; },
      canAccessProject: predicate,
    }).evaluate({ userId: "user-a" }, status);
  }
  assert.equal(verdict(function () { throw new Error("boom"); }).accessible, false);
  assert.equal(verdict(function () { return "yes"; }).accessible, false, "only an explicit true grants");
  assert.equal(verdict(function () { return 1; }).accessible, false);
  assert.equal(verdict(undefined).accessible, false, "a missing predicate denies");
  assert.equal(verdict(function () { return true; }).accessible, true);
});

test("an unattributed multi-user principal is denied outright", function () {
  var evaluator = attachWorkspaceQueryAccess({
    isMultiUser: function () { return true; },
    resolveMate: function () { return null; },
    onGetProjectAccess: function () { return { slug: "open", visibility: "public", ownerId: null, allowedUsers: [] }; },
    canAccessProject: function (userId, access) { return permissions.canAccessProject(userId, access); },
  });
  assert.deepEqual(evaluator.evaluate({ userId: null }, statusFor("open", null)), { owned: false, accessible: false });
  assert.deepEqual(evaluator.evaluate(null, statusFor("open", null)), { owned: false, accessible: false });
});

test("an authorized worktree is surfaced from its exact access record", function () {
  var evaluator = attachWorkspaceQueryAccess({
    isMultiUser: function () { return true; },
    resolveMate: function () { return null; },
    onGetProjectAccess: function () { return { slug: "wt", visibility: "public", ownerId: "user-a", allowedUsers: [] }; },
    canAccessProject: function () { return true; },
  });
  assert.deepEqual(evaluator.evaluate({ userId: "user-a" }, statusFor("wt", "user-a", { isWorktree: true })),
    { owned: true, accessible: true });
});

// --- Mate projects -------------------------------------------------------

test("a Mate keeps its own project even though no access record exists for it", function () {
  // This mirrors production exactly: lib/daemon.js registers Mate projects with
  // relay.addProject() and never writes them to config.projects, so
  // onGetProjectAccess() reports them as not found.
  var mateSession = session(1, "user-a", "Mate work", "MATE_TEXT");
  var projects = new Map();
  projects.set("mate-m1", projectFor("mate-m1", "user-a", [mateSession], { isMate: true, mateId: "m1" }));
  var lookups = [];
  var service = buildService(projects, {}, {
    onGetProjectAccess: function (slug) { lookups.push(slug); return { error: "Project not found" }; },
    resolveMate: function (userId, mateId) {
      return userId === "user-a" && mateId === "m1" ? { id: "m1", createdBy: "user-a" } : null;
    },
  });
  var bound = service.bindProjectSession({ projectSlug: "mate-m1", session: mateSession });
  assert.deepEqual(slugsFor(bound), ["mate-m1"], "the Mate registry is authoritative for Mate ownership");
  assert.equal(lookups.indexOf("mate-m1"), -1, "and no record lookup was needed to grant it");
});

test("another user's Mate project is denied even with a session present", function () {
  var intruder = session(1, "user-a", "Mine", "MY_TEXT");
  var projects = new Map();
  projects.set("mate-m2", projectFor("mate-m2", "user-b", [intruder], { isMate: true, mateId: "m2" }));
  var service = buildService(projects, {}, {
    // Scoped exactly as lib/server.js scopes it: the registry only answers for
    // the asking user, so user-a cannot resolve user-b's Mate.
    resolveMate: function (userId, mateId) {
      return userId === "user-b" && mateId === "m2" ? { id: "m2", createdBy: "user-b" } : null;
    },
  });
  var bound = service.bindProjectSession({ projectSlug: "mate-m2", session: intruder });
  assert.deepEqual(slugsFor(bound), [], "a foreign Mate project is not reachable");
});

test("a Mate whose registry owner disagrees with the status owner is denied", function () {
  var mateSession = session(1, "user-a", "Mine", "MY_TEXT");
  var projects = new Map();
  projects.set("mate-m3", projectFor("mate-m3", "user-a", [mateSession], { isMate: true, mateId: "m3" }));
  var service = buildService(projects, {}, {
    // Status claims user-a, but the registry says the Mate was created by
    // someone else. The registry wins and the project is denied.
    resolveMate: function () { return { id: "m3", createdBy: "user-b" }; },
  });
  var bound = service.bindProjectSession({ projectSlug: "mate-m3", session: mateSession });
  assert.deepEqual(slugsFor(bound), []);
});

// --- single-user mode is untouched ---------------------------------------

test("single-user mode still authorizes from the project owner with no records at all", function () {
  var legacy = session(1, null, "Legacy", "LEGACY_TEXT");
  var projects = new Map();
  projects.set("legacy", projectFor("legacy", null, [legacy]));
  projects.set("bound", projectFor("bound", "stale-user", [session(2, null, "Other", "OTHER_TEXT")]));
  var service = attachWorkspaceQueryService({
    getProjects: function () { return projects; },
    isMultiUser: function () { return false; },
    resolveMate: function () { return null; },
  });
  var bound = service.bindProjectSession({ projectSlug: "legacy", session: legacy });
  assert.deepEqual(slugsFor(bound), ["legacy"], "ownerless projects remain visible without any resolver");
});

// --- capabilities and identity are unchanged ------------------------------

test("ordinary and builtin Clay capabilities and identity are unchanged", function () {
  var mateSession = session(1, "user-a", "Mate work", "MATE_TEXT");
  function boundMate(builtinKey) {
    var projects = new Map();
    projects.set("mate-x", projectFor("mate-x", "user-a", [mateSession], { isMate: true, mateId: "x" }));
    var service = buildService(projects, {}, {
      resolveMate: function (userId, mateId) {
        if (userId !== "user-a" || mateId !== "x") return null;
        return { id: "x", createdBy: "user-a", builtinKey: builtinKey || undefined };
      },
    });
    return service.bindSource({
      projectSlug: "mate-x", projectOwnerId: "user-a", isMate: true, mateId: "x", session: mateSession,
    });
  }

  var ordinary = boundMate(null);
  assert.ok(ordinary);
  assert.equal(ordinary.isClay, false);
  assert.throws(function () { ordinary.searchWorkspaceHistory({ query: "x" }); }, /only to builtin Clay/);
  assert.throws(function () { ordinary.listWorkspaceActivity({}); }, /only to builtin Clay/);
  assert.throws(function () { ordinary.listRecentDecisions({}); }, /only to builtin Clay/);
  assert.deepEqual(ordinary.getMemorySessions(true), [], "cross-project memory stays Clay-only");
  assert.deepEqual(slugsFor(ordinary), ["mate-x"], "but its own project is still reachable");

  var clay = boundMate("clay");
  assert.equal(clay.isClay, true);
  assert.equal(clay.listWorkspaceActivity({}).sessions.length, 1);
  assert.equal(clay.listRecentDecisions({}).total, 0);
  assert.deepEqual(slugsFor(clay), ["mate-x"]);
});

test("builtin Clay is still bounded by the same authoritative records", function () {
  var clayS = session(1, "user-a", "Clay", "CLAY_TEXT");
  var foreign = session(2, "user-a", "Mine over there", "FOREIGN_TEXT");
  var projects = new Map();
  projects.set("mate-c", projectFor("mate-c", "user-a", [clayS], { isMate: true, mateId: "c" }));
  projects.set("secret", projectFor("secret", "user-b", [foreign]));
  var service = buildService(projects, {
    secret: { slug: "secret", visibility: "private", ownerId: "user-b", allowedUsers: [] },
  }, {
    resolveMate: function (userId, mateId) {
      return userId === "user-a" && mateId === "c" ? { id: "c", createdBy: "user-a", builtinKey: "clay" } : null;
    },
  });
  var clay = service.bindSource({
    projectSlug: "mate-c", projectOwnerId: "user-a", isMate: true, mateId: "c", session: clayS,
  });
  assert.equal(clay.isClay, true);
  assert.equal(slugsFor(clay).indexOf("secret"), -1, "workspace-wide reach is not unbounded reach");
  assert.deepEqual(clay.searchWorkspaceHistory({ query: "FOREIGN_TEXT" }).results, []);
  assert.deepEqual(clay.listWorkspaceActivity({}).sessions.map(function (s) { return s.projectSlug; }), ["mate-c"]);
});

// --- server wiring --------------------------------------------------------

test("lib/server.js no longer rebuilds the access record from getStatus", function () {
  var source = fs.readFileSync(path.join(__dirname, "..", "lib", "server.js"), "utf8");
  var start = source.indexOf("attachWorkspaceQueryService({");
  assert.ok(start > 0, "the workspace query wiring is present");
  var block = source.substring(start, source.indexOf("});", start));
  assert.match(block, /onGetProjectAccess:\s*onGetProjectAccess/, "the authoritative resolver is passed through");
  assert.doesNotMatch(block, /status\s*&&\s*status\.visibility/, "no visibility is reconstructed from status");
  assert.doesNotMatch(block, /status\s*&&\s*status\.allowedUsers/, "no allowedUsers is reconstructed from status");
  assert.doesNotMatch(block, /status\s*&&\s*status\.projectOwnerId/, "no ownership is reconstructed from status");
});

test("the wiring lib/server.js installs denies a private foreign project end to end", function () {
  // The exact daemon record shape, and the exact predicate lib/server.js now
  // passes, evaluated against the exact status lib/project.js emits.
  var evaluator = attachWorkspaceQueryAccess({
    isMultiUser: function () { return true; },
    resolveMate: function () { return null; },
    onGetProjectAccess: function (slug) {
      if (slug !== "secret") return { error: "Project not found" };
      return { slug: "secret", visibility: "private", allowedUsers: [], ownerId: "user-b" };
    },
    canAccessProject: function (userId, access) { return permissions.canAccessProject(userId, access) === true; },
  });
  assert.deepEqual(evaluator.evaluate({ userId: "user-a" }, statusFor("secret", "user-b")),
    { owned: false, accessible: false });
  assert.deepEqual(evaluator.evaluate({ userId: "user-b" }, statusFor("secret", "user-b")),
    { owned: true, accessible: true }, "the real owner is unaffected");
  assert.deepEqual(evaluator.evaluate({ userId: "admin-user" }, statusFor("secret", "user-b")),
    { owned: false, accessible: true }, "admin reach is unchanged, and is not ownership");
});
