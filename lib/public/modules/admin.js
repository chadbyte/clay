import { store } from './store.js';
import { apiGet } from './admin-settings-ui.js';
import { loadUsersTab } from './admin-settings-users.js';
import { loadInvitesTab } from './admin-settings-invitations.js';
import { loadSmtpTab } from './admin-settings-email.js';
import { loadProjectsTab } from './admin-settings-projects.js';

export function initAdmin() {}
export function checkAdminAccess() {
  return apiGet('/api/me').then(function (data) {
    store.set({ adminMe: data });
    return !!(data.multiUser && data.user && data.user.role === 'admin');
  }).catch(function () { return false; });
}
export function loadAdminSection(section, body) {
  body.textContent = 'Loading…';
  var loaders = { 'admin-users': loadUsersTab, 'admin-invites': loadInvitesTab, 'admin-smtp': loadSmtpTab, 'admin-projects': loadProjectsTab };
  if (loaders[section]) loaders[section](body);
}
