// Bounded fail-closed lifecycle for worker PreToolUse policy IPC requests.

function denied(message) {
  return { behavior: "deny", message: message };
}

function createPolicyBroker(options) {
  options = options || {};
  var send = options.send;
  var timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 10000;
  var pending = {};

  function settle(requestId, result) {
    var record = pending[requestId];
    if (!record) return false;
    delete pending[requestId];
    clearTimeout(record.timer);
    if (record.signal && record.onAbort && typeof record.signal.removeEventListener === "function") {
      record.signal.removeEventListener("abort", record.onAbort);
    }
    record.resolve(result);
    return true;
  }

  function request(message, signal) {
    return new Promise(function(resolve) {
      if (signal && signal.aborted) {
        resolve(denied("Permission policy cancelled."));
        return;
      }
      var requestId = message.requestId;
      var record = { resolve: resolve, signal: signal || null, onAbort: null, timer: null };
      pending[requestId] = record;
      record.onAbort = function() {
        settle(requestId, denied("Permission policy cancelled."));
      };
      if (signal && typeof signal.addEventListener === "function") {
        signal.addEventListener("abort", record.onAbort, { once: true });
      }
      record.timer = setTimeout(function() {
        settle(requestId, denied("Permission policy timed out."));
      }, timeoutMs);
      var sent = false;
      try { sent = send(message) === true; }
      catch (error) { sent = false; }
      if (!sent) settle(requestId, denied("Permission policy IPC is unavailable."));
    });
  }

  function respond(message) {
    var result = message.error ? denied(message.error) : message.result;
    return settle(message.requestId, result || null);
  }

  function clear(message) {
    var ids = Object.keys(pending);
    for (var i = 0; i < ids.length; i++) settle(ids[i], denied(message || "Permission policy IPC closed."));
  }

  function pendingCount() {
    return Object.keys(pending).length;
  }

  return { request: request, respond: respond, clear: clear, pendingCount: pendingCount };
}

module.exports = { createPolicyBroker: createPolicyBroker };
