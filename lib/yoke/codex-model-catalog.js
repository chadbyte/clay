// Runtime catalogs are scoped to the adapter's OS user and provider configuration.
var FALLBACK = ["gpt-6-astra", "gpt-6.1-sol", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.5", "gpt-5.2"];

function fallback() {
  return FALLBACK.slice();
}

async function load(server) {
  var models = [];
  var seen = new Set();
  var cursors = new Set();
  var cursor = null;
  var deadline = Date.now() + 3000;
  try {
    for (var page = 0; page < 4; page++) {
      var remaining = deadline - Date.now();
      if (remaining <= 0) return fallback();
      var result = await server.send("model/list", { limit: 100, includeHidden: false, cursor: cursor }, remaining);
      if (!result || !Array.isArray(result.data)) return fallback();
      result.data.forEach(function (entry) {
        if (!entry || entry.hidden || typeof entry.model !== "string" || !entry.model || seen.has(entry.model)) return;
        seen.add(entry.model);
        var model = { value: entry.model, displayName: entry.displayName || entry.model, description: entry.description || "" };
        if (Array.isArray(entry.supportedReasoningEfforts)) {
          model.supportedEffortLevels = entry.supportedReasoningEfforts.map(function (option) { return option.reasoningEffort; }).filter(function (effort) { return typeof effort === "string" && effort.length > 0; });
        }
        models.push(model);
      });
      cursor = result.nextCursor;
      if (!cursor) return models.length ? models : fallback();
      if (cursors.has(cursor)) return fallback();
      cursors.add(cursor);
    }
  } catch (error) {
    // Catalog failure must not prevent existing conversations from starting.
  }
  return fallback();
}

module.exports = { fallback: fallback, load: load };
