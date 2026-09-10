var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-request-access-server-")));
process.env.CLAY_HOME = fixtureHome;
delete process.env.CLAY_DEV;
var token = "member:integration-token";
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({ multiUser: true, users: [
  { id: "member", username: "member", role: "user", pinHash: "set", permissions: { projectSettings: true } },
], invites: [] }));
var tokens = {};
tokens[token] = "member";
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify(tokens));
var createServer = require("../../lib/server").createServer;
var envCalls = 0;
var relay = createServer({ port: 0,
  onGetProjectAccess: function (slug) {
    return { visibility: "private", ownerId: slug === "allowed" ? "member" : "other", allowedUsers: [] };
  },
  onGetProjectEnv: function () { envCalls++; return { envrc: "MARKER=value" }; },
});
["allowed", "forbidden"].forEach(function (slug) {
  var cwd = path.join(fixtureHome, slug);
  fs.mkdirSync(cwd);
  relay.addProject(cwd, slug, slug, null, slug === "allowed" ? "member" : "other");
});
var closing = false;
function finish() {
  fs.rmSync(fixtureHome, { recursive: true, force: true });
  process.exit(0);
}
function close() {
  if (closing) return;
  closing = true;
  Promise.resolve(relay.destroyAll()).then(function () { relay.server.close(finish); }).catch(finish);
  setTimeout(finish, 2000).unref();
}
process.on("message", function (message) {
  if (message === "close") close();
  if (message === "calls") process.send({ envCalls: envCalls });
});
process.on("SIGTERM", close);
relay.server.listen(0, "127.0.0.1", function () {
  process.send({ port: relay.server.address().port, token: token });
});
