// Pane-header picker for explicitly choosing real Driver sessions for a Split view.
import { store } from './store.js';
import { getCachedSessions } from './sidebar-sessions.js';
import { viewForOrigin } from './split-view-presentation-lookup.js';
import { iconHtml } from './icons.js';

function menuElement() { return document.getElementById('split-view-create-menu'); }
function close(returnFocus) {
  var menu = menuElement(); if (!menu) return;
  menu.hidden = true; store.set({ projectSplitViewCreateSelection: [] });
  if (returnFocus && menu.clayCreateAnchor && menu.clayCreateAnchor.isConnected) menu.clayCreateAnchor.focus();
  menu.clayCreateAnchor = null;
}
function refreshCreateButton(menu) {
  var selected = store.get('projectSplitViewCreateSelection') || [], action = menu.querySelector('[data-create-split-view]');
  action.disabled = selected.length < 2 || selected.length > 8;
  action.textContent = 'Create Split view (' + selected.length + ')';
}
function open(anchor) {
  var menu = menuElement();
  if (!menu) {
    menu = document.createElement('section'); menu.id = 'split-view-create-menu'; menu.className = 'split-view-arrange';
    menu.hidden = true; menu.setAttribute('role', 'dialog'); menu.setAttribute('aria-label', 'Arrange sessions');
    var header = document.createElement('div'); header.className = 'split-view-arrange-header';
    var title = document.createElement('strong'); title.textContent = 'Arrange sessions'; header.appendChild(title);
    var closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.setAttribute('aria-label', 'Close arrangement picker'); closeButton.innerHTML = iconHtml('x'); header.appendChild(closeButton); menu.appendChild(header);
    var list = document.createElement('div'); list.className = 'split-view-arrange-grid'; list.setAttribute('role', 'group'); list.setAttribute('aria-label', 'Choose sessions');
    list.style.cssText = 'display:flex;flex-direction:column;max-height:230px;overflow:auto'; menu.appendChild(list);
    var create = document.createElement('button'); create.type = 'button'; create.dataset.createSplitView = 'true'; menu.appendChild(create);
    document.body.appendChild(menu);
  }
  menu.clayCreateAnchor = anchor;
  var list = menu.querySelector('[aria-label="Choose sessions"]'); list.textContent = '';
  var activeView = (store.get('projectSplitViews') || []).find(function (view) { return view.id === store.get('projectSplitViewActiveId'); });
  var currentId = Number(store.get('activeSessionId'));
  var current = (getCachedSessions() || []).find(function (session) { return session.id === currentId; });
  var selected = activeView ? activeView.sessions.map(function (item) { return item.sessionOriginId; }) :
    current && current.sessionRole !== 'worker' && !current.isMate && !current.isTui ? [current.sessionOriginId] : [];
  var candidates = (getCachedSessions() || []).filter(function (session) {
    if (!session.sessionOriginId || session.sessionRole === 'worker' || session.isMate || session.isTui) return false;
    var owner = viewForOrigin(session.sessionOriginId); return !owner || activeView && owner.id === activeView.id;
  });
  candidates.forEach(function (session) {
    var choice = document.createElement('button'); choice.type = 'button'; choice.dataset.createSessionOrigin = session.sessionOriginId;
    choice.setAttribute('aria-pressed', selected.indexOf(session.sessionOriginId) >= 0 ? 'true' : 'false');
    choice.textContent = session.title || 'Session'; list.appendChild(choice);
  });
  store.set({ projectSplitViewCreateSelection: selected }); refreshCreateButton(menu); menu.hidden = false;
  var rect = anchor.getBoundingClientRect(), width = Math.min(280, window.innerWidth - 16);
  menu.style.left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)) + 'px';
  menu.style.top = Math.max(8, Math.min(rect.bottom + 4, window.innerHeight - menu.offsetHeight - 8)) + 'px';
  var first = menu.querySelector('[data-create-session-origin]'); if (first) first.focus();
}
function onClick(event) {
  var target = event.target;
  var menu = menuElement(); if (!menu || menu.hidden) return;
  if (menu.contains(target)) {
    var closeButton = target.closest('[aria-label="Close arrangement picker"]');
    if (closeButton) { event.preventDefault(); close(true); return; }
    var choice = target.closest('[data-create-session-origin]');
    if (choice) {
      event.preventDefault(); var selected = (store.get('projectSplitViewCreateSelection') || []).slice(), origin = choice.dataset.createSessionOrigin, index = selected.indexOf(origin);
      if (index === -1 && selected.length >= 8) return;
      if (index === -1) selected.push(origin); else selected.splice(index, 1);
      store.set({ projectSplitViewCreateSelection: selected }); choice.setAttribute('aria-pressed', selected.indexOf(origin) >= 0 ? 'true' : 'false'); refreshCreateButton(menu); return;
    }
    if (target.closest('[data-create-split-view]') && !target.closest('[data-create-split-view]').disabled) {
      event.preventDefault(); document.dispatchEvent(new CustomEvent('clay-split-view-create', { detail: { origins: (store.get('projectSplitViewCreateSelection') || []).slice() } })); close(true);
    }
    return;
  }
  if (target.closest && target.closest('.split-view-arrange-trigger')) return;
  close(false);
}
export function initSplitViewCreateMenu() {
  document.addEventListener('clay-split-view-open-create', function (event) { if (event.detail && event.detail.anchor) open(event.detail.anchor); });
  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape' || !menuElement() || menuElement().hidden) return;
    event.preventDefault(); event.stopImmediatePropagation(); close(true);
  }, true);
  window.addEventListener('resize', function () { if (menuElement() && !menuElement().hidden) close(false); });
}
