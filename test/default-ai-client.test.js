var test = require("node:test");
var assert = require("node:assert/strict");
var fs = require("node:fs");
var vm = require("node:vm");

function load() {
  var source = fs.readFileSync(require("node:path").join(__dirname, "../lib/public/modules/default-ai.js"), "utf8");
  source = source.replace(/^import .*;\n/gm, "").replace(/export function /g, "function ");
  source += "\nthis.api={beginDefaultAiConnection:beginDefaultAiConnection,handleDefaultAiMessage:handleDefaultAiMessage,requestDefaultAi:requestDefaultAi};";
  var state = { defaultAiState: { catalogs: {}, installedVendors: [] }, defaultAiDraft: { vendor: "", model: "", effort: "" }, defaultAiDraftDirty: false };
  var listeners = [];
  var context = { store: { get: function (key) { return state[key]; }, set: function (value) { var previous = state; state = Object.assign({}, state, value); listeners.forEach(function (listener) { listener(state, previous); }); }, subscribe: function (listener) { listeners.push(listener); } }, getWs: function () { return null; }, VENDOR_AVATARS: { claude: "/claude-code-avatar.png", codex: "/codex-avatar.png" }, VENDOR_NAMES: {}, refreshIcons: function () {}, document: { querySelector: function () { return null; } }, window: {}, console: console, Date: Date, Math: Math, setTimeout: setTimeout, clearTimeout: clearTimeout };
  vm.runInNewContext(source, context);
  return { api: context.api, getState: function () { return state; }, setState: function (value) { state = Object.assign({}, state, value); }, storeSet: context.store.set };
}

test("client handler caches first-load catalog and seeds effective draft", function () {
  var h = load();
  h.getState().defaultAiState.refreshRequestId = "r";
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: "r", installedVendors: ["codex"], preference: null, selection: { vendor: "codex", model: "gpt-6-astra", effort: "medium" }, catalog: { status: "ready", models: [{ value: "gpt-6-astra" }] }, ready: true });
  assert.equal(h.getState().defaultAiDraft.model, "gpt-6-astra");
  assert.equal(h.getState().defaultAiState.catalogs.codex.models[0].value, "gpt-6-astra");
});

test("client ignores stale catalogs and preserves dirty draft on canonical broadcasts/errors", function () {
  var h = load();
  h.getState().defaultAiState.refreshRequestId = "r";
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: "r", installedVendors: ["codex"], preference: { vendor: "codex", model: "old", effort: "" }, selection: { vendor: "codex", model: "old", effort: "" }, ready: true });
  h.getState().defaultAiDraftDirty = true;
  h.getState().defaultAiDraft.model = "draft";
  h.api.handleDefaultAiMessage({ type: "default_ai_catalog", requestId: "wrong", vendor: "codex", catalog: { models: [{ value: "bad" }] } });
  assert.equal(h.getState().defaultAiState.catalogs.codex, undefined);
  h.api.handleDefaultAiMessage({ type: "default_ai_state", preference: { vendor: "codex", model: "new", effort: "" }, selection: { vendor: "codex", model: "new", effort: "" }, ready: true });
  assert.equal(h.getState().defaultAiDraft.model, "draft");
  h.getState().defaultAiState.saveRequestId = "save";
  h.getState().defaultAiState.saving = true;
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: "save", ready: false, error: "save failed" });
  assert.equal(h.getState().defaultAiState.error, "save failed");
  assert.equal(h.getState().defaultAiState.selection.model, "new");
  assert.equal(h.getState().defaultAiDraft.model, "draft");
});

test("client applies catalog recommendation to an empty vendor draft and preserves cleared effort", function () {
  var h = load();
  h.setState({
    defaultAiState: { catalogs: {}, catalogRequestIds: { codex: "catalog" }, installedVendors: ["codex"], preference: { vendor: "codex", model: "old", effort: "high" }, selection: { vendor: "codex", model: "old", effort: "high" } },
    defaultAiDraft: { vendor: "codex", model: "", effort: "" },
    defaultAiDraftDirty: true,
  });
  h.api.handleDefaultAiMessage({ type: "default_ai_catalog", requestId: "catalog", vendor: "codex", installedVendors: ["codex"], selection: { vendor: "codex", model: "gpt-6-astra", effort: "" }, catalog: { status: "ready", models: [{ value: "gpt-6-astra", supportedEffortLevels: ["medium", "high"] }] }, ready: true });
  assert.deepEqual(JSON.parse(JSON.stringify(h.getState().defaultAiDraft)), { vendor: "codex", model: "gpt-6-astra", effort: "" });
  assert.equal(h.getState().defaultAiDraftDirty, true);
});

test("broadcasts preserve unsaved draft and outstanding request correlation", function () {
  var h = load();
  h.setState({
    defaultAiState: { catalogs: {}, installedVendors: ["codex"], saveRequestId: "save", saving: true, refreshRequestId: "refresh", loading: true },
    defaultAiDraft: { vendor: "codex", model: "draft", effort: "" },
    defaultAiDraftDirty: true,
  });
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: null, ready: true, preference: { vendor: "codex", model: "canonical", effort: "medium" }, selection: { vendor: "codex", model: "canonical", effort: "medium" } });
  assert.equal(h.getState().defaultAiDraft.model, "draft");
  assert.equal(h.getState().defaultAiState.saveRequestId, "save");
  assert.equal(h.getState().defaultAiState.refreshRequestId, "refresh");
});

test("account loss disables the picker without replacing its last canonical badge", function () {
  var h = load();
  h.setState({
    defaultAiState: { catalogs: {}, installedVendors: ["codex"], refreshRequestId: "account", loading: true, selection: { vendor: "codex", model: "gpt-6-astra", effort: "" } },
    defaultAiDraft: { vendor: "codex", model: "gpt-6-astra", effort: "" },
    defaultAiDraftDirty: false,
  });
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: "account", ready: false, accountAvailable: false, error: "Your account is no longer available." });
  assert.equal(h.getState().defaultAiState.accountAvailable, false);
  assert.equal(h.getState().defaultAiState.selection.model, "gpt-6-astra");
  assert.equal(h.getState().defaultAiState.refreshRequestId, null);
});

test("an unavailable saved choice remains visible as the canonical draft", function () {
  var h = load();
  h.getState().defaultAiState.refreshRequestId = "unavailable";
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: "unavailable", ready: false, installedVendors: ["codex", "claude"], preference: { vendor: "kiro", model: "saved-unavailable", effort: "high" }, error: "Default AI vendor is unavailable." });
  assert.deepEqual(JSON.parse(JSON.stringify(h.getState().defaultAiDraft)), { vendor: "kiro", model: "saved-unavailable", effort: "high" });
  assert.equal(h.getState().defaultAiState.preference.model, "saved-unavailable");
});

test("an unavailable saved model retains its failed catalog for explicit rendering", function () {
  var h = load();
  h.getState().defaultAiState.refreshRequestId = "catalog-error";
  h.api.handleDefaultAiMessage({ type: "default_ai_state", requestId: "catalog-error", ready: false, installedVendors: ["codex"], preference: { vendor: "codex", model: "retired-model", effort: "high" }, catalog: { status: "ready", models: [{ value: "gpt-6-astra" }] }, error: "The saved Default AI model is unavailable." });
  assert.equal(h.getState().defaultAiState.catalogs.codex.models[0].value, "gpt-6-astra");
  assert.match(h.getState().defaultAiState.catalogs.codex.error, /saved Default AI model/);
  assert.equal(h.getState().defaultAiState.preference.model, "retired-model");
});

test("account changes clear canonical and draft state and reject old-account replies", function () {
  var h = load();
  h.setState({
    isMultiUserMode: true,
    myUserId: "u1",
    connected: false,
    defaultAiState: { accountId: "u1", canonicalRevision: 4, catalogs: { codex: {} }, catalogRequestIds: { codex: "catalog-old" }, refreshRequestId: "refresh-old", saveRequestId: "save-old", installedVendors: ["codex"], selection: { vendor: "codex", model: "gpt-6-astra", effort: "" } },
    defaultAiDraft: { vendor: "codex", model: "draft", effort: "" },
    defaultAiDraftDirty: true,
  });
  h.storeSet({ myUserId: "u2" });
  assert.deepEqual(JSON.parse(JSON.stringify(h.getState().defaultAiDraft)), { vendor: "", model: "", effort: "" });
  assert.equal(h.getState().defaultAiState.selection, null);
  assert.deepEqual(JSON.parse(JSON.stringify(h.getState().defaultAiState.catalogRequestIds)), {});
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "u1", canonicalRevision: 5, ready: true, preference: { vendor: "claude", model: "opus", effort: "" }, selection: { vendor: "claude", model: "opus", effort: "" } });
  assert.equal(h.getState().defaultAiState.selection, null);
});

test("an older canonical reply cannot replace a newer saved selection", function () {
  var h = load();
  h.setState({
    defaultAiState: { accountId: "default", canonicalRevision: 2, catalogs: {}, installedVendors: ["codex", "claude"], refreshRequestId: "slow-get", selection: { vendor: "codex", model: "gpt-6-astra", effort: "high" } },
    defaultAiDraft: { vendor: "codex", model: "gpt-6-astra", effort: "high" },
    defaultAiDraftDirty: false,
  });
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "default", canonicalRevision: 1, requestId: "slow-get", ready: true, preference: { vendor: "claude", model: "opus", effort: "" }, selection: { vendor: "claude", model: "opus", effort: "" } });
  assert.equal(h.getState().defaultAiState.selection.vendor, "codex");
  assert.equal(h.getState().defaultAiDraft.vendor, "codex");
});

test("a same-user reconnect accepts a new server epoch at revision zero and rejects stale epochs", function () {
  var h = load();
  h.setState({
    isMultiUserMode: true,
    myUserId: "u1",
    defaultAiState: { accountId: "u1", serverEpoch: "old-server", canonicalRevision: 5, catalogs: {}, catalogRequestIds: { codex: "old-catalog" }, refreshRequestId: "old-refresh", selection: { vendor: "codex", model: "old", effort: "" } },
    defaultAiDraft: { vendor: "codex", model: "unsaved", effort: "high" },
    defaultAiDraftDirty: true,
  });
  h.api.beginDefaultAiConnection();
  assert.equal(h.getState().defaultAiState.serverEpoch, null);
  assert.equal(h.getState().defaultAiState.canonicalRevision, 0);
  assert.equal(h.getState().defaultAiState.refreshRequestId, null);
  assert.equal(h.getState().defaultAiDraft.model, "unsaved");
  h.getState().defaultAiState.refreshRequestId = "new-refresh";
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "u1", serverEpoch: "old-server", canonicalRevision: 5, requestId: "old-refresh", ready: true, preference: { vendor: "codex", model: "stale", effort: "" }, selection: { vendor: "codex", model: "stale", effort: "" } });
  assert.equal(h.getState().defaultAiState.selection, null);
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "u1", serverEpoch: "new-server", canonicalRevision: 0, requestId: "new-refresh", ready: true, preference: { vendor: "claude", model: "fresh", effort: "" }, selection: { vendor: "claude", model: "fresh", effort: "" } });
  assert.equal(h.getState().defaultAiState.serverEpoch, "new-server");
  assert.equal(h.getState().defaultAiState.canonicalRevision, 0);
  assert.equal(h.getState().defaultAiState.selection.model, "fresh");
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "u1", serverEpoch: "new-server", canonicalRevision: 2, ready: true, preference: { vendor: "claude", model: "newest", effort: "" }, selection: { vendor: "claude", model: "newest", effort: "" } });
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "u1", serverEpoch: "new-server", canonicalRevision: 1, ready: true, preference: { vendor: "codex", model: "same-epoch-stale", effort: "" }, selection: { vendor: "codex", model: "same-epoch-stale", effort: "" } });
  h.api.handleDefaultAiMessage({ type: "default_ai_state", accountId: "u1", serverEpoch: "old-server", canonicalRevision: 6, ready: true, preference: { vendor: "codex", model: "old-epoch", effort: "" }, selection: { vendor: "codex", model: "old-epoch", effort: "" } });
  assert.equal(h.getState().defaultAiState.selection.model, "newest");
  assert.equal(h.getState().defaultAiState.canonicalRevision, 2);
});

test("the WebSocket open path resets Default AI correlation before refreshing", function () {
  var source = fs.readFileSync(require("node:path").join(__dirname, "../lib/public/modules/app-connection.js"), "utf8");
  assert.match(source, /beginDefaultAiConnection\(\);\s*requestDefaultAi\(\);/);
});

test("the document click guard recognizes detached opener and popover controls through their composed paths", function () {
  var source = fs.readFileSync(require("node:path").join(__dirname, "../lib/public/modules/default-ai.js"), "utf8");
  assert.match(source, /event\.composedPath\(\)/);
  assert.match(source, /path\.indexOf\(button\) !== -1/);
  assert.match(source, /path\.indexOf\(popover\) !== -1/);
  assert.doesNotMatch(source, /avatar\.innerHTML = source/);
});

test("picker source exposes a visible reasoning label and no runtime eyebrow", function () {
  var source = fs.readFileSync(require("node:path").join(__dirname, "../lib/public/modules/default-ai.js"), "utf8");
  assert.match(source, /addFieldLabel\("Reasoning effort", effort\)/);
  assert.doesNotMatch(source, /Clay runtime/);
});
