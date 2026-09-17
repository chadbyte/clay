// mcp-ui.js - MCP Servers modal (sidebar button + panel)
// Renders available MCP servers with per-project toggle checkboxes.

import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { setHttpMcpServers } from './app-misc.js';
import { store } from './store.js';
import { showToast } from './utils.js';

var modal = null;
var contentEl = null;
var _mcpServers = []; // { name, transport, toolCount, extensionEnabled, projectEnabled }
var _extensionConnected = false;
var _nativeHostConnected = false;
var _extensionId = null;
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

export function initMcp() {
  modal = document.getElementById("mcp-modal");
  contentEl = document.getElementById("mcp-content");

  var btn = document.getElementById("mcp-btn");
  var mateBtn = document.getElementById("mate-mcp-btn");
  var closeBtn = document.getElementById("mcp-modal-close");
  var backdrop = modal ? modal.querySelector(".confirm-backdrop") : null;

  if (btn) btn.addEventListener("click", openMcpModal);
  if (mateBtn) mateBtn.addEventListener("click", openMcpModal);
  if (closeBtn) closeBtn.addEventListener("click", closeMcpModal);
  if (backdrop) backdrop.addEventListener("click", closeMcpModal);

  store.subscribe(function (state, prev) {
    var changed = state.activeSessionId !== prev.activeSessionId || state.currentSlug !== prev.currentSlug ||
      state.currentMode !== prev.currentMode || state.effectivePermissionMode !== prev.effectivePermissionMode ||
      state.permissionCapabilities !== prev.permissionCapabilities || state.mcpPermissionModeOverrides !== prev.mcpPermissionModeOverrides ||
      state.mcpPermissionModePendingByTarget !== prev.mcpPermissionModePendingByTarget || state.connected !== prev.connected;
    if (changed && modal && !modal.classList.contains("hidden")) renderMcpServerList();
  });

  // ESC to close
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && modal && !modal.classList.contains("hidden")) {
      closeMcpModal();
    }
  });
}

export function handleMcpServersState(msg) {
  _mcpServers = msg.servers || [];
  _extensionConnected = true;
  if (msg.hostConnected !== undefined) _nativeHostConnected = msg.hostConnected;
  if (msg.extensionId) _extensionId = msg.extensionId;

  // Update HTTP MCP server registry for direct fetch calls
  setHttpMcpServers(_mcpServers);

  // Update sidebar badge
  updateBadge();

  // Re-render if modal is open (skip during toggle cooldown)
  if (modal && !modal.classList.contains("hidden") && !_toggleCooldown) {
    renderMcpServerList();
  }
}

export function setExtensionConnected(connected) {
  _extensionConnected = connected;
}

export function getMcpServers() {
  return _mcpServers;
}

function openMcpModal() {
  if (!modal) return;
  modal.classList.remove("hidden");
  refreshIcons(modal);
  renderMcpServerList();
}

function closeMcpModal() {
  if (!modal) return;
  modal.classList.add("hidden");
}

function updateBadge() {
  var enabled = 0;
  for (var i = 0; i < _mcpServers.length; i++) {
    if (_mcpServers[i].extensionEnabled && _mcpServers[i].projectEnabled) enabled++;
  }

  var badges = [
    document.getElementById("mcp-sidebar-count"),
    document.getElementById("mate-mcp-sidebar-count"),
  ];
  for (var j = 0; j < badges.length; j++) {
    var badge = badges[j];
    if (!badge) continue;
    if (enabled > 0) {
      badge.textContent = String(enabled);
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }
}

function renderMcpServerList() {
  if (!contentEl) return;
  contentEl.innerHTML = "";

  var available = _mcpServers.filter(function (s) { return s.extensionEnabled; });
  var hasServers = available.length > 0;
  var allDone = _extensionConnected && _nativeHostConnected && hasServers;

  // --- All setup complete: skip wizard, show server list only ---
  if (allDone) {
    var desc = document.createElement("p");
    desc.className = "mcp-desc";
    desc.textContent = "Toggle which MCP servers this project can use.";
    contentEl.appendChild(desc);

    for (var i = 0; i < available.length; i++) {
      var server = available[i];
      var row = document.createElement("label");
      row.className = "mcp-server-row";

      var cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = server.projectEnabled;
      cb.dataset.serverName = server.name;
      cb.addEventListener("change", onToggle);

      var info = document.createElement("div");
      info.className = "mcp-server-info";

      var nameSpan = document.createElement("span");
      nameSpan.className = "mcp-server-name";
      nameSpan.textContent = server.name;

      var meta = document.createElement("span");
      meta.className = "mcp-server-meta";
      meta.textContent = server.toolCount + " tool" + (server.toolCount === 1 ? "" : "s");
      if (server.transport === "http") meta.textContent += "  \u00B7  HTTP";

      info.appendChild(nameSpan);
      info.appendChild(meta);

      row.appendChild(cb);
      row.appendChild(info);

      // Per-server permission mode override (applies to the active session only).
      if (server.projectEnabled) {
        var permissionState = store.snap();
        var applicability = mcpPermissionModeApplicability(permissionState);
        if (!applicability.applicable) {
          var unavailable = document.createElement("span");
          unavailable.className = "mcp-server-perm-reason";
          unavailable.textContent = applicability.reason;
          row.appendChild(unavailable);
          contentEl.appendChild(row);
          continue;
        }
        var modeSel = document.createElement("select");
        modeSel.className = "mcp-server-perm-mode";
        modeSel.dataset.serverName = server.name;
        modeSel.title = "AI review policy for this server (this session only)";
        var optInherit = document.createElement("option");
        optInherit.value = "";
        optInherit.textContent = "Inherit";
        var optAsk = document.createElement("option");
        optAsk.value = "default";
        optAsk.textContent = "Ask";
        var optAuto = document.createElement("option");
        optAuto.value = "auto";
        optAuto.textContent = "AI review";
        modeSel.appendChild(optInherit);
        modeSel.appendChild(optAsk);
        modeSel.appendChild(optAuto);
        var overrides = store.get('mcpPermissionModeOverrides') || {};
        modeSel.value = overrides[server.name] === "auto" || overrides[server.name] === "default" ? overrides[server.name] : "";
        var pending = pendingMap();
        var pendingKeys = Object.keys(pending);
        for (var p = 0; p < pendingKeys.length; p++) {
          var pendingValue = pending[pendingKeys[p]];
          if (pendingValue.projectSlug === permissionState.currentSlug && pendingValue.sessionId === permissionState.activeSessionId && pendingValue.serverName === server.name) {
            modeSel.value = pendingValue.mode;
            modeSel.disabled = true;
            break;
          }
        }
        if (!permissionState.connected) modeSel.disabled = true;
        // The row is a <label>; keep select interactions from toggling the checkbox.
        modeSel.addEventListener("click", function (e) { e.stopPropagation(); });
        modeSel.addEventListener("change", onPermissionModeChange);
        row.appendChild(modeSel);
      }

      contentEl.appendChild(row);
    }
    refreshIcons(contentEl);
    return;
  }

  // --- Setup incomplete: show step wizard ---
  var steps = document.createElement("div");
  steps.className = "mcp-steps";

  // Step 1: Chrome Extension
  var step1Done = _extensionConnected;
  steps.appendChild(renderStep({
    num: 1,
    done: step1Done,
    title: "Install Chrome Extension",
    desc: step1Done
      ? "Connected"
      : "Required to bridge your browser with Clay.",
    action: step1Done ? null : {
      label: "Setup Extension",
      icon: "puzzle",
      onClick: function () {
        closeMcpModal();
        setTimeout(function () {
          var extPill = document.getElementById("ext-pill");
          if (extPill) extPill.click();
        }, 100);
      }
    }
  }));

  // Step 2: Native Host (only needed for remote users)
  var step2Done = _extensionConnected && _nativeHostConnected;
  var installCmd = _extensionId
    ? "npx clay-mcp-bridge install " + _extensionId
    : "npx clay-mcp-bridge install <extension-id>";
  steps.appendChild(renderStep({
    num: 2,
    done: step2Done,
    title: "Install MCP Bridge",
    desc: step2Done
      ? "Connected"
      : "Run in your terminal, then restart your browser.",
    disabled: !step1Done,
    copyCmd: (!step2Done && step1Done) ? installCmd : null
  }));

  // Step 3: Configure MCP Servers
  var step3Done = hasServers;
  var step3Desc = "";
  if (step3Done) {
    step3Desc = available.length + " server" + (available.length === 1 ? "" : "s") + " enabled";
  } else if (step2Done) {
    step3Desc = "Add servers from the Clay Chrome Extension popup using the + button, or import an existing config file.";
  } else {
    step3Desc = "Configure after installing the bridge.";
  }
  steps.appendChild(renderStep({
    num: 3,
    done: step3Done,
    title: "Add MCP Servers",
    desc: step3Desc,
    disabled: !step2Done,
    action: (!step3Done && step2Done) ? {
      label: "Open Extension popup to add servers",
      icon: "puzzle",
      onClick: function () {
        closeMcpModal();
        setTimeout(function () {
          var extPill = document.getElementById("ext-pill");
          if (extPill) extPill.click();
        }, 100);
      }
    } : null
  }));

  contentEl.appendChild(steps);
  refreshIcons(contentEl);
}

function renderStep(opts) {
  var el = document.createElement("div");
  el.className = "mcp-step" + (opts.done ? " done" : "") + (opts.disabled ? " disabled" : "");

  var icon = opts.done ? "check-circle-2" : "circle";
  var iconClass = opts.done ? "mcp-step-icon done" : "mcp-step-icon";

  var html = '<div class="' + iconClass + '"><i data-lucide="' + icon + '"></i></div>'
    + '<div class="mcp-step-body">'
    + '<div class="mcp-step-title">' + opts.title + '</div>'
    + '<div class="mcp-step-desc">' + opts.desc + '</div>';

  if (opts.copyCmd) {
    html += '<div class="mcp-install-cmd-row">'
      + '<code class="mcp-install-cmd">' + opts.copyCmd + '</code>'
      + '<button class="mcp-install-copy-btn" type="button"><i data-lucide="copy"></i></button>'
      + '</div>';
  }

  html += '</div>';
  el.innerHTML = html;

  if (opts.action && !opts.disabled) {
    var btn = document.createElement("button");
    btn.className = "mcp-ext-setup-btn";
    btn.type = "button";
    btn.innerHTML = '<i data-lucide="' + opts.action.icon + '"></i> ' + opts.action.label;
    btn.addEventListener("click", opts.action.onClick);
    el.querySelector(".mcp-step-body").appendChild(btn);
  }

  if (opts.copyCmd) {
    var copyBtn = el.querySelector(".mcp-install-copy-btn");
    copyBtn.addEventListener("click", function () {
      navigator.clipboard.writeText(opts.copyCmd).then(function () {
        copyBtn.innerHTML = '<i data-lucide="check"></i>';
        refreshIcons(copyBtn);
        setTimeout(function () {
          copyBtn.innerHTML = '<i data-lucide="copy"></i>';
          refreshIcons(copyBtn);
        }, 1500);
      });
    });
  }

  return el;
}

var _toggleCooldown = false;

function onToggle(e) {
  var name = e.target.dataset.serverName;
  var enabled = e.target.checked;

  // Optimistic update: apply locally so incoming broadcasts don't revert
  for (var i = 0; i < _mcpServers.length; i++) {
    if (_mcpServers[i].name === name) {
      _mcpServers[i].projectEnabled = enabled;
      break;
    }
  }

  // Suppress re-renders from broadcasts for a short window
  _toggleCooldown = true;
  setTimeout(function () { _toggleCooldown = false; }, 1000);

  var ws = getWs();
  if (ws && ws.readyState === 1) {
    ws.send(JSON.stringify({
      type: "mcp_toggle_server",
      name: name,
      enabled: enabled,
    }));
  }
}

function onPermissionModeChange(e) {
  var name = e.target.dataset.serverName;
  sendMcpPermissionMode(store.get('currentSlug'), store.get('activeSessionId'), name, e.target.value);
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
