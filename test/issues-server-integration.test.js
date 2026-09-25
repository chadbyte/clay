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

test("real MCP bridge requires its local project capability", { timeout: 20000 }, async function (t) {
  var child = fork(path.join(__dirname, "fixtures/issues-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  t.after(function () { if (child.connected) child.send("close"); });
  var ready = await new Promise(function (resolve, reject) { child.once("message", resolve); child.once("error", reject); });
  var url = "http://127.0.0.1:" + ready.port + "/p/issues/api/mcp-bridge";
  var scope = { sessionOnly: true, sessionId: ready.sessionId, queryGeneration: 1 };
  var body = JSON.stringify(Object.assign({}, scope, { action: "list_tools" }));
  var denied = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", Cookie: "relay_auth_user=" + ready.token }, body: body });
  assert.equal(denied.status, 403);
  var accepted = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Clay-Bridge-Token": "issues-bridge-secret" }, body: body });
  assert.equal(accepted.status, 200);
  assert.ok((await accepted.json()).tools.some(function (tool) { return tool.server === "clay-issues" && tool.name === "create_issue"; }));
  async function call(tool, args, overrides) {
    var response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Clay-Bridge-Token": "issues-bridge-secret" },
      body: JSON.stringify(Object.assign({}, scope, { action: "call_tool", server: "clay-issues", tool: tool, args: args }, overrides || {})) });
    return response.json();
  }
  var created = await call("create_issue", { title: "Authenticated bridge fixture" });
  assert.equal(created.error, undefined);
  assert.notEqual(created.result.isError, true);
  var entry = JSON.parse(created.result.content[0].text);
  var read = await call("read_issue", { ref: entry.ref });
  assert.equal(JSON.parse(read.result.content[0].text).title, entry.title);
  var stale = await call("read_issue", { ref: entry.ref }, { queryGeneration: 2 });
  assert.ok(stale.error);
  var revoked = new Promise(function (resolve) { child.once("message", resolve); });
  child.send("revoke"); await revoked;
  var deniedRead = await call("read_issue", { ref: entry.ref });
  assert.ok(deniedRead.error || deniedRead.result && deniedRead.result.isError);
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

test("Issues guidance covers actionable work and preserves authority boundaries", function () {
  assert.match(issuesMcp.CONTRACT, /record for concrete actionable bugs, improvements, and deferred implementation/);
  assert.match(issuesMcp.CONTRACT, /proactively search or reuse an existing Issue, or create one/);
  assert.match(issuesMcp.CONTRACT, /observable evidence, affected component, impact, next action, and acceptance criteria/);
  var guidance = require("../lib/issues-filing-guidance").FILING_GUIDANCE;
  assert.ok(issuesMcp.CONTRACT.includes(guidance));
  assert.ok(require("../lib/project-logs-mcp-server").ATTENTION_CONTRACT.includes(guidance));
  assert.match(guidance, /never assume its name is main/);
  assert.match(guidance, /read-only evidence that it also affects that baseline independently of the current edits/);
  assert.match(guidance, /If baseline impact is unknown[\s\S]*do not automatically file an Issue/);
  assert.match(guidance, /work deferred only within the active task belong in that task/);
  assert.match(guidance, /explicit user request[\s\S]*including branch-specific work/);
  var noteGuidance = require("../lib/issues-filing-guidance").NOTE_GUIDANCE;
  assert.ok(issuesMcp.CONTRACT.includes(noteGuidance));
  assert.ok(require("../lib/project-logs-mcp-server").ATTENTION_CONTRACT.includes(noteGuidance));
  assert.ok(require("../lib/session-notes-mcp-server").MEMORY_CONTRACT.includes(noteGuidance));
  assert.match(noteGuidance, /two lines: a short plain-text title and the exact opaque issue: reference/);
  assert.match(noteGuidance, /check active notes/);
  assert.match(noteGuidance, /Close the linked note when its Issue is resolved or closed/);
  issuesMcp.getToolDefs().forEach(function (definition) {
    assert.ok(definition.description.includes(guidance), definition.name);
  });
  assert.match(issuesMcp.CONTRACT, /without waiting for a separate user request/);
  assert.match(issuesMcp.CONTRACT, /A declined proposal does not create a new Issue/);
  assert.match(issuesMcp.CONTRACT, /routine work fully fixed within the current task does not receive a retroactive Issue/);
  assert.match(issuesMcp.CONTRACT, /remediation and verification/);
  assert.match(issuesMcp.CONTRACT, /real repository commitSha evidence/);
  assert.match(issuesMcp.CONTRACT, /never invent references, mirror storage automatically, or expand privileges/);
});

test("Issues client keeps comment acknowledgements from replacing newer drafts or views", function () {
  var client = require("node:fs").readFileSync(path.join(__dirname, "../lib/public/modules/issues.js"), "utf8");
  assert.match(client, /issuesMutationRequest/);
  assert.match(client, /store\.get\('issuesView'\) === item\.view/);
  assert.match(client, /currentCommentInput\.value\.trim\(\) === item\.body/);
  assert.match(client, /Your current view or draft was preserved/);
});
