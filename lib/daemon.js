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
var { loadConfig, saveConfig, socketPath, generateSlug, syncClayrc, removeFromClayrc, writeCrashInfo, readCrashInfo, clearCrashInfo, isPidAlive, clearStaleConfig } = require("./config");
var { createIPCServer } = require("./ipc");
var { createServer, generateAuthToken } = require("./server");

var configFile = process.env.CLAY_CONFIG || process.env.CLAUDE_RELAY_CONFIG || require("./config").configPath();
var config;

try {
  config = JSON.parse(fs.readFileSync(configFile, "utf8"));
} catch (e) {
  console.error("[daemon] Failed to read config:", e.message);
  process.exit(1);
}

// --- TLS ---
var tlsOptions = null;
if (config.tls) {
  var os = require("os");
  var certDir = path.join(process.env.CLAY_HOME || process.env.CLAUDE_RELAY_HOME || path.join(os.homedir(), ".clay"), "certs");
  var keyPath = path.join(certDir, "key.pem");
  var certPath = path.join(certDir, "cert.pem");
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
try {
  var { execSync } = require("child_process");
  caRoot = path.join(
    execSync("mkcert -CAROOT", { encoding: "utf8" }).trim(),
    "rootCA.pem"
  );
  if (!fs.existsSync(caRoot)) caRoot = null;
} catch (e) {}

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

// --- Create multi-project server ---
var listenHost = config.host || "0.0.0.0";

var relay = createServer({
  tlsOptions: tlsOptions,
  caPath: caRoot,
  pinHash: config.pinHash || null,
  port: config.port,
  debug: config.debug || false,
  dangerouslySkipPermissions: config.dangerouslySkipPermissions || false,
  lanHost: lanIp ? lanIp + ":" + config.port : null,
  onAddProject: function (absPath) {
    // Check if already registered
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].path === absPath) {
        return { ok: true, slug: config.projects[j].slug, existing: true };
      }
    }
    var slugs = config.projects.map(function (p) { return p.slug; });
    var slug = generateSlug(absPath, slugs);
    relay.addProject(absPath, slug);
    config.projects.push({ path: absPath, slug: slug, addedAt: Date.now() });
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Added project (web):", slug, "→", absPath);
    // Discover and register worktrees for the new project
    registerWorktrees({ path: absPath, slug: slug, title: null, icon: null });
    // Broadcast updated project list to all clients
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: slug };
  },
  onRemoveProject: function (slug) {
    // Check if this is a worktree project (ephemeral, not in config)
    var isWorktree = slug.indexOf("--") !== -1;
    var found = false;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === slug) { found = true; break; }
    }
    if (!found && !isWorktree) return { ok: false, error: "Project not found" };
    if (isWorktree) {
      // Just remove the ephemeral worktree project
      relay.removeProject(slug);
      // Remove from worktreeSlugs tracking
      var parentSlug = slug.split("--")[0];
      if (worktreeSlugs[parentSlug]) {
        worktreeSlugs[parentSlug] = worktreeSlugs[parentSlug].filter(function (s) { return s !== slug; });
      }
      console.log("[daemon] Removed worktree (web):", slug);
    } else {
      // Find path before removing so we can clean up .clayrc
      var removedPath = null;
      for (var rj = 0; rj < config.projects.length; rj++) {
        if (config.projects[rj].slug === slug) { removedPath = config.projects[rj].path; break; }
      }
      // Also remove any worktrees belonging to this parent
      var wtSlugs = worktreeSlugs[slug] || [];
      for (var wri = 0; wri < wtSlugs.length; wri++) {
        relay.removeProject(wtSlugs[wri]);
        console.log("[daemon] Removed worktree of parent:", wtSlugs[wri]);
      }
      delete worktreeSlugs[slug];
      relay.removeProject(slug);
      config.projects = config.projects.filter(function (p) { return p.slug !== slug; });
      saveConfig(config);
      // Remove from .clayrc so it doesn't appear in restore prompt
      if (removedPath) { try { removeFromClayrc(removedPath); } catch (e) {} }
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Removed project (web):", slug);
    }
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
  },
  onCreateWorktree: function (parentSlug, branchName, baseBranch) {
    // Find the parent project
    var parent = null;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === parentSlug) { parent = config.projects[j]; break; }
    }
    if (!parent) return { ok: false, error: "Parent project not found" };
    // Find a git directory to run the command from
    var gitCwd = parent.path;
    try {
      execSync("git rev-parse --git-dir", { cwd: gitCwd, encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
    } catch (e) {
      // Parent path isn't a git repo — find a subdirectory that is
      try {
        var entries = fs.readdirSync(parent.path, { withFileTypes: true });
        gitCwd = null;
        for (var ei = 0; ei < entries.length; ei++) {
          if (!entries[ei].isDirectory()) continue;
          var sub = path.join(parent.path, entries[ei].name);
          try {
            execSync("git rev-parse --git-dir", { cwd: sub, encoding: "utf8", timeout: 3000, stdio: ["pipe", "pipe", "pipe"] });
            gitCwd = sub;
            break;
          } catch (e2) { continue; }
        }
      } catch (e3) {}
      if (!gitCwd) return { ok: false, error: "No git repository found in project" };
    }
    // Create the worktree
    var wtPath = path.join(parent.path, branchName);
    var base = baseBranch || "develop";
    try {
      execSync("git worktree add " + JSON.stringify(wtPath) + " -b " + JSON.stringify(branchName) + " " + JSON.stringify(base), {
        cwd: gitCwd, encoding: "utf8", timeout: 15000
      });
    } catch (e) {
      // Branch might already exist — try without -b
      try {
        execSync("git worktree add " + JSON.stringify(wtPath) + " " + JSON.stringify(branchName), {
          cwd: gitCwd, encoding: "utf8", timeout: 15000
        });
      } catch (e2) {
        return { ok: false, error: e2.message || "Failed to create worktree" };
      }
    }
    // Register the new worktree
    var wtSlug = parentSlug + "--" + branchName;
    var wtTitle = branchName;
    console.log("[daemon] Created worktree:", wtSlug, "→", wtPath);
    relay.addProject(wtPath, wtSlug, wtTitle, parent.icon, parentSlug);
    if (!worktreeSlugs[parentSlug]) worktreeSlugs[parentSlug] = [];
    worktreeSlugs[parentSlug].push(wtSlug);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: wtSlug, path: wtPath };
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
      keepAwake: !!config.keepAwake,
      pinEnabled: !!config.pinHash,
      platform: process.platform,
    };
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
        config.projects[i].visibility = visibility;
        saveConfig(config);
        console.log("[daemon] Set project visibility:", slug, "→", visibility);
        return { ok: true };
      }
    }
    return { error: "Project not found" };
  },
  onSetProjectAllowedUsers: function (slug, allowedUsers) {
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === slug) {
        config.projects[i].allowedUsers = allowedUsers;
        saveConfig(config);
        console.log("[daemon] Set project allowed users:", slug, "→", allowedUsers.length, "users");
        return { ok: true };
      }
    }
    return { error: "Project not found" };
  },
  onGetProjectAccess: function (slug) {
    // For worktree projects, inherit access from parent
    var lookupSlug = slug;
    if (slug.indexOf("--") !== -1) {
      lookupSlug = slug.split("--")[0];
    }
    for (var i = 0; i < config.projects.length; i++) {
      if (config.projects[i].slug === lookupSlug) {
        return {
          slug: slug,
          visibility: config.projects[i].visibility || "public",
          allowedUsers: config.projects[i].allowedUsers || [],
        };
      }
    }
    return { error: "Project not found" };
  },
});

// --- Git worktree discovery ---
function parseWorktreeOutput(output) {
  var worktrees = [];
  var current = {};
  var lines = output.split("\n");
  for (var li = 0; li < lines.length; li++) {
    var line = lines[li];
    if (line.startsWith("worktree ")) {
      if (current.path) worktrees.push(current);
      current = { path: line.slice(9) };
      current.dirName = path.basename(current.path);
    } else if (line.startsWith("branch ")) {
      current.branch = line.slice(7).split("/").pop();
    } else if (line === "bare") {
      current.bare = true;
    } else if (line === "detached") {
      current.detached = true;
    }
  }
  if (current.path) worktrees.push(current);
  return worktrees.filter(function (w) { return !w.bare; });
}

function discoverWorktrees(projectPath) {
  // Try running git worktree list directly in the project path
  try {
    var output = execSync("git worktree list --porcelain", {
      cwd: projectPath, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
    });
    var worktrees = parseWorktreeOutput(output);
    // Filter out the main worktree (same as projectPath)
    return worktrees.filter(function (w) {
      return path.resolve(w.path) !== path.resolve(projectPath);
    });
  } catch (e) {
    // Not a git repo — check if subdirectories are worktrees
    // (project registered at parent directory containing worktree dirs)
  }
  try {
    var entries = fs.readdirSync(projectPath, { withFileTypes: true });
    for (var ei = 0; ei < entries.length; ei++) {
      if (!entries[ei].isDirectory()) continue;
      var subPath = path.join(projectPath, entries[ei].name);
      try {
        var subOutput = execSync("git worktree list --porcelain", {
          cwd: subPath, encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"]
        });
        var allWt = parseWorktreeOutput(subOutput);
        if (allWt.length > 1) {
          return allWt;
        }
      } catch (e2) {
        continue;
      }
    }
  } catch (e3) {}
  return [];
}

// Track worktree slugs for periodic re-scan cleanup
var worktreeSlugs = {};

function registerWorktrees(p) {
  var worktrees = discoverWorktrees(p.path);
  for (var wi = 0; wi < worktrees.length; wi++) {
    var wt = worktrees[wi];
    var wtSlug = p.slug + "--" + wt.dirName;
    if (relay.getProjects().some(function (pr) { return pr.slug === wtSlug; })) continue;
    var wtTitle = wt.dirName;
    console.log("[daemon] Adding worktree:", wtSlug, "→", wt.path);
    relay.addProject(wt.path, wtSlug, wtTitle, p.icon, p.slug);
    if (!worktreeSlugs[p.slug]) worktreeSlugs[p.slug] = [];
    worktreeSlugs[p.slug].push(wtSlug);
  }
}

// --- Register projects ---
var projects = config.projects || [];
for (var i = 0; i < projects.length; i++) {
  var p = projects[i];
  if (fs.existsSync(p.path)) {
    console.log("[daemon] Adding project:", p.slug, "→", p.path);
    relay.addProject(p.path, p.slug, p.title, p.icon);
    registerWorktrees(p);
  } else {
    console.log("[daemon] Skipping missing project:", p.path);
  }
}

// Sync ~/.clayrc on startup
try { syncClayrc(config.projects); } catch (e) {}

// --- Periodic worktree rescan ---
// Picks up worktrees created/removed externally (e.g. via `git worktree add` in terminal)
function rescanAllWorktrees() {
  var changed = false;
  var projects = config.projects || [];
  for (var ri = 0; ri < projects.length; ri++) {
    var p = projects[ri];
    if (!fs.existsSync(p.path)) continue;
    var discovered = discoverWorktrees(p.path);
    // Build set of discovered worktree paths
    var discoveredPaths = {};
    for (var di = 0; di < discovered.length; di++) {
      discoveredPaths[path.resolve(discovered[di].path)] = discovered[di];
    }
    // Add new worktrees not yet registered
    for (var di2 = 0; di2 < discovered.length; di2++) {
      var wt = discovered[di2];
      var wtSlug = p.slug + "--" + wt.dirName;
      if (relay.getProjects().some(function (pr) { return pr.slug === wtSlug; })) continue;
      var wtTitle = wt.dirName;
      console.log("[daemon] Rescan: adding worktree:", wtSlug, "→", wt.path);
      relay.addProject(wt.path, wtSlug, wtTitle, p.icon, p.slug);
      if (!worktreeSlugs[p.slug]) worktreeSlugs[p.slug] = [];
      worktreeSlugs[p.slug].push(wtSlug);
      changed = true;
    }
    // Remove stale worktrees that no longer exist on disk
    var tracked = worktreeSlugs[p.slug] || [];
    for (var ti = tracked.length - 1; ti >= 0; ti--) {
      var tSlug = tracked[ti];
      var proj = relay.getProjects().find(function (pr) { return pr.slug === tSlug; });
      if (proj && !fs.existsSync(proj.path)) {
        console.log("[daemon] Rescan: removing stale worktree:", tSlug);
        relay.removeProject(tSlug);
        tracked.splice(ti, 1);
        changed = true;
      }
    }
  }
  if (changed) {
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
  }
}

setInterval(rescanAllWorktrees, 5000);

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
      relay.addProject(absPath, slug);
      config.projects.push({ path: absPath, slug: slug, addedAt: Date.now() });
      saveConfig(config);
      try { syncClayrc(config.projects); } catch (e) {}
      console.log("[daemon] Added project:", slug, "→", absPath);
      // Discover and register worktrees for the new project
      registerWorktrees({ path: absPath, slug: slug, title: null, icon: null });
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

    case "shutdown":
      console.log("[daemon] Shutdown requested via IPC");
      gracefulShutdown();
      return { ok: true };

    case "restart":
      console.log("[daemon] Restart requested via IPC");
      spawnAndRestart();
      return { ok: true };

    case "update": {
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
      var updDaemonScript;
      try {
        // npx downloads the package and puts a bin symlink; `which` prints its path
        var binPath = execSyncUpd(
          "npx --yes --package=clay-server@latest -- which clay-server",
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

// --- Start listening (with retry for port-in-use during update handoff) ---
var listenRetries = 0;
var MAX_LISTEN_RETRIES = 15;

function startListening() {
  relay.server.listen(config.port, listenHost, function () {
    var protocol = tlsOptions ? "https" : "http";
    console.log("[daemon] Listening on " + protocol + "://" + listenHost + ":" + config.port);
    console.log("[daemon] PID:", process.pid);
    console.log("[daemon] Projects:", config.projects.length);

    // Update PID in config
    config.pid = process.pid;
    saveConfig(config);

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
  console.log("[daemon] Spawned new daemon (PID " + child.pid + "), shutting down...");
  updateHandoff = true;
  setTimeout(function () { gracefulShutdown(); }, 100);
}

// --- Graceful shutdown ---
var updateHandoff = false; // true when shutting down for update (new daemon already spawned)

function gracefulShutdown() {
  console.log("[daemon] Shutting down...");
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

  relay.destroyAll();

  if (relay.onboardingServer) {
    relay.onboardingServer.close();
  }

  relay.server.close(function () {
    console.log("[daemon] Server closed");
    process.exit(exitCode);
  });

  // Force exit after 5 seconds
  setTimeout(function () {
    console.error("[daemon] Forced exit after timeout");
    process.exit(1);
  }, 5000);
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
  console.error("[daemon] Uncaught exception:", err);
  writeCrashInfo({
    reason: err ? (err.stack || err.message || String(err)) : "unknown",
    pid: process.pid,
    time: Date.now(),
  });
  gracefulShutdown();
});
