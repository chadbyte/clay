var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var test = require("node:test");
var createPendingMessageQueue = require("../lib/project-pending-message-queue").createPendingMessageQueue;
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;
var wsSchema = require("../lib/ws-schema").schema;

function fixture() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pending-lifecycle-"));
  var session = { localId: 7, cliSessionId: "provider-session", ownerId: "user-a", isProcessing: true };
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    authorize: function (target, actor) { return !!(target && actor && actor.id === "user-a"); },
  });
  return { dir: dir, session: session, queue: queue };
}

test("a claimed item can be cancelled without a late completion reviving it", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  f.queue.admit(f.session, { text: "cancel during preparation", clientMessageId: "claimed-cancel" }, actor);
  f.session.isProcessing = false;
  var finish;
  assert.ok(f.queue.consumeOne(f.session, function (item, complete) { finish = complete; return true; }));
  var claimed = f.queue.list(f.session, actor)[0];
  assert.equal(claimed.state, "claimed");
  assert.equal(f.queue.cancel(f.session, actor, claimed.id, f.queue.getRevision(), f.session.localId).ok, true);
  assert.equal(finish(true), false);
  assert.equal(f.queue.list(f.session, actor)[0].state, "cancelled");
  assert.equal(f.session._pendingMessageClaimId, undefined);
});

test("pausing during preparation releases the claim without draining", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  f.queue.admit(f.session, { text: "keep for resume" }, actor);
  f.session.isProcessing = false;
  var finish;
  f.queue.consumeOne(f.session, function (item, complete) { finish = complete; return true; });
  assert.equal(f.queue.pause(f.session, actor), true);
  f.session._pendingMessageDrainPaused = true;
  assert.equal(finish("release", "Pending message dispatch paused"), true);
  assert.equal(f.queue.list(f.session, actor)[0].state, "pending");
  assert.equal(f.queue.consumeOne(f.session, function () { throw new Error("must remain paused"); }), null);
});

test("future-only pending work keeps pause state across reload", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  var schedule = { jobId: "future-pause", revision: "future-revision", notBefore: Date.now() + 60000, ready: false };
  f.queue.upsertScheduled(f.session, { text: "future pause", schedule: schedule }, actor, schedule);
  assert.equal(f.queue.pause(f.session, actor), true);
  var reloaded = createPendingMessageQueue({ filePath: path.join(f.dir, "queue.json"), slug: "project-a", authorize: function () { return true; } });
  var restored = { localId: f.session.localId, sessionOriginId: f.session.sessionOriginId };
  assert.equal(reloaded.hydrate(restored, actor).paused, true);
});

test("releasing a queue claim does not invoke the consumed callback", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  var consumed = 0;
  var queue = createPendingMessageQueue({
    filePath: path.join(f.dir, "release-callback.json"), slug: "project-a",
    authorize: function () { return true; }, onItemConsumed: function () { consumed++; },
  });
  queue.admit(f.session, { text: "release me" }, actor);
  f.session.isProcessing = false;
  assert.ok(queue.consumeOne(f.session, function (item, complete) { complete("release", "preparation paused"); return true; }));
  assert.equal(consumed, 0);
  assert.equal(queue.list(f.session, actor)[0].state, "pending");
});

test("queued handler early exits always consume, fail, or release their claim", function () {
  var f = fixture();
  var session = f.session;
  var actor = { id: "user-a" };
  var workerOperated = false;
  session.isProcessing = false;
  session.history = [{ type: "user_message", text: "already recorded", from: "user-a", clientMessageId: "early-duplicate" }];
  session.pendingMentionContexts = [];
  session.pendingShellContexts = [];
  var handler = attachUserMessage({
    cwd: f.dir, slug: "project-a", isMate: false, osUsers: false,
    sm: { saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {} },
    sdk: { startQuery: function () { throw new Error("early exits must not dispatch"); }, pushMessage: function () { throw new Error("early exits must not dispatch"); } },
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: { create: function () {}, attach: function () {}, list: function () { return []; } }, clients: new Set(), send: function () {}, sendTo: function () {}, sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {},
    usersModule: { isMultiUser: function () { return false; }, findUserById: function (id) { return { id: id }; } }, matesModule: {}, _loop: { handleLoopMessage: function () { return false; } },
    getSessionForWs: function () { return session; }, getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: f.dir, onProcessingChanged: function () {}, gitAttribution: null,
    browserState: { _browserTabList: {} }, requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return []; }, saveContextSources: function () {},
    adapter: { renameSession: function () { return Promise.resolve(); } }, pendingMessageQueue: f.queue, authorizePendingDispatch: function () { return true; },
    isDriverOperatedSession: function () { return workerOperated; }, autonomousRun: { consume: function () { return false; }, onHumanMessage: function () {} },
  });

  f.queue.admit(session, { type: "message", text: "duplicate", clientMessageId: "early-duplicate" }, actor);
  handler.consumePendingMessage(session);
  assert.equal(f.queue.inspect(session, actor, "early-duplicate").state, "consumed");

  f.queue.admit(session, { type: "message", text: "handoff", clientMessageId: "early-handoff" }, actor);
  session.loopInterviewHandoff = { state: "starting" };
  handler.consumePendingMessage(session);
  var handoff = f.queue.inspect(session, actor, "early-handoff");
  assert.equal(handoff.state, "pending");
  delete session.loopInterviewHandoff;
  f.queue.cancel(session, actor, handoff.id, f.queue.getRevision(), session.localId);

  f.queue.admit(session, { type: "message", text: "worker", clientMessageId: "early-worker" }, actor);
  workerOperated = true;
  handler.consumePendingMessage(session);
  assert.equal(f.queue.inspect(session, actor, "early-worker").state, "failed");
  workerOperated = false;

  f.queue.admit(session, { type: "message", text: "stale run", clientMessageId: "early-autonomous", autonomousRunToken: "stale" }, actor);
  handler.consumePendingMessage(session);
  assert.equal(f.queue.inspect(session, actor, "early-autonomous").state, "failed");

  f.queue.admit(session, { type: "message", text: "arming", clientMessageId: "early-armed" }, actor);
  session.autonomousRun = { state: "armed" };
  handler.consumePendingMessage(session);
  assert.equal(f.queue.inspect(session, actor, "early-armed").state, "pending");
  assert.equal(session._pendingMessageClaimId, undefined);
});

test("canonical pause survives reload and resume requires exact session and revision", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  f.queue.admit(f.session, { text: "resume me", clientMessageId: "resume-canonical" }, actor);
  assert.equal(f.queue.pause(f.session, actor), true);
  var pausedRevision = f.queue.getRevision();
  assert.equal(f.queue.hydrate(f.session, actor).paused, true);
  var reloaded = createPendingMessageQueue({ filePath: path.join(f.dir, "queue.json"), slug: "project-a", authorize: function () { return true; } });
  var restored = { localId: f.session.localId, sessionOriginId: f.session.sessionOriginId };
  assert.equal(reloaded.hydrate(restored, actor).paused, true);
  assert.equal(reloaded.resume(restored, actor, pausedRevision - 1, restored.localId).ok, false);
  assert.equal(reloaded.resume(restored, actor, pausedRevision, restored.localId + 1).ok, false);
  var resumed = reloaded.resume(restored, actor, pausedRevision, restored.localId);
  assert.equal(resumed.ok, true);
  assert.equal(resumed.paused, false);
});

test("every pending queue websocket frame is registered", function () {
  var c2s = ["pending_message_get", "pending_message_edit", "pending_message_cancel", "pending_message_reorder", "pending_message_resume"];
  var s2c = ["pending_message_result", "message_queued", "pending_message_queued", "pending_message_state", "pending_message_claimed", "pending_message_consumed"];
  for (var i = 0; i < c2s.length; i++) {
    assert.ok(wsSchema[c2s[i]], c2s[i]);
    assert.equal(wsSchema[c2s[i]].direction, "c2s");
  }
  for (var j = 0; j < s2c.length; j++) {
    assert.ok(wsSchema[s2c[j]], s2c[j]);
    assert.equal(wsSchema[s2c[j]].direction, "s2c");
  }
});

test("scheduled send-now replies with canonical queue state and does not cross sessions", function () {
  var sent = [];
  var session = { localId: 7, cliSessionId: "provider", ownerId: null, scheduledMessage: { jobId: "job-1", revision: "rev-1" } };
  var queue = createPendingMessageQueue({ filePath: path.join(os.tmpdir(), "clay-send-now-handler-" + process.pid + ".json"), slug: "project-a", authorize: function () { return true; } });
  queue.upsertScheduled(session, { text: "scheduled", clientMessageId: "scheduled-1", schedule: { jobId: "job-1", revision: "rev-1", notBefore: Date.now() + 60000, ready: false } }, { id: "default" }, { jobId: "job-1", revision: "rev-1", notBefore: Date.now() + 60000, ready: false });
  var calls = 0;
  var handler = attachUserMessage({
    cwd: os.tmpdir(), slug: "project-a", isMate: false, osUsers: false,
    sm: { saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {} },
    sdk: { startQuery: function () {}, pushMessage: function () {} },
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: { create: function () {}, attach: function () {}, list: function () { return []; } }, clients: new Set(), send: function () {}, sendTo: function (_ws, message) { sent.push(message); }, sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {},
    usersModule: { isMultiUser: function () { return false; }, findUserById: function (id) { return { id: id }; } }, matesModule: {}, _loop: { handleLoopMessage: function () { return false; } },
    getSessionForWs: function () { return session; }, getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: os.tmpdir(), onProcessingChanged: function () {}, gitAttribution: null,
    browserState: { _browserTabList: {} }, requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return []; }, saveContextSources: function () {},
    adapter: { renameSession: function () { return Promise.resolve(); } }, pendingMessageQueue: queue, authorizePendingDispatch: function () { return true; },
    sendScheduledMessageNow: function () { calls++; return true; }, autonomousRun: { consume: function () { return false; }, onHumanMessage: function () {} },
  });
  var ws = { readyState: 1, _clayUser: null };
  handler.handleUserMessage(ws, { type: "send_scheduled_now", projectSlug: "project-a", sessionId: 7, jobId: "job-1", revision: "rev-1", queueRevision: queue.getRevision(), requestId: "send-1" });
  assert.equal(calls, 1);
  assert.equal(sent[0].type, "pending_message_result");
  assert.equal(sent[0].requestId, "send-1");
  assert.equal(sent[0].result.ok, true);
  handler.handleUserMessage(ws, { type: "send_scheduled_now", projectSlug: "project-a", sessionId: 99, jobId: "job-1", revision: "rev-1", queueRevision: queue.getRevision(), requestId: "wrong-session" });
  assert.equal(calls, 1);
  assert.equal(sent[1].result.ok, false);
});
