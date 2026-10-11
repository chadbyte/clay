var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var kit = require("../lib/yoke/adapters/codex").contractTestKit;
var attachMessageProcessor = require("../lib/sdk-message-processor").attachMessageProcessor;
var createQueue = require("../lib/project-pending-message-queue").createPendingMessageQueue;

function fixture(t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-codex-quota-queue-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var session = {
    localId: 71, vendor: "codex", ownerId: "owner", isProcessing: true,
    _awaitingTurnResult: true, messageUUIDs: [], history: [],
    pendingPermissions: {}, pendingElicitations: {}, pendingAskUser: {},
  };
  var queue = createQueue({ filePath: path.join(dir, "queue.json"), slug: "project" });
  var delivered = [];
  var done = new Promise(function (resolve) {
    var processor = attachMessageProcessor({
      sm: {
        sendAndRecord: function (target, msg) { target.history.push(msg); },
        broadcastSessionList: function () {},
      },
      opts: {}, onProcessingChanged: function () {},
      onTurnDone: function (target) {
        // Match the project completion hook: attempt delivery on the next tick.
        setImmediate(function () {
          queue.consumeOne(target, function (item, complete) {
            delivered.push(item.message);
            complete(true);
            return true;
          });
          resolve();
        });
      },
    });
    session.testProcessor = processor;
  });
  var message = { text: "queued follow-up", clientMessageId: "follow-up-1", pastes: ["preserve this attachment"] };
  queue.admit(session, message, { id: "owner" });
  return { session: session, queue: queue, processor: session.testProcessor, delivered: delivered, done: done, message: message };
}

test("a full Codex quota snapshot cannot block Next Up after a null-cost completion", async function (t) {
  var f = fixture(t);
  var state = kit.createEventState();
  var event = kit.normalizeEvent({ method: "account/rateLimits/updated", params: { rateLimits: {
    primary: { usedPercent: 100, windowDurationMins: 10080, resetsAt: Math.floor(Date.now() / 1000) + 94 * 3600 },
  } } }, state)[0];
  f.processor.processSDKMessage(f.session, event);
  f.processor.processSDKMessage(f.session, event);
  assert.equal(f.queue.consumeOne(f.session, function () { throw new Error("Still processing"); }), null);
  var result = kit.normalizeEvent({ method: "turn/completed", params: { turn: { status: "completed" } } }, state)[0];
  assert.equal(result.cost, null, "Codex completion does not report a billable cost");
  f.processor.processSDKMessage(f.session, result);
  // Account updates can also arrive after the response has finished.
  f.processor.processSDKMessage(f.session, event);
  await f.done;
  assert.deepEqual(f.delivered, [f.message]);
  assert.equal(f.queue.inspect(f.session, { id: "owner" }, "follow-up-1").state, "consumed");
  assert.equal(f.session.rateLimitResetsAt, undefined);
  assert.equal(f.queue.consumeOne(f.session, function () { throw new Error("Duplicate delivery"); }), null);
});

test("a genuine request rejection still blocks automatic queued delivery", async function (t) {
  var f = fixture(t);
  f.processor.processSDKMessage(f.session, { yokeType: "rate_limit", rateLimitInfo: {
    status: "rejected", resetsAt: Math.floor(Date.now() / 1000) + 3600,
  } });
  f.processor.processSDKMessage(f.session, { yokeType: "result", cost: null });
  await f.done;
  assert.deepEqual(f.delivered, []);
  assert.equal(f.queue.inspect(f.session, { id: "owner" }, "follow-up-1").state, "pending");
});
