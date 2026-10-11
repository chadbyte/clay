// Update-notification capability and snooze policy.
//
// Two properties matter most and are asserted from several angles: an update
// frame never reaches a connection that is not admin-grade, and a snooze is a
// server-computed deadline for one exact version that no payload can extend.

var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");

var root = path.join(__dirname, "..");

// The store lives under CONFIG_DIR, so each run gets its own CLAY_HOME and the
// module is loaded fresh against it.
function loadModule(t) {
  var home = fs.mkdtempSync(path.join(os.tmpdir(), "clay-update-snooze-"));
  var previousHome = process.env.CLAY_HOME;
  process.env.CLAY_HOME = home;
  delete require.cache[require.resolve("../lib/config")];
  delete require.cache[require.resolve("../lib/update-snooze")];
  var mod = require("../lib/update-snooze");
  t.after(function () {
    if (previousHome === undefined) delete process.env.CLAY_HOME;
    else process.env.CLAY_HOME = previousHome;
    delete require.cache[require.resolve("../lib/config")];
    delete require.cache[require.resolve("../lib/update-snooze")];
    fs.rmSync(home, { recursive: true, force: true });
  });
  return mod;
}

var HOUR = 60 * 60 * 1000;

// A users store the tests can mutate mid-flight, standing in for an admin
// being demoted or deleted while their socket is still open.
function multiUser(records) {
  var live = records || {};
  return {
    isMultiUser: function () { return true; },
    findUserById: function (id) {
      return Object.prototype.hasOwnProperty.call(live, id) ? live[id] : null;
    },
    _records: live,
  };
}
function singleUser() { return { isMultiUser: function () { return false; } }; }
function conn(user) { return { _clayUser: user || null }; }

// The common case: the snapshot and the live record agree.
function adminUsers(id) {
  var records = {};
  records[id] = { id: id, role: "admin" };
  return multiUser(records);
}

// --- Capability -----------------------------------------------------------

test("only admin-grade connections are recognized, and missing identity fails closed", function (t) {
  var mod = loadModule(t);

  // Multi-user: role is the whole test, and an unauthenticated socket loses.
  assert.equal(mod.isUpdateAdmin(conn({ id: "u1", role: "admin" }), adminUsers("u1")), true);
  assert.equal(mod.isUpdateAdmin(conn({ id: "u2", role: "user" }), adminUsers("u2")), false);
  assert.equal(mod.isUpdateAdmin(conn({ id: "u3" }), adminUsers("u3")), false, "no role at all");
  assert.equal(mod.isUpdateAdmin(conn(null), multiUser()), false, "anonymous connection");
  assert.equal(mod.isUpdateAdmin(null, multiUser()), false, "no connection");

  // A forged role-shaped value is still just a string comparison.
  assert.equal(mod.isUpdateAdmin(conn({ id: "u4", role: "Admin" }), adminUsers("u4")), false);
  assert.equal(mod.isUpdateAdmin(conn({ id: "u5", role: ["admin"] }), adminUsers("u5")), false);
  assert.equal(mod.isUpdateAdmin(conn({ id: "u6", role: true }), adminUsers("u6")), false);

  // Single-user installs have no user records by design; the sole local
  // operator is the owner and is admin-grade.
  assert.equal(mod.isUpdateAdmin(conn(null), singleUser()), true);
});

test("the snapshot role alone is never enough; the live record decides", function (t) {
  var mod = loadModule(t);

  // A socket that says "admin" but has no live record is refused.
  assert.equal(mod.isUpdateAdmin(conn({ id: "ghost", role: "admin" }), multiUser({})), false,
    "a deleted user's open socket is not admin-grade");

  // A live record that is not admin is refused however the snapshot reads.
  var demoted = multiUser({ u1: { id: "u1", role: "user" } });
  assert.equal(mod.isUpdateAdmin(conn({ id: "u1", role: "admin" }), demoted), false,
    "a stale admin snapshot cannot outvote the store");

  // Disagreement in the other direction also fails closed: a promotion takes
  // effect on the next connect rather than from a stale snapshot.
  var promoted = multiUser({ u2: { id: "u2", role: "admin" } });
  assert.equal(mod.isUpdateAdmin(conn({ id: "u2", role: "user" }), promoted), false);

  // Only agreement passes.
  assert.equal(mod.isUpdateAdmin(conn({ id: "u3", role: "admin" }), adminUsers("u3")), true);

  // A store with no resolver at all cannot confirm anything.
  assert.equal(mod.isUpdateAdmin(conn({ id: "u4", role: "admin" }),
    { isMultiUser: function () { return true; } }), false, "no findUserById means no confirmation");
});

test("a live connection loses every update right the moment it is demoted or removed", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  var store = adminUsers("boss");
  var socket = conn({ id: "boss", role: "admin" });

  // While the record says admin: delivery, key derivation and snoozing work.
  assert.equal(mod.isUpdateAdmin(socket, store), true);
  assert.equal(mod.userKeyFor(socket, store), "boss");
  assert.equal(mod.snooze(mod.userKeyFor(socket, store), "4.1.0", "3h", now).ok, true);

  // Demote in the store. The socket object is untouched and still claims admin.
  store._records.boss = { id: "boss", role: "user" };
  assert.equal(socket._clayUser.role, "admin", "the snapshot really is stale");

  assert.equal(mod.isUpdateAdmin(socket, store), false, "no more update_available delivery");
  assert.equal(mod.userKeyFor(socket, store), null,
    "no storage key, so snooze/check/channel/install all refuse");
  assert.equal(mod.snooze(mod.userKeyFor(socket, store), "4.1.0", "8h", now).ok, false);
  assert.equal(mod.clearSnooze(mod.userKeyFor(socket, store)), false);

  // Deleting outright is the same answer.
  delete store._records.boss;
  assert.equal(mod.isUpdateAdmin(socket, store), false);
  assert.equal(mod.userKeyFor(socket, store), null);

  // Re-promoting restores it without touching the socket.
  store._records.boss = { id: "boss", role: "admin" };
  assert.equal(mod.isUpdateAdmin(socket, store), true);
});

test("an unreadable users record is treated as denial, not as no restrictions", function (t) {
  var mod = loadModule(t);
  var broken = { isMultiUser: function () { throw new Error("users.json unreadable"); } };
  assert.equal(mod.isUpdateAdmin(conn({ id: "u1", role: "admin" }), broken), false);
  assert.equal(mod.userKeyFor(conn({ id: "u1", role: "admin" }), broken), null);

  // A resolver that throws mid-lookup is also a denial, not a pass.
  var throwsOnLookup = {
    isMultiUser: function () { return true; },
    findUserById: function () { throw new Error("corrupt record"); },
  };
  assert.equal(mod.isUpdateAdmin(conn({ id: "u1", role: "admin" }), throwsOnLookup), false);
  assert.equal(mod.userKeyFor(conn({ id: "u1", role: "admin" }), throwsOnLookup), null);
});

test("the storage key is derived from the connection, never from a payload", function (t) {
  var mod = loadModule(t);
  assert.equal(mod.userKeyFor(conn({ id: "u1", role: "admin" }), adminUsers("u1")), "u1");
  assert.equal(mod.userKeyFor(conn({ id: "u2", role: "user" }), adminUsers("u2")), null);
  assert.equal(mod.userKeyFor(conn(null), multiUser()), null);
  assert.equal(mod.userKeyFor(conn({ role: "admin" }), multiUser()), null, "admin with no id");
  assert.equal(mod.userKeyFor(conn(null), singleUser()), mod.LOCAL_USER_KEY);
  assert.equal(mod.LOCAL_USER_KEY, "__local__");
});

// --- Duration allowlist ---------------------------------------------------

test("only allowlisted duration keys resolve to a deadline", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  assert.equal(mod.resolveDeadline("3h", now, undefined), now + 3 * HOUR);
  assert.equal(mod.resolveDeadline("8h", now, undefined), now + 8 * HOUR);
  assert.ok(mod.resolveDeadline("tomorrow", now, 0) > now);

  var rejected = ["1h", "7d", "forever", "", "3H", "3h ", "__proto__", "constructor", "toString"];
  for (var i = 0; i < rejected.length; i++) {
    assert.equal(mod.resolveDeadline(rejected[i], now, undefined), null, rejected[i] + " is refused");
  }
  assert.equal(mod.resolveDeadline(null, now, undefined), null);
  assert.equal(mod.resolveDeadline(undefined, now, undefined), null);
  assert.equal(mod.resolveDeadline(99999999, now, undefined), null, "a raw number is not a key");
  assert.equal(mod.resolveDeadline({ ms: 99999999 }, now, undefined), null, "nor an object");
  assert.equal(mod.resolveDeadline(["3h"], now, undefined), null, "nor an array");
});

test("Tomorrow is the next calendar day at 09:00 in the offset the client reports", function (t) {
  var mod = loadModule(t);
  assert.equal(mod.TOMORROW_HOUR, 9);

  // 23:00 UTC on the 3rd -> 09:00 UTC on the 4th, ten hours later.
  var lateEvening = Date.UTC(2026, 8, 3, 23, 0, 0);
  assert.equal(mod.resolveDeadline("tomorrow", lateEvening, 0), Date.UTC(2026, 8, 4, 9, 0, 0));

  // 00:30 UTC -> still the *next* day, not this morning: 32.5 hours.
  var justAfterMidnight = Date.UTC(2026, 8, 3, 0, 30, 0);
  assert.equal(mod.resolveDeadline("tomorrow", justAfterMidnight, 0), Date.UTC(2026, 8, 4, 9, 0, 0));

  // 08:00 UTC is before 09:00 but "Tomorrow" still means tomorrow.
  var earlyMorning = Date.UTC(2026, 8, 3, 8, 0, 0);
  assert.equal(mod.resolveDeadline("tomorrow", earlyMorning, 0), Date.UTC(2026, 8, 4, 9, 0, 0));

  // UTC+9: 2026-09-03T23:00Z is already the 4th locally, so the next local
  // day is the 5th at 09:00 local == 2026-09-05T00:00Z.
  assert.equal(mod.resolveDeadline("tomorrow", lateEvening, 540), Date.UTC(2026, 8, 5, 0, 0, 0));

  // UTC-5: 2026-09-03T23:00Z is 18:00 local on the 3rd, so 09:00 local on the
  // 4th == 2026-09-04T14:00Z.
  assert.equal(mod.resolveDeadline("tomorrow", lateEvening, -300), Date.UTC(2026, 8, 4, 14, 0, 0));
});

test("a hostile or malformed offset can never extend a snooze past the maximum", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  assert.equal(mod.MAX_SNOOZE_MS, 36 * HOUR);

  var hostile = [1e9, -1e9, 100000, 1441, -1441, 12.5, NaN, Infinity, "540", null, {}, []];
  for (var i = 0; i < hostile.length; i++) {
    var until = mod.resolveDeadline("tomorrow", now, hostile[i]);
    assert.ok(until !== null, "an unusable offset still yields a deadline");
    assert.ok(until > now, "in the future");
    assert.ok(until - now <= mod.MAX_SNOOZE_MS,
      "offset " + String(hostile[i]) + " is capped at the server maximum");
  }

  // Out-of-range offsets fall back to server local time rather than skewing.
  var serverLocal = mod.resolveDeadline("tomorrow", now, 99999);
  var noOffset = mod.resolveDeadline("tomorrow", now, undefined);
  assert.equal(serverLocal, noOffset, "an invalid offset behaves exactly like none");
});

// --- Persistence and per-version behavior --------------------------------

test("a snooze persists to disk and suppresses only its own version", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  var result = mod.snooze("u1", "4.1.0", "3h", now, undefined);
  assert.equal(result.ok, true);
  assert.equal(result.version, "4.1.0");
  assert.equal(result.until, now + 3 * HOUR);

  assert.ok(fs.existsSync(mod.storePath()), "the deadline is on disk, not in memory");
  var onDisk = JSON.parse(fs.readFileSync(mod.storePath(), "utf8"));
  assert.equal(onDisk.users.u1.version, "4.1.0");
  assert.equal(onDisk.users.u1.until, now + 3 * HOUR);

  assert.equal(mod.isSnoozed("u1", "4.1.0", now + HOUR), true, "same version is suppressed");
  assert.equal(mod.isSnoozed("u1", "4.2.0", now + HOUR), false,
    "a newer version notifies immediately");
  assert.equal(mod.isSnoozed("u1", "4.0.9", now + HOUR), false, "and so does any other version");
});

test("the hourly re-check stays suppressed until the deadline, then surfaces again", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  mod.snooze("u1", "4.1.0", "3h", now, undefined);

  // Three hourly ticks inside the window change nothing.
  for (var hour = 1; hour <= 3; hour++) {
    assert.equal(mod.isSnoozed("u1", "4.1.0", now + hour * HOUR - 1), true,
      "hour " + hour + " is still snoozed");
  }
  assert.equal(mod.isSnoozed("u1", "4.1.0", now + 3 * HOUR), false, "expiry is not inclusive");
  assert.equal(mod.isSnoozed("u1", "4.1.0", now + 4 * HOUR), false,
    "the next normal check surfaces it again with no extra bookkeeping");
});

test("snoozes are isolated per user and survive a fresh read of the store", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  mod.snooze("alice", "4.1.0", "8h", now, undefined);
  assert.equal(mod.isSnoozed("alice", "4.1.0", now + HOUR), true);
  assert.equal(mod.isSnoozed("bob", "4.1.0", now + HOUR), false,
    "one user's snooze never silences another");
  assert.equal(mod.isSnoozed(null, "4.1.0", now + HOUR), false, "nor an unattributed connection");
  assert.equal(mod.isSnoozed("", "4.1.0", now + HOUR), false);

  mod.snooze("bob", "4.1.0", "3h", now, undefined);
  var onDisk = JSON.parse(fs.readFileSync(mod.storePath(), "utf8"));
  assert.deepEqual(Object.keys(onDisk.users).sort(), ["alice", "bob"]);
  assert.equal(onDisk.users.alice.until, now + 8 * HOUR);
  assert.equal(onDisk.users.bob.until, now + 3 * HOUR);

  // Every read goes back to the file, which is what makes one device's snooze
  // apply on another device and across a reload.
  assert.equal(mod.readRecord("alice").until, now + 8 * HOUR);
});

test("a refused snooze writes nothing at all", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  assert.deepEqual(mod.snooze(null, "4.1.0", "3h", now), { ok: false, error: "no_identity" });
  assert.deepEqual(mod.snooze("u1", "", "3h", now), { ok: false, error: "no_update" });
  assert.deepEqual(mod.snooze("u1", null, "3h", now), { ok: false, error: "no_update" });
  assert.deepEqual(mod.snooze("u1", "4.1.0", "99h", now), { ok: false, error: "invalid_duration" });
  assert.equal(fs.existsSync(mod.storePath()), false, "no store file was created");
  assert.equal(mod.isSnoozed("u1", "4.1.0", now), false);
});

test("clearing removes the record so the next check surfaces the update", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  mod.snooze("u1", "4.1.0", "8h", now, undefined);
  assert.equal(mod.isSnoozed("u1", "4.1.0", now + HOUR), true);

  assert.equal(mod.clearSnooze("u1"), true);
  assert.equal(mod.isSnoozed("u1", "4.1.0", now + HOUR), false);
  assert.equal(mod.readRecord("u1"), null);

  assert.equal(mod.clearSnooze("u1"), true, "clearing twice is not an error");
  assert.equal(mod.clearSnooze(null), false, "an unattributed connection clears nothing");
});

test("a corrupt or hand-edited store degrades to 'nothing is snoozed'", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  var config = require("../lib/config");
  config.ensureConfigDir();

  var bad = ["{ not json", "null", "[]", '{"users":null}', '{"users":"nope"}', ""];
  for (var i = 0; i < bad.length; i++) {
    fs.writeFileSync(mod.storePath(), bad[i]);
    assert.equal(mod.isSnoozed("u1", "4.1.0", now), false, "input " + i + " does not throw");
    assert.equal(mod.readRecord("u1"), null);
  }

  // Records with a missing or non-numeric deadline are ignored, not trusted.
  fs.writeFileSync(mod.storePath(), JSON.stringify({
    users: {
      u1: { version: "4.1.0" },
      u2: { version: "4.1.0", until: "9999999999999" },
      u3: { until: now + HOUR },
      u4: { version: "4.1.0", until: now + HOUR },
    },
  }));
  assert.equal(mod.isSnoozed("u1", "4.1.0", now), false, "no deadline");
  assert.equal(mod.isSnoozed("u2", "4.1.0", now), false, "deadline is a string");
  assert.equal(mod.isSnoozed("u3", "4.1.0", now), false, "no version");
  assert.equal(mod.isSnoozed("u4", "4.1.0", now), true, "a well-formed neighbour still works");
});

// --- Write concurrency ----------------------------------------------------

test("a write merges into what is on disk instead of overwriting a stale snapshot", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  mod.snooze("alice", "4.1.0", "8h", now, undefined);

  // Another writer lands between alice's write and bob's. Bob's mutation
  // re-reads under the lock, so carol survives.
  var config = require("../lib/config");
  config.ensureConfigDir();
  var current = JSON.parse(fs.readFileSync(mod.storePath(), "utf8"));
  current.users.carol = { version: "4.1.0", until: now + 5 * HOUR };
  fs.writeFileSync(mod.storePath(), JSON.stringify(current));

  mod.snooze("bob", "4.1.0", "3h", now, undefined);

  var after = JSON.parse(fs.readFileSync(mod.storePath(), "utf8"));
  assert.deepEqual(Object.keys(after.users).sort(), ["alice", "bob", "carol"],
    "no user was erased by a neighbour's write");
  assert.equal(after.users.alice.until, now + 8 * HOUR);
  assert.equal(after.users.bob.until, now + 3 * HOUR);
  assert.equal(after.users.carol.until, now + 5 * HOUR);
});

test("clearing one user leaves every other user's snooze intact", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  mod.snooze("alice", "4.1.0", "8h", now, undefined);
  mod.snooze("bob", "4.1.0", "3h", now, undefined);

  mod.clearSnooze("alice");
  var after = JSON.parse(fs.readFileSync(mod.storePath(), "utf8"));
  assert.deepEqual(Object.keys(after.users), ["bob"]);
  assert.equal(mod.isSnoozed("bob", "4.1.0", now + HOUR), true);
});

test("concurrent writers from separate processes all survive", function (t) {
  // The real proof of the lock: eight processes snooze eight different users
  // against one store at the same moment. Without a lock, read-modify-write
  // loses most of them.
  var mod = loadModule(t);
  var home = process.env.CLAY_HOME;
  var count = 8;

  // With `node -e`, the first extra argument is argv[1]: there is no script
  // path in between.
  var script =
    "var mod = require(" + JSON.stringify(path.join(root, "lib/update-snooze.js")) + ");" +
    "var key = process.argv[1];" +
    "var now = Number(process.argv[2]);" +
    "if (!mod.snooze(key, '4.1.0', '3h', now, undefined).ok) process.exit(1);";

  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  var children = [];
  for (var i = 0; i < count; i++) {
    children.push(require("node:child_process").spawn(
      process.execPath,
      ["-e", script, "user" + i, String(now)],
      { env: Object.assign({}, process.env, { CLAY_HOME: home }), stdio: "ignore" }
    ));
  }

  return Promise.all(children.map(function (child) {
    return new Promise(function (resolve) { child.on("exit", resolve); });
  })).then(function (codes) {
    for (var c = 0; c < codes.length; c++) {
      assert.equal(codes[c], 0, "writer " + c + " reported its snooze as persisted");
    }
    var after = JSON.parse(fs.readFileSync(mod.storePath(), "utf8"));
    var keys = Object.keys(after.users).sort();
    var expected = [];
    for (var i = 0; i < count; i++) expected.push("user" + i);
    assert.deepEqual(keys, expected.sort(),
      "every concurrent writer's snooze survived; none was lost to a stale read");
    for (var j = 0; j < count; j++) {
      assert.equal(after.users["user" + j].until, now + 3 * HOUR);
    }
    // The lock is released, and no temp file is left lying around.
    var leftovers = fs.readdirSync(path.dirname(mod.storePath())).filter(function (name) {
      return name.indexOf("update-snooze.json.") === 0;
    });
    assert.deepEqual(leftovers, [], "no lock or temp file survives a clean run");
  });
});

test("temp files are unique per write, so two writers cannot publish each other's bytes", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  var config = require("../lib/config");
  config.ensureConfigDir();

  var seen = [];
  var realRename = fs.renameSync;
  t.after(function () { fs.renameSync = realRename; });
  fs.renameSync = function (from, to) {
    seen.push(from);
    return realRename.call(fs, from, to);
  };

  mod.snooze("alice", "4.1.0", "3h", now, undefined);
  mod.snooze("bob", "4.1.0", "3h", now, undefined);
  mod.snooze("carol", "4.1.0", "3h", now, undefined);

  assert.equal(seen.length, 3);
  assert.equal(new Set(seen).size, 3, "no two writes share a temp path");
  for (var i = 0; i < seen.length; i++) {
    assert.match(seen[i], new RegExp("update-snooze\\.json\\." + process.pid + "-\\d+\\.tmp$"),
      "the temp name carries the pid and a counter");
  }
});

// --- Lock ownership policy -----------------------------------------------

function writeHolderLock(mod, holder) {
  require("../lib/config").ensureConfigDir();
  var lock = mod.lockPath();
  fs.writeFileSync(lock, typeof holder === "string" ? holder : JSON.stringify(holder) + "\n");
  return lock;
}

function backdate(file, ms) {
  var when = new Date(Date.now() - ms);
  fs.utimesSync(file, when, when);
}

// A pid that is definitely gone: run a child to completion and reuse its pid.
function deadPid() {
  var spawnSync = require("node:child_process").spawnSync;
  var child = spawnSync(process.execPath, ["-e", ""], { stdio: "ignore" });
  return child.pid;
}

test("liveness treats a permission error as alive and rejects malformed pids", function (t) {
  var mod = loadModule(t);

  assert.equal(mod.isHolderAlive(process.pid), true, "our own process is alive");
  // pid 1 is owned by root, so a non-root test process gets EPERM here. Either
  // way the answer must be "alive"; EPERM means the process exists.
  assert.equal(mod.isHolderAlive(1), true, "EPERM is alive, not dead");
  assert.equal(mod.isHolderAlive(deadPid()), false, "an exited process is dead");

  var malformed = [0, -1, -process.pid, 1.5, NaN, Infinity, "123", null, undefined, {}, []];
  for (var i = 0; i < malformed.length; i++) {
    assert.equal(mod.isHolderAlive(malformed[i]), false,
      String(malformed[i]) + " is not an identifiable live holder");
  }
});

test("an old lock held by a live pid is never stolen, however stale it looks", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);
  mod.snooze("alice", "4.1.0", "8h", now, undefined);

  // Our own pid is live by definition. Backdate the lock far past the
  // staleness window: a paused or debugged daemon must still win.
  var lock = writeHolderLock(mod, { pid: process.pid, nonce: "held-by-live", startedAt: 1 });
  backdate(lock, 24 * HOUR);
  var before = fs.readFileSync(lock);
  t.after(function () { try { fs.unlinkSync(lock); } catch (e) {} });

  var result = mod.snooze("bob", "4.1.0", "3h", now, undefined);
  assert.deepEqual(result, { ok: false, error: "not_persisted" },
    "the caller is told it did not stick rather than being lied to");
  assert.deepEqual(fs.readFileSync(lock), before,
    "the live holder's lock is byte-identical: not stolen, not rewritten");
  assert.equal(mod.isSnoozed("alice", "4.1.0", now + HOUR), true, "the store is untouched");
  assert.equal(mod.isSnoozed("bob", "4.1.0", now + HOUR), false);
});

test("a lock whose holder is confirmed dead is reclaimed even while fresh", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  // Current timestamp, so only the liveness check can justify reclaiming it.
  var lock = writeHolderLock(mod, { pid: deadPid(), nonce: "abandoned", startedAt: Date.now() });
  assert.equal(fs.existsSync(lock), true);

  assert.equal(mod.snooze("alice", "4.1.0", "3h", now, undefined).ok, true,
    "a dead holder never wedges snoozing, and does not have to age out first");
  assert.equal(mod.isSnoozed("alice", "4.1.0", now + HOUR), true);
  assert.equal(fs.existsSync(lock), false, "and the lock is released afterwards");
});

test("an unidentifiable lock is reclaimed only once it is unambiguously stale", function (t) {
  var mod = loadModule(t);
  var now = Date.UTC(2026, 8, 3, 12, 0, 0);

  // Unparseable content, written just now: no pid to check and no recorded
  // stamp, so mtime is the only clock available and it is not yet stale.
  var lock = writeHolderLock(mod, "not json at all");
  assert.deepEqual(mod.snooze("alice", "4.1.0", "3h", now, undefined),
    { ok: false, error: "not_persisted" }, "a fresh unidentifiable lock is respected");
  assert.equal(fs.existsSync(lock), true);

  backdate(lock, mod.LOCK_STALE_MS + 60 * 1000);
  assert.equal(mod.snooze("alice", "4.1.0", "3h", now, undefined).ok, true,
    "once unambiguously abandoned it is reclaimed");
  assert.equal(fs.existsSync(lock), false);

  // Well-formed JSON with no pid follows the same age policy, but ages by its
  // own recorded stamp rather than by mtime, which anything can touch.
  writeHolderLock(mod, { nonce: "x", startedAt: Date.now() });
  backdate(mod.lockPath(), 24 * HOUR);
  assert.equal(mod.snooze("bob", "4.1.0", "3h", now, undefined).ok, false,
    "a recent pid-less holder is respected even with a backdated mtime");

  writeHolderLock(mod, { nonce: "x", startedAt: Date.now() - mod.LOCK_STALE_MS - 60 * 1000 });
  assert.equal(mod.snooze("bob", "4.1.0", "3h", now, undefined).ok, true,
    "and is reclaimed once its own stamp is stale");

  // A future stamp must not wedge the lock forever.
  writeHolderLock(mod, { nonce: "x", startedAt: Date.now() + 365 * 24 * HOUR });
  assert.equal(mod.snooze("carol", "4.1.0", "3h", now, undefined).ok, false,
    "it is respected for the normal staleness window, starting now");
  assert.equal(fs.existsSync(mod.lockPath()), true);
  try { fs.unlinkSync(mod.lockPath()); } catch (e) {}
});

test("a holder cannot release a successor's lock", function (t) {
  var mod = loadModule(t);
  require("../lib/config").ensureConfigDir();

  var mine = mod.acquireLock();
  assert.ok(mine && mine.nonce, "a token carries the nonce that proves ownership");
  assert.equal(mine.pid, process.pid);

  // Ownership changes underneath us: same pid, different acquisition.
  var successor = { pid: process.pid, nonce: "successor-nonce", startedAt: Date.now() };
  fs.writeFileSync(mod.lockPath(), JSON.stringify(successor) + "\n");
  var before = fs.readFileSync(mod.lockPath());

  mod.releaseLock(mine);
  assert.equal(fs.existsSync(mod.lockPath()), true,
    "releasing a stale token leaves the successor's lock in place");
  assert.deepEqual(fs.readFileSync(mod.lockPath()), before, "and untouched");

  // A recycled pid with our nonce is equally not ours.
  fs.writeFileSync(mod.lockPath(), JSON.stringify({
    pid: process.pid + 1, nonce: mine.nonce, startedAt: Date.now(),
  }) + "\n");
  mod.releaseLock(mine);
  assert.equal(fs.existsSync(mod.lockPath()), true, "pid must match too, not just the nonce");

  // The real owner's token does release it.
  fs.writeFileSync(mod.lockPath(), JSON.stringify({
    pid: mine.pid, nonce: mine.nonce, startedAt: Date.now(),
  }) + "\n");
  mod.releaseLock(mine);
  assert.equal(fs.existsSync(mod.lockPath()), false);

  // Releasing nothing, or a token for a file that is already gone, is safe.
  assert.doesNotThrow(function () {
    mod.releaseLock(mine);
    mod.releaseLock(null);
    mod.releaseLock({});
  });
});

test("each acquisition stamps a fresh nonce, so tokens are never interchangeable", function (t) {
  var mod = loadModule(t);
  require("../lib/config").ensureConfigDir();

  var seen = {};
  for (var i = 0; i < 5; i++) {
    var token = mod.acquireLock();
    assert.ok(token, "acquisition " + i + " succeeded");
    assert.equal(seen[token.nonce], undefined, "the nonce is fresh every time");
    seen[token.nonce] = true;
    var onDisk = JSON.parse(fs.readFileSync(mod.lockPath(), "utf8"));
    assert.equal(onDisk.pid, process.pid);
    assert.equal(onDisk.nonce, token.nonce, "the file records the same nonce the token holds");
    assert.ok(typeof onDisk.startedAt === "number" && onDisk.startedAt > 0);
    mod.releaseLock(token);
  }
  assert.equal(Object.keys(seen).length, 5);
});

// --- Server wiring --------------------------------------------------------

var projectSource = fs.readFileSync(path.join(root, "lib/project.js"), "utf8");
var sessionsSource = fs.readFileSync(path.join(root, "lib/project-sessions.js"), "utf8");
var connectionSource = fs.readFileSync(path.join(root, "lib/project-connection.js"), "utf8");
var schemaSource = fs.readFileSync(path.join(root, "lib/ws-schema.js"), "utf8");

test("the hourly broadcast filters by capability and by snooze, per connection", function () {
  var fn = projectSource.slice(projectSource.indexOf("function broadcastUpdateAvailable(version)"));
  fn = fn.slice(0, fn.indexOf("\n  // Tell every live connection"));

  assert.match(fn, /if \(!updateSnooze\.isUpdateAdmin\(ws, usersModule\)\) continue;/,
    "a non-admin connection is skipped before any version metadata is written");
  assert.match(fn, /var key = updateSnooze\.userKeyFor\(ws, usersModule\);/);
  assert.match(fn, /if \(updateSnooze\.isSnoozed\(key, version, now\)\) continue;/,
    "and so is a connection snoozing this exact version");
  assert.ok(fn.indexOf("isUpdateAdmin") < fn.indexOf("ws.send("),
    "the capability check precedes the send");

  // The hourly tick still runs; only delivery is suppressed.
  assert.match(projectSource, /setTimeout\(function tick\(\) \{\s*\n\s*runVersionCheck\(true\);/,
    "the cheap hourly check is unchanged");
  assert.match(projectSource, /if \(broadcast\) broadcastUpdateAvailable\(v\);/,
    "and routes through the filtered broadcast rather than sendToAdmins");
});

test("every update message type is gated by the one canonical check", function () {
  var types = ["set_update_channel", "check_update", "update_snooze", "update_now"];
  for (var i = 0; i < types.length; i++) {
    var handler = sessionsSource.slice(sessionsSource.indexOf('if (msg.type === "' + types[i] + '")'));
    handler = handler.slice(0, handler.indexOf("\n      return true;"));
    assert.match(handler, /if \(!updateSnooze\.isUpdateAdmin\(ws, usersModule\)\) (?:return true;|\{[\s\S]*?return true; \})/,
      types[i] + " is gated");
    assert.ok(handler.indexOf("isUpdateAdmin") < 120,
      types[i] + " is gated on the first line, before any work");
    // The old inline role test is gone from each of them, so admin-grade has
    // exactly one definition. Unrelated handlers keep their own checks.
    assert.equal(/_clayUser\.role !== "admin"|_clayUser \|\| ws\._clayUser\.role/.test(handler), false,
      types[i] + " no longer hand-rolls the role check");
  }
});

test("the snooze handler trusts nothing in the payload except the duration key", function () {
  var handler = sessionsSource.slice(sessionsSource.indexOf('if (msg.type === "update_snooze")'));
  handler = handler.slice(0, handler.indexOf("\n      return true;\n    }\n\n    if (msg.type === \"update_now\")"));

  assert.match(handler, /var snoozeKey = updateSnooze\.userKeyFor\(ws, usersModule\);/,
    "identity comes from the connection");
  assert.match(handler, /getLatestVersion\(\)/, "the target version is the server's own");
  assert.equal(/msg\.version|msg\.until|msg\.userId|msg\.user/.test(handler), false,
    "no version, deadline or identity is read from the payload");
  assert.match(handler, /msg\.duration/, "the duration key is read");
  assert.match(handler, /msg\.tzOffsetMinutes/, "and the timezone hint");
  assert.match(handler, /Date\.now\(\)/, "the clock is the server's");
});

test("a snooze reaches every device of that user and nobody else", function () {
  var fn = projectSource.slice(projectSource.indexOf("function sendToUpdateUser(userKey, obj)"));
  fn = fn.slice(0, fn.indexOf("\n  function broadcastClientCount"));
  assert.match(fn, /if \(updateSnooze\.userKeyFor\(ws, usersModule\) !== userKey\) continue;/,
    "fan-out is scoped by the same server-derived key the snooze was stored under");
  assert.match(fn, /if \(!userKey\) return;/, "an unattributed key fans out to nobody");

  var handler = sessionsSource.slice(sessionsSource.indexOf('if (msg.type === "update_snooze")'));
  assert.match(handler, /sendToUpdateUser\(snoozeKey, \{\s*\n\s*type: "update_snoozed",/);
});

test("no update lifecycle frame carries version metadata to a non-admin", function () {
  // update_started is the only lifecycle frame besides update_available and
  // up_to_date, and it has to reach everyone because the daemon is restarting.
  // Only the version is withheld.
  var fn = projectSource.slice(projectSource.indexOf("function broadcastUpdateStarted(version)"));
  fn = fn.slice(0, fn.indexOf("\n  // Tell every live connection"));

  assert.match(fn, /var withoutVersion = JSON\.stringify\(\{ type: "update_started" \}\);/,
    "the non-admin frame has no version field at all");
  assert.match(fn, /ws\.send\(updateSnooze\.isUpdateAdmin\(ws, usersModule\) \? withVersion : withoutVersion\);/,
    "and the split is the same canonical capability check");

  // The broadcast-to-everyone send is gone from the install handler.
  var handler = sessionsSource.slice(sessionsSource.indexOf('if (msg.type === "update_now")'));
  handler = handler.slice(0, handler.indexOf("\n      return true;"));
  assert.match(handler, /broadcastUpdateStarted\(getLatestVersion\(\)\);/);
  assert.equal(/send\(\{ type: "update_started"/.test(handler), false,
    "no unfiltered project-wide send of version metadata");

  // No version-bearing update frame is ever broadcast project-wide. The only
  // remaining direct emission is check_update's reply to the socket that
  // asked, inside a handler already gated on the first line.
  var both = projectSource + sessionsSource;
  assert.equal(/\bsend\(\{\s*type: "update_(available|started)"/.test(both), false,
    "no unfiltered project-wide send of an update frame");
  var direct = sessionsSource.match(/type: "update_(available|started)"/g) || [];
  assert.equal(direct.length, 1, "one direct emission in the handlers");
  assert.match(sessionsSource, /sendTo\(ws, \{ type: "update_available", version: v \}\);/,
    "and it is a reply to the requesting socket, not a broadcast");

  // And the schema says so, so the constraint is discoverable.
  assert.match(schemaSource, /"update_started":[\s\S]*?version field is included only for admin-grade recipients/);
});

test("deliberate re-engagement clears the snooze, dismissal does not", function () {
  var check = sessionsSource.slice(sessionsSource.indexOf('if (msg.type === "check_update")'));
  check = check.slice(0, check.indexOf("\n      return true;"));
  assert.match(check, /updateSnooze\.clearSnooze\(updateSnooze\.userKeyFor\(ws, usersModule\)\)/,
    "a manual check ends the snooze so what is shown matches what is stored");

  var now = sessionsSource.slice(sessionsSource.indexOf('if (msg.type === "update_now")'));
  now = now.slice(0, now.indexOf("\n      return true;"));
  assert.match(now, /updateSnooze\.clearSnooze\(/, "installing makes the record moot");

  // Dismissing a banner stays a client-side, this-instance-only act.
  assert.equal(/update_dismiss|dismissUpdate/.test(sessionsSource), false);
});

test("reconnect still pushes no update frame, so nothing flashes on connect", function () {
  assert.equal(/update_available/.test(connectionSource), false,
    "connect sends no version metadata at all");
  assert.match(connectionSource, /pushed on a scheduled interval/,
    "the existing rationale is intact");
});

test("both message types are registered in the schema with the right direction", function () {
  assert.match(schemaSource, /"update_snooze":\s*\{ direction: "c2s", handler: "lib\/project-sessions\.js"/);
  assert.match(schemaSource, /"update_snoozed":\s*\{ direction: "s2c", handler: "lib\/public\/modules\/update-snooze\.js"/);
});

// --- Conventions ----------------------------------------------------------

test("the server module follows the server conventions", function () {
  var src = fs.readFileSync(path.join(root, "lib/update-snooze.js"), "utf8");
  assert.equal(/=>/.test(src), false, "no arrow functions");
  assert.equal(/^\s*(const|let)\s/m.test(src), false, "var only");
  assert.match(src, /module\.exports = \{/, "CommonJS");
  assert.equal(/^import /m.test(src), false);
  assert.ok(src.split("\n").length < 500, "under the module size limit");

  // project.js stays a coordinator: it owns the client set, not the policy.
  var broadcast = projectSource.slice(projectSource.indexOf("function broadcastUpdateAvailable(version)"));
  broadcast = broadcast.slice(0, broadcast.indexOf("\n  // Tell every live connection"));
  assert.equal(/SNOOZE_OPTIONS|3 \* 60 \* 60|readFileSync|JSON\.parse/.test(broadcast), false,
    "no snooze policy or storage leaked into project.js");
});
