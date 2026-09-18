var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var roles = require("../lib/session-split-group-roles");
var anchors = require("../lib/session-split-group-anchors");

function sessions() {
  return new Map([
    [1, { localId: 1, cliSessionId: "cli-driver", sessionOriginId: "origin-driver" }],
    [2, { localId: 2, cliSessionId: "cli-worker-a", sessionOriginId: "origin-worker-a" }],
    [3, { localId: 3, cliSessionId: "cli-worker-b", sessionOriginId: "origin-worker-b" }],
  ]);
}

test("role normalization preserves legacy pairs and supports a bounded version 2 shape", function () {
  var legacy = roles.normalizePair({ driverId: 1, workerId: 2 }, [1, 2]);
  assert.deepStrictEqual(legacy, { ok: true, kind: "legacy", version: null, driverId: 1, workerIds: [2] });
  var versioned = roles.normalizePair({ version: 2, driverId: 1, workerIds: [2, 3] }, [1, 2, 3]);
  assert.deepStrictEqual(versioned, { ok: true, kind: "versioned", version: 2, driverId: 1, workerIds: [2, 3] });
  assert.deepStrictEqual(roles.resolveWorkerTarget(legacy, null), { ok: true, workerId: 2 });
  assert.deepStrictEqual(roles.resolveWorkerTarget(versioned, 3), { ok: true, workerId: 3 });
  assert.match(roles.resolveWorkerTarget(versioned, null).error, /workerId is required/);
  assert.match(roles.resolveWorkerTarget(versioned, 9).error, /exact configured Worker/);
});

test("live target matching preserves ad-hoc pairs and fences Worker generations", function () {
  var current = sessions();
  current.get(1).ownerId = "owner"; current.get(2).ownerId = "owner"; current.get(3).ownerId = "owner";
  var sm = { sessions: current };
  var adhoc = { id: "adhoc", members: [1, 2] };
  assert.equal(roles.matchesLiveTarget(sm, adhoc, current.get(1), current.get(2)), true);
  assert.equal(roles.matchesLiveTarget(sm, adhoc, current.get(2), current.get(1)), true);
  current.get(2)._pairGeneration = 7;
  assert.equal(roles.tokenMatchesWorker(current.get(2), { workerSessionId: 2, generation: 7 }), true);
  assert.equal(roles.tokenMatchesWorker(current.get(2), { workerSessionId: 2, generation: 6 }), false);
  current.get(2).ownerId = "other";
  assert.equal(roles.matchesLiveTarget(sm, adhoc, current.get(1), current.get(2)), false);
});

test("role normalization rejects conflicting, incomplete, duplicate, extra, and unknown forms", function () {
  var invalid = [
    [{ version: 1, driverId: 1, workerId: 2 }, [1, 2]],
    [{ version: 2, driverId: 1, workerId: 2, workerIds: [2] }, [1, 2]],
    [{ version: 2, driverId: 1 }, [1, 2]],
    [{ version: 2, driverId: 1, workerIds: [] }, [1, 2]],
    [{ version: 2, driverId: 1, workerIds: [2, 2] }, [1, 2, 3]],
    [{ version: 2, driverId: 1, workerIds: [2] }, [1, 2, 3]],
    [{ driverId: 1, workerId: 2 }, [1, 2, 3]],
  ];
  for (var i = 0; i < invalid.length; i++) assert.strictEqual(roles.normalizePair(invalid[i][0], invalid[i][1]).ok, false);
  assert.match(roles.validateStorePair({ version: 2, driverId: 1, workerIds: [2, 3] }, [1, 2, 3]).error, /reserved/);
  assert.match(roles.normalizePair(null, [1, 2, 3]).error, /exactly two/);
});

test("versioned anchors resolve roles by stable CLI and origin identities after reorder and renumber", function () {
  var current = sessions();
  var group = { members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3] } };
  var memberAnchors = anchors.memberAnchors(group, current);
  var pairAnchors = anchors.pairAnchors(group, current);
  assert.deepStrictEqual(anchors.resolveVersionedMembers(new Map([
    [11, { localId: 11, cliSessionId: "cli-worker-b", sessionOriginId: "origin-worker-b" }],
    [12, { localId: 12, cliSessionId: "cli-driver", sessionOriginId: "origin-driver" }],
    [13, { localId: 13, cliSessionId: "cli-worker-a", sessionOriginId: "origin-worker-a" }],
  ]), memberAnchors).map(function (session) { return session.sessionOriginId; }),
  ["origin-driver", "origin-worker-a", "origin-worker-b"]);
  var resolved = anchors.resolveVersionedPair(new Map([
    [11, { localId: 11, cliSessionId: "cli-worker-b", sessionOriginId: "origin-worker-b" }],
    [12, { localId: 12, cliSessionId: "cli-driver", sessionOriginId: "origin-driver" }],
    [13, { localId: 13, cliSessionId: "cli-worker-a", sessionOriginId: "origin-worker-a" }],
  ]), pairAnchors);
  assert.strictEqual(resolved.driver.localId, 12);
  assert.deepStrictEqual(resolved.workers.map(function (session) { return session.localId; }), [13, 11]);
  var reordered = { members: [3, 1, 2], pair: group.pair };
  assert.deepStrictEqual(anchors.versionedMemberAnchors(reordered, current).members.map(function (anchor) { return anchor.origin; }),
    ["origin-worker-b", "origin-driver", "origin-worker-a"]);
  assert.strictEqual(anchors.resolveVersionedMembers(new Map([[1, { localId: 1 }]]), memberAnchors), null,
    "versioned anchors never fall back to local ids");
});

test("anchor boundaries reject malformed roles, invalid counts, disagreement, ambiguity, and missing anchors", function () {
  var current = sessions();
  var valid = { members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3] } };
  assert.ok(anchors.memberAnchors(valid, current));
  assert.ok(anchors.pairAnchors(valid, current));
  var invalidGroups = [
    { members: [1, 2, 3], pair: { version: 3, driverId: 1, workerIds: [2, 3] } },
    { members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 2] } },
    { members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3, 4] } },
    { members: [1, 2], pair: { version: 2, driverId: 1, workerIds: [1] } },
  ];
  for (var i = 0; i < invalidGroups.length; i++) {
    assert.strictEqual(anchors.memberAnchors(invalidGroups[i], current), null);
    assert.strictEqual(anchors.pairAnchors(invalidGroups[i], current), null);
  }
  var incomplete = new Map(current);
  incomplete.delete(3);
  assert.strictEqual(anchors.memberAnchors(valid, incomplete), null);
  assert.strictEqual(anchors.pairAnchors(valid, incomplete), null);
  assert.strictEqual(anchors.findSession(current, "cli-driver", "origin-worker-a"), null);
  var ambiguous = new Map([
    [4, { localId: 4, cliSessionId: "same-cli", sessionOriginId: "origin-4" }],
    [5, { localId: 5, cliSessionId: "same-cli", sessionOriginId: "origin-5" }],
  ]);
  assert.strictEqual(anchors.findSession(ambiguous, "same-cli", null), null);
  assert.strictEqual(anchors.resolveVersionedPair(ambiguous, {
    version: 2, driver: { cli: "same-cli", origin: null }, workers: [{ cli: "originless", origin: "origin-4" }],
  }), null);
  assert.strictEqual(anchors.resolveVersionedPair(current, {
    version: 2, driver: { cli: "cli-driver", origin: "origin-driver" }, workers: [],
  }), null);
});

test("legacy anchor arrays remain position-compatible and resolve exact identities", function () {
  var current = sessions();
  var group = { members: [1, 2], pair: { driverId: 1, workerId: 2 } };
  assert.deepStrictEqual(anchors.memberAnchors(group, current), {
    cli: ["cli-driver", "cli-worker-a"], origin: ["origin-driver", "origin-worker-a"],
  });
  assert.deepStrictEqual(anchors.pairAnchors(group, current), {
    cli: ["cli-driver", "cli-worker-a"], origin: ["origin-driver", "origin-worker-a"],
  });
  assert.strictEqual(anchors.findSession(current, "cli-worker-a", "origin-worker-a").localId, 2);
});

test("the production split store rejects versioned multi-member admission", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-role-gate-"));
  try {
    var current = sessions();
    var store = require("../lib/session-split-groups").createSplitGroupStore({ sessions: current, sessionsDir: dir, usersModule: null });
    assert.strictEqual(store.create(null, { members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3] } }).ok, false);
    fs.writeFileSync(path.join(dir, "split-groups.json"), JSON.stringify([{ id: "v2", members: [1, 2, 3], pair: { version: 2, driverId: 1, workerIds: [2, 3] } }]));
    var reloaded = require("../lib/session-split-groups").createSplitGroupStore({ sessions: current, sessionsDir: dir, usersModule: null });
    assert.deepStrictEqual(reloaded.groups, []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("loading and mutating preserves unsupported future-format records on disk", function () {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-role-preserve-"));
  try {
    var current = sessions();
    var future = {
      id: "future-format", members: [1, 2, 3],
      pair: { version: 2, driverId: 1, workerIds: [2, 3] },
      futureField: { preserved: true },
    };
    var file = path.join(dir, "split-groups.json");
    fs.writeFileSync(file, JSON.stringify([future], null, 2) + "\n");
    var store = require("../lib/session-split-groups").createSplitGroupStore({ sessions: current, sessionsDir: dir, usersModule: null });
    assert.deepStrictEqual(store.groups, []);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, "utf8")), [future]);
    assert.strictEqual(store.create(null, { members: [1, 2] }).ok, true);
    var persisted = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepStrictEqual(persisted.find(function (group) { return group.id === future.id; }), future);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
