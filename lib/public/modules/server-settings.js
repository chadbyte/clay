import { initStorageUsage, loadStorageUsage } from './server-storage-settings.js';
import { initAccountAuthSettings, loadAccountAuthSettings } from './account-auth-settings.js';
// Server pane of the unified settings shell. Page state survives navigation and closing.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { closeFileViewer } from './filebrowser.js';
import { loadAdminSection } from './admin.js';
import { registerSettingsScope, isSettingsShellOpen, activeSettingsScope } from './settings-shell.js';
import { initNetworkSettings, loadNetworkSettings } from './server-network-settings.js';
import { initServerControls, setServerPinAvailability } from './server-settings-controls.js';
import { initServerEnvironment, loadSharedEnv } from './server-settings-environment.js';
import { hasSettingsDrafts } from './server-settings-state.js';
import { enhanceSettingsSelects } from './settings-select.js';
export { updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleAutoContinueChanged, handleRestartResult, handleShutdownResult, handleServerSettingResult } from './server-settings-controls.js';
export { handleSharedEnv, handleSharedEnvSaved } from './server-settings-environment.js';

function root() { return document.getElementById('server-settings'); }
export function isSettingsOpen() { return isSettingsShellOpen() && activeSettingsScope() === 'server'; }
function send(type) { var ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: type })); }

function selectPage(id) {
  if (!store.get('serverSettingsAuthorized')) return;
  store.set({ serverSettingsPage: id });
  root().querySelectorAll('.server-settings-section').forEach(function (page) { page.classList.toggle('active', page.dataset.section === id); });
  if (id === 'network') loadNetworkSettings();
  if (id === 'security') loadAccountAuthSettings();
  if (id === 'storage') loadStorageUsage();
  if (id === 'environment') loadSharedEnv();
  if (id.indexOf('admin-') === 0) {
    var body = document.getElementById(id + '-body');
    if (id !== 'admin-smtp' || !(store.get('serverSettingsDrafts') || {}).smtp) loadAdminSection(id, body);
  }
  enhanceSettingsSelects(root()); refreshIcons(root());
}

// The shell has already verified administrator (or solo-owner) access.
function enterServerSettings(ctx) {
  closeFileViewer();
  var status = document.getElementById('settings-access-status');
  status.textContent = '';
  store.set({ serverSettingsAuthorized: true });
  setServerPinAvailability(!ctx.access.multiUser);
  root().querySelectorAll('.server-settings-section').forEach(function (page) { page.classList.remove('active'); });
  if (!hasSettingsDrafts()) send('get_daemon_config');
  setTimeout(function () {
    if (isSettingsOpen() && !store.get('serverSettingsConfigLoaded')) status.textContent = 'Server configuration has not loaded. Reconnect, then reopen Settings to retry.';
  }, 12000);
  send('process_stats');
  clearInterval(store.get('serverSettingsStatsTimer'));
  store.set({ serverSettingsStatsTimer: setInterval(function () { send('process_stats'); }, 5000) });
  document.getElementById('settings-project-slug').textContent = store.get('currentSlug') || '(none)';
  document.getElementById('settings-ws-path').textContent = store.get('wsPath') || '/ws';
  var pill = document.getElementById('skip-perms-pill');
  document.getElementById('settings-skip-perms').textContent = pill && !pill.classList.contains('hidden') ? 'Skip' : 'Permission checks';
}

function leaveServerSettings() {
  clearInterval(store.get('serverSettingsStatsTimer'));
  store.set({ serverSettingsAuthorized: false });
}

export function initServerSettings() {
  if (!root()) return;
  initNetworkSettings(); initServerControls(); initServerEnvironment(); initStorageUsage(); initAccountAuthSettings();
  registerSettingsScope('server', {
    pane: root(),
    enter: enterServerSettings,
    activate: selectPage,
    leave: leaveServerSettings,
    leavePrompt: function (kind) {
      if (!hasSettingsDrafts() || kind === 'page' || kind === 'project') return null;
      if (kind === 'close') return { message: 'You have unsaved changes. Closing keeps these drafts in this tab, but reloading the page will lose them.', action: 'Close with drafts' };
      return { message: 'Your server settings drafts will remain in this tab while you visit another settings area.', action: 'Leave Server settings' };
    }
  });
  new MutationObserver(function () { enhanceSettingsSelects(root()); }).observe(root(), { childList: true, subtree: true });
}

export function updateSettingsStats(data) {
  if (!isSettingsOpen()) return;
  var values = { pid: data.pid, uptime: Math.floor(data.uptime / 3600) + 'h ' + Math.floor(data.uptime % 3600 / 60) + 'm', rss: (data.memory.rss / 1048576).toFixed(1) + ' MB', sessions: data.sessions, clients: data.clients };
  Object.keys(values).forEach(function (key) { var el = document.getElementById('settings-status-' + key); if (el) el.textContent = String(values[key]); });
}
