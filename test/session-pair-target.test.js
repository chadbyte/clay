var test = require("node:test");
var assert = require("node:assert/strict");
var pairTarget = require("../lib/session-pair-target");
var multiWorkerFeature = require("../lib/multi-worker-feature");
var FEATURE = multiWorkerFeature.fromServerConfig({ multiWorkerRuntimeEnabled: true });
var mcp = require("../lib/session-pair-mcp-server");
var attachPairLifecycle = require("../lib/project-pair-lifecycle").attachPairLifecycle;
var attachTurnControl = require("../lib/session-pair-turn-control").attachPairTurnControl;

function makeSessions() {
  return new Map([
    [1, { localId: 1, ownerId: "owner", history: [], isProcessing: false }],
    [2, { localId: 2, ownerId: "owner", title: "Worker A", history: [], isProcessing: false }],
    [3, { localId: 3, ownerId: "owner", title: "Worker B", history: [], isProcessing: false }],
  ]);
}

function versionedGroup() {
  return { id: "v2", members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3] } };
}

test("exact target resolution supports addressed reads and gates ambiguous or mutating V2 calls", function () {
  var sessions = makeSessions();
  var sm = { sessions: sessions };
  var group = versionedGroup();
  var driver = sessions.get(1);
  assert.equal(pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 2 }, { readOnly: true }).partner.localId, 2);
  assert.equal(pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 3 }, { readOnly: true }).partner.localId, 3);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, group, driver, {}, { readOnly: true }); }, /workerId is required/);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 9 }, { readOnly: true }); }, /exact configured Worker/);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 2 }, { mutation: true }); }, /multi-Worker mutations remain gated/);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 2 }); }, /multi-Worker mutations remain gated/);
  assert.equal(pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 2 }, {
    mutation: true, multiWorkerFeature: FEATURE,
  }).workerId, 2);
  assert.equal(pairTarget.resolveGroupTarget(sm, group, driver, { workerId: 2 }, {
    mutation: true, structural: true, multiWorkerFeature: FEATURE,
  }).workerId, 2);
  assert.deepEqual(group.members, [1, 2, 3], "rejected targeting does not mutate the group");
  var stale = Object.assign({}, driver);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, group, stale, { workerId: 2 }, { readOnly: true }); }, /no longer live/);
  var otherOwner = Object.assign({}, driver, { ownerId: "other" });
  sessions.set(1, otherOwner);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, group, otherOwner, { workerId: 2 }, { readOnly: true }); }, /access denied/);
});

test("legacy and ad-hoc target omission remains compatible", function () {
  var sessions = makeSessions();
  var sm = { sessions: sessions };
  var driver = sessions.get(1);
  var legacy = { id: "legacy", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  assert.equal(pairTarget.resolveGroupTarget(sm, legacy, driver, {}, { mutation: true }).workerId, 2);
  var adhoc = { id: "adhoc", members: [1, 2], pair: null };
  assert.equal(pairTarget.resolveGroupTarget(sm, adhoc, driver, {}, { mutation: true }).workerId, 2);
  assert.throws(function () { pairTarget.resolveGroupTarget(sm, adhoc, driver, { workerId: 3 }, { mutation: true }); }, /exact split partner/);
});

test("lifecycle status reads the addressed Worker and rejects omitted V2 target", async function () {
  var sessions = makeSessions();
  sessions.get(2).model = "worker-a";
  sessions.get(3).model = "worker-b";
  var group = versionedGroup();
  var store = { groupForMember: function () { return group; } };
  var turnControl = attachTurnControl({ sm: { sessions: sessions }, splitStore: store });
  var lifecycle = attachPairLifecycle({
    sm: { sessions: sessions, saveSessionFile: function () {} }, splitStore: store, turnControl: turnControl,
    preflightWorkerForDriver: function () {}, sendToPartner: function () { return Promise.resolve({}); },
    createWorkerForDriver: function () { throw new Error("not reached"); },
  });
  var status = lifecycle.toolHandlers(sessions.get(1)).status;
  var addressed = JSON.parse((await status({ workerId: 3 })).content[0].text);
  assert.equal(addressed.worker.sessionId, 3);
  assert.equal(addressed.configuration.model, "worker-b");
  var ambiguous = await status({});
  assert.equal(ambiguous.isError, true);
  assert.match(ambiguous.content[0].text, /workerId is required/);
  var wrong = await status({ workerId: 99 });
  assert.equal(wrong.isError, true);
  assert.match(wrong.content[0].text, /exact configured Worker/);
  var blocked = await lifecycle.toolHandlers(sessions.get(1)).replace({ workerId: 2, message: "must not mutate" });
  assert.equal(blocked.isError, true);
  assert.match(blocked.content[0].text, /multi-Worker mutations remain gated/);
  assert.deepEqual(group.members, [1, 2, 3], "blocked mutation leaves the group unchanged");
});

test("pair MCP schemas forward optional workerId without making it required", function () {
  var defs = mcp.getToolDefs({}, { lifecycle: true });
  var names = ["send_to_partner", "read_partner", "message_partner", "partner_status", "replace_partner", "record_partner_evaluation"];
  for (var i = 0; i < names.length; i++) {
    var found = defs.find(function (entry) { return entry.name === names[i]; });
    assert.ok(found, names[i] + " is present");
    assert.ok(found.inputSchema.workerId, names[i] + " forwards workerId");
    assert.equal(found.inputSchema.workerId.isOptional(), true, names[i] + " keeps workerId optional");
  }
});
