import { store } from './store.js';

function size(bytes) {
  if (bytes < 1024) return bytes + ' B';
  var units = ['KiB', 'MiB', 'GiB', 'TiB'];
  var index = -1;
  do { bytes /= 1024; index++; } while (bytes >= 1024 && index < units.length - 1);
  return bytes.toFixed(1) + ' ' + units[index];
}
function cell(row, text, header) {
  var el = document.createElement(header ? 'th' : 'td');
  el.textContent = text;
  if (header) el.scope = 'row';
  row.appendChild(el);
}
function render(data) {
  var projectMode = data.attribution === 'project';
  document.getElementById('settings-storage-description').textContent = projectMode ? 'Project disk usage grouped by project owner, alongside shared Clay data.' : 'Disk usage across Clay data, registered projects and mapped Linux home directories.';
  document.getElementById('settings-storage-owner-heading').textContent = projectMode ? 'Projects' : 'Linux account';
  document.querySelector('.settings-storage-table').setAttribute('aria-label', projectMode ? 'Allocated disk usage by project owner' : 'Allocated disk usage by filesystem owner');
  document.getElementById('settings-storage-explanation').textContent = (projectMode ? 'Project files are attributed to their registered project owner. Nested projects use their own owner; conflicting shared paths or hard links are unattributed. ' : 'Allocated space is attributed by Linux file owner, including directory metadata. ') + 'Shared paths count once. Symlinks and nested mounts are skipped. Results may be cached for 5 minutes. Refresh usage requests a new measurement.';
  document.getElementById('settings-storage-attribution-note').textContent = projectMode ? 'System / unattributed includes Clay data outside projects, unowned projects and conflicting shared files. Home directories are included only if registered as projects.' : 'System / unattributed includes unmapped or shared Linux identities. Unavailable means the account cannot be uniquely mapped; it does not mean zero usage.';
  var body = document.getElementById('settings-storage-users');
  body.replaceChildren();
  data.users.slice().sort(function (a, b) { return b.bytes - a.bytes; }).forEach(function (user) {
    var row = document.createElement('tr');
    cell(row, user.name, true);
    cell(row, projectMode ? String(user.projects || 0) : user.linuxUser || 'No Linux account');
    cell(row, user.mapped ? (data.scanning || data.partial ? 'At least ' : '') + size(user.bytes) : 'Unavailable');
    cell(row, user.mapped ? user.files.toLocaleString() : '—');
    body.appendChild(row);
  });
  var shared = document.createElement('tr');
  cell(shared, 'System / unattributed', true); cell(shared, projectMode ? 'Shared / unowned' : 'Other filesystem owners');
  cell(shared, size(data.unattributedBytes)); cell(shared, data.unattributedFiles.toLocaleString());
  body.appendChild(shared);
  document.getElementById('settings-storage-total').textContent = (data.partial || data.scanning ? 'At least ' : '') + size(data.totalBytes);
  var status = document.getElementById('settings-storage-status');
  status.textContent = (data.scanning ? 'Scan in progress; these totals are not final. ' : '') + (data.partial ? 'Partial scan: some paths were unreadable, on another filesystem, or exceeded the scan limit. ' : '') +
    'Checked ' + new Date(data.checkedAt).toLocaleTimeString() + '. ' + data.roots + ' storage roots scanned.';
  status.dataset.state = data.scanning ? 'pending' : data.partial ? 'error' : 'saved';
  document.getElementById('settings-storage-results').hidden = false;
}
export async function loadStorageUsage(refresh) {
  if (store.get('serverStorageLoading')) return;
  clearTimeout(store.get('serverStorageTimer'));
  var button = document.getElementById('settings-storage-refresh');
  var status = document.getElementById('settings-storage-status');
  store.set({ serverStorageLoading: true });
  button.disabled = true;
  button.textContent = 'Measuring…';
  if (!store.get('serverStorageScanning')) status.textContent = 'Measuring disk usage. Large directories can take several seconds.';
  status.dataset.state = 'pending';
  try {
    var response = await fetch('/api/server/storage' + (refresh === true ? '?refresh=1' : ''), { credentials: 'same-origin' });
    var data = await response.json();
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) {
        store.set({ serverStorageUsage: null });
        document.getElementById('settings-storage-results').hidden = true;
      }
      throw new Error(data.error || 'Disk usage is unavailable. Try refreshing.');
    }
    store.set({ serverStorageUsage: data, serverStorageScanning: !!data.scanning });
    if (data.users) render(data);
    if (data.scanning) {
      status.textContent = 'Scan in progress. Project files, including node_modules, are being measured; totals are not final.';
      store.set({ serverStorageTimer: setTimeout(function () {
        if (store.get('serverSettingsPage') === 'storage' && !document.getElementById('server-settings').classList.contains('hidden')) loadStorageUsage();
      }, 1500) });
    }
  } catch (error) {
    store.set({ serverStorageScanning: false });
    status.textContent = error.message + (store.get('serverStorageUsage') ? ' Previous measurements remain below.' : '');
    status.dataset.state = 'error';
  } finally {
    store.set({ serverStorageLoading: false });
    button.disabled = !!store.get('serverStorageScanning');
    button.textContent = button.disabled ? 'Measuring…' : 'Refresh usage';
  }
}
export function initStorageUsage() {
  document.getElementById('settings-storage-refresh').addEventListener('click', function () { loadStorageUsage(true); });
}
