var assert = require("node:assert/strict");
var crypto = require("node:crypto");
var fs = require("node:fs");
var os = require("node:os");
var path = require("node:path");
var execFileSync = require("node:child_process").execFileSync;
var osUsers = require("../../lib/os-users");
var gitCli = require("../../lib/git-cli");
var worktree = require("../../lib/worktree");

function run(command, args, options) {
  return execFileSync(command, args || [], Object.assign({
    encoding: "utf8",
    stdio: "pipe",
  }, options || {}));
}

function requireCommand(command) {
  try {
    run("sh", ["-c", "command -v \"$1\" >/dev/null 2>&1", "sh", command]);
  } catch (e) {
    throw new Error("Required command is unavailable: " + command);
  }
}

function groupId(group) {
  var output = run("getent", ["group", group]).trim();
  var parts = output.split(":");
  if (parts.length < 3) throw new Error("Unexpected group record for " + group);
  return parseInt(parts[2], 10);
}

function assertOwnedTree(targetPath, uid, label) {
  var pending = [targetPath];
  while (pending.length > 0) {
    var current = pending.pop();
    var stat = fs.lstatSync(current);
    assert.equal(stat.uid, uid, label + " must be owned by uid " + uid + ": " + current);
    if (!stat.isDirectory()) continue;
    var entries = fs.readdirSync(current);
    for (var i = 0; i < entries.length; i++) pending.push(path.join(current, entries[i]));
  }
}

function expectNoSupplementaryAccess(targetPath, identity) {
  var script = "require('fs').statSync(" + JSON.stringify(targetPath) + ")";
  var failed = false;
  try {
    run("setpriv", [
      "--reuid", String(identity.uid),
      "--regid", String(identity.gid),
      "--clear-groups", "--", process.execPath, "-e", script,
    ], { env: Object.assign({}, process.env, { HOME: identity.home, USER: identity.user, LOGNAME: identity.user }) });
  } catch (e) {
    failed = true;
  }
  assert.equal(failed, true, "Target user must not reach the repository without supplementary groups");
}

function cleanup(state) {
  var errors = [];
  if (state.identity && state.repo && fs.existsSync(state.repo)) {
    try { worktree.removeWorktree(state.repo, state.worktreeName, state.identity); } catch (e) {}
  }
  if (state.userCreated) {
    try { run("userdel", [state.user]); } catch (e) { errors.push("userdel: " + e.message); }
  }
  if (state.supplementaryGroupCreated) {
    try { run("groupdel", [state.supplementaryGroup]); } catch (e) { errors.push("groupdel supplementary: " + e.message); }
  }
  if (state.primaryGroupCreated) {
    try { run("groupdel", [state.primaryGroup]); } catch (e) { errors.push("groupdel primary: " + e.message); }
  }
  try { fs.rmSync(state.root, { recursive: true, force: true }); } catch (e) { errors.push("remove fixture root: " + e.message); }
  return errors;
}

function execute(state) {
  if (process.platform !== "linux") throw new Error("This privileged integration fixture requires Linux");
  if (typeof process.getuid !== "function" || process.getuid() !== 0) {
    throw new Error("This privileged integration fixture must run as root (invoke it with sudo)");
  }

  var commands = ["git", "getent", "groupadd", "groupdel", "setpriv", "useradd", "userdel"];
  for (var i = 0; i < commands.length; i++) requireCommand(commands[i]);

  run("groupadd", [state.primaryGroup]);
  state.primaryGroupCreated = true;
  run("groupadd", [state.supplementaryGroup]);
  state.supplementaryGroupCreated = true;

  var primaryGid = groupId(state.primaryGroup);
  var supplementaryGid = groupId(state.supplementaryGroup);
  var home = path.join(state.root, "home");
  var shared = path.join(state.root, "supplementary-only");
  state.repo = path.join(shared, "repository");
  fs.mkdirSync(home);
  fs.mkdirSync(shared);

  run("useradd", [
    "--no-create-home", "--home-dir", home, "--shell", "/bin/sh",
    "--gid", state.primaryGroup, "--groups", state.supplementaryGroup, state.user,
  ]);
  state.userCreated = true;
  state.identity = osUsers.resolveOsUserInfo(state.user);
  assert.notEqual(state.identity.uid, 0);
  assert.equal(state.identity.gid, primaryGid);

  fs.chownSync(home, state.identity.uid, primaryGid);
  fs.chmodSync(home, 0o700);
  fs.chownSync(shared, 0, supplementaryGid);
  fs.chmodSync(shared, 0o770);
  fs.mkdirSync(state.repo);
  fs.chownSync(state.repo, state.identity.uid, primaryGid);
  fs.chmodSync(state.repo, 0o750);

  gitCli.runGitSync(state.repo, ["init", "-q", "--initial-branch=main"], null, state.identity);
  gitCli.runGitSync(state.repo, ["config", "user.name", "Clay Identity Test"], null, state.identity);
  gitCli.runGitSync(state.repo, ["config", "user.email", "identity@example.test"], null, state.identity);
  osUsers.fsAsUser("write", { file: path.join(state.repo, "tracked.txt"), content: "initial\n" }, state.identity);
  gitCli.runGitSync(state.repo, ["add", "tracked.txt"], null, state.identity);
  gitCli.runGitSync(state.repo, ["commit", "-qm", "initial"], null, state.identity);

  expectNoSupplementaryAccess(state.repo, state.identity);

  var created = worktree.createWorktree(state.repo, "identity-feature", state.worktreeName, null, state.identity);
  assert.equal(created.ok, true, created.error);
  assert.equal(worktree.isWorktree(created.path, state.identity), true);
  var discovered = worktree.scanWorktrees(state.repo, state.identity);
  assert.equal(discovered.length, 1);
  assert.equal(fs.realpathSync(discovered[0].path), fs.realpathSync(created.path));

  var metadataPath = gitCli.runGitSync(created.path, ["rev-parse", "--absolute-git-dir"], null, state.identity).trim();
  assertOwnedTree(created.path, state.identity.uid, "Worktree contents");
  assertOwnedTree(metadataPath, state.identity.uid, "Linked worktree Git metadata");

  var removed = worktree.removeWorktree(state.repo, state.worktreeName, state.identity);
  assert.equal(removed.ok, true, removed.error);
  assert.equal(fs.existsSync(created.path), false);
  assert.equal(fs.existsSync(metadataPath), false);
  assert.deepEqual(worktree.scanWorktrees(state.repo, state.identity), []);
}

var suffix = process.pid.toString(36) + crypto.randomBytes(3).toString("hex");
var state = {
  root: fs.mkdtempSync(path.join(os.tmpdir(), "clay-worktree-identity-")),
  user: "cwtu" + suffix,
  primaryGroup: "cwtp" + suffix,
  supplementaryGroup: "cwts" + suffix,
  worktreeName: "identity-worktree",
  userCreated: false,
  primaryGroupCreated: false,
  supplementaryGroupCreated: false,
  identity: null,
  repo: null,
};
var failure = null;
try {
  fs.chmodSync(state.root, 0o755);
  execute(state);
} catch (e) {
  failure = e;
}
var cleanupErrors = cleanup(state);
if (failure || cleanupErrors.length > 0) {
  if (failure) console.error(failure.stack || failure.message || failure);
  for (var i = 0; i < cleanupErrors.length; i++) console.error(cleanupErrors[i]);
  process.exitCode = 1;
} else {
  console.log("Privileged Linux worktree identity integration passed");
}
