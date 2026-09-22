var test = require("node:test");
var assert = require("node:assert");
var childProcess = require("node:child_process");
var http = require("node:http");
var path = require("node:path");
var readline = require("node:readline");

var attachHTTP = require("../lib/project-http").attachHTTP;
var handoffModule = require("../lib/project-session-handoff");
var permissionsModule = require("../lib/users-permissions");

function session(id, ownerId, visibility, text) {
  return {
    localId: id,
    ownerId: ownerId,
    sessionVisibility: visibility || "private",
    title: "Driver " + id,
    vendor: "claude",
    createdAt: id,
    lastActivity: id,
    history: text ? [{ type: "user_message", text: text, _ts: id }] : [],
  };
}

function payload(result) {
  return JSON.parse(result.content[0].text);
}

function findTool(attached, actor, name, generation) {
  var tools = attached.getToolDefs(actor, generation);
  return tools.filter(function (tool) { return tool.name === name; })[0];
}

function fixture() {
  var users = [{ id: "reader", role: "user" }, { id: "owner", role: "user" }, { id: "outsider", role: "user" }];
  function findUserById(userId) {
    return users.filter(function (user) { return user.id === userId; })[0] || null;
  }
  var permissions = permissionsModule.attachPermissions({
    loadUsers: function () { return { users: users }; },
    saveUsers: function () {},
    findUserById: findUserById,
  });
  var actor = session(1, "reader", "private", "actor context");
  actor._sdkQueryGeneration = 1;
  var shared = session(2, "owner", "shared", "shared recovery target");
  var privateOther = session(3, "owner", "private", "private recovery target");
  var outsider = session(4, "outsider", "shared", "outsider recovery target");
  var worker = session(5, "owner", "shared", "worker recovery target");
  worker.sessionProvenance = { kind: "worker" };
  var background = session(6, "owner", "shared", "scheduled recovery target");
  background.hidden = true;
  background.scheduledTaskRun = { role: "driver", status: "completed" };
  var mate = session(7, "owner", "shared", "mate recovery target");
  mate.isMate = true;
  var autonomous = session(8, "owner", "shared", "finished autonomous recovery target");
  autonomous.autonomousRun = { state: "complete", id: "finished-run" };
  var reviewer = session(9, "owner", "shared", "reviewer recovery target");
  reviewer.hidden = true;
  reviewer.projectLogReview = { ref: "log:example" };
  var sessions = new Map([
    [1, actor], [2, shared], [3, privateOther], [4, outsider],
    [5, worker], [6, background], [7, mate], [8, autonomous], [9, reviewer],
  ]);
  var projectAccess = { visibility: "private", ownerId: "owner", allowedUsers: ["reader"] };
  var attached = handoffModule.attachSessionHandoff({
    sm: { sessions: sessions },
    isMate: false,
    projectSlug: "clay",
    isMultiUser: function () { return true; },
    getProjectAccess: function () { return projectAccess; },
    findUserById: findUserById,
    canAccessSession: permissions.canAccessSession,
    isDriverOperatedSession: function (candidate) { return candidate.driverOperated === true; },
  });
  return {
    actor: actor,
    attached: attached,
    projectAccess: projectAccess,
    sessions: sessions,
    users: users,
  };
}

test("real permissions expose only same-project visible Driver sessions", async function () {
  var f = fixture();
  var result = payload(await findTool(f.attached, f.actor, "list_other_driver_sessions").handler({}));
  assert.deepStrictEqual(result.sessions.map(function (item) { return item.title; }), ["Driver 8", "Driver 4", "Driver 2"]);
  assert.strictEqual(result.crossProject, false);
  assert.match(result.limitation, /this project/);
});

test("live actor, project, current-session, and candidate authorization are rechecked", async function () {
  var f = fixture();
  var list = findTool(f.attached, f.actor, "list_other_driver_sessions");
  f.sessions.get(2).sessionVisibility = "private";
  assert.deepStrictEqual(payload(await list.handler({})).sessions.map(function (item) { return item.title; }), ["Driver 8", "Driver 4"]);
  f.projectAccess.allowedUsers = [];
  assert.strictEqual((await list.handler({})).isError, true);

  var fresh = fixture();
  var freshList = findTool(fresh.attached, fresh.actor, "list_other_driver_sessions");
  fresh.users.splice(0, 1);
  assert.strictEqual((await freshList.handler({})).isError, true, "a deleted actor must fail before users-permissions owner access");

  var replaced = fixture();
  var replacedList = findTool(replaced.attached, replaced.actor, "list_other_driver_sessions");
  replaced.sessions.set(replaced.actor.localId, Object.assign({}, replaced.actor));
  assert.strictEqual((await replacedList.handler({})).isError, true);
});

test("Workers, hidden scheduled/reviewer sessions, Mates, and delegated panes cannot call discovery", function () {
  var f = fixture();
  assert.deepStrictEqual(f.attached.getToolDefs(f.sessions.get(5)), []);
  assert.deepStrictEqual(f.attached.getToolDefs(f.sessions.get(6)), []);
  assert.deepStrictEqual(f.attached.getToolDefs(f.sessions.get(7)), []);
  assert.deepStrictEqual(f.attached.getToolDefs(f.sessions.get(9)), []);
  f.actor.delegated = true;
  assert.deepStrictEqual(f.attached.getToolDefs(f.actor), []);
  f.actor.delegated = false;
  f.actor.driverOperated = true;
  assert.deepStrictEqual(f.attached.getToolDefs(f.actor), []);
});

test("a visible human Driver remains eligible after Until complete finishes", async function () {
  var f = fixture();
  var finished = f.sessions.get(8);
  assert.deepStrictEqual(f.attached.getToolDefs(finished).map(function (tool) { return tool.name; }), [
    "list_other_driver_sessions", "search_other_driver_sessions", "read_other_driver_session",
  ]);
  var listed = payload(await findTool(f.attached, f.actor, "list_other_driver_sessions").handler({}));
  assert.ok(listed.sessions.some(function (item) { return item.title === "Driver 8"; }));
});

test("opaque reads stay in the current project and expose no global reader", async function () {
  var f = fixture();
  var names = f.attached.getToolDefs(f.actor).map(function (tool) { return tool.name; });
  assert.deepStrictEqual(names, ["list_other_driver_sessions", "search_other_driver_sessions", "read_other_driver_session"]);
  var denied = await findTool(f.attached, f.actor, "read_other_driver_session").handler({ sessionRef: "session:foreign-project-source" });
  assert.strictEqual(denied.isError, true);
  assert.match(denied.content[0].text, /not found or not shared/);
});

test("200-session listing enforces final serialized per-call, aggregate, and call-count caps", async function () {
  var f = fixture();
  for (var i = 10; i < 210; i++) {
    f.sessions.set(i, session(i, "owner", "shared", "needle " + String(i).padEnd(1200, "x")));
  }
  var total = 0;
  var result;
  for (var call = 0; call < 8; call++) {
    var tool = findTool(f.attached, f.actor, "list_other_driver_sessions", 1);
    result = await tool.handler({});
    var size = JSON.stringify(result).length;
    assert.ok(size <= 15000, "serialized response exceeds the per-call cap");
    if (result.isError) {
      assert.match(result.content[0].text, /budget exhausted/);
      continue;
    }
    total += size;
    assert.ok(total <= 32000, "serialized responses exceed the aggregate cap");
    assert.strictEqual(payload(result).budget.usedChars, total);
  }
  var refused = await findTool(f.attached, f.actor, "list_other_driver_sessions", 1).handler({});
  assert.strictEqual(refused.isError, true);
  assert.match(refused.content[0].text, /budget exhausted/);
  assert.ok(JSON.stringify(refused).length < 150);
});

test("legacy headers and the MCP response wrapper count in the shared aggregate", async function () {
  var f = fixture();
  f.actor.handoff = { sourceSessionId: 2 };
  var legacy = await findTool(f.attached, f.actor, "read_handoff_source").handler({ offset: 0, limit: 1 });
  var legacySize = JSON.stringify(legacy).length;
  assert.match(legacy.content[0].text, /Showing entries/);
  var listed = await findTool(f.attached, f.actor, "list_other_driver_sessions").handler({});
  assert.strictEqual(payload(listed).budget.usedChars, legacySize + JSON.stringify(listed).length);
});

test("empty and error calls count toward the eight-call query limit", async function () {
  var f = fixture();
  var tool = findTool(f.attached, f.actor, "search_other_driver_sessions");
  for (var i = 0; i < 8; i++) {
    var invalid = await tool.handler({ query: "" });
    assert.strictEqual(invalid.isError, true);
    assert.match(invalid.content[0].text, /keyword query/);
  }
  var refused = await tool.handler({ query: "recovery" });
  assert.match(refused.content[0].text, /budget exhausted/);
});

test("per-call truncation preserves the query budget for later unseen entries", async function () {
  var f = fixture();
  var history = [];
  for (var i = 0; i < 40; i++) history.push({ type: "user_message", text: "wide " + String(i).padEnd(1200, "x"), _ts: i + 1 });
  var source = session(20, "owner", "shared");
  source.history = history;
  f.sessions.set(20, source);
  var tool = findTool(f.attached, f.actor, "search_other_driver_sessions");
  var first = payload(await tool.handler({ query: "wide" }));
  var second = payload(await tool.handler({ query: "wide" }));
  assert.ok(first.results.length > 0 && first.results.length < 20);
  assert.ok(second.results.length > 0);
  assert.ok(second.results[0].entryIndex > first.results[first.results.length - 1].entryIndex);
});

test("search, targeted reads, and legacy reads share durable entry deduplication", async function () {
  var f = fixture();
  var source = f.sessions.get(2);
  source.history = [
    { type: "user_message", text: "needle zero", _ts: 1 },
    { type: "delta", text: "one", _ts: 2 },
    { type: "user_message", text: "two", _ts: 3 },
    { type: "delta", text: "three", _ts: 4 },
    { type: "user_message", text: "four", _ts: 5 },
  ];
  f.actor.handoff = { sourceSessionId: 2 };
  var search = findTool(f.attached, f.actor, "search_other_driver_sessions");
  var found = payload(await search.handler({ query: "needle" }));
  assert.deepStrictEqual(found.results.map(function (item) { return item.entryIndex; }), [0]);
  var read = findTool(f.attached, f.actor, "read_other_driver_session");
  var window = payload(await read.handler({ sessionRef: found.results[0].sessionRef, offset: 0, limit: 5 }));
  assert.deepStrictEqual(window.excerpts.map(function (item) { return item.entryIndex; }), [1, 2, 3, 4]);
  var legacy = await findTool(f.attached, f.actor, "read_handoff_source").handler({ offset: 0, limit: 5 });
  assert.doesNotMatch(legacy.content[0].text, /needle zero|\[ASSISTANT\] one|\[USER\] two|\[ASSISTANT\] three|\[USER\] four/);
});

test("tool recreation shares a query budget and stale closures cannot reset it", async function () {
  var f = fixture();
  var calls = [];
  var adapter = { createToolServer: function (config) { calls.push(config); return config; } };
  f.attached.createMcpServer(adapter, f.actor);
  f.attached.createMcpServer(adapter, f.actor);
  var first = calls[0].tools.filter(function (tool) { return tool.name === "search_other_driver_sessions"; })[0];
  var second = calls[1].tools.filter(function (tool) { return tool.name === "search_other_driver_sessions"; })[0];
  assert.ok(payload(await first.handler({ query: "recovery" })).results.length > 0);
  assert.strictEqual(payload(await second.handler({ query: "recovery" })).results.length, 0);
  f.actor._sdkQueryGeneration = 2;
  var stale = await first.handler({ query: "recovery" });
  assert.strictEqual(stale.isError, true);
  assert.match(stale.content[0].text, /older query/);
  assert.ok(payload(await findTool(f.attached, f.actor, "search_other_driver_sessions", 2).handler({ query: "recovery" })).results.length > 0);
});

test("an unversioned closure becomes stale when a real query generation appears", async function () {
  var f = fixture();
  delete f.actor._sdkQueryGeneration;
  var unversioned = findTool(f.attached, f.actor, "list_other_driver_sessions");
  assert.strictEqual((await unversioned.handler({})).isError, undefined);
  f.actor._sdkQueryGeneration = 1;
  var stale = await unversioned.handler({});
  assert.strictEqual(stale.isError, true);
  assert.match(stale.content[0].text, /older query/);
});

test("actual stdio bridge rejects a stale endpoint and regenerates current tools", { timeout: 15000 }, async function (t) {
  var f = fixture();
  function getMcpBridgeHandler(sessionId, sessionOnly, generation) {
    return {
      listTools: function () {
        if (sessionId !== f.actor.localId || generation !== f.actor._sdkQueryGeneration) return Promise.resolve([]);
        return Promise.resolve(f.attached.getToolDefs(f.actor, generation).map(function (tool) {
          return { server: "clay-handoff", name: tool.name, description: tool.description, inputSchema: tool.inputSchema };
        }));
      },
      callTool: function (server, name, args) {
        if (sessionId !== f.actor.localId || generation !== f.actor._sdkQueryGeneration) return Promise.reject(new Error("Session tool unavailable or older query"));
        var tool = findTool(f.attached, f.actor, name, generation);
        return tool ? tool.handler(args || {}) : Promise.reject(new Error("Session tool not found"));
      },
    };
  }
  var route = attachHTTP({ cwd: process.cwd(), slug: "clay", project: "Clay", getMcpBridgeHandler: getMcpBridgeHandler }).handleHTTP;
  var server = http.createServer(function (req, res) { route(req, res, "/api/mcp-bridge"); });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { server.closeAllConnections(); server.close(); });

  var bridgePath = path.join(__dirname, "..", "lib", "yoke", "mcp-bridge-server.js");
  function bridge(generation) {
    var proc = childProcess.spawn(process.execPath, [bridgePath, "--port", String(server.address().port), "--slug", "clay", "--session", "1", "--query-generation", String(generation), "--session-only"], { stdio: ["pipe", "pipe", "ignore"] });
    t.after(function () { if (!proc.killed) proc.kill(); });
    var lines = readline.createInterface({ input: proc.stdout });
    var pending = new Map();
    lines.on("line", function (line) {
      var message = JSON.parse(line);
      if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
    });
    return function (id, method, params) {
      return new Promise(function (resolve) {
        pending.set(id, resolve);
        proc.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params || {} }) + "\n");
      });
    };
  }
  var oldRequest = bridge(1);
  await oldRequest(1, "initialize", {});
  var oldCatalog = await oldRequest(2, "tools/list", {});
  assert.ok(oldCatalog.result.tools.some(function (tool) { return tool.name === "clay-handoff__list_other_driver_sessions"; }));
  f.actor._sdkQueryGeneration = 2;
  var stale = await oldRequest(3, "tools/call", { name: "clay-handoff__list_other_driver_sessions", arguments: {} });
  assert.strictEqual(stale.result.isError, true);
  assert.match(stale.result.content[0].text, /older query/);

  var newRequest = bridge(2);
  await newRequest(4, "initialize", {});
  var newCatalog = await newRequest(5, "tools/list", {});
  assert.ok(newCatalog.result.tools.some(function (tool) { return tool.name === "clay-handoff__search_other_driver_sessions"; }));
  var current = await newRequest(6, "tools/call", { name: "clay-handoff__search_other_driver_sessions", arguments: { query: "recovery" } });
  assert.strictEqual(current.result.isError, undefined);
  assert.ok(payload(current.result).results.length > 0);
});
