var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var execFileSync = require("node:child_process").execFileSync;

var skills = require("../lib/yoke/skill-discovery");

var MAPPED_UID = 65534;
var OTHER_UID = 65533;
var privilegedLinux = process.platform === "linux" && process.getuid() === 0;

function fixture(t) {
  var root = fs.mkdtempSync(path.join(os.tmpdir(), "clay-bridge-mode-"));
  t.after(function () { fs.rmSync(root, { recursive: true, force: true }); });
  fs.chmodSync(root, 0o711);
  var homeDir = path.join(root, "home");
  var source = path.join(root, "source");
  fs.mkdirSync(homeDir, { mode: 0o711 });
  fs.mkdirSync(source, { mode: 0o755 });
  ["kept", "excluded"].forEach(function (name) {
    var dir = path.join(source, name);
    fs.mkdirSync(dir, { mode: 0o755 });
    fs.writeFileSync(path.join(dir, "SKILL.md"), name, { mode: 0o644 });
  });
  return { homeDir: homeDir, source: source, name: "shared-project-test" };
}

function withPrivateUmask(create) {
  var previous = process.umask(0o077);
  try { return create(); } finally { process.umask(previous); }
}

function manifestPath(plugin) {
  assert.ok(plugin, "the bridge was prepared");
  return path.join(plugin, ".claude-plugin", "plugin.json");
}

function accessAs(uid, file, method) {
  return execFileSync(process.execPath, ["-e", [
    "const fs = require('node:fs');",
    "if (process.getuid() !== Number(process.argv[1])) process.exit(2);",
    "try {",
    "  const method = process.argv[3];",
    "  const file = process.argv[2];",
    "  const output = method === 'list' ? fs.readdirSync(file).join(',') : fs.readFileSync(file, 'utf8');",
    "  process.stdout.write(output);",
    "} catch (error) { process.stdout.write(error.code); }",
  ].join("\n"), String(uid), file, method || "read"], { cwd: "/", uid: uid, gid: uid, encoding: "utf8" });
}

test("a same-user Claude skill bridge keeps its manifest private", function (t) {
  var opts = fixture(t);
  var file = manifestPath(withPrivateUmask(function () { return skills.ensureClaudeCodexPlugin(opts); }));
  if (process.platform !== "win32") assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).name, opts.name);
});

test("a mapped user can read a new bridge created under umask 077", { skip: !privilegedLinux }, function (t) {
  var opts = Object.assign(fixture(t), { readerUid: MAPPED_UID });
  var plugin = withPrivateUmask(function () { return skills.ensureClaudeCodexPlugin(opts); });
  var file = manifestPath(plugin);
  assert.equal(JSON.parse(accessAs(MAPPED_UID, file)).name, opts.name);
  assert.equal(accessAs(MAPPED_UID, path.join(plugin, "skills", "kept", "SKILL.md")), "kept");
  assert.equal(accessAs(MAPPED_UID, path.join(opts.homeDir, ".clay"), "list"), "EACCES", "parent access is traversal only");
  assert.equal(accessAs(OTHER_UID, file), "EACCES");
  assert.equal(fs.statSync(file).uid, 0, "the daemon retains ownership");
});

test("an existing root-owned 0600 manifest and 0700 parents are repaired in place", { skip: !privilegedLinux }, function (t) {
  var opts = fixture(t);
  var plugin = withPrivateUmask(function () { return skills.ensureClaudeCodexPlugin(opts); });
  var file = manifestPath(plugin);
  var before = fs.statSync(file);
  var original = fs.readFileSync(file, "utf8");
  assert.equal(before.mode & 0o777, 0o600);
  assert.equal(accessAs(MAPPED_UID, file), "EACCES");
  var clay = path.join(opts.homeDir, ".clay");
  var privateSibling = path.join(clay, "private.txt");
  fs.writeFileSync(privateSibling, "private", { mode: 0o600 });
  var publicSibling = path.join(clay, "public.txt");
  fs.writeFileSync(publicSibling, "public", { mode: 0o644 });
  execFileSync("setfacl", ["-m", "u:" + OTHER_UID + ":--x,m::---", clay]);
  assert.equal(skills.ensureClaudeCodexPlugin(Object.assign(opts, { readerUid: MAPPED_UID })), plugin);
  assert.equal(fs.statSync(file).ino, before.ino);
  assert.equal(accessAs(MAPPED_UID, file), original);
  assert.equal(accessAs(MAPPED_UID, privateSibling), "EACCES");
  assert.equal(accessAs(OTHER_UID, file), "EACCES");
  assert.equal(accessAs(OTHER_UID, publicSibling), "EACCES", "the ACL mask does not activate an unrelated entry");
});

test("filtered bridges give the mapped user the manifest and only the retained skill entries", { skip: !privilegedLinux }, function (t) {
  var opts = Object.assign(fixture(t), { exclude: ["excluded"] });
  var plugin = withPrivateUmask(function () { return skills.ensureFilteredClaudePlugin(opts); });
  var file = manifestPath(plugin);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(accessAs(MAPPED_UID, file), "EACCES");
  opts.readerUid = MAPPED_UID;
  assert.equal(withPrivateUmask(function () { return skills.ensureFilteredClaudePlugin(opts); }), plugin);
  assert.match(JSON.parse(accessAs(MAPPED_UID, file)).name, /-without-/);
  assert.equal(accessAs(MAPPED_UID, path.join(plugin, "skills"), "list"), "kept");
  assert.equal(accessAs(MAPPED_UID, path.join(plugin, "skills", "kept", "SKILL.md")), "kept");
  assert.equal(accessAs(OTHER_UID, file), "EACCES");
  assert.equal(accessAs(OTHER_UID, path.join(plugin, "skills"), "list"), "EACCES");
});

test("the Claude worker query passes its mapped UID to both bridge variants", { skip: !privilegedLinux }, function (t) {
  var opts = fixture(t);
  var codexSkills = path.join(opts.homeDir, ".codex", "skills");
  fs.mkdirSync(codexSkills, { recursive: true });
  var build = require("../lib/yoke/adapters/claude").contractTestKit.buildWorkerQueryOptions;
  var query = withPrivateUmask(function () {
    return build({ skillOptions: { excludeSkills: ["excluded"] }, env: {} }, {}, opts.homeDir, { home: opts.homeDir, uid: MAPPED_UID });
  });
  var names = query.plugins.map(function (plugin) {
    return JSON.parse(accessAs(MAPPED_UID, manifestPath(plugin.path))).name;
  });
  assert.ok(names.includes("codex"));
  assert.ok(names.some(function (name) { return /^shared-clay-builtin-.*-without-/.test(name); }));
});
