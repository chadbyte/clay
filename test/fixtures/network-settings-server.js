var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-network-server-"));
process.env.CLAY_HOME = fixtureHome;
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({
  multiUser: true,
  users: [
    { id: "admin", username: "admin", displayName: "Admin", role: "admin", pinHash: "set" },
    { id: "member", username: "member", displayName: "Member", role: "user", pinHash: "set" },
  ], invites: [],
}));
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify({ "network-admin": "admin", "network-member": "member" }));
var configModule = require("../../lib/config");
var saveAllowedOrigins = require("../../lib/network-origins").saveAllowedOrigins;
var config = { port: 0, allowedOrigins: [], unrelatedSetting: "retained" };
configModule.saveConfig(config);
var relay = require("../../lib/server").createServer({
  port: 0,
  onGetProjectAccess: function (slug) {
    return { slug: slug, visibility: "private", ownerId: "admin", allowedUsers: [] };
  },
  onGetAllowedOrigins: function () { return config.allowedOrigins; },
  onSetAllowedOrigins: function (values) { saveAllowedOrigins(config, values, configModule.saveConfig); },
  onOriginRejectedLog: function (line) { if (process.send) process.send({ originRejectedLog: line }); },
});
var projectDir = path.join(fixtureHome, "project");
fs.mkdirSync(projectDir);
relay.addProject(projectDir, "sample", "Sample", null, "admin");
function close() {
  Promise.resolve(relay.destroyAll()).finally(function () {
    relay.server.close(function () {
      fs.rmSync(fixtureHome, { recursive: true, force: true });
      process.exit(0);
    });
  });
  setTimeout(function () { process.exit(0); }, 2000).unref();
}
process.on("message", function (message) {
  if (message === "close") close();
  if (message === "reload") {
    config = configModule.loadConfig();
    if (process.send) process.send({ reloaded: true, config: config });
  }
});
process.on("SIGTERM", close);
relay.server.listen(0, "127.0.0.1", function () {
  var port = relay.server.address().port;
  if (process.send) process.send({ port: port });
  else console.log("Network fixture: http://127.0.0.1:" + port);
});
