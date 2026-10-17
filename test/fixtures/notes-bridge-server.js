// Real Clay server exposing the exact-query MCP bridge for one bound Codex session.
// Storage lives in a throwaway CLAY_HOME; no Git repository, provider, or account is used.
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-notes-bridge-")));
process.env.CLAY_HOME = fixtureHome;
process.env.CLAY_DEV = "";
var users = { multiUser: true, users: [
  { id: "owner", username: "owner", role: "user", pinHash: "set" },
  { id: "member", username: "member", role: "user", pinHash: "set" },
], invites: [] };
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify(users));
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), "{}");
var allowed = true;
var root = path.join(fixtureHome, "project");
fs.mkdirSync(root);
var createServer = require("../../lib/server").createServer;
var relay = createServer({ port: 0, onGetProjectAccess: function () {
  return { visibility: "private", ownerId: "owner", allowedUsers: allowed ? ["member"] : [] };
} });
relay.addProject(root, "notes", "Notes Fixture", null, "owner", null, { projectKnowledgeId: "pk_notes_bridge", mcpBridgeToken: "notes-bridge-secret" });
var manager, driver;
relay.forEachProject(function (ctx) {
  manager = ctx.getSessionManager();
  driver = manager.createSessionRaw({ ownerId: "member", vendor: "codex" });
  driver._sdkQueryGeneration = 1;
});
var closing = false;
function finish() { try { fs.rmSync(fixtureHome, { recursive: true, force: true }); } catch (e) {} process.exit(0); }
function close() {
  if (closing) return;
  closing = true;
  Promise.resolve(relay.destroyAll()).then(function () { relay.server.close(finish); }).catch(finish);
  setTimeout(finish, 2000).unref();
}
process.on("message", function (message) {
  if (message === "advance") { driver._sdkQueryGeneration++; process.send({ advanced: driver._sdkQueryGeneration }); }
  if (message === "revoke") { allowed = false; relay.refreshProjectAccess(); process.send({ revoked: true }); }
  if (message === "restore") { allowed = true; relay.refreshProjectAccess(); process.send({ restored: true }); }
  if (message === "retire") { manager.sessions.delete(driver.localId); process.send({ retired: true }); }
  if (message === "close") close();
});
process.on("SIGTERM", close);
relay.server.listen(0, "127.0.0.1", function () { process.send({ port: relay.server.address().port, sessionId: driver.localId }); });
