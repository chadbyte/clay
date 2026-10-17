var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-settings-server-"));
process.env.CLAY_HOME = fixtureHome;
process.env.HOME = fixtureHome;
// --solo: single-user server (no account registry), the owner is the administrator.
var solo = process.argv.includes('--solo');
if (!solo) fs.writeFileSync(path.join(fixtureHome, "users.json"), JSON.stringify({
  multiUser: true,
  users: [
    { id: "admin", username: "admin", displayName: "Admin", role: "admin", pinHash: "set", createdAt: "2026-10-01T00:00:00.000Z" },
    { id: "member", username: "member", displayName: "Member", role: "user", pinHash: "set", createdAt: "2026-10-01T00:00:00.000Z" },
  ], invites: [],
}));
if (!solo && process.argv.includes('--personal-drafts')) {
  var seeded = JSON.parse(fs.readFileSync(path.join(fixtureHome, 'users.json'), 'utf8'));
  seeded.users[0].profile = {name:'Alex Fixture',lang:'en-US',avatarStyle:'imprint',avatarSeed:'settings-fixture'};
  seeded.users[0].terminalFont = {family:'ui-monospace, monospace',size:16};
  fs.writeFileSync(path.join(fixtureHome, 'users.json'), JSON.stringify(seeded));
}
var fixtureTokens = { 'network-admin': 'admin', 'network-member': 'member' };
if (process.argv.includes('--earlier-sessions')) {
  for (var earlier = 0; earlier < 5; earlier++) fixtureTokens['earlier-' + earlier] = 'admin';
}
if (!solo) fs.writeFileSync(path.join(fixtureHome, "auth-tokens.json"), JSON.stringify(fixtureTokens));
var configModule = require("../../lib/config");
var saveAllowedOrigins = require("../../lib/network-origins").saveAllowedOrigins;
var config = { port: 0, hostname: "clay-test", platform: "linux", osUsers: true, imageRetentionDays: 7, sharedEnv: "export EXAMPLE_KEY=example-value", allowedOrigins: [], unrelatedSetting: "retained" };
var failSave = false;
var appearanceLoadFailure = process.argv.includes('--appearance-load-error');
var profileSaveFailure = false;
function saveSetting(key, value) { if (failSave) throw new Error("Simulated disk failure. Your draft is retained."); config[key] = value; configModule.saveConfig(config); return { ok: true }; }
configModule.saveConfig(config);
var relay = require("../../lib/server").createServer({
  port: 0,
  onGetDaemonConfig: function () { return config; },
  onGetProjectEnv: function (slug) { return { envrc: (config.projectEnv || {})[slug] || '' }; },
  onSetProjectEnv: function (slug, value) { var values = Object.assign({}, config.projectEnv || {}); values[slug] = value; return saveSetting('projectEnv', values); },
  onSetProjectTitle: function (slug, title) { var values = Object.assign({}, config.projectTitles || {}); values[slug] = title; return saveSetting('projectTitles', values); },
  onSetProjectIcon: function (slug, icon) { var values = Object.assign({}, config.projectIcons || {}); values[slug] = icon; saveSetting('projectIcons', values); return { ok: true }; },
  onSetProjectSessionVisibilityDefault: function (slug, value) { var values = Object.assign({}, config.projectSessionVisibility || {}); values[slug] = value; saveSetting('projectSessionVisibility', values); return { ok: true, visibility: value }; },
  onGetSharedEnv: function () { return { envrc: config.sharedEnv }; },
  onSetSharedEnv: function (value) { return saveSetting('sharedEnv', value); },
  onSetPin: function (value) { saveSetting('pinEnabled', !!value); return { ok: true, pinEnabled: !!value }; },
  onSetKeepAwake: function (value) { saveSetting('keepAwake', value); return { ok: true, keepAwake: value }; },
  onSetImageRetention: function (value) { saveSetting('imageRetentionDays', value); return { ok: true, days: value }; },
  onSetUpdateChannel: function (value) { return saveSetting('updateChannel', value); },
  onRestart: function () { config.restartRequested = true; },
  onShutdown: function () { config.shutdownRequested = true; },
  onGetProjectAccess: function (slug) {
    if (slug === "private-admin") return { slug: slug, visibility: "private", ownerId: "admin", allowedUsers: [] };
    return { slug: slug, visibility: slug === "public-sample" ? "public" : "private", ownerId: "admin", allowedUsers: ["member"] };
  },
  onGetAllowedOrigins: function () { return config.allowedOrigins; },
  onSetAllowedOrigins: function (values) { saveAllowedOrigins(config, values, configModule.saveConfig); },
  onOriginRejectedLog: function (line) { if (process.send) process.send({ originRejectedLog: line }); },
});
var requestHandler = relay.server.listeners('request')[0];
relay.server.removeAllListeners('request');
relay.server.on('request', function (req, res) {
  if (req.url === '/__fixture/appearance-load-error') {appearanceLoadFailure = true;res.end('ok');return;}
  if (req.url === '/__fixture/profile-save-error') {profileSaveFailure = true;res.end('ok');return;}
  if (req.url === '/__fixture/profile-save-recover') {profileSaveFailure = false;res.end('ok');return;}
  if (req.url === '/api/user/appearance' && req.method === 'GET' && appearanceLoadFailure || req.url === '/api/profile' && req.method === 'PUT' && profileSaveFailure) {
    res.writeHead(503, {'Content-Type':'application/json'});res.end(JSON.stringify({error:'Fixture storage unavailable'}));return;
  }
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
// --private-project: a project only the administrator may access.
if (process.argv.includes("--private-project")) {
  var privateDir = path.join(fixtureHome, "private-project");
  fs.mkdirSync(privateDir);
  relay.addProject(privateDir, "private-admin", "Private admin", null, "admin");
}
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
