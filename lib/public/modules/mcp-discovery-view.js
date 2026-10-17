import { escapeHtml } from './utils.js';
import { iconHtml } from './icons.js';
function text(value) { return escapeHtml(String(value || '')); }
export function discoveryView(state) {
  var discovery = state.discovery || {}, pending = !!state.pending;
  var draft = state.sourceDraft || {};
  var vendors = { claude: 'Claude Code', codex: 'Codex', kiro: 'Kiro', opencode: 'OpenCode', kimi: 'Kimi Code', copilot: 'GitHub Copilot', qwen: 'Qwen Code', junie: 'Junie', grok: 'Grok', antigravity: 'Antigravity', acp: 'ACP' };
  var options = Object.keys(vendors).map(function (key) { return '<option value="' + key + '"' + ((draft.vendor || 'claude') === key ? ' selected' : '') + '>' + vendors[key] + '</option>'; }).join('');
  var html = '<div class="mc-heading"><h2 tabindex="-1">Import vendor connections</h2><p>Inspect MCP configurations on the Clay server. Import saves a disabled copy for your account; enabling or testing can start its command or contact its service.</p></div>' +
    '<button type="button" class="mc-button" data-action="discover"' + (pending ? ' disabled' : '') + '>' + iconHtml('refresh-cw') + 'Scan vendor configurations</button>' +
    '<details class="mc-manage"><summary>Configured source file</summary><form data-form="discovery" class="mc-form"><label>Vendor format<select name="vendor" aria-label="Vendor format">' + options + '</select></label><label>Absolute config path<input name="file" value="' + text(draft.file) + '" required placeholder="/home/you/agent/mcp.json" maxlength="4096"></label><button type="submit" class="mc-button"' + (pending ? ' disabled' : '') + '>Inspect source</button></form></details>';
  if (!discovery.scanId) return html + '<p class="mc-muted">Vendor OAuth tokens stay with their vendor. Use Clay sign-in or enter credentials after importing.</p>';
  html += '<div class="mc-list">' + (discovery.candidates || []).map(function (row) {
    return '<div class="mc-row"><span class="mc-row-info"><strong>' + text(row.name) + '</strong><span>' + text(row.vendor + ' · ' + row.scope + ' · ' + row.transport) + '</span><small>' + text(row.file) + '</small><small>' + text('Dependency: ' + row.dependency) + '</small>' +
      (row.references.length ? '<small>Requires: ' + text(row.references.join(', ')) + '</small>' : '') +
      (row.blocked ? '<small>' + text(row.blocked) + '</small>' : '') +
      (row.pluginVersion ? '<small>Plugin version: ' + text(row.pluginVersion) + '</small>' : '') +
      (row.conflict ? '<small>Different definitions use this name. Import the source you intend to use.</small>' : row.duplicate ? '<small>Matching definition found in another source.</small>' : '') +
      '<small>' + (row.sourceEnabled === true ? 'Enabled in source' : row.sourceEnabled === false ? 'Disabled in source' : 'Source enablement unknown') + ' · imports disabled</small></span><button class="mc-button" type="button" data-import="' + text(row.id) + '"' + (pending || row.imported || row.blocked ? ' disabled' : '') + '>' + (row.imported ? 'Imported' : row.blocked ? 'Blocked' : 'Import') + '</button></div>';
  }).join('') + '</div>';
  if (!(discovery.candidates || []).length) html += '<p class="mc-muted">No supported MCP definitions found.</p>';
  html += (discovery.diagnostics || []).map(function (item) { return '<p class="mc-muted">' + text(item.vendor + ' · ' + item.scope + (item.name ? ' · ' + item.name : '') + ': ' + item.message) + '</p>'; }).join('');
  return html;
}
export function credentialsView(row) {
  if (!row.references || !row.references.length) return '';
  if (row.references.indexOf('Unsupported reference') >= 0) return '<p class="mc-muted">This definition needs a vendor-specific helper or file reference. Configure a direct Clay connection instead.</p>';
  return '<details class="mc-token"><summary>Required credentials</summary><form data-form="credentials" class="mc-form">' + row.references.map(function (name) {
    return '<label>' + text(name) + '<input type="password" name="' + text(name) + '" required maxlength="8192" autocomplete="new-password"></label>';
  }).join('') + '<button type="submit" class="mc-button">Save credentials</button></form></details>';
}
