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
  this._processGeneration = 0;
  this._disconnectHandlers = new Set();
  this._serverRequests = require("./acp-server-requests").create(this);
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
      var env = self.opts.env == null ? process.env : Object.assign({}, self.opts.env);

      self._log("Spawning:", self.executablePath, "(" + args.length + " arguments; values omitted)");
      self.proc = spawn(self.executablePath, args, {
        stdio: ["pipe", "pipe", "pipe"],
        env: env,
        cwd: self.opts.cwd || process.cwd(),
      });

      var proc = self.proc;
      self._processGeneration++;
      proc.on("error", function(err) {
        if (self.proc !== proc) return;
        self._error("Process error:", err.message);
        if (!self.started) reject(err);
        self._disconnect(err);
      });

      proc.on("exit", function(code, signal) {
        if (self.proc !== proc) return;
        self._log("Process exited: code=" + code + " signal=" + signal);
        self._disconnect(new Error("Process exited: code=" + code));
      });

      proc.stderr.on("data", function(chunk) {
        if (self.proc !== proc) return;
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
        if (self.proc !== proc || !self.started) return;
        if (!line.trim()) return;
        try {
          self._handleMessage(JSON.parse(line));
        } catch (e) {
          self._error("Failed to parse protocol message (content omitted)");
        }
      });
      self.rl.on("close", function() {
        if (self.proc !== proc) return;
        self._log("stdout closed");
        self._disconnect(new Error("ACP stdout closed"));
      });

      self._disconnectError = null;
      self.started = true;
      resolve();
    } catch (e) {
      reject(e);
    }
  });
};

AcpProcessManager.prototype._handleMessage = function(msg) {
  if (msg.id !== undefined && msg.id !== null && (msg.result !== undefined || msg.error !== undefined)) {
    var pending = Object.prototype.hasOwnProperty.call(this.pendingRequests, msg.id) && this.pendingRequests[msg.id];
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
  if (isRequest && ((typeof msg.id !== "string" && typeof msg.id !== "number") ||
      (typeof msg.id === "number" && !Number.isFinite(msg.id)) || (typeof msg.id === "string" && msg.id.length > 1024))) {
    this._write({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "Invalid ACP request ID" } });
    return;
  }
  var receipt = isRequest && this._serverRequests.admit(msg);
  if (isRequest && !receipt) return;
  if (isRequest) Object.defineProperty(msg, "_acpRequest", { value: receipt, configurable: true });
  var directHandler = isRequest && Object.prototype.hasOwnProperty.call(this.requestHandlers, msg.method) && this.requestHandlers[msg.method];
  if (directHandler) {
    var self = this;
    Promise.resolve().then(function() {
      if (!self.started || receipt.process !== self.proc || receipt.generation !== self._processGeneration) throw new Error("ACP request belongs to a disconnected process");
      return directHandler(msg.params || {}, msg);
    }).then(function(result) {
      self.respond(msg.id, result, receipt);
    }).catch(function(err) {
      self._error("Request handler failed for " + msg.method + ":", err && err.message ? err.message : err);
      self.respondError(msg.id, -32002, err && err.message ? err.message : "Request handler failed", receipt);
    });
    return;
  }

  if (isRequest && ["session/request_permission", "elicitation/create"].indexOf(msg.method) < 0) {
    this.respondError(msg.id, -32601, "No process handler for method " + msg.method, receipt);
    return;
  }
  var sessionId = msg.params && msg.params.sessionId;
  if (isRequest && !sessionId) {
    this._warn("No process handler for request " + msg.method + ", rejecting");
    this.respondError(msg.id, -32601, "No process handler for method " + msg.method, receipt);
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
      this.respondError(msg.id, -32001, "No active handler for session " + (sessionId || "none"), receipt);
    } else {
      this._log("Unhandled event:", msg.method);
    }
    return;
  }

  if (isRequest) {
    if (Array.isArray(targets[0].requestMethods) && targets[0].requestMethods.indexOf(msg.method) === -1) {
      this.respondError(msg.id, -32601, "Unsupported request for this ACP query: " + msg.method, receipt);
      return;
    }
    try {
      targets[0].fn(msg);
    } catch (e) {
      this._error("Handler threw for " + msg.method + ":", e && e.message ? e.message : e);
      this.respondError(msg.id, -32000, "Handler error", receipt);
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
  if (index !== -1) {
    this.handlers.splice(index, 1);
    if (typeof entry.onRemoved === "function") entry.onRemoved();
  }
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

AcpProcessManager.prototype.respond = function(id, result, receipt) {
  if (!this._serverRequests.finish(id, receipt)) return;
  this._write({ jsonrpc: "2.0", id: id, result: result });
};

AcpProcessManager.prototype.respondError = function(id, code, message, receipt) {
  if (!this._serverRequests.finish(id, receipt)) return;
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

AcpProcessManager.prototype.addDisconnectHandler = function(fn) {
  this._disconnectHandlers.add(fn);
  var self = this;
  return function() { self._disconnectHandlers.delete(fn); };
};
AcpProcessManager.prototype._disconnect = function(error) {
  this.started = false;
  this._disconnectError = error;
  this._disconnectHandlers.forEach(function(fn) { try { fn(error); } catch (e) {} });
  this._rejectAllPending(error);
};
AcpProcessManager.prototype.stop = function(error) {
  this._disconnect(error || new Error("ACP transport stopped"));

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
