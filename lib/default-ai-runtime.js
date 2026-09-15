// Pure and injected resolution for a Clay-owned Default AI runtime.

var modelEntryMatches = require("./model-entry").modelEntryMatches;
var modelEntryValue = require("./model-entry").modelEntryValue;

var KNOWN_VENDORS = ["claude", "codex", "grok", "kimi", "copilot", "qwen", "junie", "antigravity", "opencode", "kiro"];
var VENDOR_FAMILY_ORDER = {
  claude: ["opus", "sonnet", "haiku"],
  codex: ["astra", "sol", "gpt", "o"],
};

function text(entry) {
  if (typeof entry === "string") return entry;
  return entry && [entry.value, entry.id, entry.resolvedModel, entry.displayName, entry.name].filter(Boolean).join(" ") || "";
}

function selectTopModel(vendor, catalog) {
  var models = catalog && Array.isArray(catalog.models) ? catalog.models : [];
  if (!models.length) return "";
  var defaultModel = catalog.defaultModel;
  if (KNOWN_VENDORS.indexOf(vendor) === -1 && defaultModel) {
    for (var di = 0; di < models.length; di++) if (modelEntryMatches(models[di], defaultModel)) return modelEntryValue(models[di]);
  }
  var familyOrder = VENDOR_FAMILY_ORDER[vendor] || [];
  if (familyOrder.length) {
    for (var fi = 0; fi < familyOrder.length; fi++) {
      for (var mi = 0; mi < models.length; mi++) if (new RegExp("(^|[^a-z])" + familyOrder[fi] + "([^a-z]|$)", "i").test(text(models[mi]))) return modelEntryValue(models[mi]);
    }
  }
  if (defaultModel) for (var ci = 0; ci < models.length; ci++) if (modelEntryMatches(models[ci], defaultModel)) return modelEntryValue(models[ci]);
  return modelEntryValue(models[0]);
}

function modelEntry(models, value) {
  for (var i = 0; i < models.length; i++) if (modelEntryMatches(models[i], value)) return models[i];
  return null;
}

function effortValue(entry) {
  if (typeof entry === "string") return entry;
  return entry && (entry.value || entry.id || entry.name || "");
}

function supportedEfforts(model, catalog) {
  if (model && Array.isArray(model.supportedEffortLevels)) return { levels: model.supportedEffortLevels.map(effortValue).filter(Boolean), specified: true };
  if (catalog && Array.isArray(catalog.effortLevels)) return { levels: catalog.effortLevels.map(effortValue).filter(Boolean), specified: true };
  return { levels: [], specified: false };
}

function resolveEffort(preference, selectedModel, catalog) {
  var support = supportedEfforts(selectedModel, catalog);
  var supported = support.levels;
  var explicit = preference && preference.effort || "";
  if (explicit && support.specified && supported.indexOf(explicit) === -1) return { ok: false, error: "The saved Default AI effort is unavailable for the selected model." };
  if (explicit) return { ok: true, effort: explicit };
  if (preference && Object.prototype.hasOwnProperty.call(preference, "effort")) return { ok: true, effort: "" };
  var modelDefault = selectedModel && (selectedModel.defaultReasoningEffort || selectedModel.defaultEffort) || "";
  if (modelDefault && (!support.specified || supported.indexOf(modelDefault) !== -1)) return { ok: true, effort: modelDefault };
  var providerDefault = catalog && catalog.defaultEffort || "";
  if (providerDefault && (!support.specified || supported.indexOf(providerDefault) !== -1)) return { ok: true, effort: providerDefault };
  return { ok: true, effort: "" };
}

function exactModel(models, requested) {
  if (!requested) return "";
  for (var i = 0; i < models.length; i++) if (modelEntryMatches(models[i], requested)) return modelEntryValue(models[i]);
  return "";
}

function identityError(options) {
  if (options.multiUser === true && !(typeof options.userId === "string" && options.userId)) return "Authenticated user identity is required.";
  return "";
}

async function resolveDefaultAiRuntime(options) {
  options = options || {};
  if (options.identity && typeof options.identity === "object") {
    options = Object.assign({}, options.identity, options);
  }
  var identityProblem = identityError(options);
  if (identityProblem) return { ready: false, error: identityProblem };
  if (typeof options.getPreference !== "function") return { ready: false, error: "Default AI preference reader is unavailable." };
  var stored = await options.getPreference(options.userId);
  if (!stored || stored.error) return { ready: false, error: stored && stored.error || "Default AI preference could not be read." };
  var preference = stored.preference || null;
  var getAvailability = options.getInstalledVendors || options.getAvailability;
  var installed = typeof getAvailability === "function" ? await getAvailability(options.userId) : options.installedVendors || [];
  installed = Array.isArray(installed) ? installed : [];
  var vendor = preference && preference.vendor || options.preferredVendor || installed[0] || "";
  if (!vendor || installed.indexOf(vendor) === -1) return { ready: false, error: "Default AI vendor is unavailable.", preference: preference, vendor: vendor };
  if (typeof options.getCatalog !== "function") return { ready: false, error: "Default AI model catalog is unavailable.", preference: preference, vendor: vendor };
  var catalog = await options.getCatalog(vendor, options.userId);
  var models = catalog && Array.isArray(catalog.models) ? catalog.models : [];
  if (!catalog || catalog.status !== "ready" || !models.length) return { ready: false, error: catalog && catalog.error || "Default AI models are unavailable.", preference: preference, vendor: vendor, catalog: catalog || null };
  var model = preference && preference.model ? exactModel(models, preference.model) : "";
  if (preference && preference.model && !model) return { ready: false, error: "The saved Default AI model is unavailable.", preference: preference, vendor: vendor, catalog: catalog };
  if (!model) model = selectTopModel(vendor, catalog);
  if (!model) return { ready: false, error: "No usable Default AI model is available.", preference: preference, vendor: vendor, catalog: catalog };
  var selectedModel = modelEntry(models, model);
  var effort = resolveEffort(preference, selectedModel, catalog);
  if (!effort.ok) return { ready: false, error: effort.error, preference: preference, vendor: vendor, model: model, catalog: catalog };
  return { ready: true, vendor: vendor, model: model, effort: effort.effort, preference: preference, source: stored.source || (preference ? "explicit" : "default"), catalog: catalog };
}

function createDefaultAiRuntimeResolver(deps) {
  deps = deps || {};
  return {
    resolve: function (options) { return resolveDefaultAiRuntime(Object.assign({}, deps, options || {})); },
    save: function (userId, preference) {
      if (deps.multiUser === true && !(typeof userId === "string" && userId)) return Promise.resolve({ ok: false, error: "Authenticated user identity is required." });
      if (typeof deps.savePreference !== "function") return Promise.resolve({ ok: false, error: "Default AI preference writer is unavailable." });
      return Promise.resolve(deps.savePreference(userId, preference));
    },
  };
}

module.exports = { resolveDefaultAiRuntime: resolveDefaultAiRuntime, createDefaultAiRuntimeResolver: createDefaultAiRuntimeResolver, selectTopModel: selectTopModel, exactModel: exactModel, resolveEffort: resolveEffort, KNOWN_VENDORS: KNOWN_VENDORS, VENDOR_FAMILY_ORDER: VENDOR_FAMILY_ORDER };
