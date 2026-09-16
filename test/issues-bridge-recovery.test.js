var test = require("node:test");
var assert = require("node:assert/strict");
var http = require("node:http");
var path = require("node:path");
var spawn = require("node:child_process").spawn;
var readline = require("node:readline");
var yoke = require("../lib/yoke");
var CodexAppServer = require("../lib/yoke/codex-app-server").CodexAppServer;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;

test("project factory retains authenticated TLS bridge defaults through recovery and restart", async function (t) {
  var servers = [];
  t.mock.method(CodexAppServer.prototype, "start", function () {
    this.started = true; servers.push(this); return Promise.resolve();
  });
  t.mock.method(CodexAppServer.prototype, "send", function () { return Promise.resolve({ data: [] }); });
  t.mock.method(CodexAppServer.prototype, "stop", function () { this.started = false; });
  var adapter = yoke.createAdapters({
    cwd: process.cwd(), slug: "recovery-fixture", _installed: { codex: true },
    clayPort: 3888, clayTls: true, clayAuthToken: "relay-fixture", clayBridgeToken: "bridge-fixture",
  }).adapters.codex;
  t.after(function () { return adapter.shutdown(); });
  await adapter.init({});
  var recovery = {
    name: "clay-session-tools", command: process.execPath,
    args: ["bridge.js", "--tls", "--session", "7", "--query-generation", "3"],
    env: { CLAY_BRIDGE_TOKEN: "bridge-fixture" },
  };
  var handle = await adapter.createQuery({ cwd: process.cwd(), resumeSessionId: "saved-thread", sessionMcpServer: recovery });
  assert.equal(servers.length, 2);
  assert.deepEqual(servers[1].opts.config.mcp_servers[recovery.name], {
    command: recovery.command, args: recovery.args, env: recovery.env,
  });
  handle.abort();
  await adapter.shutdown();
  await adapter.init({});
  assert.equal(servers.length, 3);
  servers.forEach(function (server) {
    var bridge = server.opts.config.mcp_servers["clay-tools"];
    assert.deepEqual(bridge.args.slice(1), ["--port", "3888", "--slug", "recovery-fixture", "--tls"]);
    assert.deepEqual(bridge.env, { CLAY_AUTH_TOKEN: "relay-fixture", CLAY_BRIDGE_TOKEN: "bridge-fixture" });
  });
});

test("SDK warmup forwards the project bridge capability", async function () {
  var received;
  var adapter = { vendor: "codex", init: function (options) {
    received = options; return Promise.resolve({ models: [] });
  } };
  var bridge = createSDKBridge({
    cwd: process.cwd(), slug: "warmup-fixture", clayPort: 3888, clayTls: true,
    clayBridgeToken: "warmup-capability", adapter: adapter, adapters: { codex: adapter },
    sessionManager: {}, send: function () {},
  });
  await bridge.warmup();
  assert.equal(received.clayBridgeToken, "warmup-capability");
  assert.equal(received.clayTls, true);
  assert.equal(received.clayPort, 3888);
});

test("stdio discovery surfaces HTTP failures and retries with its bound capability", { timeout: 15000 }, async function (t) {
  var status = 302;
  var seen = [];
  var server = http.createServer(function (req, res) {
    var chunks = [];
    req.on("data", function (chunk) { chunks.push(chunk); });
    req.on("end", function () {
      seen.push({ url: req.url, token: req.headers["x-clay-bridge-token"], body: JSON.parse(Buffer.concat(chunks)) });
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify(status === 200 ? { tools: [{ server: "clay-issues", name: "read_issue", description: "Read", inputSchema: { type: "object" } }] } : { error: "fixture denied" }));
    });
  });
  await new Promise(function (resolve) { server.listen(0, "127.0.0.1", resolve); });
  t.after(function () { server.closeAllConnections(); server.close(); });
  var child = spawn(process.execPath, [path.join(__dirname, "../lib/yoke/mcp-bridge-server.js"),
    "--port", String(server.address().port), "--slug", "fixture", "--session", "7", "--query-generation", "3", "--session-only"], {
    env: Object.assign({}, process.env, { CLAY_BRIDGE_TOKEN: "stdio-capability" }), stdio: ["pipe", "pipe", "ignore"],
  });
  t.after(function () { child.kill(); });
  var lines = readline.createInterface({ input: child.stdout });
  var pending = new Map();
  lines.on("line", function (line) {
    var message = JSON.parse(line);
    if (pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id); }
  });
  function request(id) {
    return new Promise(function (resolve) {
      pending.set(id, resolve);
      child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: "tools/list", params: {} }) + "\n");
    });
  }
  var redirect = await request(1);
  assert.equal(redirect.error.code, -32001);
  assert.match(redirect.error.message, /HTTP 302/);
  status = 403;
  assert.match((await request(2)).error.message, /HTTP 403/);
  status = 200;
  assert.equal((await request(3)).result.tools[0].name, "clay-issues__read_issue");
  seen.forEach(function (item) {
    assert.equal(item.token, "stdio-capability");
    assert.equal(item.url, "/p/fixture/api/mcp-bridge");
    assert.equal(item.body.sessionId, 7);
    assert.equal(item.body.queryGeneration, 3);
    assert.equal(item.body.sessionOnly, true);
  });
});
