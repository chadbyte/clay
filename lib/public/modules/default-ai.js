// User-island Default AI picker. Canonical state and the unsaved draft are separate.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { refreshIcons } from './icons.js';

var sequence = 0;
var opener = null;
var popover = null;

function nextRequestId() {
  sequence += 1;
  return "default-ai-" + Date.now() + "-" + sequence;
}

function send(payload) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return false;
  ws.send(JSON.stringify(payload));
  return true;
}

function entryValue(entry) {
  return typeof entry === "string" ? entry : entry && (entry.value || entry.id) || "";
}

function entryLabel(entry) {
  return typeof entry === "string" ? entry : entry && (entry.displayName || entry.name || entryValue(entry)) || "";
}

function addOption(select, value, text, disabled) {
  var option = document.createElement("option");
  option.value = value;
  option.textContent = text;
  option.disabled = disabled === true;
  select.appendChild(option);
}

function close() {
  if (!popover) return;
  popover.classList.add("hidden");
  if (opener) {
    opener.setAttribute("aria-expanded", "false");
    opener.focus({ preventScroll: true });
  }
  opener = null;
}

function position() {
  if (!popover || !opener) return;
  var rect = opener.getBoundingClientRect();
  var width = Math.min(390, Math.max(0, window.innerWidth - 24));
  popover.style.width = width + "px";
  popover.style.left = Math.max(12, Math.min(window.innerWidth - width - 12, rect.right - width)) + "px";
  var desiredTop = rect.top - popover.offsetHeight - 10;
  var maximumTop = Math.max(12, window.innerHeight - popover.offsetHeight - 12);
  popover.style.top = Math.max(12, Math.min(maximumTop, desiredTop)) + "px";
}

function requestCatalog(vendor) {
  if (!vendor) return;
  var state = store.get("defaultAiState") || {};
  var id = nextRequestId();
  var catalogs = Object.assign({}, state.catalogs || {});
  var requests = Object.assign({}, state.catalogRequestIds || {});
  catalogs[vendor] = Object.assign({}, catalogs[vendor] || {}, { loading: true });
  requests[vendor] = id;
  store.set({ defaultAiState: Object.assign({}, state, { catalogs: catalogs, catalogRequestIds: requests, error: "" }) });
  if (!send({ type: "default_ai_catalog_get", requestId: id, vendor: vendor })) {
    store.set({ defaultAiState: Object.assign({}, store.get("defaultAiState") || {}, { error: "Clay is offline. Reconnect and try again." }) });
  }
}

function currentEfforts(models, modelValue, catalog) {
  for (var i = 0; i < models.length; i++) {
    if (entryValue(models[i]) !== modelValue) continue;
    if (models[i] && Array.isArray(models[i].supportedEffortLevels)) return models[i].supportedEffortLevels;
  }
  return catalog && Array.isArray(catalog.effortLevels) ? catalog.effortLevels : [];
}

function addStatus(text, error) {
  var status = document.createElement("div");
  status.className = "default-ai-status" + (error ? " default-ai-error" : "");
  if (error) status.setAttribute("role", "alert");
  status.textContent = text;
  popover.appendChild(status);
}

function expectedAccountId() {
  if (store.get("isMultiUserMode")) return store.get("myUserId") || "";
  return "default";
}

function addFieldLabel(text, control) {
  var label = document.createElement("label");
  label.className = "default-ai-label";
  label.textContent = text;
  label.appendChild(control);
  popover.appendChild(label);
}

function render() {
  if (!popover) return;
  var state = store.get("defaultAiState") || {};
  var draft = store.get("defaultAiDraft") || {};
  var vendors = state.installedVendors || [];
  var catalog = (state.catalogs || {})[draft.vendor] || null;
  var models = catalog && catalog.models || [];

  popover.innerHTML = '<div class="default-ai-title">Default AI</div><div class="default-ai-copy">Used for new Clay interviews and built-in AI assistance.</div>';
  if (state.loading && !vendors.length) {
    addStatus("Loading available AI providers…", false);
    position();
    return;
  }
  if (state.accountAvailable === false) {
    addStatus(state.error || "Your account is no longer available.", true);
    position();
    return;
  }

  var vendor = document.createElement("select");
  vendor.className = "default-ai-select";
  vendor.setAttribute("aria-label", "Default AI vendor");
  for (var vi = 0; vi < vendors.length; vi++) addOption(vendor, vendors[vi], VENDOR_NAMES[vendors[vi]] || vendors[vi], false);
  if (draft.vendor && vendors.indexOf(draft.vendor) === -1) addOption(vendor, draft.vendor, "Unavailable: " + (VENDOR_NAMES[draft.vendor] || draft.vendor), true);
  vendor.value = draft.vendor || vendors[0] || "";
  vendor.disabled = !vendors.length || state.saving === true;

  var model = document.createElement("select");
  model.className = "default-ai-select";
  model.setAttribute("aria-label", "Default AI model");
  for (var mi = 0; mi < models.length; mi++) addOption(model, entryValue(models[mi]), entryLabel(models[mi]), false);
  if (draft.model && !models.some(function (entry) { return entryValue(entry) === draft.model; })) addOption(model, draft.model, "Unavailable: " + draft.model, true);
  if (!models.length) addOption(model, "", catalog && catalog.loading ? "Loading models…" : "Models unavailable", true);
  model.value = draft.model || "";
  model.disabled = !models.length || state.saving === true;

  var effort = document.createElement("select");
  effort.className = "default-ai-select";
  effort.setAttribute("aria-label", "Default AI reasoning effort");
  addOption(effort, "", "Provider default", false);
  var efforts = currentEfforts(models, model.value, catalog);
  for (var ei = 0; ei < efforts.length; ei++) addOption(effort, entryValue(efforts[ei]), entryLabel(efforts[ei]), false);
  if (draft.effort && !efforts.some(function (entry) { return entryValue(entry) === draft.effort; })) addOption(effort, draft.effort, "Unavailable: " + draft.effort, true);
  effort.value = draft.effort || "";
  effort.disabled = !models.length || state.saving === true;

  vendor.addEventListener("change", function () {
    store.set({ defaultAiDraft: { vendor: vendor.value, model: "", effort: "" }, defaultAiDraftDirty: true });
    requestCatalog(vendor.value);
    render();
  });
  model.addEventListener("change", function () {
    store.set({ defaultAiDraft: { vendor: vendor.value, model: model.value, effort: "" }, defaultAiDraftDirty: true });
    render();
  });
  effort.addEventListener("change", function () {
    store.set({ defaultAiDraft: { vendor: vendor.value, model: model.value, effort: effort.value }, defaultAiDraftDirty: true });
    render();
  });
  addFieldLabel("Provider", vendor);
  addFieldLabel("Model", model);
  addFieldLabel("Reasoning effort", effort);

  var selectedModel = models.some(function (entry) { return entryValue(entry) === model.value; });
  var selectedEffort = !effort.value || efforts.some(function (entry) { return entryValue(entry) === effort.value; });
  var save = document.createElement("button");
  save.type = "button";
  save.className = "default-ai-save";
  save.textContent = state.saving ? "Saving…" : "Save default";
  save.disabled = state.saving === true || vendors.indexOf(vendor.value) === -1 || !selectedModel || !selectedEffort;
  save.addEventListener("click", function () {
    var id = nextRequestId();
    var latest = store.get("defaultAiState") || {};
    store.set({ defaultAiState: Object.assign({}, latest, { saving: true, saveRequestId: id, error: "" }) });
    if (!send({ type: "default_ai_set", requestId: id, vendor: vendor.value, model: model.value, effort: effort.value })) {
      store.set({ defaultAiState: Object.assign({}, store.get("defaultAiState") || {}, { saving: false, saveRequestId: null, error: "Clay is offline. Reconnect and try again." }) });
    }
    render();
  });
  popover.appendChild(save);
  if (state.error) addStatus(state.error, true);
  position();
  refreshIcons();
}

export function requestDefaultAi() {
  var state = store.get("defaultAiState") || {};
  var id = nextRequestId();
  store.set({ defaultAiState: Object.assign({}, state, { loading: true, refreshRequestId: id, accountId: expectedAccountId(), error: "" }) });
  if (!send({ type: "default_ai_get", requestId: id })) {
    store.set({ defaultAiState: Object.assign({}, store.get("defaultAiState") || {}, { loading: false, refreshRequestId: null, error: "Clay is offline. Reconnect and try again." }) });
  }
}

export function beginDefaultAiConnection() {
  var state = store.get("defaultAiState") || {};
  var dirty = store.get("defaultAiDraftDirty") === true;
  var update = {
    defaultAiState: Object.assign({}, state, {
      loading: false,
      saving: false,
      refreshRequestId: null,
      saveRequestId: null,
      catalogRequestIds: {},
      catalogs: {},
      preference: null,
      selection: null,
      installedVendors: [],
      accountAvailable: !!expectedAccountId(),
      accountId: expectedAccountId(),
      serverEpoch: null,
      canonicalRevision: 0,
      error: "",
    }),
  };
  if (!dirty) update.defaultAiDraft = { vendor: "", model: "", effort: "" };
  store.set(update);
}

function applyCatalogMessage(msg, state) {
  var requests = Object.assign({}, state.catalogRequestIds || {});
  if (!msg.vendor || requests[msg.vendor] !== msg.requestId) return;
  if (typeof msg.canonicalRevision === "number" && msg.canonicalRevision < (state.canonicalRevision || 0)) return;
  delete requests[msg.vendor];
  var catalogs = Object.assign({}, state.catalogs || {});
  catalogs[msg.vendor] = Object.assign({}, msg.catalog || {}, { loading: false });
  var next = Object.assign({}, state, {
    catalogRequestIds: requests,
    catalogs: catalogs,
    installedVendors: msg.installedVendors || state.installedVendors || [],
    accountAvailable: msg.accountAvailable !== false,
    accountId: msg.accountId || state.accountId || null,
    serverEpoch: msg.serverEpoch || state.serverEpoch || null,
    canonicalRevision: typeof msg.canonicalRevision === "number" ? msg.canonicalRevision : state.canonicalRevision || 0,
    error: msg.error || "",
  });
  var draft = store.get("defaultAiDraft") || {};
  if (draft.vendor === msg.vendor && !draft.model && msg.selection && msg.selection.model) {
    draft = Object.assign({}, draft, { model: msg.selection.model, effort: msg.selection.effort || "" });
  }
  store.set({ defaultAiState: next, defaultAiDraft: draft });
}

function applyStateMessage(msg, state) {
  var isRefresh = !!msg.requestId && msg.requestId === state.refreshRequestId;
  var isSave = !!msg.requestId && msg.requestId === state.saveRequestId;
  if (msg.requestId && !isRefresh && !isSave) return;
  if (typeof msg.canonicalRevision === "number" && msg.canonicalRevision < (state.canonicalRevision || 0)) return;
  var next = Object.assign({}, state);
  if (isRefresh) { next.loading = false; next.refreshRequestId = null; }
  if (isSave) { next.saving = false; next.saveRequestId = null; }
  next.accountAvailable = msg.accountAvailable !== false;
  if (msg.accountId) next.accountId = msg.accountId;
  if (msg.serverEpoch) next.serverEpoch = msg.serverEpoch;
  if (typeof msg.canonicalRevision === "number") next.canonicalRevision = msg.canonicalRevision;
  next.error = msg.error || "";
  next.installedVendors = msg.installedVendors || state.installedVendors || [];
  if (Object.prototype.hasOwnProperty.call(msg, "preference")) next.preference = msg.preference || null;
  if (Object.prototype.hasOwnProperty.call(msg, "selection")) next.selection = msg.selection || null;
  if (msg.catalog) {
    var catalogVendor = msg.selection && msg.selection.vendor || msg.preference && msg.preference.vendor || "";
    var catalogs = Object.assign({}, state.catalogs || {});
    if (catalogVendor) catalogs[catalogVendor] = Object.assign({}, msg.catalog, { loading: false, error: msg.error || msg.catalog.error || "" });
    next.catalogs = catalogs;
  }
  var dirty = store.get("defaultAiDraftDirty") === true;
  var draft = store.get("defaultAiDraft") || {};
  if (!dirty && msg.preference) draft = Object.assign({}, msg.preference);
  else if (!dirty && msg.ready && msg.selection) draft = Object.assign({}, msg.selection);
  if (isSave && msg.ready && msg.selection) { draft = Object.assign({}, msg.preference || msg.selection); dirty = false; }
  store.set({ defaultAiState: next, defaultAiDraft: draft, defaultAiDraftDirty: dirty });
}

export function handleDefaultAiMessage(msg) {
  if (!msg || ["default_ai_state", "default_ai_catalog"].indexOf(msg.type) === -1) return false;
  var state = Object.assign({}, store.get("defaultAiState") || {});
  var expected = expectedAccountId();
  if (msg.accountId && msg.accountId !== expected) return true;
  if (state.accountId && state.accountId !== expected) return true;
  if (msg.serverEpoch && msg.serverEpoch !== state.serverEpoch) {
    var establishesEpoch = msg.type === "default_ai_state" && !!msg.requestId && msg.requestId === state.refreshRequestId;
    if (state.serverEpoch || !establishesEpoch) return true;
    state = Object.assign({}, state, { serverEpoch: msg.serverEpoch, canonicalRevision: 0, catalogs: {}, catalogRequestIds: {} });
  }
  if (msg.type === "default_ai_catalog") applyCatalogMessage(msg, state);
  else applyStateMessage(msg, state);
  render();
  return true;
}

export function initDefaultAi() {
  var actions = document.querySelector(".user-island-actions");
  if (!actions || document.getElementById("default-ai-btn")) return;
  var button = document.createElement("button");
  button.id = "default-ai-btn";
  button.className = "default-ai-button";
  button.title = "Default AI";
  button.setAttribute("aria-label", "Default AI");
  button.setAttribute("aria-haspopup", "dialog");
  button.setAttribute("aria-expanded", "false");
  button.innerHTML = '<span class="default-ai-avatar"></span>';
  var settings = document.getElementById("user-settings-btn");
  if (settings) actions.insertBefore(button, settings);
  else actions.appendChild(button);
  popover = document.createElement("section");
  popover.id = "default-ai-popover";
  popover.className = "default-ai-popover hidden";
  popover.setAttribute("role", "dialog");
  popover.setAttribute("aria-label", "Default AI settings");
  document.body.appendChild(popover);
  button.addEventListener("click", function () {
    if (!popover.classList.contains("hidden")) { close(); return; }
    opener = button;
    button.setAttribute("aria-expanded", "true");
    popover.classList.remove("hidden");
    requestDefaultAi();
    render();
  });
  document.addEventListener("click", function (event) {
    var path = typeof event.composedPath === "function" ? event.composedPath() : [];
    var clickedButton = path.indexOf(button) !== -1 || button.contains(event.target);
    var clickedPopover = path.indexOf(popover) !== -1 || popover.contains(event.target);
    if (!popover || popover.classList.contains("hidden") || clickedPopover || clickedButton) return;
    close();
  });
  document.addEventListener("keydown", function (event) {
    if (event.key !== "Escape" || !popover || popover.classList.contains("hidden")) return;
    event.preventDefault();
    close();
  });
  window.addEventListener("resize", position);
  window.addEventListener("scroll", position, true);
  updateBadge();
}

export function openDefaultAi() {
  var button = document.getElementById("default-ai-btn");
  if (button && popover && popover.classList.contains("hidden")) button.click();
}

function updateBadge() {
  var avatar = document.querySelector("#default-ai-btn .default-ai-avatar");
  var selection = (store.get("defaultAiState") || {}).selection;
  if (!avatar) return;
  var source = selection && VENDOR_AVATARS[selection.vendor];
  var image = avatar.querySelector("img");
  if (!source) {
    if (image) image.remove();
    return;
  }
  if (!image) {
    image = document.createElement("img");
    image.alt = "";
    avatar.appendChild(image);
  }
  if (image.getAttribute("src") !== source) image.setAttribute("src", source);
}

store.subscribe(function (state, previous) {
  if (state.myUserId !== previous.myUserId || state.isMultiUserMode !== previous.isMultiUserMode) {
    var accountId = state.isMultiUserMode ? state.myUserId || "" : "default";
    store.set({
      defaultAiState: { loading: false, saving: false, refreshRequestId: null, saveRequestId: null, catalogRequestIds: {}, catalogs: {}, preference: null, selection: null, installedVendors: [], accountAvailable: !!accountId, accountId: accountId, serverEpoch: null, canonicalRevision: 0, error: "" },
      defaultAiDraft: { vendor: "", model: "", effort: "" },
      defaultAiDraftDirty: false,
    });
    if (accountId && state.connected) requestDefaultAi();
    return;
  }
  if (state.defaultAiState === previous.defaultAiState) return;
  updateBadge();
  if (popover && !popover.classList.contains("hidden")) render();
});
