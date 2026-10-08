var test = require("node:test");
var assert = require("node:assert");
var fs = require("fs");
var os = require("os");
var path = require("path");
var nsd = require("../lib/new-session-default");

function config() {
  return { daemon: { keep: 1 }, projects: [
    { slug: "alpha", title: "Alpha", defaultModel: "m1", extra: { nested: [1, 2] } },
    { slug: "beta", title: "Beta" },
  ] };
}

test("the default is stored on the project's own entry and isolated from other projects", function () {
  var c = config();
  var saves = 0;
  var result = nsd.setNewSessionDefault(c, "alpha", { vendor: "codex", model: "gpt-x", effort: "low", stray: "ignored" }, function () { saves++; });
  assert.deepStrictEqual(result, { ok: true });
  assert.strictEqual(saves, 1);
  assert.deepStrictEqual(c.projects[0].newSessionDefault, { vendor: "codex" });
  assert.deepStrictEqual(nsd.getNewSessionDefault(c, "alpha").preference, { vendor: "codex" });
  assert.strictEqual(nsd.getNewSessionDefault(c, "beta").preference, null);
  assert.strictEqual(c.projects[1].newSessionDefault, undefined);
  assert.strictEqual(c.daemon.keep, 1);
});

test("unrelated project and daemon fields are preserved, and clearing removes only this key", function () {
  var c = config();
  nsd.setNewSessionDefault(c, "alpha", { vendor: "claude" }, function () {});
  assert.strictEqual(c.projects[0].defaultModel, "m1");
  assert.deepStrictEqual(c.projects[0].extra, { nested: [1, 2] });
  assert.strictEqual(c.projects[0].title, "Alpha");
  nsd.setNewSessionDefault(c, "alpha", null, function () {});
  assert.strictEqual("newSessionDefault" in c.projects[0], false);
  assert.strictEqual(c.projects[0].defaultModel, "m1");
});

test("it survives a restart: written through the real save shape and read back from disk", function (t) {
  var dir = fs.mkdtempSync(path.join(os.tmpdir(), "clay-nsd-"));
  t.after(function () { fs.rmSync(dir, { recursive: true, force: true }); });
  var file = path.join(dir, "daemon.json");
  var c = config();
  nsd.setNewSessionDefault(c, "beta", { vendor: "codex" }, function (cfg) { fs.writeFileSync(file, JSON.stringify(cfg, null, 2)); });
  var restarted = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.deepStrictEqual(nsd.getNewSessionDefault(restarted, "beta").preference, { vendor: "codex" });
  assert.strictEqual(nsd.getNewSessionDefault(restarted, "alpha").preference, null);
  assert.deepStrictEqual(restarted.projects[0].extra, { nested: [1, 2] });
});

test("a failed save leaves the in-memory config exactly as it was", function () {
  var c = config();
  var boom = function () { throw new Error("disk full"); };
  var failed = nsd.setNewSessionDefault(c, "alpha", { vendor: "codex", model: "x", effort: "" }, boom);
  assert.strictEqual(failed.ok, false);
  assert.strictEqual("newSessionDefault" in c.projects[0], false, "nothing falsely recorded");
  nsd.setNewSessionDefault(c, "alpha", { vendor: "claude" }, function () {});
  var again = nsd.setNewSessionDefault(c, "alpha", { vendor: "codex", model: "b", effort: "" }, boom);
  assert.strictEqual(again.ok, false);
  assert.deepStrictEqual(c.projects[0].newSessionDefault, { vendor: "claude" }, "the previous saved value is restored");
  var cleared = nsd.setNewSessionDefault(c, "alpha", null, boom);
  assert.strictEqual(cleared.ok, false);
  assert.deepStrictEqual(c.projects[0].newSessionDefault, { vendor: "claude" }, "a failed clear keeps the value");
});

test("worktrees read their parent's default and cannot set their own; unknown projects fail", function () {
  var c = config();
  nsd.setNewSessionDefault(c, "alpha", { vendor: "codex" }, function () {});
  assert.deepStrictEqual(nsd.getNewSessionDefault(c, "alpha--feature").preference, { vendor: "codex" });
  assert.strictEqual(nsd.getNewSessionDefault(c, "beta--feature").preference, null);
  var blocked = nsd.setNewSessionDefault(c, "alpha--feature", { vendor: "claude" }, function () { throw new Error("must not save"); });
  assert.match(blocked.error, /inherit/);
  assert.match(nsd.setNewSessionDefault(c, "ghost", { vendor: "claude" }, function () {}).error, /not found/);
  assert.strictEqual(nsd.getNewSessionDefault(c, "ghost").preference, null);
});

test("malformed stored values read as no default", function () {
  var c = config();
  c.projects[0].newSessionDefault = { model: "x" };
  assert.strictEqual(nsd.getNewSessionDefault(c, "alpha").preference, null);
  c.projects[0].newSessionDefault = "codex";
  assert.strictEqual(nsd.getNewSessionDefault(c, "alpha").preference, null);
});
