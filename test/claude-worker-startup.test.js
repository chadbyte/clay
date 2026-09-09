var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var vm = require("node:vm");
var EventEmitter = require("node:events");

function loadWorker(relativePath) {
  var socket = new EventEmitter();
  var sent = [];
  socket.write = function(line) {
    var message = JSON.parse(line);
    sent.push(message);
    socket.emit("daemon_message", message);
  };
  var filename = path.join(__dirname, "..", relativePath);
  var context = vm.createContext({
    require: function(name) {
      if (name === "net") return { connect: function() { return socket; } };
      if (name === "fs") return { writeSync: function() {}, existsSync: function() { return false; } };
      if (name === "child_process") return { execSync: function() { throw new Error("No CLI in test"); } };
      return require(name);
    },
    __dirname: path.dirname(filename),
    process: { env: {}, argv: ["node", filename, "/test.sock"], pid: 1, on: function() {} },
    console: { log: function() {}, error: function() {} },
    AbortController: AbortController,
    setInterval: function() {},
    clearInterval: function() {},
    setTimeout: setTimeout,
  });
  vm.runInContext(fs.readFileSync(filename, "utf8"), context, { filename: filename });
  var resolveSDK;
  var rejectSDK;
  context.sdkModule = new Promise(function(resolve, reject) {
    resolveSDK = resolve;
    rejectSDK = reject;
  });
  var received = [];
  var signal;
  var sdk = {
    query: function(args) {
      signal = args.options.abortController.signal;
      return (async function*() {
        for await (var message of args.prompt) {
          received.push(message);
          yield { type: "assistant", message: message };
        }
      })();
    },
  };
  return {
    context: context,
    sent: sent,
    received: received,
    ready: function() { resolveSDK(sdk); },
    fail: function() { rejectSDK(new Error("SDK unavailable")); },
    signal: function() { return signal; },
    send: function(message) { socket.emit("data", Buffer.from(JSON.stringify(message) + "\n")); },
    sendBatch: function(messages) {
      socket.emit("data", Buffer.from(messages.map(function(message) {
        return JSON.stringify(message) + "\n";
      }).join("")));
    },
    done: function() {
      return new Promise(function(resolve, reject) {
        socket.on("daemon_message", function(message) {
          if (message.type === "query_done") resolve();
          if (message.type === "query_error") reject(new Error(message.error));
        });
      });
    },
  };
}

["lib/yoke/adapters/claude-worker.js"].forEach(function(workerPath) {
  test(workerPath + ": handles query start and first input in one socket chunk", { timeout: 1000 }, async function() {
    var worker = loadWorker(workerPath);
    var done = worker.done();
    worker.sendBatch([
      { type: "query_start", options: {} },
      { type: "push_message", content: "first message" },
      { type: "end_messages" },
    ]);
    worker.ready();
    await done;
    assert.deepEqual(worker.received, ["first message"]);
  });

  test(workerPath + ": preserves the first prompt while SDK loading is pending", async function() {
    var worker = loadWorker(workerPath);
    var run = worker.context.handleQueryStart({ options: {}, singleTurn: true });
    worker.send({ type: "push_message", content: { type: "user", message: { role: "user", content: "first" } } });
    worker.ready();
    await run;
    assert.equal(worker.received.length, 1, "first message must reach SDK without a second send");
    assert.equal(worker.received[0].message.content, "first");
    assert.equal(worker.sent.at(-1).type, "query_done");
  });

  test(workerPath + ": preserves ordered messages and end during startup", async function() {
    var worker = loadWorker(workerPath);
    var run = worker.context.handleQueryStart({ options: {}, prompt: "initial" });
    worker.send({ type: "push_message", content: "first" });
    worker.send({ type: "push_message", content: "second" });
    worker.send({ type: "end_messages" });
    worker.ready();
    await run;
    assert.deepEqual(worker.received, ["initial", "first", "second"]);
    // A reused worker must allocate its next queue before even a cached SDK await.
    run = worker.context.handleQueryStart({ options: {}, singleTurn: true });
    worker.send({ type: "push_message", content: "next turn" });
    await run;
    assert.deepEqual(worker.received, ["initial", "first", "second", "next turn"]);
  });

  test(workerPath + ": retains Stop received during SDK loading", async function() {
    var worker = loadWorker(workerPath);
    var run = worker.context.handleQueryStart({ options: {}, singleTurn: true });
    worker.send({ type: "abort" });
    worker.ready();
    await run;
    assert.equal(worker.signal(), undefined, "cancelled startup must not invoke the SDK");
    assert.equal(worker.sent.at(-1).type, "query_done");
    assert.equal(worker.context.messageQueue, null);
    assert.equal(worker.context.abortController, null);
  });

  test(workerPath + ": releases startup state if SDK loading fails", async function() {
    var worker = loadWorker(workerPath);
    var run = worker.context.handleQueryStart({ options: {} });
    worker.send({ type: "push_message", content: "first" });
    worker.fail();
    await run;
    assert.equal(worker.sent.at(-1).type, "query_error");
    assert.match(worker.sent.at(-1).error, /SDK unavailable/);
    assert.equal(worker.context.messageQueue, null);
    assert.equal(worker.context.abortController, null);
  });
});
