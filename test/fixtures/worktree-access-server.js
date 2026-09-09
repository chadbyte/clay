var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-worktree-access-")));
process.env.CLAY_HOME = fixtureHome;
var token = "user-c:integration-token";
var fullToken = "full-member:integration-token";
var adminToken = "admin:integration-token";
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({
  multiUser: true,
  users: [
    { id: "user-c", username: "user-c", displayName: "User C", role: "user", pinHash: "set", homeSurfacePreference: { surface: "home", projectSlug: "project" } },
    { id: "full-member", username: "full-member", displayName: "Full Member", role: "user", pinHash: "set", homeSurfacePreference: { surface: "home", projectSlug: "project--feature-d" } },
    { id: "admin", username: "admin", displayName: "Admin", role: "admin", pinHash: "set", homeSurfacePreference: { surface: "home", projectSlug: "mate-clay" } },
  ],
  invites: [],
}));
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify((function () {
  var tokens = {};
  tokens[token] = "user-c";
  tokens[fullToken] = "full-member";
  tokens[adminToken] = "admin";
  return tokens;
})()));

var projectAccess = require("../../lib/daemon-project-access");
var createServer = require("../../lib/server").createServer;
var config = {
  projects: [{
    slug: "project",
    path: path.join(fixtureHome, "project"),
    visibility: "private",
    ownerId: "owner",
    allowedUsers: ["full-member"],
    worktreeAllowedUsers: { "project--feature-c": ["user-c"] },
  }],
};
fs.mkdirSync(config.projects[0].path, { recursive: true });
var worktreeC = path.join(fixtureHome, "feature-c");
var worktreeD = path.join(fixtureHome, "feature-d");
var mateClay = path.join(fixtureHome, "mate-clay");
fs.mkdirSync(worktreeC, { recursive: true });
fs.mkdirSync(worktreeD, { recursive: true });
fs.mkdirSync(mateClay, { recursive: true });

var relay = createServer({
  port: 0,
  onGetProjectAccess: function (slug) { return projectAccess.getProjectAccess(config, slug, false); },
});
relay.addProject(config.projects[0].path, "project", "Parent", null, "owner");
relay.addProject(worktreeC, "project--feature-c", "Feature C", null, "owner", {
  parentSlug: "project", projectKnowledgeId: "pk_project", changeSetId: "cs_feature_c",
});
relay.addProject(worktreeD, "project--feature-d", "Feature D", null, "owner", {
  parentSlug: "project", projectKnowledgeId: "pk_project", changeSetId: "cs_feature_d",
});
relay.addProject(mateClay, "mate-clay", "Clay", null, "admin", null, { isMate: true, mateId: "clay" });

var closing = false;
function finish() {
  try { fs.rmSync(fixtureHome, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
}
function closeFixture() {
  if (closing) return;
  closing = true;
  Promise.resolve(relay.destroyAll()).then(function () { relay.server.close(finish); }).catch(finish);
  setTimeout(finish, 2000).unref();
}
process.on("message", function (message) {
  if (message === "revoke") {
    projectAccess.setAllowedUsers(config, "project--feature-c", []);
    relay.refreshProjectAccess();
    if (process.send) process.send({ revoked: true });
  }
  if (message === "clear-ordinary") {
    relay.destroyProject("project");
    relay.destroyProject("project--feature-c");
    relay.destroyProject("project--feature-d");
    if (process.send) process.send({ clearedOrdinary: true });
  }
  if (message === "close") closeFixture();
});
process.on("SIGINT", closeFixture);
process.on("SIGTERM", closeFixture);

relay.server.listen(0, "127.0.0.1", function () {
  if (process.send) process.send({ port: relay.server.address().port, token: token, fullToken: fullToken, adminToken: adminToken });
});
