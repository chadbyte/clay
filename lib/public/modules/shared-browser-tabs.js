import { store } from './store.js';

export function renderBrowserTabs(el, select, send) {
  var bar = el.querySelector('.shared-browser-tabs');
  var tabs = store.get('sharedBrowsers') || [];
  var selected = store.get('sharedBrowser');
  var key = JSON.stringify([tabs.map(function (tab) { return [tab.id, tab.url, tab.control, tab.phase]; }), selected && selected.id, store.get('connected')]);
  if (bar.dataset.key === key) return;
  bar.dataset.key = key;
  bar.replaceChildren();
  tabs.forEach(function (tab, index) {
    var item = document.createElement('div'); item.className = 'shared-browser-tab';
    var button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'tab');
    button.setAttribute('aria-selected', String(!!selected && selected.id === tab.id));
    var title = 'Tab ' + (index + 1);
    try { if (tab.url) title = new URL(tab.url).hostname; } catch (e) {}
    var label = document.createElement('span'); label.textContent = title;
    var owner = document.createElement('small'); owner.textContent = tab.phase === 'ended' ? 'Ended' : tab.control === 'agent' ? 'Clay' : 'You';
    button.append(label, owner); button.title = title + ' · ' + owner.textContent;
    button.onclick = function () { select(tab.id); };
    button.onkeydown = function (event) {
      var next = event.key === 'ArrowRight' ? (index + 1) % tabs.length : event.key === 'ArrowLeft' ? (index + tabs.length - 1) % tabs.length : event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : -1;
      if (next < 0) return;
      event.preventDefault(); select(tabs[next].id); bar.querySelectorAll('[role="tab"]')[next].focus();
    };
    var close = document.createElement('button'); close.type = 'button'; close.textContent = '×'; close.setAttribute('aria-label', 'Close browser tab ' + (index + 1)); close.disabled = !store.get('connected');
    close.onclick = function () { send('close', { browserId: tab.id }); };
    item.append(button, close); bar.appendChild(item);
  });
  var add = document.createElement('button'); add.type = 'button'; add.textContent = '+'; add.setAttribute('aria-label', 'New browser tab'); add.disabled = !store.get('connected');
  add.onclick = function () { send('open', { newTab: true }); };
  bar.appendChild(add);
}
