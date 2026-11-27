import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';

function button(label, action, primary, disabled) {
  return '<button type="button" class="mc-button' + (primary ? ' mc-primary' : '') + '" data-xcode="' + action + '"' + (disabled ? ' disabled' : '') + '>' + label + '</button>';
}
export function renderXcode(root, state, events) {
  var focused = root.contains(document.activeElement) && document.activeElement.dataset.xcode;
  var open = Array.from(root.querySelectorAll('details[open]')).map(function (item) { return item.dataset.tool; });
  var row = (state.servers || []).find(function (item) { return item.integration === 'xcode'; });
  var check = state.xcode, busy = !!state.pending;
  var connected = !!(row && row.projectEnabled), ready = row && row.status === 'ready';
  var status = connected ? ready ? 'Connected' : row.status === 'unavailable' ? 'Connection unavailable' : 'Enabled · connects when used' : 'Not connected';
  var html = '<div class="mc-xcode"><div class="mc-heading"><span class="mc-emblem">' + iconHtml('hammer') + '</span><h2>Xcode</h2><p>Build and test your Apple apps from your Clay Studio conversations.</p></div>';
  html += '<p class="mc-status" data-status="' + (connected && ready ? 'ready' : 'idle') + '"><span aria-hidden="true"></span>' + status + '</p>';
  html += '<p class="mc-footnote">Xcode must run on the same Mac and under the same macOS user as the Clay Studio server.</p>';
  var steps = '<ol class="mc-steps mc-xcode-steps"><li><span class="mc-step-marker">1</span><div><strong>Open your project in Xcode</strong><p>Keep Xcode open while your agent uses its tools.</p></div></li><li><span class="mc-step-marker">2</span><div><strong>Allow external agents</strong><p>In Xcode Settings → Intelligence, turn on “Allow external agents to use Xcode tools”. Approve Clay’s connection in Xcode if asked.</p></div></li><li><span class="mc-step-marker">3</span><div><strong>Connect to Clay Studio</strong><p>No commands, vendor configuration, or browser extension required.</p></div></li></ol>';
  html += connected ? '<details class="mc-manage" data-tool="setup"' + (open.includes('setup') ? ' open' : '') + '><summary>Setup instructions</summary>' + steps + '</details>' : steps;
  if (check && (!connected || !check.ready)) html += '<p class="mc-notice" role="status">' + escapeHtml(check.message) + '</p>';
  if (state.error) html += '<p class="mc-alert" role="alert">' + escapeHtml(state.error) + '</p>';
  if (row && row.error && row.error !== state.error) html += '<p class="mc-alert" role="status">' + escapeHtml(row.error) + '</p>';
  if (state.notice) html += '<p class="mc-notice" role="status">' + escapeHtml(state.notice) + '</p>';
  html += '<div class="mc-detail-actions">' + button(connected ? 'Reconnect Xcode' : 'Connect Xcode', 'connect', true, busy || !state.loaded || !!(check && !check.ready)) + button('Check again', 'check', false, busy) + (busy && state.pending.action === 'xcode_connect' ? button('Cancel connection', 'disconnect', false, false) : connected ? button('Disconnect', 'disconnect', false, false) : row ? button('Remove connection', 'remove', false, busy) : '') + '</div>';
  if (busy) html += '<p class="mc-working" role="status">' + iconHtml('loader-circle') + (state.pending.action === 'xcode_check' ? 'Checking this Mac…' : 'Updating connection…') + '</p>';
  if (row && row.tools && row.tools.length) {
    html += '<div class="mc-section-heading"><h2>Available tools (' + row.tools.length + ')</h2></div><div class="mc-tools">';
    html += row.tools.map(function (tool) { return '<details data-tool="' + escapeHtml(tool.name) + '"' + (open.includes(tool.name) ? ' open' : '') + '><summary>' + escapeHtml(tool.name) + '</summary><p>' + escapeHtml(tool.description || 'No description provided.') + '</p></details>'; }).join('') + '</div>';
  }
  html += '<p class="mc-footnote">Connect enables these tools for your supported private sessions and Mates. Tools become available on the next turn; some runtimes need a new session. Your session’s tool approval policy still applies. Disconnect blocks further calls but cannot undo work already performed in Xcode.</p></div>';
  root.innerHTML = html;
  root.querySelectorAll('[data-xcode]').forEach(function (element) {
    element.onclick = function () {
      var action = element.dataset.xcode;
      if (action === 'connect') events.action('xcode_connect');
      if (action === 'check') events.action('xcode_check');
      if (action === 'disconnect') events.disconnect();
      if (action === 'remove' && row) events.action('remove', { id: row.id });
    };
  });
  if (focused) { var target = root.querySelector('[data-xcode="' + focused + '"]'); if (target && !target.disabled) target.focus({ preventScroll: true }); }
  refreshIcons(root);
}
