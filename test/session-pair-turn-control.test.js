var test = require("node:test");
var assert = require("node:assert/strict");
var controlModule = require("../lib/session-pair-turn-control");

function fixture() {
  var driver = { localId: 1, ownerId: "owner" };
  var worker = { localId: 2, ownerId: "owner" };
  var sessions = new Map([[1, driver], [2, worker]]);
  var group = { id: "pair", members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  var control = controlModule.attachPairTurnControl({
    sm: { sessions: sessions },
    splitStore: { groupForMember: function (id) { return group.members.indexOf(id) === -1 ? null : group; } },
  });
  return { control: control, driver: driver, worker: worker };
}

test("a human Worker stop blocks orchestration until a new Driver message", function () {
  var f = fixture();
  var roles = f.control.markHumanStop(f.worker);
  assert.equal(roles.driver, f.driver);
  assert.match(f.control.blockedReason(f.driver), /human stopped/);
  assert.throws(function () { f.control.assertWorkerAction(f.driver); }, /blocked until the human sends a new message/);

  assert.equal(f.control.beginHumanTurn(f.worker), false, "a Worker message cannot clear the barrier");
  assert.match(f.control.blockedReason(f.driver), /human stopped/);
  assert.equal(f.control.beginHumanTurn(f.driver), true);
  assert.equal(f.control.blockedReason(f.driver), null);
});

test("Worker creation and replacement retries are bounded per human turn", function () {
  var f = fixture();
  f.control.reserveCreation(f.driver, "create");
  f.control.reserveCreation(f.driver, "replace");
  assert.throws(function () { f.control.reserveCreation(f.driver, "replace"); }, /replacement limit/);
  assert.throws(function () { f.control.reserveCreation(f.driver, "create"); }, /creation limit/);

  f.control.beginHumanTurn(f.driver);
  assert.doesNotThrow(function () { f.control.reserveCreation(f.driver, "replace"); });
});

test("failed creation reservations are released", function () {
  var f = fixture();
  var ticket = f.control.reserveCreation(f.driver, "replace");
  f.control.releaseCreation(ticket);
  assert.doesNotThrow(function () { f.control.reserveCreation(f.driver, "replace"); });
});

test("an operation id returns one shared operation promise within a turn", async function () {
  var f = fixture();
  var calls = 0;
  function run() {
    calls += 1;
    return { calls: calls };
  }
  var first = f.control.runOperation(f.driver, "send", "turn-1-send-1", run);
  var second = f.control.runOperation(f.driver, "send", "turn-1-send-1", run);
  assert.equal(first, second);
  assert.deepEqual(await first, { calls: 1 });
  assert.equal(calls, 1);
  await assert.rejects(f.control.runOperation(f.driver, "send", "turn-1-send-1", run, "different"), /different input/);

  f.control.beginHumanTurn(f.driver);
  assert.deepEqual(await f.control.runOperation(f.driver, "send", "turn-1-send-1", run), { calls: 2 });
});
