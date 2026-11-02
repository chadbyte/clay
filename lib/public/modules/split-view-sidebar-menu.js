import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { iconHtml, refreshIcons } from './icons.js';
import { closeSessionContextMenu, mountSessionContextMenu, positionSessionContextMenu } from './session-context-menu.js';
import { closeFolderMenu } from './session-folder-context.js';

export function closeSplitViewMenu(returnFocus) {
  var current = store.get('sessionContextMenu');
  if (current && current.el.classList.contains('split-view-menu')) closeSessionContextMenu(returnFocus);
}

export function openSplitViewMenu(group, anchor, point, onAction) {
  var view = (store.get('projectSplitViews') || []).find(function (item) { return item.id === group.dataset.splitViewId; });
  if (!view) return;
  var surface = group.dataset.splitViewSurface || 'desktop';
  var socket = getWs(), generation = store.get('projectSplitViewSocketGeneration');
  var slug = store.get('currentSlug'), viewer = store.get('myUserId'), projection = group.dataset.splitViewProjection;
  function currentRoot() {
    var live = (store.get('projectSplitViews') || []).find(function (item) { return item.id === view.id && item.revision === view.revision && item.name === view.name; });
    if (!live || socket !== getWs() || generation !== store.get('projectSplitViewSocketGeneration') || slug !== store.get('currentSlug') || viewer !== store.get('myUserId') || !store.get('connected')) return null;
    function matches(root) { return root.isConnected && root.dataset.splitViewId === view.id && root.dataset.splitViewProjection === projection && (root.dataset.splitViewSurface || 'desktop') === surface; }
    if (matches(group)) return group;
    var roots = Array.from(document.querySelectorAll('.split-view-group[data-split-view-id]')).filter(matches);
    return roots.length === 1 ? roots[0] : null;
  }
  closeFolderMenu(false); closeSessionContextMenu(false);
  var menu = document.createElement('div'); menu.className = 'session-ctx-menu split-view-menu';
  [['add-pane', 'Add pane', 'panel-right-open'], ['favorite', view.favorite ? 'Remove from Favorites' : 'Add to Favorites', 'star'], ['folder', 'Move to folder', 'folder-input'], ['rename', 'Rename', 'pencil'], ['separate', 'Separate', 'columns-2']].forEach(function (entry) {
    var button = document.createElement('button'); button.className = 'session-ctx-item'; button.dataset.splitViewAction = entry[0];
    if (entry[0] === 'add-pane') button.disabled = !view.sessions.length || view.sessions.length + (view.workspace && view.workspace.linkedPair ? view.workspace.linkedPair.workerOrigins.length : 0) >= 8 || !!store.get('projectSplitViewPending');
    button.innerHTML = iconHtml(entry[2]) + ' <span>' + entry[1] + '</span>';
    button.addEventListener('click', function (event) {
      event.stopPropagation(); var root = currentRoot(); closeSessionContextMenu(false);
      if (root) onAction(view, entry[0], root);
    });
    menu.appendChild(button);
  });
  document.body.appendChild(menu);
  mountSessionContextMenu(menu, anchor, null, { resolveAnchor: function () {
    var root = currentRoot(); return root && root.querySelector('.split-view-group-more');
  } });
  refreshIcons(); positionSessionContextMenu(menu, anchor, point);
}
