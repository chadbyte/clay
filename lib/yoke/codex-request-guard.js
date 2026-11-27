// Query-local approval receipts. A cancelled or resolved request never gains
// authority from a late callback, even when another turn has already started.
var RECEIPT_LIMIT = 1024;
function create(server, isLive, onExhausted) {
  var generation = 0;
  var threadId = null;
  var turnId = null;
  var active = false;
  var exhausted = false;
  var receipts = new Map();
  // Retain only request IDs after settlement, not command input or callbacks.
  // Tombstones live for this query, up to RECEIPT_LIMIT. Exhaustion permanently
  // refuses new requests in this query; no eviction can re-authorize a replay.
  var settledReceipt = { cancel: function() {} };
  var methods = {
    "item/commandExecution/requestApproval": { decision: "decline" },
    "item/fileChange/requestApproval": { decision: "decline" },
    "mcpServer/elicitation/request": { action: "cancel" },
    "item/permissions/requestApproval": { permissions: {}, scope: "turn" },
    "item/tool/call": { contentItems: [{ type: "inputText", text: "Tool request is no longer active or was not approved" }], success: false },
  };
  function supports(message) { return Object.prototype.hasOwnProperty.call(methods, message.method); }
  function retire(send) {
    receipts.forEach(function(receipt) { receipt.cancel(send); });
    active = false;
    generation++;
  }
  function exhaust() {
    if (exhausted) return;
    exhausted = true;
    retire(true);
    if (onExhausted) onExhausted();
  }
  function open(message) {
    if (!supports(message)) return null;
    var id = message.id;
    if (id == null || (typeof id !== "string" && typeof id !== "number")) return null;
    if (receipts.has(id)) return null;
    if (exhausted || receipts.size >= RECEIPT_LIMIT) {
      exhaust();
      server.respond(id, methods[message.method]);
      return null;
    }
    var params = message.params || {};
    var epoch = generation;
    var settled = false;
    var controller = new AbortController();
    function current() {
      return !settled && !exhausted && active && generation === epoch && isLive()
        && params.threadId === threadId && (!params.turnId || params.turnId === turnId);
    }
    function answer(result, error) {
      if (settled) return;
      var allowed = current();
      settled = true;
      receipts.set(id, settledReceipt);
      controller.abort();
      if (!allowed) server.respond(id, methods[message.method]);
      else if (error) server.respondError(id, error.code, error.message);
      else server.respond(id, result);
    }
    var receipt = {
      signal: controller.signal,
      current: current,
      respond: function(requestId, result) { if (requestId === id) answer(result); },
      respondError: function(requestId, code, message) { if (requestId === id) answer(null, { code: code, message: message }); },
      cancel: function(send) {
        if (settled) return;
        settled = true;
        receipts.set(id, settledReceipt);
        controller.abort();
        if (send) server.respond(id, methods[message.method]);
      },
    };
    receipts.set(id, receipt);
    // No scoped grants: a generic tool allowance cannot authorize filesystem
    // or network permissions. An empty granted profile is a protocol denial.
    if (message.method === "item/permissions/requestApproval" || !current()) {
      receipt.cancel(true);
      return null;
    }
    // FileChangeRequestApprovalParams carries only identity, reason and an
    // optional grantRoot, not the actual patch. Never invent an empty review
    // or treat a directory grant as authority to approve unspecified edits.
    if (message.method === "item/fileChange/requestApproval") {
      receipt.cancel(true);
      return null;
    }
    if (message.method === "item/commandExecution/requestApproval"
        && (!turnId || params.turnId !== turnId || typeof params.itemId !== "string" || !params.itemId)) {
      receipt.cancel(true);
      return null;
    }
    if (message.method === "item/commandExecution/requestApproval" && (typeof params.command !== "string" || !params.command.trim())) {
      receipt.cancel(true);
      return null;
    }
    return receipt;
  }
  return {
    supports: supports,
    stale: function(message) {
      var params = message.params || {};
      return !active || !isLive() || params.threadId !== threadId || (turnId && params.turnId && params.turnId !== turnId);
    },
    open: open,
    begin: function(id) { retire(true); threadId = id; turnId = null; active = !exhausted; },
    ready: function(id) { turnId = id || null; },
    finish: function() { retire(true); },
    resolved: function(params) {
      if (!params || params.threadId !== threadId) return;
      var receipt = receipts.get(params.requestId);
      if (receipt) receipt.cancel(false);
      else if (typeof params.requestId === "string" || typeof params.requestId === "number") {
        if (receipts.size >= RECEIPT_LIMIT) exhaust();
        else if (!exhausted) receipts.set(params.requestId, settledReceipt);
      }
    },
    receiptCount: function() { return receipts.size; },
    reject: function(message) { var receipt = open(message); if (receipt) receipt.cancel(true); },
  };
}
module.exports = { create: create, RECEIPT_LIMIT: RECEIPT_LIMIT };
