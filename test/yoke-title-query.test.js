var test = require("node:test");
var assert = require("node:assert/strict");
var titleQuery = require("../lib/yoke/title-query");
var codex = require("../lib/yoke/adapters/codex");
var claude = require("../lib/yoke/adapters/claude");

function fixture(events, adapter) {
  var closed = 0;
  var options;
  adapter = adapter || {};
  adapter.createQuery = async function (opts) {
    options = opts;
    return {
      pushMessage: function () {},
      close: function () { closed++; },
      [Symbol.asyncIterator]: async function* () { for (var event of events) yield event; },
    };
  };
  return { adapter: adapter, closed: function () { return closed; }, options: function () { return options; } };
}

var success = [{ yokeType: "text_delta", text: "Session title recovery" }, { yokeType: "result" }];

test("Codex title uses offered model and an ephemeral restricted query", async function () {
  var f = fixture(success, codex.createCodexAdapter({ cwd: process.cwd() }));
  assert.equal(await f.adapter.generateTitle(["Fix session titles"], {}), "Session title recovery");
  assert.ok((await f.adapter.supportedModels()).includes(f.options().model));
  assert.equal(f.options().model, "gpt-5.6-luna");
  assert.equal(f.options().ephemeral, true);
  assert.equal(f.options().effort, "low");
  assert.equal(f.options().adapterOptions.CODEX.sandboxMode, "read-only");
  assert.equal((await f.options().canUseTool()).behavior, "deny");
  assert.equal(f.closed(), 1);
});

test("Codex title falls back to a supported session model when preferred model is absent", async function () {
  var f = fixture(success, codex.createCodexAdapter({}));
  f.adapter.supportedModels = async function () { return ["other-model", "session-model"]; };
  await f.adapter.generateTitle(["Fix titles"], { model: "session-model" });
  assert.equal(f.options().model, "session-model");
});

test("Claude title retains OS identity and does not bypass permissions", async function () {
  var f = fixture(success, claude.createClaudeAdapter({ cwd: process.cwd() }));
  await f.adapter.generateTitle(["Fix titles"], { linuxUser: "alice" });
  assert.equal(f.options().adapterOptions.CLAUDE.linuxUser, "alice");
  assert.equal(f.options().adapterOptions.CLAUDE.permissionMode, "default");
  assert.equal(f.options().persistSession, false);
  assert.equal(f.closed(), 1);
});

var failures = [
  { yokeType: "error", text: "Unsupported model" },
  { yokeType: "auth_required" },
  { yokeType: "interrupted" },
  { yokeType: "result", subtype: "error_during_execution", errors: ["OAuth expired"] },
  { yokeType: "result", is_error: true },
  { yokeType: "result", status: "failed", error: { message: "Model unavailable" } },
];
failures.forEach(function (failure) {
  test("rejects partial title followed by " + JSON.stringify(failure), async function () {
    var f = fixture([success[0], failure]);
    await assert.rejects(titleQuery.generateTitle(f.adapter, ["Title"], {}, {}));
    assert.equal(f.closed(), 1);
  });
});

test("rejects error text even when provider reports success, and requires terminal success", async function () {
  var f = fixture([{ yokeType: "message", messageRole: "assistant", content: [{ type: "text", text: "Failed to authenticate: OAuth session expired and could not be refreshed" }] }, success[1]]);
  await assert.rejects(titleQuery.generateTitle(f.adapter, ["Title"], {}, {}), /no valid title/);
  f = fixture([success[0]]);
  await assert.rejects(titleQuery.generateTitle(f.adapter, ["Title"], {}, {}), /without a successful result/);
});

test("normalizers retain failed-result signals consumed by title collector", async function () {
  var c = claude.contractTestKit.normalizeEvent({ type: "result", is_error: true, subtype: "success" });
  assert.equal(c.is_error, true);
  var state = codex.contractTestKit.createEventState("model");
  var events = codex.contractTestKit.normalizeEvent({ method: "turn/completed", params: { turn: { status: "failed", error: { message: "unsupported model" } } } }, state);
  assert.equal(events.find(function (event) { return event.yokeType === "result"; }).status, "failed");
  var f = fixture([success[0]].concat(events));
  await assert.rejects(titleQuery.generateTitle(f.adapter, ["Title"], {}, {}));
});

test("abort during startup releases caller and closes a late handle without starting it", async function () {
  var resolveStart;
  var controller = new AbortController();
  var closed = 0;
  var pushed = 0;
  var adapter = { createQuery: function () { return new Promise(function (resolve) { resolveStart = resolve; }); } };
  var pending = titleQuery.generateTitle(adapter, ["Title"], { signal: controller.signal }, {});
  await Promise.resolve();
  controller.abort();
  await assert.rejects(pending, /aborted/);
  resolveStart({ close: function () { closed++; }, pushMessage: function () { pushed++; } });
  await Promise.resolve();
  assert.equal(closed, 1);
  assert.equal(pushed, 0);
});

test("abort releases an unresponsive stream and closes it", async function () {
  var controller = new AbortController();
  var closed = 0;
  var started;
  var ready = new Promise(function (resolve) { started = resolve; });
  var adapter = { createQuery: async function () { return {
    pushMessage: function () { started(); }, close: function () { closed++; },
    [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; },
  }; } };
  var pending = titleQuery.generateTitle(adapter, ["Title"], { signal: controller.signal }, {});
  await ready;
  controller.abort();
  await assert.rejects(pending, /aborted/);
  assert.equal(closed, 1);
});

test("unrelated optional runtime failures do not discard a successful title", async function () {
  var f = fixture([{ yokeType: "runtime_specific", error: "Optional MCP startup failed" }].concat(success));
  assert.equal(await titleQuery.generateTitle(f.adapter, ["Title"], {}, {}), "Session title recovery");
});

test("non-streamed assistant text is accepted only with successful completion", async function () {
  var f = fixture([{ yokeType: "message", messageRole: "assistant", content: [{ type: "text", text: '"Session title recovery"' }] }, success[1]]);
  assert.equal(await titleQuery.generateTitle(f.adapter, ["Title"], {}, {}), "Session title recovery");
});

test("legitimate titles about errors are not mistaken for provider failures", async function () {
  var f = fixture([{ yokeType: "text_delta", text: "Error handling in session titles" }, success[1]]);
  assert.equal(await titleQuery.generateTitle(f.adapter, ["Title"], {}, {}), "Error handling in session titles");
});

test("real adapter collector and coordinator retry a failed turn without saving its partial title", async function () {
  var events = [success[0], { yokeType: "result", status: "failed", error: { message: "Model unavailable" } }];
  var f = fixture(events, codex.createCodexAdapter({}));
  var session = { localId: 1, title: "Provisional label", titleProvisional: true,
    history: [{ type: "user_message", text: "Fix session titles" }] };
  var saved = 0;
  var generator = require("../lib/session-title-generator").attachSessionTitleGenerator({
    sm: { sessions: new Map([[1, session]]), saveSessionFile: function () { saved++; }, broadcastSessionList: function () {} },
    getAdapter: function () { return f.adapter; },
  });
  assert.equal(await generator.generate(session), false);
  assert.equal(session.title, "Provisional label");
  assert.notEqual(session.titleAutoGenerated, true);
  assert.equal(saved, 0);
  events.splice(0, events.length, success[0], success[1]);
  assert.equal(await generator.generate(session), true);
  assert.equal(session.title, "Session title recovery");
  assert.equal(saved, 1);
});

test("standalone title queries time out even without a coordinator signal", async function (t) {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  var closed = 0;
  var started;
  var ready = new Promise(function (resolve) { started = resolve; });
  var adapter = { createQuery: async function () { return {
    pushMessage: function () { started(); }, close: function () { closed++; },
    [Symbol.asyncIterator]: function () { return { next: function () { return new Promise(function () {}); } }; },
  }; } };
  var pending = titleQuery.generateTitle(adapter, ["Title"], {}, {});
  await ready;
  t.mock.timers.tick(30000);
  await assert.rejects(pending, /timed out/);
  assert.equal(closed, 1);
});

test("Codex titles normalize runtime catalog records and honor supported effort", async function () {
  var f = fixture(success, codex.createCodexAdapter({}));
  f.adapter.supportedModels = async function () {
    return [{value: 'other'}, {value: 'gpt-5.6-luna', supportedEffortLevels: ['medium', 'high']}];
  };
  await f.adapter.generateTitle(['Fix titles'], {});
  assert.equal(f.options().model, 'gpt-5.6-luna');
  assert.equal(f.options().effort, 'medium');
  f.adapter.supportedModels = async function () { return [null, {}, {value:'session-model', supportedEffortLevels: []}, 'other']; };
  await f.adapter.generateTitle(['Fix titles'], {model:'session-model'});
  assert.equal(f.options().model, 'session-model');
  assert.equal(f.options().effort, undefined);
  await f.adapter.generateTitle(['Fix titles'], {model:'unavailable'});
  assert.equal(f.options().model, 'session-model');
  f.adapter.supportedModels = async function () { return [null, {}, {value: 42}]; };
  await assert.rejects(f.adapter.generateTitle(['Fix titles'], {}), /No supported Codex title model/);
});

["success", "error", "timeout"].forEach(function(outcome) {
  ["pending", "reject", "throw"].forEach(function(cleanup) {
    test(outcome + " title settles within its deadline with " + cleanup + " cleanup", { timeout: 1000 }, async function() {
      var closed = 0;
      var adapter = { createQuery: async function() { return {
        pushMessage: function() {},
        close: function() {
          closed++;
          if (cleanup === "throw") throw new Error("Cleanup failed");
          if (cleanup === "reject") return Promise.reject(new Error("Cleanup failed"));
          return new Promise(function() {});
        },
        [Symbol.asyncIterator]: async function*() {
          yield { yokeType: "text_delta", text: "Partial or complete title" };
          if (outcome === "timeout") await new Promise(function() {});
          else yield outcome === "success" ? { yokeType: "result" } : { yokeType: "error", text: "Provider failed" };
        },
      }; } };
      var began = Date.now();
      await assert.rejects(titleQuery.generateTitle(adapter, ["Title"], { timeoutMs: 20 }, {}),
        outcome === "error" ? /Provider failed/ : cleanup === "pending" || outcome === "timeout" ? /timed out/ : /Cleanup failed/);
      assert.ok(Date.now() - began < 300, "the title caller must not wait for unbounded teardown");
      assert.equal(closed, 1);
      await new Promise(function(resolve) { setImmediate(resolve); });
    });
  });
});

test("successful title awaits cleanup that finishes within the overall budget", async function() {
  var finished = false;
  var f = fixture(success);
  var createQuery = f.adapter.createQuery;
  f.adapter.createQuery = async function(opts) {
    var handle = await createQuery(opts);
    handle.close = function() { return new Promise(function(resolve) { setTimeout(function() { finished = true; resolve(); }, 10); }); };
    return handle;
  };
  assert.equal(await titleQuery.generateTitle(f.adapter, ["Title"], { timeoutMs: 100 }, {}), "Session title recovery");
  assert.equal(finished, true);
});

test("late handle close rejection after timeout is observed without starting input", async function() {
  var resolveStart, rejectClose, closed = 0, pushed = 0;
  var adapter = { createQuery: function() { return new Promise(function(resolve) { resolveStart = resolve; }); } };
  await assert.rejects(titleQuery.generateTitle(adapter, ["Title"], { timeoutMs: 10 }, {}), /timed out/);
  resolveStart({ pushMessage: function() { pushed++; }, close: function() { closed++; return new Promise(function(resolve, reject) { rejectClose = reject; }); } });
  await Promise.resolve();
  assert.equal(closed, 1); assert.equal(pushed, 0);
  rejectClose(new Error("Late cleanup failed"));
  await new Promise(function(resolve) { setImmediate(resolve); });
});

test("close rejection arriving after deadline is observed", async function() {
  var rejectClose;
  var f = fixture(success);
  var createQuery = f.adapter.createQuery;
  f.adapter.createQuery = async function(opts) {
    var handle = await createQuery(opts);
    handle.close = function() { return new Promise(function(resolve, reject) { rejectClose = reject; }); };
    return handle;
  };
  await assert.rejects(titleQuery.generateTitle(f.adapter, ["Title"], { timeoutMs: 10 }, {}), /timed out/);
  rejectClose(new Error("Delayed teardown rejection"));
  await new Promise(function(resolve) { setImmediate(resolve); });
});
