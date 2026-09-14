var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var test = require("node:test");

var root = path.join(__dirname, "..");
var handlerLoadCounter = 0;
function source(relativePath) { return fs.readFileSync(path.join(root, relativePath), "utf8"); }
function dataModule(code) { return "data:text/javascript;base64," + Buffer.from(code).toString("base64"); }
async function loadModel() {
  var code = source("lib/public/modules/pending-message-queue-model.js");
  return import(dataModule(code));
}

function createStore(initial) {
  var state = Object.assign({}, initial);
  return {
    get: function (key) { return state[key]; },
    snap: function () { return state; },
    set: function (update) { state = Object.assign({}, state, update); },
  };
}

async function loadHandler(initial) {
  handlerLoadCounter++;
  var loadId = handlerLoadCounter;
  var testStore = createStore(initial);
  var socket = {
    readyState: 1,
    sent: [],
    send: function (raw) { this.sent.push(JSON.parse(raw)); },
  };
  globalThis.__pendingQueueTestStore = testStore;
  globalThis.__pendingQueueTestSocket = socket;
  var replacements = {
    "./store.js": dataModule("export var store = globalThis.__pendingQueueTestStore;") + "#store-" + loadId,
    "./ws-ref.js": dataModule("export function getWs() { return globalThis.__pendingQueueTestSocket; }") + "#ws-" + loadId,
    "./utils.js": dataModule("export function escapeHtml(value) { return String(value); }") + "#utils-" + loadId,
    "./icons.js": dataModule("export function refreshIcons() {}") + "#icons-" + loadId,
    "./pending-message-queue-model.js": dataModule(source("lib/public/modules/pending-message-queue-model.js")) + "#model-" + loadId,
  };
  var code = source("lib/public/modules/pending-message-queue.js");
  Object.keys(replacements).forEach(function (specifier) {
    code = code.split("'" + specifier + "'").join(JSON.stringify(replacements[specifier]));
  });
  var module = await import(dataModule(code) + "#handler-" + loadId);
  return { module: module, socket: socket, store: testStore };
}

function queueState(overrides) {
  return Object.assign({
    connected: true,
    currentSlug: "project-a",
    activeSessionId: 7,
    activeSessionMode: "gui",
    dmMode: false,
    mateProjectSlug: null,
    myUserId: "user-a",
    isMultiUserMode: true,
    pendingMessageQueue: {
      projectSlug: "project-a",
      sessionId: 7,
      revision: 5,
      paused: false,
      items: [{ id: "pm_1", state: "pending", actorId: "user-a", message: { text: "server text" } }],
      loading: false,
      error: "",
    },
    pendingMessageQueueRequests: {},
    pendingMessageQueueEdit: { id: "pm_1", text: "unsaved local draft", error: "" },
    pendingMessageQueueDrag: null,
    pendingMessageQueueFocusReturn: null,
  }, overrides || {});
}

test("pending queue model filters terminal rows and reorders exact owned IDs", async function () {
  var model = await loadModel();
  var items = [{ id: "a", state: "pending" }, { id: "b", state: "claimed" }, { id: "c", state: "cancelled" }];
  assert.deepEqual(model.activeQueueItems(items).map(function (item) { return item.id; }), ["a", "b"]);
  assert.deepEqual(model.moveQueueId(["a", "b", "c"], "c", 0, "a"), ["c", "a", "b"]);
  assert.deepEqual(model.moveQueueId(["a", "b"], "a", -1, null), ["a", "b"]);
});

test("pending queue model rejects switched context and older revisions", async function () {
  var model = await loadModel();
  assert.equal(model.matchesQueueContext({ projectSlug: "one", sessionId: 7 }, "one", "7"), true);
  assert.equal(model.matchesQueueContext({ projectSlug: "one", sessionId: 7 }, "two", 7), false);
  assert.equal(model.canApplyQueueRevision(5, 4), false);
  assert.equal(model.canApplyQueueRevision(5, 5), true);
});

test("ordinary project sends render only from a correlated server acknowledgement", function () {
  var input = source("lib/public/modules/input.js");
  var messages = source("lib/public/modules/app-messages.js");
  var sendStart = input.indexOf("var payload = { type: \"message\"");
  var sendEnd = input.indexOf("export function handleAcceptedOrdinaryMessage", sendStart);
  var sendBody = input.slice(sendStart, sendEnd);
  assert.doesNotMatch(sendBody, /ctx\.addUserMessage/);
  assert.match(sendBody, /sendAcknowledgedMessage\(payload\)/);
  assert.match(messages, /acknowledgedContext && !acknowledgedEl && msg\.message/);
  assert.match(messages, /msg\.clientMessageId && messagesEl\.querySelector/);
});

test("live browser fixture uses the real queue and handler with the production client module", function () {
  var server = source("test/fixtures/pending-message-ui-server.js");
  var page = source("test/fixtures/pending-message-ui.html");
  assert.match(server, /project-pending-message-queue/);
  assert.match(server, /project-user-message/);
  assert.match(page, /modules\/pending-message-queue\.js/);
  assert.match(page, /Main composer draft stays here/);
});

test("text-only edits skip render and pointer cancellation cannot reorder", function () {
  var client = source("lib/public/modules/pending-message-queue.js");
  assert.match(client, /editNeedsRender[\s\S]*edit\.error !== previousEdit\.error/);
  assert.match(client, /pointercancel", cleanupDrag/);
  assert.doesNotMatch(client, /pointercancel", finishDrag/);
  assert.match(client, /restoreFocus\(focus\)/);
});

test("queue handler preserves an edit draft on conflict and only rehydrates", async function () {
  var requestContext = { connected: true, projectSlug: "project-a", sessionId: 7, accountId: "user-a", enabled: true };
  var harness = await loadHandler(queueState({
    pendingMessageQueueRequests: { editRequest: { kind: "edit", itemId: "pm_1", context: requestContext } },
  }));

  assert.equal(harness.module.handlePendingMessageQueueMessage({
    type: "pending_message_result",
    requestId: "editRequest",
    result: { ok: false, error: "Stale queue revision", projectSlug: "project-a", sessionId: 7, revision: 5 },
  }), true);
  assert.deepEqual(harness.store.get("pendingMessageQueueEdit"), {
    id: "pm_1",
    text: "unsaved local draft",
    error: "Stale queue revision",
  });
  assert.equal(harness.store.get("pendingMessageQueue").error, "Stale queue revision");
  assert.equal(harness.store.get("pendingMessageQueue").loading, true);
  assert.deepEqual(harness.socket.sent.map(function (message) { return message.type; }), ["pending_message_get"]);
  assert.equal(Object.prototype.hasOwnProperty.call(harness.store.get("pendingMessageQueueRequests"), "editRequest"), false);
});

test("queue handler ignores canonical state and mutation results after a project switch", async function () {
  var requestContext = { connected: true, projectSlug: "project-a", sessionId: 7, accountId: "user-a", enabled: true };
  var harness = await loadHandler(queueState({
    currentSlug: "project-b",
    activeSessionId: 12,
    pendingMessageQueueRequests: { oldRequest: { kind: "edit", itemId: "pm_1", context: requestContext } },
  }));
  var queueBefore = harness.store.get("pendingMessageQueue");
  var editBefore = harness.store.get("pendingMessageQueueEdit");

  assert.equal(harness.module.handlePendingMessageQueueMessage({
    type: "pending_message_state",
    projectSlug: "project-a",
    sessionId: 7,
    revision: 99,
    paused: true,
    items: [{ id: "wrong-project-item", state: "pending" }],
  }), true);
  assert.equal(harness.module.handlePendingMessageQueueMessage({
    type: "pending_message_result",
    requestId: "oldRequest",
    result: { ok: false, error: "Stale queue revision", projectSlug: "project-a", sessionId: 7, revision: 99 },
  }), true);
  assert.equal(harness.store.get("pendingMessageQueue"), queueBefore);
  assert.equal(harness.store.get("pendingMessageQueueEdit"), editBefore);
  assert.deepEqual(harness.socket.sent, []);
  assert.deepEqual(harness.store.get("pendingMessageQueueRequests"), {});
});

test("failed queue hydration settles without sending another request", async function () {
  var requestContext = { connected: true, projectSlug: "project-a", sessionId: 7, accountId: "user-a", enabled: true };
  var harness = await loadHandler(queueState({
    pendingMessageQueue: Object.assign({}, queueState().pendingMessageQueue, { loading: true }),
    pendingMessageQueueRequests: { getRequest: { kind: "get", context: requestContext } },
  }));

  assert.equal(harness.module.handlePendingMessageQueueMessage({
    type: "pending_message_result",
    requestId: "getRequest",
    result: { ok: false, error: "Queue storage unavailable", projectSlug: "project-a", sessionId: 7, revision: 5 },
  }), true);
  assert.equal(harness.store.get("pendingMessageQueue").loading, false);
  assert.equal(harness.store.get("pendingMessageQueue").error, "Queue storage unavailable");
  assert.deepEqual(harness.socket.sent, []);
  assert.deepEqual(harness.store.get("pendingMessageQueueRequests"), {});
});

test("old successful edit acknowledgement preserves a newer editor generation", async function () {
  var requestContext = { connected: true, projectSlug: "project-a", sessionId: 7, accountId: "user-a", enabled: true };
  var newerEdit = { id: "pm_1", text: "newer local draft", error: "", generation: 12 };
  var harness = await loadHandler(queueState({
    pendingMessageQueueEdit: newerEdit,
    pendingMessageQueueRequests: {
      oldEditRequest: {
        kind: "edit",
        itemId: "pm_1",
        editText: "submitted older draft",
        editGeneration: 11,
        context: requestContext,
      },
    },
  }));

  assert.equal(harness.module.handlePendingMessageQueueMessage({
    type: "pending_message_result",
    requestId: "oldEditRequest",
    result: { ok: true, projectSlug: "project-a", sessionId: 7, revision: 6, paused: false, items: [] },
  }), true);
  assert.equal(harness.store.get("pendingMessageQueueEdit"), newerEdit);
  assert.equal(harness.store.get("pendingMessageQueue").revision, 6);
  assert.deepEqual(harness.socket.sent, []);

  var matchingEdit = { id: "pm_1", text: "latest submitted draft", error: "", generation: 13 };
  harness.store.set({
    pendingMessageQueueEdit: matchingEdit,
    pendingMessageQueueRequests: {
      matchingEditRequest: {
        kind: "edit",
        itemId: "pm_1",
        editText: matchingEdit.text,
        editGeneration: matchingEdit.generation,
        context: requestContext,
      },
    },
  });
  assert.equal(harness.module.handlePendingMessageQueueMessage({
    type: "pending_message_result",
    requestId: "matchingEditRequest",
    result: { ok: true, projectSlug: "project-a", sessionId: 7, revision: 7, paused: false, items: [] },
  }), true);
  assert.equal(harness.store.get("pendingMessageQueueEdit"), null);
});
