// Captures the exact message sequence project-connection.js sends to a
// reconnecting browser, using the real session manager and connection code.
// Callers must set CLAY_HOME to an isolated directory before requiring this.
var fs = require("fs");
var os = require("os");
var path = require("path");
var createSessionManager = require("../../lib/sessions").createSessionManager;
var attachConnection = require("../../lib/project-connection").attachConnection;

function buildHistory(shape, size) {
  var ts = 1700000000000;
  var history = [{ type: "user_message", text: "Review the restored conversation.", _ts: ts }];
  history.push({ type: "tool_start", id: "old-tool", name: "Read", _ts: ts });
  history.push({ type: "tool_executing", id: "old-tool", name: "Read", input: { file_path: "/fixture/old.js" }, _ts: ts });
  history.push({ type: "tool_result", id: "old-tool", content: "Saved file contents", _ts: ts });
  history.push({ type: "thinking_start", _ts: ts });
  for (var i = 0; i < size; i++) history.push({ type: "thinking_delta", text: "Reason " + i + ". ", _ts: ts + i });
  history.push({ type: "thinking_stop", duration: 20, _ts: ts });
  if (shape === "tool") {
    history.push({ type: "tool_start", id: "active-tool", name: "Bash", _ts: ts });
    history.push({ type: "tool_executing", id: "active-tool", name: "Bash", input: { command: "npm test" }, _ts: ts });
    return history;
  }
  for (var j = 0; j < size; j++) history.push({ type: "delta", text: "Word" + j + " ", _ts: ts + 5000 + j });
  if (shape === "idle") {
    history.push({ type: "result", cost: 0.01, usage: { input_tokens: 10, output_tokens: 20 }, _ts: ts });
    history.push({ type: "done", code: 0, _ts: ts });
  }
  return history;
}

function captureReconnect(options) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-replay-reconnect-"));
  try {
    var sm = createSessionManager({ cwd: path.join(dir, "project"), sessionsBase: path.join(dir, "sessions"),
      cliSessionsDir: path.join(dir, "cli"), send: function () {}, sendTo: function () {}, sendEach: function () {} });
    var session = sm.createSessionRaw({ cliSessionId: "cli-replay", vendor: options.vendor || "claude" });
    session.title = "Replay";
    // Restore picks the most recent session; never tie with the default one.
    session.lastActivity = Date.now() + 60000;
    session.history = options.history || buildHistory(options.shape, options.size || 200);
    session.isProcessing = options.processing != null ? !!options.processing : options.shape !== "idle";
    if (options.shape === "tool") {
      session.pendingPermissions["perm-1"] = { requestId: "perm-1", toolName: "Bash", toolInput: { command: "npm test" }, toolUseId: "active-tool" };
    }
    var sent = [];
    var connection = attachConnection({
      cwd: "/srv/replay", slug: "replay", clients: new Set(), opts: {}, sm: sm,
      tm: { list: function () { return []; }, detachAll: function () {} }, nm: { list: function () { return []; } },
      _loop: { loopState: {}, sendConnectionState: function () {} },
      sendTo: function (ws, msg) { if (ws.readyState === 1) sent.push(JSON.parse(JSON.stringify(msg))); },
      broadcastClientCount: function () {}, broadcastPresence: function () {},
      getProjectList: function () { return []; }, getHubSchedules: function () { return []; },
      getTitle: function () { return "Replay"; }, getProject: function () { return "replay"; },
      getProjectOwnerId: function () { return null; },
      hydrateImageRefs: function (item) { return item; },
      loadContextSources: function () { return []; },
      restoreDebateState: function () {},
    });
    var ws = { readyState: 1, on: function () {} };
    connection.handleConnection(ws, null, function () {}, function () {});
    return sent;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

module.exports = { captureReconnect: captureReconnect };
