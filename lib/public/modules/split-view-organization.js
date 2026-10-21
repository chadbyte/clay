import { getWs } from './ws-ref.js';
import { store } from './store.js';
import { organizePresentationView } from './split-view-presentations.js';
import { currentFolderState } from './session-folders.js';
import { openFolderPicker } from './session-folder-dialogs.js';
import { iconHtml } from './icons.js';
function receipt(view) {
  return { id: view.id, revision: view.revision, owner: store.get('myUserId'), project: store.get('currentSlug'),
    socket: getWs(), generation: store.get('projectSplitViewSocketGeneration'), context: store.get('projectSplitViewContextKey') };
}
function current(source) {
  if (!source || source.socket !== getWs() || !store.get('connected') || source.owner !== store.get('myUserId') || source.project !== store.get('currentSlug') ||
      source.generation !== store.get('projectSplitViewSocketGeneration') || source.context !== store.get('projectSplitViewContextKey')) return null;
  return (store.get('projectSplitViews') || []).find(function (view) { return view.id === source.id && view.revision === source.revision; }) || null;
}
export function organizeViewAction(view, action) {
  var source = receipt(view);
  if (!current(source)) return false;
  if (action === 'favorite') return organizePresentationView(view.id, view.revision, view.folderId || null, !view.favorite);
  if (action !== 'folder') return false;
  openFolderPicker({ title: 'Move Split view to folder', folders: currentFolderState().folders, current: view.folderId || 'unfiled',
    onPick: function (folderId) { var live = current(source); if (live) organizePresentationView(live.id, live.revision, folderId, live.favorite === true); } });
  return true;
}
export function appendViewOrganization(heading, view) {
  var star = document.createElement('button'); star.type = 'button';
  star.className = 'session-folder-star-btn split-view-star split-view-group-favorite' + (view.favorite ? ' is-favorite' : '');
  star.dataset.splitViewAction = 'favorite'; star.disabled = !!store.get('projectSplitViewPending');
  star.setAttribute('aria-pressed', String(view.favorite === true));
  star.setAttribute('aria-label', (view.favorite ? 'Remove from Favorites: ' : 'Add to Favorites: ') + view.name);
  star.title = view.favorite ? 'Remove from Favorites' : 'Add to Favorites'; star.innerHTML = iconHtml('star'); heading.appendChild(star);
  heading.draggable = true;
  heading.addEventListener('dragstart', function (event) {
    if (!heading.isConnected || !current(receipt(view)) || store.get('projectSplitViewPending')) { event.preventDefault(); return; }
    store.set({ splitViewOrganizationDrag: receipt(view) });
    event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-clay-split-view', view.id);
  });
  heading.addEventListener('dragend', clear);
}
function clear() {
  store.set({ splitViewOrganizationDrag: null });
  Array.from(document.querySelectorAll('.session-folder-drop')).forEach(function (item) { item.classList.remove('session-folder-drop'); });
}
function folderTarget(event) {
  var folder = event.target && event.target.closest && event.target.closest('.session-folder[data-folder-id]');
  if (!folder || !folder.isConnected) return null;
  var id = folder.dataset.folderId;
  return id === 'favorites' || id === 'unfiled' || currentFolderState().folders.some(function (item) { return item.id === id; }) ? folder : null;
}
document.addEventListener('keydown', function (event) {
  if (event.key === 'Escape' && store.get('splitViewOrganizationDrag')) clear();
}, true);
document.addEventListener('dragover', function (event) {
  if (!current(store.get('splitViewOrganizationDrag'))) return;
  var target = folderTarget(event); if (!target) return;
  event.preventDefault(); event.stopImmediatePropagation(); event.dataTransfer.dropEffect = 'move';
  Array.from(document.querySelectorAll('.session-folder-drop')).forEach(function (item) { if (item !== target) item.classList.remove('session-folder-drop'); });
  target.classList.add('session-folder-drop');
}, true);
document.addEventListener('drop', function (event) {
  if (!store.get('splitViewOrganizationDrag')) return;
  var view = current(store.get('splitViewOrganizationDrag')), target = folderTarget(event);
  if (!view) { clear(); return; }
  event.preventDefault(); event.stopImmediatePropagation(); clear();
  if (!target) return;
  var id = target.dataset.folderId;
  organizePresentationView(view.id, view.revision, id === 'favorites' ? view.folderId || null : id === 'unfiled' ? null : id,
    id === 'favorites' ? true : view.favorite === true);
}, true);
store.subscribe(function (next, previous) {
  if (next.splitViewOrganizationDrag && (next.currentSlug !== previous.currentSlug || next.myUserId !== previous.myUserId || !next.connected ||
      next.projectSplitViews !== previous.projectSplitViews)) clear();
});
