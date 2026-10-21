"use strict";
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var schema = require("../lib/split-view-layout");
var splitViews = require("../lib/project-split-views");
var viewNames = require("../lib/project-split-view-names");

function fixture(t, overrides) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-presentation-split-"));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var sessions = new Map(), users = new Map(), sent = [], deleteListener = null;
  ["alice", "bob"].forEach(function (id) { users.set(id, { id: id, linuxUser: id + "-linux" }); });
  for (var i = 1; i <= 11; i++) {
    var owner = i === 11 ? "bob" : "alice";
    sessions.set(i, { localId: i, sessionOriginId: "origin-" + i, title: "Session " + i, ownerId: owner,
      linuxUser: owner + "-linux", visibleTo: [owner], isProcessing: false });
  }
  var ws = { readyState: 1, _clayUser: users.get("alice"), projectAllowed: true };
  var context = {
    slug: "alpha", isMate: false, osUsers: true,
    sm: { sessionsDir: directory, sessions: sessions, sessionLoadUncertain: function () { return false; },
      addOnSessionDeleted: function (listener) { deleteListener = listener; } },
    clients: new Set([ws]), usersModule: {
      isMultiUser: function () { return true; },
      findUserById: function (id) { return users.get(id) || null; },
    },
    canAccessProject: function (socket) { return !!socket.projectAllowed; },
    canAccessSession: function (socket, session) { return session.visibleTo.indexOf(socket._clayUser.id) !== -1; },
    getLinuxUserForSession: function (session) { return session.linuxUser; },
    getOsUserInfoForWs: function (socket) { return socket._clayUser && socket._clayUser.linuxUser ? { username: socket._clayUser.linuxUser } : null; },
    sendTo: function (socket, message) { socket.sent = socket.sent || []; socket.sent.push(message); sent.push({ socket: socket, message: message }); },
  };
  Object.assign(context, overrides || {});
  var handler = splitViews.attachProjectSplitViews(context);
  return { directory: directory, sessions: sessions, users: users, ws: ws, sent: sent, context: context, handler: handler,
    deleteSession: function (id) { var session = sessions.get(id); sessions.delete(id); if (deleteListener) deleteListener(id, session); } };
}

function tree(origins) { return { axis: "horizontal", ratio: 0.5, left: { id: origins[0] }, right: { id: origins[1] } }; }
function createMessage(origins, expectedRevision, overrides) {
  return Object.assign({ type: "project_split_view_create", requestId: "create", expectedRevision: expectedRevision,
    name: "  Split view  ", layout: "balanced", activeSessionOriginId: origins[0], sessionOrigins: origins, tree: tree(origins) }, overrides || {});
}
function lastMessage(ws, type) { return (ws.sent || []).filter(function (message) { return message.type === type; }).slice(-1)[0]; }
function request(f, message) { assert.equal(f.handler.handleMessage(f.ws, message), true); return lastMessage(f.ws, "project_split_view_result"); }

test("pure layout helpers validate presets, exact leaves, caps and bounded ratios", function () {
  for (var size = 0; size <= 8; size++) {
    var ids = Array.from({ length: size }, function (_value, index) { return "origin-" + (index + 1); });
    schema.PRESETS.forEach(function (preset) {
      var result = schema.createPreset(ids, preset);
      if (size < 2) assert.equal(result === null || result.id === ids[0], true);
      else assert.deepEqual(schema.validateTree(result, ids).ok, true);
    });
  }
  assert.throws(function () { schema.createPreset(["x", "x"], "balanced"); }, /unique/);
  assert.throws(function () { schema.createPreset(["1", "2", "3", "4", "5", "6", "7", "8", "9"], "balanced"); }, /eight/);
  assert.equal(schema.validateTree({ axis: "diagonal", ratio: 0.5, left: { id: "a" }, right: { id: "b" } }).ok, false);
  assert.equal(schema.validateTree({ axis: "horizontal", ratio: NaN, left: { id: "a" }, right: { id: "b" } }).ok, false);
  assert.equal(schema.validateTree({ axis: "horizontal", ratio: 0.99, left: { id: "a" }, right: { id: "b" } }).ok, false);
  assert.equal(schema.validateTree({ axis: "horizontal", ratio: 0.5, left: { id: "a" }, right: { id: "a" } }).ok, false);
  assert.equal(schema.validateTree({ axis: "horizontal", ratio: 0.5, left: { id: "a" }, right: { id: "b" } }, ["a", "c"]).ok, false);
  assert.deepEqual(schema.createPreset(["a", "b", "c"], "balanced"), { axis: "horizontal", ratio: 0.55,
    left: { id: "a" }, right: { axis: "vertical", ratio: 0.5, left: { id: "b" }, right: { id: "c" } } });
  assert.deepEqual(schema.createPreset(["a", "b", "c"], "grid"), { axis: "vertical", ratio: 2 / 3,
    left: { axis: "horizontal", ratio: 0.5, left: { id: "a" }, right: { id: "b" } }, right: { id: "c" } });
  assert.deepEqual(schema.createPreset(["a", "b", "c", "d"], "grid"), { axis: "vertical", ratio: 0.5,
    left: { axis: "horizontal", ratio: 0.5, left: { id: "a" }, right: { id: "b" } },
    right: { axis: "horizontal", ratio: 0.5, left: { id: "c" }, right: { id: "d" } } });
});

test("server accepts eight exact live Drivers, derives automatic names and preserves explicit names", function (t) {
  var f = fixture(t), ids = Array.from({ length: 8 }, function (_value, index) { return "origin-" + (index + 1); });
  var created = request(f, createMessage(ids, 0, { tree: schema.createPreset(ids, "grid"), name: "untrusted client label" }));
  assert.equal(created.ok, true); assert.equal(created.view.sessions.length, 8);
  var fullAutomaticName = ids.map(function (_origin, index) { return "Session " + (index + 1); }).join(" + ");
  assert.equal(created.view.fullName, fullAutomaticName); assert.equal(created.view.name.length <= 80, true);
  assert.equal(created.view.nameMode, "automatic");
  f.sessions.get(1).title = "Updated live title";
  f.handler.sendConnectionState(f.ws);
  var refreshed = lastMessage(f.ws, "project_split_views").views[0];
  assert.equal(refreshed.fullName, "Updated live title + " + ids.slice(1).map(function (_origin, index) { return "Session " + (index + 2); }).join(" + "));
  var renamed = request(f, { type: "project_split_view_rename", id: created.view.id, name: "Custom group", expectedRevision: 1 });
  assert.equal(renamed.ok, true); assert.equal(renamed.view.nameMode, "custom");
  var updateIds = ids.slice(0, 7);
  var updated = request(f, { type: "project_split_view_update", id: created.view.id, expectedRevision: 2, sessionOrigins: updateIds,
    tree: schema.createPreset(updateIds, "grid"), layout: "grid", activeSessionOriginId: updateIds[0] });
  assert.equal(updated.ok, true); assert.equal(updated.view.name, "Custom group"); assert.equal(updated.view.nameMode, "custom");
  var reopened = splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: "alpha" });
  assert.equal(reopened.state("alice", "alice-linux").views[0].name, "Custom group");
  assert.equal(reopened.state("alice", "alice-linux").views[0].nameMode, "custom");
});

test("production update preserves surviving member order and appends new members after geometry changes", function (t) {
  var f = fixture(t);
  f.sessions.get(1).title = "A"; f.sessions.get(2).title = "B"; f.sessions.get(3).title = "C";
  var created = request(f, createMessage(["origin-1", "origin-2"], 0));
  var added = ["origin-1", "origin-3", "origin-2"];
  var update = request(f, { type: "project_split_view_update", id: created.view.id, expectedRevision: 1,
    sessionOrigins: added, tree: schema.createPreset(added, "balanced"), layout: "balanced", activeSessionOriginId: "origin-3" });
  assert.equal(update.ok, true);
  assert.deepEqual(update.view.sessions.map(function (session) { return session.sessionOriginId; }), ["origin-1", "origin-2", "origin-3"]);
  assert.equal(update.view.name, "A + B + C");
  var geometryOrder = ["origin-3", "origin-1", "origin-2"];
  var rearranged = request(f, { type: "project_split_view_update", id: created.view.id, expectedRevision: 2,
    sessionOrigins: geometryOrder, tree: schema.createPreset(geometryOrder, "grid"), layout: "grid", activeSessionOriginId: "origin-1" });
  assert.equal(rearranged.ok, true); assert.equal(rearranged.view.name, "A + B + C");
  assert.deepEqual(rearranged.view.sessions.map(function (session) { return session.sessionOriginId; }), ["origin-1", "origin-2", "origin-3"]);
  var renamed = request(f, { type: "project_split_view_rename", id: created.view.id, expectedRevision: 3, name: "Custom" });
  assert.equal(renamed.ok, true);
  f.sessions.get(1).title = "Renamed A";
  var customUpdate = request(f, { type: "project_split_view_update", id: created.view.id, expectedRevision: 4,
    sessionOrigins: ["origin-3", "origin-2", "origin-1"], tree: schema.createPreset(["origin-3", "origin-2", "origin-1"], "rows"),
    layout: "rows", activeSessionOriginId: "origin-3" });
  assert.equal(customUpdate.ok, true); assert.equal(customUpdate.view.name, "Custom");
  var reopened = splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: "alpha" });
  assert.deepEqual(reopened.state("alice", "alice-linux").views[0].sessionRefs.map(function (ref) { return ref.originId; }), ["origin-1", "origin-2", "origin-3"]);
  var emojiBoundary = viewNames.truncate("a".repeat(78) + "🧪zz");
  assert.equal(Array.from(emojiBoundary).length, 80); assert.equal(emojiBoundary.slice(-3, -1), "🧪");
  assert.equal(viewNames.append({ sessionRefs: [null] }, [], [], "origin-new"), null);
  assert.equal(viewNames.append({ sessionRefs: [{ originId: "origin-old" }] }, [], [], "origin-new"), null);
});

test("production handler persists exact owner/project views and enforces revision conflicts", function (t) {
  var f = fixture(t), origins = ["origin-1", "origin-2"];
  var created = request(f, createMessage(origins, 0));
  assert.equal(created.ok, true); assert.equal(created.view.name, "Session 1 + Session 2"); assert.equal(created.view.nameMode, "automatic"); assert.equal(created.revision, 1);
  assert.deepEqual(created.view.sessions.map(function (session) { return session.id; }), [1, 2]);
  assert.equal(fs.existsSync(path.join(f.directory, "presentation-split-views.json")), true);
  var state = lastMessage(f.ws, "project_split_views");
  assert.equal(state.projectSlug, "alpha"); assert.equal(state.revision, 1); assert.equal(state.views.length, 1);
  var view = state.views[0];
  assert.equal(request(f, createMessage(["origin-3", "origin-4"], 0)).code, "conflict");
  assert.equal(request(f, { type: "project_split_view_rename", id: view.id, name: "Focused", expectedRevision: 1 }).ok, true);
  assert.equal(request(f, { type: "project_split_view_rename", id: view.id, name: "Stale", expectedRevision: 1 }).code, "conflict");
  var before = f.sessions.get(1), other = f.sessions.get(2);
  var separated = request(f, { type: "project_split_view_separate", id: view.id, expectedRevision: 2 });
  assert.equal(separated.ok, true); assert.equal(separated.view, null);
  assert.equal(f.sessions.get(1), before); assert.equal(f.sessions.get(2), other);
  assert.equal(before.isProcessing, false); assert.equal(other.isProcessing, false);
  var reopened = splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: "alpha" });
  assert.equal(reopened.state("alice", "alice-linux").revision, 3);
  assert.equal(reopened.state("alice", "alice-linux").views.length, 0);
  assert.equal(reopened.state("bob", "bob-linux").revision, 0);
  var otherProject = splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: "beta" });
  assert.equal(otherProject.state("alice", "alice-linux").revision, 0);
});

test("handler rejects foreign, deleted, replaced and over-cap session targets", function (t) {
  var f = fixture(t), viewOrigins = ["origin-1", "origin-2", "origin-3"];
  var created = request(f, createMessage(viewOrigins, 0, { tree: { axis: "horizontal", ratio: 0.6,
    left: { id: "origin-1" }, right: { axis: "vertical", ratio: 0.5, left: { id: "origin-2" }, right: { id: "origin-3" } } } }));
  var view = created.view;
  var bob = { readyState: 1, _clayUser: f.users.get("bob"), projectAllowed: true };
  f.context.clients.add(bob);
  assert.equal(f.handler.sendConnectionState(bob), true);
  assert.equal(lastMessage(bob, "project_split_views").views.length, 0);
  assert.equal(request(f, createMessage(["origin-1", "origin-11"], 1)).code, "session");
  var nine = Array.from({ length: 9 }, function (_value, index) { return "origin-" + (index + 1); });
  assert.equal(request(f, createMessage(nine, 1)).code, "limit");
  assert.equal(request(f, createMessage(["origin-3", "origin-4"], 1, { tree: { axis: "horizontal", ratio: 1.2, left: { id: "origin-3" }, right: { id: "origin-4" } } })).ok, false);
  f.sessions.set(1, { localId: 1, sessionOriginId: "origin-1", title: "Replacement", ownerId: "alice", linuxUser: "other-linux", visibleTo: ["alice"] });
  var replaced = request(f, { type: "project_split_view_separate", id: view.id, expectedRevision: 1 });
  assert.equal(replaced.code, "session");
  f.sessions.set(1, { localId: 1, sessionOriginId: "origin-1", title: "Session 1", ownerId: "alice", linuxUser: "alice-linux", visibleTo: ["alice"] });
  f.deleteSession(1);
  var afterDelete = lastMessage(f.ws, "project_split_views");
  assert.equal(afterDelete.revision, 2);
  assert.equal(afterDelete.views.length, 1);
  assert.deepEqual(afterDelete.views[0].tree, { axis: "vertical", ratio: 0.5, left: { id: "origin-2" }, right: { id: "origin-3" } });
  assert.deepEqual(afterDelete.views[0].sessions.map(function (session) { return session.id; }), [2, 3]);
  var stale = request(f, { type: "project_split_view_rename", id: view.id, name: "No stale target", expectedRevision: 1 });
  assert.equal(stale.code, "conflict");
  f.ws.projectAllowed = false;
  assert.equal(request(f, createMessage(["origin-3", "origin-4"], 1)).code, "forbidden");
});

test("session membership is exclusive and OS identity is revalidated", function (t) {
  var f = fixture(t), first = request(f, createMessage(["origin-1", "origin-2"], 0));
  assert.equal(first.ok, true);
  assert.equal(request(f, createMessage(["origin-2", "origin-3"], 1)).error, "A session can belong to only one Split view");
  f.sessions.get(1).linuxUser = "changed-linux";
  var rename = request(f, { type: "project_split_view_rename", id: first.view.id, name: "Identity changed", expectedRevision: 1 });
  assert.equal(rename.code, "session");
  var identityStore = splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: "alpha" });
  assert.equal(identityStore.state("alice", "new-linux").code, "identity");
});

test("deleting one member removes a two-session presentation without touching sessions", function (t) {
  var f = fixture(t), first = f.sessions.get(1), second = f.sessions.get(2);
  var created = request(f, createMessage(["origin-1", "origin-2"], 0));
  assert.equal(created.ok, true);
  f.deleteSession(1);
  var state = lastMessage(f.ws, "project_split_views");
  assert.equal(state.views.length, 0);
  assert.equal(state.revision, 2);
  assert.equal(f.sessions.get(2), second);
  assert.equal(f.sessions.has(1), false);
  assert.equal(first.isProcessing, false);
  assert.equal(second.isProcessing, false);
});

test("atomic move transfers one pane between groups and preserves source geometry in one revision", function (t) {
  var f = fixture(t);
  var sourceTree = schema.createPreset(["origin-1", "origin-2", "origin-3"], "balanced");
  var source = request(f, createMessage(["origin-1", "origin-2", "origin-3"], 0, { tree: sourceTree })).view;
  var targetTree = tree(["origin-4", "origin-5"]);
  var target = request(f, createMessage(["origin-4", "origin-5"], 1, { tree: targetTree, name: "Target" })).view;
  var before = [f.sessions.get(1), f.sessions.get(2), f.sessions.get(4), f.sessions.get(5)];
  var moved = request(f, { type: "project_split_view_move", requestId: "move-1", expectedRevision: 2,
    sourceViewId: source.id, sourceSessionOriginId: "origin-2", targetViewId: target.id,
    targetSessionOrigins: ["origin-4", "origin-2", "origin-5"], layout: "grid", activeSessionOriginId: "origin-2",
    tree: { axis: "horizontal", ratio: 0.5, left: { id: "origin-4" },
      right: { axis: "vertical", ratio: 0.5, left: { id: "origin-5" }, right: { id: "origin-2" } } } });
  assert.equal(moved.ok, true); assert.equal(moved.action, "move"); assert.equal(moved.requestId, "move-1");
  assert.equal(moved.revision, 3);
  var views = lastMessage(f.ws, "project_split_views").views;
  var updatedSource = views.find(function (view) { return view.id === source.id; });
  var updatedTarget = views.find(function (view) { return view.id === target.id; });
  assert.deepEqual(updatedSource.tree, { axis: "horizontal", ratio: 0.55, left: { id: "origin-1" }, right: { id: "origin-3" } });
  assert.deepEqual(updatedSource.sessions.map(function (session) { return session.sessionOriginId; }), ["origin-1", "origin-3"]);
  assert.deepEqual(updatedTarget.sessions.map(function (session) { return session.sessionOriginId; }), ["origin-4", "origin-5", "origin-2"]);
  assert.equal(updatedSource.name, "Session 1 + Session 3");
  assert.equal(updatedTarget.name, "Session 4 + Session 5 + Session 2");
  assert.equal(f.sessions.get(2), before[1]); assert.equal(f.sessions.get(2).isProcessing, false);
  assert.equal(f.handler.store.state("alice", "alice-linux").revision, 3);
});

test("production move refuses incomplete, extra, duplicate, and invalid target sets without throwing or persisting", function (t) {
  var f = fixture(t), source = request(f, createMessage(["origin-1", "origin-2"], 0)).view;
  var target = request(f, createMessage(["origin-3", "origin-4"], 1)).view;
  var revision = f.handler.store.state("alice", "alice-linux").revision;
  var persisted = fs.readFileSync(path.join(f.directory, "presentation-split-views.json"), "utf8");
  function transfer(targetOrigins, targetTree, standalone) {
    return { type: "project_split_view_move", expectedRevision: revision, sourceViewId: source.id, sourceSessionOriginId: "origin-2",
      targetViewId: standalone ? undefined : target.id, targetSessionOriginId: standalone ? "origin-3" : undefined,
      targetSessionOrigins: targetOrigins, layout: "grid", activeSessionOriginId: "origin-3", tree: targetTree };
  }
  var invalid = [
    transfer(["origin-3", "origin-2"], schema.createPreset(["origin-3", "origin-2"], "grid")),
    transfer(["origin-3", "origin-4", "origin-2", "origin-5"], schema.createPreset(["origin-3", "origin-4", "origin-2", "origin-5"], "grid")),
    transfer(["origin-3", "origin-4"], schema.createPreset(["origin-3", "origin-4"], "grid")),
    transfer(["origin-3", "origin-2", "origin-5"], schema.createPreset(["origin-3", "origin-2", "origin-5"], "grid"), true),
    transfer(["origin-3", "origin-4", "origin-2", "origin-2"], { axis: "horizontal", ratio: 0.5, left: { id: "origin-3" }, right: { id: "origin-2" } }),
    transfer(["origin-3", "origin-4", "origin-2"], { axis: "horizontal", ratio: 0.5, left: { id: "origin-3" }, right: { id: "origin-4" } })
  ];
  invalid.forEach(function (message) {
    var response = request(f, message);
    assert.equal(response.ok, false); assert.equal(response.code, "invalid");
    assert.equal(f.handler.store.state("alice", "alice-linux").revision, revision);
    assert.equal(fs.readFileSync(path.join(f.directory, "presentation-split-views.json"), "utf8"), persisted);
  });
});

test("atomic move collapses a two-session source into a new target for a standalone session", function (t) {
  var f = fixture(t), source = request(f, createMessage(["origin-1", "origin-2"], 0)).view, session = f.sessions.get(1);
  var moved = request(f, { type: "project_split_view_move", expectedRevision: 1, sourceViewId: source.id,
    sourceSessionOriginId: "origin-1", targetSessionOriginId: "origin-3", targetSessionOrigins: ["origin-1", "origin-3"],
    name: "New view", layout: "balanced", activeSessionOriginId: "origin-1", tree: tree(["origin-1", "origin-3"]) });
  assert.equal(moved.ok, true); assert.equal(moved.revision, 2); assert.equal(moved.view.name, "Session 3 + Session 1");
  assert.deepEqual(lastMessage(f.ws, "project_split_views").views.map(function (view) { return view.id; }), [moved.view.id]);
  assert.equal(f.sessions.get(1), session); assert.equal(f.sessions.get(1).isProcessing, false);
});

test("atomic transfer rejects stale, foreign, replaced, and over-cap targets without mutation", function (t) {
  var f = fixture(t), source = request(f, createMessage(["origin-1", "origin-2"], 0)).view;
  var targetIds = ["origin-3", "origin-4", "origin-5", "origin-6", "origin-7", "origin-8", "origin-9", "origin-10"];
  var target = request(f, createMessage(targetIds, 1, { tree: schema.createPreset(targetIds, "grid"), name: "Full" })).view;
  var transfer = { type: "project_split_view_move", expectedRevision: 2, sourceViewId: source.id, sourceSessionOriginId: "origin-1",
    targetViewId: target.id, targetSessionOrigins: targetIds.concat(["origin-1"]), layout: "grid", activeSessionOriginId: "origin-1",
    tree: schema.createPreset(targetIds, "grid") };
  assert.equal(request(f, transfer).code, "limit");
  assert.equal(f.handler.store.state("alice", "alice-linux").revision, 2);
  assert.equal(request(f, Object.assign({}, transfer, { expectedRevision: 1 })).code, "conflict");
  var bob = { readyState: 1, _clayUser: f.users.get("bob"), projectAllowed: true };
  f.context.clients.add(bob);
  var bobService = f.handler.forConnection(bob);
  assert.equal(bobService.move(Object.assign({}, transfer, { sourceViewId: "missing", expectedRevision: 0 })).code, "not_found");
  f.sessions.get(3).visibleTo = [];
  assert.equal(request(f, Object.assign({}, transfer, { targetSessionOrigins: targetIds.concat(["origin-1"]).slice(0, 6),
    tree: schema.createPreset(targetIds.concat(["origin-1"]).slice(0, 6), "grid"), expectedRevision: 2 })).code, "session");
  f.sessions.get(3).visibleTo = ["alice"];
  f.sessions.set(3, { localId: 3, sessionOriginId: "origin-3", title: "Target replacement", ownerId: "alice", linuxUser: "other-linux", visibleTo: ["alice"] });
  assert.equal(request(f, Object.assign({}, transfer, { targetSessionOrigins: targetIds, tree: schema.createPreset(targetIds, "grid") })).code, "session");
  f.sessions.set(3, { localId: 3, sessionOriginId: "origin-3", title: "Session 3", ownerId: "alice", linuxUser: "alice-linux", visibleTo: ["alice"] });
  f.sessions.set(1, { localId: 1, sessionOriginId: "origin-1", title: "Replacement", ownerId: "alice", linuxUser: "other-linux", visibleTo: ["alice"] });
  assert.equal(request(f, Object.assign({}, transfer, { targetSessionOrigins: targetIds, tree: schema.createPreset(targetIds, "grid") })).code, "session");
  assert.equal(f.handler.store.state("alice", "alice-linux").revision, 2);
});

test("atomic move persistence failure preserves all memberships and owner revision", function (t) {
  var fail = false;
  var f = fixture(t, { persist: function (file, contents) {
    if (fail) throw new Error("injected atomic move storage failure");
    fs.writeFileSync(file, contents);
  } });
  var source = request(f, createMessage(["origin-1", "origin-2"], 0)).view;
  var target = request(f, createMessage(["origin-3", "origin-4"], 1, { name: "Target" })).view;
  fail = true;
  var result = request(f, { type: "project_split_view_move", expectedRevision: 2, sourceViewId: source.id,
    sourceSessionOriginId: "origin-1", targetViewId: target.id, targetSessionOrigins: ["origin-3", "origin-4", "origin-1"],
    layout: "balanced", activeSessionOriginId: "origin-1", tree: schema.createPreset(["origin-3", "origin-4", "origin-1"], "balanced") });
  assert.equal(result.code, "storage");
  assert.equal(f.handler.store.state("alice", "alice-linux").revision, 2);
  var views = f.handler.store.state("alice", "alice-linux").views;
  assert.deepEqual(views.map(function (view) { return view.sessionRefs.map(function (ref) { return ref.originId; }); }), [["origin-1", "origin-2"], ["origin-3", "origin-4"]]);
});

test("session deletion persistence failure reports unchanged revision and unavailable layout", function (t) {
  var fail = false;
  var f = fixture(t, { persist: function (file, contents) {
    if (fail) throw new Error("injected cleanup failure");
    fs.writeFileSync(file, contents);
  } });
  request(f, createMessage(["origin-1", "origin-2", "origin-3"], 0, { tree: schema.createPreset(["origin-1", "origin-2", "origin-3"], "balanced") }));
  fail = true;
  f.deleteSession(1);
  var state = lastMessage(f.ws, "project_split_views");
  assert.equal(state.revision, 1);
  assert.equal(state.views.length, 0);
  assert.match(state.error, /cleanup could not be persisted/);
  assert.equal(f.handler.store.state("alice", "alice-linux").revision, 1);
  assert.equal(f.handler.store.state("alice", "alice-linux").views[0].sessionRefs.length, 3);
});

test("actor-bound service rechecks its connection authority before operations", function (t) {
  var f = fixture(t), service = f.handler.forConnection(f.ws);
  assert.equal(typeof service.create, "function"); assert.equal(service.state().revision, 0);
  f.ws.projectAllowed = false;
  assert.equal(service.create(createMessage(["origin-1", "origin-2"], 0)).code, "forbidden");
});

test("corrupted persisted Split view data fails closed", function (t) {
  var directory = fs.mkdtempSync(path.join(os.tmpdir(), "clay-corrupt-split-"));
  t.after(function () { fs.rmSync(directory, { recursive: true, force: true }); });
  var corrupt = { version: 1, projects: { alpha: { owners: { "user:alice": {
    ownerId: "alice", linuxUser: "alice-linux", revision: 1, views: [{ id: "bad" }]
  } } } } };
  fs.writeFileSync(path.join(directory, "presentation-split-views.json"), JSON.stringify(corrupt));
  var store = splitViews.createSplitViewsStore({ sessionsDir: directory, slug: "alpha" });
  assert.equal(store.state("alice", "alice-linux").code, "storage");
  assert.equal(store.create("alice", "alice-linux", createMessage(["origin-1", "origin-2"], 0), [
    { originId: "origin-1", ownerId: "alice", linuxUser: "alice-linux" }, { originId: "origin-2", ownerId: "alice", linuxUser: "alice-linux" }
  ]).code, "storage");
});

test("persistence failure leaves the owner revision and stored state unchanged", function (t) {
  var f = fixture(t, { persist: function () { throw new Error("injected Split view storage failure"); } });
  var result = request(f, createMessage(["origin-1", "origin-2"], 0));
  assert.equal(result.ok, false); assert.equal(result.code, "storage");
  assert.match(result.error, /injected Split view storage failure/);
  assert.equal(f.handler.store.state("alice", "alice-linux").revision, 0);
  assert.equal(f.handler.store.state("alice", "alice-linux").views.length, 0);
  assert.equal(f.sent.some(function (item) { return item.message.type === "project_split_views" && item.message.revision > 0; }), false);
});

test("connection and message wiring use a separate presentation store", function () {
  var project = fs.readFileSync(path.join(__dirname, "../lib/project.js"), "utf8");
  var connection = fs.readFileSync(path.join(__dirname, "../lib/project-connection.js"), "utf8");
  var wsSchema = fs.readFileSync(path.join(__dirname, "../lib/ws-schema.js"), "utf8");
  assert.match(project, /attachProjectSplitViews\(/);
  assert.match(project, /_splitViews\.handleMessage\(ws, msg\)/);
  assert.match(connection, /_splitViews\.sendConnectionState\(ws\)/);
  assert.match(project, /_splitGroups\.handleMessage\(ws, msg\)/);
  assert.match(wsSchema, /"project_split_view_move"/);
  assert.match(wsSchema, /"project_split_view_result"/);
});

test('asymmetric nested layout survives update, disk reopen and projection verbatim', function (t) {
  var f = fixture(t), ids = ['origin-4', 'origin-2', 'origin-1', 'origin-3'];
  var custom = { axis: 'horizontal', ratio: 0.371, left: { id: ids[0] }, right: { axis: 'vertical', ratio: 0.623,
    left: { axis: 'horizontal', ratio: 0.284, left: { id: ids[1] }, right: { id: ids[2] } }, right: { id: ids[3] } } };
  var created = request(f, createMessage(ids, 0, { tree: custom, layout: 'main-right', activeSessionOriginId: ids[2] }));
  assert.equal(created.ok, true);
  custom.right.left.ratio = 0.417;
  var updated = request(f, { type: 'project_split_view_update', id: created.view.id, expectedRevision: 1,
    sessionOrigins: ids, tree: custom, layout: 'main-right', activeSessionOriginId: ids[1] });
  assert.equal(updated.ok, true);
  var before = fs.readFileSync(path.join(f.directory, 'presentation-split-views.json'), 'utf8');
  f.handler = splitViews.attachProjectSplitViews(f.context);
  f.handler.sendConnectionState(f.ws);
  var restored = lastMessage(f.ws, 'project_split_views').views[0];
  assert.deepEqual(restored.tree, custom);
  assert.deepEqual(restored.sessions.map(function (item) { return item.sessionOriginId; }), ids);
  assert.equal(restored.layout, 'main-right'); assert.equal(restored.activeSessionOriginId, ids[1]);
  assert.equal(fs.readFileSync(path.join(f.directory, 'presentation-split-views.json'), 'utf8'), before);
});

function folderFixture(f) {
  var model = require('../lib/session-folders');
  var accounts = { alice: model.defaultState(), bob: model.defaultState() };
  accounts.alice.legacyFavoritesMigrated = true;
  accounts.alice.folders = [{ id: 'f_first1', name: 'First' }, { id: 'f_second2', name: 'Second' }];
  accounts.alice.assignments = { 'origin-1': 'f_second2' }; accounts.alice.favorites = ['origin-2'];
  accounts.bob.folders = [{ id: 'f_foreign', name: 'Foreign' }];
  f.context.usersModule.getSessionFolders = function (id, slug) { assert.equal(slug, 'alpha'); return JSON.parse(JSON.stringify(accounts[id])); };
  f.context.usersModule.setSessionFolders = function (id, slug, state) { assert.equal(slug, 'alpha'); accounts[id] = JSON.parse(JSON.stringify(state)); return { state: accounts[id] }; };
  f.context.usersModule.canAccessSession = function (id, session) { return session.ownerId === id; };
  return accounts;
}
function organizationMessage(view, revision, overrides) {
  return Object.assign({ type: 'project_split_view_organize', id: view.id, expectedViewRevision: view.revision,
    expectedRevision: revision, projectSlug: 'alpha', folderId: 'f_first1', favorite: true }, overrides || {});
}

test('view organization persists independently through rename, layout, reload, folder deletion and separation', function (t) {
  var f = fixture(t), accounts = folderFixture(f);
  var memberMetadata = JSON.stringify({ assignments: accounts.alice.assignments, favorites: accounts.alice.favorites });
  var created = request(f, createMessage(['origin-1', 'origin-2'], 0));
  assert.equal(created.view.folderId, 'f_second2'); assert.equal(created.view.favorite, false);
  var filed = request(f, organizationMessage(created.view, 1)); assert.equal(filed.ok, true);
  var renamed = request(f, { type: 'project_split_view_rename', id: filed.view.id, expectedRevision: 2, name: 'Filed view' });
  var updated = request(f, { type: 'project_split_view_update', id: filed.view.id, expectedRevision: 3, sessionOrigins: ['origin-1', 'origin-2'],
    tree: { axis: 'vertical', ratio: 0.37, left: { id: 'origin-2' }, right: { id: 'origin-1' } }, layout: 'rows', activeSessionOriginId: 'origin-2' });
  assert.equal(renamed.ok && updated.ok, true); assert.equal(updated.view.folderId, 'f_first1'); assert.equal(updated.view.favorite, true);
  assert.equal(JSON.stringify({ assignments: accounts.alice.assignments, favorites: accounts.alice.favorites }), memberMetadata);
  var second = request(f, organizationMessage(updated.view, 4, { folderId: 'f_second2' })); assert.equal(second.ok, true);
  var reloaded = splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: 'alpha' }).state('alice', 'alice-linux');
  assert.equal(reloaded.views[0].folderId, 'f_second2'); assert.equal(reloaded.views[0].favorite, true);
  var peer = { readyState: 1, _clayUser: f.users.get('alice'), projectAllowed: true }; f.context.clients.add(peer);
  var folderHandler = require('../lib/project-session-folders').attachSessionFolders(Object.assign({}, f.context, { onFoldersChanged: f.handler.onFoldersChanged }));
  folderHandler.handleMessage(f.ws, { type: 'session_folders_op', slug: 'alpha', op: { op: 'delete_folder', folderId: 'f_second2' }, requestId: 'delete' });
  var afterDelete = lastMessage(peer, 'project_split_views');
  assert.equal(afterDelete.views[0].folderId, null); assert.equal(afterDelete.views[0].favorite, true);
  assert.deepEqual(afterDelete.views[0].tree, updated.view.tree); assert.equal(afterDelete.views[0].activeSessionOriginId, 'origin-2');
  assert.equal(splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: 'alpha' }).state('alice', 'alice-linux').views[0].folderId, null);
  // Deleting the folder changes the existing member assignment by the folder service, never by view organization.
  assert.equal(accounts.alice.favorites[0], 'origin-2');
  accounts.alice.folders.push({ id: 'f_second2', name: 'Restored' }); f.handler.onFoldersChanged('alice');
  assert.equal(lastMessage(peer, 'project_split_views').views[0].folderId, null);
  var separate = request(f, { type: 'project_split_view_separate', id: filed.view.id, expectedRevision: afterDelete.revision });
  assert.equal(separate.ok, true); assert.equal(f.sessions.size, 11); assert.equal(accounts.alice.favorites[0], 'origin-2');
  assert.equal(memberMetadata, JSON.stringify({ assignments: { 'origin-1': 'f_second2' }, favorites: ['origin-2'] }));
});

test('organization rejects stale, foreign, invalid and disconnected requests without persistence or member changes', function (t) {
  var f = fixture(t), accounts = folderFixture(f), originalFolders = JSON.stringify(accounts);
  var created = request(f, createMessage(['origin-1', 'origin-2'], 0));
  var msg = organizationMessage(created.view, 1);
  [{ expectedRevision: 0 }, { expectedViewRevision: 0 }, { projectSlug: 'foreign' }, { folderId: 'f_foreign' },
    { folderId: 'f_deleted' }, { favorite: 'true' }, { id: 'foreign-view' }].forEach(function (patch) {
    assert.equal(request(f, Object.assign({}, msg, patch)).ok, false);
    assert.equal(f.handler.store.state('alice', 'alice-linux').revision, 1);
  });
  f.ws.projectAllowed = false; assert.equal(request(f, msg).code, 'forbidden'); f.ws.projectAllowed = true;
  f.ws._clayUser = null; assert.equal(request(f, msg).code, 'forbidden'); f.ws._clayUser = f.users.get('bob');
  assert.equal(request(f, Object.assign({}, msg, { expectedRevision: 0 })).ok, false);
  f.ws._clayUser = f.users.get('alice'); f.context.clients.delete(f.ws); assert.equal(request(f, msg).code, 'forbidden'); f.context.clients.add(f.ws);
  var result = request(f, msg); assert.equal(result.ok, true);
  assert.equal(request(f, msg).code, 'conflict'); assert.equal(JSON.stringify(accounts), originalFolders);
  var unstarred = request(f, organizationMessage(result.view, result.revision, { favorite: false }));
  assert.equal(unstarred.view.folderId, 'f_first1'); assert.equal(unstarred.view.favorite, false);
  assert.equal(JSON.stringify(accounts), originalFolders);
});

test('organization and folder cleanup failures preserve last persisted view and recover honestly', function (t) {
  var fail = false;
  var f = fixture(t, { persist: function (file, contents) { if (fail) throw new Error('organization disk failure'); fs.writeFileSync(file, contents); } });
  var accounts = folderFixture(f), created = request(f, createMessage(['origin-1', 'origin-2'], 0));
  fail = true; assert.equal(request(f, organizationMessage(created.view, 1)).code, 'storage');
  assert.equal(f.handler.store.state('alice', 'alice-linux').views[0].folderId, 'f_second2');
  fail = false; var filed = request(f, organizationMessage(created.view, 1)); assert.equal(filed.ok, true);
  fail = true; accounts.alice.folders = []; f.handler.onFoldersChanged('alice');
  var unavailable = lastMessage(f.ws, 'project_split_views'); assert.match(unavailable.error, /disk failure/); assert.deepEqual(unavailable.views, []);
  assert.equal(f.handler.store.state('alice', 'alice-linux').views[0].folderId, 'f_first1');
  fail = false; f.handler.sendConnectionState(f.ws);
  var recovered = lastMessage(f.ws, 'project_split_views'); assert.equal(recovered.error, null); assert.equal(recovered.views[0].folderId, null); assert.equal(recovered.views[0].favorite, true);
});

test('legacy views without organization fields project unfiled and unstarred without a migration write', function (t) {
  var f = fixture(t); request(f, createMessage(['origin-1', 'origin-2'], 0));
  var file = path.join(f.directory, 'presentation-split-views.json'), doc = JSON.parse(fs.readFileSync(file));
  var view = doc.projects.alpha.owners['user:alice'].views[0]; delete view.folderId; delete view.favorite;
  fs.writeFileSync(file, JSON.stringify(doc)); var bytes = fs.readFileSync(file, 'utf8');
  var handler = splitViews.attachProjectSplitViews(f.context); handler.sendConnectionState(f.ws);
  var projected = lastMessage(f.ws, 'project_split_views').views[0];
  assert.equal(projected.folderId, null); assert.equal(projected.favorite, false); assert.equal(fs.readFileSync(file, 'utf8'), bytes);
});

test('new Split Views inherit the target session folder for matching, different and Unfiled drops', function (t) {
  ['same', 'different', 'unfiled', 'deleted', 'foreign'].forEach(function (scenario) {
    var f = fixture(t), accounts = folderFixture(f);
    accounts.alice.assignments = { 'origin-1': 'f_first1', 'origin-2': scenario === 'same' ? 'f_first1' : scenario === 'different' ? 'f_second2' : scenario === 'deleted' ? 'f_deleted' : scenario === 'foreign' ? 'f_foreign' : null };
    var before = JSON.stringify(accounts), expected = scenario === 'same' ? 'f_first1' : scenario === 'different' ? 'f_second2' : null;
    var created = request(f, createMessage(['origin-1', 'origin-2'], 0, { activeSessionOriginId: 'origin-2', folderId: 'f_foreign' }));
    assert.equal(created.ok, true, scenario); assert.equal(created.view.folderId, expected, scenario);
    assert.equal(JSON.stringify(accounts), before);
    assert.equal(splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: 'alpha' }).state('alice', 'alice-linux').views[0].folderId, expected);
  });
});

test('merging into a singleton uses its current session folder rather than its older saved View folder', function (t) {
  var f = fixture(t), accounts = folderFixture(f);
  var created = request(f, createMessage(['origin-1'], 0, { projectSlug: 'alpha', accountId: 'alice', tree: { id: 'origin-1' } }));
  assert.equal(created.ok, true); assert.equal(created.view.folderId, 'f_second2');
  accounts.alice.assignments['origin-1'] = 'f_first1';
  var origins = ['origin-1', 'origin-2'], nextTree = tree(origins);
  var nextWorkspace = require('../lib/project-view-workspace').legacy({ tree: nextTree, activeSessionOriginId: 'origin-1', sessionRefs: origins.map(function (origin) { return { originId: origin }; }) });
  var updated = request(f, { type: 'project_split_view_update', projectSlug: 'alpha', accountId: 'alice', id: created.view.id,
    expectedRevision: 1, expectedViewRevision: created.view.revision, sessionOrigins: origins, tree: nextTree,
    layout: 'balanced', activeSessionOriginId: 'origin-2', workspace: nextWorkspace });
  assert.equal(updated.ok, true, updated.error); assert.equal(updated.view.folderId, 'f_first1');
});

test('atomic transfers inherit standalone target placement and preserve an existing group folder', function (t) {
  var f = fixture(t), accounts = folderFixture(f);
  accounts.alice.assignments['origin-3'] = 'f_first1';
  var source = request(f, createMessage(['origin-1', 'origin-2'], 0)).view;
  var moved = request(f, { type: 'project_split_view_move', expectedRevision: 1, sourceViewId: source.id,
    sourceSessionOriginId: 'origin-1', targetSessionOriginId: 'origin-3', targetSessionOrigins: ['origin-1', 'origin-3'],
    name: 'View', layout: 'balanced', activeSessionOriginId: 'origin-1', tree: tree(['origin-1', 'origin-3']) });
  assert.equal(moved.ok, true); assert.equal(moved.view.folderId, 'f_first1');
  var secondSource = request(f, createMessage(['origin-4', 'origin-5'], 2)).view;
  var grouped = request(f, { type: 'project_split_view_move', expectedRevision: 3, sourceViewId: secondSource.id,
    sourceSessionOriginId: 'origin-4', targetViewId: moved.view.id, targetSessionOrigins: ['origin-1', 'origin-3', 'origin-4'],
    layout: 'balanced', activeSessionOriginId: 'origin-4', tree: schema.createPreset(['origin-1', 'origin-3', 'origin-4'], 'balanced') });
  assert.equal(grouped.ok, true); assert.equal(grouped.view.folderId, 'f_first1');
  assert.equal(splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: 'alpha' }).state('alice', 'alice-linux').views[0].folderId, 'f_first1');
});

test('workspace singleton transfers derive the target folder at execution and reject stale writes atomically', function (t) {
  var f = fixture(t), accounts = folderFixture(f), workspaces = require('../lib/project-view-workspace');
  function singleton(origin, revision) {
    return request(f, createMessage([origin], revision, { projectSlug: 'alpha', accountId: 'alice', tree: { id: origin } })).view;
  }
  var source = singleton('origin-1', 0), target = singleton('origin-2', 1);
  accounts.alice.assignments['origin-2'] = 'f_first1';
  var origins = ['origin-2', 'origin-1'], nextTree = tree(origins);
  var msg = { type: 'project_split_view_move', projectSlug: 'alpha', accountId: 'alice', expectedRevision: 2,
    expectedViewRevision: source.revision, expectedTargetViewRevision: target.revision, sourceViewId: source.id,
    sourceSessionOriginId: 'origin-1', targetViewId: target.id, targetSessionOrigins: origins, tree: nextTree,
    activeSessionOriginId: 'origin-2', layout: 'balanced',
    targetWorkspace: workspaces.legacy({ tree: nextTree, activeSessionOriginId: 'origin-2', sessionRefs: origins.map(function (origin) { return { originId: origin }; }) }) };
  var persisted = fs.readFileSync(path.join(f.directory, 'presentation-split-views.json'), 'utf8');
  assert.equal(request(f, Object.assign({}, msg, { expectedTargetViewRevision: 0 })).ok, false);
  assert.equal(fs.readFileSync(path.join(f.directory, 'presentation-split-views.json'), 'utf8'), persisted);
  var moved = request(f, msg); assert.equal(moved.ok, true, moved.error); assert.equal(moved.view.folderId, 'f_first1');
  assert.equal(moved.view.id, target.id); assert.equal(moved.view.sessions.length, 2);
  assert.equal(f.handler.store.state('alice', 'alice-linux').views.find(function (view) { return view.id === source.id; }).folderId, 'f_second2');
  assert.equal(splitViews.createSplitViewsStore({ sessionsDir: f.directory, slug: 'alpha' }).state('alice', 'alice-linux').views.find(function (view) { return view.id === target.id; }).folderId, 'f_first1');
});
