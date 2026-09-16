// os-users.js — Shared utility for resolving Linux OS user information.
// Used by sdk-bridge.js (worker spawning), terminal-manager.js, and project.js (file ops).

var fs = require("fs");
var path = require("path");
var execFileSync = require("child_process").execFileSync;
var _aclGrantCache = Object.create(null);

function aclCacheKey(projectPath, linuxUser) {
  return path.resolve(projectPath) + "::" + linuxUser;
}

function isSafeLinuxUsername(username) {
  return typeof username === "string" && /^[a-z_][a-z0-9_-]*[$]?$/.test(username);
}

// --- Supplementary group inheritance (issue #367) ---
// Node's child_process { uid, gid } options call setuid/setgid but never
// initgroups(), so spawned sessions drop all supplementary groups (docker,
// video, wheel, ...). When inheritGroups is enabled we route the spawn through
// `setpriv --init-groups` so the child gets the same groups as a normal login.
var _inheritGroups = true; // default: behave like a normal login shell
var _setprivAvail = null;
var _warnedNoSetpriv = false;

function setInheritGroups(value) {
  _inheritGroups = !!value;
}

function getInheritGroups() {
  return _inheritGroups;
}

function setprivAvailable() {
  if (_setprivAvail !== null) return _setprivAvail;
  try {
    execFileSync("setpriv", ["--help"], { stdio: "ignore", timeout: 5000 });
    _setprivAvail = true;
  } catch (e) {
    _setprivAvail = false;
  }
  return _setprivAvail;
}

/**
 * Wrap a spawn/exec invocation so the child runs as the target user WITH its
 * supplementary groups initialized (initgroups), which Node's uid/gid options
 * do not do. Accepts (command, args, options) where options may carry
 * uid/gid, and returns a normalized { command, args, options } to pass to
 * spawn()/execFileSync()/pty.spawn().
 *
 * - Same-user spawns (no uid/gid in options) are returned unchanged.
 * - When inheritGroups is disabled, or setpriv is unavailable, falls back to
 *   Node's uid/gid options (primary group only) so behavior degrades safely.
 * Requires the parent process to be root, which is the case in os-users mode.
 */
function wrapSpawnAsUser(command, args, options, setprivCheck) {
  args = args || [];
  options = options || {};
  var uid = options.uid;
  var gid = options.gid;
  if (uid == null || gid == null) return { command: command, args: args, options: options };

  var hasSetpriv = typeof setprivCheck === "function" ? setprivCheck() : setprivAvailable();
  if (_inheritGroups && hasSetpriv) {
    var wrappedArgs = ["--reuid", String(uid), "--regid", String(gid), "--init-groups", "--", command].concat(args);
    var newOpts = Object.assign({}, options);
    delete newOpts.uid;
    delete newOpts.gid;
    return { command: "setpriv", args: wrappedArgs, options: newOpts };
  }

  if (_inheritGroups && !_warnedNoSetpriv) {
    _warnedNoSetpriv = true;
    console.warn("[os-users] inheritGroups enabled but `setpriv` not found; supplementary groups will be dropped. Install util-linux to restore them.");
  }
  return { command: command, args: args, options: options };
}

/**
 * Resolve Linux user info from username via getent passwd.
 * Returns { uid, gid, home, user, shell } or throws on failure.
 */
function resolveOsUserInfo(username) {
  if (!isSafeLinuxUsername(username)) throw new Error("Invalid Linux username");
  var output = execFileSync("getent", ["passwd", username], { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
  // getent passwd format: username:x:uid:gid:gecos:home:shell
  var parts = output.split(":");
  if (parts.length < 7) throw new Error("Unexpected getent output for user " + username);
  return {
    uid: parseInt(parts[2], 10),
    gid: parseInt(parts[3], 10),
    home: parts[5],
    user: parts[0],
    shell: parts[6] || "/bin/bash",
  };
}

/**
 * Run a file system operation as a specific OS user via a helper subprocess.
 * op: "list", "read", "write", "read_binary", "mkdir", "copy", "stat"
 * args: operation-specific arguments
 * osUserInfo: { uid, gid } from resolveOsUserInfo
 * Returns the result object or throws.
 */
function fsAsUser(op, args, osUserInfo) {
  // Build a small inline Node script to run as the target user
  var script;
  if (op === "list") {
    script = [
      "var fs = require('fs');",
      "var p = require('path');",
      "var dir = " + JSON.stringify(args.dir) + ";",
      "var entries = fs.readdirSync(dir, { withFileTypes: true });",
      "var result = [];",
      "for (var i = 0; i < entries.length; i++) {",
      "  var e = entries[i];",
      "  var stat;",
      "  try { stat = fs.statSync(p.join(dir, e.name)); } catch(err) { continue; }",
      "  result.push({ name: e.name, isDir: e.isDirectory(), size: stat.size, mtime: stat.mtimeMs });",
      "}",
      "process.stdout.write(JSON.stringify(result));",
    ].join(" ");
  } else if (op === "read") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var stat = fs.statSync(f);",
      "var result = { size: stat.size };",
      "if (" + JSON.stringify(!!args.readContent) + ") {",
      "  result.content = fs.readFileSync(f, 'utf8');",
      "}",
      "process.stdout.write(JSON.stringify(result));",
    ].join(" ");
  } else if (op === "stat") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var stat = fs.statSync(f);",
      "process.stdout.write(JSON.stringify({ size: stat.size, isDir: stat.isDirectory(), mtime: stat.mtimeMs }));",
    ].join(" ");
  } else if (op === "realpath") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "process.stdout.write(JSON.stringify({ path: fs.realpathSync(f) }));",
    ].join(" ");
  } else if (op === "read_binary") {
    // Read file as base64 for binary content (images, etc.)
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var buf = fs.readFileSync(f);",
      "process.stdout.write(buf.toString('base64'));",
    ].join(" ");
    var binSpawn = wrapSpawnAsUser(process.execPath, ["-e", script], {
      encoding: "utf8",
      timeout: 10000,
      uid: osUserInfo.uid,
      gid: osUserInfo.gid,
      maxBuffer: 50 * 1024 * 1024,
    });
    var binOutput = execFileSync(binSpawn.command, binSpawn.args, binSpawn.options);
    return { buffer: Buffer.from(binOutput.trim(), "base64") };
  } else if (op === "write") {
    script = [
      "var fs = require('fs');",
      "var f = " + JSON.stringify(args.file) + ";",
      "var content = " + JSON.stringify(args.content || "") + ";",
      "var flag = " + JSON.stringify(args.flag === "wx" ? "wx" : "w") + ";",
      "var mode = " + JSON.stringify(typeof args.mode === "number" ? args.mode : 0o666) + ";",
      "fs.writeFileSync(f, content, { encoding: 'utf8', flag: flag, mode: mode });",
      "process.stdout.write(JSON.stringify({ ok: true }));",
    ].join(" ");
  } else if (op === "mkdir") {
    script = [
      "var fs = require('fs');",
      "var dir = " + JSON.stringify(args.dir) + ";",
      "fs.mkdirSync(dir, { recursive: true });",
      "process.stdout.write(JSON.stringify({ ok: true }));",
    ].join(" ");
  } else if (op === "copy") {
    script = [
      "var fs = require('fs');",
      "var source = " + JSON.stringify(args.source) + ";",
      "var file = " + JSON.stringify(args.file) + ";",
      "var overwrite = " + JSON.stringify(!!args.overwrite) + ";",
      "fs.copyFileSync(source, file, overwrite ? 0 : fs.constants.COPYFILE_EXCL);",
      "process.stdout.write(JSON.stringify({ ok: true }));",
    ].join(" ");
  } else {
    throw new Error("Unknown fsAsUser operation: " + op);
  }

  var fsSpawn = wrapSpawnAsUser(process.execPath, ["-e", script], {
    encoding: "utf8",
    timeout: 10000,
    uid: osUserInfo.uid,
    gid: osUserInfo.gid,
  });
  var output = execFileSync(fsSpawn.command, fsSpawn.args, fsSpawn.options);

  return JSON.parse(output.trim());
}

/**
 * Detect the Linux distribution family for package manager guidance.
 * Returns "debian", "rhel", "alpine", "suse", "arch", or "unknown".
 */
function detectDistroFamily() {
  try {
    var release = fs.readFileSync("/etc/os-release", "utf8");
    var idLike = "";
    var id = "";
    var lines = release.split("\n");
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].indexOf("ID_LIKE=") === 0) idLike = lines[i].substring(8).replace(/"/g, "").toLowerCase();
      if (lines[i].indexOf("ID=") === 0 && lines[i].indexOf("ID_LIKE=") !== 0) id = lines[i].substring(3).replace(/"/g, "").toLowerCase();
    }
    var all = id + " " + idLike;
    if (all.indexOf("debian") !== -1 || all.indexOf("ubuntu") !== -1) return "debian";
    if (all.indexOf("rhel") !== -1 || all.indexOf("centos") !== -1 || all.indexOf("fedora") !== -1 || all.indexOf("amzn") !== -1 || all.indexOf("amazon") !== -1) return "rhel";
    if (all.indexOf("alpine") !== -1) return "alpine";
    if (all.indexOf("suse") !== -1 || all.indexOf("opensuse") !== -1) return "suse";
    if (all.indexOf("arch") !== -1 || all.indexOf("manjaro") !== -1) return "arch";
    return "unknown";
  } catch (e) {
    return "unknown";
  }
}

/**
 * Build a user-friendly install command for the ACL package based on distro.
 */
function getAclInstallCommand() {
  var distro = detectDistroFamily();
  switch (distro) {
    case "debian": return "sudo apt install -y acl";
    case "rhel": return "sudo yum install -y acl";
    case "alpine": return "sudo apk add acl";
    case "suse": return "sudo zypper install -y acl";
    case "arch": return "sudo pacman -S --noconfirm acl";
    default: return "Install the 'acl' package using your distribution's package manager (apt, yum, apk, etc.)";
  }
}

/**
 * Check if setfacl is available on the system.
 * Returns { available: true } or { available: false, installCmd: "..." }.
 */
function checkAclSupport() {
  try {
    execFileSync("which", ["setfacl"], { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    return { available: true };
  } catch (e) {
    return { available: false, installCmd: getAclInstallCommand() };
  }
}

/**
 * Check if a path is a user's home directory (e.g. /home/chad, /root).
 * Running recursive setfacl on a home dir is dangerous and slow.
 */
function isHomeDirectory(dirPath) {
  var resolved = path.resolve(dirPath);
  // /root
  if (resolved === "/root") return true;
  // /home/username (exactly two levels)
  var parts = resolved.split("/");
  if (parts.length === 3 && parts[0] === "" && parts[1] === "home" && parts[2]) return true;
  return false;
}

/**
 * Grant a Linux user ACL access (rwX) to a project directory.
 * Uses setfacl to add recursive + default ACL entries.
 * Skips home directories to avoid slow recursive ACL on large trees.
 */
function grantProjectAccess(projectPath, linuxUser) {
  if (isHomeDirectory(projectPath)) {
    console.log("[os-users] Skipping ACL for home directory: " + projectPath);
    return;
  }
  if (!isSafeLinuxUsername(linuxUser)) {
    console.error("[os-users] Invalid Linux username for ACL grant: " + linuxUser);
    return;
  }
  var cacheKey = aclCacheKey(projectPath, linuxUser);
  if (_aclGrantCache[cacheKey]) {
    return;
  }
  try {
    // Recursive ACL for existing files
    execFileSync("setfacl", ["-R", "-m", "u:" + linuxUser + ":rwX", projectPath], {
      encoding: "utf8",
      timeout: 30000,
      stdio: "pipe",
    });
    // Default ACL so new files also inherit access
    execFileSync("setfacl", ["-R", "-d", "-m", "u:" + linuxUser + ":rwX", projectPath], {
      encoding: "utf8",
      timeout: 30000,
      stdio: "pipe",
    });
    _aclGrantCache[cacheKey] = true;
    console.log("[os-users] Granted ACL access for " + linuxUser + " on " + projectPath);
  } catch (e) {
    delete _aclGrantCache[cacheKey];
    var errMsg = (e.stderr || e.message || "").toString();
    if (errMsg.indexOf("not found") !== -1 || errMsg.indexOf("ENOENT") !== -1) {
      var cmd = getAclInstallCommand();
      console.error("[os-users] setfacl is not installed. ACL support is required for OS user isolation.");
      console.error("[os-users] Install it with: " + cmd);
    } else {
      console.error("[os-users] Failed to grant ACL access for " + linuxUser + " on " + projectPath + ": " + errMsg);
    }
  }
}

/**
 * Revoke a Linux user's ACL access from a project directory.
 */
function revokeProjectAccess(projectPath, linuxUser) {
  if (isHomeDirectory(projectPath)) {
    console.log("[os-users] Skipping ACL revoke for home directory: " + projectPath);
    return;
  }
  if (!isSafeLinuxUsername(linuxUser)) {
    console.error("[os-users] Invalid Linux username for ACL revoke: " + linuxUser);
    return;
  }
  var cacheKey = aclCacheKey(projectPath, linuxUser);
  try {
    execFileSync("setfacl", ["-R", "-x", "u:" + linuxUser, projectPath], {
      encoding: "utf8",
      timeout: 30000,
      stdio: "pipe",
    });
    execFileSync("setfacl", ["-R", "-d", "-x", "u:" + linuxUser, projectPath], {
      encoding: "utf8",
      timeout: 30000,
      stdio: "pipe",
    });
    delete _aclGrantCache[cacheKey];
    console.log("[os-users] Revoked ACL access for " + linuxUser + " on " + projectPath);
  } catch (e) {
    var errMsg = (e.stderr || e.message || "").toString();
    if (errMsg.indexOf("not found") !== -1 || errMsg.indexOf("ENOENT") !== -1) {
      var cmd = getAclInstallCommand();
      console.error("[os-users] setfacl is not installed. ACL support is required for OS user isolation.");
      console.error("[os-users] Install it with: " + cmd);
    } else {
      console.error("[os-users] Failed to revoke ACL access for " + linuxUser + " on " + projectPath + ": " + errMsg);
    }
  }
}

/**
 * Sanitize a Clay username into a valid Linux username.
 * Prefixes with "clay-", lowercases, replaces invalid chars with hyphens.
 * Linux usernames: start with [a-z_], then [a-z0-9_-], max 32 chars.
 */
function toLinuxUsername(clayUsername) {
  var sanitized = clayUsername.toLowerCase().replace(/[^a-z0-9_-]/g, "-");
  // Remove leading hyphens/digits after prefix
  sanitized = sanitized.replace(/^[-0-9]+/, "");
  if (!sanitized) sanitized = "user";
  var name = "clay-" + sanitized;
  // Truncate to 32 chars (Linux limit)
  if (name.length > 32) name = name.substring(0, 32);
  // Remove trailing hyphens
  name = name.replace(/-+$/, "");
  return name;
}

function findAvailableLinuxUsername(baseName, existsFn, rejectedCandidates) {
  var exists = existsFn || linuxUserExists;
  rejectedCandidates = rejectedCandidates || Object.create(null);
  if (!exists(baseName) && !rejectedCandidates[baseName]) return baseName;
  for (var suffixNumber = 2; suffixNumber < 10000; suffixNumber++) {
    var suffix = "-" + suffixNumber;
    var candidate = baseName.substring(0, 32 - suffix.length).replace(/-+$/, "") + suffix;
    if (!exists(candidate) && !rejectedCandidates[candidate]) return candidate;
  }
  throw new Error("Could not allocate a unique Linux username for " + baseName);
}

function allocateLinuxUsername(baseName, existsFn, createUser) {
  var exists = existsFn || linuxUserExists;
  var rejectedCandidates = Object.create(null);
  for (var attempt = 0; attempt < 9999; attempt++) {
    var linuxName = findAvailableLinuxUsername(baseName, exists, rejectedCandidates);
    try {
      createUser(linuxName);
      return linuxName;
    } catch (e) {
      var msg = (e.stderr || e.message || "").trim();
      if (exists(linuxName) || e.status === 9 || /already exists/i.test(msg)) {
        // NSS can lag a successful concurrent useradd, so remember collisions locally.
        rejectedCandidates[linuxName] = true;
        continue;
      }
      throw e;
    }
  }
  throw new Error("Could not allocate a unique Linux username for " + baseName);
}

/**
 * Ensure linger is enabled for a Linux user so systemd creates /run/user/<uid>.
 * Required for CLI tools like gcloud and gh that need XDG_RUNTIME_DIR.
 */
function ensureLinger(username) {
  try {
    if (!isSafeLinuxUsername(username)) throw new Error("Invalid Linux username");
    var uid = execFileSync("id", ["-u", username], { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    var lingerFile = "/var/lib/systemd/linger/" + username;
    if (fs.existsSync(lingerFile)) return;
    execFileSync("loginctl", ["enable-linger", username], {
      encoding: "utf8",
      timeout: 10000,
      stdio: "pipe",
    });
    console.log("[os-users] Enabled linger for " + username + " (uid " + uid + ")");
  } catch (e) {
    console.warn("[os-users] Failed to enable linger for " + username + ": " + (e.stderr || e.message || "").trim());
  }
}

/**
 * Check if a Linux user already exists.
 */
function linuxUserExists(username) {
  try {
    if (!isSafeLinuxUsername(username)) return false;
    execFileSync("id", [username], { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    return true;
  } catch (e) {
    return false;
  }
}

function getLinuxUserHome(username) {
  try {
    if (!isSafeLinuxUsername(username)) return "/home/" + (username || "");
    var line = execFileSync("getent", ["passwd", username], { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    var parts = line.split(":");
    return parts[5] || "/home/" + username;
  } catch (e) {
    return "/home/" + username;
  }
}

function getLinuxUserUid(username) {
  try {
    if (!isSafeLinuxUsername(username)) return null;
    var uid = execFileSync("id", ["-u", username], { encoding: "utf8", timeout: 5000, stdio: "pipe" }).trim();
    return parseInt(uid, 10);
  } catch (e) {
    return null;
  }
}

/**
 * Check whether the Claude CLI is already resolvable for a Linux user,
 * using the same login PATH the session will actually run with.
 * Runs `command -v claude` inside a login shell (`su - <user>`) so a
 * system-wide install (e.g. /usr/bin/claude) is detected, not just the
 * hardcoded ~/.local/bin/claude path.
 * Returns true if claude resolves, false otherwise.
 */
function claudeAvailableForUser(linuxName) {
  if (!isSafeLinuxUsername(linuxName)) return false;
  try {
    var out = execFileSync("su", ["-", linuxName, "-c", "command -v claude"], {
      encoding: "utf8",
      timeout: 10000,
      stdio: "pipe",
    }).trim();
    return out.length > 0;
  } catch (e) {
    return false;
  }
}

/**
 * Install Claude CLI for a Linux user account.
 * Downloads and runs the install script, then ensures PATH is configured.
 * Non-fatal: logs errors but does not throw.
 * Skips entirely when claude is already resolvable for the user, or when
 * CLAY_SKIP_CLAUDE_INSTALL is set (bring-your-own-claude).
 */
function installClaudeCli(linuxName) {
  if (process.env.CLAY_SKIP_CLAUDE_INSTALL) {
    console.log("[os-users] CLAY_SKIP_CLAUDE_INSTALL set, skipping Claude CLI install for " + linuxName);
    return;
  }
  if (claudeAvailableForUser(linuxName)) {
    console.log("[os-users] Claude CLI already available for " + linuxName + ", skipping install");
    return;
  }
  try {
    if (!isSafeLinuxUsername(linuxName)) throw new Error("Invalid Linux username");
    // Download and run the Claude CLI install script as the target user
    execFileSync("su", ["-", linuxName, "-c", "curl -fsSL https://claude.ai/install.sh | bash"], {
      encoding: "utf8",
      timeout: 60000,
      stdio: "pipe",
    });
    console.log("[os-users] Claude CLI installed for " + linuxName);
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to install Claude CLI for " + linuxName + ": " + msg);
    return;
  }

  // Append PATH export to the user's shell config if not already present
  try {
    var userInfo = resolveOsUserInfo(linuxName);
    var home = userInfo.home || ("/home/" + linuxName);
    var rcPath = fs.existsSync(path.join(home, ".zshrc")) ? path.join(home, ".zshrc") : path.join(home, ".bashrc");
    var exportLine = 'export PATH="$HOME/.local/bin:$PATH"';
    var existing = "";
    try { existing = fs.readFileSync(rcPath, "utf8"); } catch (e2) {}
    if (existing.indexOf(exportLine) === -1) {
      var prefix = existing && !/\n$/.test(existing) ? "\n" : "";
      fs.appendFileSync(rcPath, prefix + exportLine + "\n", "utf8");
      try { fs.chownSync(rcPath, userInfo.uid, userInfo.gid); } catch (e3) {}
      console.log("[os-users] PATH export appended to " + rcPath + " for " + linuxName);
    } else {
      console.log("[os-users] PATH already configured in " + rcPath + " for " + linuxName);
    }
  } catch (e) {
    var rcMsg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to configure PATH for " + linuxName + ": " + rcMsg);
  }
}

/**
 * Provision a Linux user account for a Clay user.
 * Creates the account via useradd with a home directory.
 * Returns { ok: true, linuxUser: "clay-xxx" } or { error: "..." }.
 */
function provisionLinuxUser(clayUsername) {
  var baseName = toLinuxUsername(clayUsername);
  var linuxName;
  try {
    linuxName = allocateLinuxUsername(baseName, linuxUserExists, function(candidate) {
      execFileSync("useradd", ["-m", "-s", "/bin/bash", candidate], {
        encoding: "utf8",
        timeout: 15000,
        stdio: "pipe",
      });
    });
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to provision Linux user " + baseName + ": " + msg);
    return { error: "Failed to create Linux user " + baseName + ": " + msg };
  }
  if (linuxName !== baseName) {
    console.log("[os-users] Linux user " + baseName + " already exists; provisioning " + linuxName + " instead");
  }
  ensureLinger(linuxName);
  console.log("[os-users] Provisioned Linux user: " + linuxName + " (Clay user: " + clayUsername + ")");
  installClaudeCli(linuxName);
  return { ok: true, linuxUser: linuxName };
}

/**
 * Provision Linux accounts for all Clay users that don't have one yet.
 * usersModule: the users.js module (getAllUsers, updateLinuxUser, etc.)
 * Returns { provisioned: [...], skipped: [...], errors: [...] }.
 */
function provisionAllUsers(usersModule) {
  var users = usersModule.getAllUsers();
  var result = { provisioned: [], skipped: [], errors: [] };

  for (var i = 0; i < users.length; i++) {
    var user = users[i];
    if (user.linuxUser) {
      // Already mapped, verify the Linux user still exists
      if (linuxUserExists(user.linuxUser)) {
        // Ensure Claude CLI is available for existing users. Resolve against
        // the user's actual login PATH so a system-wide install counts, rather
        // than checking a single hardcoded ~/.local/bin/claude path.
        if (!claudeAvailableForUser(user.linuxUser)) {
          console.log("[os-users] Claude CLI not resolvable for " + user.linuxUser + ", installing...");
          installClaudeCli(user.linuxUser);
        }
        // Ensure linger is enabled for existing users
        ensureLinger(user.linuxUser);
        result.skipped.push({ id: user.id, username: user.username, linuxUser: user.linuxUser });
        continue;
      }
      // Linux user was deleted externally, re-provision
      console.log("[os-users] Linux user " + user.linuxUser + " no longer exists, re-provisioning for " + user.username);
    }

    var provision = provisionLinuxUser(user.username);
    if (provision.ok) {
      // Update the Clay user record with the Linux username
      var data = usersModule.loadUsers();
      for (var j = 0; j < data.users.length; j++) {
        if (data.users[j].id === user.id) {
          data.users[j].linuxUser = provision.linuxUser;
          usersModule.saveUsers(data);
          break;
        }
      }
      result.provisioned.push({ id: user.id, username: user.username, linuxUser: provision.linuxUser });
    } else {
      result.errors.push({ id: user.id, username: user.username, error: provision.error });
    }
  }

  return result;
}

/**
 * Grant ACL access on a project directory to ALL Clay users with linuxUser mappings.
 * Used when a project becomes public.
 * usersModule: the users.js module (getAllUsers, etc.)
 */
function grantAllUsersAccess(projectPath, usersModule) {
  var allUsers = usersModule.getAllUsers();
  for (var i = 0; i < allUsers.length; i++) {
    if (allUsers[i].linuxUser) {
      grantProjectAccess(projectPath, allUsers[i].linuxUser);
    }
  }
}

/**
 * Deactivate (lock) a Linux user account.
 * The account and home directory are preserved, but login is disabled.
 */
function deactivateLinuxUser(linuxUsername) {
  try {
    if (!isSafeLinuxUsername(linuxUsername)) throw new Error("Invalid Linux username");
    execFileSync("usermod", ["-L", linuxUsername], { encoding: "utf8", timeout: 5000, stdio: "pipe" });
    console.log("[os-users] Deactivated Linux user: " + linuxUsername);
    return { ok: true };
  } catch (e) {
    var msg = (e.stderr || e.message || "").trim();
    console.error("[os-users] Failed to deactivate Linux user " + linuxUsername + ": " + msg);
    return { error: "Failed to deactivate Linux user " + linuxUsername + ": " + msg };
  }
}

/**
 * Ensure the shared projects directory exists.
 */
function ensureProjectsDir() {
  var dir = "/var/clay/projects";
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true, mode: 0o711 });
  } else {
    // Tighten permissions if directory already exists (prevent listing by other users)
    try { fs.chmodSync(dir, 0o711); } catch (e) {}
  }
}

module.exports = {
  checkAclSupport: checkAclSupport,
  resolveOsUserInfo: resolveOsUserInfo,
  fsAsUser: fsAsUser,
  grantProjectAccess: grantProjectAccess,
  revokeProjectAccess: revokeProjectAccess,
  toLinuxUsername: toLinuxUsername,
  linuxUserExists: linuxUserExists,
  provisionLinuxUser: provisionLinuxUser,
  provisionAllUsers: provisionAllUsers,
  grantAllUsersAccess: grantAllUsersAccess,
  installClaudeCli: installClaudeCli,
  claudeAvailableForUser: claudeAvailableForUser,
  setInheritGroups: setInheritGroups,
  getInheritGroups: getInheritGroups,
  wrapSpawnAsUser: wrapSpawnAsUser,
  deactivateLinuxUser: deactivateLinuxUser,
  ensureProjectsDir: ensureProjectsDir,
  isHomeDirectory: isHomeDirectory,
  getLinuxUserHome: getLinuxUserHome,
  getLinuxUserUid: getLinuxUserUid,
  isSafeLinuxUsername: isSafeLinuxUsername,
  findAvailableLinuxUsername: findAvailableLinuxUsername,
  allocateLinuxUsername: allocateLinuxUsername,
};
