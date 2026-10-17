// Server protocol for the project-start dialog, exercised through the slugless global handler
// with a fake socket and a temp directory tree. No config, users or provider state is read or written.
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var attachGlobalWs = require("../lib/server-global-ws").attachGlobalWs;

function setup(canUsePath, extra) {
  var base = fs.mkdtempSync(path.join(os.tmpdir(), "project-start-"));
  fs.mkdirSync(path.join(base, "alpha", "inner"), { recursive: true });
  fs.mkdirSync(path.join(base, "beta"));
  fs.writeFileSync(path.join(base, "file.txt"), "x");
  var sent = [];
  var ws = { readyState: 1, _clayUser: { id: "u1" }, send: function (v) { sent.push(JSON.parse(v)); } };
  var handler = attachGlobalWs(Object.assign({ canUsePath: canUsePath }, extra || {}));
  return { base: base, sent: sent, ws: ws, handler: handler };
}

test("browse_dir echoes requestId and reports the exact listed directory", function () {
  var t = setup(null);
  t.handler.handleMessage(t.ws, { type: "browse_dir", path: t.base, requestId: "r1" });
  var r = t.sent[0];
  assert.equal(r.type, "browse_dir_result");
  assert.equal(r.requestId, "r1");
  assert.equal(r.dir, t.base);
  assert.equal(r.prefix, "");
  assert.equal(r.parent, path.dirname(t.base));
  assert.deepEqual(r.entries.map(function (e) { return e.name; }), ["alpha", "beta"]);
  t.handler.handleMessage(t.ws, { type: "browse_dir", path: path.join(t.base, "al"), requestId: "r2" });
  assert.equal(t.sent[1].prefix, "al", "a non-directory path is reported as a prefix match, not an exact directory");
  assert.equal(t.sent[1].dir, t.base);
  fs.rmSync(t.base, { recursive: true, force: true });
});

test("browse_dir without a requestId keeps its legacy shape and rejects oversize ids", function () {
  var t = setup(null);
  t.handler.handleMessage(t.ws, { type: "browse_dir", path: t.base });
  assert.equal(t.sent[0].requestId, undefined);
  t.handler.handleMessage(t.ws, { type: "browse_dir", path: t.base, requestId: new Array(100).join("x") });
  assert.equal(t.sent[1].requestId, undefined);
  fs.rmSync(t.base, { recursive: true, force: true });
});

test("browse_dir stays permission-filtered, echoes the id on denial and hides unlistable parents", function () {
  var t = setup(function (userId, p) { return userId === "u1" && (p === t.base || p.indexOf(t.base + path.sep) === 0) && p.indexOf("beta") < 0; });
  t.handler.handleMessage(t.ws, { type: "browse_dir", path: t.base, requestId: "r1" });
  assert.deepEqual(t.sent[0].entries.map(function (e) { return e.name; }), ["alpha"]);
  assert.equal(t.sent[0].parent, null, "parent outside the allowed tree is not offered");
  t.handler.handleMessage(t.ws, { type: "browse_dir", path: os.tmpdir(), requestId: "r2" });
  assert.equal(t.sent[1].requestId, "r2");
  assert.equal(t.sent[1].error, "Directory access is not permitted");
  assert.deepEqual(t.sent[1].entries, []);
  fs.rmSync(t.base, { recursive: true, force: true });
});

test("add/create/clone replies carry the requestId through success, failure and async completion", function () {
  var pending;
  var t = setup(null, {
    onAddProject: function (dir) { return { ok: true, slug: "added", existing: false, dir: dir }; },
    onCreateProject: function () { return { ok: false, error: "exists" }; },
    onCloneProject: function (url, user, done) { pending = done; },
  });
  t.handler.handleMessage(t.ws, { type: "add_project", path: t.base, requestId: "a1" });
  assert.equal(t.sent[0].requestId, "a1");
  assert.equal(t.sent[0].ok, true);
  t.handler.handleMessage(t.ws, { type: "create_project", name: "bad name", requestId: "c1" });
  assert.equal(t.sent[1].requestId, "c1");
  assert.equal(t.sent[1].ok, false);
  t.handler.handleMessage(t.ws, { type: "create_project", name: "good", requestId: "c2" });
  assert.equal(t.sent[2].requestId, "c2");
  assert.equal(t.sent[2].error, "exists");
  t.handler.handleMessage(t.ws, { type: "clone_project", url: "ftp://nope", requestId: "k0" });
  assert.equal(t.sent[3].requestId, "k0");
  assert.match(t.sent[3].error, /Invalid URL/);
  t.handler.handleMessage(t.ws, { type: "clone_project", url: "https://example.invalid/r.git", requestId: "k1" });
  assert.equal(t.sent[4].type, "clone_project_progress");
  assert.equal(t.sent[4].requestId, "k1");
  pending({ ok: true, slug: "cloned" });
  assert.equal(t.sent[5].requestId, "k1");
  assert.equal(t.sent[5].slug, "cloned");
  t.handler.handleMessage(t.ws, { type: "add_project", path: path.join(t.base, "missing"), requestId: "a2" });
  assert.equal(t.sent[6].requestId, "a2");
  assert.equal(t.sent[6].error, "Directory not found");
  fs.rmSync(t.base, { recursive: true, force: true });
});
