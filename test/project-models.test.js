var test = require("node:test");
var assert = require("node:assert");
var { attachModels, modelEntryMatches, normalizeCatalogModels, selectCatalogModel } = require("../lib/project-models");

function fixture(options) {
  options = options || {};
  var sent = [];
  var session = options.session || { vendor: "claude" };
  var sm = {
    defaultModelByVendor: { claude: options.currentModel || "" },
    defaultVendor: "claude",
    modelsByVendor: {},
    capabilitiesByVendor: {},
    availableVendors: options.availableVendors || ["claude"],
  };
  if (!options.unsetInstalled) sm.installedVendors = options.installedVendors || ["claude"];
  var adapter = options.adapter || {
    init: function() {
      return Promise.resolve({
        models: options.models || [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }],
        defaultModel: options.adapterDefaultModel || "",
        capabilities: { midSessionModelSwitch: true },
      });
    },
    supportedModels: function() { return Promise.resolve([]); },
  };
  var attached = attachModels({
    cwd: process.cwd(),
    slug: "model-test",
    sm: sm,
    sdk: options.sdk || { setModel: function(_session, model) { return Promise.resolve({ ok: true, model: model }); } },
    adapters: options.adapters || { claude: adapter },
    sendTo: function(_ws, msg) { sent.push(msg); },
    getSessionForWs: function() { return session; },
    getLinuxUserForWs: options.getLinuxUserForWs || function() { return null; },
    serverPort: 2633,
    serverTls: false,
    serverAuthToken: null,
    resolveDefaultAi: options.resolveDefaultAi,
  });
  return { attached: attached, sent: sent, sm: sm, session: session };
}

test("model loading correlates responses and matches Fable resolved IDs", async function() {
  var f = fixture({ currentModel: "claude-fable-5" });
  await f.attached.loadVendorModels({}, { vendor: "claude", requestId: "models-1" });
  assert.strictEqual(f.sent.length, 1);
  assert.strictEqual(f.sent[0].requestId, "models-1");
  assert.strictEqual(f.sent[0].modelStatus, "ready");
  assert.strictEqual(f.sent[0].model, "fable");
  assert.strictEqual(f.sent[0].models[0].displayName, "Claude Fable");
  assert.strictEqual(modelEntryMatches(f.sent[0].models[0], "claude-fable-5"), true);
});

test("model loading returns an actionable error instead of a blank list", async function() {
  var f = fixture({
    adapter: {
      init: function() { return Promise.reject(new Error("authentication expired")); },
      supportedModels: function() { return Promise.resolve([]); },
    },
  });
  await f.attached.loadVendorModels({}, { vendor: "claude", requestId: "models-2" });
  assert.strictEqual(f.sent[0].modelStatus, "error");
  assert.deepStrictEqual(f.sent[0].models, []);
  assert.match(f.sent[0].error, /authentication expired/);
});

test("vendor catalog lookup can be reused without emitting project model_info", async function() {
  var f = fixture();
  var catalog = await f.attached.getVendorCatalog({}, "claude");
  assert.strictEqual(catalog.status, "ready");
  assert.strictEqual(catalog.models[0].value, "fable");
  assert.deepStrictEqual(catalog.models[0].supportedEffortLevels, ["low", "medium", "high", "xhigh", "max"]);
  assert.deepStrictEqual(f.sent, []);
});

test("model-specific empty effort metadata is authoritative", async function () {
  var f = fixture({ models: [{ value: "fable", supportedEffortLevels: [] }] });
  var catalog = await f.attached.getVendorCatalog({}, "claude");
  assert.deepStrictEqual(catalog.models[0].supportedEffortLevels, []);
});

test("vendor availability can be reused without emitting or mutating project picker state", function() {
  var f = fixture({ availableVendors: ["claude", "codex"], installedVendors: ["claude"] });
  var vendors = f.attached.getVendorAvailability();
  assert.deepStrictEqual(vendors.map(function(vendor) { return [vendor.id, vendor.installed]; }), [["claude", true], ["codex", false]]);
  assert.deepStrictEqual(f.sent, []);
  assert.deepStrictEqual(f.sm.availableVendors, ["claude", "codex"]);
});

test("vendor availability initializes installation detection for an un-warmed project", function() {
  var refreshed = 0;
  var f = fixture({ unsetInstalled: true, availableVendors: ["claude", "codex"], sdk: { setModel: function(_session, model) { return Promise.resolve({ ok: true, model: model }); }, refreshInstalledVendors: function () { refreshed++; f.sm.installedVendors = ["claude"]; return ["claude"]; } } });
  var vendors = f.attached.getVendorAvailability({ _clayUser: { id: "u1" } });
  assert.equal(refreshed, 1);
  assert.deepStrictEqual(vendors.map(function(vendor) { return [vendor.id, vendor.installed]; }), [["claude", true], ["codex", false]]);
  assert.equal(Object.prototype.hasOwnProperty.call(f.sm, "installedVendors"), true);
  f.attached.getVendorAvailability({ _clayUser: { id: "u1" } });
  assert.equal(refreshed, 1);
});

test("internal model resolution forwards its authenticated socket to cold availability", async function() {
  var refreshedWith = null;
  var f = fixture({ unsetInstalled: true, getLinuxUserForWs: function (socket) { return socket && socket._clayUser && socket._clayUser.linuxUser; }, sdk: { setModel: function(_session, model) { return Promise.resolve({ ok: true, model: model }); }, refreshInstalledVendors: function (linuxUser) { refreshedWith = linuxUser; f.sm.installedVendors = ["claude"]; return ["claude"]; } } });
  var ws = { _clayUser: { linuxUser: "clay-u1" } };
  var resolved = await f.attached.resolveConfiguredModel(ws, "standard");
  assert.equal(refreshedWith, "clay-u1");
  assert.equal(resolved.status, "ready");
});

test("vendor catalog exposes only a concrete validated default model", async function() {
  var saved = fixture({ currentModel: "claude-sonnet-4", models: [{ value: "fable" }, { value: "sonnet", resolvedModel: "claude-sonnet-4" }], adapterDefaultModel: "fable" });
  var savedCatalog = await saved.attached.getVendorCatalog({}, "claude");
  assert.strictEqual(savedCatalog.defaultModel, "sonnet");

  var adapter = fixture({ currentModel: "removed", models: ["fable", "sonnet"], adapterDefaultModel: "sonnet" });
  var adapterCatalog = await adapter.attached.getVendorCatalog({}, "claude");
  assert.strictEqual(adapterCatalog.defaultModel, "sonnet");

  var invalid = fixture({ currentModel: "removed", models: ["fable"], adapterDefaultModel: "also-removed" });
  var invalidCatalog = await invalid.attached.getVendorCatalog({}, "claude");
  assert.strictEqual(invalidCatalog.defaultModel, "");
});

test("Capsule model resolution returns a concrete catalog value without emitting picker state", async function() {
  var f = fixture({
    currentModel: "claude-fable-5",
    models: [{ value: "fable", resolvedModel: "claude-fable-5", displayName: "Claude Fable" }],
  });
  var resolved = await f.attached.resolveConfiguredModel({}, "standard");
  assert.deepStrictEqual(resolved, {
    status: "ready",
    vendor: "claude",
    vendorName: "Claude Code",
    model: "fable",
    modelName: "Claude Fable",
    alias: "standard",
    error: "",
  });
  assert.deepStrictEqual(f.sent, []);
});

test("Capsule model resolution reports actionable configuration failure", async function() {
  var f = fixture({
    adapter: {
      init: function() { return Promise.reject(new Error("authentication required")); },
      supportedModels: function() { return Promise.resolve([]); },
    },
  });
  var resolved = await f.attached.resolveConfiguredModel({}, "fast");
  assert.strictEqual(resolved.status, "error");
  assert.strictEqual(resolved.model, "");
  assert.match(resolved.error, /authentication required/);
});

test("Capsule aliases select different concrete values from rich catalog entries", async function() {
  var models = [
    { value: "swift", resolvedModel: "vendor-swift-v2", displayName: "Swift Mini" },
    { value: "balanced", resolvedModel: "vendor-balanced-v3", displayName: "Balanced Sonnet" },
    { value: "reasoner", resolvedModel: "vendor-reasoner-v4", displayName: "Reasoner Pro" },
  ];
  var f = fixture({ currentModel: "vendor-balanced-v3", models: models });
  var fast = await f.attached.resolveConfiguredModel({}, "fast");
  var standard = await f.attached.resolveConfiguredModel({}, "standard");
  var deep = await f.attached.resolveConfiguredModel({}, "deep");
  assert.deepStrictEqual([fast.model, standard.model, deep.model], ["swift", "balanced", "reasoner"]);
  assert.deepStrictEqual([fast.alias, standard.alias, deep.alias], ["fast", "standard", "deep"]);
  assert.ok([fast.model, standard.model, deep.model].every(function(model) { return typeof model === "string" && model !== "[object Object]"; }));
  assert.deepStrictEqual(normalizeCatalogModels(models).map(function(model) { return model.value; }), ["swift", "balanced", "reasoner"]);
  assert.strictEqual(selectCatalogModel(models, "vendor-balanced-v3", "standard").value, "balanced");
});

test("configured helpers use Default AI and keep fast and deep aliases inside its vendor", async function () {
  var models = [
    { value: "gpt-6-luna", displayName: "GPT-6 Luna", supportedEffortLevels: ["low"], defaultReasoningEffort: "low" },
    { value: "gpt-6-sol", displayName: "GPT-6 Sol", supportedEffortLevels: ["max"], defaultReasoningEffort: "max" },
    { value: "gpt-6-astra", displayName: "GPT-6 Astra", supportedEffortLevels: ["high"], defaultReasoningEffort: "high" },
  ];
  var f = fixture({
    installedVendors: ["codex", "claude"],
    availableVendors: ["codex", "claude"],
    adapters: { codex: { init: function () { return Promise.resolve({ models: models, defaultModel: "gpt-6-astra", capabilities: {} }); } } },
    resolveDefaultAi: function () { return Promise.resolve({ ready: true, vendor: "codex", model: "gpt-6-astra", effort: "high" }); },
  });
  var standard = await f.attached.resolveConfiguredModel({}, "standard");
  var fast = await f.attached.resolveConfiguredModel({}, "fast");
  var deep = await f.attached.resolveConfiguredModel({}, "deep");
  assert.deepStrictEqual([standard.vendor, standard.model, standard.effort], ["codex", "gpt-6-astra", "high"]);
  assert.deepStrictEqual([fast.vendor, fast.model, fast.effort], ["codex", "gpt-6-luna", "low"]);
  assert.deepStrictEqual([deep.vendor, deep.model, deep.effort], ["codex", "gpt-6-sol", "max"]);
});

test("configured helpers do not fall back when an explicit Default AI runtime is unavailable", async function () {
  var f = fixture({ resolveDefaultAi: function () { return Promise.resolve({ ready: false, vendor: "codex", error: "saved model was revoked" }); } });
  var result = await f.attached.resolveConfiguredModel({}, "standard");
  assert.strictEqual(result.status, "error");
  assert.strictEqual(result.model, "");
  assert.match(result.error, /revoked/);
});

test("model selection reports adapter success and failure", async function() {
  var results = [
    { ok: true, model: "fable" },
    { ok: false, model: "sonnet", error: "Fable is unavailable" },
  ];
  var f = fixture({
    sdk: { setModel: function() { return Promise.resolve(results.shift()); } },
  });
  await f.attached.selectModel({}, { model: "fable", requestId: "select-1" });
  await f.attached.selectModel({}, { model: "fable", requestId: "select-2" });
  assert.deepStrictEqual(f.sent.map(function(msg) { return [msg.requestId, msg.ok, msg.error]; }), [
    ["select-1", true, ""],
    ["select-2", false, "Fable is unavailable"],
  ]);
});

test("model selection rejects stale vendors and unknown models before adapter use", async function() {
  var calls = 0;
  var f = fixture({
    sdk: { setModel: function() { calls++; return Promise.resolve({ ok: true, model: "fable" }); } },
  });
  f.sm.modelsByVendor.claude = [{ value: "fable", resolvedModel: "claude-fable-5" }];
  await f.attached.selectModel({}, { vendor: "codex", model: "fable", requestId: "stale" });
  await f.attached.selectModel({}, { vendor: "claude", model: "unknown", requestId: "unknown" });
  assert.strictEqual(calls, 0);
  assert.match(f.sent[0].error, /vendor changed/);
  assert.match(f.sent[1].error, /not available/);
});
