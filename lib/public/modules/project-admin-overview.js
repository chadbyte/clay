import { mountOwnershipRecovery } from './project-ownership-recovery.js';
import { store } from './store.js';

export function mountProjectAdminOverview() {
  var root = document.getElementById('project-restricted-content');
  if (!root) return;
  var data = JSON.parse(document.getElementById('project-admin-data').textContent);
  store.set({ adminOverview: data, adminUsage: null, adminUsageLoading: false, adminUsageTimer: null, adminUsageGeneration: 0 });
  var parent = data.projects.find(function (project) { return project.slug === data.project.parentSlug; });
  if (parent) {
    var label = root.querySelector('#project-admin-parent');
    label.hidden = false; label.textContent = 'Worktree of ' + parent.title;
  }

  var tabs = Array.from(root.querySelectorAll('[role="tab"]'));
  function select(tab) {
    tabs.forEach(function (item) {
      var active = item === tab;
      item.setAttribute('aria-selected', String(active)); item.tabIndex = active ? 0 : -1;
      root.querySelector('#' + item.getAttribute('aria-controls')).hidden = !active;
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
    ['bytes', 'files', 'free', 'capacity'].forEach(function (field) { root.querySelector('#usage-' + field).textContent = '—'; });
    store.set({ adminUsage: null });
  }
  async function loadUsage(refresh) {
    if (!root.isConnected || store.get('adminUsageLoading')) return;
    clearTimeout(store.get('adminUsageTimer'));
    var generation = store.get('adminUsageGeneration');
    store.set({ adminUsageLoading: true });
    var button = root.querySelector('#project-admin-refresh'), status = root.querySelector('#usage-status');
    button.disabled = true; root.querySelector('#project-admin-usage').setAttribute('aria-busy', 'true');
    try {
      var response = await fetch('/api/server/storage/project/' + encodeURIComponent(data.project.slug) + (refresh ? '?refresh=1' : ''), { credentials: 'same-origin' });
      var result = await response.json();
      if (!root.isConnected || generation !== store.get('adminUsageGeneration')) return;
      if (!response.ok) { if ([401, 403, 404, 409].indexOf(response.status) >= 0) clearUsage(); throw new Error(result.error || 'Storage measurement failed.'); }
      if (result.slug !== data.project.slug) throw new Error('Storage response belongs to another project.');
      store.set({ adminUsage: result });
      var usage = result.usage;
      if (usage && usage.available) {
        root.querySelector('#usage-bytes').textContent = (result.partial || result.scanning ? 'At least ' : '') + size(usage.bytes);
        root.querySelector('#usage-files').textContent = (result.partial || result.scanning ? 'At least ' : '') + Number(usage.files).toLocaleString();
        root.querySelector('#usage-free').textContent = size(usage.availableBytes);
        root.querySelector('#usage-capacity').textContent = size(usage.capacityBytes);
      } else clearUsage();
      status.textContent = result.scanning ? 'Scan in progress. Totals are not final.' : !usage || !usage.available ? 'Storage is unavailable: the directory is missing, unreadable or shared by multiple registrations.' : (result.partial ? 'Partial scan; some paths could not be measured. ' : '') + 'Measured ' + new Date(result.checkedAt).toLocaleString() + '. Cached for up to 5 minutes.';
      if (result.scanning && !document.hidden) store.set({ adminUsageTimer: setTimeout(function () { loadUsage(false); }, 1500) });
    } catch (error) { if (root.isConnected && generation === store.get('adminUsageGeneration')) status.textContent = error.message + (store.get('adminUsage') ? ' Previous measurement retained.' : ''); }
    finally { if (root.isConnected && generation === store.get('adminUsageGeneration')) { store.set({ adminUsageLoading: false }); button.disabled = false; root.querySelector('#project-admin-usage').setAttribute('aria-busy', 'false'); } }
  }
  root.querySelector('#project-admin-refresh').addEventListener('click', function () { loadUsage(true); });
  function onVisibilityChange() {
    if (document.hidden) clearTimeout(store.get('adminUsageTimer'));
    else if (store.get('adminUsage') && store.get('adminUsage').scanning) loadUsage(false);
  }
  function onPageHide() {
    clearTimeout(store.get('adminUsageTimer'));
    store.set({ adminUsageGeneration: store.get('adminUsageGeneration') + 1 });
  }
  function onPageShow(event) {
    if (root.isConnected && event.persisted) {
      clearUsage(); store.set({ adminUsageLoading: false }); loadUsage(false);
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', onPageHide);
  window.addEventListener('pageshow', onPageShow);
  loadUsage(false);

  if (data.project.ownershipRecovery) {
    var recovery = document.createElement('div'); recovery.id = 'overview-ownership-recovery'; recovery.className = 'ownership-recovery';
    root.querySelector('#access-panel').appendChild(recovery);
    if (data.project.isWorktree) {
      var parentLink = document.createElement('a'); parentLink.href = '/p/' + encodeURIComponent(data.project.parentSlug) + '/'; parentLink.textContent = 'Recover ownership in the parent project'; recovery.appendChild(parentLink);
    } else mountOwnershipRecovery(recovery, data.project.slug);
  }

  if (data.project.ownershipRecovery) {
    var recoverLink = document.createElement('button'); recoverLink.type = 'button'; recoverLink.className = 'settings-btn-sm'; recoverLink.textContent = 'Recover ownership';
    recoverLink.onclick = function () { root.querySelector('#access-tab').click(); root.querySelector('#access-tab').focus(); };
    root.querySelector('.project-admin-notice').appendChild(recoverLink);
  }

  return function () {
    onPageHide();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('pagehide', onPageHide);
    window.removeEventListener('pageshow', onPageShow);
  };
}
