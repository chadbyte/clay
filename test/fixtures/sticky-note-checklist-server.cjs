var http = require("http");
var fs = require("fs");
var path = require("path");
var os = require("os");
// Always isolate storage before loading config or any production manager.
var fixtureHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-sticky-fixture-"));
process.env.CLAY_HOME = fixtureHome;
delete process.env.CLAY_CONFIG;
var WebSocketServer = require("ws").WebSocketServer;
var attachUserMessage = require("../../lib/project-user-message").attachUserMessage;
var createNotesManager = require("../../lib/notes").createNotesManager;
var port = parseInt(process.env.STICKY_NOTE_FIXTURE_PORT || "2647", 10);
var root = path.resolve(__dirname, "../..");
var cwd = path.join(fixtureHome, "project");
fs.mkdirSync(cwd);
var nm = createNotesManager({ cwd: cwd });
if (nm.list().length === 0) nm.create({ text: "Plan\nFirst task\nSecond task\n~~~js\n[ ] literal code\n~~~\nFirst task", x: 24, y: 90, w: 440, h: 300, color: "purple", opacity: 0.64 });
var clients = new Set();
var failNextSave = false;
var delayNextSave = false;
var omitNextBroadcast = false;
var delayNextAck = false;
var context = {
  cwd: cwd, slug: "sticky-checklist-fixture", isMate: false, osUsers: [], sm: {}, sdk: {}, tm: {}, opts: {}, matesModule: {}, browserState: {}, clients: clients, nm: nm,
  usersModule: { isMultiUser: function () { return false; }, findUserById: function () { return null; }, canAccessProject: function () { return true; } },
  send: function (msg) { if (omitNextBroadcast && msg.type === "note_updated") { omitNextBroadcast = false; return; } clients.forEach(function (client) { if (client.readyState === 1) client.send(JSON.stringify(msg)); }); },
  sendTo: function (ws, msg) { if (delayNextAck && msg.type === "note_update_result") { delayNextAck = false; setTimeout(function () { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); }, 400); return; } if (ws && ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  sendToSession: function () {}, sendToSessionOthers: function () {}, getSessionForWs: function () { return null; }, getLinuxUserForSession: function () { return null; }, ensureProjectAccessForSession: function () { return true; }, getOsUserInfoForWs: function () { return null; }, getProjectAccess: function () { return null; }, canAccessProjectSlug: function () { return true; }, hydrateImageRefs: function (x) { return x; }, saveImageFile: function () {}, onProcessingChanged: function () {}, onSessionDone: function () {}, _loop: { handleLoopMessage: function () {} }, sendExtensionCommandAny: function () {}, requestTabContext: function () {}, scheduleMessage: function () {}, cancelScheduledMessage: function () {}, sendScheduledMessageNow: function () {}, pendingMessageQueue: null, loadContextSources: function () {}, saveContextSources: function () {}, digestDmTurn: function () {}, gateMemory: function () {}, adapter: null,
};
var handler = attachUserMessage(context);
function dispatch(ws, msg) {
  if (msg.type === "fixture_omit_broadcast") { omitNextBroadcast = true; return; }
  if (msg.type === "fixture_delay_ack") { delayNextAck = true; return; }
  if (msg.type === "fixture_delay_next") { delayNextSave = true; return; }
  if (delayNextSave && msg.type === "note_update") {
    delayNextSave = false;
    setTimeout(function () { dispatch(ws, msg); }, 400);
    return;
  }
  if (msg.type === "fixture_fail_next") { failNextSave = true; return; }
  var originalWrite = fs.writeFileSync;
  if (failNextSave && msg.type === "note_update") { failNextSave = false; fs.writeFileSync = function () { throw new Error("fixture injected save failure"); }; }
  try { handler.handleUserMessage(ws, msg); } finally { fs.writeFileSync = originalWrite; }
}
function contentType(file) { if (file.endsWith(".js")) return "text/javascript"; if (file.endsWith(".css")) return "text/css"; if (file.endsWith(".png")) return "image/png"; return "text/html"; }
var server = http.createServer(function (req, res) {
  if (req.url === "/fixture-state") { res.writeHead(200, { "Content-Type": "application/json" }); res.end(JSON.stringify(nm.list())); return; }
  var requested = req.url === "/" ? "/test/fixtures/sticky-note-checklist-browser.html" : req.url.split("?")[0];
  var file = path.resolve(root, "." + requested);
  if (file.indexOf(root) !== 0) { res.writeHead(403); res.end(); return; }
  fs.readFile(file, function (error, data) { if (error) { res.writeHead(404); res.end("Not found"); return; } res.writeHead(200, { "Content-Type": contentType(file) }); res.end(data); });
});
var wss = new WebSocketServer({ server: server });
wss.on("connection", function (ws) { clients.add(ws); ws._clayUser = null; ws.send(JSON.stringify({ type: "notes_list", notes: nm.list() })); ws.on("message", function (raw) { try { dispatch(ws, JSON.parse(String(raw))); } catch (error) { ws.send(JSON.stringify({ type: "fixture_error", error: error.message })); } }); ws.on("close", function () { clients.delete(ws); }); });
server.listen(port, "127.0.0.1", function () { console.log("Sticky note checklist fixture: http://127.0.0.1:" + port + "/"); });

function stop() {
  clients.forEach(function (client) { client.terminate(); });
  wss.close();
  server.close(function () { fs.rmSync(fixtureHome, { recursive: true, force: true }); process.exit(0); });
}
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
process.once("exit", function () { fs.rmSync(fixtureHome, { recursive: true, force: true }); });
