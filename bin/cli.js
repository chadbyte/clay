#!/usr/bin/env node

var os = require("os");
var fs = require("fs");
var path = require("path");
var { execSync, execFileSync, spawn } = require("child_process");
var qrcode = require("qrcode-terminal");
var net = require("net");

// Detect dev mode before loading config (env must be set before require)
var _isDev = process.argv[1] && path.basename(process.argv[1]) === "claude-relay-dev";
if (_isDev) {
  process.env.CLAUDE_RELAY_HOME = path.join(os.homedir(), ".claude-relay-dev");
}

var { loadConfig, saveConfig, configPath, socketPath, logPath, ensureConfigDir, isDaemonAlive, isDaemonAliveAsync, generateSlug, clearStaleConfig, loadClayrc, saveClayrc, readCrashInfo } = require("../lib/config");
var { sendIPCCommand } = require("../lib/ipc");
var { generateAuthToken } = require("../lib/server");

function openUrl(url) {
  try {
    if (process.platform === "win32") {
      spawn("cmd", ["/c", "start", "", url], { stdio: "ignore", detached: true, windowsHide: true }).unref();
    } else {
      var cmd = process.platform === "darwin" ? "open" : "xdg-open";
      spawn(cmd, [url], { stdio: "ignore", detached: true }).unref();
    }
  } catch (e) {}
}

var args = process.argv.slice(2);
var port = _isDev ? 2635 : 2633;
var useHttps = true;
var skipUpdate = false;
var debugMode = false;
var autoYes = false;
var cliPin = null;
var shutdownMode = false;
var addPath = null;
var removePath = null;
var listMode = false;
var dangerouslySkipPermissions = false;
var noCwd = false;

for (var i = 0; i < args.length; i++) {
  if (args[i] === "-p" || args[i] === "--port") {
    port = parseInt(args[i + 1], 10);
    if (isNaN(port)) {
      console.error("Invalid port number");
      process.exit(1);
    }
    i++;
  } else if (args[i] === "--no-https") {
    useHttps = false;
  } else if (args[i] === "--no-update" || args[i] === "--skip-update") {
    skipUpdate = true;
  } else if (args[i] === "--debug") {
    debugMode = true;
  } else if (args[i] === "-y" || args[i] === "--yes") {
    autoYes = true;
  } else if (args[i] === "--pin") {
    cliPin = args[i + 1] || null;
    i++;
  } else if (args[i] === "--shutdown") {
    shutdownMode = true;
  } else if (args[i] === "--add") {
    addPath = args[i + 1] || ".";
    i++;
  } else if (args[i] === "--remove") {
    removePath = args[i + 1] || null;
    i++;
  } else if (args[i] === "--list") {
    listMode = true;
  } else if (args[i] === "--dangerously-skip-permissions") {
    dangerouslySkipPermissions = true;
  } else if (args[i] === "--no-project") {
    noCwd = true;
  } else if (args[i] === "-h" || args[i] === "--help") {
    console.log("Usage: claude-relay [-p|--port <port>] [--no-https] [--no-update] [--debug] [-y|--yes] [--pin <pin>] [--shutdown]");
    console.log("       claude-relay --add <path>     Add a project to the running daemon");
    console.log("       claude-relay --remove <path>  Remove a project from the running daemon");
    console.log("       claude-relay --list            List registered projects");
    console.log("");
    console.log("Options:");
    console.log("  -p, --port <port>  Port to listen on (default: 2633)");
    console.log("  --no-https         Disable HTTPS (enabled by default via mkcert)");
    console.log("  --no-update        Skip auto-update check on startup");
    console.log("  --debug            Enable debug panel in the web UI");
    console.log("  -y, --yes          Skip interactive prompts (accept defaults)");
    console.log("  --pin <pin>        Set 6-digit PIN (use with --yes)");
    console.log("  --shutdown         Shut down the running relay daemon");
    console.log("  --add <path>       Add a project directory (use '.' for current)");
    console.log("  --remove <path>    Remove a project directory");
    console.log("  --list             List all registered projects");
    console.log("  --no-project       Don't register the current directory as a project");
    console.log("  --dangerously-skip-permissions");
    console.log("                     Bypass all permission prompts (requires --pin)");
    process.exit(0);
  }
}

// Apply persistent no-cwd default from ~/.clayrc (overridden by explicit --no-project)
if (!noCwd) {
  var _rc = loadClayrc();
  if (_rc.noCwdDefault) noCwd = true;
}

// --- Handle --shutdown before anything else ---
if (shutdownMode) {
  var shutdownConfig = loadConfig();
  isDaemonAliveAsync(shutdownConfig).then(function (alive) {
    if (!alive) {
      console.error("No running daemon found.");
      process.exit(1);
    }
    sendIPCCommand(socketPath(), { cmd: "shutdown" }).then(function () {
      console.log("Server stopped.");
      clearStaleConfig();
      process.exit(0);
    }).catch(function (err) {
      console.error("Shutdown failed:", err.message);
      process.exit(1);
    });
  });
  return;
}

// --- Handle --add before anything else ---
if (addPath !== null) {
  var absAdd = path.resolve(addPath);
  try {
    var stat = fs.statSync(absAdd);
    if (!stat.isDirectory()) {
      console.error("Not a directory: " + absAdd);
      process.exit(1);
    }
  } catch (e) {
    console.error("Directory not found: " + absAdd);
    process.exit(1);
  }
  var addConfig = loadConfig();
  isDaemonAliveAsync(addConfig).then(function (alive) {
    if (!alive) {
      console.error("No running daemon. Start with: npx claude-relay");
      process.exit(1);
    }
    sendIPCCommand(socketPath(), { cmd: "add_project", path: absAdd }).then(function (res) {
      if (res.ok) {
        if (res.existing) {
          console.log("Already registered: " + res.slug);
        } else {
          console.log("Added: " + res.slug + " \u2192 " + absAdd);
        }
        process.exit(0);
      } else {
        console.error("Failed: " + (res.error || "unknown error"));
        process.exit(1);
      }
    });
  });
  return;
}

// --- Handle --remove before anything else ---
if (removePath !== null) {
  var absRemove = path.resolve(removePath);
  var removeConfig = loadConfig();
  isDaemonAliveAsync(removeConfig).then(function (alive) {
    if (!alive) {
      console.error("No running daemon. Start with: npx claude-relay");
      process.exit(1);
    }
    sendIPCCommand(socketPath(), { cmd: "remove_project", path: absRemove }).then(function (res) {
      if (res.ok) {
        console.log("Removed: " + path.basename(absRemove));
        process.exit(0);
      } else {
        console.error("Failed: " + (res.error || "project not found"));
        process.exit(1);
      }
    });
  });
  return;
}

// --- Handle --list before anything else ---
if (listMode) {
  var listConfig = loadConfig();
  isDaemonAliveAsync(listConfig).then(function (alive) {
    if (!alive) {
      console.error("No running daemon. Start with: npx claude-relay");
      process.exit(1);
    }
    sendIPCCommand(socketPath(), { cmd: "get_status" }).then(function (res) {
      if (!res.ok || !res.projects || res.projects.length === 0) {
        console.log("No projects registered.");
        process.exit(0);
        return;
      }
      console.log("Projects (" + res.projects.length + "):\n");
      for (var p = 0; p < res.projects.length; p++) {
        var proj = res.projects[p];
        var label = "  " + proj.slug;
        if (proj.title) label += " (" + proj.title + ")";
        label += "\n    " + proj.path;
        console.log(label);
      }
      console.log("");
      process.exit(0);
    });
  });
  return;
}

var cwd = process.cwd();

// --- ANSI helpers ---
var isBasicTerm = process.env.TERM_PROGRAM === "Apple_Terminal";
var a = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function gradient(text) {
  if (isBasicTerm) {
    return a.yellow + text + a.reset;
  }
  // Orange (#DA7756) → Gold (#D4A574)
  var r0 = 218, g0 = 119, b0 = 86;
  var r1 = 212, g1 = 165, b1 = 116;
  var out = "";
  var len = text.length;
  for (var i = 0; i < len; i++) {
    var t = len > 1 ? i / (len - 1) : 0;
    var r = Math.round(r0 + (r1 - r0) * t);
    var g = Math.round(g0 + (g1 - g0) * t);
    var b = Math.round(b0 + (b1 - b0) * t);
    out += "\x1b[38;2;" + r + ";" + g + ";" + b + "m" + text[i];
  }
  return out + a.reset;
}

var sym = {
  pointer: a.cyan + "◆" + a.reset,
  done: a.green + "◇" + a.reset,
  bar: a.dim + "│" + a.reset,
  end: a.dim + "└" + a.reset,
  warn: a.yellow + "▲" + a.reset,
};

function log(s) { console.log("  " + s); }

function clearUp(n) {
  for (var i = 0; i < n; i++) {
    process.stdout.write("\x1b[1A\x1b[2K");
  }
}

// --- Daemon watcher ---
// Polls daemon socket; if connection fails, the server is down.
var _daemonWatcher = null;

function startDaemonWatcher() {
  if (_daemonWatcher) return;
  _daemonWatcher = setInterval(function () {
    var client = net.connect(socketPath());
    var timer = setTimeout(function () {
      client.destroy();
      onDaemonDied();
    }, 1500);
    client.on("connect", function () {
      clearTimeout(timer);
      client.destroy();
    });
    client.on("error", function () {
      clearTimeout(timer);
      client.destroy();
      onDaemonDied();
    });
  }, 3000);
}

function stopDaemonWatcher() {
  if (_daemonWatcher) {
    clearInterval(_daemonWatcher);
    _daemonWatcher = null;
  }
}

var _restartAttempts = 0;
var MAX_RESTART_ATTEMPTS = 5;
var _restartBackoffStart = 0;

function onDaemonDied() {
  stopDaemonWatcher();
  // Clean up stdin in case a prompt is active
  try {
    process.stdin.setRawMode(false);
    process.stdin.pause();
    process.stdin.removeAllListeners("data");
  } catch (e) {}

  // Check if this was a crash (crash.json exists) vs intentional shutdown
  var crashInfo = readCrashInfo();
  if (!crashInfo) {
    // Intentional shutdown, no restart
    log("");
    log(sym.warn + "  " + a.yellow + "Server has been shut down." + a.reset);
    log(a.dim + "     Run " + a.reset + "npx claude-relay" + a.dim + " to start again." + a.reset);
    log("");
    process.exit(0);
    return;
  }

  // Reset backoff counter if enough time has passed since last restart burst
  var now = Date.now();
  if (_restartBackoffStart && now - _restartBackoffStart > 60000) {
    _restartAttempts = 0;
  }

  _restartAttempts++;
  if (_restartAttempts > MAX_RESTART_ATTEMPTS) {
    log("");
    log(sym.warn + "  " + a.red + "Server crashed too many times (" + MAX_RESTART_ATTEMPTS + " attempts). Giving up." + a.reset);
    if (crashInfo.reason) {
      log(a.dim + "     " + crashInfo.reason.split("\n")[0] + a.reset);
    }
    log(a.dim + "     Check logs: " + a.reset + logPath());
    log("");
    process.exit(1);
    return;
  }

  if (_restartAttempts === 1) _restartBackoffStart = now;

  log("");
  log(sym.warn + "  " + a.yellow + "Server crashed. Restarting... (" + _restartAttempts + "/" + MAX_RESTART_ATTEMPTS + ")" + a.reset);
  if (crashInfo.reason) {
    log(a.dim + "     " + crashInfo.reason.split("\n")[0] + a.reset);
  }

  // Re-fork the daemon from saved config
  restartDaemonFromConfig();
}

async function restartDaemonFromConfig() {
  var lastConfig = loadConfig();
  if (!lastConfig || !lastConfig.projects) {
    log(a.red + "     No config found. Cannot restart." + a.reset);
    process.exit(1);
    return;
  }

  clearStaleConfig();

  // Wait for port to be released
  var targetPort = lastConfig.port || port;
  var waited = 0;
  while (waited < 3000) {
    var free = await isPortFree(targetPort);
    if (free) break;
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    waited += 300;
  }

  // Rebuild config (preserve everything except pid)
  var newConfig = {
    pid: null,
    port: targetPort,
    pinHash: lastConfig.pinHash || null,
    tls: lastConfig.tls !== undefined ? lastConfig.tls : useHttps,
    debug: lastConfig.debug || false,
    keepAwake: lastConfig.keepAwake || false,
    dangerouslySkipPermissions: lastConfig.dangerouslySkipPermissions || false,
    projects: (lastConfig.projects || []).filter(function (p) {
      return fs.existsSync(p.path);
    }),
  };

  ensureConfigDir();
  saveConfig(newConfig);

  var daemonScript = path.join(__dirname, "..", "lib", "daemon.js");
  var logFile = logPath();
  var logFd = fs.openSync(logFile, "a");

  var child = spawn(process.execPath, [daemonScript], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
    env: Object.assign({}, process.env, {
      CLAUDE_RELAY_CONFIG: configPath(),
    }),
  });
  child.unref();
  fs.closeSync(logFd);

  newConfig.pid = child.pid;
  saveConfig(newConfig);

  // Wait and verify
  await new Promise(function (resolve) { setTimeout(resolve, 1200); });
  var alive = await isDaemonAliveAsync(newConfig);
  if (!alive) {
    log(a.red + "     Restart failed. Check logs: " + a.reset + logFile);
    process.exit(1);
    return;
  }
  var ip = getLocalIP();
  log(sym.done + "  " + a.green + "Server restarted successfully." + a.reset);
  log("");
  showMainMenu(newConfig, ip);
}

// --- Network ---
function getLocalIP() {
  var interfaces = os.networkInterfaces();

  // Prefer Tailscale IP
  for (var name in interfaces) {
    if (/^(tailscale|utun)/.test(name)) {
      for (var j = 0; j < interfaces[name].length; j++) {
        var addr = interfaces[name][j];
        if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
          return addr.address;
        }
      }
    }
  }

  // All interfaces for Tailscale CGNAT range
  for (var addrs of Object.values(interfaces)) {
    for (var k = 0; k < addrs.length; k++) {
      if (addrs[k].family === "IPv4" && !addrs[k].internal && addrs[k].address.startsWith("100.")) {
        return addrs[k].address;
      }
    }
  }

  // Fall back to LAN IP
  for (var addrs2 of Object.values(interfaces)) {
    for (var m = 0; m < addrs2.length; m++) {
      if (addrs2[m].family === "IPv4" && !addrs2[m].internal) {
        return addrs2[m].address;
      }
    }
  }

  return "localhost";
}

// --- Certs ---
function isRoutableIP(addr) {
  if (addr.startsWith("10.")) return true;
  if (addr.startsWith("192.168.")) return true;
  if (addr.startsWith("100.")) {
    var second = parseInt(addr.split(".")[1], 10);
    return second >= 64 && second <= 127; // CGNAT (Tailscale)
  }
  if (addr.startsWith("172.")) {
    var second = parseInt(addr.split(".")[1], 10);
    return second >= 16 && second <= 31;
  }
  return false;
}

function getAllIPs() {
  var ips = [];
  var ifaces = os.networkInterfaces();
  for (var addrs of Object.values(ifaces)) {
    for (var j = 0; j < addrs.length; j++) {
      if (addrs[j].family === "IPv4" && !addrs[j].internal && isRoutableIP(addrs[j].address)) {
        ips.push(addrs[j].address);
      }
    }
  }
  return ips;
}

function ensureCerts(ip) {
  var homeDir = os.homedir();
  var certDir = path.join(process.env.CLAUDE_RELAY_HOME || path.join(homeDir, ".claude-relay"), "certs");
  var keyPath = path.join(certDir, "key.pem");
  var certPath = path.join(certDir, "cert.pem");

  var legacyDir = path.join(cwd, ".claude-relay", "certs");
  var legacyKey = path.join(legacyDir, "key.pem");
  var legacyCert = path.join(legacyDir, "cert.pem");
  if (!fs.existsSync(keyPath) && fs.existsSync(legacyKey) && fs.existsSync(legacyCert)) {
    fs.mkdirSync(certDir, { recursive: true });
    fs.copyFileSync(legacyKey, keyPath);
    fs.copyFileSync(legacyCert, certPath);
  }

  var caRoot = null;
  try {
    caRoot = path.join(
      execSync("mkcert -CAROOT", { encoding: "utf8" }).trim(),
      "rootCA.pem"
    );
    if (!fs.existsSync(caRoot)) caRoot = null;
  } catch (e) {}

  // Collect all IPv4 addresses (Tailscale + LAN)
  var allIPs = getAllIPs();

  if (fs.existsSync(keyPath) && fs.existsSync(certPath)) {
    var needRegen = false;
    try {
      var certText = execFileSync("openssl", ["x509", "-in", certPath, "-text", "-noout"], { encoding: "utf8" });
      for (var i = 0; i < allIPs.length; i++) {
        if (certText.indexOf(allIPs[i]) === -1) {
          needRegen = true;
          break;
        }
      }
    } catch (e) { needRegen = true; }
    if (!needRegen) return { key: keyPath, cert: certPath, caRoot: caRoot };
  }

  fs.mkdirSync(certDir, { recursive: true });

  var domains = ["localhost", "127.0.0.1", "::1"];
  for (var i = 0; i < allIPs.length; i++) {
    if (domains.indexOf(allIPs[i]) === -1) domains.push(allIPs[i]);
  }

  try {
    var mkcertArgs = ["-key-file", keyPath, "-cert-file", certPath].concat(domains);
    execFileSync("mkcert", mkcertArgs, { stdio: "pipe" });
  } catch (err) {
    return null;
  }

  return { key: keyPath, cert: certPath, caRoot: caRoot };
}

// --- Logo ---
function printLogo() {
  var c = isBasicTerm ? a.yellow : "\x1b[38;2;218;119;86m";
  var r = a.reset;
  var lines = [
    "  ██████╗ ██╗       █████╗  ██╗   ██╗ ██████╗  ███████╗     ██████╗  ███████╗ ██╗       █████╗  ██╗   ██╗",
    " ██╔════╝ ██║      ██╔══██╗ ██║   ██║ ██╔══██╗ ██╔════╝     ██╔══██╗ ██╔════╝ ██║      ██╔══██╗ ╚██╗ ██╔╝",
    " ██║      ██║      ███████║ ██║   ██║ ██║  ██║ █████╗       ██████╔╝ █████╗   ██║      ███████║  ╚████╔╝ ",
    " ██║      ██║      ██╔══██║ ██║   ██║ ██║  ██║ ██╔══╝       ██╔══██╗ ██╔══╝   ██║      ██╔══██║   ╚██╔╝  ",
    " ╚██████╗ ███████╗ ██║  ██║ ╚██████╔╝ ██████╔╝ ███████╗     ██║  ██║ ███████╗ ███████╗ ██║  ██║    ██║   ",
    "  ╚═════╝ ╚══════╝ ╚═╝  ╚═╝  ╚═════╝  ╚═════╝  ╚══════╝     ╚═╝  ╚═╝ ╚══════╝ ╚══════╝ ╚═╝  ╚═╝    ╚═╝   ",
  ];
  console.log("");
  for (var i = 0; i < lines.length; i++) {
    console.log(c + lines[i] + r);
  }
}

// --- Interactive prompts ---
function promptToggle(title, desc, defaultValue, callback) {
  var value = defaultValue || false;

  function renderToggle() {
    var yes = value
      ? a.green + a.bold + "● Yes" + a.reset
      : a.dim + "○ Yes" + a.reset;
    var no = !value
      ? a.green + a.bold + "● No" + a.reset
      : a.dim + "○ No" + a.reset;
    return yes + a.dim + " / " + a.reset + no;
  }

  var lines = 2;
  log(sym.pointer + "  " + a.bold + title + a.reset);
  if (desc) {
    log(sym.bar + "  " + a.dim + desc + a.reset);
    lines = 3;
  }
  process.stdout.write("  " + sym.bar + "  " + renderToggle());

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onToggle(ch) {
    if (ch === "\x1b[D" || ch === "\x1b[C" || ch === "\t") {
      value = !value;
      process.stdout.write("\x1b[2K\r  " + sym.bar + "  " + renderToggle());
    } else if (ch === "y" || ch === "Y") {
      value = true;
      process.stdout.write("\x1b[2K\r  " + sym.bar + "  " + renderToggle());
    } else if (ch === "n" || ch === "N") {
      value = false;
      process.stdout.write("\x1b[2K\r  " + sym.bar + "  " + renderToggle());
    } else if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onToggle);
      process.stdout.write("\n");
      clearUp(lines);
      var result = value ? a.green + "Yes" + a.reset : a.dim + "No" + a.reset;
      log(sym.done + "  " + title + " " + a.dim + "·" + a.reset + " " + result);
      callback(value);
    } else if (ch === "\x03") {
      process.stdout.write("\n");
      clearUp(lines);
      log(sym.end + "  " + a.dim + "Cancelled" + a.reset);
      process.exit(0);
    }
  });
}

function promptPin(callback) {
  log(sym.pointer + "  " + a.bold + "PIN protection" + a.reset);
  log(sym.bar + "  " + a.dim + "Require a 6-digit PIN to access the web UI. Enter to skip." + a.reset);
  process.stdout.write("  " + sym.bar + "  ");

  var pin = "";
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onPin(ch) {
    if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onPin);
      process.stdout.write("\n");

      if (pin !== "" && !/^\d{6}$/.test(pin)) {
        clearUp(3);
        log(sym.done + "  PIN protection " + a.red + "Must be exactly 6 digits" + a.reset);
        log(sym.end);
        process.exit(1);
        return;
      }

      clearUp(3);
      if (pin) {
        log(sym.done + "  PIN protection " + a.dim + "·" + a.reset + " " + a.green + "Enabled" + a.reset);
      } else {
        log(sym.done + "  PIN protection " + a.dim + "· Skipped" + a.reset);
      }
      log(sym.bar);
      callback(pin || null);
    } else if (ch === "\x03") {
      process.stdout.write("\n");
      clearUp(3);
      log(sym.end + "  " + a.dim + "Cancelled" + a.reset);
      process.exit(0);
    } else if (ch === "\x7f" || ch === "\b") {
      if (pin.length > 0) {
        pin = pin.slice(0, -1);
        process.stdout.write("\b \b");
      }
    } else if (/\d/.test(ch) && pin.length < 6) {
      pin += ch;
      process.stdout.write(a.cyan + "●" + a.reset);
    }
  });
}

/**
 * Text input prompt with placeholder and Tab directory completion.
 * title: prompt label, placeholder: dimmed hint, callback(value)
 * Enter with empty input returns placeholder value.
 * Tab completes directory paths.
 */
function promptText(title, placeholder, callback) {
  var prefix = "  " + sym.bar + "  ";
  var hintLine = "";
  var lineCount = 2;

  log(sym.pointer + "  " + a.bold + title + a.reset + "  " + a.dim + "(esc to go back)" + a.reset);
  process.stdout.write(prefix + a.dim + placeholder + a.reset);
  // Move cursor to start of placeholder
  process.stdout.write("\r" + prefix);

  var text = "";
  var showingPlaceholder = true;
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  function redrawInput() {
    process.stdout.write("\x1b[2K\r" + prefix + text);
  }

  function clearHint() {
    if (hintLine) {
      // Erase the hint line below
      process.stdout.write("\n\x1b[2K\x1b[1A");
      hintLine = "";
      lineCount = 2;
    }
  }

  function showHint(msg) {
    clearHint();
    hintLine = msg;
    lineCount = 3;
    // Print hint below, then move cursor back up
    process.stdout.write("\n" + prefix + a.dim + msg + a.reset + "\x1b[1A");
    redrawInput();
  }

  function tabComplete() {
    var current = text || "";
    if (!current) current = "/";

    // Resolve ~ to home
    if (current.charAt(0) === "~") {
      current = os.homedir() + current.substring(1);
    }

    var resolved = path.resolve(current);
    var dir, partial;

    try {
      var st = fs.statSync(resolved);
      if (st.isDirectory()) {
        // Current text is a full directory — list its children
        dir = resolved;
        partial = "";
      } else {
        dir = path.dirname(resolved);
        partial = path.basename(resolved);
      }
    } catch (e) {
      // Path doesn't exist — complete from parent
      dir = path.dirname(resolved);
      partial = path.basename(resolved);
    }

    var entries;
    try {
      entries = fs.readdirSync(dir);
    } catch (e) {
      return; // Can't read directory
    }

    // Filter to directories only, matching partial prefix
    var matches = [];
    var lowerPartial = partial.toLowerCase();
    for (var i = 0; i < entries.length; i++) {
      if (entries[i].charAt(0) === "." && !partial.startsWith(".")) continue;
      if (lowerPartial && entries[i].toLowerCase().indexOf(lowerPartial) !== 0) continue;
      try {
        var full = path.join(dir, entries[i]);
        if (fs.statSync(full).isDirectory()) {
          matches.push(entries[i]);
        }
      } catch (e) {}
    }

    if (matches.length === 0) return;

    if (matches.length === 1) {
      // Single match — complete it
      var completed = path.join(dir, matches[0]) + path.sep;
      text = completed;
      showingPlaceholder = false;
      clearHint();
      redrawInput();
    } else {
      // Multiple matches — find longest common prefix and show candidates
      var common = matches[0];
      for (var m = 1; m < matches.length; m++) {
        var k = 0;
        while (k < common.length && k < matches[m].length && common.charAt(k) === matches[m].charAt(k)) k++;
        common = common.substring(0, k);
      }

      if (common.length > partial.length) {
        // Extend to common prefix
        text = path.join(dir, common);
        showingPlaceholder = false;
      }

      // Show candidates as hint
      var display = matches.slice(0, 6).join("  ");
      if (matches.length > 6) display += "  " + a.dim + "+" + (matches.length - 6) + " more" + a.reset;
      showHint(display);
    }
  }

  process.stdin.on("data", function onText(ch) {
    if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onText);
      var result = text || placeholder;
      clearHint();
      process.stdout.write("\n");
      clearUp(2);
      log(sym.done + "  " + title + " " + a.dim + "·" + a.reset + " " + result);
      callback(result);
    } else if (ch === "\x1b" || ch === "\x03") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onText);
      clearHint();
      process.stdout.write("\n");
      clearUp(2);
      if (ch === "\x03") {
        log(sym.end + "  " + a.dim + "Cancelled" + a.reset);
        process.exit(0);
      }
      callback(null);
    } else if (ch === "\t") {
      if (showingPlaceholder) {
        // Accept placeholder first
        text = placeholder;
        showingPlaceholder = false;
        redrawInput();
      }
      tabComplete();
    } else if (ch === "\x7f" || ch === "\b") {
      if (text.length > 0) {
        text = text.slice(0, -1);
        clearHint();
        if (text.length === 0) {
          // Re-show placeholder
          showingPlaceholder = true;
          process.stdout.write("\x1b[2K\r" + prefix + a.dim + placeholder + a.reset);
          process.stdout.write("\r" + prefix);
        } else {
          redrawInput();
        }
      }
    } else if (ch >= " ") {
      if (showingPlaceholder) {
        showingPlaceholder = false;
      }
      clearHint();
      text += ch;
      redrawInput();
    }
  });
}

/**
 * Select menu: arrow keys to navigate, enter to select.
 * items: [{ label, value, desc? }]
 */
function promptSelect(title, items, callback, opts) {
  var idx = 0;
  // Build hotkeys map: { key: handler }
  var hotkeys = {};
  if (opts && opts.key && opts.onKey) {
    hotkeys[opts.key] = opts.onKey;
  }
  if (opts && opts.keys) {
    for (var ki = 0; ki < opts.keys.length; ki++) {
      hotkeys[opts.keys[ki].key] = opts.keys[ki].onKey;
    }
  }
  var hintLines = null;
  if (opts && opts.hint) {
    hintLines = Array.isArray(opts.hint) ? opts.hint : [opts.hint];
  }

  function render() {
    var out = "";
    for (var i = 0; i < items.length; i++) {
      var prefix = i === idx
        ? a.green + a.bold + "  ● " + a.reset
        : a.dim + "  ○ " + a.reset;
      out += "  " + sym.bar + prefix + items[i].label + "\n";
    }
    return out;
  }

  log(sym.pointer + "  " + a.bold + title + a.reset);
  process.stdout.write(render());

  // Render hint lines below the menu tree
  var hintBoxLines = 0;
  if (hintLines) {
    log(sym.end);
    for (var h = 0; h < hintLines.length; h++) {
      log("   " + gradient(hintLines[h]));
    }
    hintBoxLines = 1 + hintLines.length;  // sym.end + lines
  }

  var lineCount = items.length + 1 + hintBoxLines;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onSelect(ch) {
    if (ch === "\x1b[A") { // up
      if (idx > 0) idx--;
    } else if (ch === "\x1b[B") { // down
      if (idx < items.length - 1) idx++;
    } else if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onSelect);
      clearUp(lineCount);
      log(sym.done + "  " + title + " " + a.dim + "·" + a.reset + " " + items[idx].label);
      callback(items[idx].value);
      return;
    } else if (ch === "\x03") {
      process.stdout.write("\n");
      process.exit(0);
    } else if (hotkeys[ch]) {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onSelect);
      clearUp(lineCount);
      hotkeys[ch]();
      return;
    } else if (ch === "\x7f" || ch === "\b") {
      // Backspace — trigger "back" if available
      for (var bi = 0; bi < items.length; bi++) {
        if (items[bi].value === "back") {
          process.stdin.setRawMode(false);
          process.stdin.pause();
          process.stdin.removeListener("data", onSelect);
          clearUp(lineCount);
          log(sym.done + "  " + title + " " + a.dim + "·" + a.reset + " " + items[bi].label);
          callback("back");
          return;
        }
      }
      return;
    } else {
      return;
    }
    // Redraw
    clearUp(items.length + hintBoxLines);
    process.stdout.write(render());
    // Re-render hint lines
    if (hintLines) {
      log(sym.end);
      for (var rh = 0; rh < hintLines.length; rh++) {
        log("   " + gradient(hintLines[rh]));
      }
    }
  });
}

/**
 * Multi-select menu: space to toggle, enter to confirm.
 * items: [{ label, value, checked? }]
 * callback(selectedValues[])
 */
function promptMultiSelect(title, items, callback) {
  var selected = [];
  for (var si = 0; si < items.length; si++) {
    selected.push(items[si].checked !== false);
  }
  var idx = 0;

  function render() {
    var out = "";
    for (var i = 0; i < items.length; i++) {
      var cursor = i === idx ? a.cyan + ">" + a.reset : " ";
      var check = selected[i]
        ? a.green + a.bold + "■" + a.reset
        : a.dim + "□" + a.reset;
      out += "  " + sym.bar + " " + cursor + " " + check + " " + items[i].label + "\n";
    }
    out += "  " + sym.bar + "  " + a.dim + "space: toggle · enter: confirm" + a.reset + "\n";
    return out;
  }

  log(sym.pointer + "  " + a.bold + title + a.reset);
  process.stdout.write(render());

  var lineCount = items.length + 2; // title + items + hint

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  process.stdin.on("data", function onMulti(ch) {
    if (ch === "\x1b[A") { // up
      if (idx > 0) idx--;
    } else if (ch === "\x1b[B") { // down
      if (idx < items.length - 1) idx++;
    } else if (ch === " ") { // toggle
      selected[idx] = !selected[idx];
    } else if (ch === "a" || ch === "A") { // toggle all
      var allSelected = selected.every(function (s) { return s; });
      for (var ai = 0; ai < selected.length; ai++) selected[ai] = !allSelected;
    } else if (ch === "\r" || ch === "\n") {
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onMulti);
      clearUp(lineCount);
      var result = [];
      var labels = [];
      for (var ri = 0; ri < items.length; ri++) {
        if (selected[ri]) {
          result.push(items[ri].value);
          labels.push(items[ri].label);
        }
      }
      var summary = result.length === items.length
        ? "All (" + result.length + ")"
        : result.length + " of " + items.length;
      log(sym.done + "  " + title + " " + a.dim + "·" + a.reset + " " + summary);
      callback(result);
      return;
    } else if (ch === "\x03") {
      process.stdout.write("\n");
      process.exit(0);
    } else if (ch === "\x1b") {
      // Escape — select none
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdin.removeListener("data", onMulti);
      clearUp(lineCount);
      log(sym.done + "  " + title + " " + a.dim + "· Skipped" + a.reset);
      callback([]);
      return;
    } else {
      return;
    }
    // Redraw
    clearUp(items.length + 1); // items + hint (not title)
    process.stdout.write(render());
  });
}

// --- Port availability ---

function isPortFree(p) {
  return new Promise(function (resolve) {
    var srv = net.createServer();
    srv.once("error", function () { resolve(false); });
    srv.once("listening", function () { srv.close(function () { resolve(true); }); });
    srv.listen(p);
  });
}

// --- Detect tools ---
function getTailscaleIP() {
  var interfaces = os.networkInterfaces();
  for (var name in interfaces) {
    if (/^(tailscale|utun)/.test(name)) {
      for (var i = 0; i < interfaces[name].length; i++) {
        var addr = interfaces[name][i];
        if (addr.family === "IPv4" && !addr.internal && addr.address.startsWith("100.")) {
          return addr.address;
        }
      }
    }
  }
  for (var addrs of Object.values(interfaces)) {
    for (var j = 0; j < addrs.length; j++) {
      if (addrs[j].family === "IPv4" && !addrs[j].internal && addrs[j].address.startsWith("100.")) {
        return addrs[j].address;
      }
    }
  }
  return null;
}

function hasTailscale() {
  return getTailscaleIP() !== null;
}

function hasMkcert() {
  try {
    execSync("mkcert -CAROOT", { stdio: "pipe", encoding: "utf8" });
    return true;
  } catch (e) { return false; }
}

// ==============================
// Restore projects from ~/.clayrc
// ==============================
function promptRestoreProjects(projects, callback) {
  log(sym.bar);
  log(sym.pointer + "  " + a.bold + "Previous projects found" + a.reset);
  log(sym.bar + "  " + a.dim + "Restore projects from your last session?" + a.reset);
  log(sym.bar);

  var items = projects.map(function (p) {
    var name = p.title || path.basename(p.path);
    return {
      label: a.bold + name + a.reset + "  " + a.dim + p.path + a.reset,
      value: p,
      checked: true,
    };
  });

  promptMultiSelect("Restore projects", items, function (selected) {
    // Remove unselected projects from ~/.clayrc
    if (selected.length < projects.length) {
      var selectedPaths = {};
      for (var si = 0; si < selected.length; si++) {
        selectedPaths[selected[si].path] = true;
      }
      try {
        var rc = loadClayrc();
        rc.recentProjects = (rc.recentProjects || []).filter(function (p) {
          return selectedPaths[p.path];
        });
        saveClayrc(rc);
      } catch (e) {}
    }

    log(sym.bar);
    if (selected.length > 0) {
      log(sym.done + "  " + a.green + "Restoring " + selected.length + (selected.length === 1 ? " project" : " projects") + a.reset);
    } else {
      log(sym.done + "  " + a.dim + "Starting fresh" + a.reset);
    }
    log(sym.end + "  " + a.dim + "Starting relay..." + a.reset);
    log("");
    callback(selected);
  });
}

// ==============================
// First-run setup (no daemon)
// ==============================
function setup(callback) {
  console.clear();
  printLogo();
  log("");
  log(sym.pointer + "  " + a.bold + "Claude Relay" + a.reset + a.dim + "  ·  Unofficial, open-source project" + a.reset);
  log(sym.bar);
  log(sym.bar + "  " + a.dim + "Anyone with the URL gets full Claude Code access to this machine." + a.reset);
  log(sym.bar + "  " + a.dim + "Use a private network (Tailscale, VPN)." + a.reset);
  log(sym.bar + "  " + a.dim + "The authors assume no responsibility for any damage or data loss." + a.reset);
  log(sym.bar);

  promptToggle("Accept and continue", null, true, function (accepted) {
    if (!accepted) {
      log(sym.end + "  " + a.dim + "Aborted." + a.reset);
      log("");
      process.exit(0);
      return;
    }
    log(sym.bar);

    function askPort() {
      promptText("Port", String(port), function (val) {
        if (val === null) {
          log(sym.end + "  " + a.dim + "Aborted." + a.reset);
          log("");
          process.exit(0);
          return;
        }
        var p = parseInt(val, 10);
        if (!p || p < 1 || p > 65535) {
          log(sym.warn + "  " + a.red + "Invalid port number" + a.reset);
          askPort();
          return;
        }
        isPortFree(p).then(function (free) {
          if (!free) {
            log(sym.warn + "  " + a.yellow + "Port " + p + " is already in use" + a.reset);
            askPort();
            return;
          }
          port = p;
          log(sym.bar);

          promptPin(function (pin) {
            if (process.platform === "darwin") {
              promptToggle("Keep awake", "Prevent system sleep while relay is running", false, function (keepAwake) {
                callback(pin, keepAwake);
              });
            } else {
              callback(pin, false);
            }
          });
        });
      });
    }
    askPort();
  });
}

// ==============================
// Fork the daemon process
// ==============================
async function forkDaemon(pin, keepAwake, extraProjects) {
  var ip = getLocalIP();
  var hasTls = false;

  if (useHttps) {
    var certPaths = ensureCerts(ip);
    if (certPaths) {
      hasTls = true;
    } else {
      log(sym.warn + "  " + a.yellow + "HTTPS unavailable" + a.reset + a.dim + " · mkcert not installed" + a.reset);
    }
  }

  // Check port availability
  var portFree = await isPortFree(port);
  if (!portFree) {
    log(a.red + "Port " + port + " is already in use." + a.reset);
    log(a.dim + "Is another Claude Relay daemon running?" + a.reset);
    process.exit(1);
    return;
  }

  var allProjects = [];
  if (!noCwd) {
    var slug = generateSlug(cwd, []);
    allProjects = [{ path: cwd, slug: slug, addedAt: Date.now() }];
  }

  // Add restored projects (from ~/.clayrc)
  if (extraProjects && extraProjects.length > 0) {
    var usedSlugs = [slug];
    for (var ep = 0; ep < extraProjects.length; ep++) {
      var rp = extraProjects[ep];
      if (rp.path === cwd) continue; // skip if same as cwd
      if (!fs.existsSync(rp.path)) continue; // skip missing directories
      var rpSlug = generateSlug(rp.path, usedSlugs);
      usedSlugs.push(rpSlug);
      allProjects.push({ path: rp.path, slug: rpSlug, title: rp.title || undefined, addedAt: rp.addedAt || Date.now() });
    }
  }

  var config = {
    pid: null,
    port: port,
    pinHash: pin ? generateAuthToken(pin) : null,
    tls: hasTls,
    debug: debugMode,
    keepAwake: keepAwake,
    dangerouslySkipPermissions: dangerouslySkipPermissions,
    projects: allProjects,
  };

  ensureConfigDir();
  saveConfig(config);

  // Fork daemon
  var daemonScript = path.join(__dirname, "..", "lib", "daemon.js");
  var logFile = logPath();
  var logFd = fs.openSync(logFile, "a");

  var child = spawn(process.execPath, [daemonScript], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
    env: Object.assign({}, process.env, {
      CLAUDE_RELAY_CONFIG: configPath(),
    }),
  });
  child.unref();
  fs.closeSync(logFd);

  // Update config with PID
  config.pid = child.pid;
  saveConfig(config);

  // Wait for daemon to start
  await new Promise(function (resolve) { setTimeout(resolve, 800); });

  // Verify daemon is alive
  var alive = await isDaemonAliveAsync(config);
  if (!alive) {
    log(a.red + "Failed to start daemon. Check logs:" + a.reset);
    log(a.dim + logFile + a.reset);
    clearStaleConfig();
    process.exit(1);
    return;
  }

  // Show success + QR
  showServerStarted(config, ip);
}

// ==============================
// Restart daemon with TLS enabled
// ==============================
async function restartDaemonWithTLS(config, callback) {
  var ip = getLocalIP();
  var certPaths = ensureCerts(ip);
  if (!certPaths) {
    callback(config);
    return;
  }

  // Shut down old daemon
  stopDaemonWatcher();
  try {
    await sendIPCCommand(socketPath(), { cmd: "shutdown" });
  } catch (e) {}

  // Wait for port to be released
  var waited = 0;
  while (waited < 5000) {
    await new Promise(function (resolve) { setTimeout(resolve, 300); });
    waited += 300;
    var free = await isPortFree(config.port);
    if (free) break;
  }
  clearStaleConfig();

  // Re-fork with TLS
  var newConfig = {
    pid: null,
    port: config.port,
    pinHash: config.pinHash || null,
    tls: true,
    debug: config.debug || false,
    keepAwake: config.keepAwake || false,
    dangerouslySkipPermissions: config.dangerouslySkipPermissions || false,
    projects: config.projects || [],
  };

  ensureConfigDir();
  saveConfig(newConfig);

  var daemonScript = path.join(__dirname, "..", "lib", "daemon.js");
  var logFile = logPath();
  var logFd = fs.openSync(logFile, "a");

  var child = spawn(process.execPath, [daemonScript], {
    detached: true,
    windowsHide: true,
    stdio: ["ignore", logFd, logFd],
    env: Object.assign({}, process.env, {
      CLAUDE_RELAY_CONFIG: configPath(),
    }),
  });
  child.unref();
  fs.closeSync(logFd);

  newConfig.pid = child.pid;
  saveConfig(newConfig);

  await new Promise(function (resolve) { setTimeout(resolve, 800); });

  var alive = await isDaemonAliveAsync(newConfig);
  if (!alive) {
    log(sym.warn + "  " + a.yellow + "Failed to restart with HTTPS, falling back to HTTP..." + a.reset);
    // Re-fork without TLS so the server is at least running
    newConfig.tls = false;
    saveConfig(newConfig);
    var logFd2 = fs.openSync(logFile, "a");
    var child2 = spawn(process.execPath, [daemonScript], {
      detached: true,
      windowsHide: true,
      stdio: ["ignore", logFd2, logFd2],
      env: Object.assign({}, process.env, {
        CLAUDE_RELAY_CONFIG: configPath(),
      }),
    });
    child2.unref();
    fs.closeSync(logFd2);
    newConfig.pid = child2.pid;
    saveConfig(newConfig);
    await new Promise(function (resolve) { setTimeout(resolve, 800); });
    startDaemonWatcher();
    callback(newConfig);
    return;
  }

  startDaemonWatcher();
  callback(newConfig);
}

// ==============================
// Show server started info
// ==============================
function showServerStarted(config, ip) {
  showMainMenu(config, ip);
}

// ==============================
// Main management menu
// ==============================
function showMainMenu(config, ip) {
  startDaemonWatcher();
  var protocol = config.tls ? "https" : "http";
  var url = protocol + "://" + ip + ":" + config.port;

  sendIPCCommand(socketPath(), { cmd: "get_status" }).then(function (status) {
    var projs = (status && status.projects) || [];
    var totalSessions = 0;
    var totalAwaiting = 0;
    for (var i = 0; i < projs.length; i++) {
      totalSessions += projs[i].sessions || 0;
      if (projs[i].isProcessing) totalAwaiting++;
    }

    console.clear();
    printLogo();
    log("");

    function afterQr() {
      // Status line
      log("  " + a.dim + "claude-relay" + a.reset + " " + a.dim + "v" + currentVersion + a.reset + a.dim + " — " + url + a.reset);
      var parts = [];
      parts.push(a.bold + projs.length + a.reset + a.dim + (projs.length === 1 ? " project" : " projects"));
      parts.push(a.reset + a.bold + totalSessions + a.reset + a.dim + (totalSessions === 1 ? " session" : " sessions"));
      if (totalAwaiting > 0) {
        parts.push(a.reset + a.yellow + a.bold + totalAwaiting + a.reset + a.yellow + " awaiting" + a.reset + a.dim);
      }
      log("  " + a.dim + parts.join(a.reset + a.dim + " · ") + a.reset);
      log("  Press " + a.bold + "o" + a.reset + " to open in browser");
      log("");

      showMenuItems();
    }

    if (ip !== "localhost") {
      qrcode.generate(url, { small: !isBasicTerm }, function (code) {
        var lines = code.split("\n").map(function (l) { return "  " + l; }).join("\n");
        console.log(lines);
        afterQr();
      });
    } else {
      log(a.bold + "  " + url + a.reset);
      log("");
      afterQr();
    }

    function showMenuItems() {
      var items = [
        { label: "Setup notifications", value: "notifications" },
        { label: "Projects", value: "projects" },
        { label: "Settings", value: "settings" },
        { label: "Shut down server", value: "shutdown" },
        { label: "Keep server alive & exit", value: "exit" },
      ];

      promptSelect("What would you like to do?", items, function (choice) {
        switch (choice) {
          case "notifications":
            showSetupGuide(config, ip, function () {
              config = loadConfig() || config;
              showMainMenu(config, ip);
            });
            break;

          case "projects":
            showProjectsMenu(config, ip);
            break;

          case "settings":
            showSettingsMenu(config, ip);
            break;

          case "shutdown":
            log(sym.bar);
            log(sym.bar + "  " + a.yellow + "This will stop the server completely." + a.reset);
            log(sym.bar + "  " + a.dim + "All connected sessions will be disconnected." + a.reset);
            log(sym.bar);
            promptSelect("Are you sure?", [
              { label: "Cancel", value: "cancel" },
              { label: "Shut down", value: "confirm" },
            ], function (confirm) {
              if (confirm === "confirm") {
                stopDaemonWatcher();
                sendIPCCommand(socketPath(), { cmd: "shutdown" }).then(function () {
                  log(sym.done + "  " + a.green + "Server stopped." + a.reset);
                  log("");
                  clearStaleConfig();
                  process.exit(0);
                });
              } else {
                showMainMenu(config, ip);
              }
            });
            break;

          case "exit":
            log("");
            log("  " + a.bold + "Bye!" + a.reset + "  " + a.dim + "Server is still running in background." + a.reset);
            log("  " + a.dim + "Run " + a.reset + "npx claude-relay" + a.dim + " to come back here." + a.reset);
            log("");
            process.exit(0);
            break;
        }
      }, {
        hint: [
          "Run npx claude-relay in other directories to add more projects.",
          "★ github.com/chadbyte/claude-relay — Press s to star the repo",
        ],
        keys: [
          { key: "o", onKey: function () {
            openUrl(url);
            showMainMenu(config, ip);
          }},
          { key: "s", onKey: function () {
            openUrl("https://github.com/chadbyte/claude-relay");
            showMainMenu(config, ip);
          }},
        ],
      });
    }
  });
}

// ==============================
// Projects sub-menu
// ==============================
function showProjectsMenu(config, ip) {
  sendIPCCommand(socketPath(), { cmd: "get_status" }).then(function (status) {
    if (!status.ok) {
      log(a.red + "Failed to get status" + a.reset);
      showMainMenu(config, ip);
      return;
    }

    console.clear();
    printLogo();
    log("");
    log(sym.pointer + "  " + a.bold + "Projects" + a.reset);
    log(sym.bar);

    var projs = status.projects || [];
    for (var i = 0; i < projs.length; i++) {
      var p = projs[i];
      var statusIcon = p.isProcessing ? "⚡" : (p.clients > 0 ? "🟢" : "⏸");
      var sessionLabel = p.sessions === 1 ? "1 session" : p.sessions + " sessions";
      var projName = p.title || p.project;
      log(sym.bar + "  " + a.bold + projName + a.reset + "    " + sessionLabel + "    " + statusIcon);
      log(sym.bar + "  " + a.dim + p.path + a.reset);
      if (i < projs.length - 1) log(sym.bar);
    }
    log(sym.bar);

    // Build menu items
    var items = [];

    // Check if cwd is already registered
    var cwdRegistered = false;
    for (var j = 0; j < projs.length; j++) {
      if (projs[j].path === cwd) {
        cwdRegistered = true;
        break;
      }
    }
    if (!cwdRegistered) {
      items.push({ label: "+ Add " + a.bold + path.basename(cwd) + a.reset + " " + a.dim + "(" + cwd + ")" + a.reset, value: "add_cwd" });
    }
    items.push({ label: "+ Add project...", value: "add_other" });

    for (var k = 0; k < projs.length; k++) {
      var itemLabel = projs[k].title || projs[k].project;
      items.push({ label: itemLabel, value: "detail:" + projs[k].slug });
    }
    items.push({ label: "Back", value: "back" });

    promptSelect("Select", items, function (choice) {
      if (choice === "back") {
        console.clear();
        printLogo();
        log("");
        showMainMenu(config, ip);
      } else if (choice === "add_cwd") {
        sendIPCCommand(socketPath(), { cmd: "add_project", path: cwd }).then(function (res) {
          if (res.ok) {
            log(sym.done + "  " + a.green + "Added: " + res.slug + a.reset);
            config = loadConfig() || config;
          } else {
            log(sym.warn + "  " + a.yellow + (res.error || "Failed") + a.reset);
          }
          log("");
          showProjectsMenu(config, ip);
        });
      } else if (choice === "add_other") {
        log(sym.bar);
        promptText("Directory path", cwd, function (dirPath) {
          if (dirPath === null) {
            showProjectsMenu(config, ip);
            return;
          }
          var absPath = path.resolve(dirPath);
          try {
            var stat = fs.statSync(absPath);
            if (!stat.isDirectory()) {
              log(sym.warn + "  " + a.red + "Not a directory: " + absPath + a.reset);
              setTimeout(function () { showProjectsMenu(config, ip); }, 2000);
              return;
            }
          } catch (e) {
            log(sym.warn + "  " + a.red + "Directory not found: " + absPath + a.reset);
            setTimeout(function () { showProjectsMenu(config, ip); }, 2000);
            return;
          }
          var alreadyExists = false;
          for (var pi = 0; pi < projs.length; pi++) {
            if (projs[pi].path === absPath) {
              alreadyExists = true;
              break;
            }
          }
          if (alreadyExists) {
            log(sym.done + "  " + a.yellow + "Already added: " + path.basename(absPath) + a.reset + " " + a.dim + "(" + absPath + ")" + a.reset);
            setTimeout(function () { showProjectsMenu(config, ip); }, 2000);
            return;
          }
          sendIPCCommand(socketPath(), { cmd: "add_project", path: absPath }).then(function (res) {
            if (res.ok) {
              log(sym.done + "  " + a.green + "Added: " + res.slug + a.reset + " " + a.dim + "(" + absPath + ")" + a.reset);
              config = loadConfig() || config;
            } else {
              log(sym.warn + "  " + a.yellow + (res.error || "Failed") + a.reset);
            }
            setTimeout(function () { showProjectsMenu(config, ip); }, 2000);
          });
        });
      } else if (choice.startsWith("detail:")) {
        var detailSlug = choice.substring(7);
        showProjectDetail(config, ip, detailSlug, projs);
      }
    });
  });
}

// ==============================
// Project detail
// ==============================
function showProjectDetail(config, ip, slug, projects) {
  var proj = null;
  for (var i = 0; i < projects.length; i++) {
    if (projects[i].slug === slug) {
      proj = projects[i];
      break;
    }
  }
  if (!proj) {
    showProjectsMenu(config, ip);
    return;
  }

  var displayName = proj.title || proj.project;

  console.clear();
  printLogo();
  log("");
  log(sym.pointer + "  " + a.bold + displayName + a.reset + "  " + a.dim + proj.slug + " · " + proj.path + a.reset);
  log(sym.bar);
  var sessionLabel = proj.sessions === 1 ? "1 session" : proj.sessions + " sessions";
  var clientLabel = proj.clients === 1 ? "1 client" : proj.clients + " clients";
  log(sym.bar + "  " + sessionLabel + " · " + clientLabel);
  if (proj.title) {
    log(sym.bar + "  " + a.dim + "Title: " + a.reset + proj.title);
  }
  log(sym.bar);

  var items = [
    { label: proj.title ? "Change title" : "Set title", value: "title" },
    { label: "Remove project", value: "remove" },
    { label: "Back", value: "back" },
  ];

  promptSelect("What would you like to do?", items, function (choice) {
    if (choice === "title") {
      log(sym.bar);
      promptText("Project title", proj.title || proj.project, function (newTitle) {
        if (newTitle === null) {
          showProjectDetail(config, ip, slug, projects);
          return;
        }
        var titleVal = newTitle.trim();
        // If same as directory name, clear custom title
        if (titleVal === proj.project || titleVal === "") {
          titleVal = null;
        }
        sendIPCCommand(socketPath(), { cmd: "set_project_title", slug: slug, title: titleVal }).then(function (res) {
          if (res.ok) {
            proj.title = titleVal;
            config = loadConfig() || config;
            log(sym.done + "  " + a.green + "Title updated" + a.reset);
          } else {
            log(sym.warn + "  " + a.yellow + (res.error || "Failed") + a.reset);
          }
          log("");
          showProjectDetail(config, ip, slug, projects);
        });
      });
    } else if (choice === "remove") {
      sendIPCCommand(socketPath(), { cmd: "remove_project", slug: slug }).then(function (res) {
        if (res.ok) {
          log(sym.done + "  " + a.green + "Removed: " + slug + a.reset);
          config = loadConfig() || config;
        } else {
          log(sym.warn + "  " + a.yellow + (res.error || "Failed") + a.reset);
        }
        log("");
        showProjectsMenu(config, ip);
      });
    } else {
      showProjectsMenu(config, ip);
    }
  });
}

// ==============================
// Setup guide (2x2 toggle flow)
// ==============================
function showSetupGuide(config, ip, goBack) {
  var protocol = config.tls ? "https" : "http";
  var wantRemote = false;
  var wantPush = false;

  console.clear();
  printLogo();
  log("");
  log(sym.pointer + "  " + a.bold + "Setup Notifications" + a.reset);
  log(sym.bar);

  function redraw(renderFn) {
    console.clear();
    printLogo();
    log("");
    log(sym.pointer + "  " + a.bold + "Setup Notifications" + a.reset);
    log(sym.bar);
    if (wantRemote) log(sym.done + "  Access from outside your network? " + a.dim + "·" + a.reset + " " + a.green + "Yes" + a.reset);
    else log(sym.done + "  Access from outside your network? " + a.dim + "· No" + a.reset);
    log(sym.bar);
    if (wantPush) log(sym.done + "  Want push notifications? " + a.dim + "·" + a.reset + " " + a.green + "Yes" + a.reset);
    else log(sym.done + "  Want push notifications? " + a.dim + "· No" + a.reset);
    log(sym.bar);
    renderFn();
  }

  promptToggle("Access from outside your network?", "Requires Tailscale on both devices", false, function (remote) {
    wantRemote = remote;
    log(sym.bar);
    promptToggle("Want push notifications?", "Requires HTTPS (mkcert certificate)", false, function (push) {
      wantPush = push;
      log(sym.bar);
      afterToggles();
    });
  });

  function afterToggles() {
    if (!wantRemote && !wantPush) {
      log(sym.done + "  " + a.green + "All set!" + a.reset + a.dim + " · No additional setup needed." + a.reset);
      log(sym.end);
      log("");
      promptSelect("Back?", [{ label: "Back", value: "back" }], function () {
        goBack();
      });
      return;
    }
    if (wantRemote) {
      renderTailscale();
    } else {
      renderHttps();
    }
  }

  function renderTailscale() {
    var tsIP = getTailscaleIP();

    log(sym.pointer + "  " + a.bold + "Tailscale Setup" + a.reset);
    if (tsIP) {
      log(sym.bar + "  " + a.green + "Tailscale is running" + a.reset + a.dim + " · " + tsIP + a.reset);
      log(sym.bar);
      log(sym.bar + "  On your phone/tablet:");
      log(sym.bar + "  " + a.dim + "1. Install Tailscale (App Store / Google Play)" + a.reset);
      log(sym.bar + "  " + a.dim + "2. Sign in with the same account" + a.reset);
      log(sym.bar);
      renderHttps();
    } else {
      log(sym.bar + "  " + a.yellow + "Tailscale not found on this machine." + a.reset);
      log(sym.bar + "  " + a.dim + "Install: " + a.reset + "https://tailscale.com/download");
      log(sym.bar + "  " + a.dim + "Then run: " + a.reset + "tailscale up");
      log(sym.bar);
      log(sym.bar + "  On your phone/tablet:");
      log(sym.bar + "  " + a.dim + "1. Install Tailscale (App Store / Google Play)" + a.reset);
      log(sym.bar + "  " + a.dim + "2. Sign in with the same account" + a.reset);
      log(sym.bar);
      promptSelect("Select", [
        { label: "Re-check", value: "recheck" },
        { label: "Back", value: "back" },
      ], function (choice) {
        if (choice === "recheck") {
          redraw(renderTailscale);
        } else {
          goBack();
        }
      });
    }
  }

  function renderHttps() {
    if (!wantPush) {
      showSetupQR();
      return;
    }

    var mcReady = hasMkcert();
    log(sym.pointer + "  " + a.bold + "HTTPS Setup (for push notifications)" + a.reset);
    if (mcReady) {
      log(sym.bar + "  " + a.green + "mkcert is installed" + a.reset);
      if (!config.tls) {
        log(sym.bar + "  " + a.dim + "Restarting server with HTTPS..." + a.reset);
        restartDaemonWithTLS(config, function (newConfig) {
          config = newConfig;
          log(sym.bar);
          showSetupQR();
        });
        return;
      }
      log(sym.bar);
      showSetupQR();
    } else {
      log(sym.bar + "  " + a.yellow + "mkcert not found." + a.reset);
      var mkcertHint = process.platform === "win32"
        ? "choco install mkcert && mkcert -install"
        : process.platform === "darwin"
          ? "brew install mkcert && mkcert -install"
          : "apt install mkcert && mkcert -install";
      log(sym.bar + "  " + a.dim + "Install: " + a.reset + mkcertHint);
      log(sym.bar);
      promptSelect("Select", [
        { label: "Re-check", value: "recheck" },
        { label: "Back", value: "back" },
      ], function (choice) {
        if (choice === "recheck") {
          redraw(renderHttps);
        } else {
          goBack();
        }
      });
    }
  }

  function showSetupQR() {
    var tsIP = getTailscaleIP();
    var lanIP = null;
    if (!wantRemote) {
      var allIPs = getAllIPs();
      for (var j = 0; j < allIPs.length; j++) {
        if (!allIPs[j].startsWith("100.")) { lanIP = allIPs[j]; break; }
      }
    }
    var setupIP = wantRemote ? (tsIP || ip) : (lanIP || ip);
    var setupQuery = wantRemote ? "" : "?mode=lan";
    // Always use HTTP onboarding URL for QR/setup when TLS is active
    var setupUrl = config.tls
      ? "http://" + setupIP + ":" + (config.port + 1) + "/setup" + setupQuery
      : "http://" + setupIP + ":" + config.port + "/setup" + setupQuery;
    log(sym.pointer + "  " + a.bold + "Continue on your device" + a.reset);
    log(sym.bar + "  " + a.dim + "Scan the QR code or open:" + a.reset);
    log(sym.bar + "  " + a.bold + setupUrl + a.reset);
    log(sym.bar);
    qrcode.generate(setupUrl, { small: !isBasicTerm }, function (code) {
      var lines = code.split("\n").map(function (l) { return "  " + sym.bar + "  " + l; }).join("\n");
      console.log(lines);
      log(sym.bar);
      if (wantRemote) {
        log(sym.bar + "  " + a.dim + "Can't connect? Make sure Tailscale is installed on your phone too." + a.reset);
      } else {
        log(sym.bar + "  " + a.dim + "Can't connect? Your phone must be on the same Wi-Fi network." + a.reset);
      }
      log(sym.bar);
      log(sym.done + "  " + a.dim + "Setup complete." + a.reset);
      log(sym.end);
      log("");
      promptSelect("Back?", [{ label: "Back", value: "back" }], function () {
        goBack();
      });
    });
  }
}

// ==============================
// Settings sub-menu
// ==============================
function showSettingsMenu(config, ip) {
  sendIPCCommand(socketPath(), { cmd: "get_status" }).then(function (status) {
    var isAwake = status && status.keepAwake;

    console.clear();
    printLogo();
    log("");
    log(sym.pointer + "  " + a.bold + "Settings" + a.reset);
    log(sym.bar);

    // Detect current state
    var tsIP = getTailscaleIP();
    var tsOk = tsIP !== null;
    var mcOk = hasMkcert();

    var tsStatus = tsOk
      ? a.green + "Connected" + a.reset + a.dim + " · " + tsIP + a.reset
      : a.dim + "Not detected" + a.reset;
    var mcStatus = mcOk
      ? a.green + "Installed" + a.reset
      : a.dim + "Not found" + a.reset;
    var tlsStatus = config.tls
      ? a.green + "Enabled" + a.reset
      : a.dim + "Disabled" + a.reset;
    var pinStatus = config.pinHash
      ? a.green + "Enabled" + a.reset
      : a.dim + "Off" + a.reset;
    var awakeStatus = isAwake
      ? a.green + "On" + a.reset
      : a.dim + "Off" + a.reset;

    var _rc2 = loadClayrc();
    var noCwdDefault = _rc2.noCwdDefault || false;
    var noCwdStatus = noCwdDefault ? a.green + "On" + a.reset : a.dim + "Off" + a.reset;

    log(sym.bar + "  Tailscale    " + tsStatus);
    log(sym.bar + "  mkcert       " + mcStatus);
    log(sym.bar + "  HTTPS        " + tlsStatus);
    log(sym.bar + "  PIN          " + pinStatus);
    if (process.platform === "darwin") {
      log(sym.bar + "  Keep awake   " + awakeStatus);
    }
    log(sym.bar + "  Skip CWD     " + noCwdStatus);
    log(sym.bar);

    // Build items
    var items = [
      { label: "Setup notifications", value: "guide" },
    ];

    if (config.pinHash) {
      items.push({ label: "Change PIN", value: "pin" });
      items.push({ label: "Remove PIN", value: "remove_pin" });
    } else {
      items.push({ label: "Set PIN", value: "pin" });
    }
    if (process.platform === "darwin") {
      items.push({ label: isAwake ? "Disable keep awake" : "Enable keep awake", value: "awake" });
    }
    items.push({ label: noCwdDefault ? "Disable skip-CWD default" : "Enable skip-CWD default", value: "nocwd" });
    items.push({ label: "View logs", value: "logs" });
    items.push({ label: "Back", value: "back" });

  promptSelect("Select", items, function (choice) {
    switch (choice) {
      case "guide":
        showSetupGuide(config, ip, function () {
          config = loadConfig() || config;
          showSettingsMenu(config, ip);
        });
        break;

      case "pin":
        log(sym.bar);
        promptPin(function (pin) {
          if (pin) {
            var hash = generateAuthToken(pin);
            sendIPCCommand(socketPath(), { cmd: "set_pin", pinHash: hash }).then(function () {
              config.pinHash = hash;
              log(sym.done + "  " + a.green + "PIN updated" + a.reset);
              log("");
              showSettingsMenu(config, ip);
            });
          } else {
            showSettingsMenu(config, ip);
          }
        });
        break;

      case "remove_pin":
        sendIPCCommand(socketPath(), { cmd: "set_pin", pinHash: null }).then(function () {
          config.pinHash = null;
          log(sym.done + "  " + a.dim + "PIN removed" + a.reset);
          log("");
          showSettingsMenu(config, ip);
        });
        break;

      case "logs":
        console.clear();
        log(a.bold + "Daemon logs" + a.reset + " " + a.dim + "(" + logPath() + ")" + a.reset);
        log("");
        try {
          var logContent = fs.readFileSync(logPath(), "utf8");
          var logLines = logContent.split("\n").slice(-30);
          for (var li = 0; li < logLines.length; li++) {
            log(a.dim + logLines[li] + a.reset);
          }
        } catch (e) {
          log(a.dim + "(empty)" + a.reset);
        }
        log("");
        promptSelect("Back?", [{ label: "Back", value: "back" }], function () {
          showSettingsMenu(config, ip);
        });
        break;

      case "awake":
        sendIPCCommand(socketPath(), { cmd: "set_keep_awake", value: !isAwake }).then(function (res) {
          if (res.ok) {
            config.keepAwake = !isAwake;
          }
          showSettingsMenu(config, ip);
        });
        break;

      case "nocwd":
        var _rc3 = loadClayrc();
        _rc3.noCwdDefault = !(_rc3.noCwdDefault || false);
        saveClayrc(_rc3);
        showSettingsMenu(config, ip);
        break;

      case "back":
        showMainMenu(config, ip);
        break;
    }
  });
  });
}

// ==============================
// Main entry: daemon alive?
// ==============================
var { checkAndUpdate } = require("../lib/updater");
var currentVersion = require("../package.json").version;

(async function () {
  var updated = await checkAndUpdate(currentVersion, skipUpdate);
  if (updated) return;

  var config = loadConfig();
  var alive = config ? await isDaemonAliveAsync(config) : false;

  if (!alive && config && config.pid) {
    // Stale config
    clearStaleConfig();
    config = null;
  }

  if (alive) {
    // Daemon is running — auto-add cwd if needed, then show menu
    var ip = getLocalIP();

    var status = await sendIPCCommand(socketPath(), { cmd: "get_status" });
    if (!status.ok) {
      log(a.red + "Daemon not responding" + a.reset);
      clearStaleConfig();
      process.exit(1);
      return;
    }

    // Check if cwd needs to be added
    var projs = status.projects || [];
    var cwdRegistered = false;
    for (var j = 0; j < projs.length; j++) {
      if (projs[j].path === cwd) {
        cwdRegistered = true;
        break;
      }
    }

    if (!cwdRegistered && !noCwd) {
      var slug = path.basename(cwd).toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "") || "project";
      console.clear();
      printLogo();
      log("");
      log(sym.pointer + "  " + a.bold + "Add this project?" + a.reset);
      log(sym.bar);
      log(sym.bar + "  " + a.dim + cwd + a.reset);
      log(sym.bar);
      promptSelect("Add " + a.green + slug + a.reset + " to relay?", [
        { label: "Yes", value: "yes" },
        { label: "No", value: "no" },
      ], function (answer) {
        if (answer === "yes") {
          sendIPCCommand(socketPath(), { cmd: "add_project", path: cwd }).then(function (res) {
            if (res.ok) {
              config = loadConfig() || config;
              log(sym.done + "  " + a.green + "Added: " + (res.slug || slug) + a.reset);
            }
            log("");
            showMainMenu(config || { pid: status.pid, port: status.port, tls: status.tls }, ip);
          });
        } else {
          showMainMenu(config || { pid: status.pid, port: status.port, tls: status.tls }, ip);
        }
      });
    } else {
      showMainMenu(config || { pid: status.pid, port: status.port, tls: status.tls }, ip);
    }
  } else {
    // No daemon running — first-time setup
    if (autoYes) {
      var pin = cliPin || null;
      if (dangerouslySkipPermissions && !pin) {
        console.error("  " + sym.warn + "  " + a.red + "--dangerously-skip-permissions requires --pin <pin>" + a.reset);
        process.exit(1);
        return;
      }
      console.log("  " + sym.done + "  Auto-accepted disclaimer");
      console.log("  " + sym.done + "  PIN: " + (pin ? "Enabled" : "Skipped"));
      if (dangerouslySkipPermissions) {
        console.log("  " + sym.warn + "  " + a.yellow + "Skip permissions mode enabled" + a.reset);
      }
      var autoRc = loadClayrc();
      var autoRestorable = (autoRc.recentProjects || []).filter(function (p) {
        return p.path !== cwd && fs.existsSync(p.path);
      });
      if (autoRestorable.length > 0) {
        console.log("  " + sym.done + "  Restoring " + autoRestorable.length + " previous project(s)");
      }
      await forkDaemon(pin, false, autoRestorable.length > 0 ? autoRestorable : undefined);
    } else {
      setup(function (pin, keepAwake) {
        if (dangerouslySkipPermissions && !pin) {
          log(sym.warn + "  " + a.red + "--dangerously-skip-permissions requires a PIN." + a.reset);
          log(a.dim + "     Please set a PIN to use skip permissions mode." + a.reset);
          process.exit(1);
          return;
        }
        // Check ~/.clayrc for previous projects to restore
        var rc = loadClayrc();
        var restorable = (rc.recentProjects || []).filter(function (p) {
          return p.path !== cwd && fs.existsSync(p.path);
        });

        if (restorable.length > 0) {
          promptRestoreProjects(restorable, function (selected) {
            forkDaemon(pin, keepAwake, selected);
          });
        } else {
          log(sym.bar);
          log(sym.end + "  " + a.dim + "Starting relay..." + a.reset);
          log("");
          forkDaemon(pin, keepAwake);
        }
      });
    }
  }
})();
