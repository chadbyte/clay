var test = require("node:test");
var assert = require("node:assert");
var EventEmitter = require("node:events");

var { createKiroAdapter } = require("../lib/yoke/adapters/kiro");
var yoke = require("../lib/yoke");

function createHarness(outcomes) {
  var instances = [];

  function FakeAcpServer(binaryPath, options) {
    var proc = new EventEmitter();
    proc.exitCode = null;
    proc.signalCode = null;
    proc.kills = [];
    proc.kill = function(signal) {
      proc.kills.push(signal);
      proc.exitCode = 0;
      proc.emit("exit", 0, signal);
      return true;
    };

    this.proc = proc;
    this.options = options;
    this.started = false;
    this.index = instances.length;
    instances.push(this);
  }

  FakeAcpServer.prototype.start = function() {
    this.started = true;
    return Promise.resolve();
  };

  FakeAcpServer.prototype.send = function(method) {
    assert.strictEqual(method, "initialize");
    var outcome = outcomes[this.index];
    if (outcome instanceof Error) return Promise.reject(outcome);
    return Promise.resolve(outcome || { protocolVersion: 1 });
  };

  FakeAcpServer.prototype.addRequestHandler = function(method, fn) {
    this.requestHandlerMethod = method;
    this.requestHandler = fn;
  };

  FakeAcpServer.prototype.stop = function() {
    this.started = false;
    this.proc.kill("SIGTERM");
  };

  function createAdapter() {
    return createKiroAdapter({
      cwd: process.cwd(),
      _binaryPath: "/fake/kiro-cli",
      _AcpServerCtor: FakeAcpServer,
      _fetchModels: function() {
        return Promise.resolve({ models: ["auto"], defaultModel: "auto" });
      },
    });
  }

  return { instances: instances, createAdapter: createAdapter };
}

test("a failed init does not poison the next retry", async function() {
  var harness = createHarness([new Error("handshake failed"), null]);
  var adapter = harness.createAdapter();
  var firstAttempt = adapter.init();

  await assert.rejects(firstAttempt, /handshake failed/);

  var secondAttempt = adapter.init();
  assert.notStrictEqual(secondAttempt, firstAttempt);
  await secondAttempt;
  assert.strictEqual(harness.instances.length, 2);
});

test("Kiro forwards the scoped environment to its ACP process", async function() {
  var harness = createHarness([null]);
  var adapter = harness.createAdapter();
  await adapter.init({ env: { PROJECT_TOKEN: "scoped" } });
  assert.strictEqual(harness.instances[0].options.env.PROJECT_TOKEN, "scoped");
  await adapter.shutdown();
});

test("a failed init stops the spawned ACP child", async function() {
  var harness = createHarness([new Error("initialize timeout")]);
  var adapter = harness.createAdapter();

  await assert.rejects(adapter.init(), /initialize timeout/);

  assert.strictEqual(harness.instances.length, 1);
  assert.deepStrictEqual(harness.instances[0].proc.kills, ["SIGTERM"]);
  assert.strictEqual(harness.instances[0].started, false);
});

test("a started child without a completed handshake is not reported ready", async function() {
  var harness = createHarness([new Error("protocol mismatch"), { protocolVersion: 1 }]);
  var adapter = harness.createAdapter();

  await assert.rejects(adapter.init(), /protocol mismatch/);
  var ready = await adapter.init();

  assert.strictEqual(harness.instances.length, 2, "init must spawn a fresh child after handshake failure");
  assert.deepStrictEqual(ready.models, ["auto"]);
});

test("idle reclaim works after an init failure and successful retry", async function() {
  var harness = createHarness([new Error("logged out"), null]);
  var adapter = harness.createAdapter();

  await assert.rejects(adapter.init(), /logged out/);
  await adapter.init();
  await new Promise(function(resolve) { setTimeout(resolve, 5); });

  var reclaimed = await adapter.shutdownIfIdle(0);
  assert.strictEqual(reclaimed, true);
  assert.deepStrictEqual(harness.instances[1].proc.kills, ["SIGTERM"]);
});

test("lazy creation refuses Kiro for an OS-isolated user", async function() {
  var adapters = {};
  var result = await yoke.lazyCreateAdapter(adapters, "kiro", {
    cwd: process.cwd(),
    linuxUser: "clay-user",
  });

  assert.strictEqual(result, null);
  assert.deepStrictEqual(adapters, {});
});

[2, undefined, "1"].forEach(function(version) {
  test("Kiro refuses an unsupported or missing negotiated protocol: " + version, async function() {
    var harness=createHarness([{protocolVersion:version}]);var adapter=harness.createAdapter();
    await assert.rejects(adapter.init(), /requires protocol 1/);assert.strictEqual(harness.instances[0].started,false);
  });
});
