#!/usr/bin/env node

// --- Node version check ---
var nodeMajor = parseInt(process.versions.node.split(".")[0], 10);
if (nodeMajor < 20) {
  console.error("\x1b[31m[clay] Node.js 20+ is required (current: " + process.version + ")\x1b[0m");
  console.error("[clay] The Claude Agent SDK 0.2.40+ requires Node 20 for Symbol.dispose support.");
  console.error("[clay] If you cannot upgrade Node, use claude-relay@2.4.3 which supports Node 18.");
  console.error("");
  console.error("  Upgrade Node:  nvm install 22 && nvm use 22");
  console.error("  Or use older:  npx claude-relay@2.4.3");
  process.exit(78); // EX_CONFIG — fatal config error, don't auto-restart
}

// Polyfill Symbol.dispose/asyncDispose if missing (Node 20.x may not have it)
if (!Symbol.dispose) Symbol.dispose = Symbol("Symbol.dispose");
if (!Symbol.asyncDispose) Symbol.asyncDispose = Symbol("Symbol.asyncDispose");

// Increase listener limit for projects with many worktrees
process.setMaxListeners(50);

// Remove CLAUDECODE env var so the SDK can spawn Claude Code child processes
// (prevents "cannot be launched inside another Claude Code session" error)
delete process.env.CLAUDECODE;

var fs = require("fs");
var path = require("path");
var { loadConfig, saveConfig, socketPath, generateSlug, syncClayrc, removeFromClayrc, writeCrashInfo, readCrashInfo, clearCrashInfo, isPidAlive, clearStaleConfig, REAL_HOME } = require("./config");
var { createIPCServer } = require("./ipc");
var { createServer, generateAuthToken } = require("./server");
var osUsersMod = require("./os-users");
var { scheduleOsUserDiagnosticsAsync } = require("./os-user-diagnostics");
var { checkAclSupport, grantProjectAccess, revokeProjectAccess, provisionAllUsers, provisionLinuxUser, grantAllUsersAccess, deactivateLinuxUser, ensureProjectsDir } = osUsersMod;
var usersModule = require("./users");
var { createWorktree, removeWorktree, isWorktree } = require("./worktree");
var mates = require("./mates");
var mateKnowledgeMigration = require("./mate-knowledge-migration");
var { isWorktreeSlug, scanAndRegisterWorktrees, rescanWorktrees, cleanupWorktreesForParent, getFilteredRemovedProjects, registerWorktreeSlug, unregisterWorktreeSlug } = require("./daemon-projects");
var daemonProjectAccess = require("./daemon-project-access");
var projectLogContext = require("./project-log-context");

var daemonVersion = require("../package.json").version;
var configFile = process.env.CLAY_CONFIG || process.env.CLAUDE_RELAY_CONFIG || require("./config").configPath();
var config;

try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (e) {
  console.error("[daemon] Failed to read config:", e.message);
  process.exit(1);
}
console.log("[daemon] v" + daemonVersion + " PID " + process.pid + " config " + configFile);

console.log("[daemon] Config: " + configFile);
console.log("[daemon] Users: " + usersModule.USERS_FILE);
if (process.env.SUDO_USER) console.log("[daemon] SUDO_USER: " + process.env.SUDO_USER);
console.log("[daemon] UID: " + (typeof process.getuid === "function" ? process.getuid() : "N/A"));

// --- Ensure the multi-user model (there is no single-user runtime anymore):
// migrate a legacy single-user deploy, or provision a default admin on a fresh
// one. One-time, idempotent, best-effort. Runs before projects/mates/sessions
// load so the flip and on-disk backfill are in effect for the rest of boot. ---
try {
  require("./migrate-single-user").ensureMultiUser();
  config = loadConfig(); // refresh in-memory config to pick up the migration marker
} catch (e) {
  console.error("[daemon] ensureMultiUser threw (continuing):", e && e.message);
}

if (projectLogContext.initializeProjectKnowledge(config)) {
  saveConfig(config);
  console.log("[daemon] Assigned stable knowledge identities to existing projects");
}

// --- OS users mode: check required system dependencies ---
// Supplementary-group inheritance (issue #367): default on so sessions behave
// like a normal login; operators can disable via config / the settings toggle.
osUsersMod.setInheritGroups(config.inheritGroups !== false);
if (config.osUsers) {
  var checkExec = require("child_process").execFileSync;
  var missing = [];
  try { checkExec("which", ["setfacl"], { stdio: "ignore" }); } catch (e) { missing.push("acl (setfacl)"); }
  try { checkExec("which", ["git"], { stdio: "ignore" }); } catch (e) { missing.push("git"); }
  try { checkExec("which", ["useradd"], { stdio: "ignore" }); } catch (e) { missing.push("useradd"); }
  if (missing.length > 0) {
    console.error("[daemon] OS users mode requires missing system packages: " + missing.join(", "));
    console.error("[daemon] Install with:  sudo apt install " + missing.map(function (m) { return m.split(" ")[0]; }).join(" "));
    process.exit(78); // EX_CONFIG
  }
  if (config.inheritGroups !== false) {
    console.log("[daemon] Sessions inherit each user's supplementary groups (docker, etc.); disable in Settings > User Groups.");
  } else {
    console.log("[daemon] Sessions run with primary group only (supplementary groups dropped); enable in Settings > User Groups.");
  }
}

// --- TLS ---
var tlsOptions = null;
if (config.tls) {
  // 1. Check builtin cert (shipped with package)
  var builtinKeyPath = path.join(__dirname, "certs", "privkey.pem");
  var builtinCertPath = path.join(__dirname, "certs", "fullchain.pem");

  // 2. User cert (mkcert, etc.)
  var os = require("os");
  var certDir = path.join(process.env.CLAY_HOME || process.env.CLAUDE_RELAY_HOME || path.join(REAL_HOME, ".clay"), "certs");
  var userKeyPath = path.join(certDir, "key.pem");
  var userCertPath = path.join(certDir, "cert.pem");

  // Cert fetched at runtime from the clay.studio endpoint (always current),
  // cached by the CLI before forking us. Prefer it over the baked copy.
  var fetched = null;
  try { fetched = require("./clay-studio-cert").cachedCertFiles(); } catch (e) {}

  var keyPath, certPath;
  if (config.builtinCert !== false && fetched) {
    keyPath = fetched.key;
    certPath = fetched.cert;
    config.builtinCert = true;
  } else if (config.builtinCert !== false && fs.existsSync(builtinKeyPath) && fs.existsSync(builtinCertPath)) {
    keyPath = builtinKeyPath;
    certPath = builtinCertPath;
    config.builtinCert = true;
  } else {
    keyPath = userKeyPath;
    certPath = userCertPath;
  }

  try {
    tlsOptions = {
      key: fs.readFileSync(keyPath),
      cert: fs.readFileSync(certPath),
    };
  } catch (e) {
    console.error("[daemon] TLS cert not found, falling back to HTTP");
  }
}

var caRoot = null;

// --- Resolve LAN IP for share URL ---
var os2 = require("os");
var lanIp = (function () {
  var ifaces = os2.networkInterfaces();
  for (var addrs of Object.values(ifaces)) {
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i].family === "IPv4" && !addrs[i].internal && addrs[i].address.startsWith("100.")) return addrs[i].address;
    }
  }
  for (var addrs of Object.values(ifaces)) {
    for (var i = 0; i < addrs.length; i++) {
      if (addrs[i].family === "IPv4" && !addrs[i].internal) return addrs[i].address;
    }
  }
  return null;
})();

// getFilteredRemovedProjects extracted to daemon-projects.js

// --- Create multi-project server ---
var listenHost = config.host || "0.0.0.0";

function rememberedProjectKnowledgeId(projectPath) {
  var removed = config.removedProjects || [];
  for (var i = removed.length - 1; i >= 0; i--) {
    if (removed[i].path === projectPath && projectLogContext.validId(removed[i].projectKnowledgeId)) {
      return removed[i].projectKnowledgeId;
    }
  }
  return projectLogContext.createProjectKnowledgeId();
}

function projectRuntimeOptions(project) {
  return { projectKnowledgeId: project.projectKnowledgeId };
}

function worktreeOsUserInfo(project, requestUser) {
  if (!config.osUsers) return null;
  var owner = project && project.ownerId ? usersModule.findUserById(project.ownerId) : null;
  var executionUser = owner && owner.linuxUser ? owner : requestUser;
  if (!executionUser || !executionUser.linuxUser) {
    throw new Error("The project owner does not have a provisioned Linux account");
  }
  return osUsersMod.resolveOsUserInfo(executionUser.linuxUser);
}

function registerProjectWorktrees(project, requestUser) {
  try {
    var osUserInfo = worktreeOsUserInfo(project, requestUser);
    scanAndRegisterWorktrees(relay, project.path, project.slug, project.icon, project.ownerId, project.projectKnowledgeId, osUserInfo, config);
  } catch (e) {
    console.error("[daemon] Failed to scan worktrees for " + project.slug + ": " + e.message);
  }
}

var relay = createServer({
  tlsOptions: tlsOptions,
  caPath: caRoot,
  builtinCert: config.builtinCert || false,
  pinHash: config.pinHash || null,
  port: config.port,
  debug: config.debug || false,
  dangerouslySkipPermissions: config.dangerouslySkipPermissions || false,
  osUsers: config.osUsers || false,
  lanHost: lanIp ? lanIp + ":" + config.port : null,
  getRemovedProjects: function (userId) { return getFilteredRemovedProjects(config, userId); },
  onAddProject: function (absPath, wsUser) {
    // Check if already registered
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].path === absPath) {
        return { ok: true, slug: config.projects[j].slug, existing: true };
      }
    }
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(absPath, slugs);
    var projectEntry = { path: absPath, slug: slug, addedAt: Date.now(), visibility: "private" };
    projectEntry.projectKnowledgeId = rememberedProjectKnowledgeId(absPath);
    // The user who adds a project always becomes the owner
    if (wsUser && wsUser.id) {
      projectEntry.ownerId = wsUser.id;
    }
    config.projects.push(projectEntry);
    relay.addProject(absPath, slug, null, null, wsUser ? wsUser.id : null, null, projectRuntimeOptions(projectEntry));
    // Remove from removedProjects if present
    if (config.removedProjects) {
      config.removedProjects = config.removedProjects.filter(function (rp) { return rp.path !== absPath; });
    }
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Added project (web):", slug, "→", absPath);
    // OS users mode: grant ACL to project owner
    if (config.osUsers) {
      var newProj = config.projects[config.projects.length - 1];
      if (newProj.ownerId) {
        var ownerUser = usersModule.findUserById(newProj.ownerId);
        if (ownerUser && ownerUser.linuxUser) {
          grantProjectAccess(absPath, ownerUser.linuxUser);
        }
      }
    }
    // Discover and register worktrees for the new project
    registerProjectWorktrees(projectEntry, wsUser);
    // Broadcast updated project list to all clients
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: slug };
  },
  onCreateProject: function (projectName, wsUser) {
    console.log("[daemon] onCreateProject wsUser:", JSON.stringify(wsUser ? { id: wsUser.id, role: wsUser.role, username: wsUser.username, linuxUser: wsUser.linuxUser } : null));
    var os = require("os");
    var execFileSync = require("child_process").execFileSync;
    var baseDir;
    if (config.osUsers) {
      baseDir = "/var/clay/projects";
    } else {
      baseDir = config.projectsDir || path.join(REAL_HOME, "clay-projects");
    }
    try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) {}
    // Generate slug and deduplicate
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(path.join(baseDir, projectName), slugs);
    var targetDir = path.join(baseDir, slug);
    try {
      fs.mkdirSync(targetDir, { recursive: true });
      // Run git init
      if (config.osUsers && wsUser) {
        var linuxUser = wsUser.linuxUser;
        if (linuxUser) {
          var uidGid = null;
          try {
            uidGid = {
              uid: parseInt(execFileSync("id", ["-u", linuxUser], { encoding: "utf8", stdio: "pipe" }).trim(), 10),
              gid: parseInt(execFileSync("id", ["-g", linuxUser], { encoding: "utf8", stdio: "pipe" }).trim(), 10),
            };
          } catch (e) {}
          if (uidGid) {
            fs.chmodSync(targetDir, 0o700);
            execFileSync("chown", ["-R", linuxUser + ":" + linuxUser, targetDir]);
            var gitInit = osUsersMod.wrapSpawnAsUser("git", ["init"], { cwd: targetDir, uid: uidGid.uid, gid: uidGid.gid, env: { PATH: "/usr/local/bin:/usr/bin:/bin" } });
            execFileSync(gitInit.command, gitInit.args, gitInit.options);
          } else {
            execFileSync("git", ["init"], { cwd: targetDir });
          }
        } else {
          execFileSync("git", ["init"], { cwd: targetDir });
        }
      } else {
        execFileSync("git", ["init"], { cwd: targetDir });
      }
    } catch (e) {
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (ce) {}
      return { ok: false, error: "Failed to create project: " + e.message };
    }
    // Register project - creator always becomes owner, default private
    var projectEntry = { path: targetDir, slug: slug, addedAt: Date.now(), visibility: "private" };
    projectEntry.projectKnowledgeId = projectLogContext.createProjectKnowledgeId();
    if (wsUser && wsUser.id) {
      projectEntry.ownerId = wsUser.id;
    }
    relay.addProject(targetDir, slug, null, null, wsUser ? wsUser.id : null, null, projectRuntimeOptions(projectEntry));
    config.projects.push(projectEntry);
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Created project:", slug, "→", targetDir, "entry:", JSON.stringify({ ownerId: projectEntry.ownerId, visibility: projectEntry.visibility }));
    // OS users mode: grant ACL
    if (config.osUsers && wsUser && wsUser.linuxUser) {
      console.log("[daemon] Granting ACL:", targetDir, "→", wsUser.linuxUser);
      grantProjectAccess(targetDir, wsUser.linuxUser);
    } else if (config.osUsers) {
      console.log("[daemon] Skipping ACL grant: osUsers=true but linuxUser=", wsUser && wsUser.linuxUser);
    }
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: slug };
  },
  onCloneProject: function (cloneUrl, wsUser, callback) {
    var os = require("os");
    var spawn = require("child_process").spawn;
    var execFileSync = require("child_process").execFileSync;
    var baseDir;
    if (config.osUsers) {
      baseDir = "/var/clay/projects";
    } else {
      baseDir = config.projectsDir || path.join(REAL_HOME, "clay-projects");
    }
    try { fs.mkdirSync(baseDir, { recursive: true }); } catch (e) {}
    // Derive slug from repo URL
    var repoName = cloneUrl.replace(/\.git$/, "").split("/").pop() || "project";
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(path.join(baseDir, repoName), slugs);
    var targetDir = path.join(baseDir, slug);
    // Clone as user to use their git credentials
    var spawnOpts = { cwd: baseDir };
    if (config.osUsers && wsUser && wsUser.linuxUser) {
      try {
        spawnOpts.uid = parseInt(execFileSync("id", ["-u", wsUser.linuxUser], { encoding: "utf8", stdio: "pipe" }).trim(), 10);
        spawnOpts.gid = parseInt(execFileSync("id", ["-g", wsUser.linuxUser], { encoding: "utf8", stdio: "pipe" }).trim(), 10);
        spawnOpts.env = Object.assign({}, process.env, {
          HOME: "/home/" + wsUser.linuxUser,
          USER: wsUser.linuxUser
        });
      } catch (e) {}
    }
    // Pre-create target directory as root and chown to user
    if (fs.existsSync(targetDir)) {
      callback({ ok: false, error: "Target directory already exists: " + targetDir });
      return;
    }
    if (config.osUsers && wsUser && wsUser.linuxUser && spawnOpts.uid != null) {
      try {
        fs.mkdirSync(targetDir, { mode: 0o700 });
        fs.chownSync(targetDir, spawnOpts.uid, spawnOpts.gid);
      } catch (e) {
        callback({ ok: false, error: "Failed to prepare project directory: " + e.message });
        return;
      }
    }
    var cloneSpawn = osUsersMod.wrapSpawnAsUser("git", ["clone", cloneUrl, targetDir], spawnOpts);
    var proc = spawn(cloneSpawn.command, cloneSpawn.args, cloneSpawn.options);
    var stderrBuf = "";
    proc.stderr.on("data", function (chunk) { stderrBuf += chunk.toString(); });
    // 5 minute timeout
    var cloneTimeout = setTimeout(function () {
      proc.kill("SIGTERM");
    }, 5 * 60 * 1000);
    proc.on("close", function (code) {
      clearTimeout(cloneTimeout);
      if (code !== 0) {
        try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (ce) {}
        var errMsg = stderrBuf.trim().split("\n").pop() || "Clone failed (exit code " + code + ")";
        callback({ ok: false, error: errMsg });
        return;
      }
      // chown and restrict permissions if osUsers
      if (config.osUsers && wsUser && wsUser.linuxUser) {
        try {
          fs.chmodSync(targetDir, 0o700);
          execFileSync("chown", ["-R", wsUser.linuxUser + ":" + wsUser.linuxUser, targetDir]);
        } catch (e) {}
      }
      // Register project - creator always becomes owner
      // Creator always becomes owner, default private
      var projectEntry = { path: targetDir, slug: slug, addedAt: Date.now(), visibility: "private" };
      projectEntry.projectKnowledgeId = projectLogContext.createProjectKnowledgeId();
      if (wsUser && wsUser.id) {
        projectEntry.ownerId = wsUser.id;
      }
      relay.addProject(targetDir, slug, null, null, wsUser ? wsUser.id : null, null, projectRuntimeOptions(projectEntry));
      config.projects.push(projectEntry);
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Cloned project:", slug, "→", targetDir);
      if (config.osUsers && wsUser && wsUser.linuxUser) {
        grantProjectAccess(targetDir, wsUser.linuxUser);
      }
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      callback({ ok: true, slug: slug });
    });
    proc.on("error", function (err) {
      clearTimeout(cloneTimeout);
      try { fs.rmSync(targetDir, { recursive: true, force: true }); } catch (ce) {}
      callback({ ok: false, error: "Failed to start git clone: " + err.message });
    });
  },
  onRemoveProject: function (slug, userId) {
    // Check if this is a worktree project (ephemeral)
    if (isWorktreeSlug(slug)) {
      var wtParent = slug.split("--")[0];
      var wtDirName = slug.split("--").slice(1).join("--");
      // Find parent project path
      var parentProject = null;
      for (var pi = 0; pi < config.projects.length; pi++) {
        if (config.projects[pi].slug === wtParent) { parentProject = config.projects[pi]; break; }
      }
      if (parentProject) {
        var wtPath = path.join(parentProject.path, wtDirName);
        var removeUser = userId ? usersModule.findUserById(userId) : null;
        var removeOsUserInfo;
        try {
          removeOsUserInfo = worktreeOsUserInfo(parentProject, removeUser);
        } catch (e) {
          return { ok: false, error: e.message };
        }
        var contextStatus = projectLogContext.isMerged(parentProject.path, wtPath, removeOsUserInfo) ? "merged" : "archived";
        var rmResult = removeWorktree(parentProject.path, wtDirName, removeOsUserInfo);
        if (!rmResult.ok) {
          console.log("[daemon] Failed to remove worktree:", slug, rmResult.error);
          return { ok: false, error: rmResult.error };
        }
        relay.setProjectLogContextState(slug, contextStatus);
      }
      relay.removeProject(slug);
      unregisterWorktreeSlug(wtParent, slug);
      if (daemonProjectAccess.clearWorktreeGrant(config, slug)) saveConfig(config);
      console.log("[daemon] Removed worktree (web):", slug);
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true };
    }
    var found = null;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === slug) { found = config.projects[j]; break; }
    }
    if (!found) return { ok: false, error: "Project not found" };
    // Cascade remove worktrees belonging to this parent
    cleanupWorktreesForParent(relay, slug);
    // Save to removedProjects for re-add functionality
    if (!config.removedProjects) config.removedProjects = [];
    config.removedProjects.push({
      path: found.path,
      title: found.title || null,
      icon: found.icon || null,
      userId: userId || null,
      projectKnowledgeId: found.projectKnowledgeId || null,
      removedAt: Date.now(),
    });
    // Cap at 20 entries (oldest first)
    if (config.removedProjects.length > 20) {
      config.removedProjects = config.removedProjects.slice(config.removedProjects.length - 20);
    }
    relay.removeProject(slug);
    config.projects = config.projects.filter(function (p) { return p.slug !== slug; });
    saveConfig(config);
    // Remove from .clayrc so it doesn't appear in restore prompt
    if (found.path) { try { removeFromClayrc(found.path); } catch (e) {} }
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Removed project (web):", slug);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onReorderProjects: function (slugs) {
    // Build a slug->project map from current projects
    var projectMap = {};
    for (var j = 0; j < config.projects.length; j++) {
      projectMap[config.projects[j].slug] = config.projects[j];
    }
    // Reorder based on the slugs array
    var reordered = [];
    for (var k = 0; k < slugs.length; k++) {
      if (projectMap[slugs[k]]) {
        reordered.push(projectMap[slugs[k]]);
        delete projectMap[slugs[k]];
      }
    }
    // Append any remaining projects not in slugs (safety)
    var remaining = Object.keys(projectMap);
    for (var m = 0; m < remaining.length; m++) {
      reordered.push(projectMap[remaining[m]]);
    }
    config.projects = reordered;
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    // Also reorder the in-memory Map so getProjects() returns the new order
    relay.reorderProjects(slugs);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onSetProjectTitle: function (slug, newTitle) {
    relay.setProjectTitle(slug, newTitle);
    for (var ti = 0; ti < config.projects.length; ti++) {
      if (config.projects[ti].slug === slug) {
        if (newTitle) {
          config.projects[ti].title = newTitle;
        } else {
          delete config.projects[ti].title;
        }
        break;
      }
    }
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onSetProjectIcon: function (slug, newIcon) {
    relay.setProjectIcon(slug, newIcon);
    for (var ii = 0; ii < config.projects.length; ii++) {
      if (config.projects[ii].slug === slug) {
        if (newIcon) {
          config.projects[ii].icon = newIcon;
        } else {
          delete config.projects[ii].icon;
        }
        break;
      }
    }
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onProjectOwnerChanged: function (slug, ownerId) {
    console.log("[daemon] onProjectOwnerChanged:", slug, "→", ownerId);
    var oldOwnerId = null;
    var projectIdx = -1;
    for (var oi = 0; oi < config.projects.length; oi++) {
      if (config.projects[oi].slug === slug) {
        oldOwnerId = config.projects[oi].ownerId || null;
        projectIdx = oi;
        if (ownerId) {
          config.projects[oi].ownerId = ownerId;
        } else {
          delete config.projects[oi].ownerId;
        }
        break;
      }
    }
    saveConfig(config);
    // OS users mode: revoke old owner ACL, grant new owner ACL
    if (config.osUsers && projectIdx >= 0) {
      var projectPath = config.projects[projectIdx].path;
      var allowed = config.projects[projectIdx].allowedUsers || [];
      var visibility = config.projects[projectIdx].visibility || "public";
      // Revoke old owner (if not in allowedUsers and project is not public)
      if (oldOwnerId && oldOwnerId !== ownerId) {
        var oldOwner = usersModule.findUserById(oldOwnerId);
        if (oldOwner && oldOwner.linuxUser && allowed.indexOf(oldOwnerId) === -1 && visibility !== "public") {
          revokeProjectAccess(projectPath, oldOwner.linuxUser);
        }
      }
      // Grant new owner
      if (ownerId) {
        var newOwner = usersModule.findUserById(ownerId);
        console.log("[daemon] Owner grant ACL:", ownerId, "linuxUser:", newOwner && newOwner.linuxUser, "path:", projectPath);
        if (newOwner && newOwner.linuxUser) {
          grantProjectAccess(projectPath, newOwner.linuxUser);
        }
      }
    }
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    if (relay.refreshProjectAccess) relay.refreshProjectAccess();
    return { ok: true };
  },
  onGetProjectEnv: function (slug) {
    for (var ei = 0; ei < config.projects.length; ei++) {
      if (config.projects[ei].slug === slug) {
        return { envrc: config.projects[ei].envrc || "" };
      }
    }
    return { envrc: "" };
  },
  onSetProjectEnv: function (slug, envrc) {
    for (var ei = 0; ei < config.projects.length; ei++) {
      if (config.projects[ei].slug === slug) {
        if (envrc) {
          config.projects[ei].envrc = envrc;
        } else {
          delete config.projects[ei].envrc;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetSharedEnv: function () {
    return { envrc: config.sharedEnv || "" };
  },
  onSetSharedEnv: function (envrc) {
    if (envrc) {
      config.sharedEnv = envrc;
    } else {
      delete config.sharedEnv;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetServerDefaultEffort: function () {
    return { effort: config.defaultEffort || null };
  },
  onSetServerDefaultEffort: function (effort) {
    if (effort) {
      config.defaultEffort = effort;
    } else {
      delete config.defaultEffort;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetProjectDefaultEffort: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { effort: config.projects[i].defaultEffort || null };
      }
    }
    return { effort: null };
  },
  onSetProjectDefaultEffort: function (slug, effort) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (effort) {
          config.projects[i].defaultEffort = effort;
        } else {
          delete config.projects[i].defaultEffort;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetServerDefaultModel: function () {
    return { model: config.defaultModel || null };
  },
  onSetServerDefaultModel: function (model) {
    if (model) {
      config.defaultModel = model;
    } else {
      delete config.defaultModel;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetProjectDefaultModel: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { model: config.projects[i].defaultModel || null };
      }
    }
    return { model: null };
  },
  onSetProjectDefaultModel: function (slug, model) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (model) {
          config.projects[i].defaultModel = model;
        } else {
          delete config.projects[i].defaultModel;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetProjectLastVendor: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { vendor: config.projects[i].lastVendor || null };
      }
    }
    return { vendor: null };
  },
  onSetProjectLastVendor: function (slug, vendor) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (config.projects[i].lastVendor === vendor) return { ok: true };
        if (vendor) {
          config.projects[i].lastVendor = vendor;
        } else {
          delete config.projects[i].lastVendor;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetProjectMcpServers: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return config.projects[i].enabledMcpServers || [];
      }
    }
    return [];
  },
  onSetProjectMcpServers: function (slug, servers) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (servers && servers.length > 0) {
          config.projects[i].enabledMcpServers = servers;
        } else {
          delete config.projects[i].enabledMcpServers;
        }
        saveConfig(config);
        return;
      }
    }
  },
  onGetServerDefaultMode: function () {
    return { mode: config.defaultMode || null };
  },
  onSetServerDefaultMode: function (mode) {
    if (mode) {
      config.defaultMode = mode;
    } else {
      delete config.defaultMode;
    }
    saveConfig(config);
    return { ok: true };
  },
  onGetProjectDefaultMode: function (slug) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        return { mode: config.projects[i].defaultMode || null };
      }
    }
    return { mode: null };
  },
  onSetProjectDefaultMode: function (slug, mode) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        if (mode) {
          config.projects[i].defaultMode = mode;
        } else {
          delete config.projects[i].defaultMode;
        }
        saveConfig(config);
        return { ok: true };
      }
    }
    return { ok: false, error: "Project not found" };
  },
  onGetDaemonConfig: function () {
    return {
      port: config.port,
      tls: !!tlsOptions,
      debug: !!config.debug,
      headless: !!config.headless,
      keepAwake: !!config.keepAwake,
      autoContinueOnRateLimit: !!config.autoContinueOnRateLimit,
      osUsers: !!config.osUsers,
      inheritGroups: config.inheritGroups !== false,
      chatLayout: config.chatLayout || "channel",
      matesEnabled: config.matesEnabled === true,
      capsulesEnabled: config.capsulesEnabled === true,
      pinEnabled: !!config.pinHash,
      platform: process.platform,
      hostname: os2.hostname(),
      lanIp: lanIp || null,
      updateChannel: config.updateChannel || "stable",
      imageRetentionDays: config.imageRetentionDays !== undefined ? config.imageRetentionDays : 7,
    };
  },
  onSetImageRetention: function (days) {
    var d = parseInt(days, 10);
    if (isNaN(d) || d < 0) d = 7;
    config.imageRetentionDays = d;
    saveConfig(config);
    console.log("[daemon] Image retention:", d === 0 ? "forever" : d + " days");
    return { ok: true, days: d };
  },
  onSetUpdateChannel: function (channel) {
    config.updateChannel = channel === "beta" ? "beta" : "stable";
    saveConfig(config);
    console.log("[daemon] Update channel:", config.updateChannel, "(web)");
    return { ok: true, updateChannel: config.updateChannel };
  },
  onSetPin: function (pin) {
    if (pin) {
      config.pinHash = generateAuthToken(pin);
    } else {
      config.pinHash = null;
    }
    relay.setAuthToken(config.pinHash);
    saveConfig(config);
    console.log("[daemon] PIN", pin ? "set" : "removed", "(web)");
    return { ok: true, pinEnabled: !!config.pinHash };
  },
  onUpgradePin: function (newHash) {
    config.pinHash = newHash;
    relay.setAuthToken(newHash);
    saveConfig(config);
    console.log("[daemon] PIN hash auto-upgraded to scrypt");
  },
  onSetChatLayout: function (layout) {
    var val = (layout === "bubble") ? "bubble" : "channel";
    config.chatLayout = val;
    saveConfig(config);
    console.log("[daemon] Chat layout:", val, "(web)");
    return { ok: true, chatLayout: val };
  },
  onSetTerminalFont: function (family, size) {
    var DEFAULT_FAMILY = "'SF Mono', Menlo, Monaco, 'Courier New', monospace";
    var current = config.terminalFont || { family: DEFAULT_FAMILY, size: 14 };
    var nextFamily = (typeof family === "string" && family.trim()) ? family.trim().slice(0, 200) : current.family;
    var nextSize = current.size;
    if (typeof size === "number" && size >= 9 && size <= 32) {
      nextSize = Math.round(size);
    }
    config.terminalFont = { family: nextFamily, size: nextSize };
    saveConfig(config);
    console.log("[daemon] Terminal font:", nextFamily, nextSize);
    return config.terminalFont;
  },
  onSetMateOnboarded: function () {
    config.mateOnboardingShown = true;
    saveConfig(config);
    return { ok: true };
  },
  onSetAutoContinue: function (value) {
    var want = !!value;
    config.autoContinueOnRateLimit = want;
    saveConfig(config);
    console.log("[daemon] Auto-continue on rate limit:", want, "(web)");
    return { ok: true, autoContinueOnRateLimit: want };
  },
  onSetMatesEnabled: function (value) {
    var want = !!value;
    config.matesEnabled = want;
    saveConfig(config);
    console.log("[daemon] Project Mate DMs:", want ? "shown" : "hidden", "(web)");
    return { ok: true, matesEnabled: want };
  },
  onSetCapsulesEnabled: function (value) {
    var want = value === true;
    config.capsulesEnabled = want;
    saveConfig(config);
    console.log("[daemon] Experimental Capsules:", want ? "enabled" : "disabled", "(web)");
    return { ok: true, capsulesEnabled: want };
  },
  onGetToolPalettes: function () {
    return config.toolPalettes || {};
  },
  onSetToolPalette: function (paletteName, order, hidden) {
    if (paletteName !== "session" && paletteName !== "mate") {
      return { error: "Unknown palette" };
    }
    var safeOrder = Array.isArray(order)
      ? order.filter(function (s) { return typeof s === "string"; })
      : [];
    var safeHidden = Array.isArray(hidden)
      ? hidden.filter(function (s) { return typeof s === "string"; })
      : [];
    if (!config.toolPalettes) config.toolPalettes = {};
    config.toolPalettes[paletteName] = { order: safeOrder, hidden: safeHidden };
    saveConfig(config);
    return { ok: true, palette: paletteName, order: safeOrder, hidden: safeHidden };
  },
  onSetKeepAwake: function (value) {
    var want = !!value;
    config.keepAwake = want;
    saveConfig(config);
    if (want && !caffeinateProc && process.platform === "darwin") {
      try {
        var { spawn: spawnCaff } = require("child_process");
        caffeinateProc = spawnCaff("caffeinate", ["-di"], { stdio: "ignore", detached: false });
        caffeinateProc.on("error", function () { caffeinateProc = null; });
      } catch (e) {}
    } else if (!want && caffeinateProc) {
      try { caffeinateProc.kill(); } catch (e) {}
      caffeinateProc = null;
    }
    console.log("[daemon] Keep awake:", want, "(web)");
    return { ok: true, keepAwake: want };
  },
  onSetInheritGroups: function (value) {
    var want = !!value;
    config.inheritGroups = want;
    saveConfig(config);
    // Apply live so subsequent session/terminal spawns pick it up without a
    // daemon restart; already-running sessions keep their current groups.
    osUsersMod.setInheritGroups(want);
    console.log("[daemon] Inherit supplementary groups:", want, "(web)");
    return { ok: true, inheritGroups: want };
  },
  onShutdown: function () {
    console.log("[daemon] Shutdown requested via web UI");
    gracefulShutdown();
  },
  onRestart: function () {
    console.log("[daemon] Restart requested via web UI");
    spawnAndRestart();
  },
  onSetProjectVisibility: function (slug, visibility) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        var prevVisibility = config.projects[i].visibility || "public";
        config.projects[i].visibility = visibility;
        saveConfig(config);
        console.log("[daemon] Set project visibility:", slug, "→", visibility);
        if (config.osUsers) {
          var projectPath = config.projects[i].path;
          var ownerId = config.projects[i].ownerId || null;
          // When switching to public: grant ACL to ALL clay users
          if (visibility === "public" && prevVisibility !== "public") {
            grantAllUsersAccess(projectPath, usersModule);
          }
          // When switching to private: revoke ACLs for users not in allowedUsers and not the owner
          if (visibility === "private" && prevVisibility !== "private") {
            var allowed = config.projects[i].allowedUsers || [];
            var allUsers = usersModule.getAllUsers();
            for (var u = 0; u < allUsers.length; u++) {
              var usr = allUsers[u];
              if (usr.role === "admin") continue;
              if (usr.id === ownerId) continue;
              if (usr.linuxUser && allowed.indexOf(usr.id) === -1) {
                revokeProjectAccess(projectPath, usr.linuxUser);
              }
            }
          }
        }
        if (relay.refreshProjectAccess) relay.refreshProjectAccess();
        return { ok: true };
      }
    }
    return { error: "Project not found" };
  },
  onSetProjectAllowedUsers: function (slug, allowedUsers) {
    var accessBefore = daemonProjectAccess.getProjectAccess(config, slug, config.osUsers);
    var result = daemonProjectAccess.setAllowedUsers(config, slug, allowedUsers);
    if (result.error) return result;
    var parentSlug = daemonProjectAccess.parentSlugFor(slug);
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === (parentSlug || slug)) {
        var prev = accessBefore && !accessBefore.error
          ? (parentSlug ? accessBefore.worktreeAllowedUsers : accessBefore.allowedUsers)
          : [];
        saveConfig(config);
        console.log("[daemon] Set project allowed users:", slug, "→", result.allowedUsers.length, "users");
        // OS users mode: sync ACLs for added/removed users
        // Exact-worktree grants are Clay-only and never change filesystem ACLs.
        if (config.osUsers && !parentSlug) {
          var projectPath = config.projects[i].path;
          // Grant access to newly added users
          for (var a = 0; a < allowedUsers.length; a++) {
            if (prev.indexOf(allowedUsers[a]) === -1) {
              var addedUser = usersModule.findUserById(allowedUsers[a]);
              if (addedUser && addedUser.linuxUser) {
                grantProjectAccess(projectPath, addedUser.linuxUser);
              }
            }
          }
          // Revoke access from removed users
          for (var r = 0; r < prev.length; r++) {
            if (allowedUsers.indexOf(prev[r]) === -1) {
              var removedUser = usersModule.findUserById(prev[r]);
              if (removedUser && removedUser.linuxUser) {
                revokeProjectAccess(projectPath, removedUser.linuxUser);
              }
            }
          }
        }
        if (relay.refreshProjectAccess) relay.refreshProjectAccess();
        return { ok: true };
      }
    }
    return { error: "Project not found" };
  },
  onGetProjectAccess: function (slug) {
    return daemonProjectAccess.getProjectAccess(config, slug, config.osUsers);
  },
  onUserProvisioned: function (userId, linuxUser) {
    // Grant ACL on all public projects to the newly provisioned user
    if (!config.osUsers || !linuxUser) return;
    for (var i = 0; i < config.projects.length; i++) {
      var proj = config.projects[i];
      var visibility = proj.visibility || "public";
      if (visibility === "public") {
        grantProjectAccess(proj.path, linuxUser);
      }
    }
  },
  onUserDeleted: function (userId, linuxUser) {
    // Deactivate the Linux account when a Clay user is deleted
    if (!config.osUsers || !linuxUser) return;
    deactivateLinuxUser(linuxUser);
  },
  onCreateWorktree: function (parentSlug, branchName, dirName, baseBranch, requestUser) {
    // Find the parent project
    var parent = null;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === parentSlug) { parent = config.projects[j]; break; }
    }
    if (!parent) return { ok: false, error: "Parent project not found" };
    var osUserInfo;
    try {
      osUserInfo = worktreeOsUserInfo(parent, requestUser);
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (isWorktree(parent.path, osUserInfo)) return { ok: false, error: "Cannot create worktrees from a worktree project" };
    var baseCommit = projectLogContext.commit(parent.path, baseBranch || "HEAD", osUserInfo);
    var result = createWorktree(parent.path, branchName, dirName, baseBranch, osUserInfo);
    if (!result.ok) return result;
    // Register the new worktree as ephemeral project
    var wtSlug = parentSlug + "--" + dirName;
    if (daemonProjectAccess.clearWorktreeGrant(config, wtSlug)) saveConfig(config);
    var context = projectLogContext.resolveWorktreeContext(result.path, parent.projectKnowledgeId, {
      branch: branchName,
      baseCommit: baseCommit,
    }, osUserInfo);
    var wtMeta = Object.assign({ parentSlug: parentSlug, external: false, projectKnowledgeId: parent.projectKnowledgeId }, context);
    relay.addProject(result.path, wtSlug, branchName, parent.icon, parent.ownerId, wtMeta);
    registerWorktreeSlug(parentSlug, wtSlug);
    console.log("[daemon] Created worktree:", wtSlug, "->", result.path);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: wtSlug, path: result.path };
  },
});

// Reclaim idle out-of-process agent runtimes. Any adapter that owns a child
// process may implement the optional shutdownIfIdle(ms); adapters without one
// (Claude, which runs in-process or under sdk-worker) are simply skipped.
// The CLAY_CODEX_* names are kept as aliases for backwards compatibility.
var IDLE_MS = Number(process.env.CLAY_ADAPTER_IDLE_MS) || Number(process.env.CLAY_CODEX_IDLE_MS) || 5 * 60 * 1000;
var REAP_MS = Number(process.env.CLAY_ADAPTER_REAPER_MS) || Number(process.env.CLAY_CODEX_REAPER_MS) || 60 * 1000;
var reaperHandle = setInterval(function () {
  if (!relay || typeof relay.forEachProject !== "function") return;
  relay.forEachProject(function (ctx) {
    if (!ctx || !ctx.adapters) return;
    Object.keys(ctx.adapters).forEach(function (vendor) {
      try {
        var adapter = ctx.adapters[vendor];
        if (!adapter || typeof adapter.shutdownIfIdle !== "function") return;
        var result = adapter.shutdownIfIdle(IDLE_MS);
        if (result && typeof result.catch === "function") {
          result.catch(function (e) {
            console.error("[daemon] " + vendor + " idle reclaim failed:", e && e.message ? e.message : e);
          });
        }
      } catch (e) {}
    });
  });
}, REAP_MS);
if (reaperHandle && typeof reaperHandle.unref === "function") {
  reaperHandle.unref();
}

function stopCodexReaper() {
  if (reaperHandle) {
    clearInterval(reaperHandle);
    reaperHandle = null;
  }
}

function shutdownProjects() {
  stopCodexReaper();
  try {
    var result = relay.destroyAll();
    if (result && typeof result.then === "function") {
      return result;
    }
    return Promise.resolve(true);
  } catch (e) {
    return Promise.reject(e);
  }
}

// Worktree tracking extracted to daemon-projects.js

// --- IPC server ---
// Clean up stale socket/config left by a previously killed daemon
var existingConfig = loadConfig();
if (existingConfig && existingConfig.pid && existingConfig.pid !== process.pid) {
  if (!isPidAlive(existingConfig.pid)) {
    console.log("[daemon] Clearing stale config from dead PID " + existingConfig.pid);
    clearStaleConfig();
  }
}
var ipc = createIPCServer(socketPath(), function (msg) {
  console.log("[daemon] IPC:", msg.cmd);
  switch (msg.cmd) {
    case "add_project": {
      if (!msg.path) return { ok: false, error: "missing path" };
      var absPath = path.resolve(msg.path);
      // Check if already registered
      for (var j = 0; j < config.projects.length; j++) {
        if (config.projects[j].path === absPath) {
          return { ok: true, slug: config.projects[j].slug, existing: true };
        }
      }
      var slugs = config.projects.map(function (p) { return p.slug; });
      var slug = generateSlug(absPath, slugs);
      var projectEntry = { path: absPath, slug: slug, addedAt: Date.now(), visibility: "private" };
      projectEntry.projectKnowledgeId = rememberedProjectKnowledgeId(absPath);
      relay.addProject(absPath, slug, null, null, null, null, projectRuntimeOptions(projectEntry));
      config.projects.push(projectEntry);
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Added project:", slug, "→", absPath);
      // Discover and register worktrees for the new project
      registerProjectWorktrees(projectEntry, null);
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true, slug: slug };
    }

    case "remove_project": {
      if (!msg.path && !msg.slug) return { ok: false, error: "missing path or slug" };
      var target = msg.slug;
      if (!target) {
        var abs = path.resolve(msg.path);
        for (var k = 0; k < config.projects.length; k++) {
          if (config.projects[k].path === abs) {
            target = config.projects[k].slug;
            break;
          }
        }
      }
      if (!target) return { ok: false, error: "project not found" };
      var removedProject = null;
      for (var ri = 0; ri < config.projects.length; ri++) {
        if (config.projects[ri].slug === target) { removedProject = config.projects[ri]; break; }
      }
      if (removedProject) {
        if (!config.removedProjects) config.removedProjects = [];
        config.removedProjects.push({
          path: removedProject.path,
          title: removedProject.title || null,
          icon: removedProject.icon || null,
          projectKnowledgeId: removedProject.projectKnowledgeId || null,
          removedAt: Date.now(),
        });
        if (config.removedProjects.length > 20) {
          config.removedProjects = config.removedProjects.slice(config.removedProjects.length - 20);
        }
      }
      relay.removeProject(target);
      config.projects = config.projects.filter(function (p) { return p.slug !== target; });
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Removed project:", target);
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true };
    }

    case "get_status":
      return {
        ok: true,
        pid: process.pid,
        port: config.port,
        tls: !!tlsOptions,
        keepAwake: !!config.keepAwake,
        osUsers: !!config.osUsers,
        projects: relay.getProjects(),
        uptime: process.uptime(),
      };

    case "set_pin": {
      config.pinHash = msg.pinHash || null;
      relay.setAuthToken(config.pinHash);
      saveConfig(config);
      return { ok: true };
    }

    case "set_project_title": {
      if (!msg.slug) return { ok: false, error: "missing slug" };
      var newTitle = msg.title || null;
      relay.setProjectTitle(msg.slug, newTitle);
      for (var ti = 0; ti < config.projects.length; ti++) {
        if (config.projects[ti].slug === msg.slug) {
          if (newTitle) {
            config.projects[ti].title = newTitle;
          } else {
            delete config.projects[ti].title;
          }
          break;
        }
      }
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Project title:", msg.slug, "→", newTitle || "(default)");
      relay.broadcastAll({
        type: "projects_updated",
        projects: relay.getProjects(),
        projectCount: config.projects.length,
      });
      return { ok: true };
    }

    case "set_os_users": {
      var enableOsUsers = !!msg.value;
      if (enableOsUsers) {
        // Pre-flight: check if setfacl is available
        var aclCheck = checkAclSupport();
        if (!aclCheck.available) {
          return { error: "acl_not_installed", installCmd: aclCheck.installCmd };
        }
      }
      config.osUsers = enableOsUsers;
      saveConfig(config);
      console.log("[daemon] OS users:", enableOsUsers);
      // Provisioning is handled by CLI (which has terminal access for progress).
      // Daemon only saves the flag. On next restart, daemon will pick it up.
      return { ok: true };
    }

    case "set_auto_continue": {
      var acWant = !!msg.value;
      config.autoContinueOnRateLimit = acWant;
      saveConfig(config);
      console.log("[daemon] Auto-continue on rate limit:", acWant, "(cli)");
      return { ok: true, autoContinueOnRateLimit: acWant };
    }

    case "set_keep_awake": {
      var want = !!msg.value;
      config.keepAwake = want;
      saveConfig(config);
      if (want && !caffeinateProc && process.platform === "darwin") {
        try {
          var { spawn: spawnCaff } = require("child_process");
          caffeinateProc = spawnCaff("caffeinate", ["-di"], { stdio: "ignore", detached: false });
          caffeinateProc.on("error", function () { caffeinateProc = null; });
        } catch (e) {}
      } else if (!want && caffeinateProc) {
        try { caffeinateProc.kill(); } catch (e) {}
        caffeinateProc = null;
      }
      console.log("[daemon] Keep awake:", want);
      return { ok: true };
    }

    case "enable_recovery": {
      if (!msg.urlPath || !msg.password) return { ok: false, error: "missing urlPath or password" };
      relay.setRecovery(msg.urlPath, msg.password);
      console.log("[daemon] Admin recovery mode enabled");
      return { ok: true };
    }

    case "disable_recovery": {
      relay.clearRecovery();
      console.log("[daemon] Admin recovery mode disabled");
      return { ok: true };
    }

    case "shutdown":
      console.log("[daemon] Shutdown requested via IPC");
      gracefulShutdown();
      return { ok: true };

    case "restart":
      console.log("[daemon] Restart requested via IPC");
      spawnAndRestart();
      return { ok: true };

    case "update": {
      if (config.headless) {
        console.log("[daemon] Update & restart requested via IPC — blocked (headless mode)");
        return { ok: false, error: "Auto-update is disabled in headless mode" };
      }
      console.log("[daemon] Update & restart requested via IPC");

      // Dev mode (config.debug): just exit with code 120, cli.js dev watcher respawns daemon
      if (config.debug) {
        console.log("[daemon] Dev mode — restarting via dev watcher");
        updateHandoff = true;
        setTimeout(function () { gracefulShutdown(); }, 100);
        return { ok: true };
      }

      // Production: fetch latest via npx, then spawn updated daemon
      var { execSync: execSyncUpd, spawn: spawnUpd } = require("child_process");
      var updTag = config.updateChannel === "beta" ? "beta" : "latest";
      var updDaemonScript;
      try {
        // npx downloads the package and puts a bin symlink; `which` prints its path
        var binPath = execSyncUpd(
          "npx --yes --package=clay-server@" + updTag + " -- which clay-server",
          { stdio: ["ignore", "pipe", "pipe"], timeout: 120000, encoding: "utf8" }
        ).trim();
        // Resolve symlink to get the actual package directory
        var realBin = fs.realpathSync(binPath);
        updDaemonScript = path.join(path.dirname(realBin), "..", "lib", "daemon.js");
        updDaemonScript = path.resolve(updDaemonScript);
        console.log("[daemon] Resolved updated daemon:", updDaemonScript);
      } catch (updErr) {
        console.log("[daemon] npx resolve failed:", updErr.message);
        // Fallback: restart with current code
        updDaemonScript = path.join(__dirname, "daemon.js");
      }
      // Spawn new daemon process — it will retry if port is still in use
      var { logPath: updLogPath, configPath: updConfigPath } = require("./config");
      var updLogFd = fs.openSync(updLogPath(), "a");
      var updChild = spawnUpd(process.execPath, [updDaemonScript], {
        detached: true,
        windowsHide: true,
        stdio: ["ignore", updLogFd, updLogFd],
        env: Object.assign({}, process.env, {
          CLAY_CONFIG: updConfigPath(),
        }),
      });
      updChild.unref();
      fs.closeSync(updLogFd);
      config.pid = updChild.pid;
      saveConfig(config);
      console.log("[daemon] Spawned new daemon (PID " + updChild.pid + "), shutting down...");
      updateHandoff = true;
      setTimeout(function () { gracefulShutdown(); }, 100);
      return { ok: true };
    }

    default:
      return { ok: false, error: "unknown command: " + msg.cmd };
  }
});

// --- Register projects ---
var projects = config.projects || [];
for (var i = 0; i < projects.length; i++) {
  var p = projects[i];
  if (fs.existsSync(p.path)) {
    console.log("[daemon] Adding project:", p.slug, "→", p.path);
    relay.addProject(p.path, p.slug, p.title, p.icon, p.ownerId, null, projectRuntimeOptions(p));
    // Discover and register worktrees for this project
    registerProjectWorktrees(p, null);
  } else {
    console.log("[daemon] Skipping missing project:", p.path);
  }
}

// Migrate legacy mates storage before registration
mates.migrateLegacyMates();

// Import durable Mate knowledge into the Clay-wide Knowledge backend. Runs on
// every start, imports nothing when there is nothing new, and never touches
// the legacy files that remain the live source for existing read paths.
mateKnowledgeMigration.runAtStartup({
  extraRoots: (function () {
    var roots = [];
    try {
      if (!usersModule.isMultiUser()) return roots;
      var all = usersModule.getAllUsers() || [];
      for (var mi = 0; mi < all.length; mi++) {
        if (!all[mi] || !all[mi].linuxUser) continue;
        roots.push({
          userId: all[mi].id,
          matesRoot: mates.resolveMatesRoot({ userId: all[mi].id, multiUser: true, linuxUser: all[mi].linuxUser }),
        });
      }
    } catch (e) {}
    return roots;
  })(),
});

// Register existing mates as projects
if (usersModule.isMultiUser()) {
  // Multi-user mode: iterate over all users and load each user's mates
  var allUsers = usersModule.getAllUsers();
  for (var ui = 0; ui < allUsers.length; ui++) {
    var mateCtx = mates.buildMateCtx(allUsers[ui].id);
    var userMates = mates.getAllMates(mateCtx);
    for (var mi = 0; mi < userMates.length; mi++) {
      var m = userMates[mi];
      var mateDir = mates.getMateDir(mateCtx, m.id);
      var mateSlug = "mate-" + m.id;
      var mateName = (m.profile && m.profile.displayName) || m.name || "New Mate";
      if (fs.existsSync(mateDir)) {
        var mateDef = m.builtinKey ? require("./builtin-mates").getBuiltinByKey(m.builtinKey) : null;
        var isHost = !!(mateDef && mateDef.hostAgent);
        console.log("[daemon] Adding mate project:", mateSlug + (isHost ? " (host agent)" : ""));
        relay.addProject(mateDir, mateSlug, mateName, null, m.createdBy, null, { isMate: true, mateDisplayName: mateName, isHostAgent: isHost });
      }
    }
  }
} else {
  // Single-user mode: use null ctx
  var mateCtx = mates.buildMateCtx(null);
  var allMates = mates.getAllMates(mateCtx);
  for (var mi = 0; mi < allMates.length; mi++) {
    var m = allMates[mi];
    var mateDir = mates.getMateDir(mateCtx, m.id);
    var mateSlug = "mate-" + m.id;
    var mateName = (m.profile && m.profile.displayName) || m.name || "New Mate";
    if (fs.existsSync(mateDir)) {
      var mateDef2 = m.builtinKey ? require("./builtin-mates").getBuiltinByKey(m.builtinKey) : null;
      var isHost2 = !!(mateDef2 && mateDef2.hostAgent);
      console.log("[daemon] Adding mate project:", mateSlug + (isHost2 ? " (host agent)" : ""));
      relay.addProject(mateDir, mateSlug, mateName, null, m.createdBy, null, { isMate: true, mateDisplayName: mateName, isHostAgent: isHost2 });
    }
  }
}

// Sync ~/.clayrc on startup
try { syncClayrc(config.projects); } catch (e) {}

// --- Cleanup stale SDK warmup CLI session files ---
//
// On adapter init the SDK is given a dummy "hi" prompt to discover models,
// skills, and capabilities. Even though we abort before any response
// arrives, the SDK creates a real CLI session jsonl on disk. Going forward
// we delete those inline (see lib/yoke/adapters/claude.js and
// claude-worker.js), but installs from before that fix can have a long
// tail of "hi"-only sessions polluting the Resume CLI session dialog.
//
// On every daemon startup we scan REAL_HOME/.claude/projects/*/ and unlink
// files that match a strict warmup signature so legitimate "hi" sessions
// from real users are never touched. All checks must pass:
//
//   1. file size < 64 KB                  (real sessions grow past this fast;
//      threshold is generous because warmup files include the SDK's
//      skill_listing / deferred_tools attachments which can run into the
//      tens of KB on its own)
//   2. mtime older than 60 seconds        (avoid racing an in-flight warmup)
//   3. exactly one real user prompt equal to literal "hi" (the automatic
//      interruption record written when the probe is aborted is ignored)
//   4. zero assistant messages            (real users virtually always get a reply)
//
// Multi-user OS-isolated installs have per-user ~/.claude trees that the
// daemon process can't traverse; the inline cleanup in claude-worker.js
// covers those.
function cleanupSdkWarmupSessions() {
  var sessionHygiene = require("./session-hygiene");
  var projectsRoot = path.join(REAL_HOME, ".claude", "projects");
  var projectDirs;
  try { projectDirs = fs.readdirSync(projectsRoot, { withFileTypes: true }); }
  catch (e) { return; }

  var deleted = 0;
  var nowMs = Date.now();
  var MAX_BYTES = 64 * 1024;
  var MIN_AGE_MS = 60 * 1000;

  for (var di = 0; di < projectDirs.length; di++) {
    if (!projectDirs[di].isDirectory()) continue;
    var projDir = path.join(projectsRoot, projectDirs[di].name);
    var files;
    try { files = fs.readdirSync(projDir); } catch (e) { continue; }

    for (var fi = 0; fi < files.length; fi++) {
      var f = files[fi];
      if (!f.endsWith(".jsonl")) continue;
      var fp = path.join(projDir, f);

      var st;
      try { st = fs.statSync(fp); } catch (e) { continue; }
      if (st.size >= MAX_BYTES) continue;
      if (nowMs - st.mtimeMs < MIN_AGE_MS) continue;

      var raw;
      try { raw = fs.readFileSync(fp, "utf8"); } catch (e) { continue; }
      var lines = raw.split("\n");
      var events = [];
      var parseOk = true;
      for (var li = 0; li < lines.length; li++) {
        var line = lines[li];
        if (!line) continue;
        var ev;
        try { ev = JSON.parse(line); } catch (e) { parseOk = false; break; }
        if (!ev || typeof ev !== "object") continue;
        events.push(ev);
      }
      if (!parseOk) continue;
      if (!sessionHygiene.isClaudeWarmupTranscript(events)) continue;

      try { fs.unlinkSync(fp); deleted++; } catch (e) {}
    }
  }

  if (deleted > 0) {
    console.log("[daemon] Removed " + deleted + " stale SDK warmup session file(s)");
  }
}

// --- Start listening (with retry for port-in-use during update handoff) ---
var listenRetries = 0;
var MAX_LISTEN_RETRIES = 15;

function startListening() {
  // One-shot cleanup of stale SDK warmup CLI session files from previous
  // daemon runs (best-effort, never fatal).
  try { cleanupSdkWarmupSessions(); } catch (e) {}

  relay.server.listen(config.port, listenHost, function () {
    var protocol = tlsOptions ? "https" : "http";
    console.log("[daemon] Listening on " + protocol + "://" + listenHost + ":" + config.port);
    console.log("[daemon] PID:", process.pid);
    console.log("[daemon] Projects:", config.projects.length);

    // Update PID in config
    config.pid = process.pid;
    saveConfig(config);

    // Auto-provision Linux accounts on startup if OS users mode is enabled.
    // ACLs are NOT re-applied on every startup (too slow with recursive setfacl).
    // ACLs are set when: projects are added, users are added, or visibility changes.
    if (config.osUsers) {
      setTimeout(function () {
        try { ensureProjectsDir(); } catch (e) {}
        try {
          var provResult = provisionAllUsers(usersModule);
          if (provResult.provisioned.length > 0) {
            console.log("[daemon] Auto-provisioned " + provResult.provisioned.length + " Linux account(s) on startup");
            // Only set ACLs for newly provisioned users (not all users on all projects)
            for (var pi = 0; pi < config.projects.length; pi++) {
              var proj = config.projects[pi];
              if ((proj.visibility || "public") === "public") {
                for (var ni = 0; ni < provResult.provisioned.length; ni++) {
                  try {
                    grantProjectAccess(proj.path, provResult.provisioned[ni].linuxUser);
                  } catch (e) {}
                }
              }
            }
          }
          if (provResult.errors.length > 0) {
            console.error("[daemon] Failed to provision " + provResult.errors.length + " account(s)");
          }
        } catch (provErr) {
          console.error("[daemon] Startup provisioning error:", provErr.message);
        }
        console.log("[daemon] Startup OS users check complete.");

        // Diagnostics run after provisioning, never affect provisioning or serving.
        scheduleOsUserDiagnosticsAsync({
          getUsers: function() { return usersModule.getAllUsers(); },
          getProjects: function() { return config.projects; },
        });
      }, 100);
    }

    // Check for crash info from a previous crash and notify clients
    var crashInfo = readCrashInfo();
    if (crashInfo) {
      console.log("[daemon] Recovered from crash at", new Date(crashInfo.time).toISOString());
      console.log("[daemon] Crash reason:", crashInfo.reason);
      // Delay notification so clients have time to reconnect
      setTimeout(function () {
        relay.broadcastAll({
          type: "toast",
          level: "warn",
          message: "Server recovered from a crash and was automatically restarted.",
          detail: crashInfo.reason || null,
        });
      }, 3000);
      clearCrashInfo();
    }
  });
}

relay.server.on("error", function (err) {
  if (err.code === "EADDRINUSE" && listenRetries < MAX_LISTEN_RETRIES) {
    listenRetries++;
    console.log("[daemon] Port " + config.port + " in use, retrying (" + listenRetries + "/" + MAX_LISTEN_RETRIES + ")...");
    setTimeout(startListening, 1000);
    return;
  }
  console.error("[daemon] Server error:", err.message);
  writeCrashInfo({
    reason: "Server error: " + err.message,
    pid: process.pid,
    time: Date.now(),
  });
  process.exit(1);
});

startListening();

// --- HTTP onboarding server (only when TLS is active) ---
if (relay.onboardingServer) {
  var onboardingPort = config.port + 1;
  relay.onboardingServer.on("error", function (err) {
    console.error("[daemon] Onboarding HTTP server error:", err.message);
  });
  relay.onboardingServer.listen(onboardingPort, listenHost, function () {
    console.log("[daemon] Onboarding HTTP on http://" + listenHost + ":" + onboardingPort);
  });
}

// --- Caffeinate (macOS) ---
var caffeinateProc = null;
if (config.keepAwake && process.platform === "darwin") {
  try {
    var { spawn } = require("child_process");
    caffeinateProc = spawn("caffeinate", ["-di"], { stdio: "ignore", detached: false });
    caffeinateProc.on("error", function () { caffeinateProc = null; });
  } catch (e) {}
}

// --- Spawn new daemon and graceful restart ---
function spawnAndRestart() {
  try {
    updateHandoff = true;
    ipc.close();
    shutdownProjects().then(function () {
      if (relay.onboardingServer) relay.onboardingServer.close();

      // Close the server first so the port is released before spawning the new daemon
      relay.server.close(function () {
        try {
          var { spawn: spawnRestart } = require("child_process");
          var { logPath: restartLogPath, configPath: restartConfigPath } = require("./config");
          var daemonScript = path.join(__dirname, "daemon.js");
          var logFd = fs.openSync(restartLogPath(), "a");
          var child = spawnRestart(process.execPath, [daemonScript], {
            detached: true,
            windowsHide: true,
            stdio: ["ignore", logFd, logFd],
            env: Object.assign({}, process.env, {
              CLAY_CONFIG: restartConfigPath(),
            }),
          });
          child.unref();
          fs.closeSync(logFd);
          config.pid = child.pid;
          saveConfig(config);
          console.log("[daemon] Spawned new daemon (PID " + child.pid + "), exiting.");
          process.exit(120);
        } catch (e) {
          console.error("[daemon] Restart failed:", e.message);
          process.exit(1);
        }
      });
    }).catch(function (e) {
      console.error("[daemon] Restart shutdown failed:", e && e.message ? e.message : e);
      if (relay.onboardingServer) relay.onboardingServer.close();
      relay.server.close(function () {
        process.exit(1);
      });
    });

    // Force exit after 10 seconds if server.close hangs
    setTimeout(function () {
      console.error("[daemon] Forced exit after timeout during restart");
      process.exit(1);
    }, 10000);
  } catch (e) {
    console.error("[daemon] Restart failed:", e.message);
    relay.broadcastAll({ type: "toast", level: "error", message: "Restart failed: " + e.message });
    relay.broadcastAll({ type: "restart_server_result", ok: false, error: e.message });
  }
}

// --- Graceful shutdown ---
var updateHandoff = false; // true when shutting down for update (new daemon already spawned)
var shutdownStarted = false;

function gracefulShutdown() {
  try { console.log("[daemon] Shutting down..."); } catch (e) {}
  if (shutdownStarted) return;
  shutdownStarted = true;
  var exitCode = updateHandoff ? 120 : 0; // 120 = update handoff, don't auto-restart

  if (caffeinateProc) {
    try { caffeinateProc.kill(); } catch (e) {}
  }

  ipc.close();

  // Remove PID from config (skip if update handoff — new daemon PID is already saved)
  if (!updateHandoff) {
    try {
      var c = loadConfig();
      if (c && c.pid === process.pid) {
        delete c.pid;
        saveConfig(c);
      }
    } catch (e) {}
  }

  shutdownProjects().then(function () {
    if (relay.onboardingServer) {
      relay.onboardingServer.close();
    }

    relay.server.close(function () {
      try { console.log("[daemon] Server closed"); } catch (e) {}
      process.exit(exitCode);
    });
  }).catch(function (e) {
    console.error("[daemon] Shutdown cleanup failed:", e && e.message ? e.message : e);
    if (relay.onboardingServer) {
      relay.onboardingServer.close();
    }
    relay.server.close(function () {
      process.exit(exitCode);
    });
  });

  // Force exit after 10 seconds
  setTimeout(function () {
    try { console.error("[daemon] Forced exit after timeout"); } catch (e) {}
    process.exit(1);
  }, 10000);
}

process.on("SIGTERM", gracefulShutdown);
process.on("SIGINT", gracefulShutdown);

// Last-resort cleanup: kill caffeinate if process exits without graceful shutdown
process.on("exit", function () {
  if (caffeinateProc) {
    try { caffeinateProc.kill(); } catch (e) {}
  }
});

// Windows emits SIGHUP when console window closes
if (process.platform === "win32") {
  process.on("SIGHUP", gracefulShutdown);
}

process.on("uncaughtException", function (err) {
  var errMsg = err ? (err.message || String(err)) : "";
  var isAbort = errMsg.indexOf("Operation aborted") !== -1
    || errMsg.indexOf("AbortError") !== -1
    || (err && err.name === "AbortError");

  if (isAbort) {
    // A single session's SDK write was aborted (e.g. stream closed before
    // write completed). This is recoverable, so do NOT tear down the whole
    // daemon and kill every other session.
    try { console.error("[daemon] Suppressed AbortError (single-session failure):", errMsg); } catch (e) {}
    return;
  }

  // EIO/EPIPE on stdout/stderr when parent process (dev mode CLI) dies.
  // Not fatal for the daemon itself.
  var isIOError = errMsg.indexOf("EIO") !== -1 || errMsg.indexOf("EPIPE") !== -1;
  if (isIOError) {
    return;
  }

  console.error("[daemon] Uncaught exception:", err);
  writeCrashInfo({
    reason: err ? (err.stack || err.message || String(err)) : "unknown",
    pid: process.pid,
    time: Date.now(),
  });
  gracefulShutdown();
});

process.on("unhandledRejection", function (reason) {
  var errMsg = reason ? (reason.message || String(reason)) : "";
  var isAbort = errMsg.indexOf("Operation aborted") !== -1
    || errMsg.indexOf("AbortError") !== -1
    || (reason && reason.name === "AbortError");

  if (isAbort) {
    console.error("[daemon] Suppressed unhandled rejection (AbortError):", errMsg);
    return;
  }

  console.error("[daemon] Unhandled rejection:", reason);
});
