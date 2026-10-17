var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var fixtureHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-project-list-access-")));
process.env.HOME = fixtureHome;
delete process.env.SUDO_USER;
delete process.env.SUDO_HOME;
process.env.CLAY_HOME = fixtureHome;

var tokens = {
  owner: "owner:project-list-token",
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
  records[tokens.owner] = "owner";
  records[tokens.member] = "member";
  records[tokens.outsider] = "outsider";
  records[tokens.admin] = "admin";
  return records;
})()));

var projectAccess = require("../../lib/daemon-project-access");
var yoke = require("../../lib/yoke");
var createAdapters = yoke.createAdapters;
yoke.createAdapters = function (options) {
  var state = createAdapters(options);
  Object.keys(state.adapters).forEach(function (vendor) {
    state.adapters[vendor].init = function () { return Promise.resolve({ models: [], slashCommands: [] }); };
    state.adapters[vendor].createQuery = function () { throw new Error("Model turns are disabled in the ownership fixture"); };
  });
  return state;
};
yoke.completeOnce = function () { return Promise.reject(new Error("External completions are disabled in the ownership fixture")); };
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

if (process.env.OWNERSHIP_RECOVERY_FIXTURE === "1") {
  config.projects.push({ slug: "orphan", path: path.join(fixtureHome, "orphan"), visibility: "private", ownerId: "deleted-account", ownershipRecovery: "required" });
}

for (var i = 0; i < config.projects.length; i++) fs.mkdirSync(config.projects[i].path, { recursive: true });
var inheritedPath = path.join(fixtureHome, "parent-inherited");
var outsiderPath = path.join(fixtureHome, "parent-outsider");
fs.mkdirSync(inheritedPath, { recursive: true });
fs.mkdirSync(outsiderPath, { recursive: true });

var relay = createServer({
  port: 0,
  getRemovedProjects: function () { return []; },
  onGetProjectAccess: function (slug) { return projectAccess.getProjectAccess(config, slug, false); },
  onSetProjectAllowedUsers: function (slug, ids) { return projectAccess.setAllowedUsers(config, slug, ids); },
  onSetProjectVisibility: function () { throw new Error("Foreign mutation reached callback"); },
  onProjectOwnerChanged: function (slug, ownerId) {
    var next = JSON.parse(JSON.stringify(config));
    var entry = next.projects.find(function (project) { return project.slug === slug; });
    if (!entry) return { error: "Project not found" };
    entry.ownerId = ownerId;
    require("../../lib/config").saveConfig(next);
    config = next;
    relay.refreshProjectAccess();
    return { ok: true };
  },
});
for (var p = 0; p < config.projects.length; p++) {
  var project = config.projects[p];
  relay.addProject(project.path, project.slug, project.slug === "hidden" ? "Hidden Secret Project" : project.slug, null, project.ownerId);
}
relay.addProject(inheritedPath, "parent--inherited", "Inherited Worktree", null, "owner", { parentSlug: "parent" });
relay.addProject(outsiderPath, "parent--outsider", "Outsider Worktree", null, "owner", { parentSlug: "parent" });

relay.forEachProject(function (context, slug) {
  var session = context.getSessionManager().createSessionRaw({ ownerId: slug === "hidden" ? "outsider" : "owner" });
  session.title = "PRIVATE_SESSION_SENTINEL";
  session.history.push({ type: "assistant", text: "PRIVATE_MESSAGE_SENTINEL" });
});

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
  if (message === "notify-private") {
    relay.forEachProject(function (context, slug) {
      if (slug !== "public") return;
      var session = Array.from(context.getSessionManager().sessions.values()).find(function (entry) { return entry.ownerId === "owner"; });
      context.getNotificationsModule().notify("response_done", { slug: slug, ownerId: "owner", sessionId: session.localId, title: "PRIVATE_NOTIFICATION_SENTINEL", preview: "PRIVATE_PREVIEW_SENTINEL" });
    });
    if (process.send) process.send({ notified: true });
  }
  if (message === "close") closeFixture();
});
process.on("SIGINT", closeFixture);
process.on("SIGTERM", closeFixture);

var productionHandler = relay.server.listeners("request")[0];
relay.server.removeAllListeners("request");
relay.server.on("request", function (req, res) {
  var login = /^\/__fixture\/(admin|owner|outsider)$/.exec(req.url);
  if (login) {
    res.writeHead(302, { "Set-Cookie": "relay_auth_user=" + tokens[login[1]] + "; Path=/; HttpOnly; SameSite=Strict", Location: "/p/public/" });
    res.end();
    return;
  }
  // Keep the production shell and modules; serve external script dependencies
  // locally so browser verification does not depend on browser CDN access.
  if (req.url.indexOf("/__fixture/asset/") === 0) {
    var assetUrl = decodeURIComponent(req.url.substring("/__fixture/asset/".length));
    if (assetUrl.indexOf("https://cdn.jsdelivr.net/") !== 0) { res.writeHead(404); res.end(); return; }
    try {
      var body = "";
      if (assetUrl.indexOf("marked") !== -1) body = fs.readFileSync(path.join(path.dirname(require.resolve("marked/package.json")), "marked.min.js"));
      else if (assetUrl.indexOf("dompurify") !== -1 || assetUrl.indexOf("lucide") !== -1) {
        body = require("node:child_process").execFileSync("curl", ["-fsSL", "--max-time", "5", assetUrl], { maxBuffer: 20000000 });
      } else body = 'window.hljs={highlightElement:function(){}};window.twemoji={parse:function(value){return value;}};window.mermaid={initialize:function(){}};';
      res.writeHead(200, { "Content-Type": "text/javascript" }); res.end(body);
    } catch (error) { res.writeHead(502); res.end(); }
    return;
  }
  var originalEnd = res.end;
  res.end = function (body) {
    if (typeof body === "string" && body.indexOf("<!DOCTYPE html>") === 0) {
      body = body.replace(/src="(https:\/\/cdn\.jsdelivr\.net\/[^"]+)"/g, function (match, url) {
        return 'src="/__fixture/asset/' + encodeURIComponent(url) + '"';
      });
    }
    return originalEnd.call(res, body);
  };
  productionHandler(req, res);
});

relay.server.listen(0, "127.0.0.1", function () {
  if (process.send) process.send({ port: relay.server.address().port, tokens: tokens });
  else console.log("OWNERSHIP_FIXTURE_URL=http://127.0.0.1:" + relay.server.address().port);
});
