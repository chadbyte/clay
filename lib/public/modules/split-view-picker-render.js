import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { activeSavedView } from './view-workspace-state.js';
import { viewForOrigin } from './split-view-presentation-lookup.js';
import { createOptions } from './session-create.js';
import { sortVendorEntries } from './vendor-priority.js';
import { VENDOR_AVATARS, VENDOR_NAMES } from './chat-render-runtime.js';
import { iconHtml, refreshIcons } from './icons.js';
import { pickerCapacity } from './split-view-picker-actions.js';

export var SPLIT_SIDES = [['right', 'Right', 'panel-right-open'], ['left', 'Left', 'panel-left-open'], ['top', 'Top', 'panel-top-open'], ['bottom', 'Bottom', 'panel-bottom-open']];
function button(label, action, value) {
  var el = document.createElement('button'); el.type = 'button'; el.dataset[action] = value; el.setAttribute('aria-label', label); el.title = label; return el;
}
function vendorIcon(vendor) {
  var image = document.createElement('img'); image.src = VENDOR_AVATARS[vendor] || '/icon-192.png'; image.alt = ''; return image;
}
function age(time) {
  var minutes = Math.max(0, Math.floor((Date.now() - (time || 0)) / 60000));
  return minutes < 1 ? 'Now' : minutes < 60 ? minutes + 'm' : minutes < 1440 ? Math.floor(minutes / 60) + 'h' : Math.floor(minutes / 1440) + 'd';
}
export function pickerCandidates(query) {
  var view = activeSavedView(), text = (query || '').trim().toLocaleLowerCase();
  return (getCachedSessions() || []).filter(function (session) {
    return view && session.sessionOriginId && !session.hidden && session.sessionRole !== 'worker' && !session.isMate && !session.isTui &&
      (session.ownerId || null) === (store.get('myUserId') || null) && !view.sessions.some(function (ref) { return ref.sessionOriginId === session.sessionOriginId; }) &&
      (!text || (session.title || 'New session').toLocaleLowerCase().indexOf(text) >= 0);
  }).sort(function (a, b) { return (b.lastActivity || b.createdAt || 0) - (a.lastActivity || a.createdAt || 0); }).slice(0, text ? 40 : 6);
}
export function renderPickerResults(menu) {
  var state = store.get('splitSessionPicker'); if (!state) return;
  var list = menu.querySelector('.split-session-results'); if (!list) return;
  var focused = menu.contains(document.activeElement) && document.activeElement.dataset, focusKey = focused && (focused.splitSession ? ['splitSession', focused.splitSession] : focused.splitVendor ? ['splitVendor', focused.splitVendor] : null);
  list.replaceChildren();
  var candidates = pickerCandidates(state.query), blocked = !pickerCapacity() || !!store.get('projectSplitViewPending') || !!store.get('splitSessionCreation');
  candidates.forEach(function (session) {
    var title = session.title || 'New session', owner = viewForOrigin(session.sessionOriginId);
    var choice = button('Add ' + title, 'splitSession', String(session.id)); choice.className = 'split-session-result'; choice.disabled = blocked;
    choice.appendChild(vendorIcon(session.vendor));
    var content = document.createElement('span'); content.className = 'split-session-result-title'; content.textContent = title; choice.appendChild(content);
    var time = document.createElement('small'); time.textContent = age(session.lastActivity || session.createdAt); choice.appendChild(time);
    choice.title = title + (owner ? ' · Move from ' + owner.name : '');
    if (owner && owner.sessions.length > 1) { var note = document.createElement('small'); note.className = 'split-session-move'; note.textContent = 'Move from ' + owner.name; content.appendChild(note); }
    list.appendChild(choice);
  });
  if (!candidates.length) { var empty = document.createElement('p'); empty.className = 'split-session-empty'; empty.textContent = state.query ? 'No matching sessions. Start a new one below.' : 'No other sessions yet. Start a new one below.'; list.appendChild(empty); }
  var vendors = menu.querySelector('.split-session-vendors'); vendors.replaceChildren();
  var options = createOptions(), installed = sortVendorEntries(options.vendors.filter(function (vendor) { return vendor.installed; }));
  installed.forEach(function (vendor) {
    var label = 'New ' + (VENDOR_NAMES[vendor.id] || vendor.displayName || vendor.id) + ' session';
    var control = button(label, 'splitVendor', vendor.id); control.disabled = blocked; control.appendChild(vendorIcon(vendor.id)); vendors.appendChild(control);
  });
  if (options.error || !installed.length) {
    var hint = document.createElement('span'); hint.className = 'split-session-empty'; hint.textContent = options.error || (options.loaded ? 'No installed vendors available.' : 'Loading vendors…'); vendors.appendChild(hint);
    if (options.error) { var retry = button('Retry loading vendors', 'splitRetry', 'true'); retry.textContent = 'Retry'; vendors.appendChild(retry); }
  }
  var status = menu.querySelector('[role="status"]');
  if (focusKey) { var restored = Array.from(menu.querySelectorAll('button')).find(function (item) { return item.dataset[focusKey[0]] === focusKey[1] && !item.disabled; }); if (restored) restored.focus({ preventScroll: true }); }
  status.textContent = !pickerCapacity() ? 'This View already has eight session panes.' : store.get('projectSplitViewPending') ? 'Saving the View…' : store.get('splitSessionCreation') ? 'Creating session…' : state.error || '';
}
export function renderPicker(menu) {
  var state = store.get('splitSessionPicker'); if (!state) return;
  menu.replaceChildren(); menu.dataset.stage = state.side ? 'sessions' : 'direction';
  if (!state.side) {
    var header = document.createElement('div'); header.className = 'split-view-arrange-header';
    var title = document.createElement('strong'); title.textContent = 'Add split'; header.appendChild(title);
    var close = button('Close split picker', 'splitClose', 'true'); close.innerHTML = iconHtml('x'); header.appendChild(close); menu.appendChild(header);
    var directions = document.createElement('div'); directions.className = 'split-session-directions';
    SPLIT_SIDES.forEach(function (side) { var choice = button('Add ' + side[1] + ' Split', 'splitSide', side[0]); choice.disabled = !pickerCapacity() || !!store.get('projectSplitViewPending'); choice.innerHTML = iconHtml(side[2]); var label = document.createElement('span'); label.textContent = 'Add ' + side[1] + ' Split'; choice.appendChild(label); directions.appendChild(choice); });
    menu.appendChild(directions); refreshIcons(); return;
  }
  var search = document.createElement('label'); search.className = 'split-session-search'; search.innerHTML = iconHtml('search');
  var input = document.createElement('input'); input.type = 'search'; input.placeholder = 'Search sessions…'; input.setAttribute('aria-label', 'Search sessions'); input.value = state.query || ''; search.appendChild(input); menu.appendChild(search);
  var recent = document.createElement('div'); recent.className = 'split-session-section'; recent.textContent = state.query ? 'Search results' : 'Recent sessions'; menu.appendChild(recent);
  var list = document.createElement('div'); list.className = 'split-session-results'; list.setAttribute('aria-label', 'Available sessions'); menu.appendChild(list);
  var heading = document.createElement('div'); heading.className = 'split-session-section split-session-new'; heading.textContent = 'New session'; menu.appendChild(heading);
  var vendors = document.createElement('div'); vendors.className = 'split-session-vendors'; vendors.setAttribute('aria-label', 'Installed vendors'); menu.appendChild(vendors);
  var status = document.createElement('p'); status.className = 'split-session-status'; status.setAttribute('role', 'status'); menu.appendChild(status);
  var footer = document.createElement('small'); footer.className = 'split-session-hint'; footer.textContent = '↑↓ Choose · Enter Open · Esc Cancel'; menu.appendChild(footer);
  renderPickerResults(menu); refreshIcons();
}
