// Approval receipts live for one query (at most 1024 IDs). Never evict and
// re-admit an old request: exhaustion retires the query instead.
function create(acp, options) {
  var receipts = new Map();
  var pending = new Set();
  var generation = 0;
  var active = false;
  var closed = false;
  var controller = new AbortController();
  controller.abort();
  var process = acp.proc;
  var processGeneration = acp._processGeneration;
  var turnSession = null;
  var bindingInvalidated = false;
  function sameProcess() {
    return acp.started !== false && acp.proc === process && acp._processGeneration === processGeneration;
  }
  function current(turn, session) {
    return !closed && active && turn === generation && session === turnSession &&
      session === options.sessionId() && options.isBound(session) && sameProcess();
  }
  function end() {
    active = false;
    controller.abort();
    pending.forEach(function(cancel) { cancel(); });
    pending.clear();
  }
  var removeDisconnect = typeof acp.addDisconnectHandler === "function"
    ? acp.addDisconnectHandler(function(error) { end(); options.onDisconnect(error); }) : function() {};
  return {
    bind: function(entry) {
      var session = entry.sessionId;
      Object.defineProperty(entry, "sessionId", { enumerable: true, configurable: true,
        get: function() { return session; },
        set: function(value) {
          if (session != null && value !== session) { bindingInvalidated = true; end(); }
          session = value;
        },
      });
      entry.onRemoved = function() { bindingInvalidated = true; end(); };
    },
    captureSession: function() {
      var session = options.sessionId();
      function valid() { return !closed && !bindingInvalidated && !!session &&
        session === options.sessionId() && options.isBound(session) && sameProcess(); }
      return valid() ? { isCurrent: valid } : null;
    },
    begin: function() { end(); generation++; turnSession = options.sessionId(); controller = new AbortController(); active = !closed; },
    end: end,
    signal: function() { return controller.signal; },
    isActive: function(session) { return current(generation, session); },
    close: function() { end(); closed = true; removeDisconnect(); },
    handle: function(msg, review, buildResponse) {
      var id = msg.id;
      if ((typeof id !== "string" && typeof id !== "number") || (typeof id === "number" && !Number.isFinite(id))) return;
      var key = typeof id + ":" + id;
      if (receipts.has(key)) return;
      function reply(result) { if (sameProcess()) acp.respond(id, result, msg._acpRequest); }
      var cancelled = { outcome: { outcome: "cancelled" } };
      if (receipts.size >= 1024) { reply(cancelled); end(); options.onExhausted(); return; }
      receipts.set(key, true);
      var params = msg.params || {};
      var session = params.sessionId;
      var turn = generation;
      var answered = false;
      function finish(result) {
        if (answered) return;
        answered = true;
        pending.delete(cancel);
        reply(result);
      }
      function cancel() { finish(cancelled); }
      pending.add(cancel);
      var choices = params.options;
      var call = params.toolCall;
      if (!current(turn, session) || !call || typeof call !== "object" || Array.isArray(call) ||
          typeof call.toolCallId !== "string" || !call.toolCallId || !Array.isArray(choices) || !choices.length || choices.length > 128) return cancel();
      var ids = new Set();
      var allow = null;
      var deny = null;
      for (var i = 0; i < choices.length; i++) {
        var choice = choices[i];
        if (!choice || typeof choice !== "object" || typeof choice.optionId !== "string" || !choice.optionId ||
            ids.has(choice.optionId) || ["allow_once", "allow_always", "reject_once", "reject_always"].indexOf(choice.kind) < 0) return cancel();
        ids.add(choice.optionId);
        if (choice.kind === "allow_once" && allow === null) allow = choice.optionId;
        if (choice.kind === "reject_once" && deny === null) deny = choice.optionId;
      }
      if (!allow) return cancel();
      var signal = controller.signal;
      Promise.resolve().then(function() {
        if (!current(turn, session)) return false;
        return review(signal);
      }).then(function(decision) {
        if (!current(turn, session)) return cancel();
        var allowed = decision === true || (decision && decision.behavior === "allow");
        var optionId = allowed ? allow : deny;
        var result = optionId ? { outcome: { outcome: "selected", optionId: optionId } } : cancelled;
        if (optionId && buildResponse) result = buildResponse(result, allowed, optionId, decision);
        if (!current(turn, session)) return cancel();
        if (!result || !result.outcome || result.outcome.outcome !== "selected" || result.outcome.optionId !== optionId) return cancel();
        finish(result);
      }).catch(cancel);
    },
  };
}
module.exports = { create: create };
