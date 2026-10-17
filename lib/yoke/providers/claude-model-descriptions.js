// Preserve existing model descriptions and beta availability at the provider boundary.
// SDK rows normally carry their own description; these apply only when absent.
// Family wording from https://platform.claude.com/docs/en/about-claude/models/overview (verified 2026-10-17).
var DESCRIPTIONS = {
  default: "Automatically selects the best model for the task.",
  fable: "For demanding reasoning and long-horizon agentic work.",
  sonnet: "The best combination of speed and intelligence.",
  haiku: "For high-volume, latency-sensitive tasks such as classification, extraction, and routing.",
  opus: "For long-running agentic coding and knowledge work.",
};
// Claude Sonnet 5 and Sonnet 5.5 have a 1M-token window by default and need no
// context-1m beta (verified 2026-10-17). Only these documented IDs are matched;
// unlisted future versions keep the existing toggle. Sonnet 4.6 keeps it too:
// Claude Code still treats its 1M window as an opt-in variant.
// https://platform.claude.com/docs/en/build-with-claude/context-windows
// https://code.claude.com/docs/en/model-config
var DEFAULT_ONE_MILLION_SONNET = /sonnet-5(?:-5)?(?:$|[^0-9-])/;

function describe(entry) {
  var model = typeof entry === "string" ? { value: entry, displayName: entry } : Object.assign({}, entry);
  var name = String(model.value || "").toLowerCase();
  if (model.supportsBetaContext === undefined) {
    // Prefer the runtime's resolved wire ID so an alias row is judged by its real model.
    var target = String(model.resolvedModel || model.value || "").toLowerCase();
    model.supportsBetaContext = target.indexOf("sonnet") !== -1 && !DEFAULT_ONE_MILLION_SONNET.test(target);
  }
  if (!model.description) {
    var family = Object.keys(DESCRIPTIONS).find(function(key) { return name.indexOf(key) !== -1; });
    if (family) model.description = DESCRIPTIONS[family];
  }
  return model;
}
function list(models) { return (models || []).map(describe); }
module.exports = { describe: describe, list: list };
