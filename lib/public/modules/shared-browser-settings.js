import { store } from './store.js';
import { getWs } from './ws-ref.js';
import { escapeHtml as escapeText } from './utils.js';

function escapeHtml(value) { return escapeText(String(value)).replace(/"/g, '&quot;').replace(/'/g, '&#39;'); }
function state() { return store.get('sharedBrowserSettings') || {}; }
function set(patch) { store.set({ sharedBrowserSettings: Object.assign({}, state(), patch) }); }
function root() { return document.getElementById('shared-browser-settings'); }
function button(label, action, target, description) {
  return '<button type="button" data-settings-action="' + action + '" data-target="' + escapeHtml(target || '') + '" data-label="' + escapeHtml(description || target || '') + '">' + escapeHtml(label) + '</button>';
}
function request(operation, target) {
  var ws = getWs();
  if (!ws || ws.readyState !== 1) { set({ error: 'Reconnect to manage browser data.', pending: false }); renderBrowserSettings(); return; }
  var id = crypto.randomUUID();
  set({ pending: true, requestId: id, error: '', notice: '' });
  ws.send(JSON.stringify({ type: 'shared_browser_settings', sessionId: store.get('activeSessionId'), requestId: id, operation: operation, target: target }));
  renderBrowserSettings();
  setTimeout(function () {
    if (state().requestId === id && state().pending) { set({ pending: false, error: 'The request timed out. Refresh to check the saved state.' }); renderBrowserSettings(); }
  }, 15000);
}
export function closeBrowserSettings(restoreFocus) {
  var wasOpen = !!state().open;
  set({ open: false, review: null }); renderBrowserSettings();
  var trigger = document.querySelector('[data-action="settings"]'); if (trigger && wasOpen && restoreFocus !== false) trigger.focus();
}
export function browserSettingsHtml() {
  return '<section id="shared-browser-settings" class="shared-browser-settings" aria-label="Browser settings" hidden></section>';
}
export function bindBrowserSettings(panel) {
  panel.querySelector('[data-action="settings"]').onclick = function () {
    set({ open: true, page: 'sites', data: null, review: null, filter: '' });
    request('list');
    root().querySelector('[data-settings-action="back"]').focus();
  };
  root().addEventListener('keydown', function (event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeBrowserSettings(); }
  });
  root().addEventListener('input', function (event) {
    if (event.target.matches('[data-settings-filter]')) { set({ filter: event.target.value }); renderRows(); root().dataset.key = JSON.stringify([state(), store.get('connected')]); }
  });
  root().addEventListener('click', function (event) {
    var control = event.target.closest('[data-settings-action]');
    if (!control || control.disabled) return;
    var action = control.dataset.settingsAction;
    if (action === 'back') { closeBrowserSettings(); return; }
    if (action === 'sites' || action === 'history') { set({ page: action, filter: '', review: null, notice: '', error: '' }); renderBrowserSettings(); return; }
    if (action === 'refresh') { request('list'); return; }
    if (action === 'cancel') { set({ review: null }); renderBrowserSettings(); root().querySelector('[data-settings-action="refresh"]').focus(); return; }
    if (action === 'confirm') { var review = state().review; if (review) request(review.action, review.target); return; }
    set({ notice: '', error: '', review: { action: action, target: control.dataset.target, label: control.dataset.label || control.dataset.target } });
    renderBrowserSettings(); root().querySelector('[data-settings-action="cancel"]').focus();
  });
}
function renderRows() {
  var el = root(), s = state(); if (!el || !s.open) return;
  var rows = el.querySelector('.browser-settings-rows'); if (!rows) return;
  var filter = (s.filter || '').toLowerCase();
  var data = s.data || { sites: [], history: [] };
  if (s.page === 'history') {
    rows.innerHTML = data.history.filter(function (entry) { return entry.url.toLowerCase().includes(filter); }).map(function (entry) {
      return '<div class="browser-settings-row"><div><span class="browser-settings-url">' + escapeHtml(entry.url) + '</span><small>' + escapeHtml(new Date(entry.at).toLocaleString()) + '</small></div>' + button('Remove', 'delete_history', entry.id, entry.url) + '</div>';
    }).join('');
  } else {
    rows.innerHTML = data.sites.filter(function (site) { return site.host.toLowerCase().includes(filter); }).map(function (site) {
      return '<details><summary>' + escapeHtml(site.host) + '<small>' + site.cookies.length + (site.cookies.length === 1 ? ' cookie · ' : ' cookies · ') + site.origins.length + (site.origins.length === 1 ? ' storage origin' : ' storage origins') + '</small></summary><div class="browser-settings-row"><span>Cookies and site storage</span>' + button('Remove site data', 'delete_site', site.host) + '</div>' +
        site.origins.map(function (origin) { return '<p class="browser-settings-origin">' + escapeHtml(origin.origin) + '<small>' + origin.localStorage + ' localStorage entries · ' + origin.databases + ' IndexedDB databases</small></p>'; }).join('') +
        site.cookies.map(function (cookie) {
          var info = cookie.domain + cookie.path + ' · ' + (cookie.expires === -1 ? 'Session cookie' : 'Expires ' + new Date(cookie.expires * 1000).toLocaleDateString()) + (cookie.httpOnly ? ' · HttpOnly' : '') + (cookie.secure ? ' · Secure' : '') + (cookie.partitioned ? ' · Partitioned' : '');
          return '<div class="browser-settings-row"><div><span>' + escapeHtml(cookie.name) + '</span><small>' + escapeHtml(info) + '</small></div>' + button('Remove cookie', 'delete_cookie', cookie.id, cookie.name + ' · ' + cookie.domain + cookie.path) + '</div>';
        }).join('') + '</details>';
    }).join('');
  }
  if (!rows.innerHTML) rows.innerHTML = '<p class="browser-settings-muted">' + (s.pending && !s.data ? 'Loading saved data…' : filter ? 'No matching entries.' : s.page === 'history' ? 'No saved browsing history.' : 'No saved cookies or site data.') + '</p>';
  rows.querySelectorAll('button').forEach(function (control) { control.disabled = !!s.pending || !store.get('connected'); });
}
export function renderBrowserSettings() {
  var el = root(); if (!el) return;
  var s = state(), panel = el.closest('.shared-browser-panel');
  var browser = store.get('sharedBrowser');
  var trigger = panel.querySelector('[data-action="settings"]');
  trigger.hidden = !(browser && browser.personalCookiesAvailable);
  trigger.disabled = !store.get('connected');
  trigger.setAttribute('aria-expanded', String(!!s.open));
  el.hidden = !s.open;
  panel.classList.toggle('browser-settings-open', !!s.open);
  if (!s.open) return;
  var key = JSON.stringify([s, store.get('connected')]); if (el.dataset.key === key) return; el.dataset.key = key;
  var page = s.page || 'sites';
  el.innerHTML = '<div class="browser-settings-heading">' + button('Back to browser', 'back') + '<h3>Browser settings</h3></div><p class="browser-settings-muted">Personal · Shared across your Mates. Incognito tabs do not save data here.</p>' +
    '<nav aria-label="Browser settings sections">' + button('Cookies & site data', 'sites') + button('History', 'history') + '</nav>' +
    '<p class="browser-settings-muted">' + (page === 'sites' ? 'Cookies, localStorage and IndexedDB are saved for your account. New personal tabs restore saved site storage. Removing data may sign you out. Removals also apply to open personal tabs. Sites may create new data afterwards.' : 'Your latest 500 page visits. Clearing this list leaves open tabs, their Back/Forward navigation and conversation activity unchanged.') + '</p>' +
    '<div class="browser-settings-tools"><input data-settings-filter aria-label="Filter saved browser data" placeholder="' + (page === 'sites' ? 'Find a site' : 'Find a page') + '" value="' + escapeHtml(s.filter || '') + '">' + button('Refresh', 'refresh') + button(page === 'sites' ? 'Clear all site data' : 'Clear history', page === 'sites' ? 'clear_data' : 'clear_history') + '</div>' +
    '<p class="browser-settings-feedback" role="status">' + escapeHtml(s.error || (!store.get('connected') ? 'Disconnected. Reconnect and refresh to see current saved data.' : s.pending ? 'Updating…' : s.notice || '')) + '</p>' +
    (s.review ? '<div class="browser-settings-review" role="group" aria-label="Confirm removal"><strong>' + (s.review.action.includes('history') ? 'Remove browsing history?' : 'Remove saved site data?') + '</strong><p>' + (s.review.action.includes('history') ? 'This removes ' + (s.review.action === 'clear_history' ? 'all saved visits' : 'this saved visit') + ' from your personal history.' : s.review.action === 'delete_cookie' ? 'This removes ' + escapeHtml(s.review.label) + ' across your personal Mate browsers and may sign you out.' : 'This removes ' + (s.review.action === 'clear_data' ? 'all cookies and site storage' : 'cookies and storage for ' + escapeHtml(s.review.target)) + ' across your personal Mate browsers and may sign you out.') + '</p>' + button('Cancel', 'cancel') + button('Remove', 'confirm') + '</div>' : '') +
    '<div class="browser-settings-rows"></div>';
  el.querySelector('[data-settings-action="' + page + '"]').setAttribute('aria-current', 'page');
  el.querySelectorAll('button').forEach(function (control) { control.disabled = control.dataset.settingsAction !== 'back' && (!!s.pending || !store.get('connected')); });
  renderRows();
}
export function handleBrowserSettingsMessage(msg) {
  if (!msg.requestId || msg.requestId !== state().requestId) return false;
  if (msg.type === 'shared_browser_settings') {
    var removed = !!state().review;
    set({ data: msg.settings, pending: false, review: null, error: '', notice: removed ? 'Removed from your saved browser data.' : '' });
  } else if (msg.type === 'shared_browser_error') set({ pending: false, error: msg.error });
  else return false;
  renderBrowserSettings();
  if (state().open && removed) root().querySelector('[data-settings-action="refresh"]').focus();
  return true;
}
