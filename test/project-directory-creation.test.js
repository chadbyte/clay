var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var vm = require("node:vm");
var childProcess = require("node:child_process");
var createRequire = require("node:module").createRequire;
var temporaryHome = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "clay-creation-test-home-")));
process.env.HOME = temporaryHome;
process.env.CLAY_HOME = temporaryHome;
delete process.env.SUDO_USER;
delete process.env.SUDO_HOME;
test.after(function () { fs.rmSync(temporaryHome, { recursive: true, force: true }); });
var daemonRequire = createRequire(path.join(__dirname, "../lib/daemon.js"));
var daemonSource = fs.readFileSync(path.join(__dirname, "../lib/daemon.js"), "utf8");
var generateSlug = daemonRequire("./config").generateSlug;
var claimDirectory = require("../lib/project-directory-claim").claim;

// Evaluate the exact production callbacks without booting the daemon. Git and
// filesystem operations are real; only runtime publication and config storage
// are bounded to this test's temporary home.
function fixture(t, options) {
  options = options || {};
  var root = fs.realpathSync(fs.mkdtempSync(path.join(temporaryHome, "case-")));
  var base = path.join(root, "projects");
  fs.mkdirSync(base);
  var calls = [];
  var published = [];
  var actor = { id: "requester", role: "admin", username: "requester" };
  var context = {
    fs: fs, path: path, console: { log: function () {} }, setTimeout: setTimeout, clearTimeout: clearTimeout,
    config: { projectsDir: base, projects: [] }, REAL_HOME: root, generateSlug: generateSlug,
    usersModule: { isMultiUser: function () { return true; }, findUserById: function (id) { return id === actor.id ? actor : null; }, getAllUsers: function () { return [actor, { id: "other", role: "user" }]; } },
    projectLogContext: { createProjectKnowledgeId: function () { return "creation-test"; } },
    projectRuntimeOptions: function () { return {}; },
    saveConfig: function (value) { calls.push("save"); fs.writeFileSync(path.join(root, "config.json"), JSON.stringify(value)); },
    syncClayrc: function () {}, grantProjectAccess: function () { calls.push("acl"); },
    osUsersMod: { resolveOsUserInfo: function () { throw new Error("Not mapped"); }, wrapSpawnAsUser: function (command, args, opts) { return { command: command, args: args, options: opts }; } },
    relay: { addProject: function (target, slug, title, icon, owner) { published.push({ path: target, slug: slug, ownerId: owner }); }, getProjects: function () { return published; }, broadcastAll: function () {} },
    require: function (name) {
      if (name !== "child_process") return daemonRequire(name);
      return Object.assign({}, childProcess, {
        execFileSync: function (command, args, opts) {
          calls.push(command + " " + args[0]);
          if (options.failInit) throw new Error("Injected initialization failure");
          return childProcess.execFileSync(command, args, Object.assign({}, opts, { stdio: "pipe" }));
        },
        spawn: function (command, args, opts) {
          calls.push(command + " " + args[0]);
          if (options.spawn) return options.spawn(command, args, opts);
          return childProcess.spawn(command, args, opts);
        },
      });
    },
  };
  function callback(name, next) {
    var start = daemonSource.indexOf("function", daemonSource.indexOf("  " + name + ":"));
    var end = daemonSource.indexOf("  " + next + ":", start);
    return vm.runInNewContext("(" + daemonSource.substring(start, end).trim().replace(/,$/, "") + ")", context);
  }
  var create = callback("onCreateProject", "onCloneProject");
  var clone = callback("onCloneProject", "onRemoveProject");
  return {
    root: root, base: base, calls: calls, published: published, context: context,
    create: function (name) { return create(name, actor); },
    clone: function (url) { return new Promise(function (resolve) { clone(url, actor, resolve); }); },
  };
}

function sentinel(target) { fs.mkdirSync(target, { recursive: true }); fs.writeFileSync(path.join(target, "sentinel.txt"), "existing-private-data"); }
function intact(f, target, before) {
  assert.equal(fs.readFileSync(path.join(target, "sentinel.txt"), "utf8"), "existing-private-data");
  assert.equal(fs.existsSync(path.join(target, ".git")), false);
  assert.deepEqual(f.calls, []);
  assert.deepEqual(f.published, []);
  assert.equal(JSON.stringify(f.context.config), before);
}

["create", "clone"].forEach(function (method) {
  ["existing directory", "existing symlink", "dangling symlink", "registered path with another slug", "nested foreign root", "canonical foreign root alias", "registered descendant"].forEach(function (scenario) {
    test(method + " rejects " + scenario + " without initializing, reassigning or deleting existing data", async function (t) {
      var f = fixture(t);
      var target = path.join(f.base, "victim");
      var data = target;
      if (scenario === "existing symlink" || scenario === "dangling symlink") {
        data = path.join(f.root, "private-data");
        if (scenario === "existing symlink") sentinel(data);
        fs.symlinkSync(data, target);
      } else if (scenario === "nested foreign root" || scenario === "canonical foreign root alias") {
        var foreign = path.join(f.root, "foreign");
        sentinel(foreign);
        fs.mkdirSync(path.join(foreign, "nested"));
        f.context.config.projects = [{ slug: "unrelated-slug", path: foreign, ownerId: "other", visibility: "private" }];
        if (scenario === "canonical foreign root alias") {
          var alias = path.join(f.root, "alias"); fs.symlinkSync(foreign, alias);
          f.context.config.projectsDir = path.join(alias, "nested");
        } else f.context.config.projectsDir = path.join(foreign, "nested");
        data = foreign;
      } else {
        sentinel(target);
        if (scenario === "registered path with another slug") f.context.config.projects = [{ slug: "different-slug", path: target, ownerId: "other", visibility: "private" }];
        if (scenario === "registered descendant") f.context.config.projects = [{ slug: "child-slug", path: path.join(target, "child"), ownerId: "other", visibility: "private" }];
      }
      var before = JSON.stringify(f.context.config);
      var beforeStat = scenario === "dangling symlink" ? null : fs.statSync(data);
      var result = method === "create" ? f.create("victim") : await f.clone("/unavailable/victim.git");
      assert.equal(result.ok, false);
      if (scenario === "dangling symlink") { assert.equal(fs.lstatSync(target).isSymbolicLink(), true); assert.deepEqual(f.calls, []); assert.equal(JSON.stringify(f.context.config), before); }
      else {
        intact(f, data, before);
        var afterStat = fs.statSync(data);
        ["uid", "gid", "mode", "ino", "dev", "mtimeMs"].forEach(function (field) { assert.equal(afterStat[field], beforeStat[field], "Existing directory metadata changed: " + field); });
      }
      if (scenario === "existing symlink") assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
      if (scenario.indexOf("foreign root") !== -1) assert.equal(fs.existsSync(path.join(f.context.config.projectsDir, "victim")), false);
    });
  });
});

test("production create callback initializes and registers a genuinely fresh directory", function (t) {
  var f = fixture(t);
  var result = f.create("fresh");
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(f.base, "fresh", ".git")), true);
  assert.equal(f.context.config.projects[0].ownerId, "requester");
  assert.equal(f.published.length, 1);
  assert.deepEqual(f.calls, ["git init", "save"]);
});

test("failed initialization cleans only the directory claimed by this attempt", function (t) {
  var f = fixture(t, { failInit: true });
  var existing = path.join(f.base, "existing"); sentinel(existing);
  assert.equal(f.create("new").ok, false);
  assert.equal(fs.existsSync(path.join(f.base, "new")), false);
  assert.equal(fs.readFileSync(path.join(existing, "sentinel.txt"), "utf8"), "existing-private-data");
  assert.equal(f.published.length, 0);
});

test("production clone callback reserves its fresh destination before real local Git clone", async function (t) {
  var f = fixture(t);
  var source = path.join(f.root, "source.git");
  childProcess.execFileSync("git", ["init", "--bare", source], { stdio: "pipe" });
  var result = await f.clone(source);
  assert.equal(result.ok, true);
  assert.equal(fs.existsSync(path.join(f.base, "source", ".git")), true);
  assert.equal(f.context.config.projects[0].ownerId, "requester");
  assert.deepEqual(f.calls, ["git clone", "save"]);
  assert.equal(f.published.length, 1);
});

test("failed real clone removes only its reserved target", async function (t) {
  var f = fixture(t);
  var existing = path.join(f.base, "existing"); sentinel(existing);
  var result = await f.clone(path.join(f.root, "missing.git"));
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(f.base, "missing")), false);
  assert.equal(fs.readFileSync(path.join(existing, "sentinel.txt"), "utf8"), "existing-private-data");
  assert.equal(f.published.length, 0);
});

test("atomic competing claims reject the loser and cleanup refuses a replaced directory", function (t) {
  var f = fixture(t);
  var options = { baseDir: f.base, slug: "race", projects: [], userId: "requester" };
  var claim = claimDirectory(options);
  assert.throws(function () { claimDirectory(options); }, /EEXIST/);
  fs.renameSync(claim.path, path.join(f.base, "original-claim"));
  sentinel(claim.path);
  assert.equal(claim.cleanup(), false);
  assert.equal(fs.readFileSync(path.join(claim.path, "sentinel.txt"), "utf8"), "existing-private-data");
});

test("ambiguous recovery copy explains verified operator remediation while valid-owner copy is preserved", function () {
  var overview = require("../lib/project-admin-overview");
  var metadata = { slug: "private", title: "Private", ownerName: "Ownership needs recovery", visibility: "private", ownershipRecovery: true };
  var html = overview.page(metadata, []);
  assert.match(html, /server operator/);
  assert.match(html, /OS UID and real home\/project mapping/);
  assert.match(html, /administrator status cannot claim this project/);
  assert.doesNotMatch(html, /Ask the owner|Only the project owner can change/);
  assert.doesNotMatch(html, /id="messages"|id="input"|<select/);
  var valid = overview.page(Object.assign({}, metadata, { ownershipRecovery: false, ownerName: "Alice" }), []);
  assert.match(valid, /Ask the owner to share project access/);
  assert.match(valid, /Only the project owner can change ownership/);
  assert.match(valid, /Alice/);
});

test("clone ignores a late process error after successful registration", async function (t) {
  var EventEmitter = require("node:events");
  var proc;
  var f = fixture(t, { spawn: function () {
    proc = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = function () {};
    process.nextTick(function () { proc.emit("close", 0); });
    return proc;
  } });
  var result = await f.clone("/mock/fresh.git");
  assert.equal(result.ok, true);
  fs.writeFileSync(path.join(f.base, "fresh", "sentinel.txt"), "registered-data");
  proc.emit("error", new Error("Late process error"));
  assert.equal(fs.readFileSync(path.join(f.base, "fresh", "sentinel.txt"), "utf8"), "registered-data");
  assert.equal(f.published.length, 1);
});

test("clone failure cannot delete or register a destination replaced during the process", async function (t) {
  var EventEmitter = require("node:events");
  var f = fixture(t, { spawn: function (command, args) {
    var target = args[2];
    fs.renameSync(target, target + "-original");
    sentinel(target);
    var proc = new EventEmitter(); proc.stderr = new EventEmitter(); proc.kill = function () {};
    process.nextTick(function () { proc.emit("error", new Error("Injected process error")); proc.emit("close", 1); });
    return proc;
  } });
  var result = await f.clone("/mock/replaced.git");
  assert.equal(result.ok, false);
  assert.equal(fs.readFileSync(path.join(f.base, "replaced", "sentinel.txt"), "utf8"), "existing-private-data");
  assert.equal(f.context.config.projects.length, 0);
  assert.equal(f.published.length, 0);
});
