var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var createSessionManager = require("../lib/sessions").createSessionManager;
var sessionProvenance = require("../lib/session-provenance");
var folders = require("../lib/session-folders");
var attachSessionDelete = require("../lib/project-session-delete").attachSessionDelete;
var attachFolders = require("../lib/project-session-folders").attachSessionFolders;

function env(keys) {
  var set = {};
  keys.forEach(function (k) { set[k] = true; });
  return { canOrganize: function (k) { return !!set[k]; }, exists: function (k) { return !!set[k]; } };
}

function apply(state, op, keys) {
  return folders.applyOperation(state, op, env(keys || ["a", "b", "c", "d"]));
}

// --- Pure model: contents move, delete never reaches it ---

test("delete_folder defaults to Unfiled and old requests keep that meaning", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "Work" });
  var work = s.folderId;
  s = apply(s.state, { op: "place_session", sessionKey: "a", folderId: work }).state;
  var legacy = apply(s, { op: "delete_folder", folderId: work });
  assert.ok(legacy.state);
  assert.deepStrictEqual(legacy.state.folders, []);
  assert.strictEqual(legacy.state.assignments.a, undefined, "contents are Unfiled");
  var explicit = apply(s, { op: "delete_folder", folderId: work, mode: "unfiled" });
  assert.deepStrictEqual(explicit.state.assignments, {});
});

test("moving to another folder keeps the source order and appends to the destination", function () {
  var s = folders.defaultState();
  var a = apply(s, { op: "create_folder", name: "A" });
  var b = apply(a.state, { op: "create_folder", name: "B" });
  var from = a.folderId;
  var to = b.folderId;
  s = b.state;
  ["a", "b", "c"].forEach(function (k) { s = apply(s, { op: "place_session", sessionKey: k, folderId: from }).state; });
  s = apply(s, { op: "set_order", containerKey: from, order: ["c", "a", "b"] }).state;
  s = apply(s, { op: "place_session", sessionKey: "d", folderId: to, order: ["d"] }).state;
  var moved = apply(s, { op: "delete_folder", folderId: from, mode: "move", destinationId: to });
  assert.ok(moved.state, moved.error);
  assert.deepStrictEqual(moved.state.folders.map(function (f) { return f.id; }), [to]);
  assert.deepStrictEqual(moved.state.orders[to], ["d", "c", "a", "b"]);
  ["a", "b", "c", "d"].forEach(function (k) { assert.strictEqual(moved.state.assignments[k], to); });
  assert.strictEqual(moved.state.orders[from], undefined);
});

test("Favorites is a tag, not a destination; bad destinations are refused before any change", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "A" });
  var id = s.folderId;
  s = apply(s.state, { op: "place_session", sessionKey: "a", folderId: id }).state;
  ["favorites", "f_gone0000", id, "unfiled", "", undefined, 5].forEach(function (dest) {
    var r = apply(s, { op: "delete_folder", folderId: id, mode: "move", destinationId: dest });
    assert.ok(r.error, String(dest));
  });
  assert.ok(apply(s, { op: "delete_folder", folderId: id, mode: "delete" }).error, "deleting sessions is not a model operation");
  assert.ok(apply(s, { op: "delete_folder", folderId: "favorites" }).error, "Favorites cannot be deleted");
  assert.ok(apply(s, { op: "delete_folder", folderId: "unfiled" }).error, "Unfiled cannot be deleted");
});

// --- Handler with the real session manager and deletion service ---

function fixture(t, options) {
  options = options || {};
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-folder-delete-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var sm = createSessionManager({ cwd: path.join(dir, "project"), sessionsBase: path.join(dir, "sessions"),
    cliSessionsDir: path.join(dir, "cli"), send: function () {}, sendTo: function () {} });
  sm.installedVendors = ["claude", "codex"];
  sm.modelsByVendor = { claude: [{ value: "claude-model" }], codex: [{ value: "codex-model" }] };
  var stored = {};
  var denied = new Set();
  var sent = [];
  var calls = [];
  var users = {
    isMultiUser: function () { return !!options.multiUser; },
    canAccessSession: function (userId, session) { return (session.ownerId || null) === userId && !denied.has(session.localId); },
    getEffectivePermissions: function () { return { sessionDelete: options.deletePermission !== false }; },
    getSessionFolders: function (uid, slug) { return folders.normalizeState(stored[uid + "/" + slug]); },
    setSessionFolders: function (uid, slug, st) {
      if (f && f.throwOnSave) throw new Error("disk full");
      if (options.failSave) return { error: "Could not save folders" };
      stored[uid + "/" + slug] = folders.normalizeState(st);
      return { ok: true, state: stored[uid + "/" + slug] };
    },
  };
  var f = null;
  var wsA = options.multiUser ? { _clayUser: { id: "u1" } } : {};
  var wsB = options.multiUser ? { _clayUser: { id: "u2" } } : null;
  var clients = new Set([wsA]);
  if (wsB) clients.add(wsB);
  function sendTo(ws, msg) { sent.push({ ws: ws, msg: msg }); }
  var sessionDelete = attachSessionDelete({
    sm: sm, usersModule: users, osUsers: null, sendTo: sendTo,
    tm: { close: function (id) { calls.push("pty:" + id); } },
    getProjectAccess: function () { return { visibility: "public" }; },
    stopTitleWatcher: function (s) { if (s._titleWatcherStop) s._titleWatcherStop(); },
  });
  var handler = attachFolders({
    sm: sm, usersModule: users, slug: "proj", clients: clients, sendTo: sendTo,
    getProjectAccess: function () { return { visibility: "public" }; }, sessionDelete: sessionDelete,
  });
  f = { sm: sm, handler: handler, ws: wsA, wsB: wsB, sent: sent, calls: calls, denied: denied, stored: stored, nextRid: 0 };
  f.make = function (name, ownerId, extra) {
    var s = sm.createSessionRaw(Object.assign({ cliSessionId: "cli-" + name, vendor: "codex", model: "codex-model", ownerId: ownerId || null }, extra || {}));
    s.title = name;
    s._titleWatcherStop = function () { calls.push("watcher:" + name); };
    return s;
  };
  f.worker = function (driver, name) {
    var w = f.make(name, driver.ownerId);
    sessionProvenance.markWorker(driver, w, sm.sessions);
    return w;
  };
  f.alive = function (s) { return sm.sessions.get(s.localId) === s; };
  f.last = function (type, rid) {
    for (var i = sent.length - 1; i >= 0; i--) if (sent[i].msg.type === type && (rid === undefined || sent[i].msg.requestId === rid)) return sent[i].msg;
    return null;
  };
  f.send = function (ws, msg) { handler.handleMessage(ws || f.ws, Object.assign({ slug: "proj" }, msg)); };
  f.op = function (op, ws) { f.send(ws, { type: "session_folders_op", op: op }); };
  f.state = function (ws) { f.send(ws, { type: "session_folders_get" }); return f.last("session_folders_state").state; };
  f.createFolder = function (name, ws) {
    var rid = "c" + (++f.nextRid);
    f.send(ws, { type: "session_folders_op", requestId: rid, op: { op: "create_folder", name: name } });
    return f.last("session_folders_state", rid).folderId;
  };
  f.file = function (session, folderId, ws) { f.op({ op: "place_session", sessionId: session.localId, folderId: folderId }, ws); };
  f.preview = function (folderId, ws) {
    var rid = "p" + (++f.nextRid);
    f.send(ws, { type: "session_folders_delete_preview", folderId: folderId, requestId: rid });
    return f.last("session_folders_delete_preview_result", rid) || f.last("session_folders_state", rid);
  };
  f.remove = function (folderId, extra, ws) {
    var pv = f.preview(folderId, ws);
    var rid = "d" + (++f.nextRid);
    f.send(ws, Object.assign({ type: "session_folders_delete", folderId: folderId, requestId: rid, token: pv.token }, extra));
    return { rid: rid, reply: f.last("session_folders_state", rid), preview: pv };
  };
  return f;
}

// One Driver (two Worker generations, one of them hidden from the sidebar), a
// standalone session and an unrelated Driver outside the folder.
function build(t, options) {
  var f = fixture(t, options);
  var owner = options && options.multiUser ? "u1" : null;
  var driver = f.make("driver", owner);
  var gen1 = f.worker(driver, "gen1");
  var gen2 = f.worker(driver, "gen2");
  gen1.hidden = true;
  var plain = f.make("plain", owner);
  var outside = f.make("outside", owner);
  var outsideWorker = f.worker(outside, "outside-worker");
  var work = f.createFolder("Work", f.ws);
  var other = f.createFolder("Other", f.ws);
  f.file(driver, work);
  f.file(plain, work);
  return Object.assign(f, { driver: driver, gen1: gen1, gen2: gen2, plain: plain, outside: outside, outsideWorker: outsideWorker, work: work, other: other });
}

test("preview reports the server's full membership, Workers included, with no origin keys", function (t) {
  var f = build(t);
  var pv = f.preview(f.work);
  assert.strictEqual(pv.type, "session_folders_delete_preview_result");
  assert.strictEqual(pv.sessionCount, 2, "two organizable sessions");
  assert.strictEqual(pv.workerCount, 2, "both Worker generations, hidden one included");
  assert.strictEqual(pv.totalCount, 4);
  assert.strictEqual(pv.canDeleteSessions, true);
  assert.ok(typeof pv.token === "string" && pv.token.length >= 16);
  var json = JSON.stringify(pv);
  [f.driver, f.plain, f.gen1].forEach(function (s) { assert.strictEqual(json.indexOf(s.sessionOriginId), -1, "no origin id in the preview"); });
  assert.strictEqual(f.preview("favorites").error, "Folder not found");
  assert.strictEqual(f.preview("unfiled").error, "Folder not found");
});

test("move to Unfiled: nothing is deleted and the folder goes away", function (t) {
  var f = build(t);
  var r = f.remove(f.work, { mode: "unfiled" });
  assert.ok(!r.reply.error, r.reply.error);
  assert.strictEqual(r.reply.folderDeleted, f.work);
  assert.ok(f.alive(f.driver) && f.alive(f.gen1) && f.alive(f.plain));
  var st = f.state();
  assert.deepStrictEqual(st.folders.map(function (x) { return x.id; }), [f.other]);
  assert.strictEqual(st.assignments[f.driver.localId], undefined);
});

test("move to another folder keeps sessions and refuses a bad destination untouched", function (t) {
  var f = build(t);
  ["", f.work, "unfiled", "f_missing00"].forEach(function (dest) {
    var r = f.remove(f.work, { mode: "move", destinationId: dest });
    assert.match(r.reply.error, /another folder/, "destination " + dest);
  });
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }), "folder still exists");
  var ok = f.remove(f.work, { mode: "move", destinationId: f.other });
  assert.ok(!ok.reply.error, ok.reply.error);
  var st = f.state();
  assert.strictEqual(st.assignments[f.driver.localId], f.other);
  assert.strictEqual(st.assignments[f.plain.localId], f.other);
  assert.ok(f.alive(f.driver) && f.alive(f.plain));
  var third = f.createFolder("Third");
  f.file(f.outside, third);
  var toFav = f.remove(third, { mode: "move", destinationId: "favorites" });
  assert.match(toFav.reply.error, /another folder/, "Favorites is a tag, not a destination");
  assert.ok(f.state().folders.some(function (x) { return x.id === third; }));
});

test("delete mode needs the explicit confirmation, then removes sessions, Workers and the folder", function (t) {
  var f = build(t);
  var unconfirmed = f.remove(f.work, { mode: "delete" });
  assert.match(unconfirmed.reply.error, /Confirm/);
  assert.ok(f.alive(f.driver) && f.alive(f.plain), "nothing deleted without confirmation");
  var r = f.remove(f.work, { mode: "delete", confirmDelete: true });
  assert.ok(!r.reply.error, r.reply.error);
  assert.ok(!f.alive(f.driver) && !f.alive(f.plain), "members deleted");
  assert.ok(!f.alive(f.gen1) && !f.alive(f.gen2), "every Worker generation deleted, hidden included");
  assert.ok(f.alive(f.outside) && f.alive(f.outsideWorker), "unrelated Driver and Worker untouched");
  assert.ok(f.calls.indexOf("watcher:driver") !== -1, "runtime cleanup ran");
  assert.ok(!f.state().folders.some(function (x) { return x.id === f.work; }));
});

test("without delete permission nothing is deleted and the folder stays", function (t) {
  var f = build(t, { multiUser: true, deletePermission: false });
  var pv = f.preview(f.work);
  assert.strictEqual(pv.canDeleteSessions, false);
  assert.match(pv.deleteBlockedReason, /permission/);
  var r = f.remove(f.work, { mode: "delete", confirmDelete: true });
  assert.match(r.reply.error, /permission/);
  assert.ok(f.alive(f.driver) && f.alive(f.gen1) && f.alive(f.plain));
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }));
  var moved = f.remove(f.work, { mode: "unfiled" });
  assert.ok(!moved.reply.error, "moving still works");
});

test("an inaccessible owned Worker blocks the whole deletion before anything is removed", function (t) {
  var f = build(t, { multiUser: true });
  f.denied.add(f.gen2.localId);
  var pv = f.preview(f.work);
  assert.strictEqual(pv.canDeleteSessions, false);
  var r = f.remove(f.work, { mode: "delete", confirmDelete: true });
  assert.match(r.reply.error, /not accessible/);
  assert.ok(f.alive(f.driver) && f.alive(f.gen1) && f.alive(f.gen2) && f.alive(f.plain));
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }), "folder kept");
});

test("a session filed after the preview makes the request stale and changes nothing", function (t) {
  var f = build(t);
  var pv = f.preview(f.work);
  var late = f.make("late", null);
  f.file(late, f.work);
  var rid = "late-1";
  f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "delete", confirmDelete: true, token: pv.token, requestId: rid });
  var reply = f.last("session_folders_state", rid);
  assert.match(reply.error, /changed/);
  assert.strictEqual(reply.stale, true);
  var fresh = f.last("session_folders_delete_preview_result", rid);
  assert.strictEqual(fresh.sessionCount, 3, "a fresh preview follows");
  assert.notStrictEqual(fresh.token, pv.token);
  assert.ok(f.alive(f.driver) && f.alive(f.late || late) && f.alive(f.plain), "nothing deleted");
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }));
  f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "unfiled", requestId: "late-2", token: fresh.token });
  assert.ok(!f.last("session_folders_state", "late-2").error);
});

test("a new Worker generation after the preview also invalidates a delete", function (t) {
  var f = build(t);
  var pv = f.preview(f.work);
  f.worker(f.driver, "gen3");
  f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "delete", confirmDelete: true, token: pv.token, requestId: "w1" });
  assert.strictEqual(f.last("session_folders_state", "w1").stale, true);
  assert.ok(f.alive(f.driver));
});

test("missing or forged tokens, bad modes and wrong projects are refused", function (t) {
  var f = build(t);
  f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "unfiled", requestId: "x1" });
  assert.strictEqual(f.last("session_folders_state", "x1").stale, true, "no token");
  f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "unfiled", requestId: "x2", token: "forged" });
  assert.strictEqual(f.last("session_folders_state", "x2").stale, true);
  var pv = f.preview(f.work);
  f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "shred", requestId: "x3", token: pv.token });
  assert.match(f.last("session_folders_state", "x3").error, /Choose what happens/);
  f.send(null, { type: "session_folders_delete", slug: "other-project", folderId: f.work, mode: "unfiled", requestId: "x4", token: pv.token });
  assert.match(f.last("session_folders_state", "x4").error, /different project/);
  f.send(null, { type: "session_folders_delete", folderId: "favorites", mode: "unfiled", requestId: "x5", token: pv.token });
  assert.match(f.last("session_folders_state", "x5").error, /not found/);
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }));
  assert.ok(f.alive(f.driver) && f.alive(f.plain));
});

test("another user cannot preview or delete this user's folder or sessions", function (t) {
  var f = build(t, { multiUser: true });
  var pv = f.preview(f.work, f.ws);
  assert.strictEqual(f.preview(f.work, f.wsB).error, "Folder not found", "folders are personal");
  f.send(f.wsB, { type: "session_folders_delete", folderId: f.work, mode: "delete", confirmDelete: true, token: pv.token, requestId: "o1" });
  assert.strictEqual(f.last("session_folders_state", "o1").error, "Folder not found");
  assert.ok(f.alive(f.driver) && f.alive(f.plain));
});

test("an unavoidable partial deletion failure keeps the folder and says sessions may be gone", function (t) {
  var f = build(t);
  var original = f.sm.deleteSessionsBulk;
  f.sm.deleteSessionsBulk = function (ids, ws) {
    original.call(f.sm, [ids[0]], ws);
    throw new Error("disk failure");
  };
  var quiet = console.error;
  console.error = function () {};
  var r;
  try { r = f.remove(f.work, { mode: "delete", confirmDelete: true }); } finally { console.error = quiet; f.sm.deleteSessionsBulk = original; }
  assert.match(r.reply.error, /part way/);
  assert.match(r.reply.error, /may already have been deleted/);
  assert.strictEqual(r.reply.folderDeleted, undefined, "no success acknowledgement");
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }), "folder kept");
  assert.strictEqual(Object.keys(r.reply.state.assignments).length, 1, "the reply reflects what is left in the folder");
});

test("a throwing save on a move changes nothing and is not acknowledged", function (t) {
  var f = build(t);
  var pv = f.preview(f.work);
  f.throwOnSave = true;
  var quiet = console.error;
  console.error = function () {};
  try { f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "move", destinationId: f.other, token: pv.token, requestId: "t1" }); }
  finally { console.error = quiet; f.throwOnSave = false; }
  var reply = f.last("session_folders_state", "t1");
  assert.match(reply.error, /nothing was changed/);
  assert.strictEqual(reply.folderDeleted, undefined);
  assert.ok(f.alive(f.driver) && f.alive(f.plain), "sessions untouched");
  var st = f.state();
  assert.ok(st.folders.some(function (x) { return x.id === f.work; }), "folder still there");
  assert.strictEqual(st.assignments[f.driver.localId], f.work, "assignments unchanged");
});

test("a throwing save after session deletion reports the honest partial outcome", function (t) {
  var f = build(t);
  var pv = f.preview(f.work);
  f.throwOnSave = true;
  var quiet = console.error;
  console.error = function () {};
  try { f.send(null, { type: "session_folders_delete", folderId: f.work, mode: "delete", confirmDelete: true, token: pv.token, requestId: "t2" }); }
  finally { console.error = quiet; f.throwOnSave = false; }
  var reply = f.last("session_folders_state", "t2");
  assert.match(reply.error, /sessions were deleted but the folder could not be removed/);
  assert.strictEqual(reply.folderDeleted, undefined, "no success acknowledgement");
  assert.ok(!f.alive(f.driver) && !f.alive(f.plain) && !f.alive(f.gen1), "the sessions really are gone");
  assert.ok(f.state().folders.some(function (x) { return x.id === f.work; }), "the folder is still listed so it can be deleted again");
  var retry = f.remove(f.work, { mode: "unfiled" });
  assert.ok(!retry.reply.error, "a second attempt removes the now empty folder");
});

test("an empty folder is deleted directly and unaffected sessions stay", function (t) {
  var f = build(t);
  var pv = f.preview(f.other);
  assert.strictEqual(pv.sessionCount, 0);
  var r = f.remove(f.other, { mode: "unfiled" });
  assert.ok(!r.reply.error);
  assert.ok(f.alive(f.driver) && f.alive(f.plain));
});

test("the old delete_folder operation still moves contents to Unfiled", function (t) {
  var f = build(t);
  f.op({ op: "delete_folder", folderId: f.work });
  var st = f.last("session_folders_state").state;
  assert.ok(!st.folders.some(function (x) { return x.id === f.work; }));
  assert.strictEqual(st.assignments[f.driver.localId], undefined);
  assert.ok(f.alive(f.driver) && f.alive(f.plain));
  f.op({ op: "delete_folder", folderId: f.other, mode: "delete" });
  assert.ok(f.last("session_folders_state").error, "the old operation can never delete sessions");
});

test("dual membership: deleting a folder keeps surviving favorites' tags, deleting chats prunes them, and counts ignore the tag", function (t) {
  var f = build(t);
  f.op({ op: "set_favorite", sessionId: f.driver.localId, favorite: true });
  f.op({ op: "set_favorite", sessionId: f.outside.localId, favorite: true });
  var pv = f.preview(f.work);
  assert.strictEqual(pv.sessionCount, 2, "the folder's members are counted once each, whether or not they are favorites");
  assert.strictEqual(pv.totalCount, 4, "a favorited Driver is not counted twice");
  var moved = f.remove(f.work, { mode: "unfiled" });
  assert.ok(!moved.reply.error, moved.reply.error);
  var st = f.state();
  assert.deepStrictEqual(st.favorites.slice().sort(), [f.driver.localId, f.outside.localId].sort(), "tags survive a folder deletion that keeps the chats");
  var again = f.createFolder("Again");
  f.file(f.driver, again);
  var gone = f.remove(again, { mode: "delete", confirmDelete: true });
  assert.ok(!gone.reply.error, gone.reply.error);
  assert.ok(!f.alive(f.driver));
  assert.deepStrictEqual(f.state().favorites, [f.outside.localId], "deleting the chat prunes its tag; other tags stay");
});
