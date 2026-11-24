import { store } from './store.js';

function node(tag, text, className) { var el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
function action(text, fn) { var el = node('button', text, 'settings-btn-sm'); el.type = 'button'; el.onclick = fn; return el; }
async function request(slug, data) {
  var response = await fetch('/api/project-settings/' + encodeURIComponent(slug) + '/ownership', {
    method: data ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined
  });
  var result = await response.json(); if (!response.ok) throw new Error(result.error || 'Recovery check failed.'); return result;
}
export function mountOwnershipRecovery(root, slug) {
  var key = root.id, token = crypto.randomUUID();
  var panels = Object.assign({}, store.get('ownershipRecoveryPanels'));
  panels[key] = { slug: slug, token: token }; store.set({ ownershipRecoveryPanels: panels });
  function current() { var item = (store.get('ownershipRecoveryPanels') || {})[key]; return root.isConnected && item && item.token === token; }
  function status(text) { var el = node('p', text, 'settings-status'); el.setAttribute('role', 'status'); return el; }
  async function check() {
    if (!current()) return;
    root.replaceChildren(status('Checking ownership…'));
    try { var result = await request(slug); if (current()) render(result); }
    catch (error) { if (current()) root.replaceChildren(status(error.message), action('Check again', check)); }
  }
  function render(result) {
    root.replaceChildren(node('h3', result.status === 'healthy' ? 'Ownership verified' : 'Ownership recovery'), status(result.message));
    root.appendChild(node('p', 'Checked ' + new Date(result.checkedAt).toLocaleTimeString() + '. Recovery keeps session owners and sharing unchanged.', 'settings-hint'));
    if (result.owner) root.appendChild(node('p', (result.status === 'ready' ? 'Proposed recovery owner: ' : 'Owner: ') + result.owner.name));
    var controls = node('div', '', 'settings-form-actions'); controls.appendChild(action('Check again', check));
    if (result.status === 'ready') controls.appendChild(action('Recover ownership', async function () {
      if (!current()) return;
      root.replaceChildren(status('Recovering ownership…'));
      try {
        var saved = await request(slug, { revision: result.revision });
        if (!saved.ok || !saved.persisted || saved.status !== 'recovered' || !saved.owner || saved.owner.id !== result.owner.id) throw new Error(saved.error || 'Recovery was not confirmed. Check the saved ownership.');
        if (current()) root.replaceChildren(status('Ownership recovered for ' + saved.owner.name + '.'), action('Reload project', function () { location.assign('/p/' + encodeURIComponent(slug) + '/'); }));
      } catch (error) {
        if (current()) root.replaceChildren(status(error.message + ' The result may be unknown if the connection was interrupted. Check the saved ownership before trying again.'), action('Check again', check));
      }
    }));
    root.appendChild(controls);
    if (result.status !== 'healthy') {
      var help = node('details'); help.appendChild(node('summary', 'Directory and account diagnostics'));
      help.appendChild(node('p', 'On the system running Clay Studio, verify the original project directory, its filesystem owner, and the original account’s provisioned system user and home. Restore missing accounts or mounts through your normal server provisioning process. Resolve shared UIDs, overlapping homes or symlink aliases before checking again.'));
      help.appendChild(node('p', 'OS-isolated servers require verified system identities. Repair the original mapping or directory access before checking again; recovery does not change filesystem ownership.'));
      help.appendChild(action('Copy diagnostic summary', function () {
        navigator.clipboard.writeText(JSON.stringify({ project: slug, status: result.status, code: result.code, message: result.message }, null, 2)).then(function () { if (current()) help.appendChild(status('Diagnostic summary copied.')); }, function () { if (current()) help.appendChild(status('Copy unavailable. Select the diagnostic text above.')); });
      })); root.appendChild(help);
    }
  }
  check();
}
