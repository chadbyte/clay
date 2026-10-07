// Folder sections for the project session sidebar, shared by the desktop
// list and the mobile sheet. Layout math lives in session-folder-layout.js and
// persistence in session-folders.js; this module only builds DOM and routes
// user intent (click, menu, drag) to folder operations.

import { store } from './store.js';
import { escapeHtml } from './utils.js';
import { iconHtml, refreshIcons } from './icons.js';
import { currentFolderState, sendFolderOp, openFolderCreate, cancelFolderCreate, resetSessionFolders, requestFolderState } from './session-folders.js';
import { closeViewMenu } from './session-folder-view-menu.js';
import { wireFolderDrag, cancelFolderDrag, reapplyFolderDragPreview } from './session-folder-dnd.js';
import { renderFolderDraft } from './session-folder-draft.js';
import { closeFolderMenu, wireFolderContext, resetFolderGestures, consumeFolderClickSuppress } from './session-folder-context.js';
import {
  buildLayout, containerKeys, containerOf, orderAfterMove,
  FAVORITES_ID, UNFILED_ID
} from './session-folder-layout.js';
import { openFolderNameDialog, openFolderPicker, closeFolderModal } from './session-folder-dialogs.js';
import { openFolderDelete } from './session-folder-delete.js';

// Mutable UI state (open menu, drag in flight, the layout each surface last
// rendered) lives in the store; this module only owns the functions.

store.subscribe(function (state, previous) {
  var slugChanged = state.currentSlug !== previous.currentSlug;
  if (slugChanged || state.dmMode !== previous.dmMode) {
    closeFolderMenu();
    resetFolderGestures();
    closeFolderModal();
    closeViewMenu(false);
    cancelFolderCreate();
    cancelFolderDrag();
    store.set({ sessionFolderDrag: null });
  }
  if (previous.connected && !state.connected) cancelFolderDrag();
  if (slugChanged) {
    resetSessionFolders();
    requestFolderState();
  }
});

function layoutFor(surface) {
  return (store.get('sessionFolderLayouts') || {})[surface] || null;
}

function dragState() {
  return store.get('sessionFolderDrag');
}

function setDrag(value) {
  store.set({ sessionFolderDrag: value });
}

// --- Units ---

export function unitsFromItems(items) {
  var units = [];
  for (var i = 0; i < items.length; i++) {
    var item = items[i];
    var data = item.type === "session" || item.type === "driver-hierarchy" ? item.data : null;
    units.push({
      key: data && typeof data.id === "number" ? data.id : null,
      title: data ? data.title : (item.type === "split-group" ? (item.group && item.group.name) : (item.type === "loop" ? item.loopId : "")),
      createdAt: data ? data.createdAt || 0 : 0,
      lastActivity: item.lastActivity || 0,
      item: item,
    });
  }
  return units;
}

export function computeLayout(items, searching, surface) {
  var layout = buildLayout(unitsFromItems(items), currentFolderState(), { searching: searching });
  var layouts = Object.assign({}, store.get('sessionFolderLayouts') || {});
  layouts[surface] = layout;
  store.set({ sessionFolderLayouts: layouts });
  return layout;
}

// A session can be filed when it is a standalone session or a Driver root.
export function canOrganizeSession(session) {
  return !!(session && typeof session.id === "number" && session.sessionRole !== "worker" && !(session.loop && session.loop.loopId));
}

export function currentContainerOf(session) {
  return containerOf(currentFolderState(), { key: session.id });
}

// --- Actions ---

export function moveSessionToFolder(session, folderId) {
  if (!canOrganizeSession(session)) return;
  var state = currentFolderState();
  var target = folderId || UNFILED_ID;
  var order;
  if (target === FAVORITES_ID) {
    order = (state.orders[FAVORITES_ID] || []).filter(function (k) { return k !== session.id && state.assignments[k] === FAVORITES_ID; });
    order.push(session.id);
  }
  sendFolderOp({ op: "place_session", sessionId: session.id, folderId: folderId || null, order: order });
}

// Keyboard and touch route to the same picker as the context menu.
export function createMoveButton(session, className) {
  var btn = document.createElement("button");
  btn.type = "button";
  btn.className = className || "session-folder-move-btn";
  btn.title = "Move to folder";
  btn.setAttribute("aria-label", "Move " + (session.title || "New Session") + " to a folder");
  btn.innerHTML = iconHtml("folder-input");
  btn.addEventListener("click", function (event) {
    event.preventDefault();
    event.stopPropagation();
    openMoveToFolder(session);
  });
  return btn;
}

export function toggleFavorite(session) {
  moveSessionToFolder(session, currentContainerOf(session) === FAVORITES_ID ? null : FAVORITES_ID);
}

export function openMoveToFolder(session) {
  if (!canOrganizeSession(session)) return;
  var state = currentFolderState();
  openFolderPicker({
    title: "Move to folder",
    folders: state.folders,
    current: currentContainerOf(session),
    onPick: function (folderId) { moveSessionToFolder(session, folderId); },
    onNewFolder: function () { openFolderCreate(session.id); },
  });
}

function renameFolder(folder) {
  openFolderNameDialog({
    title: "Rename folder", submitLabel: "Rename", initial: folder.label, selfId: folder.id, existing: currentFolderState().folders,
    onSubmit: function (name) { sendFolderOp({ op: "rename_folder", folderId: folder.id, name: name }); },
  });
}

// The dialog asks the server for the folder's real membership, so a search
// filter or a collapsed section never changes what the choice covers.
function deleteFolder(folder) {
  openFolderDelete(folder.id, folder.label);
}

function shiftFolder(folderId, delta) {
  var folders = currentFolderState().folders;
  for (var i = 0; i < folders.length; i++) {
    if (folders[i].id !== folderId) continue;
    var neighbor = folders[i + delta];
    if (neighbor) sendFolderOp({ op: "reorder_folder", folderId: folderId, targetId: neighbor.id, insertBefore: delta < 0 });
  }
}

// --- Drag and drop (desktop) ---

function clearDropMarks() {
  var marked = document.querySelectorAll(".session-folder-drop, .drag-over-above, .drag-over-below, .session-folder-unit.dragging");
  for (var i = 0; i < marked.length; i++) marked[i].classList.remove("session-folder-drop", "drag-over-above", "drag-over-below", "dragging");
}

export function setupFolderDrag(el, session) {
  if (!canOrganizeSession(session)) return;
  el.setAttribute("draggable", "true");
  el.addEventListener("dragstart", function (event) {
    setDrag({ type: "session", key: session.id, containerId: currentContainerOf(session) });
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(session.id));
    var unit = el.closest(".session-folder-unit");
    setTimeout(function () { (unit || el).classList.add("dragging"); }, 0);
  });
  el.addEventListener("dragend", function () { setDrag(null); clearDropMarks(); });
}

function reorderable(containerId) {
  var state = currentFolderState();
  return !searchingNow() && (containerId === FAVORITES_ID || state.view.sort === "manual");
}

function searchingNow() {
  var layout = layoutFor("desktop");
  return !!(layout && layout.searching);
}

function dropSession(targetContainerId, targetKey, insertBefore) {
  var dragged = dragState();
  setDrag(null);
  var lastLayout = layoutFor("desktop");
  if (!dragged || dragged.type !== "session" || !lastLayout) return;
  var key = dragged.key;
  var src = dragged.containerId;
  var canOrder = reorderable(targetContainerId);
  var ordered = containerKeys(lastLayout, targetContainerId);
  if (targetContainerId === src) {
    if (canOrder && targetKey && targetKey !== key) sendFolderOp({ op: "set_order", containerKey: targetContainerId, order: orderAfterMove(ordered, key, targetKey, insertBefore) });
    return;
  }
  sendFolderOp({
    op: "place_session", sessionId: key, folderId: targetContainerId === UNFILED_ID ? null : targetContainerId,
    order: canOrder ? orderAfterMove(ordered, key, targetKey || null, insertBefore) : undefined,
  });
}

function wireContainerDrop(el, containerId) {
  el.addEventListener("dragover", function (event) {
    var drag = dragState();
    if (!drag || drag.type !== "session") return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    el.classList.add("session-folder-drop");
  });
  el.addEventListener("dragleave", function (event) {
    if (!el.contains(event.relatedTarget)) el.classList.remove("session-folder-drop");
  });
  el.addEventListener("drop", function (event) {
    var drag = dragState();
    if (!drag || drag.type !== "session") return;
    event.preventDefault();
    clearDropMarks();
    dropSession(containerId, null, false);
  });
}

function wireUnitDrop(wrapper, containerId, key) {
  wrapper.addEventListener("dragover", function (event) {
    var drag = dragState();
    if (!drag || drag.type !== "session" || drag.key === key) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    wrapper.classList.remove("drag-over-above", "drag-over-below");
    if (reorderable(containerId)) {
      var rect = wrapper.getBoundingClientRect();
      wrapper.classList.add(event.clientY < rect.top + rect.height / 2 ? "drag-over-above" : "drag-over-below");
    }
  });
  wrapper.addEventListener("dragleave", function () { wrapper.classList.remove("drag-over-above", "drag-over-below"); });
  wrapper.addEventListener("drop", function (event) {
    var drag = dragState();
    if (!drag || drag.type !== "session" || drag.key === key) return;
    event.preventDefault();
    event.stopPropagation();
    var rect = wrapper.getBoundingClientRect();
    var before = event.clientY < rect.top + rect.height / 2;
    clearDropMarks();
    dropSession(containerId, key, before);
  });
}

// --- Rendering ---

function countUnits(units) {
  var total = 0;
  for (var i = 0; i < units.length; i++) {
    var item = units[i].item;
    total += item.type === "driver-hierarchy" ? 1 + item.root.workers.length : 1;
  }
  return total;
}

function renderUnit(unit, containerId, ctx) {
  var wrapper = document.createElement("div");
  wrapper.className = "session-folder-unit";
  if (unit.key) {
    wrapper.dataset.unitKey = String(unit.key);
    if (ctx.surface === "desktop") wireUnitDrop(wrapper, containerId, unit.key);
  }
  wrapper.appendChild(ctx.renderItem(unit.item));
  return wrapper;
}

function folderMenuEntries(section, ctx) {
  var folders = currentFolderState().folders;
  var at = folders.map(function (f) { return f.id; }).indexOf(section.id);
  var folder = { id: section.id, label: section.label };
  return [
    { label: "New session here", icon: "plus", disabled: !ctx.newSessionIn, run: function () { if (ctx.newSessionIn) ctx.newSessionIn(section.id); } },
    { label: "Rename", icon: "pencil", run: function () { renameFolder(folder); } },
    { label: "Move up", icon: "arrow-up", disabled: at <= 0, run: function () { shiftFolder(section.id, -1); } },
    { label: "Move down", icon: "arrow-down", disabled: at === -1 || at >= folders.length - 1, run: function () { shiftFolder(section.id, 1); } },
    { label: "Delete folder", icon: "trash-2", danger: true, run: function () { deleteFolder(folder); } },
  ];
}

function renderSection(section, ctx, kind) {
  var isFavorites = kind === "favorites";
  var surface = ctx.surface;
  var root = document.createElement("section");
  root.className = "session-folder session-folder-" + kind + (surface === "mobile" ? " is-mobile" : "") + (section.collapsed ? " collapsed" : "");
  root.dataset.folderId = section.id;
  var bodyId = "session-folder-body-" + surface + "-" + section.id;

  var header = document.createElement("div");
  header.className = "session-folder-header";
  var toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "session-folder-toggle";
  toggle.setAttribute("aria-expanded", String(!section.collapsed));
  toggle.setAttribute("aria-controls", bodyId);
  var icon = isFavorites ? "star" : (kind === "unfiled" ? "inbox" : "folder");
  toggle.innerHTML = '<span class="session-folder-chevron">' + iconHtml("chevron-right") + "</span>" +
    '<span class="session-folder-icon">' + iconHtml(icon) + "</span>" +
    '<span class="session-folder-label">' + escapeHtml(section.label) + "</span>" +
    '<span class="session-folder-count">' + countUnits(section.units) + "</span>";
  toggle.addEventListener("click", function () {
    if (consumeFolderClickSuppress()) return;
    sendFolderOp({ op: "set_collapsed", containerKey: section.id, collapsed: !section.collapsed });
  });
  header.appendChild(toggle);

  if (kind === "folder") {
    wireFolderContext(header, toggle, function () { return folderMenuEntries(section, ctx); });
    if (surface === "desktop") wireFolderDrag(header, section.id, section.label);
  }
  root.appendChild(header);

  var body = document.createElement("div");
  body.className = "session-folder-body";
  body.id = bodyId;
  body.setAttribute("role", "group");
  body.setAttribute("aria-label", section.label);
  body.hidden = section.collapsed;
  if (!section.units.length) {
    var empty = document.createElement("div");
    empty.className = "session-folder-empty";
    empty.textContent = isFavorites
      ? (surface === "mobile" ? "Use Move to folder on a session to add favorites." : "Drag sessions here to add favorites.")
      : (kind === "folder" ? "Empty folder" : "Nothing unfiled");
    body.appendChild(empty);
  }
  for (var i = 0; i < section.units.length; i++) body.appendChild(renderUnit(section.units[i], section.id, ctx));
  root.appendChild(body);
  if (surface === "desktop") wireContainerDrop(root, section.id);
  return root;
}

export function renderFavoritesSection(layout, ctx) {
  return renderSection({ id: FAVORITES_ID, label: "Favorites", units: layout.favorites, collapsed: layout.favoritesCollapsed }, ctx, "favorites");
}

// Appends the non-Favorites part of the layout to `container`.
export function renderOrdinarySections(layout, ctx, container) {
  // The DOM is replaced on every render; a folder drag in flight is re-previewed on the fresh blocks.
  if (ctx.surface === "desktop") queueMicrotask(reapplyFolderDragPreview);
  // The draft shows where the new folder will appear: after the custom
  // folders and before Unfiled.
  var draft = renderFolderDraft(ctx.surface);
  for (var i = 0; i < layout.sections.length; i++) {
    var section = layout.sections[i];
    if (draft && section.type === "unfiled") { container.appendChild(draft); draft = null; }
    container.appendChild(renderSection(section, ctx, section.type));
  }
  if (draft) container.appendChild(draft);
}
