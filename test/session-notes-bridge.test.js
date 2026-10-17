// Exact-query MCP bridge list/call for native checklist notes against a real Clay server.
var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var fork = require("node:child_process").fork;

function message(child, key) {
  return new Promise(function (resolve, reject) {
    function onMessage(value) { if (value && value[key] !== undefined) { child.off("message", onMessage); resolve(value); } }
    child.on("message", onMessage);
    child.once("error", reject);
  });
}

test("the exact-query bridge lists checklist schemas and refuses retired or revoked sources", { timeout: 30000 }, async function (t) {
  var child = fork(path.join(__dirname, "fixtures/notes-bridge-server.js"), [], { stdio: ["ignore", "ignore", "pipe", "ipc"] });
  var exited = new Promise(function (resolve) { child.once("exit", resolve); });
  t.after(function () { if (child.connected) child.send("close"); return exited; });
  var ready = await message(child, "port");
  var url = "http://127.0.0.1:" + ready.port + "/p/notes/api/mcp-bridge";
  async function post(body, generation) {
    var response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", "X-Clay-Bridge-Token": "notes-bridge-secret" },
      body: JSON.stringify(Object.assign({ sessionOnly: true, sessionId: ready.sessionId, queryGeneration: generation || 1 }, body)) });
    assert.equal(response.status, 200);
    return response.json();
  }
  async function call(tool, args, generation) {
    var reply = await post({ action: "call_tool", server: "clay-notes", tool: tool, args: args }, generation);
    if (reply.error) return { error: reply.error };
    var text = reply.result.content[0].text;
    return reply.result.isError ? { error: text } : JSON.parse(text);
  }

  var listed = await post({ action: "list_tools" });
  var write = listed.tools.find(function (tool) { return tool.server === "clay-notes" && tool.name === "write_note"; });
  assert.ok(write, "write_note is listed for the bound current query");
  var props = write.inputSchema.properties;
  assert.equal(props.version.type, "number");
  assert.equal(props.checklist.type, "boolean");
  assert.equal(props.checks.type, "array");
  assert.equal(props.checks.items.type, "object");
  assert.equal(props.checks.items.properties.item.type, "string");
  assert.equal(props.checks.items.properties.checked.type, "boolean");
  assert.deepEqual((props.checks.items.required || []).slice().sort(), ["checked", "item"]);
  assert.equal((write.inputSchema.required || []).indexOf("text"), -1);
  assert.ok(listed.tools.some(function (tool) { return tool.server === "clay-notes" && tool.name === "list_notes"; }));

  var created = await call("write_note", { text: "Release\n- [ ] build\n- [x] docs", checklist: true });
  assert.equal(created.checklistMode, true);
  var notes = await call("list_notes", {});
  assert.equal(notes[0].version, created.version);
  var build = notes[0].checklist.items[0];
  var checked = await call("write_note", { id: created.id, version: created.version, checks: [{ item: build.item, checked: true }] });
  assert.equal(checked.checklist.items[0].checked, true);
  var stale = await call("write_note", { id: created.id, version: created.version, checks: [{ item: build.item, checked: false }] });
  assert.match(stale.error, /has changed/);

  // A query generation that is not the session's current one is refused for list and call.
  assert.deepEqual((await post({ action: "list_tools" }, 2)).tools, []);
  assert.match((await call("list_notes", {}, 2)).error, /older query/);
  await (child.send("advance"), message(child, "advanced"));
  assert.match((await call("write_note", { id: created.id, version: checked.version, checklist: false }, 1)).error, /older query/, "the retired generation is refused");
  var current = await call("list_notes", {}, 2);
  assert.equal(current[0].version, checked.version, "the retired call changed nothing");

  // Revoked project access refuses the current generation too.
  await (child.send("revoke"), message(child, "revoked"));
  var revoked = await call("write_note", { id: created.id, version: checked.version, checklist: false }, 2);
  assert.ok(revoked.error, "a revoked source cannot write");
  assert.doesNotMatch(revoked.error, /older query/, "refused for revoked access, not for a stale generation");
  await (child.send("restore"), message(child, "restored"));
  assert.equal((await call("list_notes", {}, 2))[0].checklistMode, true, "the revoked call changed nothing");

  // A retired (removed) session binding lists nothing and cannot call.
  await (child.send("retire"), message(child, "retired"));
  assert.deepEqual((await post({ action: "list_tools" }, 2)).tools, []);
  assert.match((await call("list_notes", {}, 2)).error, /unavailable or older query/);
});
