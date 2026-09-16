var test = require("node:test");
var assert = require("node:assert");
var fs = require("node:fs");
var path = require("node:path");

var claudeAdapter = require("../lib/yoke/adapters/claude");
var buildWorkerQueryOptions = claudeAdapter.contractTestKit.buildWorkerQueryOptions;
var normalizeEvent = claudeAdapter.contractTestKit.normalizeEvent;

// --- perTaskStopAffordance -------------------------------------------------
// Clay renders a per-task Stop control, so it must declare the affordance.
// The CLI fails CLOSED without it: an interrupt would also kill every running
// background task.

test("the OS-user worker path declares the per-task stop affordance", function () {
  var options = buildWorkerQueryOptions({}, {}, "/tmp/work");
  assert.strictEqual(options.perTaskStopAffordance, true);
});

test("the affordance is declared even for queries with no dialog support", function () {
  // supportedDialogKinds is conditional; the affordance must not be, or an
  // interrupt on those sessions would silently kill background tasks.
  var options = buildWorkerQueryOptions({}, {}, "/tmp/work");
  assert.strictEqual(options.supportedDialogKinds, undefined);
  assert.strictEqual(options.perTaskStopAffordance, true);
});

test("both query paths declare the affordance identically", function () {
  // First-attached-client wins on multi-client sessions, so the in-process and
  // worker paths disagreeing would make Stop's behavior depend on which one
  // connected first. Pin both against the source.
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "yoke", "adapters", "claude.js"),
    "utf8"
  );
  var assignments = source.match(/perTaskStopAffordance = PER_TASK_STOP_AFFORDANCE/g) || [];
  assert.strictEqual(assignments.length, 2, "in-process and worker paths both assign it");
  assert.ok(
    /var PER_TASK_STOP_AFFORDANCE = true;/.test(source),
    "both read the same constant so they cannot drift apart"
  );
});

test("the worker receives the affordance as a serializable value", function () {
  // buildWorkerQueryOptions output crosses process IPC as msg.options.
  var options = buildWorkerQueryOptions({}, {}, "/tmp/work");
  var roundTripped = JSON.parse(JSON.stringify(options));
  assert.strictEqual(roundTripped.perTaskStopAffordance, true);
});

// --- systemPrompt snapshot -------------------------------------------------

test("system prompt recording stays off unless the caller opts in", function () {
  var options = buildWorkerQueryOptions({ appendSystemPrompt: "Extra rules." }, {}, "/tmp/work");
  assert.deepStrictEqual(options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    append: "Extra rules.",
    snapshot: false,
  });
  assert.strictEqual(options.systemPrompt.snapshot, false);
});

test("opting in records a preset-plus-append prompt", function () {
  var options = buildWorkerQueryOptions(
    { appendSystemPrompt: "Extra rules.", systemPromptSnapshot: true },
    {},
    "/tmp/work"
  );
  assert.deepStrictEqual(options.systemPrompt, {
    type: "preset",
    preset: "claude_code",
    append: "Extra rules.",
    snapshot: true,
  });
});

test("Clay's live session prompt is never recorded", function () {
  // getSessionSystemPrompt (project.js) recomposes from sticky notes, pair
  // role, and the Capsule catalog, and three call sites force a mid-session
  // re-render. Recording it would pin the first render until compaction.
  var bridge = fs.readFileSync(path.join(__dirname, "..", "lib", "sdk-bridge.js"), "utf8");
  var start = bridge.indexOf("var queryOpts = {");
  assert.ok(start !== -1, "the main session query options must still be built here");
  var block = bridge.slice(start, start + 2000);
  assert.ok(block.indexOf("appendSystemPrompt:") !== -1, "the session prompt is an append");
  assert.ok(
    block.indexOf("systemPromptSnapshot") === -1,
    "the live session path must not opt into system-prompt recording"
  );
});

test("a bare string prompt is promoted to the custom form the SDK can record", function () {
  // The SDK cannot record a bare string; it needs { type: 'custom', ... }.
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "yoke", "adapters", "claude.js"),
    "utf8"
  );
  var start = source.indexOf("function applySystemPromptSnapshot");
  var end = source.indexOf("function getSharedSkillPlugins");
  assert.ok(start !== -1 && end > start, "applySystemPromptSnapshot must exist");
  var apply = new Function(
    source.slice(start, end) + "\nreturn applySystemPromptSnapshot;"
  )();

  assert.deepStrictEqual(
    apply("You are a title generator.", true),
    { type: "custom", prompt: "You are a title generator.", snapshot: true }
  );
  assert.deepStrictEqual(
    apply(["line one", "line two"], true),
    { type: "custom", prompt: ["line one", "line two"], snapshot: true }
  );
  assert.deepStrictEqual(
    apply({ type: "preset", preset: "claude_code", append: "x" }, true),
    { type: "preset", preset: "claude_code", append: "x", snapshot: true }
  );
  // Explicitly opt out of the SDK default for live prompts.
  assert.deepStrictEqual(apply("plain", false), { type: "custom", prompt: "plain", snapshot: false });
  assert.deepStrictEqual(apply("plain", undefined), { type: "custom", prompt: "plain", snapshot: false });
  assert.strictEqual(apply(null, true), null);
});

test("applying the snapshot flag does not mutate the caller's prompt object", function () {
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "yoke", "adapters", "claude.js"),
    "utf8"
  );
  var apply = new Function(
    source.slice(
      source.indexOf("function applySystemPromptSnapshot"),
      source.indexOf("function getSharedSkillPlugins")
    ) + "\nreturn applySystemPromptSnapshot;"
  )();
  var original = { type: "preset", preset: "claude_code", append: "x" };
  apply(original, true);
  assert.strictEqual(original.snapshot, undefined);
});

// --- usage pass-through ----------------------------------------------------

test("the adapter forwards modelUsage whole so new SDK fields survive", function () {
  var events = normalizeEvent({
    type: "result",
    subtype: "success",
    total_cost_usd: 0.5,
    duration_ms: 10,
    usage: { input_tokens: 5, output_tokens: 7 },
    modelUsage: { "claude-opus-5": { outputTokens: 420, thinkingTokens: 101, costBasis: "list" } },
  });
  var result = Array.isArray(events) ? events[0] : events;
  assert.strictEqual(result.modelUsage["claude-opus-5"].thinkingTokens, 101);
  assert.strictEqual(result.modelUsage["claude-opus-5"].costBasis, "list");
});

test("the usage panel sums thinking tokens across every model in the turn", function () {
  // A single turn's modelUsage can hold several models (verified live: a haiku
  // internal call alongside the opus main loop). Reading only the first entry
  // would report 0 thinking tokens while the main model spent 101.
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "public", "modules", "app-panels.js"),
    "utf8"
  );
  var start = source.indexOf("export function accumulateContext");
  var end = source.indexOf("// contextView:");
  assert.ok(start !== -1 && end > start, "accumulateContext must be present");
  var body = source.slice(start, end).replace("export function", "function");
  // Stub the module-level collaborators the extracted function touches.
  var accumulate = new Function(
    "store", "resolveContextWindow", "updateContextPanel", "contextData",
    body + "\nreturn accumulateContext;"
  );

  var contextData = {
    contextWindow: 0, currentInput: null, maxOutputTokens: 0, model: "-", cost: 0, input: 0,
    output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, thinking: null, costBasis: null,
  };
  var fn = accumulate(
    { get: function () { return null; } },
    function (m, w) { return w || 0; },
    function () {},
    contextData
  );

  fn(0.1, { output_tokens: 433 }, {
    "claude-haiku-4-5": { outputTokens: 13, thinkingTokens: 0, costBasis: "list" },
    "claude-opus-5": { outputTokens: 420, thinkingTokens: 101, costBasis: "list" },
  }, null);
  assert.strictEqual(contextData.thinking, 101, "thinking is summed across models");
  assert.strictEqual(contextData.costBasis, "list");

  // Models priced differently must not report whichever came first.
  fn(0.2, { output_tokens: 10 }, {
    "a": { outputTokens: 1, thinkingTokens: 2, costBasis: "list" },
    "b": { outputTokens: 1, thinkingTokens: 3, costBasis: "managed" },
  }, null);
  assert.strictEqual(contextData.thinking, 5);
  assert.strictEqual(contextData.costBasis, "mixed");

  // Older CLI builds omit both fields entirely: stay null so the rows hide
  // instead of claiming a confident zero.
  fn(0.3, { output_tokens: 10 }, { "old": { outputTokens: 9 } }, null);
  assert.strictEqual(contextData.thinking, null);
  assert.strictEqual(contextData.costBasis, null);
});

test("Codex context panel uses only valid snapshots, preserves zero, and clears restored invalid state", function () {
  var source = fs.readFileSync(
    path.join(__dirname, "..", "lib", "public", "modules", "app-panels.js"),
    "utf8"
  );
  var start = source.indexOf("export function accumulateContext");
  var end = source.indexOf("// contextView:");
  var body = source.slice(start, end).replace("export function", "function");
  var contextData = {
    contextWindow: 1000000, currentInput: null, maxOutputTokens: 0, model: "gpt-5.6", cost: 0, input: 0,
    output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, thinking: null, costBasis: null,
  };
  var panelStoreState = { currentVendor: "codex", richContextUsage: { totalTokens: 900, maxTokens: 1000 } };
  var panelStore = {
    get: function (key) { return panelStoreState[key]; },
    set: function (patch) { Object.assign(panelStoreState, patch); },
  };
  var fn = new Function(
    "store", "resolveContextWindow", "updateContextPanel", "contextData",
    body + "\nreturn accumulateContext;"
  )(
    panelStore,
    function (m, w) { return w || 0; },
    function () {},
    contextData
  );
  fn(0, { input_tokens: 739000, cache_read_input_tokens: 258000 }, {
    gpt: { contextWindow: 1000000, contextSnapshot: { valid: false } },
  }, null);
  assert.equal(panelStoreState.richContextUsage, null, "an invalid persisted snapshot clears stale rich context");
  assert.equal(contextData.input, 997000, "billing usage remains available to the usage panel");
  assert.equal(contextData.currentInput, null, "billing usage does not become Codex occupancy");
  fn(0, { input_tokens: 739000, cache_read_input_tokens: 258000 }, {
    gpt: { contextWindow: 1000000, contextSnapshot: {
      valid: true, inputTokens: 0, contextWindow: 1000000, turnId: "turn-1",
    } },
  }, null);
  assert.equal(contextData.currentInput, 0, "a valid zero snapshot remains visible");
  assert.equal(contextData.contextWindow, 1000000);
  fn(0, null, {
    gpt: { contextWindow: 1000000, contextSnapshot: { valid: false } },
  }, null);
  assert.equal(contextData.currentInput, null, "history replay clears an unavailable snapshot");
  assert.match(source, /rich\.input_tokens[\s\S]*rich\.contextWindow/);
  assert.match(source, /typeof contextData\.currentInput === "number"/);
  assert.match(source, /contextSnapshot/);
});

test("the usage panel markup has hidden rows for both optional fields", function () {
  var html = fs.readFileSync(path.join(__dirname, "..", "lib", "public", "index.html"), "utf8");
  assert.ok(/id="context-thinking-row"[^>]*class="[^"]*hidden/.test(html)
    || /class="usage-row hidden" id="context-thinking-row"/.test(html),
    "the thinking row starts hidden");
  assert.ok(/class="usage-row hidden" id="context-cost-basis-row"/.test(html),
    "the cost-basis row starts hidden");
  assert.ok(html.indexOf('id="context-thinking"') !== -1);
  assert.ok(html.indexOf('id="context-cost-basis"') !== -1);
});
