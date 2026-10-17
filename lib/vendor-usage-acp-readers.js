// Kiro account usage through Kiro's own ACP server.
//
// Source (verified against the installed kiro-cli 2.32.0, not a web snippet):
// `kiro-cli acp` advertises `/usage` ("Show billing and usage information") in
// its available commands, and `_kiro.dev/commands/execute` with command "usage"
// answers with { success, message, data: { planName, billingCycleReset,
// overagesEnabled, usageBreakdowns: [{ resourceType, displayName, used, limit,
// percentage, hasLimit, currency, overageCharges, ... }] } }. The probe made no
// model turn. It does create an empty local Kiro session record (session/new is
// required before a command can run), under a neutral temp directory.
//
// A short-lived process is started per read, as the server user, with a hard
// timeout and kill; nothing is retained. Because the credential belongs to the
// server user, the capability table restricts it to single-user mode.

var m = require("./vendor-usage-metrics");
var failure = require("./vendor-usage-native-readers").failure;

function rpc(child, onFrame) {
  var next = 0;
  var pending = Object.create(null);
  var buffer = "";
  child.stdout.on("data", function (chunk) {
    buffer += chunk;
    if (buffer.length > 4 * 1024 * 1024) { buffer = ""; return; }
    var lines = buffer.split("\n");
    buffer = lines.pop();
    lines.forEach(function (line) {
      var frame;
      try { frame = JSON.parse(line); } catch (e) { return; }
      if (frame && frame.id !== undefined && pending[frame.id]) {
        var entry = pending[frame.id];
        delete pending[frame.id];
        if (frame.error) entry.reject(failure("server", "Kiro rejected the usage request."));
        else entry.resolve(frame.result);
      } else if (onFrame) onFrame(frame);
    });
  });
  return {
    request: function (method, params) {
      var id = ++next;
      return new Promise(function (resolve, reject) {
        pending[id] = { resolve: resolve, reject: reject };
        child.stdin.write(JSON.stringify({ jsonrpc: "2.0", id: id, method: method, params: params }) + "\n");
      });
    },
    failAll: function (error) { Object.keys(pending).forEach(function (id) { pending[id].reject(error); delete pending[id]; }); },
  };
}

function mapUsage(data) {
  var metrics = [];
  var reset = typeof data.billingCycleReset === "string" ? Date.parse(data.billingCycleReset) : NaN;
  var resetsAtMs = Number.isFinite(reset) ? reset : null;
  (Array.isArray(data.usageBreakdowns) ? data.usageBreakdowns : []).forEach(function (item, index) {
    if (!item || item.hasLimit !== true) return;
    var used = m.num(item.used);
    var limit = m.num(item.limit);
    if (used === null || limit === null || limit <= 0) return;
    var label = typeof item.displayName === "string" && item.displayName ? item.displayName : "Credits";
    metrics.push(m.metric("credits", "kiro:" + (item.resourceType || index), label, { used: used, limit: limit, balance: null, unlimited: false, resetsAtMs: resetsAtMs }));
    var charges = m.num(item.overageCharges);
    if (data.overagesEnabled === true && charges !== null && typeof item.currency === "string" && item.currency) {
      metrics.push(m.metric("currency", "kiro:overage:" + (item.resourceType || index), "Overage charges", { used: charges, limit: null, balance: null, currencyCode: item.currency, resetsAtMs: resetsAtMs }));
    }
  });
  return { metrics: metrics, planType: typeof data.planName === "string" ? data.planName : null };
}

// deps: { binary(): path|null, spawn(command, args, options), tmpdir(), signal }
async function kiro(context, deps) {
  var binary = deps.binary();
  if (!binary) throw failure("unavailable", "The Kiro CLI was not found.");
  var child = deps.spawn(binary, ["acp"], { stdio: ["pipe", "pipe", "ignore"], cwd: deps.tmpdir(), env: deps.env });
  var link = rpc(child);
  var died = new Promise(function (resolve, reject) {
    child.on("error", function () { reject(failure("unavailable", "The Kiro CLI could not be started.")); });
    child.on("exit", function () { reject(failure("unavailable", "The Kiro CLI exited before answering.")); });
  });
  died.catch(function () {});
  var abort = context && context.signal;
  var stop = function () { try { child.kill("SIGKILL"); } catch (e) {} link.failAll(failure("timeout", "The usage read was cancelled.")); };
  if (abort) { if (abort.aborted) stop(); else abort.addEventListener("abort", stop, { once: true }); }
  try {
    await Promise.race([link.request("initialize", { protocolVersion: 1, clientCapabilities: {} }), died]);
    var session = await Promise.race([link.request("session/new", { cwd: deps.tmpdir(), mcpServers: [] }), died]);
    if (!session || typeof session.sessionId !== "string") throw failure("parse", "Kiro returned no session.");
    var reply = await Promise.race([link.request("_kiro.dev/commands/execute", { sessionId: session.sessionId, command: { command: "usage", args: {} } }), died]);
    if (!reply || reply.success !== true || !reply.data || typeof reply.data !== "object") throw failure("unavailable", "Kiro did not report usage for this account.");
    return mapUsage(reply.data);
  } finally {
    if (abort) abort.removeEventListener("abort", stop);
    try { child.kill("SIGKILL"); } catch (e) {}
  }
}

module.exports = { kiro: kiro, mapUsage: mapUsage };
