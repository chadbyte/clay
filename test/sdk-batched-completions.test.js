var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("path");
var pathToFileURL = require("url").pathToFileURL;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;
var normalizeClaudeEvent = require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent;
var taskLifecycle = require("../lib/sdk-task-lifecycle");

function fixture() {
  var recorded = [];
  var pushed = [];
  var notified = [];
  var completed = [];
  var sm = {
    sendAndRecord: function (session, obj) { recorded.push(obj); },
    sendToSession: function (session, obj) { recorded.push(obj); },
    broadcastSessionList: function () {},
    saveSessionFile: function () {},
  };
  var mp = attachMessageProcessor({
    sm: sm,
    send: function () {},
    onProcessingChanged: function () {},
    onTurnDone: function (session, preview) { completed.push(preview); },
    pushModule: { sendPush: function (msg) { pushed.push(msg); } },
    getNotificationsModule: function () {
      return { notify: function (type, msg) { notified.push({ type: type, msg: msg }); } };
    },
  });
  var session = {
    localId: 7,
    title: "SDK lifecycle",
    messageUUIDs: [], history: [], blocks: {}, sentToolResults: {},
    pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {},
    activeTaskToolIds: {}, taskIdMap: {}, turnCount: 0, responsePreview: "",
  };
  return {
    mp: mp, session: session, recorded: recorded, pushed: pushed,
    notified: notified, completed: completed,
  };
}

function rawBackgroundResult(queuedTurnCount) {
  var raw = {
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 0,
    result: "",
    total_cost_usd: 0,
    origin: { kind: "task-notification" },
  };
  if (queuedTurnCount !== undefined) raw.queued_turn_count = queuedTurnCount;
  return raw;
}

test("zero-turn background placeholders do not complete a turn with zero or absent user queue counts", function () {
  [0, undefined].forEach(function (queuedTurnCount) {
    var f = fixture();
    var pendingPermission = { resolve: function () {} };
    var pendingElicitation = { resolve: function () {} };
    f.session.isProcessing = true;
    f.session._awaitingTurnResult = true;
    f.session.pendingPermissions.req = pendingPermission;
    f.session.pendingElicitations.el = pendingElicitation;

    f.mp.processSDKMessage(f.session, normalizeClaudeEvent(rawBackgroundResult(queuedTurnCount)));

    assert.equal(f.session.isProcessing, true);
    assert.equal(f.session._awaitingTurnResult, true);
    assert.equal(f.session.pendingPermissions.req, pendingPermission);
    assert.equal(f.session.pendingElicitations.el, pendingElicitation);
    assert.equal(f.session.turnCount, 0);
    assert.equal(f.recorded.some(function (msg) { return msg.type === "done" || msg.type === "result"; }), false);
    assert.deepEqual(f.pushed, []);
    assert.deepEqual(f.notified, []);
    assert.deepEqual(f.completed, []);
  });
});

test("the actual response after background placeholders completes once and preserves its output", function () {
  var f = fixture();
  f.session.isProcessing = true;
  f.session._awaitingTurnResult = true;

  f.mp.processSDKMessage(f.session, normalizeClaudeEvent(rawBackgroundResult(0)));
  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "assistant",
    message: { content: [{ type: "text", text: "Background work finished." }] },
  }));
  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "result",
    subtype: "success",
    is_error: false,
    num_turns: 1,
    result: "Background work finished.",
    total_cost_usd: 0.02,
    origin: { kind: "task-notification" },
  }));

  assert.equal(f.session.isProcessing, false);
  assert.equal(f.session.turnCount, 1);
  assert.ok(f.recorded.some(function (msg) { return msg.type === "delta" && msg.text === "Background work finished."; }));
  assert.equal(f.recorded.filter(function (msg) { return msg.type === "done"; }).length, 1);
  assert.equal(f.pushed.length, 1);
  assert.equal(f.notified.length, 1);
  assert.deepEqual(f.completed, ["Background work finished."]);
});

test("legitimate zero-turn local commands and zero-turn errors remain terminal", function () {
  var local = fixture();
  local.session.isProcessing = true;
  local.session.pendingPermissions.req = { resolve: function () {} };
  local.session.pendingElicitations.el = { resolve: function () {} };
  local.mp.processSDKMessage(local.session, normalizeClaudeEvent({
    type: "result", subtype: "success", is_error: false, num_turns: 0,
    result: "", local_command: "status", origin: { kind: "human" }, total_cost_usd: 0,
  }));
  assert.equal(local.session.isProcessing, false);
  assert.deepEqual(local.session.pendingPermissions, {});
  assert.deepEqual(local.session.pendingElicitations, {});
  assert.equal(local.recorded.filter(function (msg) { return msg.type === "done"; }).length, 1);

  var failed = fixture();
  failed.session.isProcessing = true;
  failed.session.activeTaskToolIds["tool-1"] = true;
  failed.session.taskIdMap["tool-1"] = "task-1";
  failed.mp.processSDKMessage(failed.session, normalizeClaudeEvent({
    type: "result", subtype: "error_during_execution", is_error: true,
    num_turns: 0, errors: ["failed"], total_cost_usd: 0,
    origin: { kind: "task-notification" },
  }));
  assert.equal(failed.session.isProcessing, false);
  assert.deepEqual(failed.session.activeTaskToolIds, {});
  assert.deepEqual(failed.session.taskIdMap, {});
  assert.equal(failed.recorded.filter(function (msg) { return msg.type === "done"; }).length, 1);

  var unclassified = fixture();
  unclassified.session.isProcessing = true;
  unclassified.mp.processSDKMessage(unclassified.session, normalizeClaudeEvent({
    type: "result", subtype: "success", is_error: false, num_turns: 0,
    total_cost_usd: 0, origin: { kind: "task-notification" },
  }));
  assert.equal(unclassified.session.isProcessing, false,
    "a zero-turn result without the documented empty result field is not guessed to be intermediate");
});

test("task tracking survives continuation and clears on either terminal event without duplicate completion", function () {
  var f = fixture();
  f.session.isProcessing = true;
  f.session.activeTaskToolIds["tool-1"] = true;
  f.session.taskIdMap["tool-1"] = "task-1";

  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "result", subtype: "success", is_error: false, num_turns: 1,
    result: "Started in background.", total_cost_usd: 0.01,
  }));
  assert.equal(f.session.activeTaskToolIds["tool-1"], true);
  assert.equal(f.session.taskIdMap["tool-1"], "task-1");

  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "system", subtype: "task_notification", task_id: "task-1",
    tool_use_id: "tool-1", status: "completed", summary: "done",
  }));
  assert.deepEqual(f.session.activeTaskToolIds, {});
  assert.deepEqual(f.session.taskIdMap, {});
  assert.equal(f.recorded.filter(function (msg) { return msg.type === "subagent_done"; }).length, 1);

  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "system", subtype: "task_notification", task_id: "task-1",
    tool_use_id: "tool-1", status: "completed", summary: "duplicate",
  }));
  assert.equal(f.recorded.filter(function (msg) { return msg.type === "subagent_done"; }).length, 1);
});

test("a terminal tool result clears both task indexes before a later notification", function () {
  var f = fixture();
  f.session.activeTaskToolIds["tool-1"] = true;
  f.session.taskIdMap["tool-1"] = "task-1";

  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "done" }] },
    tool_use_result: { status: "completed" },
  }));
  assert.deepEqual(f.session.activeTaskToolIds, {});
  assert.deepEqual(f.session.taskIdMap, {});
  assert.equal(f.recorded.filter(function (msg) { return msg.type === "subagent_done"; }).length, 1);

  f.mp.processSDKMessage(f.session, normalizeClaudeEvent({
    type: "system", subtype: "task_notification", task_id: "task-1",
    tool_use_id: "tool-1", status: "completed", summary: "duplicate",
  }));
  assert.equal(f.recorded.filter(function (msg) { return msg.type === "subagent_done"; }).length, 1);
});

test("stop and query replacement cleanup removes both task indexes", function () {
  var session = {
    activeTaskToolIds: { "tool-1": true },
    taskIdMap: { "tool-1": "task-1" },
  };
  taskLifecycle.clearAll(session);
  assert.deepEqual(session.activeTaskToolIds, {});
  assert.deepEqual(session.taskIdMap, {});
});

test("Stop cleanup preserves SDK-reported background tasks and removes foreground tasks", function () {
  var session = {
    activeTaskToolIds: { "background-tool": true, "foreground-tool": true },
    taskIdMap: { "background-tool": "background-task", "foreground-tool": "foreground-task" },
    activeBackgroundTasks: [{ task_id: "background-task" }],
  };
  taskLifecycle.clearForeground(session);
  assert.deepEqual(session.activeTaskToolIds, { "background-tool": true });
  assert.deepEqual(session.taskIdMap, { "background-tool": "background-task" });
});

test("detached tool output stays running through adapter, processor and client lifecycle until real output", async function () {
  var lifecycleUrl = pathToFileURL(path.join(__dirname, "../lib/public/modules/tool-result-lifecycle.js")).href;
  var clientLifecycle = await import(lifecycleUrl);
  var f = fixture();
  var updates = [];

  var detached = normalizeClaudeEvent({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "web-1", content: "" }] },
    tool_use_result: { detachedToolCall: true },
  });
  f.mp.processSDKMessage(f.session, detached);
  var interim = f.recorded.filter(function (msg) { return msg.type === "tool_result"; })[0];
  if (!clientLifecycle.isInterimToolResult(interim)) updates.push(interim.content || "(no output)");

  var completed = normalizeClaudeEvent({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "web-1", content: "actual web output" }] },
    tool_use_result: { code: 200 },
  });
  f.mp.processSDKMessage(f.session, completed);
  var finalResult = f.recorded.filter(function (msg) { return msg.type === "tool_result"; })[1];
  if (!clientLifecycle.isInterimToolResult(finalResult)) updates.push(finalResult.content || "(no output)");

  assert.deepEqual(updates, ["actual web output"]);
  assert.equal(f.session.sentToolResults["web-1"], true);
});

test("detached marker is correlated only to the single matching raw tool result", function () {
  var f = fixture();
  var ambiguous = normalizeClaudeEvent({
    type: "user",
    message: { content: [
      { type: "tool_result", tool_use_id: "web-1", content: "one" },
      { type: "tool_result", tool_use_id: "web-2", content: "two" },
    ] },
    tool_use_result: { detachedToolCall: true },
  });
  f.mp.processSDKMessage(f.session, ambiguous);
  var results = f.recorded.filter(function (msg) { return msg.type === "tool_result"; });
  assert.equal(results.length, 2);
  assert.equal(results.some(function (msg) { return msg.detached === true; }), false);
});
