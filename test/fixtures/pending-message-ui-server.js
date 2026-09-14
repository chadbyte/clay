var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var WebSocket = require("ws");
var createPendingMessageQueue = require("../../lib/project-pending-message-queue").createPendingMessageQueue;
var attachUserMessage = require("../../lib/project-user-message").attachUserMessage;

var root = path.join(__dirname, "../..");
var publicRoot = path.join(root, "lib/public");
var tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pending-ui-"));
var clients = new Set();
var runtime = [];
var session = { localId: 41, sessionOriginId: "fixture-session", cliSessionId: "fixture-provider", vendor: "codex", ownerId: "fixture-user", isProcessing: true, history: [], pendingMentionContexts: [], pendingShellContexts: [] };

function sendSocket(ws, message) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(message));
}

function broadcast(message, except) {
  clients.forEach(function (ws) { if (ws !== except) sendSocket(ws, message); });
}

var queue = createPendingMessageQueue({
  filePath: path.join(tempDir, "queue.json"),
  slug: "fixture-project",
  authorize: function () { return true; },
  canMutate: function (target, actor, item) { return !item || item.actorId === (actor && actor.id); },
  broadcast: function (target, message) { broadcast(message, null); },
});

var handler = attachUserMessage({
  cwd: tempDir,
  slug: "fixture-project",
  isMate: false,
  osUsers: false,
  sm: {
    saveSessionFile: function () {},
    appendToSessionFile: function () {},
    broadcastSessionList: function () {},
  },
  sdk: {
    startQuery: function (target, text, images, linuxUser, beforePush, accepted) {
      if (beforePush && !beforePush()) return Promise.resolve(false);
      runtime.push(text);
      if (accepted) accepted();
      broadcast({ type: "fixture_runtime_started", text: text, index: runtime.length }, null);
      return Promise.resolve(true);
    },
    pushMessage: function () { return false; },
  },
  nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
  tm: { create: function () {}, attach: function () {}, list: function () { return []; } },
  clients: clients,
  send: broadcast,
  sendTo: sendSocket,
  sendToSession: function (id, message) { broadcast(message, null); },
  sendToSessionOthers: function (source, id, message) { broadcast(message, source); },
  opts: {},
  usersModule: {
    isMultiUser: function () { return true; },
    findUserById: function (id) { return id === "fixture-user" ? { id: id, displayName: "Chad" } : null; },
  },
  matesModule: {},
  _loop: { handleLoopMessage: function () { return false; } },
  getSessionForWs: function () { return session; },
  getLinuxUserForSession: function () {},
  ensureProjectAccessForSession: function () {},
  getOsUserInfoForWs: function () {},
  hydrateImageRefs: function (message) { return message; },
  saveImageFile: function () { return null; },
  imagesDir: tempDir,
  onProcessingChanged: function () {},
  gitAttribution: null,
  browserState: { _browserTabList: {} },
  authorizePendingDispatch: function (target, actor, item) { return target === session && actor && actor.id === "fixture-user" && item.projectSlug === "fixture-project"; },
  requestTabContext: function () { return Promise.resolve(null); },
  loadContextSources: function () { return []; },
  saveContextSources: function () {},
  adapter: { renameSession: function () { return Promise.resolve(); } },
  _email: null,
  pendingMessageQueue: queue,
});

function contentType(file) {
  if (/\.css$/.test(file)) return "text/css";
  if (/\.js$/.test(file)) return "text/javascript";
  if (/\.html$/.test(file)) return "text/html";
  return "application/octet-stream";
}

var server = http.createServer(function (req, res) {
  var file;
  if (req.url === "/" || req.url === "/fixture") file = path.join(__dirname, "pending-message-ui.html");
  else if (req.url.indexOf("/modules/") === 0 || req.url.indexOf("/css/") === 0 || req.url === "/style.css") file = path.join(publicRoot, req.url.split("?")[0]);
  if (!file || file.indexOf(root) !== 0 || !fs.existsSync(file)) { res.writeHead(404); res.end("Not found"); return; }
  res.writeHead(200, { "content-type": contentType(file), "cache-control": "no-store" });
  fs.createReadStream(file).pipe(res);
});

var wss = new WebSocket.Server({ server: server });
wss.on("connection", function (ws) {
  ws._clayUser = { id: "fixture-user", displayName: "Chad" };
  ws._clayActiveSession = session.localId;
  clients.add(ws);
  ws.on("close", function () { clients.delete(ws); });
  ws.on("message", function (raw) {
    var msg;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (msg.type === "fixture_seed") {
      session.isProcessing = true;
      var seeds = [
        { text: "Review the upload flow", clientMessageId: "fixture-one", images: [{ mediaType: "image/png", data: "a" }] },
        { text: "Add a concise error state", clientMessageId: "fixture-two", pastes: ["example"] },
        { text: "Document the final behavior", clientMessageId: "fixture-three" },
      ];
      for (var i = 0; i < seeds.length; i++) handler.handleUserMessage(ws, Object.assign({ type: "message" }, seeds[i]));
      return;
    }
    if (msg.type === "fixture_complete") {
      session.isProcessing = false;
      handler.consumePendingMessage(session);
      return;
    }
    if (msg.type === "fixture_stop") {
      session._pendingMessageDrainPaused = true;
      queue.pause(session, ws._clayUser);
      return;
    }
    handler.handleUserMessage(ws, msg);
  });
});

server.listen(0, "127.0.0.1", function () {
  process.stdout.write("PENDING_UI_URL=http://127.0.0.1:" + server.address().port + "/fixture\n");
});

function close() {
  clients.forEach(function (ws) { ws.terminate(); });
  wss.close();
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 500);
}

process.on("SIGTERM", close);
process.on("SIGINT", close);
