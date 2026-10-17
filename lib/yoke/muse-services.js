// Typed MSP operations; no arbitrary command forwarding or automatic effect replay.
var runtimeTools = require("./muse-runtime");
function attach(adapter) {
  async function withRuntime(options, operation) {
    options = options || {};
    if (options.linuxUser || options.osUsers) throw new Error("Muse Code does not support OS-owner isolation");
    if (adapter.shuttingDown) throw new Error("Muse Code adapter is shutting down");
    if (!adapter.binaryPath) await adapter.init(options);
    var sdk = await adapter.loadSdk();
    if (adapter.shuttingDown) throw new Error("Muse Code adapter is shutting down");
    var runtime = runtimeTools.createRuntime(adapter, sdk, {
      command: adapter.binaryPath, args: ["serve"], cwd: options.dir || adapter.cwd,
      env: Object.assign({}, process.env),
    });
    runtime.fail = function() { runtime.close().catch(function(error) { adapter.lastCloseError = error; }); };
    // An abort signal (a timeout or a cancelled caller) closes the runtime so
    // the spawned `muse serve` does not outlive the request.
    var signal = options.signal, onAbort = null, aborted = null;
    if (signal) {
      aborted = new Promise(function(resolve, reject) {
        onAbort = function() { runtime.close().catch(function(error) { adapter.lastCloseError = error; }); reject(new Error("The Muse request was cancelled.")); };
        if (signal.aborted) onAbort(); else signal.addEventListener("abort", onAbort, { once: true });
      });
      aborted.catch(function() {});
    }
    try {
      var spawned = await (aborted ? Promise.race([runtime.initialize(), aborted]) : runtime.initialize());
      return await (aborted ? Promise.race([operation(runtime, spawned), aborted]) : operation(runtime, spawned));
    } finally {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      await runtime.close();
    }
  }
  adapter.listSessionPage = function(options) {
    options = options || {};
    return withRuntime(options, async function(runtime, spawned) {
      var params = { workspaceRoot: options.dir || adapter.cwd, limit: options.limit || 50 };
      if (options.cursor != null) params.cursor = options.cursor;
      var page = await runtime.waitRequest(spawned.connection.request("session/list", params));
      if (!Array.isArray(page.sessions)) throw new Error("Invalid Muse session list");
      return page;
    });
  };
  adapter.listSessions = async function(options) {
    var page = await adapter.listSessionPage(options);
    page.sessions.nextCursor = page.nextCursor;
    return page.sessions;
  };
  adapter.readSession = function(sessionId, options) {
    if (typeof sessionId !== "string" || !sessionId) return Promise.reject(new Error("Muse read requires an exact session id"));
    return withRuntime(options, function(runtime, spawned) {
      return runtime.waitRequest(spawned.connection.request("session/read", { sessionId: sessionId, excludeItems: !(options && options.includeItems) }));
    });
  };
  adapter.renameSession = function(sessionId, name, options) {
    if (typeof sessionId !== "string" || !sessionId || typeof name !== "string" || !name.trim()) return Promise.reject(new Error("Muse rename requires an exact session and name"));
    return withRuntime(options, async function(runtime, spawned) {
      if (sdkDurability(spawned) !== "durable") throw new Error("Muse rename is unsupported by an ephemeral host");
      await runtime.waitRequest(spawned.connection.command("session/resume", { sessionId: sessionId, excludeItems: true }));
      return runtime.waitRequest(spawned.connection.command("session/rename", { sessionId: sessionId, name: name }));
    });
  };
  adapter.forkSession = function(sessionId, options) {
    options = options || {};
    return withRuntime(options, async function(runtime, spawned) {
      var params = { sessionId: sessionId, excludeItems: true };
      if (options.upToMessageId) params.cutPoint = { lastTurnId: options.upToMessageId };
      var result = await runtime.waitRequest(spawned.connection.command("session/fork", params));
      if (!result.session || !result.session.sessionId) throw new Error("Muse fork returned no session id; inspect before retrying");
      return { sessionId: result.session.sessionId, useLocalHistory: true };
    });
  };
  adapter.readUsage = function(options) {
    return withRuntime(options, async function(runtime, spawned) {
      var result = await runtime.waitRequest(spawned.connection.request("usage/read", {}));
      return result.usage || null;
    });
  };
}
function sdkDurability(spawned) { return spawned.initializeResult.sessionDurability; }
function quotaEvent(usage) {
  if (!usage || !Number.isFinite(usage.observedAtMs)) return null;
  var windows = [];
  ["window", "weekly"].forEach(function(key) {
    var value = usage[key];
    if (!value || !Number.isFinite(value.usedPercent) || value.usedPercent < 0 || !Number.isFinite(value.resetsAtMs)) return;
    windows.push({ key: key, usedPercent: value.usedPercent, resetsAt: value.resetsAtMs / 1000,
      windowDurationMins: key === "weekly" ? 10080 : value.windowDurationMins || null });
  });
  return { yokeType: "rate_limit", rateLimitInfo: { source: "account_snapshot", limitId: "muse", observedAtMs: usage.observedAtMs, windows: windows } };
}
module.exports = { attach: attach, quotaEvent: quotaEvent };
