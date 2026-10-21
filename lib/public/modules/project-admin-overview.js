// Restricted projects use public shell primitives without opening a project socket.
import { createStore, store } from './store.js';
import { groupProjects, getProjectAbbrev } from './project-grouping.js';
import { computeVars, validateTheme, defaultDarkFallback, defaultLightFallback } from './theme-palette.js';
import { initTooltips } from './tooltip.js';

var data = JSON.parse(document.getElementById('project-admin-data').textContent);
createStore({ adminOverview: data, adminUsage: null, adminUsageLoading: false, adminUsageTimer: null, adminUsageGeneration: 0, adminRailCollapsed: {}, adminThemes: null });

function applyAppearance() {
  var seed = window.__clayAppearanceSeed;
  var mode = seed && seed.configured && seed.mode || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  var id = seed && (seed[mode + 'Theme'] || seed.theme);
  var themes = store.get('adminThemes') || {};
  var theme = themes[id] && themes[id].variant === mode ? themes[id] : (mode === 'light' ? defaultLightFallback : defaultDarkFallback);
  if (!validateTheme(theme)) return;
  var vars = computeVars(theme);
  Object.keys(vars).forEach(function (name) { document.documentElement.style.setProperty(name, vars[name]); });
  document.documentElement.classList.toggle('light-theme', theme.variant === 'light');
  document.documentElement.classList.toggle('dark-theme', theme.variant !== 'light');
}
applyAppearance();
fetch('/api/themes', { credentials: 'same-origin' }).then(function (response) { if (!response.ok) throw new Error('Themes unavailable'); return response.json(); }).then(function (themes) {
  var valid = {};
  Object.entries(Object.assign({}, themes.bundled, themes.custom)).forEach(function (entry) { if (validateTheme(entry[1])) valid[entry[0]] = entry[1]; });
  store.set({ adminThemes: valid }); applyAppearance();
}).catch(function () {});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', applyAppearance);

function projectLink(project, worktree) {
  var link = document.createElement('a');
  link.className = (worktree ? 'icon-strip-wt-item' : 'icon-strip-item') + (project.slug === data.project.slug ? ' active' : '');
  link.href = '/p/' + encodeURIComponent(project.slug) + '/';
  link.dataset.slug = project.slug;
  link.dataset.tip = project.title + (project.contentAccess === false ? ' · Administrative overview' : '');
  link.setAttribute('aria-label', link.dataset.tip);
  if (project.slug === data.project.slug) link.setAttribute('aria-current', 'page');
  var label = document.createElement('span');
  label.className = worktree ? 'wt-branch-abbrev' : 'icon-strip-name';
  if (project.icon) label.classList.add('project-emoji');
  label.textContent = project.icon || getProjectAbbrev(project.title);
  link.appendChild(label);
  return link;
}
function renderNavigation() {
  var container = document.getElementById('icon-strip-projects');
  var grouped = groupProjects(data.projects);
  grouped.parents.forEach(function (project) {
    var children = grouped.wtByParent[project.slug] || [];
    var link = projectLink(project, false);
    if (!children.length) { container.appendChild(link); return; }
    var group = document.createElement('div');
    group.className = 'icon-strip-group'; group.dataset.parentSlug = project.slug;
    var header = document.createElement('div'); header.className = 'project-admin-rail-header';
    header.appendChild(link); link.classList.add('folder-header');
    var toggle = document.createElement('button');
    toggle.type = 'button'; toggle.className = 'icon-strip-group-chevron'; toggle.dataset.tip = 'Toggle worktrees';
    toggle.setAttribute('aria-label', 'Toggle ' + project.title + ' worktrees'); toggle.setAttribute('aria-expanded', 'true');
    var list = document.createElement('div'); list.className = 'icon-strip-group-items'; list.id = 'worktrees-' + project.slug;
    toggle.setAttribute('aria-controls', list.id);
    toggle.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M6 3v12a6 6 0 0 0 12 0V6M6 7h0"/><circle cx="18" cy="6" r="3"/><circle cx="6" cy="6" r="3"/></svg>';
    toggle.addEventListener('click', function () {
      var collapsed = group.classList.toggle('collapsed'); list.inert = collapsed;
      toggle.setAttribute('aria-expanded', String(!collapsed));
      var state = Object.assign({}, store.get('adminRailCollapsed')); state[project.slug] = collapsed; store.set({ adminRailCollapsed: state });
    });
    children.forEach(function (child) { list.appendChild(projectLink(child, true)); });
    header.appendChild(toggle); group.append(header, list); container.appendChild(group);
  });
  var parent = data.projects.find(function (project) { return project.slug === data.project.parentSlug; });
  var label = document.getElementById('project-admin-parent');
  if (parent) { label.hidden = false; label.textContent = 'Worktree of ' + parent.title; }
}
renderNavigation();
initTooltips();

var tabs = Array.from(document.querySelectorAll('[role="tab"]'));
function select(tab) {
  tabs.forEach(function (item) {
    var active = item === tab;
    item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
    document.getElementById(item.getAttribute('aria-controls')).hidden = !active;
  });
}
tabs.forEach(function (tab, index) {
  tab.addEventListener('click', function () { select(tab); });
  tab.addEventListener('keydown', function (event) {
    if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].indexOf(event.key) === -1) return;
    event.preventDefault();
    var target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[tabs.length - 1] : tabs[(index + (event.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    select(target); target.focus();
  });
});
select(tabs[0]);

function size(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return 'Unavailable';
  var units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'], index = 0;
  while (bytes >= 1024 && index < units.length - 1) { bytes /= 1024; index++; }
  return bytes.toFixed(index ? 1 : 0) + ' ' + units[index];
}
function clearUsage() {
  ['bytes', 'files', 'free', 'capacity'].forEach(function (field) { document.getElementById('usage-' + field).textContent = '—'; });
  store.set({ adminUsage: null });
}
async function loadUsage(refresh) {
  if (store.get('adminUsageLoading')) return;
  clearTimeout(store.get('adminUsageTimer'));
  var generation = store.get('adminUsageGeneration');
  store.set({ adminUsageLoading: true });
  var button = document.getElementById('project-admin-refresh'), status = document.getElementById('usage-status');
  button.disabled = true; document.getElementById('project-admin-usage').setAttribute('aria-busy', 'true');
  try {
    var response = await fetch('/api/server/storage/project/' + encodeURIComponent(data.project.slug) + (refresh ? '?refresh=1' : ''), { credentials: 'same-origin' });
    var result = await response.json();
    if (generation !== store.get('adminUsageGeneration')) return;
    if (!response.ok) { if ([401, 403, 404, 409].indexOf(response.status) >= 0) clearUsage(); throw new Error(result.error || 'Storage measurement failed.'); }
    if (result.slug !== data.project.slug) throw new Error('Storage response belongs to another project.');
    store.set({ adminUsage: result });
    var usage = result.usage;
    if (usage && usage.available) {
      document.getElementById('usage-bytes').textContent = (result.partial || result.scanning ? 'At least ' : '') + size(usage.bytes);
      document.getElementById('usage-files').textContent = (result.partial || result.scanning ? 'At least ' : '') + Number(usage.files).toLocaleString();
      document.getElementById('usage-free').textContent = size(usage.availableBytes);
      document.getElementById('usage-capacity').textContent = size(usage.capacityBytes);
    } else clearUsage();
    status.textContent = result.scanning ? 'Scan in progress. Totals are not final.' : !usage || !usage.available ? 'Storage is unavailable: the directory is missing, unreadable or shared by multiple registrations.' : (result.partial ? 'Partial scan; some paths could not be measured. ' : '') + 'Measured ' + new Date(result.checkedAt).toLocaleString() + '. Cached for up to 5 minutes.';
    if (result.scanning && !document.hidden) store.set({ adminUsageTimer: setTimeout(function () { loadUsage(false); }, 1500) });
  } catch (error) { if (generation === store.get('adminUsageGeneration')) status.textContent = error.message + (store.get('adminUsage') ? ' Previous measurement retained.' : ''); }
  finally { if (generation === store.get('adminUsageGeneration')) { store.set({ adminUsageLoading: false }); button.disabled = false; document.getElementById('project-admin-usage').setAttribute('aria-busy', 'false'); } }
}
document.getElementById('project-admin-refresh').addEventListener('click', function () { loadUsage(true); });
document.addEventListener('visibilitychange', function () { if (document.hidden) clearTimeout(store.get('adminUsageTimer')); else if (store.get('adminUsage') && store.get('adminUsage').scanning) loadUsage(false); });
window.addEventListener('pagehide', function () { clearTimeout(store.get('adminUsageTimer')); store.set({ adminUsageGeneration: store.get('adminUsageGeneration') + 1 }); });
window.addEventListener('pageshow', function (event) { if (event.persisted) { clearUsage(); store.set({ adminUsageLoading: false }); loadUsage(false); } });
loadUsage(false);
