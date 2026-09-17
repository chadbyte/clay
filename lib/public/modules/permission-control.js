// Shared session permission selector for standalone and split Driver headers.

import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';

var REQUEST_TIMEOUT_MS = 10000;
var requestTimers = {};

function targetKey(projectSlug, sessionId) {
  return String(projectSlug || "") + ":" + String(sessionId || "");
}

function pendingMap() {
  return store.get('permissionModePendingByTarget') || {};
}

export function permissionPendingFor(projectSlug, sessionId) {
  return pendingMap()[targetKey(projectSlug, sessionId)] || null;
}

function replacePending(key, value) {
  var next = Object.assign({}, pendingMap());
  if (value) next[key] = value;
  else delete next[key];
  store.set({ permissionModePendingByTarget: next });
}

function clearRequest(requestId, key) {
  if (requestTimers[requestId]) clearTimeout(requestTimers[requestId]);
  delete requestTimers[requestId];
  var pending = pendingMap()[key];
  if (pending && pending.requestId === requestId) replacePending(key, null);
}

export function clearPermissionModePending() {
  var ids = Object.keys(requestTimers);
  for (var i = 0; i < ids.length; i++) clearTimeout(requestTimers[ids[i]]);
  requestTimers = {};
  store.set({ permissionModePendingByTarget: {} });
}

export function createPermissionControl(className, ariaLabel) {
  var control = document.createElement("div");
  control.className = "session-permission-control " + (className || "");
  control.setAttribute("role", "group");
  control.setAttribute("aria-label", ariaLabel || "Session permission mode");
  control.innerHTML = '<div class="session-permission-segmented">' +
    '<button type="button" data-permission-mode="default"><span class="permission-label">Ask</span><span class="permission-spinner" aria-hidden="true"></span></button>' +
    '<button type="button" data-permission-mode="auto"><span class="permission-label">Auto</span><span class="permission-spinner" aria-hidden="true"></span></button>' +
    '<button type="button" data-permission-mode="bypassPermissions" aria-label="Skip permissions" title="Skip permissions"><span class="permission-label-long permission-label">Skip permissions</span><span class="permission-label-short permission-label" aria-hidden="true">Skip</span><span class="permission-spinner" aria-hidden="true"></span></button>' +
    '</div><span class="session-permission-status" aria-live="polite"></span>';
  control.querySelector(".session-permission-status").setAttribute("aria-atomic", "true");
  return control;
}

function modeLabel(mode) {
  var labels = { default: "Ask", plan: "Plan", acceptEdits: "Auto-accept edits", dontAsk: "Don't ask",
    bypassPermissions: "Skip permissions", auto: "Auto" };
  return labels[mode] || mode;
}

export function permissionStatusText(state, pending, autoSupported, autoVisible) {
  if (state.globalPermissionModeForced) return "Skip permissions forced by the server setting";
  if (pending) return "Applying…";
  if (state.permissionMode === "plan") return "Plan workflow";
  if (state.permissionMode === "acceptEdits") return "Auto-accept edits workflow";
  if (state.permissionMode === "dontAsk") return "Don't ask workflow";
  if (autoVisible && !autoSupported) return "Auto unavailable for this Claude session";
  if (state.permissionMode === "auto" && !state.effectivePermissionMode) return "Auto selected · waiting for runtime";
  if (state.permissionMode === "auto" && state.effectivePermissionMode !== "auto") {
    return "Auto unavailable at runtime · using " + modeLabel(state.effectivePermissionMode);
  }
  return "";
}

function compactPermissionStatusText(state, pending, autoSupported, autoVisible, fullText) {
  if (state.globalPermissionModeForced) return "Forced Skip";
  if (pending) return "Applying…";
  if (state.permissionMode === "plan") return "Plan";
  if (state.permissionMode === "acceptEdits") return "Auto-accept";
  if (state.permissionMode === "dontAsk") return "Don't ask";
  if (autoVisible && !autoSupported) return "Auto unavailable";
  if (state.permissionMode === "auto" && !state.effectivePermissionMode) return "Waiting for Auto";
  if (state.permissionMode === "auto" && state.effectivePermissionMode !== "auto") return "Using " + modeLabel(state.effectivePermissionMode);
  return fullText;
}

export function renderPermissionControl(control, state) {
  if (!control) return;
  var projectSlug = state.projectSlug || "";
  var sessionId = state.sessionId || null;
  var pending = permissionPendingFor(projectSlug, sessionId);
  var autoVisible = state.vendor === "claude";
  var autoSupported = !!(state.permissionCapabilities && state.permissionCapabilities.auto === true);
  var globallyForced = state.globalPermissionModeForced === true;
  var connected = state.connected !== false && !!getWs() && getWs().readyState === 1;
  control.classList.toggle("hidden", state.visible === false);
  control.classList.toggle("permission-pending", !!pending);
  control.classList.toggle("permission-auto-unsupported", autoVisible && !autoSupported);
  control.classList.toggle("permission-globally-forced", globallyForced);
  control.classList.toggle("permission-runtime-fallback", state.permissionMode === "auto" && !!state.effectivePermissionMode && state.effectivePermissionMode !== "auto");
  control.setAttribute("aria-busy", pending ? "true" : "false");
  var buttons = control.querySelectorAll("[data-permission-mode]");
  for (var i = 0; i < buttons.length; i++) {
    var mode = buttons[i].dataset.permissionMode;
    var unsupported = mode === "auto" && autoVisible && !autoSupported;
    var requested = !!pending && pending.mode === mode;
    buttons[i].hidden = mode === "auto" && !autoVisible;
    var selected = globallyForced ? mode === "bypassPermissions" : mode === state.permissionMode;
    buttons[i].disabled = globallyForced || unsupported || !!pending || !connected || state.locked === true;
    buttons[i].classList.toggle("active", selected);
    buttons[i].classList.toggle("pending", requested);
    buttons[i].setAttribute("aria-pressed", selected ? "true" : "false");
    buttons[i].setAttribute("aria-busy", requested ? "true" : "false");
    if (unsupported) buttons[i].title = "Auto permissions are unavailable for this Claude session.";
    else buttons[i].removeAttribute("title");
  }
  var status = control.querySelector(".session-permission-status");
  if (status) {
    var fullStatus = permissionStatusText(state, pending, autoSupported, autoVisible);
    var compact = control.classList.contains("split-pane-full-access");
    status.textContent = compact ? compactPermissionStatusText(state, pending, autoSupported, autoVisible, fullStatus) : fullStatus;
    status.classList.toggle("hidden", !status.textContent);
    if (fullStatus) status.title = fullStatus;
    else status.removeAttribute("title");
  }
}

export function bindPermissionControl(control, getState) {
  if (!control || control.dataset.permissionBound === "true") return;
  control.dataset.permissionBound = "true";
  control.addEventListener("click", function(event) {
    var button = event.target.closest("[data-permission-mode]");
    if (!button || button.disabled) return;
    var state = getState() || {};
    var mode = button.dataset.permissionMode;
    var autoSupported = !!(state.permissionCapabilities && state.permissionCapabilities.auto === true);
    if (state.visible === false || state.locked === true || state.globalPermissionModeForced === true || state.connected === false || store.get('connected') === false) return;
    if (!state.projectSlug || state.projectSlug !== store.get('currentSlug') || !state.sessionId) return;
    if (mode === "auto" && (state.vendor !== "claude" || !autoSupported)) return;
    sendPermissionMode(state.projectSlug, state.sessionId, mode);
  });
}

export function sendPermissionMode(projectSlug, sessionId, mode) {
  var ws = getWs();
  if (store.get('skipPermsEnabled') === true) {
    showToast("Skip permissions is forced by the server setting.", "error");
    return false;
  }
  if (!projectSlug || !sessionId || !ws || ws.readyState !== 1) {
    showToast("Permission mode could not be changed while disconnected.", "error");
    return false;
  }
  var key = targetKey(projectSlug, sessionId);
  if (permissionPendingFor(projectSlug, sessionId)) return false;
  var requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + ":" + String(sessionId);
  replacePending(key, { requestId: requestId, projectSlug: projectSlug, sessionId: sessionId, mode: mode });
  requestTimers[requestId] = setTimeout(function() {
    clearRequest(requestId, key);
    showToast("Permission mode change timed out. The previous mode is still shown.", "error");
  }, REQUEST_TIMEOUT_MS);
  try {
    var sendResult = ws.send(JSON.stringify({ type: "set_permission_mode", projectSlug: projectSlug, sessionId: sessionId, mode: mode, requestId: requestId }));
    if (sendResult === false) throw new Error("The permission transport declined the request.");
  } catch (error) {
    clearRequest(requestId, key);
    showToast("Permission mode could not be sent: " + (error.message || error), "error");
    return false;
  }
  return true;
}

export function handlePermissionModeResult(msg) {
  var key = targetKey(msg.projectSlug, msg.sessionId);
  var pending = pendingMap()[key];
  if (!pending || pending.requestId !== msg.requestId) return;
  clearRequest(msg.requestId, key);
  if (!msg.ok) {
    showToast(msg.error || "Permission mode could not be changed.", "error");
    return;
  }
  if (msg.projectSlug === store.get('currentSlug') && msg.sessionId === store.get('activeSessionId')) {
    store.set({
      currentMode: msg.mode || "default",
      effectivePermissionMode: Object.prototype.hasOwnProperty.call(msg, 'effectivePermissionMode') ? msg.effectivePermissionMode : null,
      permissionCapabilities: msg.permissionCapabilities || store.get('permissionCapabilities'),
      mcpPermissionModeOverrides: msg.mcpPermissionModeOverrides || {},
    });
  }
}
