import { enhanceSettingsSelects } from './settings-select.js';
import { store } from './store.js';
import { openSettings } from './settings-shell.js';
import { mountOwnershipRecovery } from './project-ownership-recovery.js';
import { confirmSettingsAction } from './server-settings-state.js';

function node(tag, text, className) { var el = document.createElement(tag); el.textContent = text || ''; if (className) el.className = className; return el; }
function button(text, fn) { var el = node('button', text, 'settings-btn-sm'); el.type = 'button'; el.onclick = fn; return el; }
async function request(slug, suffix, data) {
  var response = await fetch('/api/admin/projects/' + encodeURIComponent(slug) + '/' + suffix, { credentials: 'same-origin', method: data ? 'PUT' : 'GET', headers: { 'Content-Type': 'application/json' }, body: data ? JSON.stringify(data) : undefined, signal: AbortSignal.timeout(10000) });
  var result = await response.json(); if (!response.ok) { var error = new Error(result.error || 'Project access unavailable.'); error.status = response.status; throw error; } return result;
}
export function clearProjectSettingsAccess() { store.set({ projectSettingsAccess: null }); }
export function loadProjectSettingsAccess(slug, project) {
  var root = document.getElementById('ps-access-management');
  var token = crypto.randomUUID(); store.set({ projectSettingsAccess: { slug: slug, token: token } });
  function current() { var s = store.get('projectSettingsAccess'); return s && s.token === token && store.get('projectSettingsSlug') === slug; }
  function update(values) { if (current()) store.set({ projectSettingsAccess: Object.assign({}, store.get('projectSettingsAccess'), values) }); }
  function reload() { if (current()) loadProjectSettingsAccess(slug, project); }
  root.replaceChildren();
  if (!store.get('isMultiUserMode')) { root.appendChild(node('p', 'This single-user server is private to its operator.', 'settings-hint')); return; }
  root.appendChild(node('p', 'Loading access…', 'settings-status'));
  request(slug, 'access').then(function (access) {
    if (!current()) return;
    root.replaceChildren();
    var ownerId = access.ownerId || access.projectOwnerId;
    var owner = ownerId === store.get('myUserId');
    var inherited = project.isWorktree;
    var parentSlug = project.parentSlug || access.parentSlug;
    var ownerAccount = (store.get('cachedAllUsers') || []).find(function (account) { return account.id === ownerId; });
    root.appendChild(node('p', 'Owner: ' + (access.ownerName || ownerAccount && (ownerAccount.displayName || ownerAccount.username) || ownerId || 'Ownership needs recovery')));
    root.appendChild(node('p', 'Project access: ' + (access.visibility === 'public' ? 'Public — authenticated users' : 'Private')));
    if (inherited) {
      root.appendChild(node('p', 'Inherited from ' + parentSlug + '. Parent access covers every existing and future worktree.', 'settings-hint'));
      root.appendChild(button('Manage parent access', function () { openSettings({ scope: 'project', slug: parentSlug, page: 'access' }); }));
    } else root.appendChild(node('p', 'Access applies to this project and all existing and future worktrees. Removing a parent grant removes inherited access; separate exact-worktree grants remain independent.', 'settings-hint'));
    if (owner && !inherited) root.appendChild(button('Manage access and ownership', function () { edit(access); }));
    if (!owner) root.appendChild(node('p', 'Only the verified owner can change project access. Project content remains subject to your current permissions.', 'settings-hint'));
    if (project.ownershipRecovery || access.ownershipRecovery || !ownerId) {
      var recovery = node('div', '', 'ownership-recovery'); recovery.id = 'ps-ownership-recovery'; root.appendChild(recovery);
      if (inherited) recovery.appendChild(node('p', 'Recover ownership in the parent project.', 'settings-hint'));
      else mountOwnershipRecovery(recovery, slug);
    }
    root.appendChild(button('Refresh access', reload));
  }).catch(function (error) {
    if (!current()) return;
    root.replaceChildren(node('p', error.status === 403 ? 'Only the project owner can inspect or change detailed access settings.' : error.message, 'settings-status'));
    if (error.status === 403 && project.contentAccess !== false && project.isWorktree) {
      root.appendChild(node('p', 'Inherited from ' + project.parentSlug + '. Parent access covers every existing and future worktree.', 'settings-hint'));
      if ((store.get('projectsHubList') || []).some(function (entry) { return entry.slug === project.parentSlug; })) root.appendChild(button('Manage parent access', function () { openSettings({ scope: 'project', slug: project.parentSlug, page: 'access' }); }));
    }
    root.appendChild(button('Retry', reload));
  });
  async function edit(access) {
    var response;
    try { response = await fetch('/api/admin/users', { credentials: 'same-origin', signal: AbortSignal.timeout(10000) }); var data = await response.json(); if (!response.ok) throw new Error(data.error || 'Accounts unavailable.'); }
    catch (error) { if (current()) root.appendChild(node('p', error.message, 'settings-status')); return; }
    if (!current()) return;
    var users = data.users || [];
    var editor = node('div', '', 'ps-access-editor'); root.replaceChildren(editor);
    editor.addEventListener('change', function () { update({ dirty: true }); });
    var status = node('p', '', 'settings-status'); status.setAttribute('role', 'status');
    async function save(suffix, value) {
      if (!current()) return;
      update({ saving: true });
      Array.from(editor.querySelectorAll('button,input,select')).forEach(function (el) { el.disabled = true; if (el.tagName === 'SELECT') el.dispatchEvent(new Event('settings-sync')); }); status.textContent = 'Saving…';
      try { await request(slug, suffix, value); if (current()) { status.textContent = 'Saved.'; reload(); } }
      catch (error) { if (current()) { update({ saving: false }); status.textContent = error.message + ' Check the saved state before retrying; your draft is retained.'; Array.from(editor.querySelectorAll('button,input,select')).forEach(function (el) { el.disabled = false; if (el.tagName === 'SELECT') el.dispatchEvent(new Event('settings-sync')); }); } }
    }
    var visibility = node('select'); visibility.setAttribute('aria-label', 'Project access');
    ['private', 'public'].forEach(function (value) { var option = node('option', value === 'private' ? 'Private' : 'Public — authenticated users'); option.value = value; visibility.appendChild(option); }); visibility.value = access.visibility;
    editor.append(node('h3', 'Project access'), visibility, button('Save project access', function () { var value = visibility.value; confirmSettingsAction('Change access for this project and all its worktrees to ' + value + '?', 'Save project access', function () { save('visibility', { visibility: value }); }); }));
    var members = node('div');
    users.filter(function (user) { return user.id !== access.ownerId; }).forEach(function (user) {
      var label = node('label', '', 'ps-access-member'); var input = node('input'); input.type = 'checkbox'; input.value = user.id; input.checked = (access.allowedUsers || []).includes(user.id);
      label.append(input, node('span', user.displayName || user.username)); members.appendChild(label);
    });
    editor.append(node('h3', 'Allowed users'), node('p', 'These grants cover all worktrees. Public access takes precedence while the project is public.', 'settings-hint'), members,
      button('Save allowed users', function () { save('users', { allowedUsers: Array.from(members.querySelectorAll('input:checked')).map(function (el) { return el.value; }) }); }));
    var owners = node('select'); owners.setAttribute('aria-label', 'New project owner');
    users.forEach(function (user) { var option = node('option', user.displayName || user.username); option.value = user.id; owners.appendChild(option); }); owners.value = access.ownerId;
    editor.append(node('h3', 'Transfer ownership'), owners, button('Review ownership transfer', function () {
      if (owners.value === access.ownerId) { status.textContent = 'Choose a different owner.'; return; }
      var nextOwner = owners.value;
      confirmSettingsAction('Transfer this project and its worktrees to ' + owners.selectedOptions[0].textContent + '? Existing session owners stay unchanged. You may lose access.', 'Transfer ownership', function () { save('owner', { userId: nextOwner }); });
    }), status, button('Back to access', function () {
      if ((store.get('projectSettingsAccess') || {}).dirty) confirmSettingsAction('Discard unsaved access changes?', 'Discard changes', reload); else reload();
    }));
    enhanceSettingsSelects(editor);
  }
}
