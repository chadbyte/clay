var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attach = require("../lib/server-cursor-sharing").attachCursorSharingService;
var attachPreferences = require("../lib/users-preferences").attachPreferences;

function fixture() {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-cursor-")), usersPath = path.join(root, "users.json"), configPath = path.join(root, "daemon.json");
  fs.writeFileSync(usersPath, JSON.stringify({ users: [{ id: "u1" }, { id: "u2" }] }));
  fs.writeFileSync(configPath, JSON.stringify({}));
  var data = JSON.parse(fs.readFileSync(usersPath, "utf8")), sent = [], clients = [];
  var preferences = attachPreferences({ loadUsers: function () { return JSON.parse(fs.readFileSync(usersPath, "utf8")); }, saveUsers: function (next) { fs.writeFileSync(usersPath, JSON.stringify(next)); }, config: { loadConfig: function () { return JSON.parse(fs.readFileSync(configPath, "utf8")); }, saveConfig: function (next) { fs.writeFileSync(configPath, JSON.stringify(next)); } } });
  var users = {
    isMultiUser: function () { return true; },
    findUserById: function (id) { return data.users.filter(function (user) { return user.id === id; })[0] || null; },
    getCursorSharing: preferences.getCursorSharing,
    setCursorSharing: preferences.setCursorSharing,
  };
  var service = attach({ users: users, forEachAppClient: function (fn) { clients.forEach(fn); } });
  function ws(id) {
    var socket = { readyState: 1, _clayUser: { id: id }, send: function (value) { sent.push({ id: id, message: JSON.parse(value) }); } };
    clients.push(socket);
    return socket;
  }
  return { data: data, usersPath: usersPath, sent: sent, service: service, ws: ws };
}

test("cursor sharing persists and broadcasts only within the authenticated user", function () {
  var f = fixture();
  var first = f.ws("u1");
  var sameUser = f.ws("u1");
  var otherUser = f.ws("u2");
  f.service.handleMessage(first, { type: "cursor_sharing_set", enabled: false, requestId: "save" });
  assert.equal(JSON.parse(fs.readFileSync(f.usersPath, "utf8")).users[0].cursorSharing, false);
  assert.equal(f.sent.filter(function (entry) { return entry.id === "u1"; }).length, 2);
  assert.equal(f.sent.some(function (entry) { return entry.id === "u2"; }), false);
  f.service.handleMessage(sameUser, { type: "cursor_sharing_get", requestId: "reload" });
  assert.equal(f.sent[f.sent.length - 1].message.cursorSharing, false);
  assert.equal(f.sent[f.sent.length - 1].message.requestId, "reload");
  assert.equal(otherUser._clayUser.id, "u2");
});

test("cursor sharing rejects unauthenticated and non-boolean setters", function () {
  var f = fixture();
  var unauthorized = { readyState: 1, _clayUser: { id: "missing" }, send: function (value) { f.sent.push({ message: JSON.parse(value) }); } };
  f.service.handleMessage(unauthorized, { type: "cursor_sharing_set", enabled: false, requestId: "unauthorized" });
  assert.equal(f.sent[0].message.ready, false);
  var ws = f.ws("u1");
  f.service.handleMessage(ws, { type: "cursor_sharing_set", enabled: "off", requestId: "invalid" });
  assert.equal(f.sent[f.sent.length - 1].message.ready, false);
  assert.equal(JSON.parse(fs.readFileSync(f.usersPath, "utf8")).users[0].cursorSharing, undefined);
});

test("single-user cursor sharing saves and reloads through daemon preference storage", function () {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-cursor-single-")), configPath = path.join(root, "daemon.json");
  fs.writeFileSync(configPath, "{}");
  var sent = [], clients = [];
  var preferences = attachPreferences({ loadUsers: function () { return { users: [] }; }, saveUsers: function () {}, config: { loadConfig: function () { return JSON.parse(fs.readFileSync(configPath, "utf8")); }, saveConfig: function (next) { fs.writeFileSync(configPath, JSON.stringify(next)); } } });
  var users = { isMultiUser: function () { return false; }, getCursorSharing: preferences.getCursorSharing, setCursorSharing: preferences.setCursorSharing, findUserById: function () { return null; } };
  var service = attach({ users: users, forEachAppClient: function (fn) { clients.forEach(fn); } });
  function ws() { var socket = { readyState: 1, send: function (value) { sent.push(JSON.parse(value)); } }; clients.push(socket); return socket; }
  var first = ws(), second = ws();
  service.handleMessage(first, { type: "cursor_sharing_set", enabled: false, requestId: "single-save" });
  assert.equal(JSON.parse(fs.readFileSync(configPath, "utf8")).cursorSharing, false);
  service = attach({ users: users, forEachAppClient: function (fn) { clients.forEach(fn); } });
  service.handleMessage(second, { type: "cursor_sharing_get", requestId: "single-reload" });
  assert.equal(sent[sent.length - 1].cursorSharing, false);
  assert.equal(sent.filter(function (message) { return message.cursorSharing === false; }).length, 3);
});
