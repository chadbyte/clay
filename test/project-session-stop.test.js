var test = require("node:test");
var assert = require("node:assert/strict");
var attachSessions = require("../lib/project-sessions").attachSessions;

test("the human Stop path establishes the pair barrier before aborting", function () {
  var order = [];
  var session = {
    localId: 2,
    isProcessing: true,
    abortController: { abort: function () { order.push("abort"); } },
  };
  var attached = attachSessions({
    sm: { sessions: new Map([[2, session]]) },
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return session; },
    onHumanPairStop: function (stopped) { assert.equal(stopped, session); order.push("barrier"); },
  });

  assert.equal(attached.handleSessionsMessage({}, { type: "stop" }), true);
  assert.deepEqual(order, ["barrier", "abort"]);
  assert.equal(session.taskStopRequested, true);
});

test("Stop also catches a Worker while its query is still starting", function () {
  var stopped = false;
  var session = {
    localId: 2,
    isProcessing: false,
    _queryStarting: true,
    abortController: { abort: function () { stopped = true; } },
  };
  var attached = attachSessions({
    sm: { sessions: new Map([[2, session]]) },
    sdk: {},
    clients: new Set(),
    opts: {},
    usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return session; },
    onHumanPairStop: function () {},
  });

  attached.handleSessionsMessage({}, { type: "stop" });
  assert.equal(stopped, true);
  assert.equal(session.taskStopRequested, true);
});

test("Home Stop reuses the same exact-session cancellation lifecycle", function () {
  var stopped = false;
  var controller = new AbortController();
  var session = { localId: 9, isProcessing: true, pendingPermissions: { "permission-9": {} }, abortController: controller };
  controller.signal.addEventListener("abort", function () { stopped = true; delete session.pendingPermissions["permission-9"]; });
  var attached = attachSessions({
    sm: { sessions: new Map([[9, session]]) }, sdk: {}, clients: new Set(), opts: {},
    usersModule: { isMultiUser: function () { return false; } }, getSessionForWs: function () { return null; }, onHumanPairStop: function () {},
  });
  assert.equal(attached.stopHomeSession(session), true);
  assert.equal(stopped, true);
  assert.deepEqual(session.pendingPermissions, {});
  assert.equal(session.taskStopRequested, true);
});

test("Home permission answers use the canonical pending request resolver", function () {
  var answer = null;
  var recorded = [];
  var session = {
    localId: 9,
    pendingPermissions: { "permission-9": { toolInput: { file_path: "/repo/a.js" }, resolve: function (value) { answer = value; } } },
  };
  var manager = {
    sessions: new Map([[9, session]]),
    permissionRequestIndex: { "permission-9": 9 },
    sendAndRecord: function (target, event) { recorded.push(event); },
  };
  var attached = attachSessions({
    sm: manager, sdk: {}, clients: new Set(), opts: {}, usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return null; }, onProcessingChanged: function () {},
  });
  assert.equal(attached.respondToHomePermission({}, { requestId: "permission-9", decision: "allow" }, session), true);
  assert.deepEqual(answer, { behavior: "allow", updatedInput: { file_path: "/repo/a.js" } });
  assert.deepEqual(recorded, [{ type: "permission_resolved", requestId: "permission-9", decision: "allow" }]);
  assert.equal(manager.permissionRequestIndex["permission-9"], undefined);
  assert.equal(session.pendingPermissions["permission-9"], undefined);
});

test("Home permission answers fail closed when the canonical index is missing or points elsewhere", function () {
  var resolutions = [];
  var target = { localId: 9, pendingPermissions: { "permission-9": { resolve: function () { resolutions.push("target"); } } } };
  var other = { localId: 10, pendingPermissions: { "permission-9": { resolve: function () { resolutions.push("other"); } } } };
  var manager = { sessions: new Map([[9, target], [10, other]]), permissionRequestIndex: { "permission-9": 10 } };
  var attached = attachSessions({
    sm: manager, sdk: {}, clients: new Set(), opts: {}, usersModule: { isMultiUser: function () { return false; } },
    getSessionForWs: function () { return other; }, onProcessingChanged: function () {},
  });
  assert.equal(attached.respondToHomePermission({}, { requestId: "permission-9", decision: "allow" }, target), false);
  assert.deepEqual(resolutions, []);
  assert.ok(target.pendingPermissions["permission-9"]);
  assert.ok(other.pendingPermissions["permission-9"]);
  delete manager.permissionRequestIndex["permission-9"];
  assert.equal(attached.respondToHomePermission({}, { requestId: "permission-9", decision: "deny" }, target), false);
  assert.deepEqual(resolutions, []);
});
