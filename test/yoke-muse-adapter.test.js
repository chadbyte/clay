var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var muse = require("../lib/yoke/adapters/muse");

async function fixture(t, mode, overrides) {
  var sdk = await import("@muse-code/sdk");
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-muse-test-"));
  var logFile = path.join(directory, "wire.jsonl");
  var sdkOptions = Object.assign({}, sdk, {
    spawnMspConnection: function(options) {
      return sdk.spawnMspConnection(Object.assign({}, options, {
        command: process.execPath, args: [path.join(__dirname, "fixtures", "muse-msp-host.cjs")],
        env: Object.assign({}, options.env, { MUSE_FIXTURE_MODE: mode, MUSE_FIXTURE_LOG: logFile }),
      }));
    },
  });
  var adapter = muse.createMuseAdapter(Object.assign({ cwd: process.cwd(), _binaryPath: path.join(__dirname, "fixtures", "muse-msp-host.cjs"), _sdk: sdkOptions, _shutdownTimeoutMs: 40 }, overrides || {}));
  t.after(async function() {
    await adapter.shutdown();
    var rows = wire();
    rows.filter(function(row) { return row.pid; }).forEach(function(born) {
      assert.throws(function() { process.kill(born.pid, 0); }, /ESRCH/);
    });
    fs.rmSync(directory, { recursive: true, force: true });
  });
  function wire() { return fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8").split("\n").slice(0, -1).map(function(line) { return JSON.parse(line); }) : []; }
  return { adapter: adapter, wire: wire, sdk: sdk, directory: directory };
}
async function collect(handle) { var events = []; for await (var event of handle) events.push(event); return events; }
async function until(predicate) {
  var deadline = Date.now() + 2000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("Fixture condition timed out");
    await new Promise(function(resolve) { setTimeout(resolve, 10); });
  }
}
function sent(f, method) { return f.wire().filter(function(row) { return row.method === method; }); }
function mcp() {
  return { MUSE: { mcpServers: [{ name: "clay-tools", command: process.execPath,
    args: ["bridge.js", "--session", "local-1", "--query-generation", "4", "--session-only"],
    env: [{ name: "CLAY_AUTH_TOKEN", value: "fixture-auth" }, { name: "CLAY_BRIDGE_TOKEN", value: "fixture-bridge" }],
  }] } };
}

test("actual SDK handshake, catalog, early text, deltas, terminal and unique tool result", { timeout: 5000 }, async function(t) {
  var f = await fixture(t, "complete");
  var ready = await f.adapter.init();
  assert.equal(ready.capabilities.queryBoundTools.mode, "stdio-mcp");
  var handle = await f.adapter.createQuery({ model: "wonder-1", effort: "high", adapterOptions: mcp() });
  handle.pushMessage("hello"); handle.endInput();
  var events = await collect(handle);
  assert.deepEqual(events.filter(function(event) { return event.yokeType === "text_delta"; }).map(function(event) { return event.text; }), ["early ", "hel", "lo"]);
  assert.equal(events.filter(function(event) { return event.yokeType === "tool_result"; }).length, 1);
  assert.equal(events.at(-1).yokeType, "result");
  assert.deepEqual(events.at(-1).usage, { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 2, cache_creation_input_tokens: 0 });
  assert.equal(events.filter(function(event) { return event.yokeType === "block_stop"; }).length, 2);
  assert.equal(sent(f, "initialize")[0].params.capabilities.userInputDialogs, false);
  assert.equal(sent(f, "model/list").length, 1);
  var start = sent(f, "session/start")[0].params;
  assert.equal(start.modelId, "wonder-1"); assert.equal(start.providerId, "meta");
  assert.equal(start.approvalMode, "onRequest");
  assert.deepEqual(start.config.mcpServers["clay-tools"].env, { CLAY_AUTH_TOKEN: "fixture-auth", CLAY_BRIDGE_TOKEN: "fixture-bridge" });
  assert.equal(sent(f, "turn/start")[0].params.reasoningEffort, "high");
  await handle.close(); assert.equal(f.adapter.clients.size, 0);
});

test("real catalog formats preserve effort and provider routing", async function(t) {
  var f = await fixture(t, "complete");
  var rows = await f.adapter.supportedModels();
  assert.deepEqual(rows[0].supportedEffortLevels, ["low", "high"]);
  assert.equal(rows[0].providerId, "meta"); assert.equal(rows[0].defaultReasoningEffort, "low");
  assert.equal(f.adapter.clients.size, 0);
});

test("unavailable selected model rejects before session or turn admission", async function(t) {
  var f = await fixture(t, "empty-models");
  var handle = await f.adapter.createQuery({ model: "requested" });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.match(events.at(-1).text, /requested/);
  assert.equal(sent(f, "session/start").length, 0); assert.equal(sent(f, "turn/start").length, 0);
});

test("MCP capability refusal is explicit and precedes admission", async function(t) {
  var f = await fixture(t, "no-mcp");
  var handle = await f.adapter.createQuery({ adapterOptions: mcp() });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.match(events.at(-1).text, /sessionMcp/); assert.equal(sent(f, "session/start").length, 0);
});

["handshake-hang", "open-hang"].forEach(function(mode) {
  test("Stop owns and closes a never-resolving " + mode, { timeout: 5000 }, async function(t) {
    var f = await fixture(t, mode); var handle = await f.adapter.createQuery({});
    handle.pushMessage("run");
    await until(function() { return sent(f, mode === "handshake-hang" ? "initialize" : "session/start").length; });
    handle.pushMessage("queued");
    var began = Date.now(); await handle.abort();
    assert.ok(Date.now() - began < 3000);
    assert.deepEqual(await collect(handle), [{ yokeType: "interrupted" }]);
    assert.equal(handle.pushMessage("late"), false); assert.equal(f.adapter.clients.size, 0);
    assert.equal(sent(f, "turn/start").length, 0);
  });
});

test("shutdown closes model listing while initialize or discovery is pending", { timeout: 7000 }, async function(t) {
  for (var i = 0; i < 2; i++) {
    var mode = i ? "model-hang" : "handshake-hang";
    var f = await fixture(t, mode); var pending = f.adapter.supportedModels();
    var rejected = assert.rejects(pending, /cancelled|closed|EOF/);
    await until(function() { return sent(f, i ? "model/list" : "initialize").length; });
    await f.adapter.shutdown(); await rejected; assert.equal(f.adapter.clients.size, 0);
  }
});

["crash", "protocol", "bad-handshake", "failed", "auth"].forEach(function(mode) {
  test("real SDK reports " + mode + " without success or hanging", { timeout: 5000 }, async function(t) {
    var f = await fixture(t, mode); var handle = await f.adapter.createQuery({});
    handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
    assert.equal(events.filter(function(event) { return event.yokeType === "result"; }).length, 0);
    assert.equal(events.at(-1).yokeType, mode === "auth" ? "auth_required" : "error");
    await handle.close(); assert.equal(f.adapter.clients.size, 0);
  });
});

test("approval callback controls actual wire decision with exact requirement and once scope", async function(t) {
  var f = await fixture(t, "approval"); var called = 0;
  var handle = await f.adapter.createQuery({ canUseTool: function(name, input, options) {
    called++; assert.equal(name, "Bash"); assert.deepEqual(input, { command: "pwd" }); assert.equal(options.signal.aborted, false);
    return Promise.resolve({ behavior: "allow" });
  } });
  await handle.setToolPolicy("allow-all"); handle.pushMessage("run"); handle.endInput();
  var events = await collect(handle); assert.equal(events.at(-1).yokeType, "result");
  assert.equal(called, 1);
  var decision = sent(f, "approval/decide")[0].params;
  assert.equal(decision.choiceId, "allow-once"); assert.deepEqual(decision.requirementId, { approvalId: "approval-1", sourceIndex: 0 });
  assert.equal(sent(f, "session/start")[0].params.approvalMode, "onRequest");
});

test("Stop cancels callback signal, clears queued output and rejects late approval", async function(t) {
  var f = await fixture(t, "pending-approval"); var callbackSignal; var allow;
  var handle = await f.adapter.createQuery({ canUseTool: function(name, input, options) {
    callbackSignal = options.signal; return new Promise(function(resolve) { allow = resolve; });
  } });
  handle.pushMessage("run"); handle.pushMessage("queued");
  await until(function() { return !!allow; }); await handle.abort();
  allow({ behavior: "allow" }); await new Promise(function(resolve) { setTimeout(resolve, 20); });
  assert.equal(callbackSignal.aborted, true);
  assert.deepEqual(await collect(handle), [{ yokeType: "interrupted" }]);
  assert.equal(sent(f, "approval/decide").length, 0);
  assert.equal(sent(f, "turn/start").length, 1); assert.equal(sent(f, "turn/cancel").length, 1);
});

test("rejected callback terminates and reports SDK onApprovalError", async function(t) {
  var f = await fixture(t, "approval"); var handle = await f.adapter.createQuery({ canUseTool: function() { return Promise.reject(new Error("policy failed")); } });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.at(-1).yokeType, "error"); assert.match(events.at(-1).text, /policy failed/);
  assert.equal(sent(f, "approval/decide").length, 0); await handle.close();
});

["resume-approval", "resume-inline-approval"].forEach(function(mode) {
test(mode + ": early pending approval, model selection and scoped MCP survive", async function(t) {
  var f = await fixture(t, mode); var called = 0;
  var handle = await f.adapter.createQuery({ resumeSessionId: "fixture-session", model: "wonder-1", adapterOptions: mcp(), canUseTool: function() { called++; return Promise.resolve({ behavior: "deny" }); } });
  handle.pushMessage("next"); handle.endInput(); var events = await collect(handle);
  assert.equal(called, 1);
  assert.equal(sent(f, "approval/decide")[0].params.choiceId, "deny-once");
  assert.deepEqual(sent(f, "session/resume")[0].params.config.mcpServers["clay-tools"].args, mcp().MUSE.mcpServers[0].args);
  assert.equal(sent(f, "session/setModel")[0].params.model.modelId, "wonder-1");
  assert.equal(events.filter(function(event) { return event.yokeType === "result"; }).length, 1);
  assert.equal(events.filter(function(event) { return event.yokeType === "text_delta"; }).map(function(event) { return event.text; }).join(""), "before afterearly hello");
});
});

test("title generation explicitly denies tools on the actual wire", async function(t) {
  var f = await fixture(t, "approval");
  assert.equal(await f.adapter.generateTitle(["conversation"]), "early hello");
  assert.equal(sent(f, "approval/decide")[0].params.choiceId, "deny-once");
  assert.equal(f.adapter.clients.size, 0);
});

test("approval never invents choices or selects persistent permission", async function() {
  var request = { availableChoices: [{ choiceId: "wide", decision: "approved", scope: "session" }] };
  await assert.rejects(muse.chooseApprovalDecision(request, function() { return { behavior: "allow" }; }, new AbortController().signal), /safe choice/);
  await assert.rejects(muse.chooseApprovalDecision(request, null), /safely/);
});

test("production sdk-bridge forwards exact session, generation and auth MCP config on start and resume", { timeout: 10000 }, async function(t) {
  var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
  for (var i = 0; i < 2; i++) {
    var f = await fixture(t, "internal-chatter");
    var recorded = [];
    var session = { messageUUIDs: [], history: [], localId: "local-bridge-" + i, vendor: "muse", model: "wonder-1", effort: "high", singleTurn: true,
      cliSessionId: i ? "fixture-session" : null, isProcessing: true, pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {},
    };
    var bridge = createSDKBridge({ cwd: process.cwd(), slug: "muse-fixture", adapter: f.adapter, adapters: { muse: f.adapter },
      clayPort: 32123, clayTls: true, clayAuthToken: "fixture-auth", clayBridgeToken: "fixture-bridge",
      sessionManager: { sessions: new Map([[session.localId, session]]), availableModels: [],
        saveSessionFile: function() {}, broadcastSessionList: function() {}, sendToSession: function() {},
        sendAndRecord: function(target, message) { recorded.push(message); },
      }, send: function() {},
    });
    var accepted = await bridge.startQueryWithAcceptance(session, "run", null, null);
    assert.equal(accepted.accepted, true);
    await until(function() { return recorded.some(function(event) { return event.type === "done"; }); });
    var open = sent(f, i ? "session/resume" : "session/start")[0].params;
    var server = open.config.mcpServers["clay-tools"];
    assert.equal(server.command, process.execPath);
    assert.deepEqual(server.args, [path.resolve("lib/yoke/mcp-bridge-server.js"), "--port", "32123", "--slug", "muse-fixture", "--session", session.localId, "--query-generation", String(session._sdkQueryGeneration), "--session-only", "--tls"]);
    assert.deepEqual(server.env, { CLAY_AUTH_TOKEN: "fixture-auth", CLAY_BRIDGE_TOKEN: "fixture-bridge" });
    assert.equal(sent(f, "turn/start")[0].params.reasoningEffort, "high");
    assert.equal(recorded.filter(function(event) { return event.type === "tool_result"; }).length, 1);
    assert.equal(recorded.filter(function(event) { return event.type === "delta"; }).map(function(event) { return event.text; }).join(""), "early hello");
    assert.equal(recorded.some(function(event) { return event.type === "informational"; }), false, "internal items must not reach the transcript on start or resume");
    await f.adapter.shutdown();
  }
});

test("direct Muse query refuses mapped OS-owner spawning", async function(t) {
  var f = await fixture(t, "complete");
  await assert.rejects(f.adapter.createQuery({ linuxUser: { username: "another-owner" } }), /OS-owner isolation/);
  assert.equal(f.wire().length, 0);
});

test("server approval request receives receipt and one safe decision through actual Connection", async function(t) {
  var f = await fixture(t, "server-approval");
  var handle = await f.adapter.createQuery({ canUseTool: function() { return { behavior: "allow" }; } });
  handle.pushMessage("run"); handle.endInput();
  var events = await collect(handle); assert.equal(events.at(-1).yokeType, "result");
  assert.ok(f.wire().some(function(frame) { return frame.id === 1 && frame.result && !frame.method; }));
  assert.equal(sent(f, "approval/decide").length, 1);
  assert.equal(sent(f, "approval/decide")[0].params.choiceId, "allow-once");
});

test("title timeout shuts down an unresponsive handshake within its bound", { timeout: 5000 }, async function(t) {
  var f = await fixture(t, "handshake-hang", { _titleTimeoutMs: 100 });
  var began = Date.now();
  await assert.rejects(f.adapter.generateTitle(["conversation"]), /aborted|timed out/);
  await until(function() { return f.adapter.clients.size === 0; });
  assert.ok(Date.now() - began < 3000);
  assert.equal(f.adapter.clients.size, 0); assert.equal(f.adapter.handles.size, 0);
});

test("model discovery timeout cleans up the actual owned process", { timeout: 5000 }, async function(t) {
  var f = await fixture(t, "model-hang", { _requestTimeoutMs: 50 });
  await assert.rejects(f.adapter.supportedModels(), /timed out/);
  assert.equal(f.adapter.clients.size, 0);
});

test("shutdown owns handles before any message and during an active turn", async function(t) {
  var f = await fixture(t, "turn-hang");
  var idle = await f.adapter.createQuery({});
  var active = await f.adapter.createQuery({}); active.pushMessage("run");
  await until(function() { return sent(f, "turn/start").length; });
  var runtime = Array.from(f.adapter.clients)[0];
  assert.ok(runtime.connection instanceof f.sdk.Connection);
  assert.ok(runtime.session instanceof f.sdk.Session);
  await f.adapter.shutdown();
  assert.equal(idle.pushMessage("late"), false); assert.equal(active.pushMessage("late"), false);
  assert.equal(f.adapter.handles.size, 0); assert.equal(f.adapter.clients.size, 0);
});

test("session/start notifications before Session construction are folded in order", async function(t) {
  var f = await fixture(t, "early-open"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run");
  var iterator = handle[Symbol.asyncIterator](); var events = [];
  while (true) {
    var next = await iterator.next(); events.push(next.value);
    if (next.value.yokeType === "result") break;
  }
  var runtime = Array.from(f.adapter.clients)[0];
  assert.equal(runtime.session.fold.items.get("opening-item-opening-turn").text, "opening");
  assert.equal((await runtime.session.turn("opening-turn").completed).params.terminal, "completed");
  assert.equal(events.filter(function(event) { return event.yokeType === "text_delta"; }).map(function(event) { return event.text; }).join(""), "early hello");
  await handle.close();
});

["cancelled", "unknown-terminal"].forEach(function(mode) {
  test("actual SDK " + mode + " terminal never reports success or admits queued input", async function(t) {
    var f = await fixture(t, mode); var handle = await f.adapter.createQuery({});
    handle.pushMessage("run"); handle.pushMessage("queued"); handle.endInput();
    var events = await collect(handle);
    assert.equal(events.at(-1).yokeType, mode === "cancelled" ? "interrupted" : "error");
    assert.equal(sent(f, "turn/start").length, 1);
  });
});

test("SDK approval submit failure terminates the query and reports the host refusal", async function(t) {
  var f = await fixture(t, "approval-reject");
  var handle = await f.adapter.createQuery({ canUseTool: function() { return { behavior: "deny" }; } });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.at(-1).yokeType, "error"); assert.match(events.at(-1).text, /Fixture approval refused/);
  await handle.close(); assert.equal(f.adapter.clients.size, 0);
});

test("selected model effort is checked against the actual catalog before admission", async function(t) {
  var f = await fixture(t, "complete");
  var handle = await f.adapter.createQuery({ model: "wonder-1", effort: "ultra" });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.at(-1).yokeType, "error"); assert.match(events.at(-1).text, /reasoning effort/);
  assert.equal(sent(f, "session/start").length, 0);
});

test("real reasoning summary fields stream once and close the YOKE block", async function(t) {
  var f = await fixture(t, "reasoning"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  var starts = events.filter(function(event) { return event.yokeType === "thinking_start"; });
  assert.equal(starts.length, 1);
  assert.equal(events.filter(function(event) { return event.yokeType === "thinking_delta"; }).map(function(event) { return event.text; }).join(""), "think\nmore");
  assert.equal(events.filter(function(event) { return event.yokeType === "block_stop" && event.blockId === starts[0].blockId; }).length, 1);
});

test("unknown SDK item fallback text is not exposed as chat output", async function(t) {
  var f = await fixture(t, "unknown-item"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.some(function(event) { return event.yokeType === "informational"; }), false);
  assert.equal(events.at(-1).yokeType, "result");
});

test("real SDK folds reminder and internal lifecycle around a reply without chat chatter", async function(t) {
  var f = await fixture(t, "internal-chatter"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("hello");
  var events = []; var iterator = handle[Symbol.asyncIterator]();
  while (true) {
    var next = await iterator.next(); assert.equal(next.done, false); events.push(next.value);
    if (next.value.yokeType === "result") break;
  }
  var runtime = Array.from(f.adapter.clients)[0];
  var turnId = sent(f, "turn/start")[0].params.commandId;
  ["reminderChild", "hookRun", "compaction", "sideChat", "futureInternal"].forEach(function(kind) {
    assert.equal(runtime.session.fold.items.get("internal-" + kind + "-" + turnId).status, "completed");
  });
  assert.equal(events.filter(function(event) { return event.yokeType === "informational"; }).length, 0);
  assert.equal(events.filter(function(event) { return event.yokeType === "text_delta"; }).map(function(event) { return event.text; }).join(""), "early hello");
  assert.equal(events.filter(function(event) { return event.yokeType === "tool_result" && event.content === "/workspace"; }).length, 1);
  await handle.close();
});

test("intentional action summaries survive once without raw kind or lifecycle labels", async function(t) {
  var f = await fixture(t, "action-output"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.deepEqual(events.filter(function(event) { return event.yokeType === "informational"; }).map(function(event) { return event.content; }), ["Task findings", "Workflow finished", "Search found three useful pages"]);
  assert.equal(events.at(-1).yokeType, "result");
});

test("internal filtering retains explicit warnings, tool failures and the actual turn error", async function(t) {
  var f = await fixture(t, "internal-failure"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  var notices = events.filter(function(event) { return event.yokeType === "informational"; });
  assert.equal(notices.length, 4);
  assert.ok(notices.every(function(event) { return event.level === "warning"; }));
  assert.ok(notices.some(function(event) { return event.content.includes("A required hook was blocked"); }));
  assert.ok(notices.some(function(event) { return event.content.includes("Context maintenance failed"); }));
  assert.equal(JSON.stringify(notices).includes("Raw unknown error dump"), false);
  assert.ok(events.some(function(event) { return event.yokeType === "tool_result" && event.isError && event.content === "Command failed"; }));
  assert.equal(events.at(-1).yokeType, "error"); assert.equal(events.at(-1).text, "Fixture turn failure");
  assert.equal(events.some(function(event) { return event.yokeType === "result"; }), false);
});

test("session services use public typed methods, preserve pagination and report admission truthfully", async function(t) {
  var f = await fixture(t, "complete");
  var rows = await f.adapter.listSessions({ limit: 10 });
  assert.equal(rows[0].sessionId, "fixture-session"); assert.equal(rows.nextCursor, "page-2");
  assert.equal(sent(f, "session/list")[0].params.workspaceRoot, process.cwd());
  var read = await f.adapter.readSession("fixture-session", { includeItems: true });
  assert.equal(read.session.sessionId, "fixture-session");
  assert.equal(sent(f, "session/read")[0].params.excludeItems, false);
  var renamed = await f.adapter.renameSession("fixture-session", "New name");
  assert.equal(renamed.status, "accepted"); assert.equal(renamed.name, undefined);
  var forked = await f.adapter.forkSession("fixture-session", { upToMessageId: "completed-turn" });
  assert.deepEqual(forked, { sessionId: "forked-session", useLocalHistory: true });
  assert.deepEqual(sent(f, "session/fork")[0].params.cutPoint, { lastTurnId: "completed-turn" });
  var usage = await f.adapter.readUsage();
  assert.equal(usage.window.usedPercent, 105); assert.equal(usage.weekly.usedPercent, 0);
  assert.equal(f.adapter.clients.size, 0);
  await assert.rejects(f.adapter.renameSession("fixture-session", "No", { linuxUser: "foreign" }), /OS-owner/);
});

test("unknown account usage remains unavailable", async function(t) {
  var f = await fixture(t, "no-usage"); assert.equal(await f.adapter.readUsage(), null);
});

test("native user input uses actual SDK frames and exact answer identity", async function(t) {
  var f = await fixture(t, "user-input"); var called = 0;
  var handle = await f.adapter.createQuery({ onUserInputRequest: function(request, respond) {
    called++; assert.equal(request.native, true); assert.equal(request.id, "input-1"); respond({ choice: "Beta" });
  } });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.at(-1).yokeType, "result"); assert.equal(called, 1);
  assert.equal(sent(f, "initialize")[0].params.capabilities.userInputDialogs, true);
  assert.deepEqual(sent(f, "userInput/answer")[0].params.answers, [{ questionId: "choice", selectedLabel: "Beta" }]);
});

test("Stop retires native input response before a late user answer", async function(t) {
  var f = await fixture(t, "pending-input"); var respond;
  var handle = await f.adapter.createQuery({ onUserInputRequest: function(request, callback) { respond = callback; } });
  handle.pushMessage("run"); await until(function() { return !!respond; });
  await handle.abort(); assert.equal(respond({ choice: "Alpha" }), false);
  assert.equal(sent(f, "userInput/answer").length, 0); assert.equal(sent(f, "userInput/cancel").length, 0);
});

test("images, model changes, compaction admission and typed skill invocation use actual SDK", async function(t) {
  var f = await fixture(t, "complete"); var handle = await f.adapter.createQuery({ model: "wonder-1", cwd: f.directory, skillOptions: { disable: false, homeDir: f.directory, isAvailable: function() { return true; } } });
  var iterator = handle[Symbol.asyncIterator]();
  handle.pushMessage("look", [{ mediaType: "image/png", data: "YQ==" }]);
  while ((await iterator.next()).value.yokeType !== "result") {}
  assert.deepEqual(sent(f, "turn/start")[0].params.input[1], { type: "image", mediaType: "image/png", base64Data: "YQ==" });
  await handle.setModel("wonder-1"); await handle.setEffort("low");
  assert.equal(sent(f, "session/setModel")[0].params.model.modelId, "wonder-1");
  assert.equal(sent(f, "session/setReasoningEffort")[0].params.reasoningEffort, "low");
  assert.equal((await handle.compact()).status, "accepted");
  assert.deepEqual((await handle.listTasks()).tasks, []);
  await handle.stopTask("task-1");
  assert.equal(sent(f, "task/stop")[0].params.taskId, "task-1");
  assert.equal(await handle.invokeSkill("review", "this change"), true);
  while ((await iterator.next()).value.yokeType !== "result") {}
  assert.deepEqual(sent(f, "turn/start")[1].params.input[1], { type: "skill", selector: "review", arguments: "this change" });
  await assert.rejects(handle.invokeSkill("unknown", ""), /live session catalog/);
  await assert.rejects(handle.rollback(), /no rollback/);
  await handle.close();
});

test("title policy excludes session MCP and selects denial without permission widening", async function(t) {
  var f = await fixture(t, "complete"); await f.adapter.generateTitle(["title"]);
  var start = sent(f, "session/start")[0].params;
  assert.equal(start.config, undefined); assert.equal(start.approvalMode, "denyUnmatched");
  assert.equal(f.adapter.clients.size, 0);
});

test("host-settled input retires its human callback without a second settlement", async function(t) {
  var f = await fixture(t, "settled-input"); var respond;
  var handle = await f.adapter.createQuery({ onUserInputRequest: function(request, callback) { respond = callback; } });
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.at(-1).yokeType, "result"); assert.equal(respond({ choice: "Alpha" }), false);
  assert.equal(sent(f, "userInput/answer").length, 0); assert.equal(sent(f, "userInput/cancel").length, 0);
});

test("usage and context retain observed zero, over-quota and occupancy facts", async function(t) {
  var f = await fixture(t, "usage-context"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  var quota = events.find(function(event) { return event.yokeType === "rate_limit"; });
  assert.equal(quota.rateLimitInfo.observedAtMs, 123456);
  assert.deepEqual(quota.rateLimitInfo.windows.map(function(window) { return window.usedPercent; }), [105, 0]);
  var context = await handle.getContextUsage();
  assert.equal(require('../lib/yoke/usage').context(context, f.adapter).context.usedTokens, 15);
  var persisted; require('../lib/sdk-quota-snapshot').recordQuotaSnapshot({ localId: 'quota', vendor: 'muse' }, quota.rateLimitInfo, function(session, message) { persisted = message; });
  assert.equal(persisted.observedAtMs, 123456); assert.equal(persisted.quotaWindows[0].resetsAt, 200000);
});

test("invalid MCP and unsupported controls fail explicitly without widening approvals", async function(t) {
  var policy = require('../lib/yoke/muse-policy');
  assert.throws(function() { policy.normalizeMcpServers({}); }, /Invalid/);
  assert.throws(function() { policy.normalizeMcpServers([{ name: '__proto__', command: 'node' }]); }, /Invalid/);
  var f = await fixture(t, "complete"); var handle = await f.adapter.createQuery({});
  await assert.rejects(handle.setToolPolicy('persistent'), /Unsupported/);
  await assert.rejects(handle.stopTask('missing-session'), /opened session/);
  await assert.rejects(handle.setModel(null), /model id/);
  assert.equal(f.wire().length, 0); await handle.close();
});

test("view gaps fail explicitly without retrying an uncertain turn", async function(t) {
  var f = await fixture(t, "view-gap"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
  assert.equal(events.at(-1).yokeType, "error"); assert.match(events.at(-1).text, /view stream has a gap/);
  assert.equal(events.some(function(event) { return event.yokeType === "result"; }), false);
  assert.equal(sent(f, "turn/start").length, 1); assert.equal(sent(f, "view/page").length, 0);
});

["image-artifact", "bad-image-artifact"].forEach(function(mode) {
  test(mode + " maps only observed complete raster output through the common image contract", async function(t) {
    var f = await fixture(t, mode); var handle = await f.adapter.createQuery({});
    handle.pushMessage("run"); handle.endInput(); var events = await collect(handle);
    var images = events.filter(function(event) { return event.yokeType === "generated_image"; });
    assert.equal(images.length, 1); assert.equal(images[0].isError, mode === "bad-image-artifact");
    assert.equal(images[0].data, mode === "image-artifact" ? "cG5n" : "");
    assert.equal(images[0].savedPath, null); assert.equal(images[0].prompt, "");
    assert.equal(sent(f, "item/readOutput").length, 1);
    assert.equal(sent(f, "item/readOutput")[0].params.outputRef, "image-output");
    assert.equal(f.adapter.generateImage, undefined);
    if (mode === "image-artifact") {
      var saved = [], stored = [];
      var bridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: process.cwd(), slug: 'muse-images', adapter: f.adapter,
        send: function() {}, sessionManager: { sendAndRecord: function(session, record) { stored.push(record); } },
        saveImageFile: function(mediaType, data) { saved.push({ mediaType: mediaType, data: data }); return 'artifact.png'; },
      });
      bridge.processSDKMessage({ localId: 'image-session', vendor: 'muse' }, images[0]);
      assert.deepEqual(saved, [{ mediaType: 'image/png', data: 'cG5n' }]);
      assert.deepEqual(stored[1].imageRefs, [{ mediaType: 'image/png', file: 'artifact.png' }]);
      assert.equal(stored[1].data, undefined);
    }
  });
});

test("Stop retires pending image artifact reads without emitting a late image", async function(t) {
  var f = await fixture(t, "pending-image-artifact"); var handle = await f.adapter.createQuery({});
  handle.pushMessage("run"); await until(function() { return sent(f, "item/readOutput").length; });
  await handle.abort(); assert.deepEqual(await collect(handle), [{ yokeType: "interrupted" }]);
});

test("production fork path copies exactly through the selected native completed turn", { timeout: 10000 }, async function(t) {
  var f = await fixture(t, "fork-history");
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-muse-fork-"));
  t.after(function() { fs.rmSync(root, { recursive: true, force: true }); });
  var sm = require('../lib/sessions').createSessionManager({ cwd: root, sessionsBase: path.join(root, 'sessions'), cliSessionsDir: path.join(root, 'cli'), send: function() {} });
  var session = sm.createSession({ vendor: 'muse' });
  session.responsePreview = '';
  var bridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: root, adapter: f.adapter, adapters: { muse: f.adapter }, sessionManager: sm, send: function() {} });
  var handle = await f.adapter.createQuery({ model: 'wonder-1' });
  var iterator = handle[Symbol.asyncIterator]();
  for (var prompt of ['First question', 'Selected question', 'Later question']) {
    sm.sendAndRecord(session, { type: 'user_message', text: prompt });
    handle.pushMessage(prompt);
    while (true) {
      var next = await iterator.next(); assert.equal(next.done, false);
      bridge.processSDKMessage(session, next.value);
      if (next.value.yokeType === 'result') break;
    }
  }
  var latest = sent(f, 'turn/start').at(-1).params;
  var connection = Array.from(f.adapter.clients)[0].connection;
  await connection.command('turn/start', latest, { commandId: latest.commandId });
  var storedTurns = JSON.parse(fs.readFileSync(path.join(f.directory, 'wire.jsonl.turns.json'), 'utf8'));
  assert.equal(storedTurns.length, 3, 'same-command reconciliation must not execute a fourth turn');
  await handle.close();
  var ids = new Set();
  var nativeTurns = sent(f, 'turn/start').filter(function (frame) {
    if (ids.has(frame.params.commandId)) return false;
    ids.add(frame.params.commandId); return true;
  });
  var selectedTurn = nativeTurns[1].params.commandId;
  var actions = require('../lib/project-session-history-actions').attachSessionHistoryActions({ sm: sm, sdk: bridge, cwd: root });
  var forked = await actions.fork(session, selectedTurn, null, function() {});
  var nativeItems = f.wire().find(function(row) { return row.result && row.result.session && row.result.session.sessionId === 'forked-session'; }).result.history.items;
  var nativeHistory = [];
  nativeItems.forEach(function(item) {
    if (item.kind === 'userMessage') nativeHistory.push({ prompt: item.text, answer: '' });
    if (item.kind === 'agentMessage') nativeHistory.at(-1).answer += item.text;
  });
  function transcript(history) {
    var turns = [], current;
    history.forEach(function(entry) {
      if (entry.type === 'user_message') { current = { prompt: entry.text, answer: '' }; turns.push(current); }
      if (entry.type === 'delta' && current) current.answer += entry.text;
    });
    return turns;
  }
  assert.deepEqual(transcript(forked.history), nativeHistory.map(function(turn) { return { prompt: turn.prompt, answer: turn.answer }; }));
  assert.deepEqual(transcript(forked.history), [
    { prompt: 'First question', answer: 'early Answer 1' },
    { prompt: 'Selected question', answer: 'early Answer 2' },
  ]);
  assert.equal(transcript(session.history).length, 3);
  assert.equal(sent(f, 'session/fork')[0].params.cutPoint.lastTurnId, selectedTurn);
  assert.equal(forked.history.at(-1).type, 'done');
  var forksBefore = sent(f, 'session/fork').length;
  await assert.rejects(actions.fork(session, 'unknown-boundary', null, function() {}), /safely represent/);
  var marker = session.messageUUIDs.find(function(entry) { return entry.uuid === selectedTurn; });
  session.history.splice(marker.historyIndex + 1, 0, { type: 'user_message', text: 'Ambiguous interleaved input' });
  await assert.rejects(actions.fork(session, selectedTurn, null, function() {}), /safely represent/);
  assert.equal(sent(f, 'session/fork').length, forksBefore, 'ambiguous boundaries must refuse before native effects');
  await assert.rejects(f.adapter.forkSession('fixture-session', { upToMessageId: 'unknown-native-turn' }), function (error) {
    return error.kind === 'commandRejected' && /Unknown completed turn/.test(error.message);
  }, 'fixture rejection must satisfy the public MSP error contract');
});

test("legacy local-history forks retain their existing exclusive boundary", async function() {
  var created;
  var parent = { localId: 1, vendor: 'codex', cliSessionId: 'legacy', history: [
    { type: 'user_message', text: 'Before' }, { type: 'message_uuid', uuid: 'selected', messageType: 'user' }, { type: 'delta', text: 'After marker' },
  ], messageUUIDs: [{ uuid: 'selected', type: 'user', historyIndex: 1 }] };
  var sm = { sessions: new Map([[1, parent]]), saveSessionFile: function() { return true; }, broadcastSessionList: function() {},
    createSessionRaw: function() { created = { localId: 2 }; return created; } };
  var adapter = { vendor: 'codex', rollbackThread: function() {}, forkSession: async function() { return { sessionId: 'legacy-fork' }; } };
  var bridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: process.cwd(), adapter: adapter, adapters: { codex: adapter }, sessionManager: sm, send: function() {} });
  var actions = require('../lib/project-session-history-actions').attachSessionHistoryActions({ sm: sm, sdk: bridge, cwd: process.cwd() });
  await actions.fork(parent, 'selected', null, function() {});
  assert.deepEqual(created.history, [{ type: 'user_message', text: 'Before' }]);
  var claudeAdapter = { vendor: 'claude', forkSession: async function() { return { sessionId: 'file-backed-fork' }; } };
  var claudeBridge = require('../lib/sdk-bridge').createSDKBridge({ cwd: process.cwd(), adapter: claudeAdapter, adapters: { claude: claudeAdapter }, sessionManager: sm, send: function() {} });
  assert.deepEqual(await claudeBridge.forkSession(Object.assign({}, parent, { vendor: 'claude' }), 'selected'), { sessionId: 'file-backed-fork', useLocalHistory: false });
});
