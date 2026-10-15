var fs = require("fs");
var os = require("os");
var path = require("path");

var claudeModule = require("../../lib/yoke/adapters/claude");
var codexModule = require("../../lib/yoke/adapters/codex");
var kiroModule = require("../../lib/yoke/adapters/kiro");
var CodexAppServer = require("../../lib/yoke/codex-app-server").CodexAppServer;

function emptyAsyncQuery() {
  return {
    [Symbol.asyncIterator]: function() {
      return { next: function() { return Promise.resolve({ done: true }); } };
    },
    setModel: function() { return Promise.resolve(); },
    setPermissionMode: function() { return Promise.resolve(); },
    stopTask: function() { return Promise.resolve(); },
    getContextUsage: function() { return Promise.resolve(null); },
    endInput: function() {},
    close: function() {},
  };
}

function createClaudeHandle() {
  var kit = claudeModule.contractTestKit;
  return kit.createQueryHandle(emptyAsyncQuery(), kit.createMessageQueue(), new AbortController());
}

function createCodexHandle() {
  var server = {
    started: true,
    eventHandler: null,
    send: function() { return Promise.resolve({}); },
    notify: function() {},
    respond: function() {},
  };
  return codexModule.contractTestKit.createQueryHandle(server, {
    cwd: process.cwd(),
    model: "contract-model",
    abortController: new AbortController(),
  });
}

function createKiroHandle() {
  var handlers = [];
  var server = {
    started: true,
    addHandler: function(fn) {
      var entry = { sessionId: null, fn: fn };
      handlers.push(entry);
      return entry;
    },
    removeHandler: function(entry) {
      var index = handlers.indexOf(entry);
      if (index !== -1) handlers.splice(index, 1);
    },
    send: function() { return Promise.resolve({}); },
    notify: function() {},
    respond: function() {},
  };
  return kiroModule.contractTestKit.createQueryHandle(server, {
    cwd: process.cwd(),
    model: "auto",
    abortController: new AbortController(),
  });
}

function requireFunctions(target, names) {
  for (var i = 0; i < names.length; i++) {
    if (typeof target[names[i]] !== "function") {
      throw new Error("Missing required function: " + names[i]);
    }
  }
}

function createFixtures() {
  return [
    {
      vendor: "claude",
      createAdapter: function() { return claudeModule.createClaudeAdapter({ cwd: process.cwd() }); },
      createHandle: createClaudeHandle,
      createState: function() { return null; },
      normalize: claudeModule.contractTestKit.normalizeEvent,
      rawEvents: [
        { type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } },
        { type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: "hello" } } },
        { type: "stream_event", event: { type: "content_block_start", index: 1, content_block: { type: "thinking" } } },
        { type: "stream_event", event: { type: "content_block_delta", index: 1, delta: { type: "thinking_delta", thinking: "why" } } },
        { type: "stream_event", event: { type: "content_block_start", index: 2, content_block: { type: "tool_use", id: "tool-1", name: "Bash" } } },
        { type: "result", session_id: "claude-session" },
      ],
      expectedEvents: [
        { yokeType: "text_start", blockId: "blk_0" },
        { yokeType: "text_delta", blockId: "blk_0", text: "hello" },
        { yokeType: "thinking_start", blockId: "blk_1" },
        { yokeType: "thinking_delta", blockId: "blk_1", text: "why" },
        { yokeType: "tool_start", blockId: "blk_2", toolId: "tool-1", toolName: "Bash" },
        { yokeType: "result", sessionId: "claude-session" },
      ],
      verifyDependency: async function() {
        var sdk = await import("@anthropic-ai/claude-agent-sdk");
        requireFunctions(sdk, ["query", "createSdkMcpServer", "tool", "getSessionInfo", "listSessions", "renameSession", "forkSession"]);
      },
    },
    {
      vendor: "codex",
      createAdapter: function() { return codexModule.createCodexAdapter({ cwd: process.cwd() }); },
      createHandle: createCodexHandle,
      createState: function() { return codexModule.contractTestKit.createEventState("contract-model"); },
      normalize: codexModule.contractTestKit.normalizeEvent,
      rawEvents: [
        { method: "thread/started", params: { thread: { id: "codex-session" } } },
        { method: "item/agentMessage/delta", params: { itemId: "msg-1", delta: "hello" } },
        { method: "item/completed", params: { item: { id: "reason-1", type: "reasoning", text: "why" } } },
        { method: "item/started", params: { item: { id: "tool-1", type: "commandExecution", command: "pwd" } } },
        { method: "item/completed", params: { item: { id: "tool-1", type: "commandExecution", command: "pwd", aggregated_output: "/tmp", status: "completed" } } },
        { method: "turn/completed", params: {} },
      ],
      expectedEvents: [
        { yokeType: "text_start", blockId: "blk_1" },
        { yokeType: "text_delta", blockId: "blk_1", text: "hello" },
        { yokeType: "thinking_start", blockId: "blk_2" },
        { yokeType: "thinking_delta", blockId: "blk_2", text: "why" },
        { yokeType: "thinking_stop", blockId: "blk_2" },
        { yokeType: "tool_start", blockId: "blk_3", toolId: "tool-1", toolName: "Bash" },
        { yokeType: "tool_executing", blockId: "blk_3", toolId: "tool-1", toolName: "Bash" },
        { yokeType: "tool_result", blockId: "blk_3", toolId: "tool-1", content: "/tmp", isError: false },
        { yokeType: "result", sessionId: "codex-session" },
      ],
      verifyDependency: async function() {
        var codexHome = fs.mkdtempSync(path.join(os.tmpdir(), "clay-codex-contract-"));
        var server = new CodexAppServer(null, {
          cwd: process.cwd(),
          env: { CODEX_HOME: codexHome },
        });
        try {
          await server.start();
          var result = await server.send("initialize", {
            clientInfo: { name: "clay-contract-harness", title: "Clay Contract Harness", version: "1.0.0" },
            capabilities: { experimentalApi: true },
          }, 30000);
          if (!result || !result.userAgent) throw new Error("Codex initialize response is missing userAgent");
          server.notify("initialized", {});
          var thread = await server.send("thread/start", {
            model: "gpt-5.4-mini",
            sandbox: "read-only",
            approvalPolicy: "on-request",
            cwd: process.cwd(),
            skipGitRepoCheck: true,
          }, 30000);
          if (!thread || !thread.thread || !thread.thread.id) {
            throw new Error("Codex thread/start response is missing a thread id");
          }
        } finally {
          await require("./stop-process-fixture.cjs").stopAndWait(server);
          fs.rmSync(codexHome, { recursive: true, force: true });
        }
      },
    },
    {
      vendor: "kiro",
      createAdapter: function() { return kiroModule.createKiroAdapter({ cwd: process.cwd(), _binaryPath: "/contract/kiro-cli" }); },
      createHandle: createKiroHandle,
      createState: function() { return kiroModule.contractTestKit.createEventState({ model: "auto" }); },
      normalize: kiroModule.contractTestKit.normalizeEvent,
      rawEvents: [
        { sessionUpdate: "agent_message_chunk", content: { type: "text", text: "hello" } },
        { sessionUpdate: "agent_thought_chunk", content: { type: "text", text: "why" } },
        { sessionUpdate: "tool_call", toolCallId: "tool-1", kind: "execute", title: "Run", rawInput: { command: "pwd" } },
        { sessionUpdate: "tool_call_update", toolCallId: "tool-1", content: [{ type: "content", content: { type: "text", text: "/tmp" } }] },
        { sessionUpdate: "tool_call_update", toolCallId: "tool-1", status: "completed", rawOutput: { output: "/tmp" } },
      ],
      expectedEvents: [
        { yokeType: "text_start", blockId: "blk_1" },
        { yokeType: "text_delta", blockId: "blk_1", text: "hello" },
        { yokeType: "thinking_start", blockId: "blk_2" },
        { yokeType: "thinking_delta", blockId: "blk_2", text: "why" },
        { yokeType: "tool_start", blockId: "blk_3", toolId: "tool-1", toolName: "Bash" },
        { yokeType: "tool_executing", blockId: "blk_3", toolId: "tool-1", toolName: "Bash" },
        { yokeType: "tool_result", blockId: "blk_3", toolId: "tool-1", content: "/tmp", isError: false },
      ],
      verifyDependency: function() { return Promise.resolve(); },
    },
  ];
}

module.exports = { createFixtures: createFixtures };
