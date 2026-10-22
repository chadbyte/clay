// DOM rendering for the unified settings shell chrome: scope tabs, page
// navigation (desktop list + narrow select) and the project selector.
import { SETTINGS_SCOPES } from './settings-shell-registry.js';
import { optionLabel } from './settings-project-target.js';
import { enhanceSettingsSelects } from './settings-select.js';

function el(id) { return document.getElementById(id); }

export function setShellStatus(text, state) {
  var status = el('settings-shell-status');
  status.textContent = text || '';
  status.hidden = !text;
  if (state) status.dataset.state = state; else delete status.dataset.state;
}

export function renderScopeTabs(access, activeScope, onSelect) {
  var tabs = el('settings-scope-tabs');
  tabs.replaceChildren();
  SETTINGS_SCOPES.forEach(function (scope) {
    if (scope.id === 'server' && !access.server) return;
    if (scope.id === 'project' && !access.project) return;
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'settings-scope-tab'; button.dataset.scope = scope.id;
    button.textContent = scope.label; button.title = scope.hint;
    if (scope.id === activeScope) button.setAttribute('aria-current', 'page');
    button.classList.toggle('active', scope.id === activeScope);
    button.onclick = function () { onSelect(scope.id); };
    tabs.appendChild(button);
  });
  var active = SETTINGS_SCOPES.filter(function (scope) { return scope.id === activeScope; })[0];
  el('settings-scope-title').textContent = active ? active.label + ' settings' : 'Settings';
  el('settings-scope-hint').textContent = active ? active.hint : '';
  el('settings-server-name').hidden = activeScope !== 'server';
}

export function renderPageNav(pages, activePage, onSelect) {
  var nav = el('settings-page-nav');
  var select = el('settings-page-select');
  nav.replaceChildren(); select.replaceChildren();
  var category; var group = select;
  pages.forEach(function (page) {
    if (page.category && page.category !== category) {
      category = page.category;
      var heading = document.createElement('div'); heading.className = 'settings-nav-category'; heading.textContent = category; nav.appendChild(heading);
      group = document.createElement('optgroup'); group.label = category; select.appendChild(group);
    }
    var button = document.createElement('button');
    button.type = 'button'; button.className = 'settings-nav-item'; button.dataset.section = page.id; button.textContent = page.label;
    button.onclick = function () { onSelect(page.id); };
    nav.appendChild(button);
    var option = document.createElement('option'); option.value = page.id; option.textContent = page.label; group.appendChild(option);
  });
  select.onchange = function () { onSelect(this.value); };
  nav.onkeydown = function (event) {
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].indexOf(event.key) < 0) return;
    var items = Array.from(nav.querySelectorAll('button'));
    var index = items.indexOf(document.activeElement);
    if (index < 0) return;
    event.preventDefault();
    index = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
    items[index].focus();
  };
  markActivePage(activePage);
}

// A page may hang a list of in-page links under its own nav item (desktop).
var subnav = { page: null, node: null };
var lastActivePage = null;
export function setPageSubnav(page, node) {
  if (subnav.node && subnav.node.parentNode && subnav.node !== node) subnav.node.parentNode.removeChild(subnav.node);
  subnav = { page: node ? page : null, node: node || null };
  placeSubnav();
}
function placeSubnav() {
  var nav = el('settings-page-nav');
  if (!subnav.node) return;
  var active = Array.from(nav.querySelectorAll('button.settings-nav-item')).filter(function (button) { return button.dataset.section === lastActivePage; })[0];
  if (subnav.page === lastActivePage && active) active.after(subnav.node);
  else if (subnav.node.parentNode === nav) nav.removeChild(subnav.node);
}

export function markActivePage(activePage) {
  lastActivePage = activePage;
  Array.from(el('settings-page-nav').querySelectorAll('button')).forEach(function (button) {
    var active = button.dataset.section === activePage;
    button.classList.toggle('active', active);
    if (active) button.setAttribute('aria-current', 'page'); else button.removeAttribute('aria-current');
  });
  var select = el('settings-page-select');
  if (activePage && select.value !== activePage) select.value = activePage;
  placeSubnav();
}

// The selector is a plain select; settings-select upgrades it to the shared
// desktop picker and leaves the native control on narrow screens.
export function renderProjectSelect(choices, selectedSlug, onChange, placeholder) {
  var wrap = el('settings-project-picker');
  var select = el('settings-project-select');
  select.replaceChildren();
  choices.forEach(function (choice) {
    var option = document.createElement('option');
    option.value = choice.slug; option.textContent = optionLabel(choice);
    select.appendChild(option);
  });
  if (!choices.length) {
    var none = document.createElement('option'); none.value = ''; none.textContent = placeholder || 'No projects available';
    select.appendChild(none);
  }
  select.disabled = !choices.length;
  select.value = selectedSlug || (choices[0] && choices[0].slug) || '';
  select.onchange = function () { onChange(this.value); };
  enhanceSettingsSelects(wrap);
  select.dispatchEvent(new Event('settings-sync'));
}

export function showProjectPicker(visible) { el('settings-project-picker').hidden = !visible; }
export function selectedProjectValue() { return el('settings-project-select').value; }
export function syncProjectSelect(slug) {
  var select = el('settings-project-select');
  select.value = slug || '';
  select.dispatchEvent(new Event('settings-sync'));
}
