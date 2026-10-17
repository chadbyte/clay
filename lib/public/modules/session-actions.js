import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { addSystemMessage, VENDOR_AVATARS, VENDOR_NAMES } from './app-rendering.js';
import { openPairDialog } from './split-pair-ui.js';
import { buildAgentVendorSelect, fillAgentModels, buildAgentEffortSelect, fillAgentEffort } from './agent-config-selects.js';
import { showToast } from './utils.js';
import { sessionCallback, captureSessionAction, sessionActionCurrent } from './pane-binding.js';

var addWorkerButton = null;
var handoffButton = null;
var handoffDialog = null;
var handoffEscapeHandler = null;
var handoffSubmitButton = null;

function closeHandoffDialog() {
  if (handoffDialog) handoffDialog.remove();
  if (handoffEscapeHandler) document.removeEventListener("keydown", handoffEscapeHandler);
  handoffDialog = null;
  handoffEscapeHandler = null;
  handoffSubmitButton = null;
}

function handoffField(labelText, control) {
  var field = document.createElement("div");
  field.className = "handoff-modal-field";
  var label = document.createElement("label");
  label.className = "wt-modal-label";
  label.textContent = labelText;
  field.appendChild(label);
  field.appendChild(control);
  return field;
}

function requestHandoffDialog() {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) return;
  store.set({ handoffAction: captureSessionAction() });
  ws.send(JSON.stringify({ type: "handoff_session_options" }));
}

function openWorkerDialog() {
  var sessionId = store.get('activeSessionId');
  if (!sessionId) return;
  openPairDialog({
    sessionId: sessionId,
    title: document.getElementById("header-title").textContent,
    vendor: store.get('currentVendor') || "claude",
  });
}

function showHandoffDialog(options) {
  if (!sessionActionCurrent(store.get('handoffAction'))) return;
  closeHandoffDialog();
  var installed = options.installedVendors || [];
  var vendorInfo = store.get('vendorInfo') || {};
  if (store.get('isOsUsers')) {
    installed = installed.filter(function (vendor) {
      return !vendorInfo[vendor] || vendorInfo[vendor].osUserIsolation !== false;
    });
  }
  if (installed.length < 1) {
    showToast("Install a coding agent before continuing this session.", "error");
    return;
  }

  var currentVendor = store.get('currentVendor') || "claude";
  var currentModel = store.get('currentModel') || "";
  var currentEffort = store.get('currentEffort') || "";
  var container = document.createElement("div");
  var overlay = document.createElement("div");
  overlay.className = "wt-modal-overlay";
  container.appendChild(overlay);
  var modal = document.createElement("div");
  modal.className = "wt-modal handoff-modal";
  modal.setAttribute("role", "dialog");
  modal.setAttribute("aria-modal", "true");
  modal.setAttribute("aria-labelledby", "handoff-modal-title");

  var title = document.createElement("div");
  title.id = "handoff-modal-title";
  title.className = "wt-modal-title";
  title.textContent = "Continue in a new agent";
  modal.appendChild(title);
  var desc = document.createElement("div");
  desc.className = "handoff-modal-desc";
  desc.textContent = "Start an independent session with a focused copy of this conversation's context.";
  modal.appendChild(desc);

  var source = document.createElement("div");
  source.className = "handoff-modal-source";
  var sourceAvatar = document.createElement("img");
  sourceAvatar.src = VENDOR_AVATARS[currentVendor] || VENDOR_AVATARS.claude;
  sourceAvatar.alt = "";
  source.appendChild(sourceAvatar);
  var sourceCopy = document.createElement("span");
  var sourceTitle = document.createElement("strong");
  sourceTitle.textContent = document.getElementById("header-title").textContent || "Current session";
  var sourceMeta = document.createElement("span");
  sourceMeta.textContent = "From " + (VENDOR_NAMES[currentVendor] || currentVendor);
  sourceCopy.appendChild(sourceTitle);
  sourceCopy.appendChild(sourceMeta);
  source.appendChild(sourceCopy);
  modal.appendChild(source);

  var vendorSelect = buildAgentVendorSelect(installed, currentVendor);
  var modelSelect = document.createElement("select");
  modelSelect.className = "wt-modal-input";
  var effortSelect = buildAgentEffortSelect();
  var vendorField = handoffField("Agent", vendorSelect);
  var modelField = handoffField("Model", modelSelect);
  var effortField = handoffField("Reasoning effort", effortSelect);
  modal.appendChild(vendorField);
  modal.appendChild(modelField);
  modal.appendChild(effortField);

  function syncEffort(preferred) {
    fillAgentEffort(effortSelect, vendorSelect.value, options, modelSelect.value, preferred);
    var capabilities = (options.capabilitiesByVendor && options.capabilitiesByVendor[vendorSelect.value]) || {};
    effortField.style.display = capabilities.effort === false ? "none" : "";
  }
  fillAgentModels(modelSelect, vendorSelect.value, options, vendorSelect.value === currentVendor ? currentModel : "");
  syncEffort(vendorSelect.value === currentVendor ? currentEffort : "");
  vendorSelect.addEventListener("change", function () {
    fillAgentModels(modelSelect, vendorSelect.value, options, "");
    syncEffort("");
  });
  modelSelect.addEventListener("change", function () { syncEffort(effortSelect.value); });

  var actions = document.createElement("div");
  actions.className = "wt-modal-actions";
  var cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "wt-modal-btn";
  cancel.textContent = "Cancel";
  var submit = document.createElement("button");
  submit.type = "button";
  submit.className = "wt-modal-btn primary";
  submit.textContent = "Continue";
  actions.appendChild(cancel);
  actions.appendChild(submit);
  modal.appendChild(actions);
  container.appendChild(modal);
  document.body.appendChild(container);
  handoffDialog = container;
  handoffSubmitButton = submit;

  cancel.addEventListener("click", closeHandoffDialog);
  overlay.addEventListener("click", closeHandoffDialog);
  handoffEscapeHandler = function (event) {
    if (event.key === "Escape") closeHandoffDialog();
  };
  document.addEventListener("keydown", handoffEscapeHandler);
  submit.addEventListener("click", sessionCallback(function () {
    var ws = getWs();
    if (!ws || ws.readyState !== 1) return;
    ws.send(JSON.stringify({
      type: "handoff_session",
      targetVendor: vendorSelect.value,
      model: modelSelect.value,
      effort: effortSelect.value,
    }));
    submit.disabled = true;
    submit.textContent = "Continuing…";
  }));
  vendorSelect.focus();
}

function updateControls() {
  if (!addWorkerButton || !handoffButton) return;
  var state = store.snap();
  var hidden = !state.activeSessionId || state.dmMode || state.paneMode || !!state.splitPanes || state.activeSessionMode !== "gui";
  addWorkerButton.classList.toggle("hidden", hidden);
  handoffButton.classList.toggle("hidden", hidden);
  handoffButton.disabled = hidden || !state.sessionHasHistory || state.sessionIsProcessing;
  handoffButton.title = handoffButton.disabled && !hidden
    ? "Available after the current turn is complete"
    : "Continue in another agent";
}

export function initSessionActions() {
  addWorkerButton = document.getElementById("composer-add-worker-btn");
  handoffButton = document.getElementById("composer-handoff-btn");
  if (!addWorkerButton || !handoffButton) return;
  addWorkerButton.addEventListener("click", openWorkerDialog);
  handoffButton.addEventListener("click", requestHandoffDialog);
  store.subscribe(function (state, prev) {
    if (state.activeSessionId !== prev.activeSessionId || state.dmMode !== prev.dmMode ||
        state.paneMode !== prev.paneMode || state.splitPanes !== prev.splitPanes ||
        state.activeSessionMode !== prev.activeSessionMode ||
        state.sessionHasHistory !== prev.sessionHasHistory ||
        state.sessionIsProcessing !== prev.sessionIsProcessing) updateControls();
  });
  updateControls();
}

export function handleSessionActionMessage(msg) {
  if (msg.type === "handoff_session_options") {
    showHandoffDialog(msg);
    return true;
  }
  if (msg.type === "session_handoff_result") {
    if (msg.ok) closeHandoffDialog();
    else {
      showToast(msg.error || "Could not continue the session in another agent.", "error");
      if (handoffSubmitButton) {
        handoffSubmitButton.disabled = false;
        handoffSubmitButton.textContent = "Continue";
      }
    }
    return true;
  }
  if (msg.type === "handoff_context") {
    var sourceName = VENDOR_NAMES[msg.sourceVendor] || msg.sourceVendor || "another agent";
    addSystemMessage("Continued from “" + (msg.sourceTitle || "Untitled session") + "” in " + sourceName + ".", false);
    return true;
  }
  if (msg.type === "handoff_created") {
    var targetName = VENDOR_NAMES[msg.targetVendor] || msg.targetVendor || "another agent";
    addSystemMessage("Continued in a new " + targetName + " session.", false);
    return true;
  }
  return false;
}
