var test = require("node:test");
var assert = require("node:assert/strict");
var kit = require("../lib/yoke/adapters/claude").contractTestKit;

function workerFixture(send) {
  var receive;
  return {
    worker: {
      process: { killed: false, exitCode: null },
      exitPromise: Promise.resolve(),
      permissionModeTimeoutMs: 5,
      onMessage: function(handler) { receive = handler; },
      send: send || function() { return true; },
    },
    receive: function(message) { receive(message); },
  };
}

test("PreToolUse policy defers undecided calls and maps mandatory decisions", async function () {
  var options = { hooks: { PreToolUse: [{ hooks: [async function() { return { continue: true }; }] }] } };
  var seenOptions = null;
  kit.attachPreToolUsePolicy(options, function(toolName, input, hookOptions) {
    seenOptions = hookOptions;
    if (toolName === "Read") return { behavior: "allow", updatedInput: input };
    if (toolName === "Blocked") return { behavior: "deny", message: "Mandatory policy" };
    return null;
  });
  assert.equal(options.hooks.PreToolUse.length, 2);
  var hook = options.hooks.PreToolUse[1].hooks[0];
  assert.deepEqual(await hook({ tool_name: "Other", tool_input: {} }), { continue: true });
  var allowed = await hook({ tool_name: "Read", tool_input: { path: "a" }, tool_use_id: "t1" });
  assert.equal(allowed.hookSpecificOutput.permissionDecision, "allow");
  assert.deepEqual(allowed.hookSpecificOutput.updatedInput, { path: "a" });
  var denied = await hook({ tool_name: "Blocked", tool_input: {} });
  assert.equal(denied.hookSpecificOutput.permissionDecision, "deny");
  assert.equal(denied.hookSpecificOutput.permissionDecisionReason, "Mandatory policy");
  var signal = {};
  await hook({ tool_name: "Other", tool_input: {}, tool_use_id: "input-id" }, "argument-id", { signal: signal });
  assert.equal(seenOptions.toolUseID, "argument-id");
  assert.equal(seenOptions.signal, signal);
  assert.deepEqual(await hook(), { continue: true });
});

test("worker permission setter resolves only after its correlated acknowledgement", async function () {
  var sent;
  var fixture = workerFixture(function(message) { sent = message; return true; });
  var handle = kit.createWorkerQueryHandle(fixture.worker);
  var pending = handle.setPermissionMode("auto");
  assert.equal(sent.mode, "auto");
  fixture.receive({ type: "permission_mode_result", requestId: sent.requestId });
  await pending;
});

test("worker permission setter rejects correlated errors and failed sends", async function () {
  var sent;
  var fixture = workerFixture(function(message) { sent = message; return true; });
  var handle = kit.createWorkerQueryHandle(fixture.worker);
  var pending = handle.setPermissionMode("auto");
  fixture.receive({ type: "permission_mode_result", requestId: sent.requestId, error: "SDK refused" });
  await assert.rejects(pending, /SDK refused/);

  var failed = workerFixture(function() { return false; });
  await assert.rejects(kit.createWorkerQueryHandle(failed.worker).setPermissionMode("auto"), /unavailable/);

  var thrown = workerFixture(function() { throw new Error("IPC send failed"); });
  await assert.rejects(kit.createWorkerQueryHandle(thrown.worker).setPermissionMode("auto"), /IPC send failed/);
});

test("worker permission setter rejects query completion, worker exit, close, and timeout", async function () {
  var doneFixture = workerFixture();
  var doneHandle = kit.createWorkerQueryHandle(doneFixture.worker);
  var donePending = doneHandle.setPermissionMode("auto");
  doneFixture.receive({ type: "query_done" });
  await assert.rejects(donePending, /ended/);

  var exitFixture = workerFixture();
  var exitHandle = kit.createWorkerQueryHandle(exitFixture.worker);
  var exitPending = exitHandle.setPermissionMode("auto");
  exitFixture.receive({ type: "query_error", error: "Worker exited with code 1", exitCode: 1 });
  await assert.rejects(exitPending, /exited with code 1/);

  var closeFixture = workerFixture();
  var closeHandle = kit.createWorkerQueryHandle(closeFixture.worker);
  var closePending = closeHandle.setPermissionMode("auto");
  closeHandle.close();
  await assert.rejects(closePending, /closed/);

  var timeoutFixture = workerFixture();
  await assert.rejects(kit.createWorkerQueryHandle(timeoutFixture.worker).setPermissionMode("auto"), /Timed out/);
});

test("worker MCP policy setter has correlated success and errors", async function () {
  var sent;
  var fixture = workerFixture(function(message) { sent = message; return true; });
  var handle = kit.createWorkerQueryHandle(fixture.worker);
  var pending = handle.setMcpPermissionModeOverride("github", "auto");
  fixture.receive({ type: "mcp_permission_mode_result", requestId: sent.requestId, result: { applied: true } });
  assert.deepEqual(await pending, { applied: true });

  var errorPending = handle.setMcpPermissionModeOverride("github", "default");
  fixture.receive({ type: "mcp_permission_mode_result", requestId: sent.requestId, error: "not applicable" });
  await assert.rejects(errorPending, /not applicable/);
});

test("worker bridge converts synchronous PreToolUse policy errors into correlated denial", async function () {
  var sent = [];
  var fixture = workerFixture(function(message) { sent.push(message); return true; });
  kit.createWorkerQueryHandle(fixture.worker, null, null, null, null, null, null, function() {
    throw new Error("policy failed");
  });
  fixture.receive({ type: "pre_tool_policy_request", requestId: "policy-1", toolName: "Write", input: {} });
  await new Promise(function(resolve) { setImmediate(resolve); });
  assert.equal(sent[0].type, "pre_tool_policy_response");
  assert.equal(sent[0].requestId, "policy-1");
  assert.equal(sent[0].error, "policy failed");
});
