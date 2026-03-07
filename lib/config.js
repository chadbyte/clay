var fs = require("fs");
var path = require("path");
var os = require("os");
var net = require("net");

// v3: ~/.clay/  (v2 was ~/.claude-relay/, v1 was {cwd}/.claude-relay/)
var CLAY_HOME = process.env.CLAY_HOME || path.join(os.homedir(), ".clay");
var LEGACY_HOME = path.join(os.homedir(), ".claude-relay");

// Auto-migrate v2 -> v3: rename ~/.claude-relay/ to ~/.clay/ (once, before anything reads)
if (!fs.existsSync(CLAY_HOME) && fs.existsSync(LEGACY_HOME)) {
  try {
    fs.renameSync(LEGACY_HOME, CLAY_HOME);
    console.log("[config] Migrated " + LEGACY_HOME + " → " + CLAY_HOME);
  } catch (e) {
    // rename failed (cross-device?), fall through — individual files will be read from old path
    console.error("[config] Migration rename failed:", e.message);
  }
}

// Auto-migrate dev sessions: merge ~/.clay-dev/sessions/ into ~/.clay/sessions/
var CLAY_DEV_HOME = path.join(os.homedir(), ".clay-dev");
var devSessionsRoot = path.join(CLAY_DEV_HOME, "sessions");
if (fs.existsSync(devSessionsRoot)) {
  try {
    var prodSessionsRoot = path.join(CLAY_HOME, "sessions");
    fs.mkdirSync(prodSessionsRoot, { recursive: true });
    var projectDirs = fs.readdirSync(devSessionsRoot);
    var totalMigrated = 0;
    for (var di = 0; di < projectDirs.length; di++) {
      var srcDir = path.join(devSessionsRoot, projectDirs[di]);
      if (!fs.statSync(srcDir).isDirectory()) continue;
      var destDir = path.join(prodSessionsRoot, projectDirs[di]);
      fs.mkdirSync(destDir, { recursive: true });
      var files = fs.readdirSync(srcDir);
      for (var fi = 0; fi < files.length; fi++) {
        if (!files[fi].endsWith(".jsonl")) continue;
        var srcFile = path.join(srcDir, files[fi]);
        var destFile = path.join(destDir, files[fi]);
        if (fs.existsSync(destFile)) continue;
        try {
          fs.renameSync(srcFile, destFile);
          totalMigrated++;
        } catch (e2) {
          try {
            fs.copyFileSync(srcFile, destFile);
            fs.unlinkSync(srcFile);
            totalMigrated++;
          } catch (e3) {}
        }
      }
      // Clean up empty project dir
      try {
        if (fs.readdirSync(srcDir).length === 0) fs.rmdirSync(srcDir);
      } catch (e4) {}
    }
    if (totalMigrated > 0) {
      console.log("[config] Migrated " + totalMigrated + " dev session(s) from " + devSessionsRoot + " → " + prodSessionsRoot);
    }
    // Clean up empty dev sessions root
    try {
      if (fs.readdirSync(devSessionsRoot).length === 0) fs.rmdirSync(devSessionsRoot);
    } catch (e5) {}
  } catch (e) {
    console.error("[config] Dev session migration failed:", e.message);
  }
}

var CONFIG_DIR = CLAY_HOME;
var CLAYRC_PATH = path.join(os.homedir(), ".clayrc");
var CRASH_INFO_PATH = path.join(CONFIG_DIR, "crash.json");

function configPath() {
  return path.join(CONFIG_DIR, "daemon.json");
}

function socketPath() {
  if (process.platform === "win32") {
    var pipeName = "clay-daemon";
    return "\\\\.\\pipe\\" + pipeName;
  }
  return path.join(CONFIG_DIR, "daemon.sock");
}

function logPath() {
  return path.join(CONFIG_DIR, "daemon.log");
}

function ensureConfigDir() {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
}

function loadConfig() {
  try {
    var data = fs.readFileSync(configPath(), "utf8");
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function saveConfig(config) {
  ensureConfigDir();
  var tmpPath = configPath() + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(config, null, 2));
  fs.renameSync(tmpPath, configPath());
}

function isPidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return false;
  }
}

function isDaemonAlive(config) {
  if (!config || !config.pid) return false;
  if (!isPidAlive(config.pid)) {
    clearStaleConfig();
    return false;
  }
  // Named pipes on Windows can't be stat'd, just check PID
  if (process.platform === "win32") return true;
  try {
    fs.statSync(socketPath());
    return true;
  } catch (e) {
    return false;
  }
}

function isDaemonAliveAsync(config) {
  return new Promise(function (resolve) {
    if (!config || !config.pid) return resolve(false);
    if (!isPidAlive(config.pid)) {
      clearStaleConfig();
      return resolve(false);
    }

    var sock = socketPath();
    var client = net.connect(sock);
    var timer = setTimeout(function () {
      client.destroy();
      resolve(false);
    }, 1000);

    client.on("connect", function () {
      clearTimeout(timer);
      client.destroy();
      resolve(true);
    });
    client.on("error", function () {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

function generateSlug(projectPath, existingSlugs) {
  var base = path.basename(projectPath).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
  if (!base) base = "project";
  if (!existingSlugs || existingSlugs.indexOf(base) === -1) return base;
  for (var i = 2; i < 100; i++) {
    var candidate = base + "-" + i;
    if (existingSlugs.indexOf(candidate) === -1) return candidate;
  }
  return base + "-" + Date.now();
}

function clearStaleConfig() {
  try { fs.unlinkSync(configPath()); } catch (e) {}
  if (process.platform !== "win32") {
    try { fs.unlinkSync(socketPath()); } catch (e) {}
  }
}

// --- Crash info ---

function crashInfoPath() {
  return CRASH_INFO_PATH;
}

function writeCrashInfo(info) {
  try {
    ensureConfigDir();
    fs.writeFileSync(CRASH_INFO_PATH, JSON.stringify(info));
  } catch (e) {}
}

function readCrashInfo() {
  try {
    var data = fs.readFileSync(CRASH_INFO_PATH, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return null;
  }
}

function clearCrashInfo() {
  try { fs.unlinkSync(CRASH_INFO_PATH); } catch (e) {}
}

// --- ~/.clayrc (recent projects persistence) ---

function clayrcPath() {
  return CLAYRC_PATH;
}

function loadClayrc() {
  try {
    var data = fs.readFileSync(CLAYRC_PATH, "utf8");
    return JSON.parse(data);
  } catch (e) {
    return { recentProjects: [] };
  }
}

function saveClayrc(rc) {
  var tmpPath = CLAYRC_PATH + ".tmp";
  fs.writeFileSync(tmpPath, JSON.stringify(rc, null, 2) + "\n");
  fs.renameSync(tmpPath, CLAYRC_PATH);
}

/**
 * Update ~/.clayrc with the current project list from daemon config.
 * Merges with existing entries (preserves addedAt, updates lastUsed).
 */
function syncClayrc(projects) {
  var rc = loadClayrc();
  var existing = rc.recentProjects || [];

  // Build a map by path for quick lookup
  var byPath = {};
  for (var i = 0; i < existing.length; i++) {
    byPath[existing[i].path] = existing[i];
  }

  // Update/add current projects
  for (var j = 0; j < projects.length; j++) {
    var p = projects[j];
    if (byPath[p.path]) {
      // Update existing entry
      byPath[p.path].slug = p.slug;
      byPath[p.path].lastUsed = Date.now();
      if (p.title) byPath[p.path].title = p.title;
      else if ("title" in p) delete byPath[p.path].title;
      if (p.icon) byPath[p.path].icon = p.icon;
      else if ("icon" in p) delete byPath[p.path].icon;
    } else {
      // New entry
      byPath[p.path] = {
        path: p.path,
        slug: p.slug,
        title: p.title || undefined,
        icon: p.icon || undefined,
        addedAt: p.addedAt || Date.now(),
        lastUsed: Date.now(),
      };
    }
  }

  // Active projects first, preserving config order (user's drag-and-drop order),
  // then inactive recent projects sorted by lastUsed descending
  var activePaths = {};
  var ordered = [];
  for (var k = 0; k < projects.length; k++) {
    activePaths[projects[k].path] = true;
    if (byPath[projects[k].path]) ordered.push(byPath[projects[k].path]);
  }
  var inactive = [];
  var paths = Object.keys(byPath);
  for (var m = 0; m < paths.length; m++) {
    if (!activePaths[paths[m]]) inactive.push(byPath[paths[m]]);
  }
  inactive.sort(function (a, b) { return (b.lastUsed || 0) - (a.lastUsed || 0); });
  var all = ordered.concat(inactive);

  // Keep at most 20 recent projects
  rc.recentProjects = all.slice(0, 20);
  saveClayrc(rc);
}

function removeFromClayrc(projectPath) {
  var rc = loadClayrc();
  var before = (rc.recentProjects || []).length;
  rc.recentProjects = (rc.recentProjects || []).filter(function (p) {
    return p.path !== projectPath;
  });
  if (rc.recentProjects.length !== before) saveClayrc(rc);
}

module.exports = {
  CONFIG_DIR: CONFIG_DIR,
  configPath: configPath,
  socketPath: socketPath,
  logPath: logPath,
  ensureConfigDir: ensureConfigDir,
  loadConfig: loadConfig,
  saveConfig: saveConfig,
  isPidAlive: isPidAlive,
  isDaemonAlive: isDaemonAlive,
  isDaemonAliveAsync: isDaemonAliveAsync,
  generateSlug: generateSlug,
  clearStaleConfig: clearStaleConfig,
  crashInfoPath: crashInfoPath,
  writeCrashInfo: writeCrashInfo,
  readCrashInfo: readCrashInfo,
  clearCrashInfo: clearCrashInfo,
  clayrcPath: clayrcPath,
  loadClayrc: loadClayrc,
  saveClayrc: saveClayrc,
  syncClayrc: syncClayrc,
  removeFromClayrc: removeFromClayrc,
};
