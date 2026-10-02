// Shared ACP Process Manager
// --------------------------
// Manages an ACP child process over line-delimited JSON-RPC 2.0. The child can
// answer client requests and initiate its own requests or notifications.

var { spawn } = require("child_process");
var readline = require("readline");

function AcpProcessManager(executablePath, opts) {
  this.proc = null;
  this.rl = null;
  this.nextId = 1;
  this.pendingRequests = {};
  this.requestHandlers = {};
  this.handlers = [];
  this.executablePath = executablePath;
  this.opts = opts || {};
  this.started = false;
  this._stderrBuf = "";
  this._logPrefix = this.opts.logPrefix || "acp-process-manager";
}

AcpProcessManager.prototype._log = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[" + this._logPrefix + "]");
  console.log.apply(console, args);
};

AcpProcessManager.prototype._warn = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[" + this._logPrefix + "]");
  console.warn.apply(console, args);
};

AcpProcessManager.prototype._error = function() {
  var args = Array.prototype.slice.call(arguments);
  args.unshift("[" + this._logPrefix + "]");
  console.error.apply(console, args);
};

AcpProcessManager.prototype.start = function() {
  var self = this;

  return new Promise(function(resolve, reject) {
    try {
      var args = self.opts.args ? self.opts.args.slice() : [];
      var env = Object.assign({}, process.env, self.opts.env || {});

      self._log("Spawning:", self.executablePath, args.join(" "));
      self.proc = spawn(self.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: env,
        cwd: self.opts.cwd || process.cwd(),
      });

      self.proc.on("error", function(err) {
        self._error("Process error:", err.message);
        if (!self.started) reject(err);
        self._rejectAllPending(err);
      });

      self.proc.on("exit", function(code, signal) {
        self._log("Process exited: code=" + code + " signal=" + signal);
        self.started = false;
        self._rejectAllPending(new Error("Process exited: code=" + code));
      });

      self.proc.stderr.on("data", function(chunk) {
        self._stderrBuf += chunk.toString();
        var lines = self._stderrBuf.split("\n");
        while (lines.length > 1) {
          var line = lines.shift();
          if (line.trim() && self.opts.logStderr !== false) self._log("stderr", line);
          if (self.opts.onStderrLine) self.opts.onStderrLine(line, self);
        }
        self._stderrBuf = lines[0] || "";
      });

      self.rl = readline.createInterface({ input: self.proc.stdout, crlfDelay: Infinity });
      self.rl.on("line", function(line) {
        if (!line.trim()) return;
        try {
          self._handleMessage(JSON.parse(line));
        } catch (e) {
          self._error("Failed to parse line:", line.substring(0, 200));
        }
      });
      self.rl.on("close", function() {
        self._log("stdout closed");
      });

      self.started = true;
      resolve();
    } catch (e) {
      reject(e);
    }
  });
};

AcpProcessManager.prototype._handleMessage = function(msg) {
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    var pending = this.pendingRequests[msg.id];
    if (pending) {
      delete this.pendingRequests[msg.id];
      if (pending.timer) clearTimeout(pending.timer);
      if (msg.error) {
        var err = new Error(msg.error.message || JSON.stringify(msg.error));
        err.rpcError = msg.error;
        pending.reject(err);
      } else {
        pending.resolve(msg.result);
      }
    }
    return;
  }

  if (!msg.method) return;

  var isRequest = msg.id !== undefined && msg.id !== null;
  var directHandler = isRequest && this.requestHandlers[msg.method];
  if (directHandler) {
    var self = this;
    Promise.resolve().then(function() {
      return directHandler(msg.params || {}, msg);
    }).then(function(result) {
      self.respond(msg.id, result);
    }).catch(function(err) {
      self._error("Request handler failed for " + msg.method + ":", err && err.message ? err.message : err);
      self.respondError(msg.id, -32002, err && err.message ? err.message : "Request handler failed");
    });
    return;
  }

  var sessionId = msg.params && msg.params.sessionId;
  if (isRequest && !sessionId) {
    this._warn("No process handler for request " + msg.method + ", rejecting");
    this.respondError(msg.id, -32601, "No process handler for method " + msg.method);
    return;
  }
  var targets;
  if (sessionId) {
    targets = this.handlers.filter(function(handler) { return handler.sessionId === sessionId; });
  } else {
    targets = this.handlers.slice();
  }

  if (!targets.length) {
    if (isRequest) {
      this._warn("No handler for request " + msg.method + " (session=" + (sessionId || "none") + "), rejecting");
      this.respondError(msg.id, -32001, "No active handler for session " + (sessionId || "none"));
    } else {
      this._log("Unhandled event:", msg.method);
    }
    return;
  }

  if (isRequest) {
    try {
      targets[0].fn(msg);
    } catch (e) {
      this._error("Handler threw for " + msg.method + ":", e && e.message ? e.message : e);
      this.respondError(msg.id, -32000, "Handler error");
    }
    return;
  }

  targets.forEach(function(handler) {
    try {
      handler.fn(msg);
    } catch (e) {
      this._error("Handler threw for " + msg.method + ":", e && e.message ? e.message : e);
    }
  }, this);
};

AcpProcessManager.prototype.addHandler = function(fn) {
  var entry = { sessionId: null, fn: fn };
  this.handlers.push(entry);
  return entry;
};

AcpProcessManager.prototype.removeHandler = function(entry) {
  var index = this.handlers.indexOf(entry);
  if (index !== -1) this.handlers.splice(index, 1);
};

AcpProcessManager.prototype.addRequestHandler = function(method, fn) {
  this.requestHandlers[method] = fn;
};

AcpProcessManager.prototype.send = function(method, params, timeoutMs, signal) {
  var self = this;
  var id = this.nextId++;
  timeoutMs = timeoutMs || 30000;
  return new Promise(function(resolve, reject) {
    var timer;
    function cleanup() {
      if (timer) clearTimeout(timer);
      delete self.pendingRequests[id];
      if (signal) signal.removeEventListener("abort", cancel);
    }
    function fail(error) { cleanup(); reject(error); }
    function cancel() {
      var error = new Error("ACP request cancelled: " + method);
      error.name = "AbortError";
      fail(error);
    }
    if (signal && signal.aborted) { cancel(); return; }
    if (!self.proc || !self.started) { fail(new Error("ACP server not started")); return; }
    timer = setTimeout(function() { fail(new Error("Request timeout: " + method + " (id=" + id + ")")); }, timeoutMs);
    self.pendingRequests[id] = {
      resolve: function (value) { cleanup(); resolve(value); }, reject: fail, timer: timer,
    };
    if (signal) signal.addEventListener("abort", cancel, { once: true });
    var msg = { jsonrpc: "2.0", id: id, method: method };
    if (params !== undefined) msg.params = params;
    if (self._write(msg) === false) fail(new Error("ACP transport is not writable"));
  });
};

AcpProcessManager.prototype.notify = function(method, params) {
  if (!this.proc || !this.started) return false;
  var msg = { jsonrpc: "2.0", method: method };
  if (params !== undefined) msg.params = params;
  return this._write(msg);
};

AcpProcessManager.prototype.respond = function(id, result) {
  if (!this.proc || !this.started) return;
  this._write({ jsonrpc: "2.0", id: id, result: result });
};

AcpProcessManager.prototype.respondError = function(id, code, message) {
  if (!this.proc || !this.started) return;
  this._write({ jsonrpc: "2.0", id: id, error: { code: code || -1, message: message || "Error" } });
};

AcpProcessManager.prototype._write = function(msg) {
  if (!this.proc || !this.proc.stdin || this.proc.stdin.destroyed) return false;
  try {
    this.proc.stdin.write(JSON.stringify(msg) + "\n");
    return true;
  } catch (e) {
    this._error("Write error:", e.message);
    return false;
  }
};

AcpProcessManager.prototype._rejectAllPending = function(err) {
  var ids = Object.keys(this.pendingRequests);
  for (var i = 0; i < ids.length; i++) {
    var pending = this.pendingRequests[ids[i]];
    if (pending.timer) clearTimeout(pending.timer);
    pending.reject(err);
  }
  this.pendingRequests = {};
};

AcpProcessManager.prototype.stop = function() {
  this.started = false;
  this._rejectAllPending(new Error("Stopped"));

  if (this.rl) {
    this.rl.close();
    this.rl = null;
  }
  if (this.proc) {
    try { this.proc.stdin.end(); } catch (e) {}
    try { this.proc.kill("SIGTERM"); } catch (e) {}
    this.proc = null;
  }
};

module.exports = { AcpProcessManager: AcpProcessManager };
