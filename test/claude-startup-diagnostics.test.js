var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var normalizeEvent = require("../lib/yoke/adapters/claude").contractTestKit.normalizeEvent;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;

// Coverage for SDK diagnostics explicitly in scope: startup_failure_reason
// (0.3.280), plugin_errors (0.3.283), and the tool_use_result markers
// detachedToolCall / structuredContentOmitted, verified against the real
// installed SDK's own type definitions (node_modules/@anthropic-ai/
// claude-agent-sdk/sdk.d.ts), not guessed from the changelog prose alone.

function fixture() {
  var recorded = [];
  var sm = { sendAndRecord: function (session, obj) { recorded.push(obj); }, sendToSession: function () {}, broadcastSessionList: function () {} };
  var mp = attachMessageProcessor({
    sm: sm, send: function () {}, onProcessingChanged: function () {},
    discoverSkillDirs: function () { return []; },
    mergeSkills: function (a) { return new Set(a || []); },
    getSessionSkillOptions: function () { return {}; },
  });
  var session = {
    messageUUIDs: [], history: [], blocks: {}, sentToolResults: {},
    pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {},
    activeTaskToolIds: {}, taskIdMap: {}, turnCount: 0, responsePreview: "",
    skillNames: [], isProcessing: true,
  };
  return { mp: mp, session: session, recorded: recorded };
}

test("normalizeEvent forwards plugin_errors from a system/init message", function () {
  var events = normalizeEvent({ type: "system", subtype: "init", plugin_errors: [{ path: "/bad/plugin" }] });
  var event = Array.isArray(events) ? events[0] : events;
  assert.deepEqual(event.pluginErrors, [{ path: "/bad/plugin" }]);
});

test("a failed plugin directory is surfaced as a warning notice, not silently dropped", function () {
  var f = fixture();
  f.mp.processSDKMessage(f.session, {
    yokeType: "init", pluginErrors: [{ path: "/repo/.claude/plugins/broken" }], skills: [],
  });
  var notice = f.recorded.find(function (m) { return m.type === "informational"; });
  assert.ok(notice, "a plugin load failure must reach the existing informational notice pathway");
  assert.equal(notice.level, "warning");
  assert.match(notice.content, /\/repo\/\.claude\/plugins\/broken/);
});

test("normalizeEvent forwards startup_failure_reason from an error result", function () {
  var events = normalizeEvent({ type: "result", is_error: true, startup_failure_reason: "provider_not_allowed" });
  var event = Array.isArray(events) ? events[0] : events;
  assert.equal(event.startupFailureReason, "provider_not_allowed");
});

test("a named startup failure reaches the user through the existing error/done pathway", function () {
  var f = fixture();
  f.mp.processSDKMessage(f.session, { yokeType: "result", is_error: true, startupFailureReason: "provider_not_allowed" });
  var errorMsg = f.recorded.find(function (m) { return m.type === "error"; });
  assert.ok(errorMsg, "a startup failure must produce a visible error, not a silent stall");
  assert.match(errorMsg.text, /provider_not_allowed/);
  assert.ok(f.recorded.some(function (m) { return m.type === "done"; }), "the turn must still end, not hang forever");
  assert.equal(f.session.isProcessing, false);
});

test("a detached tool call's placeholder is never treated as that tool's final, permanent result", function () {
  var f = fixture();
  f.session.activeTaskToolIds = { "tool-1": true };

  // The placeholder arrives first, exactly as sdk.d.ts describes: "in place
  // of its Output: the call is still running, and its result reaches the
  // model in a later turn" under the same tool_use_id.
  f.mp.processSDKMessage(f.session, normalizeEvent({
    type: "user",
    tool_use_result: { detachedToolCall: true },
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "" }] },
  }));
  var placeholder = f.recorded.find(function (m) { return m.type === "tool_result"; });
  assert.ok(placeholder, "the placeholder is still shown, not swallowed");
  assert.equal(placeholder.detached, true, "the client must be told this is not the final answer yet");
  assert.equal(f.session.sentToolResults["tool-1"], undefined,
    "marking it sent would make the dedup guard below silently drop the real result");
  assert.equal(f.session.activeTaskToolIds["tool-1"], true, "not cleared: the call has not actually finished");

  // The real result for the SAME tool_use_id arrives in a later turn.
  f.recorded.length = 0;
  f.mp.processSDKMessage(f.session, normalizeEvent({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "the real answer" }] },
  }));
  var real = f.recorded.find(function (m) { return m.type === "tool_result"; });
  assert.ok(real, "the deferred real result must still reach the client");
  assert.equal(real.content, "the real answer");
  assert.equal(real.detached, undefined);
});

test("structuredContentOmitted is confirmed not applicable: Clay never reads structured tool output", function () {
  // Per the installed SDK's own type definitions, tool_use_result / its
  // structuredContent are "the tool's full Output object, not the string
  // content sent to the model" -- a separate, unknown-typed field Clay's
  // rendering path does not consume. Confirms that by construction, not
  // by claim: the tool_result handling reads only block.content/.text.
  var source = fs.readFileSync("lib/sdk-message-processor.js", "utf8");
  var block = source.slice(source.indexOf('if (block.type === "tool_result"'));
  block = block.slice(0, block.indexOf("sendAndRecord(session, toolResultMsg)"));
  assert.equal(/structuredContent/.test(block), false,
    "no code path reads structuredContent, so its omission cannot be misrepresented as empty output here");
  assert.match(block, /block\.content/, "only the model-facing text content is read");
});
