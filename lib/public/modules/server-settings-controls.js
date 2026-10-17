import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { showToast } from './utils.js';
import { confirmSettingsAction, clearSettingsDraft, setSettingsDraft } from './server-settings-state.js';
import { enhanceSettingsSelects } from './settings-select.js';

function status(id, text) {
  var el = document.getElementById(id);
  if (el) { el.textContent = text; el.classList.remove('hidden'); }
}

function sendSetting(type, values, buttonId, statusId) {
  if (type === 'set_pin' && store.get('serverPinAvailable') !== true) return;
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { status(statusId, 'Disconnected. Your change has not been saved.'); return; }
  var button = document.getElementById(buttonId);
  if (button) button.disabled = true;
  var input = buttonId === 'settings-pin-save-btn' ? document.getElementById('settings-pin-input') : buttonId.endsWith('-save') ? document.getElementById(buttonId.slice(0, -5)) : null;
  if (input) { input.disabled = true; input.dispatchEvent(new Event('settings-sync')); }
  status(statusId, 'Saving…');
  var pending = Object.assign({}, store.get('serverSettingsPending') || {});
  pending[type] = { buttonId: buttonId, statusId: statusId };
  store.set({ serverSettingsPending: pending });
  ws.send(JSON.stringify(Object.assign({ type: type }, values)));
  setTimeout(function () {
    if ((store.get('serverSettingsPending') || {})[type] !== pending[type]) return;
    if (button) button.disabled = false;
    if (input) { input.disabled = false; input.dispatchEvent(new Event('settings-sync')); }
    status(statusId, 'No acknowledgement received. Reconnect and retry; the server may have saved this value.');
  }, 12000);
}

export function setServerPinAvailability(available) {
  store.set({ serverPinAvailable: !!available });
  var section = document.getElementById('settings-server-pin');
  if (!section) return;
  section.hidden = !available;
  section.querySelectorAll('input,button').forEach(function (element) { element.disabled = !available; });
  if (!available) hidePinForm();
}

export function handleServerSettingResult(msg) {
  var type = msg.type.replace(/_result$/, '');
  var pending = Object.assign({}, store.get('serverSettingsPending') || {});
  var request = pending[type];
  if (!request) return;
  delete pending[type];
  store.set({ serverSettingsPending: pending });
  var button = document.getElementById(request.buttonId);
  if (button) { button.disabled = false; if (msg.ok && request.buttonId.endsWith('-save')) button.hidden = true; }
  var input = request.buttonId === 'settings-pin-save-btn' ? document.getElementById('settings-pin-input') : request.buttonId.endsWith('-save') ? document.getElementById(request.buttonId.slice(0, -5)) : null;
  if (input) { input.disabled = false; input.dispatchEvent(new Event('settings-sync')); }
  status(request.statusId, msg.ok ? 'Saved. ' + (msg.timing || '') : (msg.error || 'Could not save. Retry your change.'));
  if (msg.ok) clearSettingsDraft(type);
}

function finishSetting(msg, id, field) {
  handleServerSettingResult(msg);
  var el = document.getElementById(id);
  var key = 'set_keep_awake';
  if (!msg.type.endsWith('_result') && (store.get('serverSettingsDrafts') || {})[key]) return;
  if (el && msg.ok !== false && msg[field] !== undefined) el.checked = !!msg[field];
}

function updatePlatformControls(config) {
  store.set({ serverSettingsConfig: config });
  document.getElementById('settings-keep-awake').disabled = config.platform !== 'darwin';
  status('settings-awake-support', config.platform === 'darwin' ? 'Applies while Clay is running on this Mac.' : 'Unavailable on this platform. Keep awake requires macOS.');
  var channel = document.getElementById('settings-update-channel');
  if (channel && !(store.get('serverSettingsDrafts') || {}).set_update_channel) channel.checked = config.updateChannel === 'beta';
  enhanceSettingsSelects(document.getElementById('server-settings'));
  document.getElementById('settings-image-retention').dispatchEvent(new Event('settings-sync'));
}

export function initServerControls() {
  ['settings-keep-awake', 'settings-image-retention', 'settings-update-channel', 'settings-pin-set-btn', 'settings-pin-remove-btn'].forEach(function (id) { document.getElementById(id).disabled = true; });
  var check = document.getElementById('settings-update-check');
  var update = document.createElement('button'); update.type = 'button'; update.className = 'settings-btn-sm'; update.id = 'settings-install-update'; update.hidden = true; update.textContent = 'Update and restart…';
  check.insertAdjacentElement('afterend', update);
  var receipt = document.createElement('p'); receipt.id = 'settings-update-status'; receipt.className = 'settings-hint'; receipt.setAttribute('role', 'status'); update.insertAdjacentElement('afterend', receipt);
  update.onclick = function () {
    confirmSettingsAction('Install the available release and restart Clay? Active work will be interrupted for everyone. Unsaved settings remain drafts in this tab.', 'Update and restart', function () {
      var ws = getWs();
      if (!ws || ws.readyState !== 1) { status('settings-update-status', 'Disconnected. Reconnect before updating.'); return; }
      update.disabled = true; status('settings-update-status', 'Update requested. Waiting for the daemon…');
      ws.send(JSON.stringify({ type: 'update_now' }));
    });
  };

  document.getElementById('settings-pin-set-btn').onclick = showPinForm;
  document.getElementById('settings-pin-cancel-btn').onclick = hidePinForm;
  document.getElementById('settings-pin-save-btn').onclick = submitPin;
  document.getElementById('settings-pin-input').oninput = function () { setSettingsDraft('pin', !!this.value); };
  document.getElementById('settings-pin-remove-btn').onclick = function () {
    confirmSettingsAction('Remove the server PIN? This changes sign-in protection for new connections.', 'Remove PIN', function () {
      sendSetting('set_pin', { pin: null }, 'settings-pin-remove-btn', 'settings-pin-error');
    });
  };
  [
    ['settings-keep-awake', 'set_keep_awake', 'value', 'Saved changes apply now.'],
    ['settings-image-retention', 'set_image_retention', 'days', 'Review retention. The next cleanup permanently deletes expired images.'],
    ['settings-update-channel', 'set_update_channel', 'channel', 'Choose whether future update checks include prereleases.']
  ].forEach(function (entry) {
    var input = document.getElementById(entry[0]);
    var receipt = document.createElement('p');
    receipt.id = entry[0] + '-status'; receipt.className = 'settings-hint'; receipt.setAttribute('role', 'status');
    input.closest('.settings-toggle-row').insertAdjacentElement('afterend', receipt);
    var save = document.createElement('button'); save.type = 'button'; save.className = 'settings-btn-sm'; save.textContent = 'Save changes';
    save.id = entry[0] + '-save'; save.hidden = true; receipt.insertAdjacentElement('beforebegin', save);
    input.onchange = function () {
      setSettingsDraft(entry[1], true); save.hidden = false; receipt.textContent = entry[3];
    };
    save.onclick = function () {
      var values = {}; values[entry[2]] = entry[2] === 'days' ? Number(input.value) : entry[2] === 'channel' ? (input.checked ? 'beta' : 'stable') : input.checked;
      sendSetting(entry[1], values, save.id, receipt.id);
    };
  });
  document.getElementById('settings-restart-btn').onclick = function () {
    confirmSettingsAction('Restart Clay for everyone? Active agent work will be interrupted. Clients will reconnect. Unsaved settings are not applied.', 'Restart server', function () {
      sendSetting('restart_server', {}, 'settings-restart-btn', 'settings-restart-error');
    });
  };
  var shutdown = document.getElementById('settings-shutdown-input');
  var shutdownButton = document.getElementById('settings-shutdown-btn');
  var reviewShutdown = document.getElementById('settings-shutdown-review');
  var shutdownFlow = document.getElementById('settings-shutdown-flow');
  reviewShutdown.onclick = function () {
    store.set({ serverShutdownReview: true });
    reviewShutdown.hidden = true;
    reviewShutdown.setAttribute('aria-expanded', 'true');
    shutdownFlow.hidden = false;
    shutdown.focus();
  };
  document.getElementById('settings-shutdown-back').onclick = function () {
    store.set({ serverShutdownReview: false });
    shutdownFlow.hidden = true;
    reviewShutdown.hidden = false;
    reviewShutdown.setAttribute('aria-expanded', 'false');
    shutdown.value = '';
    shutdownButton.disabled = true;
    reviewShutdown.focus();
  };
  shutdown.oninput = function () { shutdownButton.disabled = this.value.trim().toLowerCase() !== 'shutdown'; };
  shutdownButton.onclick = function () {
    if (!store.get('serverShutdownReview') || shutdown.value.trim().toLowerCase() !== 'shutdown') return;
    confirmSettingsAction('Stop Clay for everyone? Active work stops and all clients disconnect. Start the service again from the host to recover.', 'Shut down server', function () {
      sendSetting('shutdown_server', {}, shutdownButton.id, 'settings-shutdown-error');
    });
  };
}

export function updateDaemonConfig(config) {
  if (config.error) { status('settings-access-status', config.error); return; }
  store.set({ serverSettingsConfigLoaded: true });
  ['settings-image-retention', 'settings-update-channel', 'settings-pin-set-btn', 'settings-pin-remove-btn'].forEach(function (id) { document.getElementById(id).disabled = false; });
  // Nav header: show hostname (strip .local suffix, lowercase)
  var nameEl = document.getElementById("settings-server-name");
  if (nameEl && config.hostname) {
    var displayHost = config.hostname.replace(/\.local$/i, "").toLowerCase();
    nameEl.textContent = displayHost;
    nameEl.title = config.hostname;
  }

  // Host
  var hostnameEl = document.getElementById("settings-hostname");
  var lanIpEl = document.getElementById("settings-lan-ip");
  if (hostnameEl) hostnameEl.textContent = config.hostname || "-";
  if (lanIpEl) lanIpEl.textContent = config.lanIp || "";

  // Port
  var portEl = document.getElementById("settings-port");
  if (portEl) portEl.textContent = String(config.port || "-");

  // TLS
  var tlsEl = document.getElementById("settings-tls");
  if (tlsEl) {
    tlsEl.textContent = config.tls ? "Enabled" : "Disabled";
    tlsEl.classList.toggle("settings-badge-green", !!config.tls);
  }

  // Debug
  var debugEl = document.getElementById("settings-debug");
  if (debugEl) {
    debugEl.textContent = config.debug ? "Enabled" : "Disabled";
    debugEl.classList.toggle("settings-badge-on", !!config.debug);
  }

  // PIN status
  updatePinStatus(!!config.pinEnabled);

  // Auto-continue on rate limit
  // Auto-continue is now per-user (User Settings > Behavior)

  // Keep awake
  var keepAwakeToggle = document.getElementById("settings-keep-awake");
  if (keepAwakeToggle && !(store.get('serverSettingsDrafts') || {}).set_keep_awake) keepAwakeToggle.checked = !!config.keepAwake;

  // Image retention
  var imageRetentionSelect = document.getElementById("settings-image-retention");
  if (imageRetentionSelect && !(store.get('serverSettingsDrafts') || {}).set_image_retention && config.imageRetentionDays !== undefined) {
    imageRetentionSelect.value = String(config.imageRetentionDays);
  }

  updatePlatformControls(config);

}

export function handleSetPinResult(msg) {
  if (msg.ok) {
    updatePinStatus(!!msg.pinEnabled);
    hidePinForm();
    showToast(msg.pinEnabled ? "PIN saved" : "PIN removed");
    clearSettingsDraft("pin");
  } else { status("settings-pin-error", msg.error || "Could not save PIN. Your draft is retained."); }
  document.getElementById("settings-pin-save-btn").disabled = false;
}

export function handleKeepAwakeChanged(msg) {
  finishSetting(msg, "settings-keep-awake", "keepAwake");
}

export function handleAutoContinueChanged(msg) {
  // Auto-continue is now per-user; server broadcast no longer updates UI
}

export function handleRestartResult(msg) {
  var restartBtn = document.getElementById("settings-restart-btn");
  var errorEl = document.getElementById("settings-restart-error");

  if (msg.ok) {
    if (restartBtn) { restartBtn.textContent = "Server restarting..."; restartBtn.disabled = true; }
    showToast("Server is restarting...");
  } else {
    if (restartBtn) {
      restartBtn.textContent = "Restart";
      restartBtn.disabled = false;
    }
    if (errorEl) {
      errorEl.textContent = msg.error || "Restart failed";
      errorEl.classList.remove("hidden");
    }
  }
}

export function handleShutdownResult(msg) {
  var shutdownInput = document.getElementById("settings-shutdown-input");
  var shutdownBtn = document.getElementById("settings-shutdown-btn");
  var errorEl = document.getElementById("settings-shutdown-error");

  if (msg.ok) {
    if (shutdownBtn) { shutdownBtn.textContent = "Server stopping..."; shutdownBtn.disabled = true; }
    showToast("Server is shutting down...");
  } else {
    if (shutdownBtn) {
      shutdownBtn.textContent = "Shut down…";
      shutdownBtn.disabled = false;
    }
    if (shutdownInput) shutdownInput.disabled = false;
    if (errorEl) {
      errorEl.textContent = msg.error || "Shutdown failed";
      errorEl.classList.remove("hidden");
    }
  }
}

// --- PIN form management ---
function showPinForm() {
  var form = document.getElementById("settings-pin-form");
  var input = document.getElementById("settings-pin-input");
  var errorEl = document.getElementById("settings-pin-error");
  if (form) form.classList.remove("hidden");
  if (errorEl) errorEl.classList.add("hidden");
  if (input) input.focus();
}

function hidePinForm() {
  var form = document.getElementById("settings-pin-form");
  var input = document.getElementById("settings-pin-input");
  var errorEl = document.getElementById("settings-pin-error");
  clearSettingsDraft("pin");
  if (form) form.classList.add("hidden");
  if (input) input.value = "";
  if (errorEl) errorEl.classList.add("hidden");
}

function submitPin() {
  var input = document.getElementById("settings-pin-input");
  var errorEl = document.getElementById("settings-pin-error");
  if (!input) return;
  var pin = input.value.trim();
  if (!/^\d{6}$/.test(pin)) {
    if (errorEl) { errorEl.textContent = "Enter exactly six digits."; errorEl.classList.remove("hidden"); }
    input.focus();
    return;
  }
  if (errorEl) errorEl.classList.add("hidden");
  var ws = getWs();
  if (ws && ws.readyState === 1) {
    sendSetting("set_pin", { pin: pin }, "settings-pin-save-btn", "settings-pin-error");
  } else { status("settings-pin-error", "Disconnected. Reconnect and save again."); }
}

function updatePinStatus(enabled) {
  var statusEl = document.getElementById("settings-pin-status");
  var setBtn = document.getElementById("settings-pin-set-btn");
  var removeBtn = document.getElementById("settings-pin-remove-btn");
  var actionLabel = document.getElementById("settings-pin-action-label");

  if (statusEl) {
    statusEl.textContent = enabled ? "Enabled" : "Disabled";
    statusEl.classList.toggle("settings-badge-green", enabled);
  }
  if (setBtn) setBtn.textContent = enabled ? "Change PIN" : "Set PIN";
  if (removeBtn) removeBtn.classList.toggle("hidden", !enabled);
  if (actionLabel) actionLabel.textContent = enabled ? "Change PIN" : "Set PIN";
}


export function handleServerUpdate(msg) {
  var button = document.getElementById('settings-install-update');
  if (!button) return;
  if (msg.type === 'update_available') { button.hidden = false; button.disabled = false; status('settings-update-status', 'Version ' + msg.version + ' is available. Review and restart when ready.'); }
  if (msg.type === 'up_to_date') { button.hidden = true; status('settings-update-status', 'No newer release is available on this channel.'); }
  if (msg.type === 'update_started') { button.disabled = true; status('settings-update-status', 'Updating. The connection will recover after the daemon restarts.'); }
  if (msg.type === 'update_check_failed') { document.getElementById('settings-update-check').disabled = false; status('settings-update-status', msg.error || 'Update check failed. Retry when connected.'); }
}
