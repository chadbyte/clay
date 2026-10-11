export var SERVER_SETTINGS_PAGES = [
  { id: 'overview', category: 'Service', label: 'Overview' },
  { id: 'network', category: 'Service', label: 'Network' },
  { id: 'storage', category: 'Service', label: 'Storage & retention' },
  { id: 'security', category: 'Administration', label: 'Access & security' },
  { id: 'admin-users', category: 'Administration', label: 'Users', multiUser: true },
  { id: 'admin-invites', category: 'Administration', label: 'Invitations', multiUser: true },
  { id: 'admin-projects', category: 'Administration', label: 'Project access', multiUser: true },
  { id: 'admin-smtp', category: 'Administration', label: 'Email delivery', multiUser: true },
  { id: 'environment', category: 'Agent configuration', label: 'Environment' },
  { id: 'operations', category: 'Maintenance', label: 'Operations' }
];

export function renderSettingsNavigation(multiUser, selectPage) {
  var nav = document.getElementById('settings-page-nav');
  var mobile = document.getElementById('settings-nav-dropdown');
  nav.replaceChildren(); mobile.replaceChildren();
  var category; var group;
  SERVER_SETTINGS_PAGES.forEach(function (page) {
    if (page.multiUser && !multiUser) return;
    if (category !== page.category) {
      category = page.category;
      var heading = document.createElement('div'); heading.className = 'settings-nav-category'; heading.textContent = category; nav.appendChild(heading);
      group = document.createElement('optgroup'); group.label = category; mobile.appendChild(group);
    }
    var button = document.createElement('button'); button.type = 'button'; button.className = 'settings-nav-item'; button.dataset.section = page.id; button.textContent = page.label;
    button.onclick = function () { selectPage(page.id, true); }; nav.appendChild(button);
    var option = document.createElement('option'); option.value = page.id; option.textContent = page.label; group.appendChild(option);
  });
  mobile.onchange = function () { selectPage(this.value, true); };
  nav.onkeydown = function (event) {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(event.key) < 0) return;
    var items = Array.from(nav.querySelectorAll('button'));
    var index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index].focus();
  };
}
