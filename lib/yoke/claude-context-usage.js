var crypto = require("crypto");

function options(value) {
  return { detail: value && value.detail === "full" ? "full" : "summary" };
}

function createRequests(worker) {
  var pending = new Map();
  return {
    request: function(value) {
      return new Promise(function(resolve, reject) {
        var id = crypto.randomUUID();
        var timer = setTimeout(function() {
          pending.delete(id);
          reject(new Error("Context usage request timed out"));
        }, 30000);
        pending.set(id, { resolve: resolve, reject: reject, timer: timer });
        var accepted = false;
        try { accepted = worker.send({ type: "get_context_usage", requestId: id, options: options(value) }); }
        catch (error) {
          clearTimeout(timer);
          pending.delete(id);
          reject(error);
          return;
        }
        if (!accepted) {
          clearTimeout(timer);
          pending.delete(id);
          resolve(null);
        }
      });
    },
    receive: function(message) {
      var entry = pending.get(message.requestId);
      if (!entry) return;
      pending.delete(message.requestId);
      clearTimeout(entry.timer);
      if (message.error) entry.reject(new Error(message.error));
      else entry.resolve(message.data || null);
    },
    close: function() {
      pending.forEach(function(entry) { clearTimeout(entry.timer); entry.resolve(null); });
      pending.clear();
    },
  };
}

async function respond(query, message, send) {
  try {
    var data = query && typeof query.getContextUsage === "function" ? await query.getContextUsage(options(message.options)) : null;
    send({ type: "context_usage_response", requestId: message.requestId, data: data });
  } catch (error) {
    send({ type: "context_usage_response", requestId: message.requestId, error: error.message });
  }
}

module.exports = { options: options, createRequests: createRequests, respond: respond };
