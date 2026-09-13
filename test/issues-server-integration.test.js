var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;
var WebSocket = require("ws");
var schema = require("../lib/ws-schema").schema;
var issuesMcp = require("../lib/issues-mcp-server");

function next(socket, type, requestId) {
  return new Promise(function (resolve, reject) {
    var timer = setTimeout(function () { reject(new Error("Timed out waiting for " + type)); }, 8000);
    function receive(raw) {
      var message = JSON.parse(raw.toString());
      if (message.type !== type || requestId && message.requestId !== requestId) return;
      clearTimeout(timer); socket.removeListener("message", receive); resolve(message);
    }
    socket.on("message", receive);
  });
}

test("real server factory routes authorized Issues WS and rich-reference requests", { timeout: 20000 }, async function (t) {
  var child = fork(path.join(__dirname, "fixtures/issues-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(function () { if (child.connected) child.send("close"); });
  var ready = await new Promise(function (resolve, reject) { child.once("message", resolve); child.once("error", reject); });
  var socket = new WebSocket("ws://127.0.0.1:" + ready.port + "/p/issues/ws", { headers: { Cookie: "relay_auth_user=" + ready.token } });
  t.after(function () { socket.close(); });
  await next(socket, "info");
  var createdWait = next(socket, "issues_result", "create-real");
  socket.send(JSON.stringify({ type: "issue_create", requestId: "create-real", args: { title: "Real server issue", summary: "Factory path" } }));
  var created = await createdWait;
  assert.match(created.error, /cannot create issues directly/);
  var linkWait = next(socket, "issue_reference_result", "link-real");
  socket.send(JSON.stringify({ type: "issue_reference_resolve", requestId: "link-real", ref: "issue:" + "a".repeat(24) }));
  var linked = await linkWait;
  assert.ok(linked.error);
  var revoked = new Promise(function (resolve) { child.once("message", resolve); });
  var disconnected = new Promise(function (resolve) { socket.once("close", resolve); });
  child.send("revoke"); await revoked; await disconnected;
  assert.notEqual(socket.readyState, WebSocket.OPEN);
});

test("Issues protocol and MCP permission namespaces are registered at production entry points", function () {
  var names = ["issues_list", "issue_read", "issue_create", "issue_update", "issue_history", "issue_revision", "issue_comment", "issue_delete",
    "issue_start_work", "issue_open_work", "issues_result", "issue_updated", "issue_commented", "issue_deleted", "issue_reference_resolve", "issue_reference_result"];
  for (var i = 0; i < names.length; i++) assert.ok(schema[names[i]], names[i]);
  var bridge = require("node:fs").readFileSync(path.join(__dirname, "../lib/sdk-bridge.js"), "utf8");
  assert.match(bridge, /mcp__clay-issues__/);
  assert.match(bridge, /behavior:\s*"allow"/);
  var project = require("node:fs").readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  assert.match(project, /getDynamicToolDefs\(session\)/);
  assert.match(project, /createMcpServer\(adapter, forSession\)/);
  assert.match(project, /callBridgeTool\(boundSession, toolName, args\)/);
});

test("Issues guidance makes deferred defects primary and preserves authority boundaries", function () {
  assert.match(issuesMcp.CONTRACT, /primary record for concrete defects/);
  assert.match(issuesMcp.CONTRACT, /search or reuse an existing issue before creating one/);
  assert.match(issuesMcp.CONTRACT, /observable evidence, affected component, impact, and next action/);
  assert.match(issuesMcp.CONTRACT, /remediation and verification/);
  assert.match(issuesMcp.CONTRACT, /real repository commitSha evidence/);
  assert.match(issuesMcp.CONTRACT, /never invent references, drop defect alerts, mirror storage automatically, or expand privileges/);
});

test("Issues client keeps comment acknowledgements from replacing newer drafts or views", function () {
  var client = require("node:fs").readFileSync(path.join(__dirname, "../lib/public/modules/issues.js"), "utf8");
  assert.match(client, /issuesMutationRequest/);
  assert.match(client, /store\.get\('issuesView'\) === item\.view/);
  assert.match(client, /currentCommentInput\.value\.trim\(\) === item\.body/);
  assert.match(client, /Your current view or draft was preserved/);
});
