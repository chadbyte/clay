var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var childProcess = require("node:child_process");

var fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-issues-server-")));
process.env.CLAY_HOME = fixtureHome;
process.env.CLAY_DEV = "";
var token = "member:issues-token";
var users = { multiUser: true, users: [
  { id: "owner", username: "owner", role: "user", pinHash: "set" },
  { id: "member", username: "member", role: "user", pinHash: "set" },
], invites: [] };
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify(users));
var tokens = {}; tokens[token] = "member";
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify(tokens));
var allowed = true;
var root = path.join(fixtureHome, "project");
fs.mkdirSync(root);
childProcess.execFileSync("git", ["init", "-q"], { cwd: root });
var createServer = require("../../lib/server").createServer;
var relay = createServer({ port: 0, onGetProjectAccess: function () {
  return { visibility: "private", ownerId: "owner", allowedUsers: allowed ? ["member"] : [] };
} });
relay.addProject(root, "issues", "Issues Fixture", null, "owner", null, { projectKnowledgeId: "pk_issues_server" });
var closing = false;
function finish() { try { fs.rmSync(fixtureHome, { recursive: true, force: true }); } catch (e) {} process.exit(0); }
function close() {
  if (closing) return;
  closing = true;
  Promise.resolve(relay.destroyAll()).then(function () { relay.server.close(finish); }).catch(finish);
  setTimeout(finish, 2000).unref();
}
process.on("message", function (message) {
  if (message === "revoke") { allowed = false; relay.refreshProjectAccess(); if (process.send) process.send({ revoked: true }); }
  if (message === "close") close();
});
process.on("SIGTERM", close);
relay.server.listen(0, "127.0.0.1", function () { if (process.send) process.send({ port: relay.server.address().port, token: token }); });
