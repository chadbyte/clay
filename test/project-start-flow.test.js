// Pure-module and source-contract tests for the project-start dialog.
// Imports only dependency-free modules (no store, no ws, no DOM, no config).
var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var path = require("node:path");
var pathToFileURL = require("node:url").pathToFileURL;
var root = path.join(__dirname, "..");
function load(name) { return import(pathToFileURL(path.join(root, "lib/public/modules", name)).href); }
function read(rel) { return fs.readFileSync(path.join(root, rel), "utf8"); }

test("deep links land on the matching step and every open starts clean", async function () {
  var s = await load("project-start-state.js");
  var base = s.initialProjectStart();
  assert.equal(s.openState(base, undefined).view, "choices");
  assert.equal(s.openState(base, "existing").view, "open");
  assert.equal(s.openState(base, "create").view, "create");
  assert.equal(s.openState(base, "clone").view, "clone");
  var dirty = Object.assign({}, s.openState(base, "create"), { name: "keep" });
  var reopened = s.openState(s.closeState(dirty), "create");
  assert.equal(reopened.name, "");
  assert.ok(reopened.gen > dirty.gen);
});

test("submit is single-flight, errors keep the dialog and input, success closes it", async function () {
  var s = await load("project-start-state.js");
  var st = s.openState(s.initialProjectStart(), "create");
  st = Object.assign({}, st, { name: "demo" });
  var busy = s.beginSubmit(st, "create", "r1");
  assert.equal(busy.submit.status, "busy");
  assert.equal(s.beginSubmit(busy, "create", "r2"), busy, "duplicate submit is ignored");
  var failed = s.resolveSubmit(busy, { requestId: "r1", ok: false, error: "Invalid name." });
  assert.equal(failed.outcome, "error");
  assert.equal(failed.state.view, "create");
  assert.equal(failed.state.name, "demo");
  assert.equal(failed.state.submit.status, "idle");
  assert.equal(failed.state.submit.error, "Invalid name.");
  var ok = s.resolveSubmit(busy, { requestId: "r1", ok: true, slug: "demo" });
  assert.equal(ok.outcome, "success");
  assert.equal(ok.state.view, null);
});

test("a completion for a closed, backed-out or reopened dialog never touches it", async function () {
  var s = await load("project-start-state.js");
  var busy = s.beginSubmit(s.openState(s.initialProjectStart(), "clone"), "clone", "r1");
  var closed = s.closeState(busy);
  assert.equal(s.resolveSubmit(closed, { requestId: "r1", ok: true, slug: "x" }).outcome, "orphan");
  var backed = s.selectView(busy, "choices");
  assert.equal(s.resolveSubmit(backed, { requestId: "r1", ok: true }).outcome, "orphan");
  var reopenedBusy = s.beginSubmit(s.openState(closed, "clone"), "clone", "r2");
  var late = s.resolveSubmit(reopenedBusy, { requestId: "r1", ok: false, error: "late" });
  assert.equal(late.outcome, "orphan");
  assert.equal(late.state, reopenedBusy, "state object is untouched");
  assert.equal(s.resolveSubmit(busy, { ok: true }).outcome, "orphan", "reply without requestId is not trusted");
  assert.equal(s.applyProgress(closed, { status: "cloning", requestId: "r1" }), closed);
  assert.equal(s.applyProgress(busy, { status: "cloning" }), busy, "progress without an id is ignored");
  assert.equal(s.applyProgress(busy, { status: "cloning", requestId: "other" }), busy);
  assert.equal(s.applyProgress(busy, { status: "cloning", requestId: "r1" }).submit.cloning, true);
  assert.equal(s.applyProgress(reopenedBusy, { status: "cloning", requestId: "r1" }), reopenedBusy, "old clone progress after close/reopen is ignored");
});

test("folder browser ignores stale replies and only trusts an exact, listed directory", async function () {
  var f = await load("project-start-folder-state.js");
  var st = f.beginInitial(["/work", "~"], "b1");
  var ready = f.applyBrowseResult(st, { requestId: "b1", dir: "/work", prefix: "", parent: "/", entries: [{ name: "a", path: "/work/a" }, { bad: 1 }] }, "b2").state;
  assert.equal(ready.status, "ready");
  assert.deepEqual(ready.entries, [{ name: "a", path: "/work/a" }]);
  assert.equal(f.canOpenFolder(ready), true);
  var first = f.beginNavigate(ready, "/work/a", "b3");
  assert.equal(f.canOpenFolder(first), false, "cannot open while a navigation is pending");
  var second = f.beginNavigate(first, "/work/b", "b4");
  var staleApplied = f.applyBrowseResult(second, { requestId: "b3", dir: "/work/a", prefix: "", entries: [] }, "x");
  assert.equal(staleApplied.state, second, "late reply for superseded navigation is dropped");
  var current = f.applyBrowseResult(second, { requestId: "b4", dir: "/work/b", prefix: "", parent: "/work", entries: [] }, "x").state;
  assert.equal(current.dir, "/work/b");
  assert.equal(f.applyBrowseResult(current, { requestId: "b4", dir: "/other", prefix: "", entries: [] }, "x").state, current, "reply after completion is dropped");
  var prefixed = f.applyBrowseResult(f.beginNavigate(current, "/work/zz", "b5"), { requestId: "b5", dir: "/work", prefix: "zz", entries: [] }, "x").state;
  assert.equal(prefixed.status, "error");
  assert.equal(prefixed.errorKind, "missing");
  assert.equal(f.canOpenFolder(prefixed), false);
  assert.equal(prefixed.dir, "/work/b", "last good directory is retained for recovery");
});

test("permission denial is distinct, and the initial directory falls back to the next candidate", async function () {
  var f = await load("project-start-folder-state.js");
  var st = f.beginInitial(["/denied", "~"], "b1");
  var out = f.applyBrowseResult(st, { requestId: "b1", entries: [], error: "Directory access is not permitted" }, "b2");
  assert.equal(out.retryPath, "~");
  assert.equal(out.state.status, "loading");
  assert.equal(out.state.requestId, "b2");
  assert.equal(f.applyBrowseResult(out.state, { requestId: "b1", dir: "/denied", prefix: "", entries: [] }, "z").state, out.state);
  var denied = f.applyBrowseResult(out.state, { requestId: "b2", entries: [], error: "Directory access is not permitted" }, "b3");
  assert.equal(denied.retryPath, null);
  assert.equal(denied.state.status, "error");
  assert.equal(denied.state.errorKind, "denied");
  var navDenied = f.applyBrowseResult(f.beginNavigate(f.applyBrowseResult(f.beginInitial(["~"], "q1"), { requestId: "q1", dir: "/h", prefix: "", entries: [] }, "x").state, "/etc", "q2"), { requestId: "q2", entries: [], error: "Directory access is not permitted" }, "x");
  assert.equal(navDenied.retryPath, null, "user navigation never silently redirects");
  assert.equal(navDenied.state.errorKind, "denied");
});

test("initial directory derives from the current context and respects OS-user boundaries", async function () {
  var p = await load("project-start-path.js");
  var projects = [{ slug: "mate", isMate: true, path: "/m/x" }, { slug: "app", path: "/srv/work/app" }];
  assert.deepEqual(p.initialCandidates({ currentSlug: "app", projectsHubList: projects }), ["/srv/work", "~"]);
  assert.deepEqual(p.initialCandidates({ currentSlug: "mate", projectsHubList: projects }), ["~"]);
  assert.deepEqual(p.initialCandidates({ currentSlug: null, projectsHubList: [] }), ["~"]);
  var users = [{ id: "u1", role: "user", linuxUser: "alice" }, { id: "u2", role: "admin", linuxUser: "root2" }];
  assert.deepEqual(p.initialCandidates({ isOsUsers: true, myUserId: "u1", cachedAllUsers: users, currentSlug: "app", projectsHubList: projects }), ["/home/alice"]);
  assert.deepEqual(p.initialCandidates({ isOsUsers: true, myUserId: "u2", cachedAllUsers: users, currentSlug: "app", projectsHubList: projects }), ["/srv/work", "~"]);
  assert.equal(p.baseName("/a/b/"), "b");
  assert.equal(p.baseName("/"), "/");
  assert.equal(p.parentOf("/a"), "/");
  assert.equal(p.parentOf("/"), null);
  assert.deepEqual(p.breadcrumbSegments("/a/b/c/d", 3), { truncated: true, segments: ["b", "c", "d"] });
});

test("markup, modules and old removed-projects list satisfy the contract", function () {
  var html = read("lib/public/index.html");
  assert.ok(html.indexOf('id="project-start-modal"') > 0);
  assert.equal(html.indexOf("add-project"), -1);
  var sources = ["project-start-dialog", "project-start-folder-view", "project-start-forms", "project-start-submit", "project-start-state", "project-start-folder-state", "project-start-path", "app-projects"].map(function (n) {
    return [n, read("lib/public/modules/" + n + ".js")];
  });
  sources.forEach(function (pair) {
    assert.ok(pair[1].split("\n").length < 500, pair[0] + " stays under 500 lines");
    if (pair[0] !== "app-projects") {
      assert.equal(/=>/.test(pair[1]), false, pair[0] + " uses no arrow functions");
      assert.equal(/\b(const|let)\s/.test(pair[1]), false, pair[0] + " uses var");
      assert.equal(/_ctx|localStorage|\balert\(|\bconfirm\(|\bprompt\(/.test(pair[1]), false, pair[0] + " follows module rules");
    }
  });
  var all = sources.map(function (p) { return p[1]; }).join("\n") + read("lib/public/css/project-start.css");
  assert.equal(/removed-item|renderRemovedProjectsList|Add again|Recently deleted|Previously removed/i.test(all), false);
  assert.equal(/add-project/.test(read("lib/public/css/overlays.css")), false);
  // Server-side removed-project history is untouched.
  assert.match(read("lib/server.js"), /removedProjects: getRemovedProjects/);
  assert.match(read("lib/public/modules/app-projects.js"), /export function getCachedRemovedProjects/);
  var app = read("lib/public/app.js");
  assert.match(app, /projectStart: initialProjectStart\(\)/);
  assert.match(app, /initProjectStart\(\)/);
});

test("entry points still open the right step", function () {
  assert.match(read("lib/public/modules/projects-hub.js"), /openAddProjectModal\(button\.dataset\.projectsMode\)/);
  assert.match(read("lib/public/modules/app-home-hub.js"), /openAddProjectModal\("create"\)/);
  assert.match(read("lib/public/modules/projects-hub-view.js"), /setupAction\('existing'/);
  var dialog = read("lib/public/modules/project-start-dialog.js");
  assert.match(dialog, /Open an existing folder/);
  assert.match(dialog, /Create a new project/);
  assert.match(dialog, /Clone a repository/);
  assert.match(read("lib/public/modules/project-start-submit.js"), /switchProject\(msg\.slug\)/);
});
