import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';

var MCP_PERMISSION_TIMEOUT_MS = 10000;
var _permissionModeTimers = {};

function pendingKey(projectSlug, sessionId, requestId) {
  return String(projectSlug) + ":" + String(sessionId) + ":" + String(requestId);
}

function pendingMap() {
  return store.get('mcpPermissionModePendingByTarget') || {};
}

function setPendingMap(next) {
  store.set({ mcpPermissionModePendingByTarget: next });
}

function findPending(requestId) {
  var pending = pendingMap();
  var keys = Object.keys(pending);
  for (var i = 0; i < keys.length; i++) {
    if (pending[keys[i]].requestId === requestId) return { key: keys[i], value: pending[keys[i]] };
  }
  return null;
}

function clearPendingRequest(requestId) {
  var found = findPending(requestId);
  if (!found) return null;
  if (_permissionModeTimers[requestId]) clearTimeout(_permissionModeTimers[requestId]);
  delete _permissionModeTimers[requestId];
  var next = Object.assign({}, pendingMap());
  delete next[found.key];
  setPendingMap(next);
  return found.value;
}

export function clearMcpPermissionModePending() {
  var requestIds = Object.keys(_permissionModeTimers);
  for (var i = 0; i < requestIds.length; i++) clearTimeout(_permissionModeTimers[requestIds[i]]);
  _permissionModeTimers = {};
  if (Object.keys(pendingMap()).length) setPendingMap({});
}

export function mcpPermissionModeApplicability(state) {
  if (!state.permissionCapabilities || state.permissionCapabilities.mcpOverride !== true) {
    return { applicable: false, reason: "AI review is unavailable for this SDK session." };
  }
  if (state.effectivePermissionMode === "auto" || state.effectivePermissionMode === "bypassPermissions") {
    return { applicable: true, reason: "" };
  }
  if (!state.effectivePermissionMode && state.currentMode === "auto") {
    return { applicable: false, reason: "Waiting for the SDK to confirm Auto." };
  }
  return { applicable: false, reason: "AI review requires an active Auto session." };
}

export function sendMcpPermissionMode(projectSlug, sessionId, serverName, mode) {
  var state = store.snap();
  var applicability = mcpPermissionModeApplicability(state);
  var ws = getWs();
  if (!state.connected || state.currentSlug !== projectSlug || state.activeSessionId !== sessionId || !applicability.applicable || !ws || ws.readyState !== 1) {
    showToast(applicability.applicable ? "Reconnect before changing AI review policy." : applicability.reason, "error");
    return false;
  }
  var pending = pendingMap();
  var pendingKeys = Object.keys(pending);
  for (var i = 0; i < pendingKeys.length; i++) {
    var item = pending[pendingKeys[i]];
    if (item.projectSlug === projectSlug && item.sessionId === sessionId && item.serverName === serverName) return false;
  }
  var requestId = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
  var key = pendingKey(projectSlug, sessionId, requestId);
  var overrides = state.mcpPermissionModeOverrides || {};
  var next = Object.assign({}, pending);
  next[key] = {
    projectSlug: projectSlug,
    sessionId: sessionId,
    requestId: requestId,
    serverName: serverName,
    mode: mode || "",
    previousMode: overrides[serverName] || ""
  };
  setPendingMap(next);
  _permissionModeTimers[requestId] = setTimeout(function () {
    if (!clearPendingRequest(requestId)) return;
    showToast("Changing AI review policy timed out.", "error");
  }, MCP_PERMISSION_TIMEOUT_MS);
  try {
    var result = ws.send(JSON.stringify({
      type: "set_mcp_permission_mode_override",
      projectSlug: projectSlug,
      sessionId: sessionId,
      requestId: requestId,
      serverName: serverName,
      mode: mode || null,
    }));
    if (result === false) throw new Error("WebSocket send failed");
  } catch (error) {
    clearPendingRequest(requestId);
    showToast("Failed to send the AI review policy change.", "error");
    return false;
  }
  return true;
}

export function handleMcpPermissionModeResult(msg) {
  var found = findPending(msg.requestId);
  if (!found) return;
  var pending = found.value;
  if (msg.projectSlug && msg.projectSlug !== pending.projectSlug) return;
  if (msg.sessionId !== pending.sessionId || msg.serverName !== pending.serverName) return;
  clearPendingRequest(msg.requestId);
  if (pending.projectSlug !== store.get('currentSlug') || pending.sessionId !== store.get('activeSessionId')) return;
  if (!msg.ok) {
    showToast(msg.error || "Failed to change AI review policy.", "error");
    return;
  }
  store.set({ mcpPermissionModeOverrides: msg.mcpPermissionModeOverrides || {} });
}
