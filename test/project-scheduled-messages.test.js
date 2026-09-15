var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var attachMessages = require("../lib/project-scheduled-messages").attachProjectScheduledMessages;
var createPendingMessageQueue = require("../lib/project-pending-message-queue").createPendingMessageQueue;
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function flush() { return new Promise(function (resolve) { setImmediate(resolve); }); }

function fixture(options) {
  options = options || {};
  var clock = options.clock || { value: 100000 };
  var saved = options.saved || { version: 1, namespace: "test", jobs: [] };
  var id = options.id || { value: 0 };
  var failSave = options.failSave || { value: false };
  var store = {
    load: function () { return clone(saved); },
    save: function (next) {
      if (failSave.value) throw new Error("disk unavailable");
      saved.version = next.version;
      saved.namespace = next.namespace;
      saved.jobs = clone(next.jobs);
    },
    close: function () {},
  };
  var schedulerOptions = {
    namespace: "test",
    now: function () { return clock.value; },
    makeId: function () { id.value++; return "id-" + id.value; },
    setTimer: function () { return { unref: function () {} }; },
    clearTimer: function () {},
  };
  if (options.storageDir) schedulerOptions.storageDir = options.storageDir;
  else schedulerOptions.store = store;
  var scheduler = options.scheduler || attachScheduler(schedulerOptions);
  var sessions = new Map();
  var session = options.session || {
    localId: 1,
    sessionOriginId: options.sessionOriginId || "scheduled-session-origin",
    cliSessionId: "cli-stable",
    ownerId: options.multiUser === false ? null : "owner-a",
    mode: "gui",
    history: [],
    isProcessing: false,
    pendingPermissions: {},
  };
  sessions.set(session.localId, session);
  var events = [];
  var direct = [];
  var fileMessages = [];
  var sdkCalls = [];
  var trace = [];
  var pendingQueue = createPendingMessageQueue({
    filePath: options.queuePath || (options.storageDir ? path.join(options.storageDir, "queue.json") : path.join(os.tmpdir(), "clay-scheduled-queue-" + process.pid + "-" + Math.random().toString(16).slice(2) + ".json")),
    slug: options.slug || "project-a",
    authorize: function () { return true; },
    canMutate: options.queueCanMutate || function () { return true; },
    persist: options.queuePersist,
    onItemConsumed: function (item) { return adapter && adapter.onQueueConsumed(item); },
    onItemCancelled: function (item) { return adapter && adapter.onQueueCancelled(item); },
  });
  var usersById = options.usersById || {
    "owner-a": { id: "owner-a", linuxUser: options.osUsers ? "linux-a" : null },
    "actor-b": { id: "actor-b", linuxUser: options.osUsers ? "linux-b" : null },
  };
  var access = options.access || { value: true };
  var projectAllowed = options.projectAllowed || Object.create(null);
  var sessionAllowed = options.sessionAllowed || Object.create(null);
  var accessCalls = [];
  var sm = {
    sessions: sessions,
    sendAndRecord: function (target, event) { target.history.push(event); events.push(event); trace.push("record:" + event.type); },
    appendToSessionFile: function (_target, event) { fileMessages.push(event); trace.push("append:" + event.type); },
    broadcastSessionList: function () { events.push({ type: "session_list" }); },
    addOnSessionDeleted: function (fn) { sm.deleted = fn; },
    addOnSessionViewed: function (fn) { sm.viewed = fn; },
  };
  var users = {
    isMultiUser: function () { return options.multiUser !== false; },
    findUserById: function (userId) { return usersById[userId] || null; },
    canAccessSession: function (userId) { return access.value && sessionAllowed[userId] !== false; },
  };
  var rawStartQuery = options.startQuery || function (target, text, images, linuxUser) {
      sdkCalls.push({ session: target, text: text, images: images, linuxUser: linuxUser });
      trace.push("sdk");
      return Promise.resolve();
    };
  var sdk = {
    startQuery: function (target, text, images, linuxUser, beforePush, accepted) {
      if (beforePush && !beforePush()) return Promise.resolve(false);
      if (accepted) accepted();
      return rawStartQuery(target, text, images, linuxUser, beforePush, accepted);
    },
    pushMessage: function () { return false; },
  };
  var revision = 0;
  var adapter;
  var adapterOptions = {
    scheduler: scheduler,
    slug: options.slug || "project-a",
    isMate: !!options.isMate,
    osUsers: !!options.osUsers,
    sm: sm,
    sdk: sdk,
    usersModule: users,
    sendTo: function (_ws, event) { direct.push(event); },
    sendToSession: function (_localId, event) { direct.push(event); trace.push("send:" + event.type); },
    onProcessingChanged: function () {},
    ensureProjectAccessForSession: options.ensureAccess || function () { return options.osUsers ? "linux-a" : null; },
    getProjectAccess: function () { return { visibility: "public" }; },
    canAccessProjectSlug: function (userId, projectSlug) {
      accessCalls.push({ userId: userId, projectSlug: projectSlug });
      return access.value && projectAllowed[userId] !== false;
    },
    isDriverOperatedSession: function (target) { return !!target.worker; },
    now: function () { return clock.value; },
    makeRevision: function () { revision++; return "revision-" + revision; },
  };
  adapterOptions.pendingMessageQueue = pendingQueue;
  var handler;
  adapterOptions.consumePendingMessage = function (target) { return handler && handler.consumePendingMessage(target); };
  adapter = attachMessages(adapterOptions);
  handler = attachUserMessage({
    cwd: options.cwd || os.tmpdir(), slug: options.slug || "project-a", isMate: !!options.isMate, osUsers: !!options.osUsers,
    sm: {
      saveSessionFile: function () {},
      appendToSessionFile: function (target, event) { fileMessages.push(event); trace.push("append:" + event.type); },
      broadcastSessionList: function () {},
    },
    sdk: sdk,
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: { create: function () {}, attach: function () {}, list: function () { return []; } },
    clients: new Set(), opts: {}, usersModule: users, matesModule: {},
    getSessionForWs: function () { return session; }, getLinuxUserForSession: function () { return options.osUsers ? "linux-a" : null; },
    ensureProjectAccessForSession: options.ensureAccess || function () { return options.osUsers ? "linux-a" : null; },
    getOsUserInfoForWs: function () {}, hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: os.tmpdir(),
    onProcessingChanged: function () {}, gitAttribution: null, browserState: { _browserTabList: {} },
    requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return []; }, saveContextSources: function () {},
    adapter: { renameSession: function () { return Promise.resolve(); } }, _email: null, _loop: { handleLoopMessage: function () { return false; } },
    send: function () {}, sendTo: function (_ws, event) { direct.push(event); }, sendToSession: function () {}, sendToSessionOthers: function () {},
    sendExtensionCommandAny: function () {}, scheduleMessage: function (target, text, resetsAt, actor, targetWs, attachments, requestId, transportAccountId) { return adapter.schedule(target, text, resetsAt, actor, targetWs, attachments, requestId, transportAccountId); }, cancelScheduledMessage: function () {}, sendScheduledMessageNow: function () {},
    pendingMessageQueue: pendingQueue, authorizePendingDispatch: function (target, actor, item) { return adapter.authorizePending(item, target) && (!actor || item.actorId === actor.id); },
    isDriverOperatedSession: function () { return false; }, beginHumanPairTurn: function () { return true; }, autonomousRun: { consume: function () { return false; }, onHumanMessage: function () {} },
  });
  return {
    scheduler: scheduler, adapter: adapter, sm: sm, session: session, sessions: sessions,
    events: events, direct: direct, fileMessages: fileMessages, sdkCalls: sdkCalls, trace: trace,
    saved: saved, clock: clock, id: id, failSave: failSave, usersById: usersById, access: access,
    projectAllowed: projectAllowed, sessionAllowed: sessionAllowed, accessCalls: accessCalls, pendingQueue: pendingQueue, handler: handler,
  };
}

async function finish(fx) {
  await flush();
  await flush();
  await flush();
  return fx;
}

test("restart resolves the stable CLI identity after local id changes and dispatches once", async function () {
  var storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-project-scheduled-"));
  var first = fixture({ storageDir: storageDir });
  first.scheduler.start();
  var job = first.adapter.schedule(first.session, "continue", 200000, { id: "owner-a" });
  first.adapter.shutdown();
  await first.scheduler.shutdown();

  var replacementSession = Object.assign({}, first.session, { localId: 44, history: [], scheduledMessage: null });
  var second = fixture({ storageDir: storageDir, id: first.id, clock: first.clock, session: replacementSession });
  assert.strictEqual(second.session.scheduledMessage.jobId, job.id);
  second.clock.value = 260000;
  second.scheduler.start();
  await finish(second);
  assert.strictEqual(second.sdkCalls.length, 1);
  assert.strictEqual(second.sdkCalls[0].session.localId, 44);
  assert.strictEqual(second.sdkCalls[0].session.cliSessionId, "cli-stable");
  assert.strictEqual(second.scheduler.getJob(job.id).state, "completed");
  await second.scheduler.shutdown();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("scheduled attachment admission keeps payload bytes in the queue and delivers them once", async function () {
  var fx = fixture();
  var ws = {};
  var image = { mediaType: "image/png", data: "x".repeat(300000) };
  var job = fx.adapter.schedule(fx.session, "", 90000, { id: "owner-a" }, ws, {
    images: [image],
    pastes: ["pasted context"],
  }, "schedule-attachment-1");
  var stored = fx.pendingQueue.list(fx.session, { id: "owner-a" })[0];
  assert.deepEqual(stored.message.images, [image]);
  assert.deepEqual(stored.message.pastes, ["pasted context"]);
  assert.equal(fx.scheduler.getJob(job.id).payload.hasAttachments, true);
  assert.equal(fx.scheduler.getJob(job.id).payload.queueAdmissionRequired, true);
  assert.equal(Object.prototype.hasOwnProperty.call(fx.scheduler.getJob(job.id).payload, "images"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(fx.scheduler.getJob(job.id).payload, "pastes"), false);
  assert.equal(fx.direct[0].type, "schedule_message_result");
  assert.equal(fx.direct[0].requestId, "schedule-attachment-1");
  fx.scheduler.start();
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.equal(fx.sdkCalls.length, 1);
  assert.deepEqual(fx.sdkCalls[0].images, [image]);
  assert.equal(fx.sdkCalls[0].text, "pasted context");
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "consumed");
  await fx.scheduler.shutdown();
});

test("scheduled request retry reuses the durable admission after reload and fresh auth", async function () {
  var storageDir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-retry-"));
  var first = fixture({ storageDir: storageDir });
  var firstJob = first.adapter.schedule(first.session, "original", 200000, { id: "owner-a" }, {}, null, "request-retry-1");
  first.adapter.shutdown();
  await first.scheduler.shutdown();
  var replacementSession = Object.assign({}, first.session, { localId: 44, history: [], scheduledMessage: null });
  var second = fixture({ storageDir: storageDir, id: first.id, clock: first.clock, session: replacementSession });
  var replay = second.adapter.schedule(second.session, "changed and must be ignored", 300000, { id: "owner-a" }, {}, null, "request-retry-1");
  assert.equal(replay.id, firstJob.id);
  assert.equal(second.scheduler.listJobs().length, 1);
  assert.equal(second.scheduler.getJob(firstJob.id).payload.text, "original");
  assert.equal(second.pendingQueue.list(second.session, { id: "owner-a" }).length, 1);
  assert.equal(second.adapter.schedule(second.session, "another", 310000, { id: "owner-a" }, {}, null, "request-retry-2"), null);
  assert.equal(second.scheduler.listJobs().length, 1);
  second.access.value = false;
  assert.equal(second.adapter.schedule(second.session, "must not replay", 300000, { id: "owner-a" }, {}, null, "request-retry-1"), null);
  assert.equal(second.scheduler.listJobs().length, 1);
  await second.scheduler.shutdown();
  fs.rmSync(storageDir, { recursive: true, force: true });
});

test("schedule_message handler uses transport account and rejects malformed attachments", function () {
  var fx = fixture({ multiUser: false });
  var ws = { _clayUser: { id: "ws-user" } };
  fx.handler.handleUserMessage(ws, {
    type: "schedule_message", projectSlug: "project-a", sessionId: 1, accountId: "ws-user",
    requestId: "handler-attachment-1", text: "queued", resetsAt: 200000, images: [], pastes: [],
  });
  assert.equal(fx.direct[0].type, "schedule_message_result");
  assert.equal(fx.direct[0].accountId, "ws-user");
  var jobCount = fx.scheduler.listJobs().length;
  fx.handler.handleUserMessage(ws, {
    type: "schedule_message", projectSlug: "project-a", sessionId: 1, accountId: "ws-user",
    requestId: "handler-attachment-2", text: "invalid", resetsAt: 210000, images: "not-an-array", pastes: [],
  });
  assert.equal(fx.scheduler.listJobs().length, jobCount);
  assert.equal(fx.direct[fx.direct.length - 1].ok, false);
});

test("transient scheduled queue admission failure does not cache a rejected request", function () {
  var saves = 0;
  var fx = fixture({ queuePersist: function () { saves++; if (saves === 1) throw new Error("temporary queue failure"); } });
  var requestId = "request-transient-1";
  assert.equal(fx.adapter.schedule(fx.session, "retry me", 200000, { id: "owner-a" }, {}, null, requestId), null);
  var job = fx.adapter.schedule(fx.session, "retry me", 200000, { id: "owner-a" }, {}, null, requestId);
  assert.ok(job);
  assert.equal(fx.scheduler.listJobs().length, 2);
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" }).length, 1);
});

test("replacement, cancellation, and Send now mutate one job without duplicate delivery", async function () {
  var fx = fixture();
  fx.scheduler.start();
  var original = fx.adapter.schedule(fx.session, "old", 200000, { id: "owner-a" });
  var replaced = fx.adapter.schedule(fx.session, "new", 210000, { id: "owner-a" });
  assert.strictEqual(replaced.id, original.id);
  assert.strictEqual(fx.scheduler.listJobs().length, 1);
  assert.strictEqual(fx.scheduler.getJob(original.id).payload.text, "new");
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }), true);
  fx.clock.value = 300000;
  fx.scheduler.tick();
  await finish(fx);
  assert.strictEqual(fx.sdkCalls.length, 0);

  var immediate = fx.adapter.schedule(fx.session, "send", 400000, { id: "owner-a" });
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }), true);
  fx.scheduler.tick();
  fx.scheduler.tick();
  await finish(fx);
  assert.strictEqual(fx.sdkCalls.length, 1);
  assert.strictEqual(fx.scheduler.getJob(immediate.id).state, "completed");
  await fx.scheduler.shutdown();
});

test("schedule replacement queue failure restores the original scheduler job and queue row", function () {
  var saves = 0;
  var fx = fixture({ queuePersist: function () { saves++; if (saves === 2) throw new Error("queue disk unavailable"); } });
  var original = fx.adapter.schedule(fx.session, "original", 200000, { id: "owner-a" });
  var originalJob = clone(fx.scheduler.getJob(original.id));
  var originalItem = clone(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0]);
  assert.strictEqual(fx.adapter.schedule(fx.session, "replacement", 210000, { id: "owner-a" }), null);
  assert.deepStrictEqual(fx.scheduler.getJob(original.id), originalJob);
  assert.deepStrictEqual(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0], originalItem);
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }), true);
  fx.scheduler.shutdown();
});

test("Send now queue failure restores the original scheduler time", function () {
  var saves = 0;
  var fx = fixture({ queuePersist: function () { saves++; if (saves === 2) throw new Error("queue disk unavailable"); } });
  var original = fx.adapter.schedule(fx.session, "send later", 200000, { id: "owner-a" });
  var originalRunAt = fx.scheduler.getJob(original.id).runAt;
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }), false);
  assert.strictEqual(fx.scheduler.getJob(original.id).runAt, originalRunAt);
  assert.strictEqual(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].message.text, "send later");
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }), true);
  fx.scheduler.shutdown();
});

test("stale Cancel and Send now controls cannot mutate a replacement", function () {
  var fx = fixture();
  var first = fx.adapter.schedule(fx.session, "first", 200000, { id: "owner-a" });
  var second = fx.adapter.schedule(fx.session, "second", 210000, { id: "owner-a" });
  var ws = {};
  var stale = { jobId: first.id, revision: first.payload.revision, queueRevision: fx.pendingQueue.getRevision() };
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }, ws, null, stale), false);
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }, ws, stale), false);
  assert.strictEqual(fx.scheduler.getJob(second.id).state, "queued");
  var current = { jobId: second.id, revision: second.payload.revision, queueRevision: fx.pendingQueue.getRevision() };
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }, ws, null, current), true);
  fx.scheduler.shutdown();
});

test("cross-user and stale queue controls are rejected before scheduler mutation", function () {
  var fx = fixture({ queueCanMutate: function (_session, actor, item) { return !item || actor.id === item.actorId; } });
  var job = fx.adapter.schedule(fx.session, "owner text", 200000, { id: "owner-a" });
  var runAt = fx.scheduler.getJob(job.id).runAt;
  var queueRevision = fx.pendingQueue.getRevision();
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "actor-b" }, {}, { jobId: job.id, revision: job.payload.revision, queueRevision: queueRevision }), false);
  assert.strictEqual(fx.scheduler.getJob(job.id).runAt, runAt);
  assert.strictEqual(fx.adapter.schedule(fx.session, "collaborator replacement", 210000, { id: "actor-b" }), null);
  assert.strictEqual(fx.scheduler.getJob(job.id).payload.text, "owner text");
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }, {}, { jobId: job.id, revision: job.payload.revision, queueRevision: queueRevision - 1 }), false);
  assert.strictEqual(fx.scheduler.getJob(job.id).runAt, runAt);
  fx.scheduler.shutdown();
});

test("cancel and Send now lose cleanly once the due tick has claimed the job", async function () {
  var release;
  var calls = 0;
  var fx = fixture({ startQuery: function () {
    calls++;
    return new Promise(function (resolve) { release = resolve; });
  } });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "race", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "running");
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }), true);
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }), false);
  await finish(fx);
  assert.strictEqual(calls, 0);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "completed");
  assert.strictEqual(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "cancelled");
  assert.strictEqual(fx.events.filter(function (event) { return event.type === "scheduled_message_cancelled"; }).length, 1);
  await fx.scheduler.shutdown();
});

test("an SDK rate-limit callback can queue one successor before the current dispatch settles", async function () {
  var outcomes = ["resolve", "reject"];
  for (var oi = 0; oi < outcomes.length; oi++) {
    var fx;
    var calls = 0;
    var successor = null;
    fx = fixture({ startQuery: function () {
      calls++;
      if (calls === 1) {
        fx.session.rateLimitAutoContinuePending = true;
        successor = fx.adapter.schedule(fx.session, "continue again", fx.clock.value, { id: "owner-a" });
        return outcomes[oi] === "reject" ? Promise.reject(new Error("rate limited")) : Promise.resolve();
      }
      return Promise.resolve();
    } });
    fx.scheduler.start();
    var current = fx.adapter.schedule(fx.session, "first", 90000, { id: "owner-a" });
    fx.clock.value += 5000;
    fx.scheduler.tick();
    await finish(fx);
    assert.ok(successor, outcomes[oi]);
    assert.notStrictEqual(successor.id, current.id, outcomes[oi]);
    assert.strictEqual(fx.scheduler.getJob(current.id).state, "completed", outcomes[oi]);
    assert.strictEqual(fx.scheduler.getJob(successor.id).state, "queued", outcomes[oi]);
    assert.strictEqual(fx.session.scheduledMessage.jobId, successor.id, outcomes[oi]);
    assert.strictEqual(fx.session.rateLimitAutoContinuePending, true, outcomes[oi]);
    if (outcomes[oi] === "reject") assert.strictEqual(fx.session.isProcessing, true);
    fx.session.isProcessing = false;
    fx.clock.value += 5000;
    fx.adapter.notify();
    await finish(fx);
    assert.strictEqual(calls, 2, outcomes[oi]);
    assert.strictEqual(fx.scheduler.getJob(successor.id).state, "completed", outcomes[oi]);
    assert.strictEqual(fx.session.scheduledMessage, null, outcomes[oi]);
    await fx.scheduler.shutdown();
  }
});

test("busy sessions stay queued without a claim and run when notified idle", async function () {
  var fx = fixture();
  fx.session.isProcessing = true;
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "wait", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "queued");
  assert.strictEqual(fx.scheduler.getJob(job.id).execution, null);
  fx.session.isProcessing = false;
  fx.adapter.notify();
  await finish(fx);
  assert.strictEqual(fx.sdkCalls.length, 1);
  await fx.scheduler.shutdown();
});

test("due scheduled messages enter the shared queue and wait for idle consumption", async function () {
  var fx = fixture({ sharedQueue: true });
  fx.session.isProcessing = true;
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "queued scheduled", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.equal(fx.sdkCalls.length, 0);
  assert.equal(fx.scheduler.getJob(job.id).state, "queued");
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" }).length, 1);
  fx.session.isProcessing = false;
  fx.adapter.notify();
  await finish(fx);
  assert.equal(fx.sdkCalls.length, 1, "scheduled delivery must use the shared queue SDK path");
  assert.equal(fx.scheduler.getJob(job.id).state, "completed");
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "consumed");
  await fx.scheduler.shutdown();
});

test("future scheduled queue items are not ready and edited payloads reach the real handler", async function () {
  var fx = fixture();
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "original", 90000, { id: "owner-a" });
  var item = fx.pendingQueue.list(fx.session, { id: "owner-a" })[0];
  assert.equal(item.schedule.ready, false);
  fx.session.isProcessing = false;
  assert.equal(fx.pendingQueue.consumeOne(fx.session, function () { throw new Error("future item must not dispatch"); }), null);
  assert.equal(fx.pendingQueue.edit(fx.session, { id: "owner-a" }, item.id, fx.pendingQueue.getRevision(), fx.session.localId, {
    text: "edited", images: [{ mediaType: "image/png", data: "edited-image" }],
  }).ok, true);
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.equal(fx.sdkCalls.length, 1);
  assert.equal(fx.sdkCalls[0].text, "edited");
  assert.deepEqual(fx.sdkCalls[0].images, [{ mediaType: "image/png", data: "edited-image" }]);
  assert.equal(fx.scheduler.getJob(job.id).state, "completed");
  await fx.scheduler.shutdown();
});

test("single-user scheduled delivery normalizes the queue actor and is accepted once", async function () {
  var fx = fixture({ multiUser: false });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "single-user audit", 90000, { id: "ignored-user" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.equal(fx.scheduler.getJob(job.id).state, "completed");
  assert.equal(fx.sdkCalls.length, 1);
  assert.equal(fx.pendingQueue.list(fx.session, { id: "default" })[0].state, "consumed");
  await fx.scheduler.shutdown();
});

test("queue preparation release emits no scheduled sent event", function () {
  var fx = fixture();
  var job = fx.adapter.schedule(fx.session, "preparation release", 90000, { id: "owner-a" });
  fx.pendingQueue.releaseScheduled(fx.session, job.id, job.payload.revision);
  var item = fx.pendingQueue.list(fx.session, { id: "owner-a" })[0];
  var complete;
  fx.session.isProcessing = false;
  fx.pendingQueue.consumeOne(fx.session, function (queued, finishClaim) { complete = finishClaim; return true; });
  assert.ok(complete);
  assert.equal(complete("release", "paused"), true);
  assert.equal(fx.events.filter(function (event) { return event.type === "scheduled_message_sent"; }).length, 0);
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "pending");
  assert.equal(item.schedule.ready, true);
});

test("cancelling before due tombstones the queue before the scheduler", async function () {
  var fx = fixture();
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "cancel before due", 90000, { id: "owner-a" });
  assert.equal(fx.adapter.cancel(fx.session, { id: "owner-a" }), true);
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "cancelled");
  assert.equal(fx.scheduler.getJob(job.id).state, "cancelled");
  fx.clock.value += 60000;
  fx.scheduler.tick();
  await finish(fx);
  assert.equal(fx.sdkCalls.length, 0);
  await fx.scheduler.shutdown();
});

test("restart reconciles a completed scheduler handoff and consumes the pending item once", async function () {
  var queuePath = path.join(os.tmpdir(), "clay-scheduled-restart-" + process.pid + "-" + Math.random().toString(16).slice(2) + ".json");
  var fx = fixture({ queuePath: queuePath });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "restart handoff", 90000, { id: "owner-a" });
  fx.session._pendingMessageDrainPaused = true;
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.equal(fx.scheduler.getJob(job.id).state, "completed");
  assert.equal(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "pending");
  await fx.scheduler.shutdown();

  var restarted = fixture({ saved: fx.saved, id: fx.id, clock: fx.clock, queuePath: queuePath });
  restarted.session._pendingMessageDrainPaused = false;
  await finish(restarted);
  assert.equal(restarted.sdkCalls.length, 1);
  assert.equal(restarted.pendingQueue.list(restarted.session, { id: "owner-a" })[0].state, "consumed");
  restarted.adapter.rehydrate();
  await finish(restarted);
  assert.equal(restarted.sdkCalls.length, 1);
  await restarted.scheduler.shutdown();
});

test("rehydration and authoritative view state ignore historical queue events", function () {
  var fx = fixture();
  var job = fx.adapter.schedule(fx.session, "pending", 200000, { id: "owner-a" });
  fx.session.scheduledMessage = null;
  fx.adapter.rehydrate();
  assert.strictEqual(fx.session.scheduledMessage.jobId, job.id);
  var sent = [];
  fx.smViewed = fx.adapter.sendState(fx.session, null, function (event) { sent.push(event); });
  assert.strictEqual(sent[0].type, "scheduled_message_state");
  assert.strictEqual(sent[0].scheduledMessage.text, "pending");
  fx.adapter.cancel(fx.session, { id: "owner-a" });
  fx.adapter.sendState(fx.session, null, function (event) { sent.push(event); });
  assert.strictEqual(sent[1].scheduledMessage, null);
  fx.scheduler.shutdown();
});

test("one shared engine isolates two projects and owners", async function () {
  var shared = fixture({ slug: "project-a" });
  var secondSession = { localId: 2, cliSessionId: "cli-b", ownerId: "actor-b", mode: "gui", history: [], isProcessing: false, pendingPermissions: {} };
  var second = fixture({ slug: "project-b", scheduler: shared.scheduler, clock: shared.clock, session: secondSession });
  shared.scheduler.start();
  shared.adapter.schedule(shared.session, "a", 90000, { id: "owner-a" });
  second.adapter.schedule(secondSession, "b", 90000, { id: "actor-b" });
  shared.clock.value += 5000;
  shared.scheduler.tick();
  await finish(shared);
  assert.strictEqual(shared.sdkCalls.length, 1);
  assert.strictEqual(second.sdkCalls.length, 1);
  second.adapter.shutdown();
  await shared.scheduler.shutdown();
});

test("multi-user authorization passes the slug and rechecks actor and owner", async function () {
  var fx = fixture();
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "shared actor", 90000, { id: "actor-b" });
  assert.ok(job);
  assert.deepStrictEqual(fx.accessCalls.slice(0, 2), [
    { userId: "actor-b", projectSlug: "project-a" },
    { userId: "owner-a", projectSlug: "project-a" },
  ]);
  fx.projectAllowed["owner-a"] = false;
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.strictEqual(fx.sdkCalls.length, 0);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "failed");
  await fx.scheduler.shutdown();
});

test("Mate chat schedules register a handler and dispatch normally", async function () {
  var fx = fixture({ isMate: true, slug: "mate-clay" });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "continue", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.strictEqual(fx.sdkCalls.length, 1);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "completed");
  await fx.scheduler.shutdown();
});

test("deleted, revoked, owner-changed, OS-less, Worker, and TUI targets fail closed", async function () {
  var cases = ["deleted", "deleted-user", "revoked", "owner", "os", "worker", "tui", "runtime-tui"];
  for (var i = 0; i < cases.length; i++) {
    var fx = fixture({ osUsers: cases[i] === "os" });
    fx.scheduler.start();
    var job = fx.adapter.schedule(fx.session, cases[i], 90000, { id: "owner-a" });
    if (cases[i] === "deleted") fx.sessions.delete(fx.session.localId);
    if (cases[i] === "deleted-user") delete fx.usersById["owner-a"];
    if (cases[i] === "revoked") fx.access.value = false;
    if (cases[i] === "owner") fx.session.ownerId = "actor-b";
    if (cases[i] === "os") fx.usersById["owner-a"].linuxUser = null;
    if (cases[i] === "worker") fx.session.sessionProvenance = { kind: "worker" };
    if (cases[i] === "tui") fx.session.mode = "tui";
    if (cases[i] === "runtime-tui") fx.session.runtimeMode = "tui";
    fx.clock.value += 5000;
    fx.scheduler.tick();
    await finish(fx);
    assert.strictEqual(fx.sdkCalls.length, 0, cases[i]);
    assert.strictEqual(fx.scheduler.getJob(job.id).state, "failed", cases[i]);
    await fx.scheduler.shutdown();
  }
});

test("missing stable identity is rejected and session deletion cancels queued work", function () {
  var missing = fixture();
  missing.session.cliSessionId = null;
  assert.strictEqual(missing.adapter.schedule(missing.session, "no identity", 200000, { id: "owner-a" }), null);
  assert.match(missing.direct[0].text, /persistent provider identity/);
  missing.scheduler.shutdown();

  var fx = fixture();
  var job = fx.adapter.schedule(fx.session, "delete me", 200000, { id: "owner-a" });
  fx.sessions.delete(fx.session.localId);
  fx.sm.deleted(fx.session.localId, fx.session);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "cancelled");
  fx.scheduler.shutdown();
});

test("a stale scheduled rejection cannot reset a newer ordinary query", async function () {
  var rejectScheduled;
  var oldQuery = { id: "scheduled" };
  var fx = fixture({ startQuery: function (target) {
    target._queryGeneration = (target._queryGeneration || 0) + 1;
    target.queryInstance = oldQuery;
    return new Promise(function (_resolve, reject) { rejectScheduled = reject; });
  } });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "scheduled", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await flush();
  await flush();
  var newerQuery = { id: "ordinary" };
  fx.session._queryGeneration++;
  fx.session.queryInstance = newerQuery;
  fx.session.isProcessing = true;
  rejectScheduled(new Error("old query rejected late"));
  await finish(fx);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "completed");
  assert.strictEqual(fx.pendingQueue.list(fx.session, { id: "owner-a" })[0].state, "consumed");
  assert.strictEqual(fx.session.isProcessing, true);
  assert.strictEqual(fx.session.queryInstance, newerQuery);
  assert.strictEqual(fx.direct.some(function (event) { return event.type === "status" && event.status === "idle"; }), false);
  await fx.scheduler.shutdown();
});

test("storage and SDK failures are visible and never retry", async function () {
  var storage = fixture();
  storage.failSave.value = true;
  assert.strictEqual(storage.adapter.schedule(storage.session, "disk", 90000, { id: "owner-a" }), null);
  assert.strictEqual(storage.sdkCalls.length, 0);
  assert.match(storage.direct[0].text, /disk unavailable/);
  await storage.scheduler.shutdown();

  var calls = 0;
  var sdkFailure = fixture({ startQuery: function () { calls++; return Promise.reject(new Error("SDK startup failed")); } });
  sdkFailure.scheduler.start();
  var job = sdkFailure.adapter.schedule(sdkFailure.session, "sdk", 90000, { id: "owner-a" });
  sdkFailure.clock.value += 5000;
  sdkFailure.scheduler.tick();
  await finish(sdkFailure);
  assert.strictEqual(calls, 1);
  assert.strictEqual(sdkFailure.scheduler.getJob(job.id).state, "completed");
  assert.strictEqual(sdkFailure.pendingQueue.list(sdkFailure.session, { id: "owner-a" })[0].state, "consumed");
  assert.strictEqual(sdkFailure.session.isProcessing, true);
  sdkFailure.scheduler.tick();
  await finish(sdkFailure);
  assert.strictEqual(calls, 1);
  await sdkFailure.scheduler.shutdown();
});

test("shutdown unregisters the producer but preserves pending work for restart", async function () {
  var fx = fixture();
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "later", 90000, { id: "owner-a" });
  fx.adapter.shutdown();
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "queued");
  assert.strictEqual(fx.sdkCalls.length, 0);
  await fx.scheduler.shutdown();
});

test("restart reports possibly dispatched work as interrupted without retry", async function () {
  var release;
  var fx = fixture({ startQuery: function () { return new Promise(function (resolve) { release = resolve; }); } });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "unknown", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await flush();
  await flush();
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "completed");
  await fx.scheduler.shutdown();
  release();
  var restarted = fixture({ saved: fx.saved, id: fx.id, clock: fx.clock });
  var states = [];
  restarted.adapter.sendState(restarted.session, null, function (message) { states.push(message); });
  assert.strictEqual(restarted.scheduler.getJob(job.id).state, "completed");
  assert.strictEqual(states[0].interrupted, null);
  restarted.scheduler.start();
  await finish(restarted);
  assert.strictEqual(restarted.sdkCalls.length, 0);
  await restarted.scheduler.shutdown();
});

test("normal dispatch records receipt before SDK and preserves action events", async function () {
  var fx = fixture({ osUsers: true });
  fx.scheduler.start();
  var job = fx.adapter.schedule(fx.session, "continue", 90000, { id: "owner-a" });
  fx.clock.value += 5000;
  fx.scheduler.tick();
  await finish(fx);
  var stored = fx.scheduler.getJob(job.id);
  assert.strictEqual(stored.state, "completed");
  assert.deepStrictEqual(fx.events.filter(function (event) { return /^scheduled_message_/.test(event.type); }).map(function (event) { return event.type; }), ["scheduled_message_queued", "scheduled_message_sent"]);
  assert.strictEqual(fx.fileMessages[0].type, "user_message");
  assert.ok(fx.trace.indexOf("append:user_message") < fx.trace.indexOf("sdk"));
  assert.ok(fx.trace.indexOf("append:user_message") < fx.trace.indexOf("record:scheduled_message_sent"));
  assert.strictEqual(fx.sdkCalls[0].linuxUser, "linux-a");
  await fx.scheduler.shutdown();
});
