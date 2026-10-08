var test = require("node:test");
var assert = require("node:assert");
var folders = require("../lib/session-folders");
var attach = require("../lib/project-session-folders").attachSessionFolders;

function env(keys) {
  var set = {};
  keys.forEach(function (k) { set[k] = true; });
  return { canOrganize: function (k) { return !!set[k]; }, exists: function (k) { return !!set[k]; } };
}

function apply(state, op, keys) {
  return folders.applyOperation(state, op, env(keys || ["a", "b", "c"]));
}

test("normalizeState drops dangling references and bad shapes", function () {
  var state = folders.normalizeState({
    folders: [{ id: "f_aaaaaa", name: " Work  " }, { id: "bad", name: "x" }, { id: "f_bbbbbb", name: "work" }],
    assignments: { a: "f_aaaaaa", b: "f_missing", c: "favorites", d: 7 },
    orders: { favorites: ["c", "c", 5], nope: ["a"] },
    collapsed: { favorites: true, f_missing: true },
    view: { group: "weird", sort: "title", direction: "asc" },
  });
  assert.deepStrictEqual(state.folders, [{ id: "f_aaaaaa", name: "Work" }]);
  assert.deepStrictEqual(state.assignments, { a: "f_aaaaaa" }, "a legacy Favorites assignment becomes a tag, not a folder");
  assert.deepStrictEqual(state.favorites, ["c"], "migrated into the independent favorites list");
  assert.deepStrictEqual(state.orders, {});
  assert.deepStrictEqual(state.collapsed, { favorites: true });
  assert.deepStrictEqual(state.view, { group: "folders", sort: "title", direction: "asc" }, "an invalid group stays canonical");
  [["dates"], ["none"]].forEach(function (g) {
    var legacy = folders.normalizeState({ view: { group: g[0], sort: "created", direction: "asc" }, folders: [{ id: "f_aaaaaa", name: "Keep" }], assignments: { a: "f_aaaaaa" }, orders: { f_aaaaaa: ["a"] }, collapsed: { f_aaaaaa: true } });
    assert.deepStrictEqual(legacy.view, { group: "folders", sort: "created", direction: "asc" }, "legacy " + g[0] + " becomes folders and keeps sort/direction");
    assert.strictEqual(legacy.assignments.a, "f_aaaaaa");
    assert.deepStrictEqual(legacy.orders.f_aaaaaa, ["a"]);
    assert.strictEqual(legacy.collapsed.f_aaaaaa, true);
  });
});

test("folder names are validated, unique and cannot shadow built-ins", function () {
  var s = folders.defaultState();
  assert.ok(apply(s, { op: "create_folder", name: "   " }).error);
  assert.ok(apply(s, { op: "create_folder", name: "Favorites" }).error);
  assert.ok(apply(s, { op: "create_folder", name: "unfiled" }).error);
  assert.ok(apply(s, { op: "create_folder", name: "x".repeat(61) }).error);
  assert.ok(apply(s, { op: "create_folder", name: 5 }).error);
  var r = apply(s, { op: "create_folder", name: "  Plans\u0000 " });
  assert.strictEqual(r.state.folders[0].name, "Plans");
  assert.ok(apply(r.state, { op: "create_folder", name: "PLANS" }).error);
});

test("Favorites cannot be renamed, deleted or reordered through crafted requests", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "One" }).state;
  var id = s.folders[0].id;
  assert.ok(apply(s, { op: "rename_folder", folderId: "favorites", name: "Mine" }).error);
  assert.ok(apply(s, { op: "delete_folder", folderId: "favorites" }).error);
  assert.ok(apply(s, { op: "reorder_folder", folderId: "favorites", targetId: id }).error);
  assert.ok(apply(s, { op: "reorder_folder", folderId: id, targetId: "favorites" }).error);
  assert.ok(apply(s, { op: "delete_folder", folderId: "unfiled" }).error);
  assert.ok(apply(s, { op: "nonsense" }).error);
  assert.ok(apply(s, null).error);
});

test("deleting a custom folder moves its sessions to Unfiled and keeps them", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "One" }).state;
  var id = s.folders[0].id;
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: id, order: ["a"] }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: true }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "b", favorite: true }).state;
  s = apply(s, { op: "delete_folder", folderId: id }).state;
  assert.strictEqual(s.assignments.a, undefined);
  assert.deepStrictEqual(s.favorites, ["a", "b"], "deleting a folder keeps the favorite tags of surviving sessions");
  assert.strictEqual(s.orders[id], undefined);
});

test("custom folder order persists independently of sessions", function () {
  var s = folders.defaultState();
  var ids = ["A", "B", "C"].map(function (n) {
    var r = apply(s, { op: "create_folder", name: n });
    s = r.state;
    return r.folderId;
  });
  s = apply(s, { op: "reorder_folder", folderId: ids[2], targetId: ids[0], insertBefore: true }).state;
  assert.deepStrictEqual(s.folders.map(function (f) { return f.name; }), ["C", "A", "B"]);
  s = apply(s, { op: "reorder_folder", folderId: ids[2], targetId: ids[1], insertBefore: false }).state;
  assert.deepStrictEqual(s.folders.map(function (f) { return f.name; }), ["A", "B", "C"]);
});

test("each session has at most one folder; moving replaces the assignment", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "One" }).state;
  var id = s.folders[0].id;
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: "favorites", order: ["a"] }).state;
  assert.strictEqual(s.assignments.a, undefined, "an old place-in-Favorites request only tags: the placement is untouched");
  assert.deepStrictEqual(s.favorites, ["a"]);
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: id, order: ["a"] }).state;
  assert.strictEqual(s.assignments.a, id);
  assert.deepStrictEqual(s.favorites, ["a"], "moving to a real folder keeps the tag");
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: null }).state;
  assert.strictEqual(s.assignments.a, undefined);
  assert.deepStrictEqual(s.favorites, ["a"], "moving to Unfiled keeps the tag");
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: false }).state;
  assert.deepStrictEqual(s.favorites, [], "only an explicit toggle removes the tag");
});

test("sessions that are not accessible, or references that do not match, are rejected", function () {
  var s = folders.defaultState();
  assert.ok(apply(s, { op: "place_session", sessionKey: "secret", folderId: "favorites" }).error);
  assert.ok(apply(s, { op: "place_session", sessionKey: "a", folderId: "f_unknown" }).error);
  assert.ok(apply(s, { op: "place_session", sessionKey: "a", folderId: "favorites", order: ["a", "secret"] }).error);
  assert.ok(apply(s, { op: "place_session", sessionKey: "a", folderId: "favorites", order: ["b"] }).error);
  assert.ok(apply(s, { op: "place_session", sessionKey: "a", folderId: "favorites", order: ["a", "a"] }).error);
  assert.ok(apply(s, { op: "set_order", containerKey: "favorites", order: ["b"] }).error, "b is not in favorites");
  assert.ok(apply(s, { op: "set_order", containerKey: "f_none", order: [] }).error);
});

test("view settings are validated and collapse state is kept", function () {
  var s = folders.defaultState();
  assert.ok(apply(s, { op: "set_view", group: "tabs" }).error);
  assert.ok(apply(s, { op: "set_view", sort: "random" }).error);
  assert.ok(apply(s, { op: "set_view", direction: "up" }).error);
  s = apply(s, { op: "set_view", group: "dates", sort: "created", direction: "asc" }).state;
  assert.deepStrictEqual(s.view, { group: "folders", sort: "created", direction: "asc" }, "a legacy client group choice is canonicalized, not enabled");
  s = apply(s, { op: "set_view", group: "none" }).state;
  assert.strictEqual(s.view.group, "folders");
  s = apply(s, { op: "set_collapsed", containerKey: "favorites", collapsed: true }).state;
  assert.strictEqual(s.collapsed.favorites, true);
  s = apply(s, { op: "set_collapsed", containerKey: "favorites", collapsed: false }).state;
  assert.strictEqual(s.collapsed.favorites, undefined);
  assert.ok(apply(s, { op: "set_collapsed", containerKey: "f_none", collapsed: true }).error);
});

test("legacy favorites seed once, keep their order and never override explicit choices", function () {
  var s = folders.normalizeState({ folders: [], assignments: { b: "unfiledMarker" } });
  s = folders.seedLegacyFavorites(folders.defaultState(), ["b", "a"]);
  assert.deepStrictEqual(s.favorites, ["b", "a"]);
  assert.strictEqual(s.assignments.a, undefined, "seeded favorites stay in Unfiled");
  assert.strictEqual(s.legacyFavoritesMigrated, true);
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: false }).state;
  var again = folders.seedLegacyFavorites(s, ["a"]);
  assert.deepStrictEqual(again.favorites, ["b"], "the seed does not run twice");
  var explicit = folders.seedLegacyFavorites({ assignments: { c: "f_aaaaaa" }, folders: [{ id: "f_aaaaaa", name: "X" }] }, ["c", "d"]);
  assert.deepStrictEqual(explicit.favorites, ["c", "d"], "legacy bookmarks become tags even when a real folder is assigned");
  assert.strictEqual(explicit.assignments.c, "f_aaaaaa", "seeding the tag never overrides the real folder");
});

// --- handler: per-user scope, persistence and cross-user rejection ---

function harness() {
  var store = {};
  var sent = [];
  var sessions = new Map();
  function add(id, extra) {
    sessions.set(id, Object.assign({ localId: id, sessionOriginId: "origin-" + id, ownerId: "u1", sessionVisibility: "private", lastActivity: id }, extra || {}));
  }
  var usersModule = {
    isMultiUser: function () { return true; },
    canAccessSession: function (uid, s) { return s.ownerId === uid || s.sessionVisibility === "shared"; },
    getSessionFolders: function (uid, slug) { return folders.normalizeState(store[uid + "/" + slug]); },
    setSessionFolders: function (uid, slug, st) { store[uid + "/" + slug] = folders.normalizeState(st); return { ok: true, state: store[uid + "/" + slug] }; },
  };
  var ws1 = { _clayUser: { id: "u1" } };
  var ws1b = { _clayUser: { id: "u1" } };
  var ws2 = { _clayUser: { id: "u2" } };
  var clients = new Set([ws1, ws1b, ws2]);
  var handler = attach({
    sm: { sessions: sessions }, usersModule: usersModule, slug: "proj", clients: clients,
    sendTo: function (ws, m) { sent.push({ ws: ws, msg: m }); },
  });
  return { add: add, handler: handler, store: store, sent: sent, ws1: ws1, ws1b: ws1b, ws2: ws2, sessions: sessions };
}

test("handler persists per user and broadcasts only to that user's sockets", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: "favorites", order: [1] } });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-1"]);
  assert.strictEqual(h.store["u1/proj"].assignments["origin-1"], undefined);
  assert.strictEqual(h.store["u2/proj"], undefined);
  var targets = h.sent.map(function (e) { return e.ws; });
  assert.ok(targets.indexOf(h.ws1) !== -1 && targets.indexOf(h.ws1b) !== -1);
  assert.ok(targets.indexOf(h.ws2) === -1);
  var pushed = h.sent[h.sent.length - 1].msg.state;
  assert.deepStrictEqual(pushed.assignments, {});
  assert.deepStrictEqual(pushed.favorites, [1], "clients see local ids");
  assert.ok(JSON.stringify(h.sent).indexOf("origin-") === -1, "durable origin keys never reach a client");
});

test("clients cannot pass raw origin keys", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionKey: "origin-1", folderId: "favorites" } });
  assert.ok(h.sent[h.sent.length - 1].msg.error);
  assert.strictEqual(h.store["u1/proj"].assignments["origin-1"], undefined);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, sessionKey: "origin-x", folderId: "favorites", order: ["origin-1"] } });
  assert.ok(h.sent[h.sent.length - 1].msg.error);
});

test("handler rejects another user's private session and leaks nothing", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws2, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: "favorites" } });
  assert.strictEqual(h.store["u2/proj"] && h.store["u2/proj"].assignments["origin-1"], undefined);
  var reply = h.sent[h.sent.length - 1];
  assert.strictEqual(reply.ws, h.ws2);
  assert.ok(reply.msg.error);
  assert.deepStrictEqual(reply.msg.state.assignments, {});
  h.handler.handleMessage(h.ws2, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: "favorites" } });
  h.handler.handleMessage(h.ws2, { type: "session_folders_op", slug: "proj", op: { op: "set_order", containerKey: "all", order: [1] } });
  assert.ok(h.sent[h.sent.length - 1].msg.error);
});

test("a stored assignment is never revealed to a user who lost access", function () {
  var h = harness();
  h.add(1);
  h.store["u2/proj"] = folders.normalizeState({ favorites: ["origin-1"], legacyFavoritesMigrated: true });
  h.handler.sendStateTo(h.ws2);
  var state = h.sent[h.sent.length - 1].msg.state;
  assert.deepStrictEqual(state.assignments, {});
  assert.deepStrictEqual(state.favorites, []);
});

test("handler rejects Workers, hidden sessions and unauthenticated sockets", function () {
  var h = harness();
  h.add(1);
  h.add(2, { sessionProvenance: { kind: "worker", parentSessionOriginId: "origin-1", generation: 1 } });
  h.add(3, { hidden: true });
  h.add(4, { loop: { loopId: "L" } });
  [2, 3, 4, 99].forEach(function (id) {
    h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: id, folderId: "favorites" } });
    assert.ok(h.sent[h.sent.length - 1].msg.error, String(id));
  });
  var before = h.sent.length;
  h.handler.handleMessage({}, { type: "session_folders_op", slug: "proj", op: { op: "create_folder", name: "X" } });
  assert.strictEqual(h.sent.length, before);
});

test("legacy session favorites migrate for the owner only, in their old order", function () {
  var h = harness();
  h.add(1, { bookmarked: true, favoriteOrder: 1 });
  h.add(2, { bookmarked: true, favoriteOrder: 0 });
  h.add(3, { bookmarked: true, favoriteOrder: 0, ownerId: "u2" });
  h.store["u1/proj"] = { folders: [{ id: "f_aaaaaa", name: "Work" }], assignments: { "origin-1": "f_aaaaaa" } };
  h.handler.sendStateTo(h.ws1);
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-2", "origin-1"]);
  assert.strictEqual(h.store["u1/proj"].assignments["origin-1"], "f_aaaaaa", "a migrated bookmark keeps its real folder");
  assert.deepStrictEqual(h.sent[h.sent.length - 1].msg.state.favorites, [2, 1]);
  h.handler.sendStateTo(h.ws2);
  assert.deepStrictEqual(h.store["u2/proj"].favorites, ["origin-3"]);
  assert.strictEqual(h.sessions.get(1).bookmarked, true, "legacy flags are left untouched");
});

test("old favorite messages edit the personal state, not the shared session flag", function () {
  var h = harness();
  h.add(1);
  h.add(2);
  h.handler.handleMessage(h.ws1, { type: "set_session_bookmark", sessionId: 1, bookmarked: true });
  h.handler.handleMessage(h.ws1, { type: "set_session_bookmark", sessionId: 2, bookmarked: true });
  h.handler.handleMessage(h.ws1, { type: "reorder_session_bookmarks", sourceId: 2, targetId: 1, insertBefore: true });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-2", "origin-1"]);
  assert.strictEqual(h.sessions.get(1).bookmarked, undefined);
  h.handler.handleMessage(h.ws1, { type: "set_session_bookmark", sessionId: 1, bookmarked: false });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-2"]);
});

// --- order membership ---

test("unfavoriting removes the tag and a different favorite is then accepted", function () {
  var s = apply(folders.defaultState(), { op: "set_favorite", sessionKey: "a", favorite: true, order: ["a"] }).state;
  assert.deepStrictEqual(s.favorites, ["a"]);
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: false }).state;
  assert.deepStrictEqual(s.favorites, []);
  var added = apply(s, { op: "set_favorite", sessionKey: "b", favorite: true, order: ["b"] });
  assert.ok(!added.error);
  assert.deepStrictEqual(added.state.favorites, ["b"]);
});

test("curated favorite order is preserved; only stale or foreign orders are rejected", function () {
  var s = apply(folders.defaultState(), { op: "set_favorite", sessionKey: "a", favorite: true }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "b", favorite: true, order: ["a", "b"] }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "c", favorite: true, order: ["c", "a", "b"] }).state;
  assert.deepStrictEqual(s.favorites, ["c", "a", "b"]);
  s = apply(s, { op: "set_order", containerKey: "favorites", order: ["b"] }).state;
  assert.deepStrictEqual(s.favorites, ["b", "c", "a"], "a partial order moves the listed favorites first");
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: false }).state;
  assert.deepStrictEqual(s.favorites, ["b", "c"], "remaining order untouched");
  assert.ok(apply(s, { op: "set_order", containerKey: "favorites", order: ["a"] }).error, "a is no longer a favorite");
  assert.ok(apply(s, { op: "set_favorite", sessionKey: "a", favorite: true, order: ["b"] }).error, "the order must include the tagged session");
  assert.deepStrictEqual(apply(s, { op: "place_session", sessionKey: "a", folderId: null }).state.favorites, ["b", "c"], "moving a non-favorite never tags it");
});

test("custom-folder transitions keep every order consistent with the assignments", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "One" }).state;
  var one = s.folders[0].id;
  s = apply(s, { op: "create_folder", name: "Two" }).state;
  var two = s.folders[1].id;
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: one, order: ["a"] }).state;
  s = apply(s, { op: "place_session", sessionKey: "b", folderId: one, order: ["a", "b"] }).state;
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: two, order: ["a"] }).state;
  assert.deepStrictEqual(s.orders[one], ["b"]);
  assert.deepStrictEqual(s.orders[two], ["a"]);
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: null }).state;
  assert.strictEqual(s.orders[two], undefined);
  s = apply(s, { op: "delete_folder", folderId: one }).state;
  assert.strictEqual(s.orders[one], undefined);
  assert.strictEqual(s.assignments.b, undefined);
});

test("deleted sessions are pruned from assignments, favorites and orders on the next change", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "One" }).state;
  var one = s.folders[0].id;
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: one, order: ["a"] }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: true }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "b", favorite: true, order: ["a", "b"] }).state;
  var gone = folders.applyOperation(s, { op: "set_collapsed", containerKey: "favorites", collapsed: true }, env(["b"])).state;
  assert.strictEqual(gone.assignments.a, undefined);
  assert.deepStrictEqual(gone.favorites, ["b"], "deleting a chat prunes its tag");
});

test("a favorite keeps its folder through every folder change", function () {
  var s = apply(folders.defaultState(), { op: "create_folder", name: "One" }).state;
  var one = s.folders[0].id;
  s = apply(s, { op: "create_folder", name: "Two" }).state;
  var two = s.folders[1].id;
  s = apply(s, { op: "place_session", sessionKey: "a", folderId: one }).state;
  s = apply(s, { op: "set_favorite", sessionKey: "a", favorite: true }).state;
  assert.strictEqual(s.assignments.a, one, "starring does not move it");
  s = apply(s, { op: "delete_folder", folderId: one, mode: "move", destinationId: two }).state;
  assert.strictEqual(s.assignments.a, two);
  assert.deepStrictEqual(s.favorites, ["a"]);
  assert.ok(apply(s, { op: "delete_folder", folderId: two, mode: "move", destinationId: "favorites" }).error, "Favorites is not a destination");
});

test("normalizeState reconciles orders stored before this rule", function () {
  var s = folders.normalizeState({ assignments: { a: "favorites" }, orders: { favorites: ["x", "a"], unfiled: ["a", "z"] } });
  assert.deepStrictEqual(s.orders, { unfiled: ["a", "z"] }, "a previously Favorites session lands in Unfiled, so its Unfiled order stays");
  assert.deepStrictEqual(s.favorites, ["x", "a"].filter(function (k) { return k === "a"; }), "only keys that were actually favorites migrate");
});

// --- prototype-named dictionary keys ---

test("folder names that match Object.prototype members are ordinary names", function () {
  var s = folders.defaultState();
  ["constructor", "toString", "__proto__", "hasOwnProperty", "valueOf"].forEach(function (name) {
    var r = apply(s, { op: "create_folder", name: name });
    assert.ok(!r.error, name);
    s = r.state;
    var again = folders.normalizeState(JSON.parse(JSON.stringify(s)));
    assert.ok(again.folders.some(function (f) { return f.name === name; }), name + " survives normalization");
  });
  assert.strictEqual(s.folders.length, 5);
});

test("session keys and container ids named like prototype members are refused or inert", function () {
  var s = folders.normalizeState(JSON.parse('{"assignments":{"constructor":"favorites","__proto__":"favorites","toString":"nope"},"orders":{"constructor":["a"],"__proto__":["a"]},"collapsed":{"constructor":true}}'));
  assert.deepStrictEqual(Object.keys(s.assignments), []);
  assert.deepStrictEqual(s.favorites, ["constructor"], "an own key named like a prototype member is an ordinary tag; __proto__ is refused");
  assert.deepStrictEqual(Object.keys(s.orders), []);
  assert.strictEqual(Object.getPrototypeOf(s.assignments), Object.prototype);
  assert.strictEqual(({}).favorites, undefined, "global prototype untouched");
  assert.ok(apply(folders.defaultState(), { op: "place_session", sessionKey: "__proto__", folderId: "favorites" }, ["__proto__"]).error);
  assert.ok(apply(folders.defaultState(), { op: "place_session", sessionKey: "a", folderId: "constructor" }).error);
  assert.ok(apply(folders.defaultState(), { op: "set_collapsed", containerKey: "constructor", collapsed: true }).error);
  assert.ok(apply(folders.defaultState(), { op: "rename_folder", folderId: "toString", name: "x" }).error);
});

test("handler never treats prototype names as sessions", function () {
  var h = harness();
  h.add(1);
  ["constructor", "__proto__", "toString"].forEach(function (key) {
    h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionKey: key, folderId: "favorites" } });
    assert.ok(h.sent[h.sent.length - 1].msg.error, key);
  });
  assert.strictEqual(h.store["u1/proj"] && Object.keys(h.store["u1/proj"].assignments).length + h.store["u1/proj"].favorites.length, 0);
});

// --- project scoping and creation flows through the production handler ---

test("operations carry their project; a mismatch changes nothing and reports an error", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "other", op: { op: "create_folder", name: "X" } });
  var reply = h.sent[h.sent.length - 1];
  assert.ok(/different project/.test(reply.msg.error));
  assert.strictEqual(reply.msg.slug, "proj");
  assert.ok(!h.store["u1/proj"] || h.store["u1/proj"].folders.length === 0);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", op: { op: "create_folder", name: "X" } });
  assert.ok(/different project/.test(h.sent[h.sent.length - 1].msg.error), "a missing project is refused too");
});

test("create-folder acknowledgement carries the request id and new folder id for a follow-up move", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", requestId: "r1", op: { op: "create_folder", name: "Fresh" } });
  var ack = h.sent[h.sent.length - 1].msg;
  assert.strictEqual(ack.requestId, "r1");
  assert.ok(/^f_/.test(ack.folderId));
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: ack.folderId } });
  assert.strictEqual(h.store["u1/proj"].assignments["origin-1"], ack.folderId);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", requestId: "r2", op: { op: "create_folder", name: "fresh" } });
  var refused = h.sent[h.sent.length - 1].msg;
  assert.strictEqual(refused.requestId, "r2");
  assert.ok(refused.error);
  assert.strictEqual(refused.folderId, undefined);
});

test("a session created from a folder menu is filed by the server, and a refusal still keeps the session", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", requestId: "r", op: { op: "create_folder", name: "Here" } });
  var folderId = h.sent[h.sent.length - 1].msg.folderId;
  h.add(2);
  h.handler.placeNewSession(h.ws1, h.sessions.get(2), folderId, "proj");
  assert.strictEqual(h.store["u1/proj"].assignments["origin-2"], folderId);
  h.add(3);
  h.handler.placeNewSession(h.ws1, h.sessions.get(3), "f_missing1", "proj");
  assert.ok(h.sent[h.sent.length - 1].msg.error);
  assert.ok(h.sessions.has(3));
  h.add(4);
  h.handler.placeNewSession(h.ws1, h.sessions.get(4), folderId, "elsewhere");
  assert.strictEqual(h.store["u1/proj"].assignments["origin-4"], undefined);
});

test("reload: a new handler over the same stored state restores folders, favorites and order; another user sees none of it", function () {
  var h = harness();
  h.add(1); h.add(2);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "set_favorite", sessionId: 1, favorite: true } });
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "set_favorite", sessionId: 2, favorite: true, order: [2, 1] } });
  h.sent.length = 0;
  h.handler.sendStateTo(h.ws1);
  assert.deepStrictEqual(h.sent[0].msg.state.favorites, [2, 1]);
  assert.strictEqual(h.sent[0].msg.slug, "proj");
  h.sent.length = 0;
  h.handler.sendStateTo(h.ws2);
  assert.deepStrictEqual(h.sent[0].msg.state.assignments, {});
  assert.deepStrictEqual(h.sent[0].msg.state.favorites, []);
});

test("hidden sessions disappear from outgoing snapshots but keep their tag and folder for when they return", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", requestId: "r", op: { op: "create_folder", name: "One" } });
  var one = h.sent[h.sent.length - 1].msg.folderId;
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: one } });
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "set_favorite", sessionId: 1, favorite: true } });
  h.sessions.get(1).hidden = true;
  h.sent.length = 0;
  h.handler.sendStateTo(h.ws1);
  assert.deepStrictEqual(h.sent[0].msg.state.assignments, {});
  assert.deepStrictEqual(h.sent[0].msg.state.favorites, []);
  h.sessions.get(1).hidden = false;
  h.sent.length = 0;
  h.handler.sendStateTo(h.ws1);
  assert.deepStrictEqual(h.sent[0].msg.state.assignments, { 1: one });
  assert.deepStrictEqual(h.sent[0].msg.state.favorites, [1], "both memberships come back");
});

test("migration of a persisted pre-tag state: former Favorites go to Unfiled as tags in their old order, real folders untouched", function () {
  var legacy = {
    folders: [{ id: "f_aaaaaa", name: "Work" }],
    assignments: { a: "f_aaaaaa", b: "favorites", c: "favorites", d: "favorites" },
    orders: { favorites: ["c", "b"], f_aaaaaa: ["a"] },
    collapsed: { favorites: true, f_aaaaaa: true },
    legacyFavoritesMigrated: true,
  };
  var s = folders.normalizeState(JSON.parse(JSON.stringify(legacy)));
  assert.deepStrictEqual(s.favorites, ["c", "b", "d"], "the curated order first, then the rest in stored order");
  assert.deepStrictEqual(s.assignments, { a: "f_aaaaaa" }, "no previous folder can be recovered, so they are Unfiled; real assignments stay");
  assert.deepStrictEqual(s.orders, { f_aaaaaa: ["a"] });
  assert.deepStrictEqual(s.collapsed, { favorites: true, f_aaaaaa: true });
  assert.deepStrictEqual(folders.normalizeState(JSON.parse(JSON.stringify(s))), s, "normalizing again is stable");
  var h = harness();
  [1, 2, 3].forEach(function (id) { h.add(id); });
  h.store["u1/proj"] = { folders: [{ id: "f_aaaaaa", name: "Work" }], assignments: { "origin-1": "f_aaaaaa", "origin-2": "favorites", "origin-3": "favorites" }, orders: { favorites: ["origin-3", "origin-2"] }, legacyFavoritesMigrated: true };
  h.handler.sendStateTo(h.ws1);
  var sent = h.sent[h.sent.length - 1].msg.state;
  assert.deepStrictEqual(sent.favorites, [3, 2]);
  assert.deepStrictEqual(sent.assignments, { 1: "f_aaaaaa" });
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "set_collapsed", containerKey: "favorites", collapsed: false } });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-3", "origin-2"], "the migrated shape is persisted on the next save");
  assert.strictEqual(h.store["u1/proj"].assignments["origin-2"], undefined);
});

test("legacy clients: placing in Favorites tags, placing elsewhere moves, bookmarks keep the folder", function () {
  var h = harness();
  h.add(1);
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", requestId: "r", op: { op: "create_folder", name: "One" } });
  var one = h.sent[h.sent.length - 1].msg.folderId;
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: one } });
  h.handler.handleMessage(h.ws1, { type: "set_session_bookmark", sessionId: 1, bookmarked: true });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-1"]);
  assert.strictEqual(h.store["u1/proj"].assignments["origin-1"], one, "bookmarking keeps the folder");
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: "favorites" } });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-1"], "tagging twice is idempotent");
  h.handler.handleMessage(h.ws1, { type: "session_folders_op", slug: "proj", op: { op: "place_session", sessionId: 1, folderId: null } });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, ["origin-1"]);
  assert.strictEqual(h.store["u1/proj"].assignments["origin-1"], undefined);
  h.handler.handleMessage(h.ws1, { type: "set_session_bookmark", sessionId: 1, bookmarked: false });
  assert.deepStrictEqual(h.store["u1/proj"].favorites, []);
});
