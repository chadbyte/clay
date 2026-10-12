import { initStorageUsage, loadStorageUsage } from './server-storage-settings.js';
import { initAccountAuthSettings, loadAccountAuthSettings } from './account-auth-settings.js';
// Full-app server administration shell. Page state survives navigation and closing.
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { refreshIcons } from './icons.js';
import { closeFileViewer } from './filebrowser.js';
import { checkAdminAccess, loadAdminSection } from './admin.js';
import { openUserSettings } from './user-settings.js';
import { initNetworkSettings, loadNetworkSettings } from './server-network-settings.js';
import { initServerControls, setServerPinAvailability } from './server-settings-controls.js';
import { initServerEnvironment, loadSharedEnv } from './server-settings-environment.js';
import { renderSettingsNavigation } from './server-settings-navigation.js';
import { hasSettingsDrafts, confirmSettingsAction, trapSettingsFocus } from './server-settings-state.js';
import { enhanceSettingsSelects } from './settings-select.js';
export { updateDaemonConfig, handleSetPinResult, handleKeepAwakeChanged, handleAutoContinueChanged, handleRestartResult, handleShutdownResult, handleServerSettingResult } from './server-settings-controls.js';
export { handleSharedEnv, handleSharedEnvSaved } from './server-settings-environment.js';

function isolateSettings(active) {
  if (active) {
    var entries = Array.from(document.body.children).filter(function (el) { return el !== root() && el.id !== 'confirm-modal' && el.tagName !== 'SCRIPT' && el.tagName !== 'STYLE'; }).map(function (el) { var entry = { el: el, inert: el.inert, hidden: el.getAttribute('aria-hidden') }; el.inert = true; el.setAttribute('aria-hidden', 'true'); return entry; });
    store.set({ serverSettingsInert: entries });
  } else {
    (store.get('serverSettingsInert') || []).forEach(function (entry) { entry.el.inert = entry.inert; if (entry.hidden === null) entry.el.removeAttribute('aria-hidden'); else entry.el.setAttribute('aria-hidden', entry.hidden); });
    store.set({ serverSettingsInert: [] });
  }
}
function root() { return document.getElementById('server-settings'); }
export function isSettingsOpen() { return root() && !root().classList.contains('hidden'); }
function send(type) { var ws = getWs(); if (ws && ws.readyState === 1) ws.send(JSON.stringify({ type: type })); }

function selectPage(id, focus) {
  if (!store.get('serverSettingsAuthorized')) return;
  if (id === 'admin-invites') id = 'admin-users';
  var nav = document.getElementById('settings-page-nav');
  if (!nav.querySelector('[data-section="' + id + '"]')) id = 'overview';
  store.set({ serverSettingsPage: id });
  root().querySelectorAll('.server-settings-section').forEach(function (page) { page.classList.toggle('active', page.dataset.section === id); });
  nav.querySelectorAll('button').forEach(function (button) {
    button.classList.toggle('active', button.dataset.section === id);
    if (button.dataset.section === id) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  document.getElementById('settings-nav-dropdown').value = id;
  if (id === 'network') loadNetworkSettings();
  if (id === 'security') loadAccountAuthSettings();
  if (id === 'storage') loadStorageUsage();
  if (id === 'environment') loadSharedEnv();
  if (id.indexOf('admin-') === 0) {
    var body = document.getElementById(id + '-body');
    if (id !== 'admin-smtp' || !(store.get('serverSettingsDrafts') || {}).smtp) loadAdminSection(id, body);
  }
  if (focus) {
    var heading = root().querySelector('.server-settings-section.active h2');
    heading.tabIndex = -1; heading.focus();
  }
}

async function openSettings() {
  if (isSettingsOpen()) return;
  closeFileViewer();
  isolateSettings(true);
  store.set({ serverSettingsReturnFocus: document.activeElement });
  root().classList.remove('hidden');
  document.getElementById('server-settings-btn').classList.add('active');
  document.getElementById('server-settings-close').focus();
  var status = document.getElementById('settings-access-status');
  status.textContent = 'Checking administrator access…';
  store.set({ serverSettingsAuthorized: false });
  var serverPinSection = document.getElementById('settings-server-pin');
  if (serverPinSection) serverPinSection.hidden = true;
  root().querySelectorAll('.server-settings-section').forEach(function (page) { page.classList.remove('active'); });
  try {
    var response = await fetch('/api/me', { credentials: 'same-origin' });
    if (!response.ok) throw new Error('Could not verify access. Close and reopen Settings to retry.');
    var data = await response.json();
    if (data.multiUser && (!data.user || data.user.role !== 'admin')) {
      status.textContent = 'Server settings require an administrator. Your personal preferences are available below.';
      document.getElementById('settings-page-nav').replaceChildren();
      document.getElementById('settings-nav-dropdown').replaceChildren();
      return;
    }
    await checkAdminAccess();
    if (!isSettingsOpen()) return;
    store.set({ serverSettingsAuthorized: true });
    setServerPinAvailability(!data.multiUser);
    status.textContent = '';
    renderSettingsNavigation(!!data.multiUser, selectPage);
    selectPage(store.get('serverSettingsPage') || 'overview', false);
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
    enhanceSettingsSelects(root()); refreshIcons(root());
  } catch (error) { status.textContent = error.message; }
}

function closeSettings() {
  function close() {
    isolateSettings(false);
    root().classList.add('hidden');
    document.getElementById('server-settings-btn').classList.remove('active');
    clearInterval(store.get('serverSettingsStatsTimer'));
    var previous = store.get('serverSettingsReturnFocus');
    if (previous && previous.isConnected) previous.focus();
  }
  if (hasSettingsDrafts()) confirmSettingsAction('You have unsaved changes. Closing keeps these drafts in this tab, but reloading the page will lose them.', 'Close with drafts', close);
  else close();
}

export function initServerSettings() {
  if (!root()) return;
  initNetworkSettings(); initServerControls(); initServerEnvironment(); initStorageUsage(); initAccountAuthSettings();
  document.getElementById('server-settings-btn').addEventListener('click', openSettings);
  document.getElementById('server-settings-close').onclick = closeSettings;
  document.getElementById('settings-personal-link').onclick = function () {
    function openPersonal() { isolateSettings(false); document.getElementById('server-settings-btn').classList.remove('active'); root().classList.add('hidden'); clearInterval(store.get('serverSettingsStatsTimer')); openUserSettings('us-notifications'); }
    if (hasSettingsDrafts()) confirmSettingsAction('Your server settings drafts will remain in this tab while you visit Personal settings.', 'Open Personal settings', openPersonal);
    else openPersonal();
  };
  document.addEventListener('keydown', function (event) {
    if (!isSettingsOpen() || document.querySelector('.admin-modal-overlay, #settings-confirm, .confirm-above-settings')) return;
    if (event.key === 'Escape') { event.preventDefault(); closeSettings(); }
    trapSettingsFocus(event, root());
  });
  new MutationObserver(function () { enhanceSettingsSelects(root()); }).observe(root(), { childList: true, subtree: true });
}

export function updateSettingsStats(data) {
  if (!isSettingsOpen()) return;
  var values = { pid: data.pid, uptime: Math.floor(data.uptime / 3600) + 'h ' + Math.floor(data.uptime % 3600 / 60) + 'm', rss: (data.memory.rss / 1048576).toFixed(1) + ' MB', sessions: data.sessions, clients: data.clients };
  Object.keys(values).forEach(function (key) { var el = document.getElementById('settings-status-' + key); if (el) el.textContent = String(values[key]); });
}
