var test = require("node:test");
var assert = require("node:assert/strict");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;

function clock() {
  var now = 0;
  var nextId = 1;
  var timers = new Map();
  var originalSetTimeout = global.setTimeout;
  var originalClearTimeout = global.clearTimeout;
  global.setTimeout = function (fn, delay) {
    var id = nextId++;
    timers.set(id, { at: now + delay, fn: fn });
    return id;
  };
  global.clearTimeout = function (id) { timers.delete(id); };
  return {
    tick: function (duration) {
      var target = now + duration;
      while (true) {
        var selected = null;
        timers.forEach(function (timer, id) {
          if (timer.at <= target && (!selected || timer.at < selected.timer.at)) selected = { id: id, timer: timer };
        });
        if (!selected) break;
        timers.delete(selected.id);
        now = selected.timer.at;
        selected.timer.fn();
      }
      now = target;
    },
    restore: function () {
      global.setTimeout = originalSetTimeout;
      global.clearTimeout = originalClearTimeout;
    }
  };
}

test("lifecycle bounds handshake, increases jittered retries, and resets only after stability", async function () {
  var fake = clock();
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/websocket-lifecycle.js")).href + "?case=retry");
    var timedOut = [];
    var lifecycle = module.createWebSocketLifecycle({
      handshakeTimeoutMs: 12000,
      stableConnectionMs: 15000,
      retryMinMs: 1000,
      retryMaxMs: 10000,
      jitterRatio: 0,
      onHandshakeTimeout: function (epoch) { timedOut.push(epoch); },
      random: function () { return 0.5; }
    });
    var epoch = lifecycle.beginAttempt();
    fake.tick(11999);
    assert.deepEqual(timedOut, []);
    fake.tick(1);
    assert.deepEqual(timedOut, [epoch]);
    lifecycle.schedule("close", function () {});
    assert.equal(lifecycle.getRetryAttempt(), 1);
    lifecycle.invalidate(epoch);
    assert.equal(lifecycle.schedule("close", function () {}).delay, 1500);
    var liveEpoch = lifecycle.beginAttempt();
    lifecycle.markLive(liveEpoch);
    fake.tick(14999);
    assert.equal(lifecycle.getRetryAttempt(), 2);
    fake.tick(1);
    assert.equal(lifecycle.getRetryAttempt(), 0);
  } finally {
    fake.restore();
  }
});

test("cancelled and offline epochs suppress retry and wake without a storm", async function () {
  var fake = clock();
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/websocket-lifecycle.js")).href + "?case=guards");
    var calls = 0;
    var lifecycle = module.createWebSocketLifecycle({ retryMinMs: 1000, jitterRatio: 0 });
    lifecycle.beginAttempt();
    lifecycle.setOffline(true);
    assert.equal(lifecycle.schedule("offline", function () { calls += 1; }), null);
    lifecycle.wake(function () { calls += 1; });
    assert.equal(calls, 1);
    lifecycle.schedule("wake", function () { calls += 1; });
    lifecycle.cancel();
    fake.tick(2000);
    assert.equal(calls, 1);
  } finally {
    fake.restore();
  }
});

test("stale socket epochs cannot mark a newer attempt live", async function () {
  var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/websocket-lifecycle.js")).href + "?case=epoch");
  var lifecycle = module.createWebSocketLifecycle();
  var first = lifecycle.beginAttempt();
  var second = lifecycle.beginAttempt();
  assert.equal(lifecycle.markLive(first), false);
  assert.equal(lifecycle.markLive(second), true);
});

test("jitter never exceeds the configured retry ceiling", async function () {
  var fake = clock();
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/websocket-lifecycle.js")).href + "?case=jitter-cap");
    var lifecycle = module.createWebSocketLifecycle({ retryMinMs: 9000, retryMaxMs: 10000, jitterRatio: 0.5, random: function () { return 1; } });
    var first = lifecycle.schedule("close", function () {});
    assert.ok(first.delay <= 10000);
    lifecycle.clearRetry();
    var second = lifecycle.schedule("close", function () {});
    assert.ok(second.delay <= 10000);
  } finally {
    fake.restore();
  }
});

test("a late timed-out auth result cannot finish a newer auth in the same epoch", async function () {
  var fake = clock();
  try {
    var module = await import(pathToFileURL(path.join(__dirname, "../lib/public/modules/websocket-lifecycle.js")).href + "?case=auth-generation");
    var lifecycle = module.createWebSocketLifecycle({ authTimeoutMs: 100, retryMinMs: 1000, jitterRatio: 0 });
    var epoch = lifecycle.beginAttempt();
    var timedOut = 0;
    var oldToken = lifecycle.beginAuth(epoch, function () { timedOut += 1; }, function () {});
    fake.tick(100);
    assert.equal(timedOut, 1);
    lifecycle.clearRetry();
    var newToken = lifecycle.beginAuth(epoch, function () {}, function () {});
    assert.equal(lifecycle.finishAuth(epoch, oldToken), false, "late resolution from the timed-out request is stale");
    assert.equal(lifecycle.finishAuth(epoch, oldToken), false, "late rejection from the timed-out request is also stale");
    assert.equal(lifecycle.finishAuth(epoch, newToken), true, "the replacement request owns the epoch gate");
  } finally {
    fake.restore();
  }
});
