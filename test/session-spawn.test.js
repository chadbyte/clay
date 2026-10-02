var test = require("node:test");
var assert = require("node:assert");

var spawnModule = require("../lib/project-session-spawn");
var yoke = require("../lib/yoke");

function createForkFixture(options) {
  options = options || {};
  var parent = Object.assign({
    localId: 1,
    ownerId: "owner-1",
    sessionVisibility: "private",
    vendor: "claude",
    cliSessionId: "cli-parent",
    history: [
      { type: "user_message", text: "The plan is Project Pine." },
      { type: "message_uuid", uuid: "uuid-user", messageType: "user" },
      { type: "assistant_message", text: "I understand the plan." },
      { type: "message_uuid", uuid: "uuid-assistant", messageType: "assistant" },
    ],
    messageUUIDs: [
      { uuid: "uuid-user", type: "user", historyIndex: 1, turnId: null },
      { uuid: "uuid-assistant", type: "assistant", historyIndex: 3, turnId: null },
    ],
  }, options.parent || {});
  var sessions = new Map([[parent.localId, parent]]);
  var nextId = 2;
  var starts = [];
  var forks = [];
  var broadcasts = 0;
  var forkCount = 0;
  var sm = {
    sessions: sessions,
    defaultVendor: "claude",
    capabilitiesByVendor: options.capabilitiesByVendor || { claude: { fork: true } },
    createSessionRaw: function(sessionOptions) {
      var session = Object.assign({
        localId: nextId++,
        history: [],
        messageUUIDs: [],
        sentToolResults: {},
        isProcessing: false,
        createdAt: Date.now(),
      }, sessionOptions);
      sessions.set(session.localId, session);
      return session;
    },
    saveSessionFile: function() {},
    appendToSessionFile: function() {},
    broadcastSessionList: function() { broadcasts++; },
  };
  var sdk = {
    forkSession: function(session, uuid) {
      forkCount++;
      forks.push({ session: session, uuid: uuid, count: forkCount });
      if (options.forkSession) return options.forkSession(session, uuid, forkCount);
      return Promise.resolve({ sessionId: "cli-fork-" + forkCount, useLocalHistory: true });
    },
    startQuery: function(session, prompt, images, linuxUser) {
      starts.push({ session: session, prompt: prompt, linuxUser: linuxUser });
      session.queryInstance = {};
      return Promise.resolve();
    },
  };
  var fakeAdapter = {
    createToolServer: function(def) { return { name: def.name, tools: def.tools }; },
  };
  var adapters = options.adapters || { claude: fakeAdapter };
  var attached = spawnModule.attachSessionSpawn({
    cwd: process.cwd(),
    sm: sm,
    getSdk: function() { return sdk; },
    isMate: false,
    adapters: adapters,
    getLinuxUserForSession: function() { return null; },
    readCliSessionHistory: options.readCliSessionHistory,
  });
  var server = attached.createMcpServer(fakeAdapter, parent);
  var spawnTool = server.tools.filter(function(tool) { return tool.name === "spawn_sessions"; })[0];
  var checkTool = server.tools.filter(function(tool) { return tool.name === "check_spawned_sessions"; })[0];
  return {
    parent: parent,
    sessions: sessions,
    starts: starts,
    forks: forks,
    get broadcasts() { return broadcasts; },
    spawn: function(args) { return spawnTool.handler(args); },
    check: function(args) { return checkTool.handler(args || {}); },
  };
}

test("session spawn parses a valid batch", function() {
  var batch = spawnModule.parseBatch(JSON.stringify([
    { title: " First ", prompt: " Do the first task " },
    { prompt: "Do the second task" },
  ]));
  assert.deepStrictEqual(batch, [
    { title: "First", prompt: "Do the first task" },
    { title: "Spawned task 2", prompt: "Do the second task" },
  ]);
});

test("session spawn is explicit that it cannot substitute for a Split Worker", function () {
  var defs = require("../lib/session-spawn-mcp-server").getToolDefs({
    spawn: function () {},
    check: function () {},
  });
  var spawn = defs.filter(function (tool) { return tool.name === "spawn_sessions"; })[0];
  assert.match(spawn.description, /does not create a visible Driver\/Split Worker pair/);
  assert.match(spawn.description, /use send_to_partner/);
});

test("session spawn rejects a non-array batch", function() {
  assert.throws(function() {
    spawnModule.parseBatch("{}");
  }, { message: "sessions must be a valid JSON array" });
});

test("session spawn rejects a missing prompt", function() {
  assert.throws(function() {
    spawnModule.parseBatch('[{"title":"No prompt"}]');
  }, { message: "session 1 must include a non-empty prompt" });
});

test("session spawn rejects more than ten entries", function() {
  var entries = [];
  for (var i = 0; i < 11; i++) entries.push({ prompt: "Task " + i });
  assert.throws(function() {
    spawnModule.parseBatch(JSON.stringify(entries));
  }, { message: "sessions must contain between 1 and 10 entries" });
});

test("spawned sessions cannot create grandchildren", function() {
  assert.throws(function() {
    spawnModule.assertSpawnAllowed({ localId: 7, spawn: { parentId: 2 } }, [], 1);
  }, { message: "spawned sessions cannot spawn further sessions" });
});

test("check_spawned_sessions reports an interrupted child distinctly", async function() {
  var f = createForkFixture();
  var response = await f.spawn({ sessions: JSON.stringify([{ title: "Worker", prompt: "Implement it" }]) });
  var spawned = JSON.parse(response.content[0].text).spawned[0];
  var child = f.sessions.get(spawned.localId);
  child.isProcessing = false;
  child._lastTurnInterrupted = true;
  child.history.push({ type: "info", text: "Interrupted · What should Claude do instead?" });
  child.history.push({ type: "done", code: 0 });

  var checked = JSON.parse((await f.check()).content[0].text);
  assert.strictEqual(checked[0].status, "interrupted");
});

test("twentieth child is allowed and twenty-first is rejected", function() {
  var parent = { localId: 4 };
  var children = [];
  for (var i = 0; i < 19; i++) children.push({ spawn: { parentId: 4 } });
  assert.strictEqual(spawnModule.assertSpawnAllowed(parent, children, 1), 19);
  children.push({ spawn: { parentId: 4 } });
  assert.throws(function() {
    spawnModule.assertSpawnAllowed(parent, children, 1);
  }, { message: "a parent session cannot have more than 20 children" });
});

test("spawn queue starts three tasks and advances on completion", function() {
  var queue = spawnModule.createSpawnQueue(3);
  var completions = [];
  var started = [];
  var tasks = [];
  for (var i = 0; i < 5; i++) {
    (function(index) {
      tasks.push({
        start: function(done) {
          started.push(index);
          completions[index] = done;
        },
      });
    })(i);
  }

  var counts = queue.add(tasks);
  assert.deepStrictEqual(counts, { queued: 2, running: 3 });
  assert.deepStrictEqual(started, [0, 1, 2]);
  completions[0]();
  assert.deepStrictEqual(started, [0, 1, 2, 3]);
  completions[1]();
  completions[2]();
  completions[3]();
  completions[4]();
  assert.strictEqual(queue.pendingCount, 0);
  assert.strictEqual(queue.runningCount, 0);
});

test("session spawn MCP creates inherited background sessions and starts three", async function() {
  var parent = {
    localId: 1,
    ownerId: "owner-1",
    sessionVisibility: "private",
    vendor: "claude",
    history: [],
  };
  var sessions = new Map([[1, parent]]);
  var nextId = 2;
  var broadcasts = 0;
  var starts = [];
  var sm = {
    sessions: sessions,
    defaultVendor: "claude",
    createSessionRaw: function(opts) {
      var session = Object.assign({
        localId: nextId++,
        history: [],
        sentToolResults: {},
        isProcessing: false,
        createdAt: Date.now(),
      }, opts);
      sessions.set(session.localId, session);
      return session;
    },
    saveSessionFile: function() {},
    appendToSessionFile: function() {},
    broadcastSessionList: function() { broadcasts++; },
  };
  var sdk = {
    startQuery: function(session, prompt, images, linuxUser) {
      starts.push({ session: session, prompt: prompt, linuxUser: linuxUser });
      session.queryInstance = {};
      return Promise.resolve();
    },
  };
  var fakeAdapter = {
    createToolServer: function(def) {
      return { name: def.name, tools: def.tools };
    },
  };
  var attached = spawnModule.attachSessionSpawn({
    sm: sm,
    getSdk: function() { return sdk; },
    isMate: false,
    adapters: { claude: fakeAdapter },
    getLinuxUserForSession: function() { return "clay-owner-1"; },
  });
  var server = attached.createMcpServer(fakeAdapter, parent);
  var spawnTool = server.tools.filter(function(tool) { return tool.name === "spawn_sessions"; })[0];
  var specs = [];
  for (var i = 0; i < 5; i++) specs.push({ title: "Task " + (i + 1), prompt: "Prompt " + (i + 1) });
  var response = await spawnTool.handler({ sessions: JSON.stringify(specs) });
  var result = JSON.parse(response.content[0].text);

  assert.strictEqual(result.spawned.length, 5);
  assert.strictEqual(result.running, 3);
  assert.strictEqual(result.queued, 2);
  assert.strictEqual(starts.length, 3);
  assert.strictEqual(broadcasts, 1);
  assert.strictEqual(sessions.get(2).ownerId, "owner-1");
  assert.strictEqual(sessions.get(2).sessionVisibility, "private");
  assert.strictEqual(starts[0].linuxUser, "clay-owner-1");

  starts[0].session.isProcessing = false;
  starts[0].session.onQueryComplete(starts[0].session);
  assert.strictEqual(starts.length, 4);
  assert.strictEqual(starts[0].session.singleTurn, undefined);
  assert.strictEqual(starts[0].session.onQueryComplete, undefined);
});

test("an unbound tool server fails closed instead of guessing the caller", async function() {
  var fakeAdapter = {
    createToolServer: function(def) { return { name: def.name, tools: def.tools }; },
  };
  var attached = spawnModule.attachSessionSpawn({
    sm: { sessions: new Map() },
    getSdk: function() { return null; },
    isMate: false,
    adapters: { claude: fakeAdapter },
    getLinuxUserForSession: function() { return null; },
  });
  // No boundSession: this is the static descriptor-listing instance.
  var server = attached.createMcpServer(fakeAdapter);
  var spawnTool = server.tools[0];
  var response = await spawnTool.handler({ sessions: '[{"prompt":"x"}]' });
  assert.strictEqual(response.isError, true);
  assert.ok(response.content[0].text.indexOf("session-bound") !== -1);
});

test("a bound child session is depth-guarded even while another session is viewed", async function() {
  var child = { localId: 9, spawn: { parentId: 1 }, history: [] };
  var fakeAdapter = {
    createToolServer: function(def) { return { name: def.name, tools: def.tools }; },
  };
  var attached = spawnModule.attachSessionSpawn({
    sm: { sessions: new Map([[9, child]]) },
    getSdk: function() { return null; },
    isMate: false,
    adapters: { claude: fakeAdapter },
    getLinuxUserForSession: function() { return null; },
  });
  // The tool server is bound to the child itself, so the guard checks the
  // child regardless of which session the user currently has open.
  var server = attached.createMcpServer(fakeAdapter, child);
  var spawnTool = server.tools[0];
  var response = await spawnTool.handler({ sessions: '[{"prompt":"x"}]' });
  assert.strictEqual(response.isError, true);
  assert.ok(response.content[0].text.indexOf("cannot spawn further") !== -1);
});

test("forkFromCurrent gives each child its own inherited history", async function() {
  var fixture = createForkFixture();
  var response = await fixture.spawn({
    sessions: JSON.stringify([
      { title: "Pine A", prompt: "Analyze area A" },
      { title: "Pine B", prompt: "Analyze area B" },
    ]),
    forkFromCurrent: true,
  });
  var result = JSON.parse(response.content[0].text);
  var first = fixture.sessions.get(result.spawned[0].localId);
  var second = fixture.sessions.get(result.spawned[1].localId);

  assert.strictEqual(first.cliSessionId, "cli-fork-1");
  assert.strictEqual(second.cliSessionId, "cli-fork-2");
  assert.notStrictEqual(first.history, fixture.parent.history);
  assert.notStrictEqual(second.history, fixture.parent.history);
  assert.deepStrictEqual(first.history.slice(0, -1), fixture.parent.history);
  assert.deepStrictEqual(second.history.slice(0, -1), fixture.parent.history);
  assert.deepStrictEqual(first.history[first.history.length - 1], { type: "user_message", text: "Analyze area A" });
  assert.deepStrictEqual(second.history[second.history.length - 1], { type: "user_message", text: "Analyze area B" });
  assert.deepStrictEqual(first.messageUUIDs, fixture.parent.messageUUIDs);
  assert.deepStrictEqual(fixture.forks.map(function(call) { return call.uuid; }), ["uuid-assistant", "uuid-assistant"]);
});

test("forkFromCurrent restores Claude CLI history before the task prompt", async function() {
  var cliHistory = [
    { type: "user_message", text: "Inherited from CLI" },
    { type: "message_uuid", uuid: "cli-uuid", messageType: "user" },
  ];
  var fixture = createForkFixture({
    forkSession: function() {
      return Promise.resolve({ sessionId: "cli-fork-1", useLocalHistory: false });
    },
    readCliSessionHistory: function(home, cwd, sessionId) {
      assert.strictEqual(cwd, process.cwd());
      assert.strictEqual(sessionId, "cli-fork-1");
      return Promise.resolve(cliHistory);
    },
  });
  var response = await fixture.spawn({
    sessions: '[{"title":"CLI fork","prompt":"New task"}]',
    forkFromCurrent: true,
  });
  var result = JSON.parse(response.content[0].text);
  var child = fixture.sessions.get(result.spawned[0].localId);
  assert.notStrictEqual(child.history, cliHistory);
  assert.deepStrictEqual(child.history, cliHistory.concat([{ type: "user_message", text: "New task" }]));
  assert.deepStrictEqual(child.messageUUIDs, [{ uuid: "cli-uuid", type: "user", historyIndex: 1, turnId: null }]);
});

test("forkFromCurrent rejects a parent without a completed turn", async function() {
  var fixture = createForkFixture({ parent: { cliSessionId: null } });
  var response = await fixture.spawn({ sessions: '[{"prompt":"Task"}]', forkFromCurrent: true });
  assert.strictEqual(response.isError, true);
  assert.strictEqual(response.content[0].text, "Error: forkFromCurrent requires the calling session to have at least one completed turn");
  assert.strictEqual(fixture.sessions.size, 1);
  assert.strictEqual(fixture.forks.length, 0);
});

test("forkFromCurrent requires a fork-capable vendor", async function() {
  var fixture = createForkFixture({ capabilitiesByVendor: { claude: { fork: false } } });
  var response = await fixture.spawn({ sessions: '[{"prompt":"Task"}]', forkFromCurrent: true });
  assert.strictEqual(response.isError, true);
  assert.strictEqual(response.content[0].text, "Error: forkFromCurrent is not supported by vendor: claude");
  assert.strictEqual(fixture.sessions.size, 1);
  assert.strictEqual(fixture.forks.length, 0);
});

test("forkFromCurrent locks children to the parent vendor", async function() {
  var fixture = createForkFixture({
    capabilitiesByVendor: { claude: { fork: true }, codex: { fork: true } },
    adapters: { claude: {}, codex: {} },
  });
  var response = await fixture.spawn({
    sessions: '[{"prompt":"Task"}]',
    vendor: "codex",
    forkFromCurrent: true,
  });
  assert.strictEqual(response.isError, true);
  assert.strictEqual(response.content[0].text, "Error: forkFromCurrent children must use the parent's vendor");
  assert.strictEqual(fixture.sessions.size, 1);
  assert.strictEqual(fixture.forks.length, 0);
});

test("forkFromCurrent reports a partial result and queues only successful forks", async function() {
  var fixture = createForkFixture({
    forkSession: function(session, uuid, count) {
      if (count === 2) return Promise.reject(new Error("fork two failed"));
      return Promise.resolve({ sessionId: "cli-fork-" + count, useLocalHistory: true });
    },
  });
  var response = await fixture.spawn({
    sessions: JSON.stringify([
      { title: "One", prompt: "Task one" },
      { title: "Two", prompt: "Task two" },
      { title: "Three", prompt: "Task three" },
    ]),
    forkFromCurrent: true,
  });
  var result = JSON.parse(response.content[0].text);
  assert.strictEqual(result.spawned.length, 1);
  assert.deepStrictEqual(result.failed, { index: 1, error: "fork two failed" });
  assert.strictEqual(result.running, 1);
  assert.strictEqual(result.queued, 0);
  assert.strictEqual(fixture.starts.length, 1);
  assert.strictEqual(fixture.sessions.size, 2);
  assert.strictEqual(fixture.broadcasts, 1);
});

test("session spawn rejects an unknown vendor", function() {
  assert.throws(function() {
    spawnModule.validateVendor("unknown", { claude: {} }, null, yoke.getVendorInfo);
  }, { message: "vendor is not available: unknown" });
});

test("session spawn rejects non-isolating vendor for isolated user", function() {
  assert.strictEqual(yoke.getVendorInfo("kiro").osUserIsolation, false);
  assert.throws(function() {
    spawnModule.validateVendor("kiro", { kiro: {} }, "alice", yoke.getVendorInfo);
  }, { message: "Kiro CLI is not available for OS-isolated users" });
});
