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

test("image chooser ignores picker and reader completions after cancel and preserves selection order", async function () {
  var source = fs.readFileSync(path.join(root, "lib/public/modules/pending-message-image-editor.js"), "utf8");
  var module = await import(dataModule(source));
  var oldDocument = globalThis.document;
  var oldReader = globalThis.FileReader;
  var lastInput = null;
  var readers = [];
  globalThis.document = { createElement: function () { return { files: [], addEventListener: function (name, fn) { this[name] = fn; }, click: function () { lastInput = this; } }; } };
  globalThis.FileReader = function () { this.readAsDataURL = function (file) { this.file = file; readers.push(this); }; };
  try {
    var context = { projectSlug: "p", sessionId: 1, accountId: "u" };
    var edit = { id: "pm_1", token: "token-1", generation: 1, images: [{ mediaType: "image/png", data: "old" }] };
    var editable = true;
    var writes = [];
    var deps = { getEdit: function () { return edit; }, getContext: function () { return context; }, sameContext: function (a, b) { return a.projectSlug === b.projectSlug && a.sessionId === b.sessionId && a.accountId === b.accountId; }, isEditable: function () { return editable; }, setEdit: function (update) { edit = Object.assign({}, edit, update, { generation: edit.generation + 1 }); writes.push(update); } };
    module.chooseImages("pm_1", null, deps);
    edit = null;
    lastInput.files = [{ type: "image/png", size: 3 }];
    lastInput.change();
    assert.deepEqual(writes, [], "cancel before picker change must not set pending reads");
    edit = { id: "pm_1", token: "token-2", generation: 1, images: [] };
    module.chooseImages("pm_1", null, deps);
    context = { projectSlug: "other", sessionId: 1, accountId: "u" };
    lastInput.files = [{ type: "image/png", size: 3 }];
    lastInput.change();
    assert.equal(edit.pendingReads, undefined, "context changes while picker is open must not set pending reads");
    context = { projectSlug: "p", sessionId: 1, accountId: "u" };
    module.chooseImages("pm_1", null, deps);
    lastInput.files = [{ type: "image/png", size: 3 }];
    lastInput.change();
    assert.equal(edit.pendingReads, 1);
    edit = null;
    readers[0].onload({});
    assert.equal(edit, null, "cancel before reader completion must not resurrect the draft");
    edit = { id: "pm_1", token: "token-3", generation: 1, images: [] };
    module.chooseImages("pm_1", null, deps);
    lastInput.files = [{ type: "image/png", size: 1 }, { type: "image/jpeg", size: 1 }];
    lastInput.change();
    assert.equal(edit.pendingReads, 2);
    module.chooseImages("pm_1", 0, deps);
    assert.equal(readers.length, 3, "image replacement is locked while reads are pending");
    var first = readers[1];
    var second = readers[2];
    second.result = "data:image/jpeg;base64,second";
    second.onload();
    first.result = "data:image/png;base64,first";
    first.onload();
    assert.deepEqual(edit.images, [{ mediaType: "image/png", data: "first" }, { mediaType: "image/jpeg", data: "second" }]);
    assert.equal(edit.pendingReads, 0);
    assert.equal(edit.pendingReads, 0, "all pending image reads settle");
    edit = { id: "pm_1", token: "token-claim", generation: 1, images: [{ mediaType: "image/png", data: "original" }] };
    editable = true;
    module.chooseImages("pm_1", null, deps);
    lastInput.files = [{ type: "image/png", size: 1 }, { type: "image/jpeg", size: 1 }];
    lastInput.change();
    var claimFirst = readers[3];
    var claimSecond = readers[4];
    editable = false;
    edit = Object.assign({}, edit, { token: "token-claim-new", pendingReads: 0, generation: 10 });
    editable = true;
    claimFirst.result = "data:image/png;base64,claimed";
    claimFirst.onload();
    claimSecond.result = "data:image/jpeg;base64,claimed";
    claimSecond.onload();
    assert.deepEqual(edit.images, [{ mediaType: "image/png", data: "original" }], "claim during read preserves draft images");
    assert.equal(edit.pendingReads, 0, "canonical pending reset invalidates old readers");
    editable = true;
    edit = { id: "pm_1", token: "token-4", generation: 1, images: [{ mediaType: "image/png", data: "original" }] };
    module.chooseImages("pm_1", null, deps);
    lastInput.files = [{ type: "image/png", size: 1 }, { type: "image/jpeg", size: 1 }];
    lastInput.change();
    assert.equal(edit.pendingReads, 2);
    readers[5].onerror();
    readers[6].result = "data:image/jpeg;base64,partial";
    readers[6].onload();
    assert.deepEqual(edit.images, [{ mediaType: "image/png", data: "original" }], "failed batch retains original images without holes");
    assert.equal(edit.error, "Could not read image");
    edit = { id: "pm_1", token: "token-5", generation: 1, images: [] };
    module.chooseImages("pm_1", null, deps);
    lastInput.files = [{ type: "text/plain", size: 1 }];
    lastInput.change();
    assert.equal(edit.pendingReads, undefined, "invalid files are rejected before FileReader");
    assert.equal(edit.error, "Invalid image attachment");
  } finally {
    globalThis.document = oldDocument;
    globalThis.FileReader = oldReader;
  }
});

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
    "./pending-message-image-editor.js": dataModule("export function imageSrc(image) { return image && image.url || ''; } export function imageDraft(image) { return { mediaType: image.mediaType, data: image.data }; } export function openImagePreview() {} export function chooseImages() {}") + "#image-editor-" + loadId,
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
