var test = require("node:test");
var assert = require("node:assert/strict");
var attach = require("../lib/server-default-ai").attachDefaultAiService;

function fixture(multi, options) {
  options = options || {};
  var data = { users: [{ id: "u1", linuxUser: "live-u1" }, { id: "u2" }] }, sent = [], clients = [], ownerArgs = [], catalogActors = [];
  var users = {
    isMultiUser: function () { return multi; },
    findUserById: function (id) { return data.users.filter(function (u) { return u.id === id; })[0] || null; },
    getDefaultAiPreference: function () { return data.preference ? { present: true, source: "explicit", preference: data.preference } : options.preference || { present: false }; },
    setDefaultAiPreference: function (_id, value) { if (options.saveResult) return options.saveResult; data.preference = value; return { ok: true, preference: value }; },
  };
  var ctx = { getVendorModelAvailability: function () { return options.availability || [{ id: "codex", installed: true }, { id: "claude", installed: false }]; }, getVendorModelCatalog: function (catalogWs, vendor) { catalogActors.push(catalogWs && catalogWs._clayUser); if (options.getCatalog) return options.getCatalog(vendor); return options.catalogPromise || Promise.resolve({ status: "ready", installedVendors: ["codex"], models: [{ value: "gpt-6-astra", supportedEffortLevels: ["low", "medium"] }], defaultModel: "gpt-6-astra" }); } };
  var service = attach({ users: users, homeChatHandler: { findMateProject: function (owner) { ownerArgs.push(owner); if (options.findError) throw new Error(options.findError); return { ctx: ctx }; } }, forEachAppClient: function (fn) { clients.forEach(fn); }, serverEpoch: options.serverEpoch });
  function ws(id) { var socket = { readyState: 1, _clayUser: id ? { id: id } : null, send: function (value) { sent.push(JSON.parse(value)); } }; clients.push(socket); return socket; }
  return { service: service, users: users, sent: sent, ws: ws, data: data, ownerArgs: ownerArgs, catalogActors: catalogActors };
}

test("Default AI service rejects spoofed actors and broadcasts only to same user", async function () {
  var f = fixture(true), one = f.ws("u1"), two = f.ws("u2"), global = f.ws("u1");
  f.service.handleMessage({ readyState: 1, _clayUser: { id: "missing" }, send: function (v) { f.sent.push(JSON.parse(v)); } }, { type: "default_ai_get", requestId: "bad" });
  assert.match(f.sent[0].error, /account/);
  f.service.handleMessage(one, { type: "default_ai_set", requestId: "set", vendor: "codex", model: "gpt-6-astra", effort: "medium" });
  await new Promise(function (resolve) { setTimeout(resolve, 5); });
  var replies = f.sent.filter(function (m) { return m.type === "default_ai_state" && m.preference && m.preference.model === "gpt-6-astra"; });
  assert.equal(replies.length, 2);
  assert.equal(f.sent.filter(function (m) { return m.type === "default_ai_state" && m.requestId === null; }).length, 1);
  assert.equal(f.data.preference.model, "gpt-6-astra");
  assert.equal(f.sent.some(function (m) { return m.type === "default_ai_state" && m.requestId === "set" && m.preference && m.preference.vendor === "codex"; }), true);
  assert.ok(two && global);
});

test("Default AI service exposes resolver without SDK turns", async function () {
  var f = fixture(false), ws = f.ws(null), result = await f.service.resolveForWs(ws);
  assert.equal(result.ready, true);
  assert.equal(result.vendor, "codex");
  assert.equal(f.sent.length, 0);
  assert.equal(f.ownerArgs[0], null);
});

test("a synchronous Clay project lookup failure is returned as resolver state", async function () {
  var f = fixture(false, { findError: "project registry unavailable" });
  var result = await f.service.resolveForWs(f.ws(null));
  assert.equal(result.ready, false);
  assert.match(result.error, /project registry unavailable/);
});

test("Default AI service revalidates a revoked actor during catalog await", async function () {
  var release;
  var f = fixture(true, { catalogPromise: new Promise(function (resolve) { release = resolve; }) }), ws = f.ws("u1");
  var pending = f.service.resolveForWs(ws);
  f.users.findUserById = function () { return null; };
  release({ status: "ready", installedVendors: ["codex"], models: [{ value: "gpt-6-astra" }], defaultModel: "gpt-6-astra" });
  assert.equal((await pending).ready, false);
});

test("catalog lookup derives the live principal and failed saves do not report a draft as canonical", async function () {
  var f = fixture(true, {
    preference: { present: true, source: "explicit", preference: { vendor: "codex", model: "gpt-6-astra", effort: "low" } },
    saveResult: { ok: false, error: "disk full" },
  });
  var ws = f.ws("u1");
  ws._clayUser = { id: "u1", linuxUser: "stale-value" };
  f.service.handleMessage(ws, { type: "default_ai_set", requestId: "save-fail", vendor: "codex", model: "gpt-6-astra", effort: "medium" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(f.catalogActors[0].linuxUser, "live-u1");
  var reply = f.sent.filter(function (message) { return message.requestId === "save-fail"; })[0];
  assert.equal(reply.ready, false);
  assert.equal(reply.preference, undefined);
  assert.equal(reply.selection, undefined);
  assert.match(reply.error, /disk full/);
});

test("a slow canonical read retries after a newer save and never publishes the obsolete runtime", async function () {
  var releaseClaude;
  var claudeCatalog = new Promise(function (resolve) { releaseClaude = resolve; });
  var f = fixture(false, {
    preference: { present: true, source: "explicit", preference: { vendor: "claude", model: "opus", effort: "" } },
    availability: [{ id: "codex", installed: true }, { id: "claude", installed: true }],
    getCatalog: function (vendor) {
      if (vendor === "claude") return claudeCatalog;
      return Promise.resolve({ status: "ready", models: [{ value: "gpt-6-astra", supportedEffortLevels: ["high"] }], defaultModel: "gpt-6-astra" });
    },
  });
  var ws = f.ws(null);
  f.service.handleMessage(ws, { type: "default_ai_get", requestId: "slow-get" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  f.service.handleMessage(ws, { type: "default_ai_set", requestId: "fast-save", vendor: "codex", model: "gpt-6-astra", effort: "high" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  releaseClaude({ status: "ready", models: [{ value: "opus" }], defaultModel: "opus" });
  await new Promise(function (resolve) { setImmediate(function () { setImmediate(resolve); }); });
  var saved = f.sent.filter(function (message) { return message.requestId === "fast-save"; })[0];
  var refreshed = f.sent.filter(function (message) { return message.requestId === "slow-get"; })[0];
  assert.equal(saved.selection.vendor, "codex");
  assert.equal(refreshed.selection.vendor, "codex");
  assert.equal(saved.canonicalRevision, 1);
  assert.equal(refreshed.canonicalRevision, 1);
  assert.equal(f.sent.some(function (message) { return message.selection && message.selection.vendor === "claude"; }), false);
});

test("a restarted Default AI service publishes its new epoch with revision zero", async function () {
  var first = fixture(false, { serverEpoch: "first-daemon" });
  var second = fixture(false, { serverEpoch: "second-daemon" });
  first.service.handleMessage(first.ws(null), { type: "default_ai_get", requestId: "first" });
  second.service.handleMessage(second.ws(null), { type: "default_ai_get", requestId: "second" });
  await new Promise(function (resolve) { setImmediate(resolve); });
  assert.equal(first.sent[0].serverEpoch, "first-daemon");
  assert.equal(second.sent[0].serverEpoch, "second-daemon");
  assert.equal(second.sent[0].canonicalRevision, 0);
});
