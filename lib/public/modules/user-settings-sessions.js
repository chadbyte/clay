import { store } from './store.js';

function describe(value) {
  if (!value || value === 'Earlier session') return 'Unknown device';
  var browser = /Edg(?:e|A|iOS)?\//.test(value) ? 'Edge' : /Firefox\/|FxiOS\//.test(value) ? 'Firefox' : /Chrome\/|CriOS\//.test(value) ? 'Chrome' : /Safari\//.test(value) ? 'Safari' : 'Browser';
  var system = /Android/.test(value) ? 'Android' : /iPhone|iPad/.test(value) ? 'iOS' : /Windows/.test(value) ? 'Windows' : /Macintosh/.test(value) ? 'macOS' : /Linux/.test(value) ? 'Linux' : '';
  return browser + (system ? ' on ' + system : '');
}
function state() { return store.get('accountSessionsPanel') || { epoch: 0, open: false, entries: [] }; }
function update(values) { store.set({ accountSessionsPanel: Object.assign({}, state(), values) }); render(); }
function render() {
  var panel = document.getElementById('us-sessions-panel'); if (!panel) return;
  var scroll = []; var ancestor = panel.parentElement;
  while (ancestor) { scroll.push({ element: ancestor, top: ancestor.scrollTop }); ancestor = ancestor.parentElement; }
  var current = state(); var toggle = document.getElementById('us-sessions-toggle');
  panel.hidden = !current.open; toggle.setAttribute('aria-expanded', String(!!current.open));
  toggle.textContent = current.open ? 'Hide sessions' : 'Manage sessions'; toggle.disabled = !!current.saving;
  var list = panel.querySelector('[data-list]'); list.replaceChildren();
  var previousGroup = panel.querySelector('[data-earlier]'); if (previousGroup) previousGroup.remove();
  var unknown = current.entries.filter(function (entry) { return entry.unknownDevice && !entry.current; });
  var older = document.createElement('details'); older.dataset.earlier = ''; var summary = document.createElement('summary');
  summary.className = 'settings-label'; summary.textContent = 'Earlier sessions without device details (' + unknown.length + ')'; older.append(summary);
  var explanation = document.createElement('p'); explanation.className = 'settings-hint';
  explanation.textContent = 'These sessions predate device tracking. Their browser and previous activity are unknown; matching labels do not mean they are the same device.';
  older.append(explanation); older.open = !!current.showEarlier;
  older.ontoggle = function () { if (older.isConnected) store.set({ accountSessionsPanel: Object.assign({}, state(), { showEarlier: older.open }) }); };
  var olderList = document.createElement('div'); olderList.setAttribute('role', 'list'); older.append(olderList);
  current.entries.forEach(function (entry) {
    var row = document.createElement('div'); row.className = 'settings-field-row'; row.setAttribute('role', 'listitem');
    var detail = document.createElement('div'); var title = document.createElement('span'); title.className = 'settings-label';
    title.textContent = describe(entry.userAgent) + (entry.current ? ' · This session' : '');
    var hint = document.createElement('p'); hint.className = 'settings-hint';
    hint.textContent = entry.method + (entry.lastSeenAt ? ' · Last active ' + new Date(entry.lastSeenAt).toLocaleString() : ' · Previous activity unknown') +
      (entry.address ? ' · Last observed IP ' + entry.address : '') +
      (entry.expiresAt ? ' · Expires ' + new Date(entry.expiresAt).toLocaleDateString() : ' · Compatibility session');
    detail.append(title, hint);
    var button = document.createElement('button'); button.type = 'button'; button.className = 'settings-btn-sm'; button.textContent = 'Sign out';
    button.dataset.sessionId = entry.id; button.setAttribute('aria-label', 'Sign out ' + describe(entry.userAgent) + (entry.current ? ' current session' : ''));
    button.disabled = !!current.pending;
    button.onclick = function () { choose(entry.id); };
    if (current.target === entry.id) {
      var confirmation = document.createElement('div'); confirmation.className = 'us-session-row-confirm';
      confirmation.setAttribute('role', 'group'); confirmation.setAttribute('aria-label', 'Confirm session sign-out');
      var question = document.createElement('p'); question.className = 'settings-hint';
      question.textContent = entry.current ? 'Sign out this browser? You will need to sign in again.' : 'Sign out this session?';
      var actions = document.createElement('div'); actions.className = 'settings-form-actions';
      var confirm = document.createElement('button'); confirm.type = 'button'; confirm.className = 'settings-btn-sm settings-btn-danger';
      confirm.dataset.rowConfirm = ''; confirm.textContent = current.saving ? 'Signing out…' : 'Sign out'; confirm.disabled = !!current.pending;
      confirm.onclick = function () { request(entry.id); };
      var cancel = document.createElement('button'); cancel.type = 'button'; cancel.className = 'settings-btn-sm';
      cancel.dataset.rowCancel = ''; cancel.textContent = 'Cancel'; cancel.disabled = !!current.pending;
      cancel.onclick = function () { update({ target: null, error: '' }); restoreFocus(entry.id); };
      actions.append(confirm, cancel); confirmation.append(question, actions);
      if (current.error) { var error = document.createElement('p'); error.className = 'settings-status'; error.setAttribute('role', 'alert'); error.textContent = current.error; confirmation.append(error); }
      row.append(detail, confirmation);
    } else row.append(detail, button);
    (entry.unknownDevice && !entry.current ? olderList : list).append(row);
  });
  if (unknown.length) list.after(older);
  panel.querySelector('[data-status]').textContent = current.target && current.target !== 'others' ? '' : current.error || (current.pending ? current.saving ? 'Signing out…' : 'Loading sessions…' : current.message || '');
  panel.querySelector('[data-retry]').hidden = !current.error || !!current.target;
  panel.querySelector('[data-others]').disabled = !!current.pending || !current.entries.some(function (entry) { return !entry.current; });
  panel.querySelector('[data-confirmation]').hidden = current.target !== 'others';
  var selected = current.entries.find(function (entry) { return entry.id === current.target; });
  panel.querySelector('[data-question]').textContent = selected && selected.current ? 'Sign out this browser? Your settings will close and you will need to sign in again.' : 'Sign out the selected sessions? Their open connections will close.';
  panel.querySelector('[data-confirm]').disabled = !!current.pending;
  panel.querySelector('[data-cancel]').disabled = !!current.pending;
  scroll.forEach(function (position) { position.element.scrollTop = position.top; });
}
function choose(id) {
  update({ target: id, error: '', message: '' });
  document.querySelector(id === 'others' ? '#us-sessions-panel [data-confirm]' : '#us-sessions-panel [data-row-confirm]').focus({ preventScroll: true });
}
function restoreFocus(id) {
  var panel = document.getElementById('us-sessions-panel');
  var button = Array.from(panel.querySelectorAll('[data-session-id]')).find(function (item) { return item.dataset.sessionId === id; });
  (button || (id === 'others' ? panel.querySelector('[data-others]') : document.getElementById('us-sessions-toggle'))).focus({ preventScroll: true });
}
async function request(id) {
  var entries = state().entries; var index = entries.findIndex(function (entry) { return entry.id === id; });
  var neighbor = entries[index + 1] || entries[index - 1];
  var epoch = state().epoch + 1;
  update({ epoch: epoch, pending: true, saving: !!id, error: '', message: '' });
  try {
    var response = await fetch('/api/account-sessions', id ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: id }) } : {});
    var data = await response.json();
    if (epoch !== state().epoch) return;
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) update({ entries: [], target: null });
      throw new Error(data.error || 'Could not manage sessions.');
    }
    if (data.signedOut) { window.location.href = '/'; return; }
    update({ entries: data.sessions, target: null, pending: false, saving: false, message: id ? 'Selected sessions signed out.' : '' });
    if (id) restoreFocus(id === 'others' ? id : neighbor && neighbor.id);
  } catch (error) {
    if (epoch === state().epoch) update({ pending: false, saving: false, error: error.message });
    var retry = document.querySelector('#us-sessions-panel [data-row-confirm]');
    if (epoch === state().epoch && id && retry) retry.focus({ preventScroll: true });
  }
}
export function resetAccountSessions() {
  update({ epoch: state().epoch + 1, open: false, entries: [], target: null, pending: false, saving: false, error: '', message: '', showEarlier: false });
}
export function initAccountSessions() {
  var toggle = document.getElementById('us-sessions-toggle'); if (!toggle || document.getElementById('us-sessions-panel')) return;
  var panel = document.createElement('div'); panel.id = 'us-sessions-panel'; panel.hidden = true;
  panel.innerHTML = '<p class="settings-hint">Each entry represents a browser session. Account sessions expire after 30 days, or after 7 days without use.</p>' +
    '<div data-list role="list" aria-label="Signed-in sessions"></div><div class="settings-form-actions"><button type="button" class="settings-btn-sm" data-others>Sign out other sessions</button></div>' +
    '<div data-confirmation role="group" aria-label="Confirm sign-out" hidden><p class="settings-hint" data-question></p><div class="settings-form-actions"><button type="button" class="settings-btn-sm settings-btn-danger" data-confirm>Sign out</button><button type="button" class="settings-btn-sm" data-cancel>Cancel</button></div></div>' +
    '<p class="settings-status" role="status" data-status></p><button type="button" class="settings-btn-sm" data-retry hidden>Retry</button>';
  toggle.closest('.settings-field-row').after(panel);
  toggle.onclick = function () {
    if (state().open) { resetAccountSessions(); toggle.focus(); }
    else { update({ open: true }); request(); }
  };
  panel.querySelector('[data-others]').onclick = function () { choose('others'); };
  panel.querySelector('[data-retry]').onclick = function () { request(); };
  panel.querySelector('[data-confirm]').onclick = function () { request(state().target); };
  panel.querySelector('[data-cancel]').onclick = function () { var id = state().target; update({ target: null, error: '' }); restoreFocus(id); };
}
