// Review fixture: serves lib/public plus a harness page that drives the
// PRODUCTION sidebar/folder client modules in a real browser DOM, with every
// folder message round-tripped through the PRODUCTION server handler
// (lib/project-session-folders.js) over HTTP. Nothing reads or writes any real
// Clay configuration: users and folder storage are in memory.
//
//   node test/fixtures/session-folders-dom/serve.js [port]   (default 2711)
//   open http://127.0.0.1:<port>/            (results are printed on the page)

var http = require("http");
var fs = require("fs");
var path = require("path");

var root = path.join(__dirname, "../../..");
var pub = path.join(root, "lib/public");
var folders = require(path.join(root, "lib/session-folders"));
var attachSessions = require(path.join(root, "lib/project-sessions")).attachSessions;
var newSessionDefault = require(path.join(root, "lib/new-session-default"));

var PORT = parseInt(process.argv[2] || "2711", 10);
var MIME = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".svg": "image/svg+xml", ".png": "image/png", ".json": "application/json" };

function build() {
  var store = {};
  var outbox = [];
  var sessions = new Map();
  function add(id, extra) {
    sessions.set(id, Object.assign({ localId: id, sessionOriginId: "origin-" + id, ownerId: "u1", sessionVisibility: "private", lastActivity: 1000 + id }, extra || {}));
  }
  add(1); add(2); add(3);
  add(4, { sessionProvenance: { kind: "worker", parentSessionOriginId: "origin-3", generation: 1 } });
  add(5, { sessionProvenance: { kind: "worker", parentSessionOriginId: "origin-3", generation: 2 } });
  add(6, { ownerId: "u2" });
  var flags = { denyDelete: false, canSetDefault: true, optionsDelay: 0, saveFail: false, defaultFail: false, dropOptions: false };
  var config = { projects: [{ slug: "proj", title: "Project", keepMe: { nested: true } }, { slug: "proj--wt", title: "Worktree" }] };
  var usersModule = {
    isMultiUser: function () { return true; },
    canAccessSession: function (uid, s) { return s.ownerId === uid || s.sessionVisibility === "shared"; },
    getEffectivePermissions: function () { return { sessionDelete: !flags.denyDelete, projectSettings: flags.canSetDefault }; },
    findUserById: function (id) { return id === "u1" || id === "u2" ? { id: id, role: "user" } : null; },
    getSessionFolders: function (uid, slug) { return folders.normalizeState(store[uid + "/" + slug]); },
    setSessionFolders: function (uid, slug, st) {
      if (flags.saveFail) return { error: "Could not save folders" };
      store[uid + "/" + slug] = folders.normalizeState(st);
      return { ok: true, state: store[uid + "/" + slug] };
    },
  };
  var sockets = { u1: { _clayUser: { id: "u1" }, id: "u1-a" }, u1b: { _clayUser: { id: "u1" }, id: "u1-b" }, u2: { _clayUser: { id: "u2" }, id: "u2-a" } };
  var clients = new Set(Object.keys(sockets).map(function (k) { return sockets[k]; }));
  var nextId = 100;
  var sm = {
    sessions: sessions, defaultVendor: "claude", currentEffort: "medium", lastVendor: null, permissionRequestIndex: {},
    deleteSessionsBulk: function (ids) { ids.forEach(function (id) { sessions.delete(id); }); },
    sweepBlankSessions: function () {},
    findReusableBlankSession: function () { return null; },
    createSession: function (opts) { var id = nextId++; add(id, Object.assign({ title: "Created " + id }, opts)); return sessions.get(id); },
    switchSession: function () {},
  };
  function sendTo(ws, msg) { outbox.push({ to: ws.id, msg: msg }); }
  var configSaves = [];
  // The PRODUCTION project-sessions handler: folders, deletion, creation, the
  // project default (through the production config module) and new_session.
  var handler = attachSessions({
    cwd: "/tmp", slug: "proj", isMate: false, osUsers: null, sm: sm, sdk: {}, tm: null, clients: clients,
    opts: {
      onGetProjectNewSessionDefault: function (slug) { return newSessionDefault.getNewSessionDefault(config, slug); },
      onSetProjectNewSessionDefault: function (slug, preference) {
        if (flags.defaultFail) return { ok: false, error: "Could not save the project default" };
        return newSessionDefault.setNewSessionDefault(config, slug, preference, function (c) { configSaves.push(JSON.stringify(c)); });
      },
    },
    usersModule: usersModule, getProjectAccess: function () { return { visibility: "public", ownerId: "u1" }; },
    send: function (m) { outbox.push({ to: "all", msg: m }); }, sendTo: sendTo,
    userPresence: { setPresence: function () {}, sessionIdForPersistence: function (x) { return x.localId; } },
    broadcastPresence: function () {},
    getVendorAvailability: function () { return [
      { id: "claude", displayName: "Claude Code", installed: true }, { id: "codex", displayName: "Codex", installed: true }, { id: "kimi", displayName: "Kimi Code", installed: true },
      { id: "kiro", displayName: "Kiro CLI", installed: false }, { id: "opencode", displayName: "OpenCode", installed: false },
    ]; },
  });
  function handleAll(ws, msg) {
    if (flags.dropOptions && msg.type === "new_session_options_get") return true;
    return handler.handleSessionsMessage(ws, msg);
  }
  return { store: store, outbox: outbox, sessions: sessions, sockets: sockets, handler: { sendStateTo: handler.sendSessionFoldersState }, add: add, flags: flags, handleAll: handleAll, pending: [], config: config, configSaves: configSaves, browserResult: null };
}

var world = build();

function readBody(req, cb) {
  var chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", function () { cb(Buffer.concat(chunks).toString("utf8")); });
}

http.createServer(function (req, res) {
  var url = req.url.split("?")[0];
  if (req.method === "GET" && url === "/api/generated-avatar") {
    var params = new URL(req.url, "http://localhost").searchParams;
    require(path.join(root, "lib/dicebear-avatar")).renderAvatar(params.get("style"), params.get("seed"), params.get("size")).then(function (svg) {
      res.setHeader("content-type", "image/svg+xml");
      res.end(svg);
    }).catch(function () { res.statusCode = 500; res.end(); });
    return;
  }
  if (req.method === "POST" && url === "/rpc") {
    return readBody(req, function (body) {
      var payload = JSON.parse(body);
      world.outbox.length = 0;
      var ws = world.sockets[payload.socket || "u1"];
      world.pending.length = 0;
      world.handleAll(ws, payload.msg);
      // Creation messages answer asynchronously (catalogs); wait for them.
      var waiting = Promise.all(world.pending.slice());
      var started = Date.now();
      function finish() {
        res.setHeader("content-type", "application/json");
        res.end(JSON.stringify(world.outbox));
      }
      if (payload.msg && /^new_session/.test(payload.msg.type)) {
        setTimeout(function () { waiting.then(finish); }, 60);
      } else finish();
    });
  }
  if (req.method === "POST" && url === "/rpc/connect") {
    return readBody(req, function (body) {
      var payload = JSON.parse(body);
      world.outbox.length = 0;
      world.handler.sendStateTo(world.sockets[payload.socket || "u1"]);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(world.outbox));
    });
  }
  if (req.method === "POST" && url === "/rpc/reset") {
    world = build();
    res.end("{}");
    return;
  }
  if (req.method === "POST" && url === "/rpc/default") {
    return readBody(req, function (body) { world.config.projects[0].newSessionDefault = JSON.parse(body).value; res.end("{}"); });
  }
  if (req.method === "GET" && url === "/rpc/default") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ value: world.config.projects[0].newSessionDefault || null, keepMe: world.config.projects[0].keepMe, worktree: require(path.join(root, "lib/new-session-default")).getNewSessionDefault(world.config, "proj--wt").preference }));
    return;
  }
  if (req.method === "POST" && url === "/rpc/flags") {
    return readBody(req, function (body) {
      Object.assign(world.flags, JSON.parse(body));
      res.end("{}");
    });
  }
  if (req.method === "POST" && url === "/rpc/add-session") {
    return readBody(req, function (body) {
      var payload = JSON.parse(body);
      world.add(payload.id, payload.extra);
      res.end("{}");
    });
  }
  if (req.method === "GET" && url === "/rpc/sessions") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(Array.from(world.sessions.keys())));
    return;
  }
  if (req.method === "GET" && url === "/rpc/stored") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(world.store));
    return;
  }
  if (req.method === "POST" && url === "/rpc/result") {
    return readBody(req, function (body) {
      world.browserResult = JSON.parse(body);
      res.end("{}");
    });
  }
  if (req.method === "GET" && url === "/rpc/result") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(world.browserResult));
    return;
  }
  var fixtureFiles = {
    "/": "harness.html",
    "/harness.js": "harness.js",
    "/session-list-production.html": "session-list-production.html",
    "/session-list-production.js": "session-list-production.js",
    "/header-production.html": "header-production.html",
    "/header-production.js": "header-production.js",
    "/mate-settings.html": "mate-settings.html",
    "/mate-settings.js": "mate-settings.js",
    "/worker-flow.html": "worker-flow.html",
    "/worker-flow.js": "worker-flow.js",
    "/clay-primary.html": "clay-primary.html",
    "/clay-primary.js": "clay-primary.js",
    "/clay-primary-stubs.js": "clay-primary-stubs.js",
  };
  var file = fixtureFiles[url] ? path.join(__dirname, fixtureFiles[url]) : path.join(pub, url);
  if (file.indexOf(pub) !== 0 && file.indexOf(__dirname) !== 0) { res.statusCode = 403; return res.end(); }
  fs.readFile(file, function (err, data) {
    if (err) { res.statusCode = 404; return res.end("not found"); }
    res.setHeader("content-type", MIME[path.extname(file)] || "application/octet-stream");
    res.setHeader("cache-control", "no-store");
    res.end(data);
  });
}).listen(PORT, "127.0.0.1", function () {
  console.log("session-folders DOM harness on http://127.0.0.1:" + PORT + "/ (pid " + process.pid + ")");
});
