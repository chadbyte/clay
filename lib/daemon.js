#!/usr/bin/env node

// Polyfill Symbol.dispose/asyncDispose for Node 18 (used by claude-agent-sdk)
if (!Symbol.dispose) Symbol.dispose = Symbol("Symbol.dispose");
if (!Symbol.asyncDispose) Symbol.asyncDispose = Symbol("Symbol.asyncDispose");

// Remove CLAUDECODE env var so the SDK can spawn Claude Code child processes
// (prevents "cannot be launched inside another Claude Code session" error)
delete process.env.CLAUDECODE;

var fs = require("fs");
var path = require("path");
var { loadConfig, saveConfig, socketPath, generateSlug, syncClayrc, writeCrashInfo, readCrashInfo, clearCrashInfo } = require("./config");
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
    // Broadcast updated project list to all clients
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true, slug: slug };
  },
  onRemoveProject: function (slug) {
    var found = false;
    for (var j = 0; j < config.projects.length; j++) {
      if (config.projects[j].slug === slug) { found = true; break; }
    }
    if (!found) return { ok: false, error: "Project not found" };
    relay.removeProject(slug);
    config.projects = config.projects.filter(function (p) { return p.slug !== slug; });
    saveConfig(config);
    try { syncClayrc(config.projects); } catch (e) {}
    console.log("[daemon] Removed project (web):", slug);
    relay.broadcastAll({
      type: "projects_updated",
      projects: relay.getProjects(),
      projectCount: config.projects.length,
    });
    return { ok: true };
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
});

// --- Register projects ---
var projects = config.projects || [];
for (var i = 0; i < projects.length; i++) {
  var p = projects[i];
  if (fs.existsSync(p.path)) {
    console.log("[daemon] Adding project:", p.slug, "→", p.path);
    relay.addProject(p.path, p.slug, p.title);
  } else {
    console.log("[daemon] Skipping missing project:", p.path);
  }
}

// Sync ~/.clayrc on startup
try { syncClayrc(config.projects); } catch (e) {}

// --- IPC server ---
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
  relay.server.listen(config.port, function () {
    var protocol = tlsOptions ? "https" : "http";
    console.log("[daemon] Listening on " + protocol + "://0.0.0.0:" + config.port);
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
  relay.onboardingServer.listen(onboardingPort, function () {
    console.log("[daemon] Onboarding HTTP on http://0.0.0.0:" + onboardingPort);
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
