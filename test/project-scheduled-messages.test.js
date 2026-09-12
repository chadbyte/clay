var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var attachScheduler = require("../lib/durable-scheduler").attachDurableScheduler;
var attachMessages = require("../lib/project-scheduled-messages").attachProjectScheduledMessages;

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
  var sdk = {
    startQuery: options.startQuery || function (target, text, images, linuxUser) {
      sdkCalls.push({ session: target, text: text, images: images, linuxUser: linuxUser });
      trace.push("sdk");
      return Promise.resolve();
    },
  };
  var revision = 0;
  var adapter = attachMessages({
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
  });
  return {
    scheduler: scheduler, adapter: adapter, sm: sm, session: session, sessions: sessions,
    events: events, direct: direct, fileMessages: fileMessages, sdkCalls: sdkCalls, trace: trace,
    saved: saved, clock: clock, id: id, failSave: failSave, usersById: usersById, access: access,
    projectAllowed: projectAllowed, sessionAllowed: sessionAllowed, accessCalls: accessCalls,
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

test("stale Cancel and Send now controls cannot mutate a replacement", function () {
  var fx = fixture();
  var first = fx.adapter.schedule(fx.session, "first", 200000, { id: "owner-a" });
  var second = fx.adapter.schedule(fx.session, "second", 210000, { id: "owner-a" });
  var ws = {};
  var stale = { jobId: first.id, revision: first.payload.revision };
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }, ws, null, stale), false);
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }, ws, stale), false);
  assert.strictEqual(fx.scheduler.getJob(second.id).state, "queued");
  var current = { jobId: second.id, revision: second.payload.revision };
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }, ws, null, current), true);
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
  assert.strictEqual(fx.adapter.cancel(fx.session, { id: "owner-a" }), false);
  assert.strictEqual(fx.adapter.sendNow(fx.session, { id: "owner-a" }), false);
  await flush();
  assert.strictEqual(calls, 1);
  release();
  await finish(fx);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "completed");
  assert.strictEqual(fx.events.filter(function (event) { return event.type === "scheduled_message_cancelled"; }).length, 0);
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
    assert.strictEqual(fx.scheduler.getJob(current.id).state, outcomes[oi] === "reject" ? "failed" : "completed", outcomes[oi]);
    assert.strictEqual(fx.scheduler.getJob(successor.id).state, "queued", outcomes[oi]);
    assert.strictEqual(fx.session.scheduledMessage.jobId, successor.id, outcomes[oi]);
    assert.strictEqual(fx.session.rateLimitAutoContinuePending, true, outcomes[oi]);
    if (outcomes[oi] === "reject") assert.strictEqual(fx.session.isProcessing, false);
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
  var newerQuery = { id: "ordinary" };
  fx.session._queryGeneration++;
  fx.session.queryInstance = newerQuery;
  fx.session.isProcessing = true;
  rejectScheduled(new Error("old query rejected late"));
  await finish(fx);
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "failed");
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
  assert.strictEqual(sdkFailure.scheduler.getJob(job.id).state, "failed");
  assert.strictEqual(sdkFailure.session.isProcessing, false);
  assert.ok(sdkFailure.direct.some(function (event) { return event.type === "status" && event.status === "idle"; }));
  assert.ok(sdkFailure.events.some(function (event) { return event.type === "error" && /SDK startup failed/.test(event.text); }));
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
  assert.strictEqual(fx.scheduler.getJob(job.id).state, "running");
  await fx.scheduler.shutdown();
  release();
  var restarted = fixture({ saved: fx.saved, id: fx.id, clock: fx.clock });
  var states = [];
  restarted.adapter.sendState(restarted.session, null, function (message) { states.push(message); });
  assert.strictEqual(restarted.scheduler.getJob(job.id).state, "interrupted");
  assert.strictEqual(states[0].interrupted.jobId, job.id);
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
  assert.strictEqual(stored.execution.receipt.state, "dispatching");
  assert.strictEqual(stored.execution.receipt.cliSessionId, "cli-stable");
  assert.deepStrictEqual(fx.events.filter(function (event) { return /^scheduled_message_/.test(event.type); }).map(function (event) { return event.type; }), ["scheduled_message_queued", "scheduled_message_sent"]);
  assert.strictEqual(fx.fileMessages[0].type, "user_message");
  assert.strictEqual(fx.fileMessages[0].scheduledJobId, job.id);
  assert.strictEqual(fx.fileMessages[0].scheduledRevision, job.payload.revision);
  assert.ok(fx.trace.indexOf("append:user_message") < fx.trace.indexOf("sdk"));
  assert.ok(fx.trace.indexOf("sdk") < fx.trace.indexOf("record:scheduled_message_sent"));
  assert.strictEqual(fx.sdkCalls[0].linuxUser, "linux-a");
  await fx.scheduler.shutdown();
});
