// Codex App-Server Protocol Client
// ---------------------------------
// Manages a codex app-server child process with bidirectional JSON-RPC
// communication over stdin/stdout. Replaces the SDK exec mode to enable
// interactive approval flows.

var { spawn } = require("child_process");
var readline = require("readline");
var path = require("path");
var fs = require("fs");
var { createRequire } = require("module");
var { buildUserEnv } = require("../build-user-env");
var { wrapSpawnAsUser } = require("../os-users");

// --- Find the codex binary path ---
// Mirrors the logic from @openai/codex-sdk findCodexPath().
//
// The bundled @openai/codex platform package is the default. Set the
// CLAY_CODEX_PATH env var to an existing executable to run a different codex
// build (local dev build, system install, pinned older release); the chosen
// binary is logged on every resolution. An unset or non-existent
// CLAY_CODEX_PATH silently falls back to the bundled resolution.

var PLATFORM_PACKAGE_BY_TARGET = {
  "aarch64-apple-darwin": "@openai/codex-darwin-arm64",
  "x86_64-apple-darwin": "@openai/codex-darwin-x64",
  "aarch64-unknown-linux-musl": "@openai/codex-linux-arm64",
  "x86_64-unknown-linux-musl": "@openai/codex-linux-x64",
  "x86_64-pc-windows-msvc": "@openai/codex-win32-x64",
};

function getTargetTriple() {
  var arch = process.arch;
  var platform = process.platform;
  if (platform === "darwin") {
    return arch === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin";
  }
  if (platform === "linux") {
    return arch === "arm64" ? "aarch64-unknown-linux-musl" : "x86_64-unknown-linux-musl";
  }
  if (platform === "win32") {
    return "x86_64-pc-windows-msvc";
  }
  return null;
}

function findCodexPath() {
  var override = process.env.CLAY_CODEX_PATH;
  if (override) {
    if (fs.existsSync(override)) {
      console.log("[codex-app-server] Using CLAY_CODEX_PATH binary:", override);
      return override;
    }
    console.warn("[codex-app-server] CLAY_CODEX_PATH does not exist, falling back to bundled codex:", override);
  }

  var triple = getTargetTriple();
  if (!triple) throw new Error("Unsupported platform: " + process.platform + "/" + process.arch);

  var platformPkg = PLATFORM_PACKAGE_BY_TARGET[triple];
  if (!platformPkg) throw new Error("No codex binary package for: " + triple);

  try {
    var codexPkgJson = require.resolve("@openai/codex/package.json");
    var codexRequire = createRequire(codexPkgJson);
    var platformPkgJson = codexRequire.resolve(platformPkg + "/package.json");
    var vendorRoot = path.join(path.dirname(platformPkgJson), "vendor");
    var binaryName = process.platform === "win32" ? "codex.exe" : "codex";
    // The binary layout changed across versions: 0.142+ ships it under
    // vendor/<triple>/bin/, older builds used vendor/<triple>/codex/.
    // Try the known layouts and return the first that exists.
    var candidates = [
      path.join(vendorRoot, triple, "bin", binaryName),
      path.join(vendorRoot, triple, "codex", binaryName),
    ];
    for (var i = 0; i < candidates.length; i++) {
      if (fs.existsSync(candidates[i])) {
        console.log("[codex-app-server] Using bundled codex binary:", candidates[i]);
        return candidates[i];
      }
    }
    throw new Error("codex binary not found in any known layout under " + path.join(vendorRoot, triple));
  } catch (e) {
    throw new Error("Could not find codex binary: " + e.message);
  }
}

// --- Config serialization ---
// Flattens a nested config object into --config key=value pairs.
// Values are serialized as TOML literals (strings quoted, others raw).
// e.g. { mcp_servers: { "clay-tools": { command: "node", args: ["a.js"] } } }
// -> ["mcp_servers.clay-tools.command=\"node\"", "mcp_servers.clay-tools.args=[\"a.js\"]"]

function serializeConfig(obj, prefix) {
  var result = [];
  var keys = Object.keys(obj);
  for (var i = 0; i < keys.length; i++) {
    var key = keys[i];
    var val = obj[key];
    var fullKey = prefix ? prefix + "." + key : key;

    if (val === null || val === undefined) continue;

    if (typeof val === "object" && !Array.isArray(val)) {
      // Recurse for nested objects
      var nested = serializeConfig(val, fullKey);
      for (var j = 0; j < nested.length; j++) {
        result.push(nested[j]);
      }
    } else {
      // Leaf value: serialize as TOML
      result.push(fullKey + "=" + toTomlValue(val));
    }
  }
  return result;
}

function toTomlValue(val) {
  if (typeof val === "string") return JSON.stringify(val);
  if (typeof val === "boolean") return val ? "true" : "false";
  if (typeof val === "number") return String(val);
  if (Array.isArray(val)) return "[" + val.map(function(v) { return toTomlValue(v); }).join(", ") + "]";
  return JSON.stringify(val);
}

// --- CodexAppServer ---

function CodexAppServer(executablePath, opts) {
  this.proc = null;
  this.rl = null;
  this.nextId = 1;
  this.pendingRequests = {};  // id -> { resolve, reject, timer }
  // One app-server process is shared by every Codex session in a project.
  // Route server-initiated events by threadId so a temporary query (such as
  // title generation) cannot replace the handler for a long-lived session.
  this.handlers = [];         // [{ threadId, fn }]
  this.executablePath = executablePath || findCodexPath();
  this.opts = opts || {};
  this.started = false;
  this._stderrBuf = "";
}

function buildSpawnSpec(executablePath, args, opts, wrapFn) {
  opts = opts || {};
  var osUserInfo = opts.osUserInfo || null;
  var env = osUserInfo
    ? Object.assign(buildUserEnv(osUserInfo), opts.env || {})
    : Object.assign({}, process.env, opts.env || {});
  var spawnOptions = {
    stdio: ["pipe", "pipe", "pipe"],
    env: env,
    cwd: opts.cwd || process.cwd(),
  };
  if (osUserInfo) {
    spawnOptions.uid = osUserInfo.uid;
    spawnOptions.gid = osUserInfo.gid;
  }
  return (wrapFn || wrapSpawnAsUser)(executablePath, args, spawnOptions);
}

CodexAppServer.prototype.start = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    try {
      var args = ["app-server"];
      // Pass config overrides via --config key=value flags
      if (self.opts.config) {
        var configArgs = serializeConfig(self.opts.config, "");
        for (var ci = 0; ci < configArgs.length; ci++) {
          args.push("--config", configArgs[ci]);
        }
      }

      var spawnSpec = buildSpawnSpec(self.executablePath, args, self.opts);
      var userSuffix = self.opts.osUserInfo ? " as " + self.opts.osUserInfo.user : "";
      console.log("[codex-app-server] Spawning" + userSuffix + ":", spawnSpec.command, "(" + spawnSpec.args.length + " arguments; values omitted)");

      self.proc = spawn(spawnSpec.command, spawnSpec.args, spawnSpec.options);

      self.proc.on("error", function(err) {
        console.error("[codex-app-server] Process error:", err.message);
        if (!self.started) {
          reject(err);
        }
        self._rejectAllPending(err);
      });

      self.proc.on("exit", function(code, signal) {
        console.log("[codex-app-server] Process exited: code=" + code + " signal=" + signal);
        self.started = false;
        self._rejectAllPending(new Error("Process exited: code=" + code));
      });

      // Collect stderr for debugging
      self.proc.stderr.on("data", function(chunk) {
        var text = chunk.toString();
        self._stderrBuf += text;
        // Print stderr lines as they come
        var lines = self._stderrBuf.split("\n");
        while (lines.length > 1) {
          var line = lines.shift();
          if (line.trim()) console.log("[codex-app-server stderr]", line);
          self._maybeSignalAuthError(line);
        }
        self._stderrBuf = lines[0] || "";
      });

      // Set up line-based JSON-RPC reading from stdout
      self.rl = readline.createInterface({
        input: self.proc.stdout,
        crlfDelay: Infinity,
      });

      self.rl.on("line", function(line) {
        if (!line.trim()) return;
        try {
          var msg = JSON.parse(line);
          self._handleMessage(msg);
        } catch (e) {
          console.error("[codex-app-server] Failed to parse protocol message (content omitted)");
        }
      });

      self.rl.on("close", function() {
        console.log("[codex-app-server] stdout closed");
      });

      self.started = true;
      resolve();
    } catch (e) {
      reject(e);
    }
  });
};

CodexAppServer.prototype._handleMessage = function(msg) {
  // Response to a request we sent
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    var pending = this.pendingRequests[msg.id];
    if (pending) {
      delete this.pendingRequests[msg.id];
      if (pending.timer) clearTimeout(pending.timer);
      if (msg.error) {
        pending.reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      } else {
        pending.resolve(msg.result);
      }
    }
    return;
  }

  // Server-initiated request (has id + method) or notification (has method, no id)
  if (msg.method) {
    var params = msg.params || {};
    var threadId = params.threadId
      || (params.thread && params.thread.id)
      || (params.turn && params.turn.threadId)
      || null;
    var targets;
    if (threadId) {
      targets = this.handlers.filter(function(handler) {
        return handler.threadId === threadId;
      });
    } else {
      // Process-wide events such as auth failures belong to every live query.
      targets = this.handlers.slice();
    }

    if (!targets.length) {
      if (msg.id !== undefined && msg.id !== null) {
        console.warn("[codex-app-server] No handler for request " + msg.method + " (thread=" + (threadId || "none") + "), rejecting");
        this.respondError(msg.id, -32001, "No active handler for thread " + (threadId || "none"));
      } else {
        console.log("[codex-app-server] Unhandled event:", msg.method);
      }
      return;
    }

    // A JSON-RPC request must be answered exactly once. Notifications may fan
    // out when they are process-wide and intentionally have no thread id.
    if (msg.id !== undefined && msg.id !== null) {
      try {
        targets[0].fn(msg);
      } catch (e) {
        console.error("[codex-app-server] Handler threw for " + msg.method + ":", e && e.message ? e.message : e);
        this.respondError(msg.id, -32000, "Handler error");
      }
      return;
    }
    targets.forEach(function(handler) {
      try { handler.fn(msg); } catch (e) {
        console.error("[codex-app-server] Handler threw for " + msg.method + ":", e && e.message ? e.message : e);
      }
    });
  }
};

CodexAppServer.prototype.addHandler = function(fn) {
  var entry = { threadId: null, fn: fn };
  this.handlers.push(entry);
  return entry;
};

CodexAppServer.prototype.removeHandler = function(entry) {
  var index = this.handlers.indexOf(entry);
  if (index !== -1) this.handlers.splice(index, 1);
};

// The definitive "not logged in" signal from Codex is a 401 on its own
// responses endpoint, which only appears on stderr (not as a JSON-RPC error).
// When we see it, synthesize an error event so the adapter maps it to the
// neutral auth_required yokeType. Deduped so a burst of 401 retries collapses.
CodexAppServer.prototype._maybeSignalAuthError = function(line) {
  if (!this.handlers.length || !line || this._authSignalSent) return;
  var isAuth = /missing bearer|token[_ ]?revoked|invalidated oauth|please sign in again/i.test(line)
    || (/\b401\b/.test(line) && /unauthorized|responses|openai\.com|chatgpt\.com/i.test(line));
  if (!isAuth) return;
  this._authSignalSent = true;
  var self = this;
  setTimeout(function () { self._authSignalSent = false; }, 15000);
  try {
    this._handleMessage({ method: "error", params: { error: { codexErrorInfo: "unauthorized", message: line } } });
  } catch (e) {}
};

// Send a JSON-RPC request (expects a response)
CodexAppServer.prototype.send = function(method, params, timeoutMs) {
  var self = this;
  var id = this.nextId++;
  timeoutMs = timeoutMs || 30000;

  return new Promise(function(resolve, reject) {
    if (!self.proc || !self.started) {
      return reject(new Error("App-server not started"));
    }

    var timer = setTimeout(function() {
      delete self.pendingRequests[id];
      reject(new Error("Request timeout: " + method + " (id=" + id + ")"));
    }, timeoutMs);

    self.pendingRequests[id] = { resolve: resolve, reject: reject, timer: timer };

    var msg = { jsonrpc: "2.0", id: id, method: method };
    if (params !== undefined) msg.params = params;

    self._write(msg);
  });
};

// Send a JSON-RPC notification (no response expected)
CodexAppServer.prototype.notify = function(method, params) {
  if (!this.proc || !this.started) return;

  var msg = { jsonrpc: "2.0", method: method };
  if (params !== undefined) msg.params = params;

  this._write(msg);
};

// Respond to a server-initiated request
CodexAppServer.prototype.respond = function(id, result) {
  if (!this.proc || !this.started) return;

  var msg = { jsonrpc: "2.0", id: id, result: result };
  this._write(msg);
};

// Respond with an error to a server-initiated request
CodexAppServer.prototype.respondError = function(id, code, message) {
  if (!this.proc || !this.started) return;

  var msg = { jsonrpc: "2.0", id: id, error: { code: code || -1, message: message || "Error" } };
  this._write(msg);
};

CodexAppServer.prototype._write = function(msg) {
  if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) return;
  try {
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
  } catch (e) {
    console.error("[codex-app-server] Write error:", e.message);
  }
};

CodexAppServer.prototype._rejectAllPending = function(err) {
  var ids = Object.keys(this.pendingRequests);
  for (var i = 0; i < ids.length; i++) {
    var pending = this.pendingRequests[ids[i]];
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(err);
  }
  this.pendingRequests = {};
};

CodexAppServer.prototype.stop = function() {
  this.started = false;
  this._rejectAllPending(new Error("Stopped"));

  if (this.rl) {
    this.rl.close();
    this.rl = null;
  }

  if (this.proc) {
    try {
      this.proc.stdin.end();
    } catch (e) {}
    try {
      this.proc.kill("SIGTERM");
    } catch (e) {}
    this.proc = null;
  }
};

module.exports = {
  CodexAppServer: CodexAppServer,
  findCodexPath: findCodexPath,
  buildSpawnSpec: buildSpawnSpec,
};
