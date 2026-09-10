function firstNumber() {
  for (var i = 0; i < arguments.length; i++) {
    var value = arguments[i];
    if (typeof value === "number" && isFinite(value) && value >= 0) return value;
  }
  return null;
}

function matchingWindow(modelUsage, model) {
  if (!modelUsage || !model || !modelUsage[model]) return null;
  return firstNumber(modelUsage[model].contextWindow);
}

function contextStatus(session) {
  var snapshot = session.lastContextUsage || null;
  var used = null;
  var window = null;
  var source = "unavailable";
  if (snapshot && typeof snapshot === "object") {
    if (session.vendor === "claude") {
      used = firstNumber(snapshot.totalTokens);
      window = firstNumber(snapshot.maxTokens);
      if (used !== null || window !== null) source = "claude_sdk_context_usage";
    } else {
      used = firstNumber(snapshot.input_tokens);
      window = firstNumber(snapshot.contextWindow);
      if (used !== null || window !== null) source = "adapter_context_usage";
    }
  }
  var history = session.history || [];
  var cumulativeInput = 0;
  var cumulativeOutput = 0;
  var results = 0;
  var observedInput = false;
  var observedOutput = false;
  var lastTask = null;
  var compactions = 0;
  var compacting = false;
  var lastCompactionAt = null;
  for (var i = 0; i < history.length; i++) {
    var item = history[i];
    if (!item) continue;
    if (item.type === "compacting") {
      if (item.active) compactions++;
      compacting = !!item.active;
      if (typeof item._ts === "number") lastCompactionAt = item._ts;
    }
    if (item.type !== "result") continue;
    var usage = item.usage || {};
    var input = firstNumber(usage.input_tokens, usage.inputTokens);
    var output = firstNumber(usage.output_tokens, usage.outputTokens);
    if (input !== null) { cumulativeInput += input; observedInput = true; }
    if (output !== null) { cumulativeOutput += output; observedOutput = true; }
    results++;
    lastTask = { inputTokens: input, outputTokens: output, currentInputTokens: null };
    var observedWindow = matchingWindow(item.modelUsage, session.model);
    if (observedWindow !== null) window = observedWindow;
  }
  if (used !== null && window !== null && used > window) {
    used = null;
    source = "unavailable";
  }
  // Older result records contain lastStreamInputTokens, but that field was
  // populated from adapter snapshots that could be cumulative or inflated by
  // cache accounting. It is not safe evidence of current context occupancy.
  var ratio = used !== null && window !== null && window > 0 ? Math.min(1, Math.round((used / window) * 1000) / 1000) : null;
  return {
    current: { source: source, usedTokens: used, windowTokens: window, usedRatio: ratio,
      scope: used === null && window === null ? "unknown" : (used !== null && window !== null ? "current_context" : "partial_current_context") },
    cumulative: { inputTokens: observedInput ? cumulativeInput : null, outputTokens: observedOutput ? cumulativeOutput : null, tasksObserved: results, scope: "loaded_session_history", complete: false },
    lastTask: lastTask,
    compactions: { observedCount: compactions, active: compacting, lastObservedAt: lastCompactionAt, scope: "loaded_session_history", complete: false },
  };
}

module.exports = { contextStatus: contextStatus, firstNumber: firstNumber };
