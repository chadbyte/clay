var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var path = require("path");
var vm = require("vm");
var buildStartupProjects = require("../lib/startup-projects").buildStartupProjects;
var cliSource = fs.readFileSync(path.join(__dirname, "../bin/cli.js"), "utf8");

function savedProject() {
  return {
    path: "/srv/project", slug: "project-2", title: "Current title", addedAt: 123,
    ownerId: "owner", visibility: "private", allowedUsers: ["member"],
    worktreeAllowedUsers: { "project-2--review": ["reviewer"] },
    projectKnowledgeId: "stable-knowledge", sessionVisibilityDefault: "shared",
    futureSetting: { enabled: true },
  };
}

function generateSlug(projectPath, used) {
  var slug = path.basename(projectPath);
  var next = slug;
  var i = 2;
  while (used.indexOf(next) !== -1) next = slug + "-" + i++;
  return next;
}

function options(available) {
  return { cwd: "/srv/launcher", addCwd: false,
    existsSync: function () { return available; }, generateSlug: generateSlug };
}

// Execute each real CLI configuration builder, stopping before process launch.
async function startup(name, config, recent, available) {
  var start = cliSource.indexOf("async function " + name + "(");
  var save = name === "restartDaemonFromConfig" ? "saveConfig(newConfig);" : "saveConfig(config);";
  var end = cliSource.indexOf(save, start) + save.length;
  assert.ok(start >= 0 && end > start);
  var result;
  var context = {
    buildStartupProjects: buildStartupProjects,
    getLocalIP: function () { return "127.0.0.1"; }, useHttps: false,
    isPortFree: async function () { return true; }, port: 3000, host: "127.0.0.1",
    loadConfig: function () { return config; },
    loadClayrc: function () { return { recentProjects: recent }; },
    cwd: "/srv/launcher", generateSlug: generateSlug,
    fs: { existsSync: function (p) { return available && p !== "/srv/launcher"; } },
    cliPin: null, debugMode: false, headlessMode: true, keepAwake: false,
    dangerouslySkipPermissions: false, osUsersMode: true,
    clearStaleConfig: function () {}, ensureConfigDir: function () {},
    saveConfig: function (value) { result = JSON.parse(JSON.stringify(value)); },
  };
  vm.createContext(context);
  vm.runInContext(cliSource.slice(start, end) + "\n}", context);
  if (name === "forkDaemon") await context[name]("multi", false, recent, false, true);
  else if (name === "devMode") await context[name]("multi", false, null, true);
  else await context[name]();
  return result;
}

["forkDaemon", "devMode", "restartDaemonFromConfig"].forEach(function (name) {
  test(name + " preserves ownership, shares and identity through unavailable/available restarts", async function () {
    var project = savedProject();
    var config = { projects: [project], osUsers: true, setupCompleted: true, customSetting: "keep" };
    var before = JSON.stringify(config);
    var missing = await startup(name, config, [], false);
    assert.deepEqual(missing.projects, [project]);
    assert.equal(missing.customSetting, "keep");
    assert.equal(JSON.stringify(config), before);
    var restored = await startup(name, missing, [{ path: project.path, title: "Stale title" }], true);
    assert.deepEqual(restored.projects, [project]);
  });
});

test("saved project order and slugs survive recent-list reordering and collisions", function () {
  var first = savedProject();
  var second = { path: "/other/project", slug: "project", ownerId: "other-owner" };
  var result = buildStartupProjects({ projects: [first, second] }, [second, first, { path: "/new/project" }], options(true));
  assert.deepEqual(result.slice(0, 2), [first, second]);
  assert.equal(result[2].slug, "project-3");
});

test("revoked grants are not recovered from stale recent entries", function () {
  var project = savedProject();
  delete project.ownerId;
  project.allowedUsers = [];
  delete project.worktreeAllowedUsers;
  assert.deepEqual(buildStartupProjects({ projects: [project] }, [savedProject()], options(true)), [project]);
});

test("explicit removal survives stale recent entries, including the startup cwd", function () {
  var project = savedProject();
  var config = { projects: [], removedProjects: [{ path: project.path }] };
  var opts = options(true);
  opts.cwd = project.path;
  opts.addCwd = true;
  assert.deepEqual(buildStartupProjects(config, [project], opts), []);
  // An explicit re-add already persisted by the daemon takes precedence.
  config.projects.push(project);
  assert.deepEqual(buildStartupProjects(config, [project], opts), [project]);
});

test("new recent projects import display fields only and unavailable new paths are skipped", function () {
  var project = savedProject();
  assert.deepEqual(buildStartupProjects(null, [project], options(false)), []);
  var result = buildStartupProjects(null, [project], options(true));
  assert.equal(result.length, 1);
  assert.equal(result[0].title, project.title);
  assert.equal(result[0].ownerId, undefined);
  assert.equal(result[0].allowedUsers, undefined);
  assert.equal(result[0].worktreeAllowedUsers, undefined);
});

test("daemon runtime skips unavailable projects without deleting saved records", function () {
  var source = fs.readFileSync(path.join(__dirname, "../lib/daemon.js"), "utf8");
  var start = source.indexOf("var projects = config.projects || [];");
  var end = source.indexOf("// Migrate legacy mates", start);
  var project = savedProject();
  var config = { projects: [project] };
  var loaded = [];
  var available = false;
  var context = {
    config: config, fs: { existsSync: function () { return available; } },
    console: { log: function () {} },
    relay: { addProject: function (p, slug, title, icon, owner) { loaded.push({ path: p, owner: owner }); } },
    projectRuntimeOptions: function () { return {}; }, registerProjectWorktrees: function () {},
  };
  vm.createContext(context);
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(loaded, []);
  assert.deepEqual(config.projects, [project]);
  available = true;
  vm.runInContext(source.slice(start, end), context);
  assert.deepEqual(loaded, [{ path: project.path, owner: project.ownerId }]);
});
