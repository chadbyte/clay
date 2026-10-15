// Preserve existing model descriptions and beta availability at the provider boundary.
var DESCRIPTIONS = { default: "Automatically selects the best model for the task.", sonnet: "Fast and capable. Great balance of speed and intelligence.", haiku: "Fastest model. Best for quick tasks and simple questions.", opus: "Most powerful model. Best for complex reasoning and analysis." };
function describe(entry) {
  var model = typeof entry === "string" ? { value: entry, displayName: entry } : Object.assign({}, entry);
  var name = String(model.value || "").toLowerCase();
  if (model.supportsBetaContext === undefined) model.supportsBetaContext = name.indexOf("sonnet") !== -1;
  if (!model.description) {
    var family = Object.keys(DESCRIPTIONS).find(function(key) { return name.indexOf(key) !== -1; });
    if (family) model.description = DESCRIPTIONS[family];
  }
  return model;
}
function list(models) { return (models || []).map(describe); }
module.exports = { describe: describe, list: list };
