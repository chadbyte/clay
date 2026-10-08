var test = require("node:test");
var assert = require("node:assert");
var attach = require("../lib/users-session-folder-preferences").attachSessionFolderPreferences;

function make(users) {
  var data = { users: users };
  var saves = 0;
  var prefs = attach({ loadUsers: function () { return JSON.parse(JSON.stringify(data)); }, saveUsers: function (d) { data = JSON.parse(JSON.stringify(d)); saves++; } });
  return { prefs: prefs, data: function () { return data; }, saves: function () { return saves; } };
}

test("state is stored on the user's own record, per project", function () {
  var h = make([{ id: "u1" }, { id: "u2" }]);
  var state = { folders: [{ id: "f_abcdef", name: "Work" }], assignments: { s1: "f_abcdef" } };
  var saved = h.prefs.setSessionFolders("u1", "alpha", state);
  assert.strictEqual(saved.ok, true);
  assert.deepStrictEqual(h.prefs.getSessionFolders("u1", "alpha").folders, [{ id: "f_abcdef", name: "Work" }]);
  assert.deepStrictEqual(h.prefs.getSessionFolders("u1", "beta").folders, [], "another project is untouched");
  assert.deepStrictEqual(h.prefs.getSessionFolders("u2", "alpha").folders, [], "another user is untouched");
  assert.strictEqual(h.data().users[1].sessionFolders, undefined);
});

test("stored data is normalized on read and invalid projects or users are refused", function () {
  var h = make([{ id: "u1", sessionFolders: { alpha: { folders: [{ id: "bad", name: "x" }], view: { sort: "nope" } } } }]);
  var read = h.prefs.getSessionFolders("u1", "alpha");
  assert.deepStrictEqual(read.folders, []);
  assert.strictEqual(read.view.sort, "activity");
  assert.ok(h.prefs.setSessionFolders("u1", "../evil", {}).error);
  assert.ok(h.prefs.setSessionFolders("ghost", "alpha", {}).error);
  assert.strictEqual(h.saves(), 0);
});

test("a project slug named like an Object.prototype member reads as empty and round-trips", function () {
  var h = make([{ id: "u1" }]);
  assert.deepStrictEqual(h.prefs.getSessionFolders("u1", "constructor").folders, []);
  assert.deepStrictEqual(h.prefs.getSessionFolders("u1", "toString").folders, []);
  h.prefs.setSessionFolders("u1", "constructor", { folders: [{ id: "f_abcdef", name: "Kept" }] });
  assert.deepStrictEqual(h.prefs.getSessionFolders("u1", "constructor").folders, [{ id: "f_abcdef", name: "Kept" }]);
  assert.deepStrictEqual(h.prefs.getSessionFolders("u1", "valueOf").folders, []);
});
