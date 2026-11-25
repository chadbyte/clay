// ACP usage_update.used measures context occupancy, not billable turn input.
// OpenCode 1.19.6 builds response usage from its assistant message. ACP
// draft counters have different aggregation semantics; do not assume parity.
function fromPrompt(result, vendor) {
  if (vendor !== "opencode") return null;
  var usage = result && result.usage;
  if (!usage || !Number.isSafeInteger(usage.inputTokens) || usage.inputTokens < 0 ||
      !Number.isSafeInteger(usage.outputTokens) || usage.outputTokens < 0) return null;
  var fields = { input_tokens: "inputTokens", output_tokens: "outputTokens",
    cache_read_input_tokens: "cachedReadTokens", cache_creation_input_tokens: "cachedWriteTokens" };
  var output = {};
  var keys = Object.keys(fields);
  for (var i = 0; i < keys.length; i++) {
    var value = usage[fields[keys[i]]];
    if (value !== undefined && (!Number.isSafeInteger(value) || value < 0)) return null;
    output[keys[i]] = value === undefined ? 0 : value;
  }
  return output;
}
module.exports = { fromPrompt: fromPrompt };
