var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("fs");
var os = require("os");
var path = require("path");
var { execFileSync, spawnSync } = require("child_process");

var helper = path.join(__dirname, "..", "scripts", "release-sync.js");

function git(cwd, args) {
  return execFileSync("git", args, { cwd: cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function gitMayFail(cwd, args) {
  try {
    return { status: 0, stdout: git(cwd, args) };
  } catch (err) {
    return { status: typeof err.status === "number" ? err.status : 1, stdout: err.stdout ? String(err.stdout) : "" };
  }
}

function runHelper(cwd, mode, source) {
  return spawnSync(process.execPath, [helper, mode, source], { cwd: cwd, encoding: "utf8" });
}

function createRepo(t) {
  var repo = fs.mkdtempSync(path.join(os.tmpdir(), "clay-release-sync-"));
  t.after(function () { fs.rmSync(repo, { recursive: true, force: true }); });
  git(repo, ["init", "-q", "-b", "main"]);
  git(repo, ["config", "user.name", "Release Test"]);
  git(repo, ["config", "user.email", "release@example.test"]);
  writePackage(repo, { version: "1.0.0", license: "MIT", alias: true, exec: true });
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "base\n");
  fs.writeFileSync(path.join(repo, "conflict.txt"), "base\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "base"]);
  git(repo, ["branch", "release"]);
  return repo;
}

function writePackage(repo, options) {
  var packageJson = {
    name: "clay-server",
    version: options.version,
    license: options.license,
    bin: { "clay-server": "bin/cli.js" },
    files: ["bin/", "lib/"],
    dependencies: { clay: "1.0.0" },
    devDependencies: {}
  };
  var lock = {
    name: "clay-server",
    version: options.lockVersion || options.version,
    lockfileVersion: 3,
    requires: true,
    packages: { "": {
      name: "clay-server",
      version: options.lockVersion || options.version,
      license: options.license,
      bin: { "clay-server": "bin/cli.js" },
      files: ["bin/", "lib/"],
      dependencies: { clay: "1.0.0" },
      devDependencies: {}
    }, "node_modules/clay": { version: "1.0.0" } }
  };
  if (options.alias) {
    packageJson.bin["claude-relay"] = "bin/claude-relay.js";
    lock.packages[""].bin["claude-relay"] = "bin/claude-relay.js";
  }
  if (options.exec) {
    packageJson.devDependencies["@semantic-release/exec"] = "^7.1.0";
    lock.packages[""].devDependencies["@semantic-release/exec"] = "^7.1.0";
    lock.packages["node_modules/@semantic-release/exec"] = { version: "7.1.0" };
  }
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify(packageJson, null, 2) + "\n");
  fs.writeFileSync(path.join(repo, "package-lock.json"), JSON.stringify(lock, null, 2) + "\n");
}

function makeMainAgpl(repo, version) {
  git(repo, ["checkout", "-q", "main"]);
  writePackage(repo, { version: version, license: "AGPL-3.0-only", alias: false, exec: false });
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "main changelog\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "main policy"]);
}

function makeReleaseVersion(repo, version, lockVersion) {
  git(repo, ["checkout", "-q", "release"]);
  writePackage(repo, { version: version, lockVersion: lockVersion, license: "MIT", alias: true, exec: true });
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "release changelog\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-qm", "release version"]);
}

test("release-to-main preserves main package policy and backports release version fields", function (t) {
  var repo = createRepo(t);
  makeMainAgpl(repo, "2.0.0-beta.1");
  makeReleaseVersion(repo, "2.0.0", "1.9.0");
  git(repo, ["checkout", "-q", "main"]);
  var result = runHelper(repo, "release-to-main", "release");
  assert.equal(result.status, 0, result.stderr);
  var pkg = JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8"));
  var lock = JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8"));
  assert.equal(pkg.version, "2.0.0");
  assert.equal(pkg.license, "AGPL-3.0-only");
  assert.equal(pkg.bin["claude-relay"], undefined);
  assert.equal(pkg.devDependencies["@semantic-release/exec"], undefined);
  assert.equal(lock.version, "2.0.0");
  assert.equal(lock.packages[""].version, "2.0.0");
  assert.equal(lock.packages[""].license, "AGPL-3.0-only");
  assert.equal(lock.packages["node_modules/clay"].version, "1.0.0");
  assert.equal(lock.packages["node_modules/@semantic-release/exec"], undefined);
  assert.equal(fs.readFileSync(path.join(repo, "CHANGELOG.md"), "utf8"), "release changelog\n");
  assert.match(git(repo, ["log", "-1", "--format=%s"]), /sync release metadata/);
});

test("promotion makes main contents canonical on release", function (t) {
  var repo = createRepo(t);
  makeMainAgpl(repo, "3.0.0");
  git(repo, ["checkout", "-q", "release"]);
  var result = runHelper(repo, "promote", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, "package.json"), "utf8")), JSON.parse(git(repo, ["show", "main:package.json"])));
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8")), JSON.parse(git(repo, ["show", "main:package-lock.json"])));
  assert.equal(fs.readFileSync(path.join(repo, "CHANGELOG.md"), "utf8"), git(repo, ["show", "main:CHANGELOG.md"]));
  assert.match(git(repo, ["log", "-1", "--format=%s"]), /promote main/);
});

test("empty divergent branches still finalize the MERGE_HEAD merge", function (t) {
  var repo = createRepo(t);
  git(repo, ["checkout", "-q", "main"]);
  git(repo, ["commit", "--allow-empty", "-qm", "main empty"]);
  git(repo, ["checkout", "-q", "release"]);
  git(repo, ["commit", "--allow-empty", "-qm", "release empty"]);
  var result = runHelper(repo, "promote", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(repo, ["rev-list", "--parents", "-1", "HEAD"]).trim().split(" ").length, 3);
});

test("an already merged source is a no-op", function (t) {
  var repo = createRepo(t);
  var before = git(repo, ["rev-parse", "HEAD"]).trim();
  var result = runHelper(repo, "release-to-main", "main");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
});

test("unrelated merge conflicts abort without an automatic commit", function (t) {
  var repo = createRepo(t);
  git(repo, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(repo, "conflict.txt"), "main\n");
  git(repo, ["add", "conflict.txt"]);
  git(repo, ["commit", "-qm", "main conflict"]);
  git(repo, ["checkout", "-q", "release"]);
  fs.writeFileSync(path.join(repo, "conflict.txt"), "release\n");
  git(repo, ["add", "conflict.txt"]);
  git(repo, ["commit", "-qm", "release conflict"]);
  git(repo, ["checkout", "-q", "main"]);
  var before = git(repo, ["rev-parse", "HEAD"]).trim();
  var result = runHelper(repo, "release-to-main", "release");
  assert.notEqual(result.status, 0);
  assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
  assert.equal(fs.readFileSync(path.join(repo, "conflict.txt"), "utf8"), "main\n");
});

test("promotion also aborts on unrelated conflicts", function (t) {
  var repo = createRepo(t);
  git(repo, ["checkout", "-q", "main"]);
  fs.writeFileSync(path.join(repo, "conflict.txt"), "main\n");
  git(repo, ["add", "conflict.txt"]);
  git(repo, ["commit", "-qm", "main conflict"]);
  git(repo, ["checkout", "-q", "release"]);
  fs.writeFileSync(path.join(repo, "conflict.txt"), "release\n");
  git(repo, ["add", "conflict.txt"]);
  git(repo, ["commit", "-qm", "release conflict"]);
  git(repo, ["checkout", "-q", "release"]);
  var before = git(repo, ["rev-parse", "HEAD"]).trim();
  var result = runHelper(repo, "promote", "main");
  assert.notEqual(result.status, 0);
  assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
  assert.equal(fs.readFileSync(path.join(repo, "conflict.txt"), "utf8"), "release\n");
});

test("invalid source metadata fails before merge", function (t) {
  var repo = createRepo(t);
  git(repo, ["checkout", "-q", "release"]);
  fs.writeFileSync(path.join(repo, "package.json"), "not json\n");
  git(repo, ["add", "package.json"]);
  git(repo, ["commit", "-qm", "invalid source"]);
  git(repo, ["checkout", "-q", "main"]);
  var before = git(repo, ["rev-parse", "HEAD"]).trim();
  var result = runHelper(repo, "release-to-main", "release");
  assert.notEqual(result.status, 0);
  assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
  assert.notEqual(gitMayFail(repo, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status, 0);
});

test("promotion workflow copies helper before checking out release", function () {
  var workflow = fs.readFileSync(path.join(__dirname, "..", ".github", "workflows", "release.yml"), "utf8");
  var copy = workflow.indexOf('git show main:scripts/release-sync.js > "$RUNNER_TEMP/release-sync.js"');
  var checkout = workflow.indexOf("git checkout release", copy);
  var run = workflow.indexOf('node "$RUNNER_TEMP/release-sync.js" promote main', checkout);
  assert.notEqual(copy, -1);
  assert.ok(copy < checkout && checkout < run);
});

test("post-merge commit failure aborts and restores a clean HEAD", function (t) {
  var repo = createRepo(t);
  makeMainAgpl(repo, "3.0.0");
  git(repo, ["checkout", "-q", "release"]);
  var before = git(repo, ["rev-parse", "HEAD"]).trim();
  var hook = path.join(repo, ".git", "hooks", "pre-commit");
  fs.writeFileSync(hook, "#!/bin/sh\nexit 1\n");
  fs.chmodSync(hook, 0o755);
  t.after(function () { fs.rmSync(hook, { force: true }); });
  var result = runHelper(repo, "promote", "main");
  assert.notEqual(result.status, 0);
  assert.equal(git(repo, ["rev-parse", "HEAD"]).trim(), before);
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
  assert.notEqual(gitMayFail(repo, ["rev-parse", "-q", "--verify", "MERGE_HEAD"]).status, 0);
});

test("release preparation commits lock metadata and permits clean back-sync", async function (t) {
  var repo = createRepo(t);
  var remote = fs.mkdtempSync(path.join(os.tmpdir(), "clay-release-remote-"));
  t.after(function () { fs.rmSync(remote, { recursive: true, force: true }); });
  git(remote, ["init", "--bare", "-q"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["checkout", "-q", "release"]);
  git(repo, ["push", "-q", "origin", "release"]);
  execFileSync("npm", ["version", "2.0.0", "--no-git-tag-version", "--ignore-scripts"], { cwd: repo, stdio: "pipe" });
  fs.writeFileSync(path.join(repo, "CHANGELOG.md"), "release changelog\n");
  var config = require("../release.config");
  var plugin = config.plugins.find(function (item) { return Array.isArray(item) && item[0] === "@semantic-release/git"; })[1];
  await require("@semantic-release/git/lib/prepare")(plugin, {
    cwd: repo, env: Object.assign({}, process.env, { GIT_AUTHOR_NAME: "Release Test", GIT_AUTHOR_EMAIL: "release@example.test", GIT_COMMITTER_NAME: "Release Test", GIT_COMMITTER_EMAIL: "release@example.test" }),
    branch: { name: "release" }, options: { repositoryUrl: remote }, lastRelease: { version: "1.0.0" },
    nextRelease: { version: "2.0.0", gitTag: "v2.0.0", notes: "Test release" }, logger: { log: function () {} }
  });
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
  assert.equal(git(repo, ["log", "-1", "--format=%s"]).trim(), "chore(release): publish 2.0.0");
  var lock = JSON.parse(git(repo, ["show", "HEAD:package-lock.json"]));
  assert.equal(lock.version, "2.0.0");
  assert.equal(lock.packages[""].version, "2.0.0");
  git(repo, ["checkout", "-q", "main"]);
  var result = runHelper(repo, "release-to-main", "release");
  assert.equal(result.status, 0, result.stderr);
  assert.equal(git(repo, ["status", "--porcelain"]).trim(), "");
  assert.equal(JSON.parse(fs.readFileSync(path.join(repo, "package-lock.json"), "utf8")).version, "2.0.0");
});

test("release sync refuses unrelated dirty files without discarding them", function (t) {
  var repo = createRepo(t);
  fs.writeFileSync(path.join(repo, "conflict.txt"), "unsaved work\n");
  var result = runHelper(repo, "release-to-main", "release");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /clean worktree/);
  assert.equal(fs.readFileSync(path.join(repo, "conflict.txt"), "utf8"), "unsaved work\n");
});
