var http = require("http");
var fs = require("fs");
var os = require("os");
var path = require("path");
var WebSocketServer = require("ws").WebSocketServer;
var logsStore = require("../../lib/project-logs-store");
var attachService = require("../../lib/project-logs-service").attachProjectLogsService;
var attachProjectLogs = require("../../lib/project-logs").attachProjectLogs;

var projectRoot = path.resolve(__dirname, "..", "..");
var recordsDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-results-browser-"));
var routes = [
  { prefix: "/style.css", root: path.join(projectRoot, "lib", "public"), exact: true },
  { prefix: "/modules/", root: path.join(projectRoot, "lib", "public", "modules") },
  { prefix: "/css/", root: path.join(projectRoot, "lib", "public", "css") },
  { prefix: "/test/fixtures/", root: path.join(projectRoot, "test", "fixtures") },
];

function contentType(file) {
  if (file.endsWith(".html")) return "text/html; charset=utf-8";
  if (file.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (file.endsWith(".css")) return "text/css; charset=utf-8";
  return "application/octet-stream";
}

function resolveFile(url) {
  var pathname = new URL(url, "http://127.0.0.1").pathname;
  if (pathname === "/") return path.join(__dirname, "scheduled-results-browser.html");
  for (var i = 0; i < routes.length; i++) {
    var route = routes[i];
    if (route.exact && pathname === route.prefix) return path.join(route.root, pathname.slice(1));
    if (route.exact || !pathname.startsWith(route.prefix)) continue;
    var candidate = path.resolve(route.root, pathname.slice(route.prefix.length));
    if (candidate === route.root || candidate.startsWith(route.root + path.sep)) return candidate;
  }
  return null;
}

var server = http.createServer(function (request, response) {
  var file = resolveFile(request.url);
  if (!file) { response.writeHead(404); response.end("Not found"); return; }
  fs.readFile(file, function (error, data) {
    if (error) { response.writeHead(404); response.end("Unavailable"); return; }
    response.writeHead(200, { "Content-Type": contentType(file), "Cache-Control": "no-store" }); response.end(data);
  });
});

var owner = { id: "fixture-user", displayName: "Fixture User" };
var status = { slug: "fixture", path: projectRoot, projectKnowledgeId: "pk_scheduled_results_browser", projectOwnerId: owner.id };
var sessions = new Map();
function addRunSession(localId, runId) {
  var session = { localId: localId, ownerId: owner.id, sessionOriginId: "origin-" + runId, cliSessionId: "provider-" + runId, hidden: true, scheduledTaskRun: { role: "driver", scheduleId: "fixture-task", runId: runId } };
  sessions.set(localId, session); return session;
}
addRunSession(21, "fixture-reconnect");
var sm = { sessions: sessions };
var project = { getStatus: function () { return status; }, getSessionManager: function () { return sm; } };
var projects = new Map([["fixture", project]]);
var store = logsStore.createProjectLogsStore({ root: projectRoot, baseDir: recordsDir, projectKnowledgeId: status.projectKnowledgeId });
var service = attachService({
  getProjects: function () { return projects; }, isMultiUser: function () { return true; },
  findUserById: function (id) { return id === owner.id ? owner : null; }, canAccessProject: function (id) { return id === owner.id; },
  hasFullProjectAccess: function (id) { return id === owner.id; }, openStore: function () { return store; },
});
var clients = new Set();
function sendTo(socket, message) { if (socket.readyState === 1) socket.send(JSON.stringify(message)); }
var controller = attachProjectLogs({ service: service, sm: sm, projectSlug: "fixture", isMate: false, getClients: function () { return clients; }, sendTo: sendTo });
function result(runId, summary) {
  return { runId: runId, scheduleId: "fixture-task", name: "Fixture scheduled task", ownerId: owner.id, outcome: "completed", summary: summary, startedAt: Date.now() - 100, finishedAt: Date.now(), driverOriginId: "origin-" + runId, driverProviderSessionId: "provider-" + runId };
}
controller.recordScheduledResult(result("fixture-reconnect", "Unread reconnect result"));
var liveCounter = 0;
var lastLiveRunId = null;
var websocket = new WebSocketServer({ server: server, path: "/ws" });
websocket.on("connection", function (socket) {
  socket._clayUser = owner; clients.add(socket); controller.sendScheduledResultState(socket);
  socket.on("message", function (raw) {
    var message;
    try { message = JSON.parse(raw.toString()); } catch (error) { return; }
    if (message.type === "fixture_create_live") {
      liveCounter += 1; lastLiveRunId = "fixture-live-" + liveCounter; addRunSession(21 + liveCounter, lastLiveRunId);
      controller.recordScheduledResult(result(lastLiveRunId, "Live result " + liveCounter)); return;
    }
    if (message.type === "fixture_duplicate_live" && lastLiveRunId) { controller.recordScheduledResult(result(lastLiveRunId, "Duplicate must not notify")); return; }
    if (message.type === "switch_session") { sendTo(socket, { type: "fixture_session_switched", sessionId: message.id }); return; }
    controller.handleLogsMessage(socket, message);
  });
  socket.on("close", function () { clients.delete(socket); });
});

server.listen(0, "127.0.0.1", function () { process.stdout.write(String(server.address().port) + "\n"); });
function stop() {
  for (var socket of clients) socket.close();
  websocket.close(); server.close(function () { fs.rmSync(recordsDir, { recursive: true, force: true }); process.exit(0); });
}
process.on("SIGTERM", stop); process.on("SIGINT", stop);
