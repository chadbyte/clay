var assert = require("node:assert/strict");
var autonomousModule = require("../../lib/project-autonomous-run");

function tick() { return new Promise(function (resolve) { setImmediate(resolve); }); }
function timerTick() { return new Promise(function (resolve) { setTimeout(resolve, 5); }); }

function fixture(existingRun, permissionGate, restoreGate, startGate, permissionHook, runtimeOptions) {
  runtimeOptions = runtimeOptions || {};
  var session = { localId: runtimeOptions.localId || 7, sessionOriginId: runtimeOptions.sessionOriginId || null, mode: "gui", permissionMode: "default", permissionModeBeforeFullAccess: null,
    isProcessing: false, _queryStarting: false, pendingPush: [], history: [], autonomousRun: existingRun || null };
  var messages = []; var permissionCalls = []; var sdkCalls = []; var pairStops = 0;
  var sm = { sessions: new Map([[session.localId, session]]), saveSessionFile: function () {}, appendToSessionFile: function () {}, broadcastSessionList: function () {},
    sendToSession: function (target, message) { messages.push({ target: target, message: message }); } };
  var fullAccess = {
    snapshot: function (target) { return { permissionMode: target.permissionMode, permissionModeBeforeFullAccess: target.permissionModeBeforeFullAccess, enabled: target.permissionMode === "bypassPermissions" }; },
    setEnabled: function (target, enabled) { permissionCalls.push(["set", enabled]); target.permissionMode = enabled ? "bypassPermissions" : "default"; if (permissionHook) permissionHook(target); return permissionGate || Promise.resolve(); },
    restore: function (target, prior) { permissionCalls.push(["restore", prior && prior.enabled]); target.permissionMode = prior && prior.permissionMode || "default"; target.permissionModeBeforeFullAccess = prior && prior.permissionModeBeforeFullAccess || null; return restoreGate || Promise.resolve(); },
  };
  var controller = autonomousModule.attachAutonomousRun({
    sm: sm, isMate: false, fullAccess: fullAccess, sendTo: function (ws, message) { messages.push({ target: ws, message: message }); },
    getSessionForWs: function () { return session; }, canAccess: function () { return true; },
    getSdk: function () { return { pushMessage: function (target, text, images, meta) { sdkCalls.push({ kind: "push", target: target, text: text, meta: meta }); return false; },
      startQuery: function (target, text) { sdkCalls.push({ kind: "start", target: target, text: text }); target._queryGeneration = (target._queryGeneration || 0) + 1; if (startGate && startGate.throw) throw startGate.throw; return startGate || Promise.resolve(); } }; },
    ensureProjectAccessForSession: function () { return null; }, onProcessingChanged: function () {}, stopPair: function () { pairStops++; return true; }, stopBarrier: function () { return null; },
    allowInMemoryTimers: !runtimeOptions.durableScheduler, durableScheduler: runtimeOptions.durableScheduler, projectSlug: runtimeOptions.projectSlug || "test-project",
    isMultiUser: runtimeOptions.isMultiUser || false, authorizeSession: runtimeOptions.authorizeSession || function () { return true; },
  });
  return { controller: controller, session: session, sm: sm, messages: messages, permissionCalls: permissionCalls, sdkCalls: sdkCalls, pairStops: function () { return pairStops; } };
}

async function arm(f, options) {
  var msg = Object.assign({ type: "autonomous_run_arm", sessionId: f.session.localId, maxContinuations: 10, maxMinutes: 60 }, options || {});
  assert.equal(f.controller.handleMessage({}, msg), true); await tick(); await tick();
  var result = f.messages.map(function (entry) { return entry.message; }).filter(function (entry) { return entry.type === "autonomous_run_arm_result"; }).pop();
  assert.equal(result.ok, true); return result;
}

async function startRun(f, criteria) {
  var result = await arm(f, { successCriteria: criteria || ["Tests pass"] });
  assert.equal(f.controller.consume(f.session, { text: "Ship the feature", autonomousRunToken: result.armToken }), true);
  return f.session.autonomousRun;
}

module.exports = { fixture: fixture, tick: tick, timerTick: timerTick, arm: arm, startRun: startRun };
