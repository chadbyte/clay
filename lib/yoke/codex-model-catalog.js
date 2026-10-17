// Runtime catalogs are scoped to the adapter's OS user and provider configuration.
// The runtime model/list is authoritative. This offline fallback mirrors the
// picker-visible presets bundled with @openai/codex 0.162.1, in their priority
// order, minus models the official Codex models page lists as retired for
// ChatGPT sign-in or deprecated (gpt-5.5, gpt-5.2). Verified 2026-10-17:
// https://learn.chatgpt.com/docs/models
var FALLBACK = ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"];
// Codex marks its highest-priority picker-visible preset as default; for the
// bundled 0.162.1 presets that is gpt-6.1-sol. Used only without a runtime flag.
var DEFAULT_MODEL = "gpt-6.1-sol";
// Fast, low-cost models for title generation, newest first (gpt-5.6-luna's
// bundled upgrade target is gpt-6-luna).
var TITLE_MODELS = ["gpt-6-luna", "gpt-5.6-luna"];

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
        if (typeof entry.defaultReasoningEffort === "string" && entry.defaultReasoningEffort) model.defaultReasoningEffort = entry.defaultReasoningEffort;
        if (entry.isDefault === true) model.isDefault = true;
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

// The runtime's own default wins. Without a flag, never name a model the
// catalog does not offer: use the static default only when it is listed,
// otherwise the first valid row. An empty catalog keeps the static default.
function defaultModel(models) {
  var values = [];
  var flagged = null;
  (models || []).forEach(function (entry) {
    var value = typeof entry === "string" ? entry : entry && typeof entry === "object" ? entry.value : null;
    if (typeof value !== "string" || !value.trim()) return;
    values.push(value);
    if (!flagged && typeof entry === "object" && entry.isDefault === true) flagged = value;
  });
  if (flagged) return flagged;
  if (values.indexOf(DEFAULT_MODEL) !== -1 || values.length === 0) return DEFAULT_MODEL;
  return values[0];
}

function selectTitleModel(models, sessionModel) {
  var entries = models.map(function (entry) {
    return typeof entry === "string" ? { value: entry } : entry;
  }).filter(function (entry) { return entry && typeof entry.value === "string" && entry.value.trim(); });
  var selected = null;
  for (var ti = 0; ti < TITLE_MODELS.length && !selected; ti++) {
    selected = entries.find(function (entry) { return entry.value === TITLE_MODELS[ti]; }) || null;
  }
  selected = selected
    || entries.find(function (entry) { return entry.value === sessionModel; }) || entries[0];
  if (!selected) throw new Error("No supported Codex title model is available");
  var efforts = selected.supportedEffortLevels;
  var effort = Array.isArray(efforts) ? (efforts.indexOf("low") !== -1 ? "low" : efforts[0]) : "low";
  return { model: selected.value, effort: effort };
}

module.exports = { DEFAULT_MODEL: DEFAULT_MODEL, fallback: fallback, load: load, defaultModel: defaultModel, selectTitleModel: selectTitleModel };
