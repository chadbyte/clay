var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var createPolicyBroker = require("../lib/yoke/adapters/claude-worker-policy").createPolicyBroker;

function abortSignal(alreadyAborted) {
  var listener = null;
  return {
    aborted: alreadyAborted === true,
    addEventListener: function (name, fn) { if (name === "abort") listener = fn; },
    removeEventListener: function (name, fn) { if (name === "abort" && listener === fn) listener = null; },
    abort: function () { this.aborted = true; if (listener) listener(); },
  };
}

test("worker policy registers before send so a synchronous response resolves", async function () {
  var broker;
  broker = createPolicyBroker({
    timeoutMs: 20,
    send: function (message) {
      broker.respond({ requestId: message.requestId, result: { behavior: "allow", updatedInput: { safe: true } } });
      return true;
    },
  });
  var result = await broker.request({ requestId: "sync-1" });
  assert.equal(result.behavior, "allow");
  assert.equal(broker.pendingCount(), 0);
});

test("worker policy fails closed on send refusal and send throw", async function () {
  var refused = createPolicyBroker({ send: function () { return false; } });
  var refusedResult = await refused.request({ requestId: "refused-1" });
  assert.equal(refusedResult.behavior, "deny");
  assert.match(refusedResult.message, /unavailable/);
  assert.equal(refused.pendingCount(), 0);

  var thrown = createPolicyBroker({ send: function () { throw new Error("closed"); } });
  var thrownResult = await thrown.request({ requestId: "throw-1" });
  assert.equal(thrownResult.behavior, "deny");
  assert.match(thrownResult.message, /unavailable/);
  assert.equal(thrown.pendingCount(), 0);
});

test("worker policy times out and ignores a late response", async function () {
  var broker = createPolicyBroker({ timeoutMs: 5, send: function () { return true; } });
  var result = await broker.request({ requestId: "timeout-1" });
  assert.equal(result.behavior, "deny");
  assert.match(result.message, /timed out/);
  assert.equal(broker.respond({ requestId: "timeout-1", result: { behavior: "allow" } }), false);
  assert.equal(broker.pendingCount(), 0);
});

test("worker policy handles already-aborted and later-aborted requests without sending", async function () {
  var sends = 0;
  var broker = createPolicyBroker({ timeoutMs: 20, send: function () { sends++; return true; } });
  var already = await broker.request({ requestId: "abort-1" }, abortSignal(true));
  assert.equal(already.behavior, "deny");
  assert.equal(sends, 0);

  var signal = abortSignal(false);
  var pending = broker.request({ requestId: "abort-2" }, signal);
  assert.equal(sends, 1);
  signal.abort();
  var later = await pending;
  assert.equal(later.behavior, "deny");
  assert.match(later.message, /cancelled/);
  assert.equal(broker.pendingCount(), 0);
});

test("worker policy cleanup denies every outstanding request", async function () {
  var broker = createPolicyBroker({ timeoutMs: 50, send: function () { return true; } });
  var first = broker.request({ requestId: "clear-1" });
  var second = broker.request({ requestId: "clear-2" });
  broker.clear("Permission policy query ended.");
  assert.match((await first).message, /query ended/);
  assert.match((await second).message, /query ended/);
  assert.equal(broker.pendingCount(), 0);
});

test("Claude worker wires the broker into guarded hooks and both cleanup paths", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/yoke/adapters/claude-worker.js"), "utf8");
  assert.match(source, /preToolPolicyBroker\.request\(/);
  assert.match(source, /hookOpts && hookOpts\.signal/);
  assert.match(source, /preToolPolicyBroker\.clear\("Permission policy query ended\."\)/);
  assert.match(source, /preToolPolicyBroker\.clear\("Permission policy worker closed\."\)/);
});
