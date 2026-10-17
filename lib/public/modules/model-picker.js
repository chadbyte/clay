import { store } from './store.js';
import { getWs } from './ws-ref.js';

var configModelList = null;
var configPopover = null;
var configChip = null;
var requestCounter = 0;
var selectionCounter = 0;
var requestTimer = null;

export function modelEntryValue(entry) {
  if (!entry) return "";
  if (typeof entry === "string") return entry;
  return entry.value || entry.id || "";
}

export function modelEntryMatches(entry, value) {
  if (!entry || !value) return false;
  if (typeof entry === "string") return entry === value;
  return entry.value === value || entry.id === value || entry.resolvedModel === value;
}

export function modelDisplayName(value, models) {
  if (!value) return "";
  var list = models || [];
  for (var i = 0; i < list.length; i++) {
    if (modelEntryMatches(list[i], value)) {
      return typeof list[i] === "string" ? list[i] : (list[i].displayName || modelEntryValue(list[i]));
    }
  }
  return value;
}

function vendorDisplayName(vendor) {
  var info = store.get('vendorInfo') || {};
  return info[vendor] && info[vendor].displayName ? info[vendor].displayName : vendor;
}

function clearRequestTimer() {
  if (!requestTimer) return;
  clearTimeout(requestTimer);
  requestTimer = null;
}

export function setupModelPicker() {
  configModelList = document.getElementById("config-model-list");
  configPopover = document.getElementById("config-popover");
  configChip = document.getElementById("config-chip");
}

export function resetModelPickerState() {
  clearRequestTimer();
  if (configPopover) configPopover.classList.add('hidden');
  if (configChip) configChip.classList.remove('active');
  store.set({
    modelListVendor: "",
    modelListStatus: "idle",
    modelListError: "",
    modelRequestId: "",
    modelSelectionPending: null,
    modelSelectionError: "",
  });
}

export function requestVendorModels(vendor, force) {
  if (!vendor) return null;
  var s = store.snap();
  if (!force && s.modelListVendor === vendor) {
    if (s.modelListStatus === "loading") return s.modelRequestId || null;
    if (s.modelListStatus === "ready" && s.currentModels && s.currentModels.length > 0) return null;
  }

  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    store.set({
      modelListVendor: vendor,
      modelListStatus: "error",
      modelListError: "The connection is not ready. Reconnect and retry.",
    });
    return null;
  }

  requestCounter++;
  var requestId = "models-" + Date.now().toString(36) + "-" + requestCounter;
  clearRequestTimer();
  store.set({
    modelListVendor: vendor,
    modelListStatus: "loading",
    modelListError: "",
    modelRequestId: requestId,
  });
  ws.send(JSON.stringify({ type: "get_vendor_models", vendor: vendor, requestId: requestId }));
  requestTimer = setTimeout(function() {
    var current = store.snap();
    if (current.modelRequestId !== requestId || current.modelListStatus !== "loading") return;
    store.set({
      modelListStatus: "error",
      modelListError: vendorDisplayName(vendor) + " model loading timed out. Retry to try again.",
    });
  }, 35000);
  return requestId;
}

export function prepareModelPickerOpen() {
  var s = store.snap();
  var vendor = s.currentVendor || "claude";
  var needsModels = !s.currentModels || s.currentModels.length === 0;
  var wrongVendor = s.modelListVendor !== vendor;
  var retryable = s.modelListStatus === "error" || s.modelListStatus === "empty" || s.modelListStatus === "idle";
  requestVendorModels(vendor, needsModels || wrongVendor || retryable);
}

export function getModelInfoUpdate(msg) {
  var vendor = msg.vendor || store.get('currentVendor') || "claude";
  var currentVendor = store.get('currentVendor');
  if (currentVendor && vendor !== currentVendor) return null;
  if (msg.sessionId != null && msg.sessionId !== store.get('activeSessionId')) return null;

  var s = store.snap();
  if (msg.requestId && s.modelRequestId && msg.requestId !== s.modelRequestId) return null;

  var models = Array.isArray(msg.models) ? msg.models : [];
  var unsolicitedEmptyWhileLoading = s.modelListStatus === "loading"
    && s.modelListVendor === vendor
    && !msg.requestId
    && !msg.modelStatus
    && !msg.error
    && models.length === 0;
  if (unsolicitedEmptyWhileLoading) {
    return {
      modelListVendor: vendor,
      modelListStatus: "loading",
      modelListError: "",
    };
  }

  clearRequestTimer();
  var status = msg.modelStatus || (msg.error ? "error" : (models.length > 0 ? "ready" : "empty"));
  return {
    modelListVendor: vendor,
    modelListStatus: status,
    modelListError: msg.error || "",
    modelRequestId: "",
  };
}

export function requestModelSelection(model) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) {
    store.set({ modelSelectionError: "The connection is not ready. Reconnect before selecting a model." });
    return;
  }
  var s = store.snap();
  selectionCounter++;
  var requestId = "model-select-" + Date.now().toString(36) + "-" + selectionCounter;
  store.set({
    currentModel: model,
    modelSelectionPending: { requestId: requestId, model: model, previousModel: s.currentModel || "" },
    modelSelectionError: "",
  });
  ws.send(JSON.stringify({
    type: "set_model",
    model: model,
    vendor: s.currentVendor || "claude",
    requestId: requestId,
  }));
}

export function handleModelSelectionResult(msg) {
  var pending = store.get('modelSelectionPending');
  if (!pending || (msg.requestId && msg.requestId !== pending.requestId)) return false;
  if (msg.ok) {
    store.set({
      currentModel: msg.model || pending.model,
      modelSelectionPending: null,
      modelSelectionError: "",
    });
    if (configPopover) configPopover.classList.add("hidden");
    if (configChip) configChip.classList.remove("active");
  } else {
    store.set({
      currentModel: pending.previousModel,
      modelSelectionPending: null,
      modelSelectionError: msg.error || "The model could not be selected.",
    });
  }
  return true;
}

function appendState(title, detail, retry) {
  var stateEl = document.createElement("div");
  stateEl.className = "config-model-state";
  if (title === "Loading models…") {
    var spinner = document.createElement("span");
    spinner.className = "config-model-spinner";
    spinner.setAttribute("aria-hidden", "true");
    stateEl.appendChild(spinner);
  }
  var textWrap = document.createElement("div");
  var titleEl = document.createElement("div");
  titleEl.className = "config-model-state-title";
  titleEl.textContent = title;
  textWrap.appendChild(titleEl);
  if (detail) {
    var detailEl = document.createElement("div");
    detailEl.className = "config-model-state-detail";
    detailEl.textContent = detail;
    textWrap.appendChild(detailEl);
  }
  stateEl.appendChild(textWrap);
  if (retry) {
    var retryBtn = document.createElement("button");
    retryBtn.type = "button";
    retryBtn.className = "config-model-retry";
    retryBtn.textContent = "Retry";
    retryBtn.addEventListener("click", function() {
      requestVendorModels(store.get('currentVendor') || "claude", true);
    });
    stateEl.appendChild(retryBtn);
  }
  configModelList.appendChild(stateEl);
}

export function renderModelPicker() {
  if (!configModelList) return;
  var s = store.snap();
  var vendor = s.currentVendor || "claude";
  var status = s.modelListVendor === vendor ? s.modelListStatus : "idle";
  configModelList.innerHTML = "";

  if (status === "loading") {
    appendState("Loading models…", "Starting " + vendorDisplayName(vendor) + " and requesting its model catalog.", false);
    return;
  }
  if (status === "error") {
    appendState("Couldn’t load models", s.modelListError || "An unexpected error occurred.", true);
    return;
  }
  if (status === "empty" || !s.currentModels || s.currentModels.length === 0) {
    appendState("No models available", s.modelListError || "The vendor returned an empty model catalog.", true);
    return;
  }

  for (var i = 0; i < s.currentModels.length; i++) {
    var item = s.currentModels[i];
    var value = modelEntryValue(item);
    if (!value) continue;
    var button = document.createElement("button");
    button.className = "config-radio-item";
    if (modelEntryMatches(item, s.currentModel)) button.classList.add("active");
    button.dataset.model = value;
    button.textContent = typeof item === "string" ? item : (item.displayName || value);
    if (s.modelSelectionPending && s.modelSelectionPending.model === value) {
      button.classList.add("pending");
      button.textContent += " · Selecting…";
    }
    button.disabled = !!s.modelSelectionPending;
    button.addEventListener("click", function() { requestModelSelection(this.dataset.model); });
    configModelList.appendChild(button);
  }

  if (s.modelSelectionError) {
    appendState("Model selection failed", s.modelSelectionError, false);
  }
}
