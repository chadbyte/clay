import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';
import { mcpPermissionModeApplicability, sendMcpPermissionMode } from './mcp-permissions.js';

var labels = { ready: 'Ready', idle: 'Saved · connects when used', connecting: 'Connecting…', auth_required: 'Sign-in required', unavailable: 'Unavailable' };
function text(value) { return escapeHtml(String(value || '')); }
function button(label, action, primary, icon) {
  return '<button type="button" class="mc-button' + (primary ? ' mc-primary' : '') + '" data-action="' + action + '">' + (icon ? iconHtml(icon) : '') + text(label) + '</button>';
}
function heading(title, subtitle, icon) {
  return '<div class="mc-heading">' + (icon ? '<span class="mc-emblem">' + iconHtml(icon) + '</span>' : '') + '<h2 tabindex="-1">' + text(title) + '</h2><p>' + text(subtitle) + '</p></div>';
}
function status(row) { return '<span class="mc-status" data-status="' + text(row.status) + '"><span aria-hidden="true"></span>' + text(labels[row.status] || 'Unavailable') + '</span>'; }
function switchControl(row, busy) {
  return '<button type="button" class="mc-switch" role="switch" aria-checked="' + !!row.projectEnabled + '" aria-label="Enable ' + text(row.label || row.name) + ' in this project" data-toggle="' + text(row.id) + '"' + (busy ? ' disabled' : '') + '><span></span></button>';
}
function rows(servers, busy) {
  return '<div class="mc-list">' + servers.map(function (row) {
    return '<div class="mc-row"><button type="button" class="mc-row-open" data-open="' + text(row.id) + '"><span class="mc-server-icon">' + iconHtml(row.source === 'url' ? 'globe' : 'monitor') + '</span><span class="mc-row-info"><strong>' + text(row.label || row.name) + '</strong><span>' + (row.source === 'url' ? 'Remote' : 'Your computer') + ' · ' + row.toolCount + ' tools</span>' + status(row) + '</span></button>' + switchControl(row, busy) + '</div>';
  }).join('') + '</div>';
}
function search(value, placeholder) { return '<label class="mc-search">' + iconHtml('search') + '<input type="search" data-search value="' + text(value) + '" placeholder="' + placeholder + '" aria-label="' + placeholder + '"></label>'; }
function listView(state) {
  if (!state.loaded) return heading('Your connections', 'Loading your MCP servers…', 'cable');
  if (!state.servers.length) return '<div class="mc-empty">' + heading('Connect tools to Clay', 'Let your agent work with the services and tools you choose.', 'cable') + button('Add connection', 'add', true, 'plus') + '<p>Connect a remote service or tools on your computer.</p></div>';
  var servers = state.servers.filter(function (row) { return (row.label || row.name).toLowerCase().includes((state.search || '').toLowerCase()); });
  return search(state.search, 'Search servers…') + '<div class="mc-section-heading"><h2>Your connections</h2>' + button('Add', 'add', false, 'plus') + '</div>' + rows(servers, !!state.pending) + (!servers.length ? '<p class="mc-muted">No matching connections.</p>' : '') + '<p class="mc-footnote">Enabled connections are available to your private sessions in this project. In multi-user Clay, shared conversations cannot use personal connections.</p>';
}
function addView() {
  return heading('Add connection', 'Choose where your tools are available.') + '<div class="mc-choices">' +
    '<button class="mc-choice" data-action="remote"><span class="mc-choice-icon">' + iconHtml('globe') + '</span><span><strong>Remote MCP URL</strong><small>Connect a hosted service using its MCP server address.</small></span>' + iconHtml('arrow-right') + '</button>' +
    '<button class="mc-choice" data-action="computer"><span class="mc-choice-icon">' + iconHtml('monitor') + '</span><span><strong>On your computer</strong><small>Connect local tools through the Clay browser extension.</small></span>' + iconHtml('arrow-right') + '</button></div>';
}
function remoteView(state) {
  return heading('Connect a remote server', 'Use the MCP address supplied by your service provider.', 'globe') +
    '<form data-form="remote" class="mc-form"><label>Server URL<input name="url" type="url" required maxlength="4096" placeholder="https://mcp.example.com/mcp" value="' + text(store.get('mcpConnectionDraft')) + '" autocomplete="off" spellcheck="false"></label>' +
    '<p class="mc-muted">Public HTTPS servers are supported. You can sign in with Clay’s private browser if the service requires it.</p><button class="mc-button mc-primary" type="submit"' + (state.pending ? ' disabled' : '') + '>' + (state.pending ? 'Checking server…' : 'Continue') + '</button></form>';
}
function computerView(state) {
  var servers = state.servers.filter(function (row) { return row.source === 'computer'; });
  var command = 'npx clay-mcp-bridge install ' + (state.extensionId || '<extension-id>');
  return heading('Tools on your computer', 'Your local tools connect through the Clay extension.', 'monitor') +
    '<ol class="mc-steps"><li><span class="mc-step-marker">' + (state.extensionConnected ? iconHtml('check') : '1') + '</span><div><strong>Browser extension</strong><p>' + (state.extensionConnected ? 'Connected to this browser.' : 'Install Clay for Chrome, then refresh this page.') + '</p>' + (!state.extensionConnected ? button('Set up extension', 'setup', false, 'puzzle') : '') + '</div></li>' +
    '<li><span class="mc-step-marker">' + (state.hostConnected ? iconHtml('check') : '2') + '</span><div><strong>Local bridge</strong><p>' + (state.hostConnected ? 'Connected to your computer.' : 'Run this command on your computer, then restart your browser.') + '</p>' + (!state.hostConnected ? '<div class="mc-command"><code>' + text(command) + '</code>' + button('Copy', 'copy', false) + '</div>' : '') + '</div></li>' +
    '<li><span class="mc-step-marker">3</span><div><strong>Choose your tools</strong><p>Add servers from the extension popup. They appear here when connected.</p></div></li></ol>' + rows(servers, !!state.pending) + button('Refresh connections', 'refresh', false, 'refresh-cw');
}
function permissionsView(row) {
  var current = store.snap(), availability = mcpPermissionModeApplicability(current);
  var selected = (current.mcpPermissionModeOverrides || {})[row.name] || '';
  var pending = Object.values(current.mcpPermissionModePendingByTarget || {}).some(function (item) { return item.serverName === row.name && item.sessionId === current.activeSessionId; });
  return '<div class="mc-permissions"><h3>Tool approvals</h3><p>Calls follow the active session’s permission policy. Enabling a connection does not automatically approve every action.</p><label>AI review<select data-permission' + (!availability.applicable || pending ? ' disabled' : '') + '>' +
    [['', 'Use session default'], ['auto', 'AI review'], ['default', 'Ask every time']].map(function (item) { return '<option value="' + item[0] + '"' + (selected === item[0] ? ' selected' : '') + '>' + item[1] + '</option>'; }).join('') + '</select></label>' + (!availability.applicable ? '<p class="mc-muted">' + text(availability.reason) + '</p>' : '') + '</div>';
}
function detailView(state, row) {
  var remote = row.source === 'url';
  var html = heading(row.label || row.name, remote ? 'Remote MCP connection' : 'Connected through your browser extension', remote ? 'globe' : 'monitor');
  html += status(row) + '<div class="mc-enable"><span>Enabled in this project</span>' + switchControl(row, !!state.pending) + '</div>';
  html += '<dl class="mc-metadata"><dt>Access</dt><dd>Your account only</dd><dt>' + (remote ? 'Server' : 'Location') + '</dt><dd>' + (remote ? text(row.url) : 'Your computer') + '</dd></dl>';
  if (row.error) html += '<div class="mc-alert" role="status">' + iconHtml('circle-alert') + '<span>' + text(row.error) + '</span></div>';
  if (remote && row.status === 'auth_required') html += '<div class="mc-auth">' + button('Sign in with Clay browser', 'signin', true, 'log-in') + '<p class="mc-muted">Only you can view and control this sign-in browser.</p></div>';
  if (remote) html += '<details class="mc-token"><summary>Use an access token</summary><form data-form="token" class="mc-form"><label>Access token<input name="token" type="password" required maxlength="8192" autocomplete="new-password" placeholder="Paste your access token"></label><button type="submit" class="mc-button">Save and connect</button></form></details>';
  html += '<div class="mc-detail-tabs" role="tablist" aria-label="Connection details"><button role="tab" data-tab="tools" aria-selected="' + (state.detailTab !== 'permissions') + '">Tools (' + row.toolCount + ')</button><button role="tab" data-tab="permissions" aria-selected="' + (state.detailTab === 'permissions') + '">Permissions</button></div>';
  if (state.detailTab === 'permissions') html += permissionsView(row);
  else {
    html += search(state.search, 'Search tools…');
    var tools = (row.tools || []).filter(function (tool) { return (tool.name + ' ' + (tool.description || '')).toLowerCase().includes((state.search || '').toLowerCase()); });
    html += '<div class="mc-tools">' + tools.map(function (tool) { return '<details><summary>' + text(tool.name) + '</summary><p>' + text(tool.description || 'No description provided.') + '</p><h4>Inputs</h4><pre>' + text(JSON.stringify(tool.inputSchema || {}, null, 2)) + '</pre></details>'; }).join('') + (!tools.length ? '<p class="mc-muted">' + (row.toolCount ? 'No matching tools.' : 'No tools available. Test the connection to refresh its catalog.') + '</p>' : '') + '</div>';
  }
  html += '<div class="mc-detail-actions">' + (remote ? button('Test connection', 'test', false, 'refresh-cw') + (row.status === 'auth_required' ? '' : button('Sign in again', 'signin', false, 'log-in')) : button('Computer setup', 'computer', false, 'monitor')) + '</div>';
  if (remote) html += '<details class="mc-manage"><summary>Manage connection</summary><form data-form="rename" class="mc-form"><label>Name<input name="label" required maxlength="100" value="' + text(row.label) + '"></label><button type="submit" class="mc-button">Save name</button></form>' + button('Remove connection', 'remove', false, 'trash-2') + '</details>';
  return html;
}
export function renderConnections(root, state, events) {
  var sameScreen = root.dataset.screenKey === (state.screen || 'list') + ':' + (state.selected || '');
  var disclosures = sameScreen ? Array.from(root.querySelectorAll('details[open]')).map(function (el) { return el.className || el.querySelector('summary').textContent; }) : [];
  var drafts = {};
  if (sameScreen) root.querySelectorAll('input[name]').forEach(function (el) { drafts[el.name] = el.value; });
  var focused = root.contains(document.activeElement) ? document.activeElement : null;
  var searchFocused = focused && focused.hasAttribute('data-search');
  var start = focused && focused.tagName === 'INPUT' ? focused.selectionStart : null;
  var focusedName = focused && focused.name;
  var row = state.servers.find(function (item) { return item.id === state.selected; });
  var screen = state.screen || 'list';
  var html = screen !== 'list' ? '<button type="button" class="mc-back" data-action="back">' + iconHtml('arrow-left') + 'MCP Servers</button>' : '';
  if (state.error) html += '<div class="mc-alert" role="alert">' + iconHtml('circle-alert') + '<span>' + text(state.error) + '</span></div>';
  if (state.notice) html += '<p class="mc-notice" role="status">' + text(state.notice) + '</p>';
  if (screen === 'add') html += addView();
  else if (screen === 'remote') html += remoteView(state);
  else if (screen === 'computer') html += computerView(state);
  else if (screen === 'remove' && row) html += heading('Remove ' + row.label + '?', 'This removes saved credentials and disables its tools in this project.') + '<div role="group" aria-label="Confirm removal">' + button('Cancel', 'cancel-remove', false) + button('Remove connection', 'confirm-remove', true, 'trash-2') + '</div>';
  else if (screen === 'detail' && row) html += detailView(state, row);
  else html += listView(state);
  if (state.pending && screen !== 'remote') html += '<p class="mc-working" role="status">' + iconHtml('loader-circle') + 'Updating connection…</p>';
  root.innerHTML = '<div class="mc-screen">' + html + '</div>';
  root.dataset.screenKey = screen + ':' + (state.selected || '');
  root.querySelectorAll('details').forEach(function (el) { el.open = disclosures.indexOf(el.className || el.querySelector('summary').textContent) >= 0; });
  root.querySelectorAll('input[name]').forEach(function (el) {
    if (Object.prototype.hasOwnProperty.call(drafts, el.name)) el.value = drafts[el.name];
    if (focusedName === el.name) { el.focus(); try { el.setSelectionRange(start, start); } catch (error) {} }
  });
  if (!sameScreen) { var title = root.querySelector('h2'); if (title) title.focus({ preventScroll: true }); }
  root.querySelectorAll('[data-action]').forEach(function (el) {
    var action = el.dataset.action;
    if (action === 'copy' && !state.extensionId) el.disabled = true;
    if (state.pending && ['signin', 'test', 'remove', 'confirm-remove'].includes(action)) el.disabled = true;
    el.onclick = function () {
      if (action === 'back') events.navigate('list');
      else if (['add', 'remote', 'computer'].includes(action)) events.navigate(action);
      else if (action === 'remove' && row) events.remove(row);
      else if (action === 'cancel-remove') events.navigate('detail', row.id);
      else if (action === 'confirm-remove') events.action('remove', { id: row.id });
      else if (action === 'refresh') events.refresh();
      else if (action === 'setup') events.setup();
      else if (action === 'copy') navigator.clipboard.writeText('npx clay-mcp-bridge install ' + (state.extensionId || '<extension-id>')).then(function () { el.textContent = 'Copied'; }).catch(function () { el.textContent = 'Select command to copy'; });
      else events.action(action);
    };
  });
  root.querySelectorAll('[data-open]').forEach(function (el) { el.onclick = function () { events.navigate('detail', el.dataset.open); }; });
  root.querySelectorAll('[data-toggle]').forEach(function (el) { el.onclick = function () { var item = state.servers.find(function (server) { return server.id === el.dataset.toggle; }); if (item) events.toggle(item, !item.projectEnabled); }; });
  root.querySelectorAll('[data-tab]').forEach(function (el) { el.onclick = function () { store.set({ mcpConnections: Object.assign({}, store.get('mcpConnections'), { detailTab: el.dataset.tab, search: '' }) }); }; });
  var input = root.querySelector('[data-search]');
  if (input) { input.oninput = function () { events.search(input.value); }; if (searchFocused) { input.focus(); try { input.setSelectionRange(start, start); } catch (error) {} } }
  var urlInput = root.querySelector('[name="url"]'); if (urlInput) urlInput.oninput = function () { events.draft(urlInput.value); };
  root.querySelectorAll('form').forEach(function (form) {
    form.onsubmit = function (event) {
      event.preventDefault(); if (state.pending) return;
      if (form.dataset.form === 'remote') events.action('add', { url: form.elements.url.value });
      if (form.dataset.form === 'token') { var token = form.elements.token.value; form.reset(); events.action('token', { token: token }); }
      if (form.dataset.form === 'rename') events.action('rename', { label: form.elements.label.value });
    };
  });
  var permission = root.querySelector('[data-permission]');
  if (permission) permission.onchange = function () { sendMcpPermissionMode(store.get('currentSlug'), store.get('activeSessionId'), row.name, permission.value); };
  refreshIcons(root);
}
