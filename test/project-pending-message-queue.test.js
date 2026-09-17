var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var test = require("node:test");
var createPendingMessageQueue = require("../lib/project-pending-message-queue").createPendingMessageQueue;
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;
var createSDKBridge = require("../lib/sdk-bridge").createSDKBridge;
var VENDOR_REGISTRY = require("../lib/yoke/vendor-registry").VENDOR_REGISTRY;

function fixture() {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-pending-") );
  var session = { localId: 7, cliSessionId: "provider-session", ownerId: "user-a", isProcessing: true };
  var sent = [];
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    send: function (target, message) { sent.push({ target: target, message: message }); },
    authorize: function (target, actor) { return !!(target && actor && actor.id === "user-a"); },
  });
  return { dir: dir, session: session, queue: queue, sent: sent };
}

test("busy admission preserves attachments, reorder/edit/cancel and drains once", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  f.queue.admit(f.session, { text: "first", clientMessageId: "c1", images: [{ mediaType: "image/png", data: "abc" }], pastes: ["paste"] }, actor);
  f.queue.admit(f.session, { text: "second", clientMessageId: "c2" }, actor);
  var items = f.queue.list(f.session, actor);
  assert.deepEqual(items.map(function (item) { return item.message.text; }), ["first", "second"]);
  assert.deepEqual(items[0].message.images, [{ mediaType: "image/png", data: "abc" }], "attachment payload survives queue storage");
  var revision = f.queue.getRevision();
  assert.equal(f.queue.reorder(f.session, actor, [items[1].id, items[0].id], revision, f.session.localId).ok, true);
  items = f.queue.list(f.session, actor);
  assert.equal(f.queue.edit(f.session, actor, items[0].id, f.queue.getRevision(), f.session.localId, { text: "edited", clientMessageId: "c2" }).ok, true);
  items = f.queue.list(f.session, actor);
  assert.equal(f.queue.cancel(f.session, actor, items[1].id, f.queue.getRevision(), f.session.localId).ok, true);
  f.session.isProcessing = false;
  var first = f.queue.consumeOne(f.session, function (item, complete) { complete(item.message.text === "edited"); return true; });
  assert.equal(first.message.text, "edited");
  assert.equal(f.queue.consumeOne(f.session, function () { return true; }), null);
  assert.equal(f.queue.consumeOne(f.session), null);
});

test("stale revisions and unauthorized mutations are rejected", function () {
  var f = fixture();
  var item = f.queue.admit(f.session, { text: "safe", clientMessageId: "x" }, { id: "user-a" });
  var id = f.queue.list(f.session, { id: "user-a" })[0].id;
  assert.equal(f.queue.edit(f.session, { id: "user-a" }, id, item.revision - 1, f.session.localId, { text: "stale" }).ok, false);
  assert.equal(f.queue.cancel(f.session, { id: "user-b" }, id, f.queue.getRevision(), f.session.localId).ok, false);
  assert.equal(f.queue.list(f.session, { id: "user-b" }).length, 0);
});

test("queue reload hydrates by stable provider session and isolates projects", function () {
  var f = fixture();
  f.queue.admit(f.session, { text: "reconnect", clientMessageId: "r1" }, { id: "user-a" });
  var reloaded = createPendingMessageQueue({ filePath: path.join(f.dir, "queue.json"), slug: "project-a", authorize: function () { return true; } });
  var restored = { localId: 99, sessionOriginId: f.session.sessionOriginId, cliSessionId: "provider-session" };
  assert.equal(reloaded.list(restored, { id: "user-a" })[0].message.text, "reconnect");
  var other = createPendingMessageQueue({ filePath: path.join(f.dir, "queue.json"), slug: "project-b", authorize: function () { return true; } });
  assert.equal(other.list(restored, { id: "user-a" }).length, 0);
});

test("queue hydration rejects a stale socket session with a correlated empty result", function () {
  var f = fixture();
  var sent = [];
  f.queue.admit(f.session, { text: "private", clientMessageId: "private-queue" }, { id: "user-a" });
  var handler = attachUserMessage({
    cwd: f.dir, slug: "project-a", isMate: false, osUsers: false, sm: { saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {} }, sdk: {}, nm: {}, tm: {}, clients: new Set(), send: function () {}, sendTo: function (_ws, message) { sent.push(message); }, sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {},
    usersModule: { isMultiUser: function () { return false; } }, matesModule: {}, _loop: { handleLoopMessage: function () { return false; } }, getSessionForWs: function () { return f.session; }, getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {}, hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: f.dir, onProcessingChanged: function () {}, gitAttribution: null, browserState: { _browserTabList: {} }, requestTabContext: function () {}, loadContextSources: function () { return []; }, saveContextSources: function () {}, adapter: {}, _email: null, pendingMessageQueue: f.queue,
  });
  handler.handleUserMessage({ _clayUser: { id: "user-a" } }, { type: "pending_message_get", projectSlug: "project-a", sessionId: 99, requestId: "stale-get" });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, "pending_message_result");
  assert.equal(sent[0].requestId, "stale-get");
  assert.deepEqual(sent[0].result, { ok: false, error: "Session changed", projectSlug: "project-a", sessionId: 99, revision: 0, paused: false, items: [] });
});

test("stop pauses drain and cancelled client IDs remain tombstoned", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  f.queue.admit(f.session, { text: "cancel me", clientMessageId: "cancel-id" }, actor);
  var item = f.queue.list(f.session, actor)[0];
  assert.equal(f.queue.cancel(f.session, actor, item.id, f.queue.getRevision(), f.session.localId).ok, true);
  assert.equal(f.queue.admit(f.session, { text: "resurrect", clientMessageId: "cancel-id" }, actor).ok, false);
  f.queue.admit(f.session, { text: "wait", clientMessageId: "wait-id" }, actor);
  f.session.isProcessing = false;
  f.session._pendingMessageDrainPaused = true;
  assert.equal(f.queue.consumeOne(f.session, function () { return true; }), null);
  f.session._pendingMessageDrainPaused = false;
  f.session.rateLimitResetsAt = Date.now() + 10000;
  assert.equal(f.queue.consumeOne(f.session, function () { return true; }), null);
  f.session.rateLimitResetsAt = null;
  assert.equal(f.queue.consumeOne(f.session, function (queued, complete) { complete(true); return true; }).message.text, "wait");
});

test("edit whitelists text, validates reorder IDs, and keeps stable origin across CLI binding", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  var originSession = { localId: 7, sessionOriginId: "origin-1", isProcessing: true };
  var admitted = f.queue.admit(originSession, { text: "original", clientMessageId: "stable" }, actor);
  var item = f.queue.list(originSession, actor)[0];
  assert.equal(f.queue.edit(originSession, actor, item.id, admitted.revision, originSession.localId, { text: "" }).ok, false);
  assert.equal(f.queue.edit(originSession, actor, item.id, f.queue.getRevision(), originSession.localId, { text: "updated", clientMessageId: "overwritten", autonomousRunToken: "bad" }).ok, true);
  var boundSession = { localId: 8, sessionOriginId: "origin-1", cliSessionId: "new-cli-id" };
  assert.equal(f.queue.list(boundSession, actor)[0].message.clientMessageId, "stable");
  var current = f.queue.list(boundSession, actor);
  assert.equal(f.queue.reorder(boundSession, actor, [current[0].id, current[0].id], f.queue.getRevision(), boundSession.localId).ok, false);
  assert.equal(f.queue.reorder(boundSession, actor, ["foreign"], f.queue.getRevision(), boundSession.localId).ok, false);
  assert.equal(f.queue.list(boundSession, actor)[0].message.autonomousRunToken, undefined);
});

test("image edits support omitted, replace, add, and remove semantics with authorization and rollback", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  var original = { mediaType: "image/png", data: "old", url: "/forbidden", metadata: "drop" };
  var admitted = f.queue.admit(f.session, { text: "caption", images: [original], pastes: ["keep"] }, actor);
  var item = f.queue.list(f.session, actor)[0];
  assert.deepEqual(f.queue.list(f.session, actor)[0].message.images, [{ mediaType: "image/png", data: "old" }]);
  assert.equal(f.queue.edit(f.session, actor, item.id, admitted.revision, f.session.localId, { text: "omitted" }).ok, true);
  assert.deepEqual(f.queue.list(f.session, actor)[0].message.images, [{ mediaType: "image/png", data: "old" }]);
  var revision = f.queue.getRevision();
  assert.equal(f.queue.edit(f.session, actor, item.id, revision, f.session.localId, { text: "replaced", images: [{ mediaType: "image/jpeg", data: "new" }] }).ok, true);
  assert.equal(f.queue.edit(f.session, actor, item.id, f.queue.getRevision(), f.session.localId, { text: "added", images: [{ mediaType: "image/jpeg", data: "new" }, { mediaType: "image/png", data: "add" }] }).ok, true);
  assert.deepEqual(f.queue.list(f.session, actor)[0].message.pastes, ["keep"]);
  assert.deepEqual(f.queue.list(f.session, actor)[0].message.images, [{ mediaType: "image/jpeg", data: "new" }, { mediaType: "image/png", data: "add" }]);
  var imageOnlySession = { localId: 31, sessionOriginId: "image-only", isProcessing: true };
  f.queue.admit(imageOnlySession, { text: "", images: [{ mediaType: "image/png", data: "only" }] }, actor);
  var imageOnlyItem = f.queue.list(imageOnlySession, actor)[0];
  assert.equal(f.queue.edit(imageOnlySession, actor, imageOnlyItem.id, f.queue.getRevision(), imageOnlySession.localId, { text: "", images: [] }).ok, false);
  assert.equal(f.queue.edit(f.session, actor, item.id, f.queue.getRevision(), f.session.localId, { text: "bad", images: [null] }).ok, false);
  assert.equal(f.queue.edit(f.session, actor, item.id, f.queue.getRevision(), f.session.localId, { text: "bad", images: ["not-an-image"] }).ok, false);
  assert.equal(f.queue.edit(f.session, { id: "user-b" }, item.id, f.queue.getRevision(), f.session.localId, { text: "foreign", images: [] }).ok, false);
  assert.equal(f.queue.edit(f.session, actor, item.id, revision, f.session.localId, { text: "stale", images: [] }).ok, false);
  var saves = 0;
  var failing = createPendingMessageQueue({ filePath: path.join(f.dir, "image-rollback.json"), slug: "project-a", authorize: function () { return true; }, persist: function () { saves++; if (saves > 1) throw new Error("disk full"); } });
  var rollbackSession = { localId: 30, sessionOriginId: "image-rollback", isProcessing: true };
  failing.admit(rollbackSession, { text: "before", images: [{ mediaType: "image/png", data: "stable" }] }, actor);
  var rollbackItem = failing.list(rollbackSession, actor)[0];
  assert.equal(failing.edit(rollbackSession, actor, rollbackItem.id, failing.getRevision(), rollbackSession.localId, { text: "after", images: [] }).ok, false);
  assert.deepEqual(failing.list(rollbackSession, actor)[0].message.images, [{ mediaType: "image/png", data: "stable" }]);
});

test("storage failure rolls back admission and mutation state", function () {
  var f = fixture();
  var writes = 0;
  var failing = createPendingMessageQueue({
    filePath: path.join(f.dir, "failure.json"),
    slug: "project-a",
    authorize: function () { return true; },
    persist: function () { writes++; throw new Error("disk full"); },
  });
  var session = { localId: 1, sessionOriginId: "origin-failure", isProcessing: true };
  assert.equal(failing.admit(session, { text: "lost", clientMessageId: "lost" }, { id: "user-a" }).ok, false);
  assert.equal(failing.list(session, { id: "user-a" }).length, 0);
  assert.equal(writes, 1);
  var saves = 0;
  var transactional = createPendingMessageQueue({
    filePath: path.join(f.dir, "transactional.json"), slug: "project-a", authorize: function () { return true; },
    persist: function () { saves++; if (saves > 1) throw new Error("disk full"); },
  });
  var stable = { localId: 2, sessionOriginId: "origin-transactional", isProcessing: true };
  assert.equal(transactional.admit(stable, { text: "before" }, { id: "user-a" }).ok, true);
  var stableItem = transactional.list(stable, { id: "user-a" })[0];
  assert.equal(transactional.edit(stable, { id: "user-a" }, stableItem.id, transactional.getRevision(), stable.localId, { text: "after" }).ok, false);
  assert.equal(transactional.list(stable, { id: "user-a" })[0].message.text, "before");
});

test("scheduled admission persists complete metadata once before broadcasting", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-queue-"));
  var writes = 0;
  var events = [];
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    authorize: function () { return true; },
    persist: function () { writes++; },
    broadcast: function (session, event) { events.push(event); },
  });
  var session = { localId: 1, sessionOriginId: "scheduled-origin" };
  var actor = { id: "user-a" };
  var schedule = { jobId: "job-1", revision: "rev-1", notBefore: Date.now() + 60000, ready: false };
  var admitted = queue.upsertScheduled(session, { text: "later", clientMessageId: "scheduled-1", schedule: schedule }, actor, schedule);
  assert.equal(admitted.ok, true);
  assert.equal(writes, 1);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].item.schedule, schedule);
  assert.deepEqual(queue.list(session, actor)[0].schedule, schedule);
  assert.equal(queue.getRevision(), 1);
});

test("scheduled admission failure leaves empty state, revision, and events unchanged", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-failure-"));
  var events = [];
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    authorize: function () { return true; },
    persist: function () { throw new Error("disk full"); },
    broadcast: function (session, event) { events.push(event); },
  });
  var session = { localId: 2, sessionOriginId: "scheduled-failure" };
  var schedule = { jobId: "job-fail", revision: "rev-fail", notBefore: Date.now(), ready: false };
  assert.equal(queue.upsertScheduled(session, { text: "lost", schedule: schedule }, { id: "user-a" }, schedule).ok, false);
  assert.equal(queue.list(session, { id: "user-a" }).length, 0);
  assert.equal(queue.getRevision(), 0);
  assert.equal(events.length, 0);
});

test("scheduled terminal items stay tombstoned and edits do not invoke scheduler hooks", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-terminal-"));
  var hookCalls = 0;
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    authorize: function () { return true; },
    beforeEdit: function () { hookCalls++; throw new Error("scheduler hook must not run"); },
  });
  var session = { localId: 3, sessionOriginId: "scheduled-terminal" };
  var actor = { id: "user-a" };
  var schedule = { jobId: "job-terminal", revision: "rev-terminal", notBefore: Date.now(), ready: false };
  var admitted = queue.upsertScheduled(session, { text: "original", schedule: schedule }, actor, schedule);
  var item = queue.list(session, actor)[0];
  assert.equal(queue.edit(session, actor, item.id, admitted.revision, session.localId, { text: "edited" }).ok, true);
  assert.equal(hookCalls, 0);
  assert.deepEqual(queue.list(session, actor)[0].schedule, schedule);
  assert.equal(queue.cancel(session, actor, item.id, queue.getRevision(), session.localId).ok, true);
  var terminalRevision = queue.getRevision();
  assert.equal(queue.upsertScheduled(session, { text: "resurrect", schedule: schedule }, actor, schedule).ok, false);
  assert.equal(queue.getRevision(), terminalRevision);
  assert.equal(queue.list(session, actor)[0].state, "cancelled");
  assert.equal(queue.list(session, actor)[0].message.text, "edited");
});

test("scheduled upsert validates and rolls back existing items atomically", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-scheduled-upsert-"));
  var writes = 0;
  var events = [];
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    authorize: function (session, actor) { return !!(actor && actor.id === "user-a"); },
    persist: function () { writes++; if (writes > 1) throw new Error("disk full"); },
    broadcast: function (session, event) { events.push(event); },
  });
  var session = { localId: 4, sessionOriginId: "scheduled-upsert" };
  var actor = { id: "user-a" };
  var schedule = { jobId: "job-upsert", revision: "rev-upsert", notBefore: Date.now(), ready: false };
  assert.equal(queue.upsertScheduled(session, { text: "before", schedule: schedule }, actor, schedule).ok, true);
  var item = queue.list(session, actor)[0];
  var revision = queue.getRevision();
  assert.equal(queue.upsertScheduled(session, { text: "after", schedule: schedule }, actor, schedule).ok, false);
  assert.equal(queue.getRevision(), revision);
  assert.equal(queue.list(session, actor)[0].message.text, "before");
  assert.equal(events.length, 1);
  assert.equal(queue.upsertScheduled(session, { text: "foreign", schedule: schedule }, { id: "user-b" }, schedule).ok, false);
  assert.equal(queue.list(session, actor)[0].message.text, "before");
  assert.equal(item.schedule.ready, false);
});

test("handler admits busy input outside history and consumes the exact queued item once", async function () {
  var f = fixture();
  var started = [];
  var session = { localId: 7, cliSessionId: "provider-session", isProcessing: true, history: [], pendingMentionContexts: [], pendingShellContexts: [] };
  var ws = { _clayUser: { id: "user-a" }, readyState: 1, send: function () {} };
  var handler = attachUserMessage({
    cwd: f.dir, slug: "project-a", isMate: false, osUsers: false, sm: {
      saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {}
    }, sdk: { startQuery: function (target, text, images, linuxUser, beforePush, accepted) { started.push({ target: target, text: text }); if (beforePush()) accepted(); return Promise.resolve(true); } },
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: { create: function () {}, attach: function () {}, list: function () { return []; } }, clients: new Set(),
    send: function () {}, sendTo: function (target, message) { if (target && target.send) target.send(JSON.stringify(message)); },
    sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {}, usersModule: { isMultiUser: function () { return false; }, findUserById: function (id) { return { id: id }; } }, matesModule: {},
    _loop: { handleLoopMessage: function () { return false; } },
    getSessionForWs: function () { return session; }, getLinuxUserForSession: function () {},
    ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: f.dir,
    onProcessingChanged: function () {}, gitAttribution: null, browserState: { _browserTabList: {} }, authorizePendingDispatch: function () { return true; },
    requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return []; },
    saveContextSources: function () {}, adapter: { renameSession: function () { return Promise.resolve(); } }, _email: null, pendingMessageQueue: f.queue,
  });
  assert.equal(handler.handleUserMessage(ws, { type: "message", text: "queued", clientMessageId: "handler-1", _pendingConsumed: true }), true);
  assert.equal(session.history.length, 0, "busy admission does not write transcript");
  assert.equal(f.queue.list(session, ws._clayUser).length, 1);
  session.isProcessing = false;
  assert.equal(handler.consumePendingMessage(session), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started.length, 1);
  assert.equal(started[0].target, session);
  assert.equal(handler.consumePendingMessage(session), false, "claimed item cannot be delivered twice");
  assert.equal(handler.handleUserMessage(ws, { type: "message", text: "cancelled", clientMessageId: "idle-cancel-retry" }), true);
  var cancelled = f.queue.inspect(session, ws._clayUser, "idle-cancel-retry");
  assert.equal(f.queue.cancel(session, ws._clayUser, cancelled.id, f.queue.getRevision(), session.localId).ok, true);
  session.isProcessing = false;
  assert.equal(handler.handleUserMessage(ws, { type: "message", text: "cancelled replay", clientMessageId: "idle-cancel-retry" }), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started.length, 1, "an idle replay of a cancelled client id never dispatches directly");

  session.isProcessing = true;
  assert.equal(handler.handleUserMessage(ws, { type: "message", text: "paused first", clientMessageId: "paused-first" }), true);
  assert.equal(f.queue.pause(session, ws._clayUser), true);
  session._pendingMessageDrainPaused = true;
  session.isProcessing = false;
  assert.equal(handler.handleUserMessage(ws, { type: "message", text: "paused second", clientMessageId: "paused-second" }), true);
  assert.equal(started.length, 1, "a new message cannot bypass an existing paused queue");
  assert.equal(handler.handleUserMessage(ws, {
    type: "pending_message_resume",
    projectSlug: "project-a",
    sessionId: session.localId,
    revision: f.queue.getRevision(),
    requestId: "resume-paused",
  }), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started[1].text, "paused first", "resume dispatches the existing FIFO head");
  assert.deepEqual(f.queue.list(session, ws._clayUser).filter(function (item) { return item.state === "pending"; }).map(function (item) { return item.message.text; }), ["paused second"]);
  session.isProcessing = false;
  assert.equal(handler.consumePendingMessage(session), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started[2].text, "paused second", "the later message remains behind the paused FIFO head");
});

test("vendor-neutral lifecycle works for every registered adapter identity", function () {
  var vendors = Object.keys(VENDOR_REGISTRY);
  for (var vi = 0; vi < vendors.length; vi++) {
    var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-vendor-queue-"));
    var events = [];
    var queue = createPendingMessageQueue({
      filePath: path.join(dir, "queue.json"), slug: "project-a", authorize: function () { return true; },
      send: function (session, message) { events.push(message); },
    });
    var session = { localId: vi + 1, sessionOriginId: "origin-" + vendors[vi], vendor: vendors[vi], isProcessing: true };
    var actor = { id: "user-a" };
    assert.equal(queue.admit(session, { text: "queued-" + vendors[vi], clientMessageId: "vendor-" + vi }, actor).ok, true, vendors[vi] + " admission");
    var item = queue.list(session, actor)[0];
    assert.equal(queue.edit(session, actor, item.id, queue.getRevision(), session.localId, { text: "edited-" + vendors[vi] }).ok, true, vendors[vi] + " edit");
    session.isProcessing = false;
    assert.equal(queue.consumeOne(session, function (queued, complete) { complete(true); return true; }).state, "consumed", vendors[vi] + " consume");
    assert.equal(queue.consumeOne(session, function () { return true; }), null, vendors[vi] + " exactly once");
    assert.ok(events.some(function (event) { return event.type === "pending_message_consumed" && event.state === "consumed"; }), vendors[vi] + " normalized lifecycle event");
  }
});

test("claim persistence failure restores pending state and does not reserve RAM", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-claim-rollback-"));
  var writes = 0;
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"), slug: "project-a", authorize: function () { return true; },
    persist: function () { writes++; if (writes === 2) throw new Error("disk full"); },
  });
  var session = { localId: 4, isProcessing: true };
  var actor = { id: "user-a" };
  assert.equal(queue.admit(session, { text: "still pending", clientMessageId: "claim-save" }, actor).ok, true);
  session.isProcessing = false;
  assert.equal(queue.consumeOne(session, function () { throw new Error("must not dispatch"); }), null);
  assert.equal(queue.list(session, actor)[0].state, "pending");
  assert.equal(session._pendingMessageClaimId, undefined);
});

test("unknown provider identity is persisted before CLI binding", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-origin-queue-"));
  var persistedOrigin = null;
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"), slug: "project-a", authorize: function () { return true; },
    ensureSessionIdentity: function (session) { persistedOrigin = session.sessionOriginId; },
  });
  var session = { localId: 11, isProcessing: true };
  queue.admit(session, { text: "before boot" }, { id: "user-a" });
  assert.equal(session.sessionOriginId, persistedOrigin);
  session.cliSessionId = "bound-later";
  assert.equal(queue.list(session, { id: "user-a" }).length, 1);
  assert.equal(queue.list({ localId: 12, cliSessionId: "bound-later" }, { id: "user-a" }).length, 0);
});

test("reorder replaces only the requesting actor's exact pending positions", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-cross-user-queue-"));
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"), slug: "project-a", authorize: function () { return true; },
    canMutate: function (session, actor, item) { return !item || item.actorId === actor.id; },
  });
  var session = { localId: 9, sessionOriginId: "shared-origin", isProcessing: true };
  var userA = { id: "user-a" };
  var userB = { id: "user-b" };
  queue.admit(session, { text: "a1" }, userA);
  queue.admit(session, { text: "b1" }, userB);
  queue.admit(session, { text: "a2" }, userA);
  var all = queue.list(session, userA);
  var aIds = all.filter(function (item) { return item.actorId === "user-a"; }).map(function (item) { return item.id; });
  assert.equal(queue.reorder(session, userA, [aIds[1], aIds[0]], queue.getRevision(), session.localId).ok, true);
  assert.deepEqual(queue.list(session, userA).map(function (item) { return item.message.text; }), ["a2", "b1", "a1"]);
  assert.equal(queue.reorder(session, userA, [aIds[0], aIds[1]], queue.getRevision(), 99).ok, false);
});

test("malformed storage and oversized payloads fail closed", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-malformed-queue-"));
  var file = path.join(dir, "queue.json");
  fs.writeFileSync(file, "{not-json");
  var queue = createPendingMessageQueue({ filePath: file, slug: "project-a", authorize: function () { return true; } });
  var session = { localId: 1 };
  assert.equal(queue.admit(session, { text: "must not overwrite" }, { id: "user-a" }).ok, false);
  assert.equal(fs.readFileSync(file, "utf8"), "{not-json");
  var clean = createPendingMessageQueue({ filePath: path.join(dir, "clean.json"), slug: "project-a", authorize: function () { return true; } });
  assert.equal(clean.admit(session, { text: "x".repeat(100001) }, { id: "user-a" }).ok, false);
  assert.equal(clean.admit(session, { text: "", images: [{ mediaType: "text/plain", data: "bad" }] }, { id: "user-a" }).ok, false);
});

test("attachment-only queued messages may be edited without inventing text", function () {
  var f = fixture();
  var actor = { id: "user-a" };
  f.queue.admit(f.session, { text: "", images: [{ mediaType: "image/png", data: "abc" }] }, actor);
  var item = f.queue.list(f.session, actor)[0];
  assert.equal(f.queue.edit(f.session, actor, item.id, f.queue.getRevision(), f.session.localId, { text: "" }).ok, true);
});

test("async preparation holds one reservation and rechecks authorization before dispatch", async function () {
  var f = fixture();
  var session = f.session;
  session.history = [];
  session.pendingMentionContexts = [];
  session.pendingShellContexts = [];
  var authorized = true;
  var resolveEmail;
  var emailReady = new Promise(function (resolve) { resolveEmail = resolve; });
  var started = [];
  var ws = { _clayUser: { id: "user-a" }, readyState: 1, send: function () {} };
  var handler = attachUserMessage({
    cwd: f.dir, slug: "project-a", isMate: false, osUsers: false,
    sm: { saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {} },
    sdk: { startQuery: function (target, text, images, linuxUser, beforePush, accepted) { if (!beforePush()) return Promise.resolve(false); started.push(text); accepted(); return Promise.resolve(true); } },
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: { create: function () {}, attach: function () {}, list: function () { return []; } }, clients: new Set(),
    send: function () {}, sendTo: function () {}, sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {},
    usersModule: { isMultiUser: function () { return false; }, findUserById: function (id) { return { id: id }; } }, matesModule: {},
    _loop: { handleLoopMessage: function () { return false; } }, getSessionForWs: function () { return session; },
    getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: f.dir,
    onProcessingChanged: function () {}, gitAttribution: null, browserState: { _browserTabList: {} },
    requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return ["email:inbox"]; },
    saveContextSources: function () {}, adapter: { renameSession: function () { return Promise.resolve(); } },
    _email: { getEmailContext: function () { return emailReady; } }, pendingMessageQueue: f.queue,
    authorizePendingDispatch: function () { return authorized; },
  });
  handler.handleUserMessage(ws, { type: "message", text: "first", clientMessageId: "async-1" });
  handler.handleUserMessage(ws, { type: "message", text: "second", clientMessageId: "async-2" });
  session.isProcessing = false;
  assert.equal(handler.consumePendingMessage(session), true);
  assert.equal(handler.consumePendingMessage(session), false, "a claimed async item reserves the session");
  authorized = false;
  resolveEmail("mail context");
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started.length, 0);
  assert.equal(session.history.length, 0, "revoked work never enters the transcript");
  authorized = true;
  assert.equal(handler.consumePendingMessage(session), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started.length, 1);
  assert.match(started[0], /second/);
  assert.deepEqual(session.history.map(function (item) { return item.text; }), ["second"]);
  emailReady = new Promise(function (resolve) { resolveEmail = resolve; });
  handler.handleUserMessage(ws, { type: "message", text: "third", clientMessageId: "async-stop" });
  session.isProcessing = false;
  assert.equal(handler.consumePendingMessage(session), true);
  assert.equal(f.queue.pause(session, ws._clayUser), true);
  session._pendingMessageDrainPaused = true;
  session.taskStopRequested = true;
  resolveEmail("late mail context");
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(started.length, 1, "Stop during async preparation prevents SDK delivery");
  assert.equal(session.history.length, 1, "stopped preparation does not enter the transcript");
  assert.equal(f.queue.inspect(session, ws._clayUser, "async-stop").state, "pending");
});

test("real SDK bridge checks the pending authorization gate after async adapter boot", async function () {
  var resolveHandle;
  var markQueryStarted;
  var queryStarted = new Promise(function (resolve) { markQueryStarted = resolve; });
  var pushes = 0;
  var closes = 0;
  var allowed = true;
  var adapter = {
    vendor: "codex",
    createQuery: function () { markQueryStarted(); return new Promise(function (resolve) { resolveHandle = resolve; }); },
  };
  var session = { localId: 81, vendor: "codex", isProcessing: true, pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var sessions = new Map([[session.localId, session]]);
  var bridge = createSDKBridge({
    cwd: process.cwd(), adapter: adapter, adapters: { codex: adapter }, send: function () {},
    sessionManager: { sessions: sessions, availableModels: [], saveSessionFile: function () {}, broadcastSessionList: function () {}, sendAndRecord: function () {}, sendToSession: function () {} },
  });
  var accepted = 0;
  var started = bridge.startQuery(session, "queued", null, null, function () { return allowed && !session.taskStopRequested && !session._pendingMessageDrainPaused; }, function () { accepted++; });
  await queryStarted;
  allowed = false;
  session.taskStopRequested = true;
  session._pendingMessageDrainPaused = true;
  resolveHandle({
    pushMessage: function () { pushes++; return true; }, close: function () { closes++; },
    [Symbol.asyncIterator]: function () { return { next: function () { return Promise.resolve({ done: true }); } }; },
  });
  assert.equal(await started, false);
  assert.equal(pushes, 0);
  assert.equal(accepted, 0);
  assert.equal(closes, 1);
  assert.equal(session.taskStopRequested, false);
  assert.equal(session._pendingMessageDrainPaused, true);
});

test("real handler and SDK result processor drain two queued turns in order", async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-real-lifecycle-"));
  var queue = createPendingMessageQueue({ filePath: path.join(dir, "queue.json"), slug: "project-a", authorize: function () { return true; } });
  var session = { localId: 82, sessionOriginId: "real-lifecycle", vendor: "codex", isProcessing: true, history: [], pendingMentionContexts: [], pendingShellContexts: [], pendingAskUser: {}, pendingPermissions: {}, pendingElicitations: {} };
  var events = [];
  var waiter = null;
  var pushed = [];
  var handle = {
    pushMessage: function (text) {
      pushed.push(text);
      events.push({ yokeType: "result", cost: 0, duration: 1, usage: {}, sessionId: "provider-82" });
      if (waiter) { var resolve = waiter; waiter = null; resolve({ value: events.shift(), done: false }); }
      return true;
    },
    close: function () { if (waiter) { waiter({ value: undefined, done: true }); waiter = null; } },
    [Symbol.asyncIterator]: function () {
      return { next: function () {
        if (events.length) return Promise.resolve({ value: events.shift(), done: false });
        if (pushed.length >= 2) return Promise.resolve({ value: undefined, done: true });
        return new Promise(function (resolve) { waiter = resolve; });
      } };
    },
  };
  var sessions = new Map([[session.localId, session]]);
  var sm = {
    sessions: sessions, availableModels: [], saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {},
    sendAndRecord: function () {}, sendToSession: function () {},
  };
  var handler;
  var adapter = { vendor: "codex", createQuery: function () { return Promise.resolve(handle); }, renameSession: function () { return Promise.resolve(); } };
  var bridge = createSDKBridge({
    cwd: dir, adapter: adapter, adapters: { codex: adapter }, sessionManager: sm, send: function () {}, onProcessingChanged: function () {},
    onTurnDone: function (target) { setImmediate(function () { handler.consumePendingMessage(target); }); },
  });
  handler = attachUserMessage({
    cwd: dir, slug: "project-a", isMate: false, osUsers: false, sm: sm, sdk: bridge,
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: { create: function () {}, attach: function () {}, list: function () { return []; } }, clients: new Set(), send: function () {}, sendTo: function () {}, sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {},
    usersModule: { isMultiUser: function () { return false; }, findUserById: function (id) { return { id: id }; } }, matesModule: {}, _loop: { handleLoopMessage: function () { return false; } },
    getSessionForWs: function () { return session; }, getLinuxUserForSession: function () {}, ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: dir, onProcessingChanged: function () {}, gitAttribution: null,
    browserState: { _browserTabList: {} }, requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return []; }, saveContextSources: function () {},
    adapter: adapter, _email: null, pendingMessageQueue: queue, authorizePendingDispatch: function () { return true; },
  });
  queue.admit(session, { type: "message", text: "one", clientMessageId: "real-1" }, { id: "user-a" });
  queue.admit(session, { type: "message", text: "two", clientMessageId: "real-2" }, { id: "user-a" });
  session.isProcessing = false;
  handler.consumePendingMessage(session);
  for (var attempt = 0; attempt < 20 && pushed.length < 2; attempt++) await new Promise(function (resolve) { setImmediate(resolve); });
  assert.deepEqual(pushed, ["one", "two"]);
  assert.deepEqual(session.history.map(function (item) { return item.text; }), ["one", "two"]);
  assert.deepEqual(queue.list(session, { id: "user-a" }).map(function (item) { return item.state; }), ["consumed", "consumed"]);
});
