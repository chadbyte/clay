var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-root-project-"));
process.env.CLAY_HOME = fixtureHome;

var tokens = {
  visitor: "visitor:integration-token",
  preferred: "preferred:integration-token",
  denied: "denied:integration-token",
  admin: "admin:integration-token",
};

fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({
  multiUser: true,
  users: [
    { id: "visitor", username: "visitor", displayName: "Visitor", role: "user", pinHash: "set" },
    { id: "preferred", username: "preferred", displayName: "Preferred", role: "user", pinHash: "set", homeSurfacePreference: { surface: "home", projectSlug: "preferred-private" } },
    { id: "denied", username: "denied", displayName: "Denied", role: "user", pinHash: "set", homeSurfacePreference: { surface: "home", projectSlug: "admin-private" } },
    { id: "admin", username: "admin", displayName: "Admin", role: "admin", pinHash: "set", homeSurfacePreference: { surface: "home", projectSlug: "mate-clay" } },
  ],
  invites: [],
}));

fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify((function () {
  var records = {};
  Object.keys(tokens).forEach(function (userId) { records[tokens[userId]] = userId; });
  return records;
})()));

var accessBySlug = {
  "public-default": { slug: "public-default", visibility: "public", ownerId: "owner", allowedUsers: [] },
  "preferred-private": { slug: "preferred-private", visibility: "private", ownerId: "owner", allowedUsers: ["preferred"] },
  "admin-private": { slug: "admin-private", visibility: "private", ownerId: "owner", allowedUsers: [] },
  "mate-clay": { slug: "mate-clay", visibility: "private", ownerId: "admin", allowedUsers: [] },
};

var createServer = require("../../lib/server").createServer;
var relay = createServer({
  port: 0,
  onGetProjectAccess: function (slug) {
    return accessBySlug[slug] || { error: "Project not found" };
  },
});

function addProject(slug, title, ownerId, extra) {
  var directory = path.join(fixtureHome, slug);
  fs.mkdirSync(directory, { recursive: true });
  relay.addProject(directory, slug, title, null, ownerId || "owner", null, extra || null);
}

addProject("public-default", "Public Default");
addProject("preferred-private", "Preferred Private");
addProject("admin-private", "Admin Private");
addProject("mate-clay", "Clay", "admin", { isMate: true, mateId: "clay" });

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
  if (message === "clear-ordinary") {
    relay.destroyProject("public-default");
    relay.destroyProject("preferred-private");
    relay.destroyProject("admin-private");
    if (process.send) process.send({ clearedOrdinary: true });
  }
  if (message === "close") closeFixture();
});
process.on("SIGINT", closeFixture);
process.on("SIGTERM", closeFixture);

relay.server.listen(0, "127.0.0.1", function () {
  if (process.send) process.send({ port: relay.server.address().port, tokens: tokens });
});
