var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-project-list-access-")));
process.env.CLAY_HOME = fixtureHome;

var tokens = {
  member: "member:project-list-token",
  outsider: "outsider:project-list-token",
  admin: "admin:project-list-token",
};
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({
  multiUser: true,
  users: [
    { id: "owner", username: "owner", role: "user", pinHash: "set" },
    { id: "member", username: "member", role: "user", pinHash: "set" },
    { id: "outsider", username: "outsider", role: "user", pinHash: "set" },
    { id: "admin", username: "admin", role: "admin", pinHash: "set" },
  ],
  invites: [],
}));
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify((function () {
  var records = {};
  records[tokens.member] = "member";
  records[tokens.outsider] = "outsider";
  records[tokens.admin] = "admin";
  return records;
})()));

var projectAccess = require("../../lib/daemon-project-access");
var createServer = require("../../lib/server").createServer;
var config = {
  projects: [
    { slug: "public", path: path.join(fixtureHome, "public"), visibility: "public", ownerId: "owner" },
    { slug: "shared", path: path.join(fixtureHome, "shared"), visibility: "private", ownerId: "owner", allowedUsers: ["member"] },
    {
      slug: "parent",
      path: path.join(fixtureHome, "parent"),
      visibility: "private",
      ownerId: "owner",
      allowedUsers: ["member"],
      worktreeAllowedUsers: { "parent--outsider": ["outsider"] },
    },
    { slug: "hidden", path: path.join(fixtureHome, "hidden-secret-path"), visibility: "private", ownerId: "outsider" },
  ],
};

for (var i = 0; i < config.projects.length; i++) fs.mkdirSync(config.projects[i].path, { recursive: true });
var inheritedPath = path.join(fixtureHome, "parent-inherited");
var outsiderPath = path.join(fixtureHome, "parent-outsider");
fs.mkdirSync(inheritedPath, { recursive: true });
fs.mkdirSync(outsiderPath, { recursive: true });

var relay = createServer({
  port: 0,
  getRemovedProjects: function () { return []; },
  onGetProjectAccess: function (slug) { return projectAccess.getProjectAccess(config, slug, false); },
});
for (var p = 0; p < config.projects.length; p++) {
  var project = config.projects[p];
  relay.addProject(project.path, project.slug, project.slug === "hidden" ? "Hidden Secret Project" : project.slug, null, project.ownerId);
}
relay.addProject(inheritedPath, "parent--inherited", "Inherited Worktree", null, "owner", { parentSlug: "parent" });
relay.addProject(outsiderPath, "parent--outsider", "Outsider Worktree", null, "owner", { parentSlug: "parent" });

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
  if (message === "revoke-member") {
    projectAccess.setAllowedUsers(config, "shared", []);
    projectAccess.setAllowedUsers(config, "parent", []);
    relay.refreshProjectAccess();
    if (process.send) process.send({ revoked: true });
  }
  if (message === "broadcast-projects") relay.broadcastAll({ type: "projects_updated", projects: relay.getProjects() });
  if (message === "close") closeFixture();
});
process.on("SIGINT", closeFixture);
process.on("SIGTERM", closeFixture);

relay.server.listen(0, "127.0.0.1", function () {
  if (process.send) process.send({ port: relay.server.address().port, tokens: tokens });
});
