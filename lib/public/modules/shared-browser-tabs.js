import { iconHtml, refreshIcons } from './icons.js';
import { store } from './store.js';

export function renderBrowserTabs(el, select, send) {
  var bar = el.querySelector('.shared-browser-tabs');
  var tabs = store.get('sharedBrowsers') || [];
  var selected = store.get('sharedBrowser');
  var key = JSON.stringify([tabs.map(function (tab) { return [tab.id, tab.url, tab.control, tab.phase, tab.incognito, tab.personalCookiesAvailable, tab.sourceSessionId, tab.sourceRole, tab.sourceTitle, tab.sourceGeneration]; }), selected && selected.id, store.get('connected')]);
  if (bar.dataset.key === key) return;
  var focused = bar.contains(document.activeElement) ? document.activeElement : null;
  var focusedId = focused && focused.dataset.browserId, focusedAction = focused && focused.dataset.tabAction;
  var previousSelection = bar.dataset.selected;
  var previousStrip = bar.querySelector('.shared-browser-tab-list'), scrollLeft = previousStrip ? previousStrip.scrollLeft : 0;
  bar.dataset.key = key; bar.dataset.selected = selected && selected.id || '';
  bar.replaceChildren();
  var strip = document.createElement('div'); strip.className = 'shared-browser-tab-list'; strip.setAttribute('role', 'presentation');
  bar.appendChild(strip);
  tabs.forEach(function (tab, index) {
    var item = document.createElement('div'); item.className = 'shared-browser-tab'; item.setAttribute('role', 'presentation');
    var active = !!selected && selected.id === tab.id;
    var button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab');
    button.dataset.browserId = tab.id; button.dataset.tabAction = 'select';
    button.setAttribute('aria-selected', String(active)); button.tabIndex = active ? 0 : -1;
    var title = 'New tab';
    try { if (tab.url) title = new URL(tab.url).hostname || 'New tab'; } catch (e) {}
    var source = tab.sourceRole === 'worker' ? 'Worker #' + tab.sourceSessionId : '';
    if (source) title = source + ' · ' + title;
    var mode = tab.phase === 'ended' ? 'Ended' : tab.phase === 'starting' ? 'Starting' : tab.control === 'agent' ? 'You and Clay can control this tab' : 'Only you can control this tab. Clay is paused.';
    var description = title + (source ? ' · ' + tab.sourceTitle + ' · Gen ' + tab.sourceGeneration : '') + ' · ' + (tab.incognito === false ? 'Personal browser' : 'Incognito') + ' · ' + mode;
    var label = document.createElement('span'); label.className = 'shared-browser-tab-label'; label.textContent = title;
    button.innerHTML = iconHtml(tab.personalCookiesAvailable && tab.incognito ? 'glasses' : 'globe');
    button.appendChild(label); button.setAttribute('aria-label', description); button.setAttribute('data-tip', description);
    item.dataset.phase = tab.phase; item.dataset.control = tab.control;
    button.onclick = function () { select(tab.id); };
    button.onkeydown = function (event) {
      var next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); select(tabs[next].id); bar.querySelectorAll('[role="tab"]')[next].focus();
    };
    var close = document.createElement('button'); close.type = 'button'; close.className = 'shared-browser-tab-close'; close.innerHTML = iconHtml('x');
    close.dataset.browserId = tab.id; close.dataset.tabAction = 'close';
    close.setAttribute('aria-label', 'Close browser tab ' + (index + 1)); close.setAttribute('data-tip', 'Close tab'); close.disabled = !store.get('connected');
    close.onclick = function () { send('close', { browserId: tab.id }); };
    item.append(button, close); strip.appendChild(item);
  });
  function addButton(icon, label, description, fields, action) {
    var button = document.createElement('button'); button.type = 'button'; button.className = 'shared-browser-new-tab';
    button.innerHTML = iconHtml(icon); button.dataset.tabAction = action;
    button.setAttribute('aria-label', label); button.setAttribute('data-tip', description); button.disabled = !store.get('connected');
    button.onclick = function () { send('open', fields); }; bar.appendChild(button);
  }
  addButton('plus', 'New browser tab', selected && selected.personalCookiesAvailable ? 'New tab · Personal browser' : 'New incognito tab', { newTab: true }, 'new');
  if (selected && selected.personalCookiesAvailable) addButton('glasses', 'New incognito tab', 'New incognito tab · Site data is not saved', { newTab: true, incognito: true }, 'incognito');
  refreshIcons();
  strip.scrollLeft = scrollLeft;
  var buttons = Array.from(bar.querySelectorAll('button'));
  var replacement = focused && buttons.find(function (button) { return button.dataset.browserId === focusedId && button.dataset.tabAction === focusedAction; });
  if (focused) (replacement || bar.querySelector('[aria-selected="true"]') || buttons[0]).focus({ preventScroll: true });
  var current = bar.querySelector('[aria-selected="true"]');
  if (current && previousSelection !== bar.dataset.selected) current.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
