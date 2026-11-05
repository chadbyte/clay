import { store } from './store.js';

function node(tag, text, className) { var el = document.createElement(tag); if (text) el.textContent = text; if (className) el.className = className; return el; }
function action(text, fn) { var el = node('button', text, 'settings-btn-sm'); el.type = 'button'; el.onclick = fn; return el; }
async function request(slug, revision) {
  var response = await fetch('/api/project-settings/' + encodeURIComponent(slug) + '/ownership', {
    method: revision ? 'POST' : 'GET', credentials: 'same-origin', signal: AbortSignal.timeout(10000),
    headers: { 'Content-Type': 'application/json' }, body: revision ? JSON.stringify({ revision: revision }) : undefined
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
    if (result.owner) root.appendChild(node('p', (result.status === 'ready' ? 'Verified recovery owner: ' : 'Owner: ') + result.owner.name));
    var controls = node('div', '', 'settings-form-actions'); controls.appendChild(action('Check again', check));
    if (result.status === 'ready') controls.appendChild(action('Review recovery', function () {
      if (!current()) return;
      var review = node('div', '', 'ownership-review');
      review.appendChild(node('p', 'Restore ' + slug + ' to ' + result.owner.name + '? This updates the parent and all its worktrees. Private session ownership stays unchanged.'));
      review.append(action('Cancel', function () { render(result); }), action('Recover ownership', async function () {
        if (!current()) return;
        root.replaceChildren(status('Recovering ownership…'));
        try {
          var saved = await request(slug, result.revision);
          if (current()) root.replaceChildren(status('Ownership recovered for ' + saved.owner.name + '.'), action('Reload project', function () { location.assign('/p/' + encodeURIComponent(slug) + '/'); }));
        } catch (error) {
          if (current()) root.replaceChildren(status(error.message + ' The result may be unknown if the connection was interrupted. Check the saved ownership before another review.'), action('Check again', check));
        }
      }));
      root.appendChild(review); review.querySelector('button').focus();
    }));
    root.appendChild(controls);
    if (result.status !== 'healthy') {
      var help = node('details'); help.appendChild(node('summary', 'Server operator instructions'));
      help.appendChild(node('p', 'On the system running Clay Studio, verify the original project directory, its filesystem owner, and the original account’s provisioned system user and home. Restore missing accounts or mounts through your normal server provisioning process. Resolve shared UIDs, overlapping homes or symlink aliases before checking again.'));
      help.appendChild(node('p', 'Application administrator status cannot prove private project ownership. Do not assign an arbitrary account or change filesystem ownership just to pass this check.'));
      help.appendChild(action('Copy diagnostic summary', function () {
        navigator.clipboard.writeText(JSON.stringify({ project: slug, status: result.status, code: result.code, message: result.message }, null, 2)).then(function () { if (current()) help.appendChild(status('Diagnostic summary copied.')); }, function () { if (current()) help.appendChild(status('Copy unavailable. Select the diagnostic text above.')); });
      })); root.appendChild(help);
    }
  }
  check();
}
