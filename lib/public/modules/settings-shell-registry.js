// Pure routing model for the unified settings shell: scopes, pages, legacy
// aliases and access-based fallbacks. No DOM or store access, so every entry
// point resolves to one exact { scope, page, slug } destination.

export var SETTINGS_SCOPES = [
  { id: 'personal', label: 'Personal', hint: 'Applies to your account on every device' },
  { id: 'project', label: 'Project', hint: 'Applies to the selected project' },
  { id: 'server', label: 'Server', hint: 'Applies to this Clay server for everyone' }
];

export var PERSONAL_PAGES = [
  { id: 'us-account', label: 'Account' }, { id: 'us-appearance', label: 'Appearance' },
  { id: 'us-providers', label: 'AI providers' }, { id: 'us-notifications', label: 'Notifications' },
  { id: 'us-ai', label: 'AI preferences' }, { id: 'us-agent', label: 'Agent behavior' }, { id: 'us-integrations', label: 'Integrations' }
];

export var PROJECT_PAGES = [
  { id: 'profile', label: 'General' }, { id: 'access', label: 'Access' }, { id: 'environment', label: 'Environment' }
];

export var SERVER_PAGES = [
  { id: 'overview', category: 'Service', label: 'Overview' },
  { id: 'network', category: 'Service', label: 'Network' },
  { id: 'storage', category: 'Service', label: 'Storage' },
  { id: 'security', category: 'Administration', label: 'Access & security' },
  { id: 'admin-users', category: 'Administration', label: 'Users', multiUser: true },
  { id: 'admin-projects', category: 'Administration', label: 'Project access', multiUser: true },
  { id: 'admin-smtp', category: 'Administration', label: 'Email delivery', multiUser: true },
  { id: 'environment', category: 'Agent configuration', label: 'Environment' },
  { id: 'operations', category: 'Maintenance', label: 'Operations' }
];

var PERSONAL_ALIASES = {
  'us-chat': 'us-providers', 'us-mates': 'us-ai', 'us-experimental': 'us-ai', 'us-voice': 'us-providers', 'us-connections': 'us-integrations',
  'us-email': 'us-integrations', 'us-logout': 'us-account'
};
var SERVER_ALIASES = { 'admin-invites': 'admin-users' };

export var DEFAULT_PERSONAL_PAGE = 'us-account';

// access: { server: boolean, multiUser: boolean, project: boolean }
export function defaultAccess() { return { server: false, multiUser: false, project: true }; }

// The authoritative role rule: a multi-user server needs an admin; a solo
// (single-user) server's owner has server access.
export function accessFromMe(me, permissions) {
  var multiUser = !!(me && me.multiUser);
  var admin = !!(me && me.user && me.user.role === 'admin');
  return { server: !!me && (!multiUser || admin), multiUser: multiUser, project: !permissions || permissions.projectSettings !== false };
}

export function pagesForScope(scope, access) {
  access = access || defaultAccess();
  if (scope === 'personal') return PERSONAL_PAGES.slice();
  if (scope === 'project') return PROJECT_PAGES.slice();
  if (scope === 'server') return SERVER_PAGES.filter(function (page) { return !page.multiUser || access.multiUser; });
  return [];
}

export function scopeAvailable(scope, access) {
  access = access || defaultAccess();
  if (scope === 'personal') return true;
  if (scope === 'project') return !!access.project;
  if (scope === 'server') return !!access.server;
  return false;
}

export function resolvePage(scope, page, access) {
  page = (page || '').split('#')[0];
  var alias = scope === 'personal' ? PERSONAL_ALIASES[page] : scope === 'server' ? SERVER_ALIASES[page] : null;
  var id = alias || page;
  var pages = pagesForScope(scope, access);
  for (var i = 0; i < pages.length; i++) if (pages[i].id === id) return id;
  return pages.length ? pages[0].id : null;
}

// Unknown or unavailable scopes fall back to Personal, which is always allowed.
export function resolveRoute(route, access) {
  route = route || {};
  var scope = scopeAvailable(route.scope, access) ? route.scope : 'personal';
  var requested = scope === route.scope ? route.page : null;
  return {
    scope: scope,
    page: resolvePage(scope, requested, access),
    slug: scope === 'project' ? (route.slug || null) : null,
    anchor: route.anchor || (route.page || '').split('#')[1] || (scope === 'personal' ? ({'us-chat':'api-connections','us-voice':'api-connections','us-experimental':'experimental-features','us-mates':'execution-behavior'})[route.page] : null) || null,
    requestedScope: route.scope || 'personal',
    redirected: scope !== (route.scope || 'personal')
  };
}
