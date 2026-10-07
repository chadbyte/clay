import { ensureMcpSkillsWorkbench, openMcpSkillsWorkbench, closeMcpSkillsWorkbench } from './mcp-skills-workbench.js';
import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { renderConnections } from './mcp-connection-view.js';
export { clearMcpPermissionModePending, mcpPermissionModeApplicability, sendMcpPermissionMode, handleMcpPermissionModeResult } from './mcp-permissions.js';

function state() { return store.get('mcpConnections') || { screen: 'list', servers: [], search: '' }; }
function patch(value) { store.set({ mcpConnections: Object.assign({}, state(), value) }); }
function send(message) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { patch({ error: 'Reconnect to Clay to manage connections.' }); return false; }
  ws.send(JSON.stringify(message)); return true;
}
function requestState() { send({ type: 'mcp_state_request' }); }
function clearActionTimer() { var timer = store.get('mcpActionTimer'); if (timer) clearTimeout(timer); store.set({ mcpActionTimer: null }); }
function navigate(screen, id) { patch({ screen: screen, selected: id || null, error: '', notice: '', search: '', detailTab: 'tools' }); }
function action(name, args) {
  if (state().pending) return;
  var requestId = crypto.randomUUID();
  patch({ pending: { requestId: requestId, action: name }, error: '', notice: '' });
  clearActionTimer();
  store.set({ mcpActionTimer: setTimeout(function () {
    if (state().pending && state().pending.requestId === requestId) { patch({ pending: null, error: 'The server is taking longer than expected. Refresh connections to check its state.' }); requestState(); }
  }, 90000) });
  if (!send(Object.assign({ type: 'mcp_connection_action', action: name, requestId: requestId, id: state().selected }, args || {}))) { clearActionTimer(); patch({ pending: null }); }
}
function toggle(row, value) {
  if (row.source === 'url') action('enable', { id: row.id, enabled: value });
  else send({ type: 'mcp_toggle_server', name: row.name, enabled: value });
}
function render() {
  var element = document.getElementById('mcp-content');
  if (!element) return;
  var current = state();
  var extension = document.getElementById('ext-pill-wrap');
  if (extension) extension.hidden = current.screen !== 'computer';
  renderConnections(element, current, {
    navigate: navigate, action: action, toggle: toggle,
    search: function (value) { patch({ search: value }); },
    draft: function (value) { store.set({ mcpConnectionDraft: value }); },
    refresh: requestState,
    setup: function () { var button = document.getElementById('ext-pill'); if (button) button.click(); },
    remove: function (row) { navigate('remove', row.id); },
  });
}
function badge() {
  var count = state().servers.filter(function (row) { return row.projectEnabled; }).length;
  ['mcp-sidebar-count', 'mate-mcp-sidebar-count'].forEach(function (id) { var el = document.getElementById(id); if (el) { el.textContent = String(count); el.classList.toggle('hidden', !count); } });
}
export function initMcp() {
  ensureMcpSkillsWorkbench();
  ['mcp-btn', 'mate-mcp-btn'].forEach(function (id) { var button = document.getElementById(id); if (button) button.addEventListener('click', function () { openMcpSkillsWorkbench('mcp'); requestState(); render(); }); });
  var close = document.getElementById('mcp-modal-close'); if (close) close.onclick = closeMcpSkillsWorkbench;
  store.subscribe(function (current, previous) {
    if (current.currentSlug !== previous.currentSlug || current.myUserId !== previous.myUserId) {
      clearActionTimer();
      store.set({ mcpConnections: { screen: 'list', servers: [], search: '', loaded: false }, mcpConnectionDraft: '' }); return;
    }
    if (current.connected !== previous.connected) {
      if (current.connected) requestState();
      else { clearActionTimer(); patch({ pending: null, error: 'Connection lost. Reconnect to manage your servers.' }); }
    }
    if (current.mcpConnections !== previous.mcpConnections || current.mcpSkillsWorkbench !== previous.mcpSkillsWorkbench || current.activeSessionId !== previous.activeSessionId || current.mcpPermissionModeOverrides !== previous.mcpPermissionModeOverrides || current.permissionCapabilities !== previous.permissionCapabilities || current.effectivePermissionMode !== previous.effectivePermissionMode || current.mcpPermissionModePendingByTarget !== previous.mcpPermissionModePendingByTarget) { render(); badge(); }
  });
  render();
}
export function handleMcpServersState(msg) {
  if (msg.slug && msg.slug !== store.get('currentSlug')) return;
  patch({ servers: msg.servers || [], loaded: true, extensionConnected: !!msg.extensionConnected, hostConnected: !!msg.hostConnected, extensionId: msg.extensionId || null });
}
export function setExtensionConnected(value) { patch({ extensionConnected: !!value }); }
export function getMcpServers() { return state().servers; }
export function handleMcpConnectionMessage(msg) {
  if (msg.slug && msg.slug !== store.get('currentSlug')) return false;
  if (msg.type === 'mcp_action_result') {
    var pending = state().pending;
    if (msg.requestId && (!pending || msg.requestId !== pending.requestId)) return true;
    clearActionTimer();
    patch({ pending: null, error: msg.ok ? '' : msg.error || 'Could not update connection.' });
    if (msg.ok && msg.action === 'add') { store.set({ mcpConnectionDraft: '' }); navigate('detail', msg.id); }
    if (msg.ok && msg.action === 'remove') navigate('list');
    if (msg.ok && msg.action === 'enable') patch({ notice: 'Saved. Tool availability updates on the next turn; some runtimes may need a new session.' });
    return true;
  }
  if (msg.type === 'mcp_login_ready') {
    import('./vendor-login-browser.js').then(function (viewer) { if (msg.slug && msg.slug !== store.get('currentSlug')) return; viewer.openLoginBrowser(Object.assign({}, msg, { kind: 'mcp', vendor: 'mcp' })); }); return true;
  }
  if (msg.type === 'mcp_login_browser_frame' || msg.type === 'mcp_login_browser_status') {
    import('./vendor-login-browser.js').then(function (viewer) { viewer.handleLoginBrowserMessage(Object.assign({}, msg, { type: msg.type.replace('mcp_login_', 'vendor_login_') })); }); return true;
  }
  if (msg.type === 'mcp_login_closed') {
    var view = store.get('vendorLoginBrowser');
    if (view && view.kind === 'mcp' && view.browserId === msg.browserId) import('./vendor-login-browser.js').then(function (viewer) { var live = store.get('vendorLoginBrowser'); if (live && live.browserId === msg.browserId) viewer.closeLoginBrowser(); });
    return true;
  }
  return false;
}
