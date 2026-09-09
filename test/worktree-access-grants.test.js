var test = require("node:test");
var assert = require("node:assert/strict");

var projectAccess = require("../lib/daemon-project-access");
var attachPermissions = require("../lib/users-permissions").attachPermissions;
var attachPalette = require("../lib/server-palette").attachPalette;

var permissions = attachPermissions({
  loadUsers: function () { return { users: [] }; },
  saveUsers: function () {},
  findUserById: function (userId) {
    return { id: userId, role: userId === "admin" ? "admin" : "user" };
  },
});

function privateConfig() {
  return {
    projects: [{
      slug: "project",
      path: "/srv/project",
      visibility: "private",
      ownerId: "owner",
      allowedUsers: ["full-member"],
    }],
  };
}

test("full parent access reaches every worktree while an exact grant reaches only one", function () {
  var config = privateConfig();
  projectAccess.setAllowedUsers(config, "project--feature-c", ["user-c"]);

  var parent = projectAccess.getProjectAccess(config, "project", false);
  var worktreeC = projectAccess.getProjectAccess(config, "project--feature-c", false);
  var sibling = projectAccess.getProjectAccess(config, "project--feature-d", false);

  assert.equal(permissions.canAccessProject("full-member", parent), true);
  assert.equal(permissions.canAccessProject("full-member", worktreeC), true);
  assert.equal(permissions.canAccessProject("full-member", sibling), true);
  assert.equal(permissions.canAccessProject("user-c", parent), false);
  assert.equal(permissions.canAccessProject("user-c", worktreeC), true);
  assert.equal(permissions.canAccessProject("user-c", sibling), false);
  assert.equal(permissions.canAccessProject("owner", sibling), true);
  assert.equal(permissions.canAccessProject("admin", sibling), true);
});

test("exact worktree grants survive config serialization and rescan-style resolution", function () {
  var config = privateConfig();
  projectAccess.setAllowedUsers(config, "project--feature-c", ["user-c", "user-c"]);
  var restored = JSON.parse(JSON.stringify(config));
  var access = projectAccess.getProjectAccess(restored, "project--feature-c", false);

  assert.deepEqual(restored.projects[0].worktreeAllowedUsers, { "project--feature-c": ["user-c"] });
  assert.deepEqual(access.worktreeAllowedUsers, ["user-c"]);
  assert.equal(permissions.canAccessProject("user-c", access), true);
});

test("revoking an exact grant leaves parent grants intact", function () {
  var config = privateConfig();
  projectAccess.setAllowedUsers(config, "project--feature-c", ["user-c"]);
  projectAccess.setAllowedUsers(config, "project--feature-c", []);

  var access = projectAccess.getProjectAccess(config, "project--feature-c", false);
  assert.deepEqual(access.worktreeAllowedUsers, []);
  assert.equal(permissions.canAccessProject("user-c", access), false);
  assert.equal(permissions.canAccessProject("full-member", access), true);
  assert.equal(config.projects[0].worktreeAllowedUsers, undefined);
});

test("actual worktree removal clears a grant before same-slug recreation", function () {
  var config = privateConfig();
  projectAccess.setAllowedUsers(config, "project--feature-c", ["user-c"]);
  assert.equal(projectAccess.clearWorktreeGrant(config, "project--feature-c"), true);
  assert.equal(projectAccess.clearWorktreeGrant(config, "project--feature-c"), false);
  var recreated = projectAccess.getProjectAccess(JSON.parse(JSON.stringify(config)), "project--feature-c", false);
  assert.equal(permissions.canAccessProject("user-c", recreated), false);
});

test("a reliable rescan preserves live grants and prunes only missing worktrees", function () {
  var config = privateConfig();
  projectAccess.setAllowedUsers(config, "project--feature-c", ["user-c"]);
  projectAccess.setAllowedUsers(config, "project--deleted", ["old-user"]);
  assert.equal(projectAccess.reconcileWorktreeGrants(config, "project", ["project--feature-c"]), true);
  assert.deepEqual(config.projects[0].worktreeAllowedUsers, { "project--feature-c": ["user-c"] });
  assert.equal(projectAccess.reconcileWorktreeGrants(config, "project", ["project--feature-c"]), false);
});

test("public parent visibility remains full access for every worktree", function () {
  var config = privateConfig();
  config.projects[0].visibility = "public";
  var access = projectAccess.getProjectAccess(config, "project--feature-c", false);
  assert.equal(permissions.canAccessProject("any-user", access), true);
});

test("global session search discovers the exact worktree without exposing parent or siblings", function () {
  var config = privateConfig();
  projectAccess.setAllowedUsers(config, "project--feature-c", ["user-c"]);
  var projects = new Map();
  ["project", "project--feature-c", "project--feature-d"].forEach(function (slug, index) {
    var session = {
      localId: index + 1,
      ownerId: "user-c",
      title: "Needle " + slug,
      history: [{ type: "user_message", text: "needle " + slug }],
    };
    projects.set(slug, {
      getStatus: function () { return { slug: slug, title: slug, isWorktree: slug.indexOf("--") !== -1 }; },
      sm: { sessions: new Map([[session.localId, session]]) },
    });
  });
  function access(slug) { return projectAccess.getProjectAccess(config, slug, false); }
  var palette = attachPalette({
    users: {
      isMultiUser: function () { return true; },
      canAccessSession: function (userId, session, record) { return permissions.canAccessSession(userId, session, record); },
    },
    projects: projects,
    getMultiUserFromReq: function () { return { id: "user-c", role: "user" }; },
    onGetProjectAccess: access,
    canUserAccessSlug: function (userId, slug) { return permissions.canAccessProject(userId, access(slug)); },
  });
  var response = { status: null, body: "", writeHead: function (status) { this.status = status; }, end: function (body) { this.body = body; } };
  palette.handleRequest({ method: "GET", url: "/api/palette/search?q=needle" }, response, "/api/palette/search");
  var results = JSON.parse(response.body).results;
  assert.equal(response.status, 200);
  assert.deepEqual(results.map(function (item) { return item.projectSlug; }), ["project--feature-c"]);
});
