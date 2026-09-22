var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var os = require("node:os");
var vm = require("node:vm");
var pathToFileURL = require("node:url").pathToFileURL;
var attachUserMessage = require("../lib/project-user-message").attachUserMessage;
var createPendingMessageQueue = require("../lib/project-pending-message-queue").createPendingMessageQueue;

var root = path.join(__dirname, "..");
var delivery = require("../lib/project-message-delivery");

function source(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), "utf8");
}

test("server acknowledges a recorded message and deduplicates its replay", function () {
  var sent = [];
  var api = delivery.createProjectMessageDelivery(function (ws, msg) {
    sent.push({ ws: ws, msg: msg });
  }, "project-a");
  var ws = { _clayUser: { id: "user-1" } };
  var session = { history: [] };
  var receipt = api.inspect(ws, session, { clientMessageId: "cm-first" });
  assert.equal(receipt.duplicate, false);

  var recorded = { type: "user_message", text: "hello", from: "user-1", clientMessageId: "cm-first" };
  session.history.push(recorded);
  api.markRecorded(session, receipt, recorded);
  api.acknowledge(ws, receipt, recorded, { localId: 12 });
  assert.deepEqual(sent[0].msg, {
    type: "message_ack",
    clientMessageId: "cm-first",
    projectSlug: "project-a",
    sessionId: 12,
    message: recorded,
  });

  var replay = api.inspect(ws, session, { clientMessageId: "cm-first" });
  assert.equal(replay.duplicate, true);
  assert.equal(replay.recordedMessage, recorded);
});

test("persisted delivery identifiers survive a server restart", function () {
  var recorded = { type: "user_message", text: "hello", clientMessageId: "cm-persisted" };
  var restored = { history: [recorded] };
  var api = delivery.createProjectMessageDelivery(function () {});
  var sameAnonymousUser = api.inspect({}, restored, { clientMessageId: "cm-persisted" });
  var sameAnonymousUserAfterReload = api.inspect({}, { history: [recorded] }, { clientMessageId: "cm-persisted" });
  var sameUser = api.inspect({ _clayUser: { id: "user-1" } }, restored, { clientMessageId: "cm-persisted" });
  var otherUser = api.inspect({ _clayUser: { id: "user-2" } }, restored, { clientMessageId: "cm-persisted" });
  assert.equal(sameAnonymousUser.duplicate, true, "anonymous history uses the historical _default owner sentinel");
  assert.equal(sameAnonymousUserAfterReload.duplicate, true, "anonymous persisted history deduplicates after a new session object");
  assert.equal(sameUser.duplicate, false);
  assert.equal(otherUser.duplicate, false, "one user's identifier cannot suppress another user's message");
});

test("invalid delivery identifiers are ignored", function () {
  assert.equal(delivery.normalizeClientMessageId(""), null);
  assert.equal(delivery.normalizeClientMessageId("contains spaces"), null);
  assert.equal(delivery.normalizeClientMessageId("x".repeat(129)), null);
  assert.equal(delivery.normalizeClientMessageId("cm-valid_1.2:3"), "cm-valid_1.2:3");
});

test("server rejects an acknowledged message captured before a session switch", function () {
  var api = delivery.createProjectMessageDelivery(function () {}, "project-a");
  var ws = { _clayUser: { id: "user-1" } };
  var oldSession = { localId: 7, cliSessionId: "cli-old", history: [] };
  var switchedSession = { localId: 8, cliSessionId: "cli-new", history: [] };
  var captured = { clientMessageId: "cm-switch", projectSlug: "project-a", sessionId: 7, accountId: "user-1", cliSessionId: "cli-old" };
  assert.equal(api.validateContext(ws, oldSession, captured).ok, true);
  assert.equal(api.validateContext(ws, switchedSession, captured).ok, false, "the old local session cannot be admitted after switch_session");
  assert.equal(api.validateContext(ws, { localId: 7, cliSessionId: "cli-new" }, captured).ok, false, "a reused local id cannot bypass the durable CLI identity");
  var handler = source("lib/project-user-message.js");
  assert.ok(handler.indexOf("messageDelivery.validateContext(ws, session, msg)") < handler.indexOf("pendingMessageQueue.inspect(session, ws && ws._clayUser, msg.clientMessageId)"), "context validation precedes queue admission");
  assert.ok(handler.indexOf("messageDelivery.validateContext(ws, session, msg)") < handler.indexOf("messageDelivery.inspect(ws, session, msg)"), "context validation precedes delivery inspection and ACK");
});

test("real user-message handler rejects a switch-race and drains an origin-resumed queue once", async function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-delivery-handler-"));
  var sessionA = { localId: 7, sessionOriginId: "origin-a", cliSessionId: null, ownerId: "user-a", history: [], isProcessing: false };
  var sessionB = { localId: 44, sessionOriginId: "origin-b", cliSessionId: "cli-b", ownerId: "user-a", history: [], isProcessing: false };
  var currentSession = sessionB;
  var calls = { queueInspect: 0, ack: 0, start: 0 };
  var queue = createPendingMessageQueue({
    filePath: path.join(dir, "queue.json"),
    slug: "project-a",
    authorize: function (target, actor) { return !!(target && actor && actor.id === "user-a"); },
  });
  var handler = attachUserMessage({
    cwd: dir, slug: "project-a", isMate: false, osUsers: false,
    sm: { saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {} },
    sdk: { startQuery: function (target, text, images, access, beforePush, accepted) { calls.start++; if (beforePush()) accepted(); return Promise.resolve(true); } },
    nm: { create: function () {}, update: function () {}, close: function () {}, reopen: function () {}, list: function () { return []; } },
    tm: {}, clients: new Set(), send: function () {},
    sendTo: function (ws, message) { if (message.type === "message_ack") calls.ack++; },
    sendToSession: function () {}, sendToSessionOthers: function () {}, opts: {},
    usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === "user-a" ? { id: id } : null; } },
    matesModule: {}, _loop: { handleLoopMessage: function () { return false; } },
    getSessionForWs: function () { return currentSession; }, getLinuxUserForSession: function () {},
    ensureProjectAccessForSession: function () {}, getOsUserInfoForWs: function () {},
    hydrateImageRefs: function (message) { return message; }, saveImageFile: function () {}, imagesDir: dir,
    onProcessingChanged: function () {}, gitAttribution: null, browserState: { _browserTabList: {} },
    requestTabContext: function () { return Promise.resolve(null); }, loadContextSources: function () { return []; },
    saveContextSources: function () {}, adapter: { renameSession: function () { return Promise.resolve(); } }, _email: null, pendingMessageQueue: queue,
    authorizePendingDispatch: function () { return true; },
  });
  var ws = { readyState: 1, _clayUser: { id: "user-a" }, send: function () {} };
  var capturedForA = { type: "message", text: "wrong session", projectSlug: "project-a", sessionId: 7, accountId: "user-a", sessionOriginId: "origin-a", clientMessageId: "cm-switch-race" };
  handler.handleUserMessage(ws, capturedForA);
  assert.equal(calls.ack, 0);
  assert.equal(calls.start, 0);
  assert.equal(sessionB.history.length, 0);
  assert.equal(queue.list(sessionB, ws._clayUser).length, 0);

  assert.equal(queue.admit(sessionA, { type: "message", text: "resume once", projectSlug: "project-a", sessionId: 7, accountId: "user-a", sessionOriginId: "origin-a", clientMessageId: "cm-origin-queue" }, ws._clayUser).ok, true);
  currentSession = { localId: 99, sessionOriginId: "origin-a", cliSessionId: "cli-new", ownerId: "user-a", history: [], isProcessing: false };
  assert.equal(handler.consumePendingMessage(currentSession), true);
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(calls.start, 1);
  assert.equal(currentSession.history.filter(function (item) { return item.text === "resume once"; }).length, 1);
  assert.equal(queue.inspect(currentSession, ws._clayUser, "cm-origin-queue").state, "consumed", JSON.stringify(queue.inspect(currentSession, ws._clayUser, "cm-origin-queue")));
  assert.equal(calls.ack, 0, "internal queue delivery does not emit a duplicate client ACK");
});

test("stable session origin permits safe local-id renumbering and anonymous delivery", function () {
  var api = delivery.createProjectMessageDelivery(function () {}, "project-a");
  var anonymous = {};
  var captured = { clientMessageId: "cm-origin", projectSlug: "project-a", sessionId: 7, accountId: "_default", cliSessionId: null, sessionOriginId: "origin-a" };
  assert.equal(api.validateContext(anonymous, { localId: 44, cliSessionId: "cli-new", sessionOriginId: "origin-a" }, captured).ok, true, "the durable origin survives local-id and CLI reassignment");
  assert.equal(api.validateContext(anonymous, { localId: 44, cliSessionId: null, sessionOriginId: "origin-b" }, captured).ok, false, "a different durable origin is rejected");
  assert.equal(api.validateContext(anonymous, { localId: 44, cliSessionId: null, sessionOriginId: "origin-a" }, captured).ok, true, "anonymous account identity uses the historical default key");
  assert.equal(api.validateContext(anonymous, { localId: 44, cliSessionId: null, sessionOriginId: "origin-a" }, { clientMessageId: "cm-origin-only", sessionOriginId: "origin-b" }).ok, false, "origin-only context is not treated as legacy");
  assert.equal(api.validateContext(anonymous, { localId: 44, cliSessionId: null, sessionOriginId: "origin-a" }, Object.assign({}, captured, { accountId: "default" })).ok, false, "the newer default alias is not the persisted owner key");
  assert.match(source("lib/sessions.js"), /type: "session_switched", id: localId, sessionOriginId: session\.sessionOriginId/);
  assert.match(source("lib/project-connection.js"), /type: "session_switched", id: active\.localId, sessionOriginId: active\.sessionOriginId/);
});

test("client retains sends until acknowledgement and replays only into the same project session", function () {
  var client = source("lib/public/modules/message-delivery.js");
  var input = source("lib/public/modules/input.js");
  var messages = source("lib/public/modules/app-messages.js");
  assert.match(client, /pendingOutboundMessages/);
  assert.match(client, /clay-message-delivery-timeout/);
  assert.match(client, /pending\[i\]\.projectSlug === projectSlug && String\(pending\[i\]\.sessionId\) === String\(sessionId\)/);
  assert.doesNotMatch(client, /entry\.socketRef/);
  assert.match(input, /sendAcknowledgedMessage\(payload\)/);
  assert.match(messages, /case "message_ack":[\s\S]*acknowledgeMessage\(msg\.clientMessageId\)/);
  assert.match(messages, /case "session_switched":[\s\S]*activateDeliverySession\(msg\.id, msg\.cliSessionId \|\| null, msg\.sessionOriginId/);
  assert.match(messages, /case "session_id":[\s\S]*refreshDeliverySessionIdentity\(msg\.cliSessionId/);
  assert.doesNotMatch(source("lib/public/modules/app-connection.js"), /replayPendingMessages/);
});

test("production processMessage restores switched delivery identity before sending", async function () {
  var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
  var store = storeModule.store;
  var wsRef = await import(pathToFileURL(path.join(root, "lib/public/modules/ws-ref.js")).href);
  var deliveryModule = await import(pathToFileURL(path.join(root, "lib/public/modules/message-delivery.js")).href);
  var previousWindow = global.window;
  var previousCustomEvent = global.CustomEvent;
  var previousSocket = wsRef.getWs();
  var previousState = store.snap();
  function executeFixture(appMessages, clearOrigin) {
    var caseStart = appMessages.indexOf('      case "session_switched":');
    var caseEnd = appMessages.indexOf('      case "session_full_access_changed":', caseStart);
    assert.ok(caseStart >= 0);
    assert.ok(caseEnd > caseStart);
    var switchedCase = appMessages.slice(caseStart, caseEnd).replace(/\n        break;\n/, "\n        return;\n");
    var sent = [];
    var socket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } };
    var element = { value: "", classList: { add: function () {}, remove: function () {}, toggle: function () {} }, style: {}, focus: function () {} };
    var stubs = {
      store: store, activateDeliverySession: deliveryModule.activateDeliverySession,
      clearPairResultStatus: function () {},
      syncAutonomousRunForSession: function () {}, closeWhatsNewArticle: function () {}, handleScheduledTaskSessionSwitched: function () {}, requestLoopInterviewState: function () {},
      attachTuiView: function () {}, detachTuiView: function () {}, setTuiSuspendedView: function () {}, resolveSwitchedVendor: function (current, vendor) { return vendor || current; },
      selectDefaultVendorForBlankSession: function () {}, requestVendorModels: function () {}, clearRemoteCursors: function () {}, resetClientState: function () {}, updateLoopInputVisibility: function () {},
      autoResize: function () {}, finishProjectSessionActivation: function () { return false; }, hideHomeHub: function () {}, maybeRestoreSplitGroup: function () {},
      VENDOR_AVATARS: {}, VENDOR_NAMES: {}, inputEl: element, document: { getElementById: function () { return element; } }, window: {},
    };
    var context = vm.createContext(stubs);
    var processMessage = vm.runInContext("(function (msg) { switch (msg.type) {\n" + switchedCase + "\n} })", context);
    var api = delivery.createProjectMessageDelivery(function () {}, "project-a");
    var ws = { readyState: 1, _clayUser: { id: "user-1" } };
    wsRef.setWs(socket);
    storeModule.createStore({ currentSlug: "project-a", activeSessionId: null, sessionOriginId: "stale-origin", cliSessionId: "stale-cli", currentEffort: "high", currentMode: "default", sessionDrafts: {}, pendingOutboundMessages: [], deliveryReceipts: {}, myUserId: "user-1", splitPanes: false });
    processMessage({ type: "session_switched", id: 44, sessionOriginId: "origin-new", cliSessionId: "cli-new", model: "model-new", effort: "low", capabilities: { vision: true }, mode: "tui", terminalId: 12, runtimeMode: "gui", runtimeTerminalId: 13, hasHistory: true, isProcessing: true, vendor: "claude", permissionMode: "bypassPermissions", effectivePermissionMode: "acceptEdits", permissionCapabilities: { auto: true, mcpOverride: true }, mcpPermissionModeOverrides: { x: "y" } });
    var payloadId = null;
    var currentPayload = null;
    if (store.get("activeSessionId") === 44) {
      global.window = { crypto: { randomUUID: function () { return "production-fixture"; } }, dispatchEvent: function () {} };
      global.CustomEvent = function (type, init) { this.type = type; this.detail = init && init.detail; };
      payloadId = deliveryModule.sendAcknowledgedMessage({ type: "message", text: "after switch" });
      currentPayload = sent[sent.length - 1];
    }
    var stalePayload = { type: "message", text: "before switch", projectSlug: "project-a", sessionId: 7, accountId: "user-1", sessionOriginId: "origin-old", cliSessionId: "cli-old", clientMessageId: "stale-message" };
    var currentValidation = api.validateContext(ws, { localId: 44, sessionOriginId: "origin-new", cliSessionId: "cli-new" }, currentPayload);
    var staleValidation = api.validateContext(ws, { localId: 44, sessionOriginId: "origin-new", cliSessionId: "cli-new" }, stalePayload);
    if (clearOrigin) processMessage({ type: "session_switched", id: 45, cliSessionId: "cli-next", mode: "gui", hasHistory: false });
    if (payloadId) deliveryModule.acknowledgeMessage(payloadId);
    return { state: store.snap(), currentValidation: currentValidation, staleValidation: staleValidation, currentPayload: currentPayload };
  }
  try {
    var result = executeFixture(source("lib/public/modules/app-messages.js"));
    assert.equal(result.state.activeSessionId, 44);
    assert.equal(result.state.sessionOriginId, "origin-new");
    assert.equal(result.state.cliSessionId, "cli-new");
    assert.equal(result.state.currentModel, "model-new");
    assert.equal(result.state.currentEffort, "low");
    assert.deepEqual(result.state.vendorCapabilities, { vision: true });
    assert.equal(result.state.sessionIsProcessing, true);
    assert.equal(result.state.activeSessionMode, "gui");
    assert.equal(result.state.activeTerminalId, 13);
    assert.equal(result.state.sessionHasHistory, true);
    assert.equal(result.state.sessionVendorBound, true);
    assert.equal(result.state.sessionFullAccess, true);
    assert.equal(result.state.currentMode, "bypassPermissions");
    assert.equal(result.state.effectivePermissionMode, "acceptEdits");
    assert.deepEqual(result.state.permissionCapabilities, { auto: true, mcpOverride: true });
    assert.deepEqual(result.state.mcpPermissionModeOverrides, { x: "y" });
    assert.equal(result.currentValidation.ok, true, result.currentValidation.reason);
    assert.equal(result.staleValidation.ok, false);
    var cleared = executeFixture(source("lib/public/modules/app-messages.js"), true);
    assert.equal(cleared.state.sessionOriginId, null, "an absent origin must clear the previous origin");
  } finally {
    global.window = previousWindow;
    global.CustomEvent = previousCustomEvent;
    wsRef.setWs(previousSocket);
    storeModule.createStore(previousState);
  }
});

test("client retries the same id within context, retains unconfirmed delivery, and permits explicit retry", async function () {
  var originalSetTimeout = global.setTimeout;
  var originalClearTimeout = global.clearTimeout;
  var originalWindow = global.window;
  var originalCustomEvent = global.CustomEvent;
  var now = 0;
  var nextTimer = 1;
  var timers = new Map();
  var events = [];
  global.setTimeout = function (fn, delay) {
    var id = nextTimer++;
    timers.set(id, { at: now + delay, fn: fn });
    return id;
  };
  global.clearTimeout = function (id) { timers.delete(id); };
  global.CustomEvent = function (type, init) { this.type = type; this.detail = init.detail; };
  global.window = { crypto: { randomUUID: function () { return "stable"; } }, dispatchEvent: function (event) { events.push(event); } };
  try {
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    var store = storeModule.store;
    var wsRef = await import(pathToFileURL(path.join(root, "lib/public/modules/ws-ref.js")).href);
    var module = await import(pathToFileURL(path.join(root, "lib/public/modules/message-delivery.js")).href + "?delivery-runtime=" + Date.now());
    var sent = [];
    var socket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } };
    storeModule.createStore({ currentSlug: "project-a", activeSessionId: 7, pendingOutboundMessages: [] });
    wsRef.setWs(socket);
    store.set({ cliSessionId: null });
    module.activateDeliverySession(7, null);
    var id = module.sendAcknowledgedMessage({ type: "message", text: "hello" });
    var sentContext = sent[0];
    assert.deepEqual({ projectSlug: sentContext.projectSlug, sessionId: sentContext.sessionId, accountId: sentContext.accountId, cliSessionId: sentContext.cliSessionId }, { projectSlug: "project-a", sessionId: 7, accountId: "_default", cliSessionId: null });
    function tick(duration) {
      now += duration;
      var due = [];
      timers.forEach(function (timer, timerId) { if (timer.at <= now) due.push({ id: timerId, timer: timer }); });
      due.sort(function (a, b) { return a.timer.at - b.timer.at; });
      for (var i = 0; i < due.length; i++) {
        if (timers.has(due[i].id)) { timers.delete(due[i].id); due[i].timer.fn(); }
      }
    }
    store.set({ cliSessionId: "cli-assigned" });
    assert.equal(module.refreshDeliverySessionIdentity("cli-assigned", null), true, "late CLI assignment refreshes the active delivery guard");
    assert.equal(sent.length, 1, "identity refresh does not duplicate the initial send");
    tick(5000);
    assert.equal(events.length, 1, "a real ACK expiry emits the health-probe event");
    assert.equal(events[0].detail.socket, socket, "the probe event identifies the current socket");
    for (var attempt = 0; attempt < 3; attempt++) tick(5000);
    assert.equal(sent.length, 4, "initial send plus three bounded same-id retries");
    assert.deepEqual(sent.map(function (message) { return message.clientMessageId; }), [id, id, id, id]);
    assert.equal(store.get("pendingOutboundMessages").length, 1, "unconfirmed delivery remains recoverable");
    assert.equal(store.get("deliveryReceipts")[id].clientMessageId, id);
    var sentBeforeAutoReplay = sent.length;
    module.replayPendingMessages(7);
    assert.equal(sent.length, sentBeforeAutoReplay, "unconfirmed entries are not automatically replayed");
    assert.equal(module.retryPendingMessage(id), true, "explicit retry is allowed in the original context");
    assert.equal(sent[sent.length - 1].clientMessageId, id);
    var sentBeforeContextSwitch = sent.length;
    store.set({ currentSlug: "project-other" });
    module.replayPendingMessages(7);
    assert.equal(sent.length, sentBeforeContextSwitch, "project changes suspend automatic replay");
    assert.equal(module.retryPendingMessage(id), false, "manual retry also requires the captured context");
    store.set({ currentSlug: "project-a" });
    store.set({ activeSessionId: 8 });
    assert.equal(module.retryPendingMessage(id), false, "session changes suspend manual retry");
    store.set({ activeSessionId: 7, myUserId: "other-account" });
    assert.equal(module.retryPendingMessage(id), false, "account changes suspend manual retry");
    store.set({ myUserId: null });
    module.acknowledgeMessage(id);
    assert.equal(store.get("pendingOutboundMessages").length, 0, "a late ACK clears the retained entry");
    store.set({ cliSessionId: "cli-1" });
    var idWithCli = module.sendAcknowledgedMessage({ type: "message", text: "cli-bound" });
    var replacementSocket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } };
    wsRef.setWs(replacementSocket);
    module.activateDeliverySession(7, "cli-1");
    module.replayPendingMessages(7);
    assert.equal(sent[sent.length - 1].clientMessageId, idWithCli, "matching cliSessionId permits replay on a replacement socket");
    wsRef.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    module.replayPendingMessages(7);
    wsRef.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    module.replayPendingMessages(7);
    wsRef.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    var sentBeforeCappedReplay = sent.length;
    module.replayPendingMessages(7);
    assert.equal(sent.length, sentBeforeCappedReplay, "reconnect replay cannot exceed the per-entry cap");
    assert.equal(store.get("pendingOutboundMessages").filter(function (entry) { return entry.payload.clientMessageId === idWithCli; })[0].status, "unconfirmed");
    store.set({ cliSessionId: "cli-2" });
    assert.equal(module.retryPendingMessage(idWithCli), false, "manual retry rejects a known CLI-session mismatch");
    store.set({ cliSessionId: "cli-1" });
    wsRef.setWs(replacementSocket);
    module.activateDeliverySession(7, "cli-1");
    assert.equal(module.retryPendingMessage(idWithCli), true, "explicit retry resets only after human action");
    module.acknowledgeMessage(idWithCli);
    store.set({ cliSessionId: null });
    var idUnknown = module.sendAcknowledgedMessage({ type: "message", text: "unknown-bound" });
    var unknownSocket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } };
    wsRef.setWs(unknownSocket);
    var sentBeforeUnknownReplay = sent.length;
    module.replayPendingMessages(7);
    assert.equal(sent.length, sentBeforeUnknownReplay, "unknown cli identity blocks replay on a replacement socket");
    module.acknowledgeMessage(idUnknown);
    wsRef.setWs(null);
    var idOffline = module.sendAcknowledgedMessage({ type: "message", text: "offline-send" });
    assert.equal(store.get("deliveryReceipts")[idOffline].clientMessageId, idOffline, "an initial offline send creates receipt state");
    module.acknowledgeMessage(idOffline);
    wsRef.setWs({ readyState: 1, send: function () { throw new Error("socket send failed"); } });
    var idThrowing = module.sendAcknowledgedMessage({ type: "message", text: "throwing-send" });
    assert.equal(store.get("pendingOutboundMessages").filter(function (entry) { return entry.payload.clientMessageId === idThrowing; })[0].status, "unconfirmed", "a throwing send remains recoverable");
    assert.equal(store.get("deliveryReceipts")[idThrowing].clientMessageId, idThrowing, "a throwing send creates visible receipt state");
    module.acknowledgeMessage(idThrowing);
    assert.equal(events[events.length - 1].type, "clay-message-delivery-timeout", "send failure uses store-backed receipt state while retaining the probe signal");
  } finally {
    global.setTimeout = originalSetTimeout;
    global.clearTimeout = originalClearTimeout;
    global.window = originalWindow;
    global.CustomEvent = originalCustomEvent;
  }
});

test("delivery receipt UI renders scoped retry controls and restores after context remount", async function () {
  var originalDocument = global.document;
  var elements = {};
  function element(tag) {
    return {
      tagName: tag,
      children: [],
      dataset: {},
      parentNode: null,
      appendChild: function (child) { child.parentNode = this; this.children.push(child); return child; },
      removeChild: function (child) { this.children = this.children.filter(function (item) { return item !== child; }); child.parentNode = null; },
      addEventListener: function (name, callback) { this["on" + name] = callback; },
      click: function () { if (this.onclick) this.onclick(); },
      querySelectorAll: function (selector) {
        var found = [];
        function visit(parent) {
          for (var i = 0; i < parent.children.length; i++) {
            var child = parent.children[i];
            if (selector === ".sys-msg" && child.className.indexOf("sys-msg") !== -1) found.push(child);
            if (selector === ".sys-retry" && child.className === "sys-retry") found.push(child);
            visit(child);
          }
        }
        visit(this);
        return found;
      }
    };
  }
  elements.messages = element("div");
  global.document = { getElementById: function (id) { return elements[id] || null; }, createElement: element };
  var ui = null;
  var wsRef = null;
  try {
    var storeModule = await import(pathToFileURL(path.join(root, "lib/public/modules/store.js")).href);
    wsRef = await import(pathToFileURL(path.join(root, "lib/public/modules/ws-ref.js")).href);
    var delivery = await import(pathToFileURL(path.join(root, "lib/public/modules/message-delivery.js")).href);
    ui = await import(pathToFileURL(path.join(root, "lib/public/modules/message-delivery-ui.js")).href + "?fixture=" + Date.now());
    var sent = [];
    storeModule.createStore({ currentSlug: "project-a", activeSessionId: 7, myUserId: "user-a", pendingOutboundMessages: [{ projectSlug: "project-a", sessionId: 7, accountId: "user-a", cliSessionId: null, attempts: 3, status: "unconfirmed", payload: { clientMessageId: "cm-one", type: "message" } }], deliveryReceipts: {
      "cm-one": { clientMessageId: "cm-one", projectSlug: "project-a", sessionId: 7, accountId: "user-a", attempts: 3 },
      "cm-two": { clientMessageId: "cm-two", projectSlug: "project-a", sessionId: 7, accountId: "user-a", attempts: 3 }
    } });
    wsRef.setWs({ readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } });
    delivery.activateDeliverySession(7, null);
    ui.initMessageDeliveryUi();
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 2, "each receipt gets its own notice");
    elements.messages.querySelectorAll(".sys-msg")[0].querySelectorAll(".sys-retry")[0].click();
    assert.equal(sent[0].clientMessageId, "cm-one", "Retry sends the original id");
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 1, "retry clears only the selected receipt notice");
    storeModule.store.set({ currentSlug: "project-other" });
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 0, "source notices hide outside their context");
    storeModule.store.set({ currentSlug: "project-a" });
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 1, "source notice returns on context remount");
    var restoredNotice = elements.messages.querySelectorAll(".sys-msg")[0];
    restoredNotice.parentNode = null;
    elements.messages.children = [];
    storeModule.store.set({ replayingHistory: true });
    storeModule.store.set({ replayingHistory: false });
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 1, "detached notices remount in the same context");
    delivery.acknowledgeMessage("cm-two");
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 0, "late ACK removes the restored notice");
    delivery.acknowledgeMessage("cm-one");
    storeModule.store.set({ myUserId: null, sessionOriginId: "anonymous-origin", deliveryReceipts: {
      "cm-anonymous": { clientMessageId: "cm-anonymous", projectSlug: "project-a", sessionId: 7, accountId: "_default", sessionOriginId: "anonymous-origin", attempts: 3 }
    } });
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 1, "anonymous receipts use the historical _default account key");
    storeModule.store.set({ sessionOriginId: "different-origin" });
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 0, "known origin changes hide the previous session receipt");
    storeModule.store.set({ sessionOriginId: "anonymous-origin" });
    assert.equal(elements.messages.querySelectorAll(".sys-msg").length, 1, "the scoped receipt returns for its source origin");
    delivery.acknowledgeMessage("cm-anonymous");
  } finally {
    if (ui) ui.disposeMessageDeliveryUi();
    if (wsRef) wsRef.setWs(null);
    global.document = originalDocument;
  }
});

test("Claude optimistic activity replaces an older placeholder", function () {
  var rendering = source("lib/public/modules/app-rendering.js");
  var start = rendering.indexOf("export function showClaudePreThinking()");
  var end = rendering.indexOf("export function showMatePreThinking()", start);
  var body = rendering.slice(start, end);
  assert.ok(body.indexOf("removeMatePreThinking();") < body.indexOf("doShowMatePreThinking("));
});
