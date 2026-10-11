var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-settings-server-"));
process.env.CLAY_HOME = fixtureHome;
fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({
  multiUser: true,
  users: [
    { id: "admin", username: "admin", displayName: "Admin", role: "admin", pinHash: "set", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "member", username: "member", displayName: "Member", role: "user", pinHash: "set", createdAt: "2026-10-01T00:00:00.000Z" },
  ], invites: [],
}));
fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify({ "network-admin": "admin", "network-member": "member" }));
var configModule = require("../../lib/config");
var saveAllowedOrigins = require("../../lib/network-origins").saveAllowedOrigins;
var config = { port: 0, hostname: "clay-test", platform: "linux", osUsers: true, imageRetentionDays: 7, sharedEnv: "export EXAMPLE_KEY=example-value", allowedOrigins: [], unrelatedSetting: "retained" };
var failSave = false;
function saveSetting(key, value) { if (failSave) throw new Error("Simulated disk failure. Your draft is retained."); config[key] = value; configModule.saveConfig(config); return { ok: true }; }
configModule.saveConfig(config);
var relay = require("../../lib/server").createServer({
  port: 0,
  onGetDaemonConfig: function () { return config; },
  onGetProjectEnv: function (slug) { return { envrc: (config.projectEnv || {})[slug] || '' }; },
  onSetProjectEnv: function (slug, value) { var values = Object.assign({}, config.projectEnv || {}); values[slug] = value; return saveSetting('projectEnv', values); },
  onGetSharedEnv: function () { return { envrc: config.sharedEnv }; },
  onSetSharedEnv: function (value) { return saveSetting('sharedEnv', value); },
  onSetPin: function (value) { saveSetting('pinEnabled', !!value); return { ok: true, pinEnabled: !!value }; },
  onSetKeepAwake: function (value) { saveSetting('keepAwake', value); return { ok: true, keepAwake: value }; },
  onSetImageRetention: function (value) { saveSetting('imageRetentionDays', value); return { ok: true, days: value }; },
  onSetUpdateChannel: function (value) { return saveSetting('updateChannel', value); },
  onRestart: function () { config.restartRequested = true; },
  onShutdown: function () { config.shutdownRequested = true; },
  onGetProjectAccess: function (slug) {
    return { slug: slug, visibility: slug === "public-sample" ? "public" : "private", ownerId: "admin", allowedUsers: ["member"] };
  },
  onGetAllowedOrigins: function () { return config.allowedOrigins; },
  onSetAllowedOrigins: function (values) { saveAllowedOrigins(config, values, configModule.saveConfig); },
  onOriginRejectedLog: function (line) { if (process.send) process.send({ originRejectedLog: line }); },
});
var requestHandler = relay.server.listeners('request')[0];
relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  if (req.url === '/__fixture/admin' || req.url === '/__fixture/member') {
    var identity = req.url.endsWith('/admin') ? 'network-admin' : 'network-member';
    res.writeHead(302, { 'Set-Cookie': 'relay_auth_user=' + identity + '; Path=/; HttpOnly; SameSite=Strict', Location: '/p/sample/' }); res.end(); return;
  }
  if (req.url === '/__fixture/fail' || req.url === '/__fixture/recover') { failSave = req.url.endsWith('/fail'); res.end('ok'); return; }
  if (req.url === '/__fixture/mac') { config.platform = 'darwin'; config.osUsers = false; res.end('ok'); return; }
  if (req.url === '/__fixture/state') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(config)); return; }
  requestHandler(req, res);
});
var projectDir = path.join(fixtureHome, "project");
fs.mkdirSync(projectDir);
relay.addProject(projectDir, "sample", "Sample", null, "admin");
var publicProjectDir = path.join(fixtureHome, "public-project");
fs.mkdirSync(publicProjectDir);
relay.addProject(publicProjectDir, "public-sample", "Public sample", null, "admin");
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
  else console.log("Settings fixture: http://127.0.0.1:" + port);
});
