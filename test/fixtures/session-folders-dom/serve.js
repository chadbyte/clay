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
var attach = require(path.join(root, "lib/project-session-folders")).attachSessionFolders;

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
  var usersModule = {
    isMultiUser: function () { return true; },
    canAccessSession: function (uid, s) { return s.ownerId === uid || s.sessionVisibility === "shared"; },
    getSessionFolders: function (uid, slug) { return folders.normalizeState(store[uid + "/" + slug]); },
    setSessionFolders: function (uid, slug, st) { store[uid + "/" + slug] = folders.normalizeState(st); return { ok: true, state: store[uid + "/" + slug] }; },
  };
  var sockets = { u1: { _clayUser: { id: "u1" }, id: "u1-a" }, u1b: { _clayUser: { id: "u1" }, id: "u1-b" }, u2: { _clayUser: { id: "u2" }, id: "u2-a" } };
  var clients = new Set(Object.keys(sockets).map(function (k) { return sockets[k]; }));
  var handler = attach({
    sm: { sessions: sessions }, usersModule: usersModule, slug: "proj", clients: clients,
    sendTo: function (ws, msg) { outbox.push({ to: ws.id, msg: msg }); },
  });
  return { store: store, outbox: outbox, sessions: sessions, sockets: sockets, handler: handler, add: add };
}

var world = build();

function readBody(req, cb) {
  var chunks = [];
  req.on("data", function (c) { chunks.push(c); });
  req.on("end", function () { cb(Buffer.concat(chunks).toString("utf8")); });
}

http.createServer(function (req, res) {
  var url = req.url.split("?")[0];
  if (req.method === "POST" && url === "/rpc") {
    return readBody(req, function (body) {
      var payload = JSON.parse(body);
      world.outbox.length = 0;
      var ws = world.sockets[payload.socket || "u1"];
      world.handler.handleMessage(ws, payload.msg);
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify(world.outbox));
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
  if (req.method === "GET" && url === "/rpc/stored") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(world.store));
    return;
  }
  var file = url === "/" ? path.join(__dirname, "harness.html") : url === "/harness.js" ? path.join(__dirname, "harness.js") : path.join(pub, url);
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
